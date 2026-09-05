import fs from 'node:fs/promises';
import { constants } from 'node:fs';
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

export function nativeCloudKitRecoverySources(userDataDir, homeDir) {
  const applicationSupport = path.join(homeDir, 'Library', 'Application Support');
  // Test/development overrides must never discover the user's real libraries.
  if (userDataDir !== path.join(applicationSupport, 'Cavalry for Mac'))
    return { legacyPayloadDirs: [], ownerCacheRoots: [] };
  const cloudKit = path.join(applicationSupport, 'com.juanmbuilder.cavalry.mac', 'CloudKit');
  const production = path.join(cloudKit, 'environments', 'production');
  return {
    legacyPayloadDirs: [path.join(production, 'payloads'), path.join(cloudKit, 'payloads')],
    ownerCacheRoots: [path.join(production, 'accounts')]
  };
}

// Immutable, validated workbook copies live outside the WebView and app bundle.
// The directory itself is the catalog: losing a pointer never loses the books.
export function createWorkbookRecoveryStore({
  rootDir,
  legacyPayloadDirs = [],
  ownerCacheRoots = [],
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

  function historyPath(key) {
    if (!KEY.test(key)) throw new Error('Invalid workbook recovery reference.');
    return path.join(rootDir, key, 'history.json');
  }

  async function readHistory(key) {
    let text;
    try {
      const target = historyPath(key);
      if ((await fileSystem.stat(target)).size > 64 * 1024)
        throw new Error('Workbook recovery ordering is too large.');
      text = await fileSystem.readFile(target, 'utf8');
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
    const history = JSON.parse(text);
    if (
      !history ||
      history.version !== 1 ||
      history.key !== key ||
      !Array.isArray(history.revisions) ||
      history.revisions.length === 0 ||
      history.revisions.length > RETAINED_COPIES ||
      !history.revisions.every((revision) => typeof revision === 'string' && KEY.test(revision)) ||
      new Set(history.revisions).size !== history.revisions.length
    )
      throw new Error('Invalid workbook recovery ordering.');
    return history.revisions;
  }

  async function readLatest(key) {
    const available = await copies(key);
    let failure = null;
    let revisions;
    try {
      revisions = await readHistory(key);
      if (!revisions) throw new Error('Workbook recovery ordering is missing.');
    } catch (error) {
      // An mtime cannot prove which save was acknowledged. Unordered copies
      // remain recoverable, but must open separately with cloud autosave off.
      failure = error;
    }
    const byRevision = new Map(
      available.map((copy) => [path.basename(copy.filePath, '.html'), copy])
    );
    const candidates = revisions
      ? [
          ...revisions.map(
            (revision) =>
              byRevision.get(revision) || {
                filePath: path.join(rootDir, key, `${revision}.html`),
                size: 0,
                savedAt: ''
              }
          ),
          ...available.filter((copy) => !revisions.includes(path.basename(copy.filePath, '.html')))
        ]
      : available;
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
    const contentHashes = new Set();
    for (const entry of keys) {
      try {
        const workbook = await readLatest(entry.name);
        contentHashes.add(hash(workbook.text));
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
    return {
      workbooks: result.sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
      contentHashes
    };
  }

  async function isPlainDirectory(directory) {
    try {
      return path.isAbsolute(directory) && (await fileSystem.lstat(directory)).isDirectory();
    } catch (_error) {
      return false;
    }
  }

  async function cloudPayloadDirectories() {
    const directories = new Set();
    for (const directory of legacyPayloadDirs) {
      if (await isPlainDirectory(directory)) directories.add(directory);
    }
    for (const root of ownerCacheRoots) {
      if (!(await isPlainDirectory(root))) continue;
      // Native stores have one fixed level of hashed owners. Never recurse
      // into arbitrary directories or follow linked account/payload folders.
      for (const owner of await entries(root).catch(() => [])) {
        if (!owner.isDirectory() || !KEY.test(owner.name)) continue;
        const directory = path.join(root, owner.name, 'payloads');
        if (
          (await isPlainDirectory(path.dirname(directory))) &&
          (await isPlainDirectory(directory))
        )
          directories.add(directory);
      }
    }
    return directories;
  }

  async function readCloudCandidate(filePath) {
    const file = await fileSystem.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stats = await file.stat();
      if (!stats.isFile() || stats.size > MAX_BYTES)
        throw new Error('This recovery copy is not a supported workbook file.');
      const text = await file.readFile('utf8');
      if (Buffer.byteLength(text, 'utf8') > MAX_BYTES)
        throw new Error('This recovery copy is too large.');
      return { text, savedAt: stats.mtime.toISOString() };
    } finally {
      await file.close();
    }
  }

  async function legacyCatalog(existingContents) {
    const found = new Map();
    legacyCopies.clear();
    for (const directory of await cloudPayloadDirectories()) {
      const files = await entries(directory).catch(() => []);
      for (const entry of files) {
        if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
        const filePath = path.join(directory, entry.name);
        try {
          const { text, savedAt } = await readCloudCandidate(filePath);
          const decoded = deserializeWorkbookFromFile(text, { rejectInvalid: true });
          // Two owners can keep different edits under the same workbook ID.
          // Only byte-identical contents are redundant with another candidate
          // or the current local copy; timestamps cannot supersede an owner.
          const contentHash = hash(text);
          if (existingContents.has(contentHash) || found.has(contentHash)) continue;
          const id = `recovery-legacy-${contentHash}`;
          legacyCopies.set(id, filePath);
          found.set(contentHash, {
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
    const revision = hash(text);
    const target = path.join(directory, `${revision}.html`);
    // Ordering is a durable commit record, independent of filesystem timestamps.
    // Missing ordering starts a new known history; pre-existing unindexed files
    // are preserved. Damaged ordering is recovered through load/open, never
    // silently replaced by an ordinary save.
    const previous = (await readHistory(key)) || [];
    const revisions = [revision, ...previous.filter((entry) => entry !== revision)].slice(
      0,
      RETAINED_COPIES
    );
    await writeAtomic(target, text);
    await writeAtomic(historyPath(key), JSON.stringify({ version: 1, key, revisions }));
    await writeAtomic(activePath, JSON.stringify({ version: 1, key }));
    const savedAt = (await fileSystem.stat(target)).mtime.toISOString();
    // Prune only previously indexed revisions after every durable commit.
    // Current and unindexed (possibly interrupted-save) copies are never pruned.
    // If any copy is damaged, retain everything for recovery and diagnosis.
    const history = await copies(key);
    const retired = previous.filter((entry) => entry !== revision && !revisions.includes(entry));
    if (retired.length) {
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
          retired.map((entry) =>
            fileSystem.rm(path.join(directory, `${entry}.html`)).catch(() => {})
          )
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
      const { workbooks: books } = await catalog();
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
        const { workbooks, contentHashes } = await catalog();
        return [...workbooks, ...(await legacyCatalog(contentHashes))];
      }),
    open: (id) =>
      ordered(async () => {
        if (String(id).startsWith('recovery-legacy-')) {
          const { contentHashes } = await catalog();
          await legacyCatalog(contentHashes);
          const filePath = legacyCopies.get(id);
          if (!filePath)
            throw new Error('Choose an available iCloud recovery copy from the local library.');
          const { text } = await readCloudCandidate(filePath);
          if (id !== `recovery-legacy-${hash(text)}`)
            throw new Error('This recovery copy changed. Choose it again from the local library.');
          return recoveredCopy({ text });
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
