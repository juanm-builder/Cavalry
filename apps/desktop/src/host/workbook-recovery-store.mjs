import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  deserializeWorkbookFromFile,
  serializeWorkbookForSave
} from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';

const KEY = /^[a-f0-9]{64}$/;
const MAX_BYTES = 25 * 1024 * 1024;
const RETAINED_COPIES = 30;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const missing = (error) => error?.code === 'ENOENT';

// Immutable, validated workbook copies live outside the WebView and app bundle.
// The directory itself is the catalog: losing a pointer never loses the books.
export function createWorkbookRecoveryStore({
  rootDir,
  legacyPayloadDirs = [],
  fileSystem = fs
} = {}) {
  if (!path.isAbsolute(rootDir || '')) throw new Error('A recovery directory is required.');
  let pending = Promise.resolve();
  const activePath = path.join(rootDir, 'active.json');
  const legacyCopies = new Map();

  function ordered(operation) {
    const result = pending.catch(() => {}).then(operation);
    pending = result;
    return result;
  }

  async function writeAtomic(target, text) {
    const directory = path.dirname(target);
    await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const file = await fileSystem.open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(text, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await fileSystem.rename(temporary, target);
      const folder = await fileSystem.open(directory, 'r');
      try {
        await folder.sync();
      } finally {
        await folder.close();
      }
    } finally {
      await fileSystem.rm(temporary, { force: true }).catch(() => {});
    }
  }

  async function entries(directory) {
    try {
      return await fileSystem.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
  }

  async function copies(key) {
    if (!KEY.test(key)) throw new Error('Invalid workbook recovery reference.');
    const directory = path.join(rootDir, key);
    const files = (await entries(directory)).filter(
      (entry) =>
        entry.isFile() &&
        KEY.test(entry.name.replace(/\.html$/, '')) &&
        entry.name.endsWith('.html')
    );
    const result = await Promise.all(
      files.map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const stats = await fileSystem.stat(filePath);
        return { filePath, size: stats.size, savedAt: stats.mtime.toISOString() };
      })
    );
    return result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async function readLatest(key) {
    const candidates = await copies(key);
    let failure = null;
    for (const candidate of candidates) {
      try {
        if (candidate.size > MAX_BYTES) throw new Error('Workbook recovery copy is too large.');
        const text = await fileSystem.readFile(candidate.filePath, 'utf8');
        if (hash(text) !== path.basename(candidate.filePath, '.html'))
          throw new Error('Workbook recovery checksum failed.');
        const decoded = deserializeWorkbookFromFile(text, { rejectInvalid: true });
        if (hash(decoded.workbook.id) !== key)
          throw new Error('Workbook recovery identity does not match.');
        return {
          ok: true,
          recovery: true,
          recoveredFromHistory: Boolean(failure),
          text,
          savedAt: candidate.savedAt,
          fileName: `${decoded.workbook.name}.html`,
          ...(failure
            ? {
                warning:
                  'The latest local copy could not be read. Cavalry recovered an earlier verified copy; all copies have been kept.'
              }
            : {})
        };
      } catch (error) {
        failure = error;
      }
    }
    if (failure)
      throw new Error(
        `Cavalry could not read this saved workbook. Recovery copies have been kept. ${failure.message}`
      );
    throw new Error(
      'This saved workbook could not be found. Recovery files have not been removed.'
    );
  }

  async function catalog() {
    const keys = (await entries(rootDir)).filter(
      (entry) => entry.isDirectory() && KEY.test(entry.name)
    );
    const result = [];
    for (const entry of keys) {
      try {
        const workbook = await readLatest(entry.name);
        result.push({
          id: `recovery-${entry.name}`,
          fileName: workbook.fileName,
          folderName: 'Saved on this Mac',
          savedAt: workbook.savedAt,
          lastUsedAt: workbook.savedAt
        });
      } catch (error) {
        // Keep unreadable books visible, so damage cannot masquerade as an empty library.
        result.push({
          id: `recovery-${entry.name}`,
          fileName: 'Workbook needs recovery',
          folderName: 'Saved on this Mac',
          savedAt: '',
          lastUsedAt: '',
          error: error.message
        });
      }
    }
    return result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async function legacyCatalog(current) {
    const found = new Map();
    const existingKeys = new Set(
      current.filter((entry) => !entry.error).map((entry) => entry.id.slice('recovery-'.length))
    );
    for (const directory of legacyPayloadDirs) {
      if (!path.isAbsolute(directory)) continue;
      const files = await entries(directory);
      for (const entry of files) {
        if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
        const filePath = path.join(directory, entry.name);
        try {
          const stats = await fileSystem.stat(filePath);
          if (stats.size > MAX_BYTES) continue;
          const text = await fileSystem.readFile(filePath, 'utf8');
          const decoded = deserializeWorkbookFromFile(text, { rejectInvalid: true });
          const key = hash(decoded.workbook.id);
          if (existingKeys.has(key)) continue;
          const savedAt = stats.mtime.toISOString();
          if (found.has(key) && found.get(key).savedAt >= savedAt) continue;
          const id = `recovery-legacy-${hash(filePath)}`;
          legacyCopies.set(id, filePath);
          found.set(key, {
            id,
            fileName: `${decoded.workbook.name} (iCloud recovery)`,
            folderName: 'Saved iCloud copy on this Mac',
            savedAt,
            lastUsedAt: savedAt
          });
        } catch (_error) {
          // Legacy CloudKit files are recovery candidates only. Never rewrite,
          // remove, or treat an unreadable asset as a new empty workbook.
        }
      }
    }
    return [...found.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async function saveSnapshot(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES)
      throw new Error('Workbook exceeds the local recovery size limit.');
    const decoded = deserializeWorkbookFromFile(text, { rejectInvalid: true });
    const key = hash(decoded.workbook.id);
    const directory = path.join(rootDir, key);
    const target = path.join(directory, `${hash(text)}.html`);
    // Re-saving identical content refreshes its ordering without adding another revision.
    await writeAtomic(target, text);
    await writeAtomic(activePath, JSON.stringify({ version: 1, key }));
    const savedAt = (await fileSystem.stat(target)).mtime.toISOString();
    // Prune only after both durable commits. Interrupted saves retain extra copies.
    // If any copy is damaged, retain everything for recovery and diagnosis.
    const history = await copies(key);
    if (history.length > RETAINED_COPIES) {
      let valid = true;
      for (const copy of history) {
        const data = await fileSystem.readFile(copy.filePath, 'utf8').catch(() => '');
        if (hash(data) !== path.basename(copy.filePath, '.html')) {
          valid = false;
          break;
        }
      }
      if (valid)
        await Promise.all(
          history.slice(RETAINED_COPIES).map((copy) => fileSystem.rm(copy.filePath).catch(() => {}))
        );
    }
    return { ok: true, durable: true, savedAt, fileName: `${decoded.workbook.name}.html` };
  }

  async function recoveredCopy(result) {
    const original = deserializeWorkbookFromFile(result.text, { rejectInvalid: true }).workbook;
    const workbook = {
      ...original,
      id: `workbook-recovered-${randomUUID()}`,
      name: `${original.name} (Recovered)`
    };
    const text = serializeWorkbookForSave(workbook, { rejectInvalid: true }).html;
    const saved = await saveSnapshot(text);
    return {
      ...result,
      ...saved,
      text,
      recovery: true,
      recoveredFromHistory: true,
      warning:
        'Cavalry opened an earlier verified copy as a separate recovered workbook. The original and iCloud copies have been kept. iCloud autosave is off until you review this copy.'
    };
  }

  async function acceptRecovery(result) {
    return result.recoveredFromHistory ? recoveredCopy(result) : result;
  }

  async function load() {
    return ordered(async () => {
      let active;
      let pointerFailure = false;
      try {
        active = JSON.parse(await fileSystem.readFile(activePath, 'utf8'));
        if (active.version !== 1 || !(active.key === null || KEY.test(active.key)))
          throw new Error('Invalid recovery pointer.');
      } catch (error) {
        pointerFailure = !missing(error);
        active = undefined;
      }
      if (active?.key === null) return { ok: false, empty: true, cleared: true };
      if (active?.key) return acceptRecovery(await readLatest(active.key));
      const books = await catalog();
      if (!books.length) {
        if (pointerFailure)
          throw new Error(
            'The saved workbook pointer could not be read. Existing files have been kept.'
          );
        return { ok: false, empty: true };
      }
      const result = await acceptRecovery(await readLatest(books[0].id.slice('recovery-'.length)));
      return {
        ...result,
        warning:
          result.warning ||
          'Cavalry recovered a workbook from its local library. Other saved workbooks remain available on this Mac.'
      };
    });
  }

  return {
    load,
    list: () =>
      ordered(async () => {
        const current = await catalog();
        return [...current, ...(await legacyCatalog(current))];
      }),
    open: (id) =>
      ordered(async () => {
        if (String(id).startsWith('recovery-legacy-')) {
          await legacyCatalog(await catalog());
          const filePath = legacyCopies.get(id);
          if (!filePath)
            throw new Error('Choose an available iCloud recovery copy from the local library.');
          const stats = await fileSystem.stat(filePath);
          if (stats.size > MAX_BYTES) throw new Error('This recovery copy is too large.');
          return recoveredCopy({ text: await fileSystem.readFile(filePath, 'utf8') });
        }
        const key = String(id || '').replace(/^recovery-/, '');
        const result = await readLatest(key);
        if (result.recoveredFromHistory) return recoveredCopy(result);
        await writeAtomic(activePath, JSON.stringify({ version: 1, key }));
        return result;
      }),
    clear: () =>
      ordered(async () => {
        // Leaving a workbook only clears selection. It never deletes a saved copy.
        await writeAtomic(activePath, JSON.stringify({ version: 1, key: null }));
        return { ok: true };
      }),
    save: (text) => ordered(() => saveSnapshot(text)),
    recover: (text) => ordered(() => recoveredCopy({ text }))
  };
}
