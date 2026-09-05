// Persists renderer-owned iCloud merge anchors outside WKWebView storage.
'use strict';

const nodeCrypto = require('node:crypto');
const nodeFs = require('node:fs/promises');
const nodePath = require('node:path');

const DURABLE_SYNC_STATE_VERSION = 1;
// CloudKit accepts a 25 MiB workbook asset. The decoded merge base plus this
// envelope's JSON keys/newline needs headroom beyond that transport boundary.
const MAX_DURABLE_SYNC_STATE_BYTES = 32 * 1024 * 1024;
const WORKBOOK_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CONFLICT_NOTICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeCloudEnvironment(value) {
  const environment = String(value == null ? '' : value)
    .trim()
    .toLowerCase();
  if (environment === 'development') return 'Development';
  if (environment === 'production') return 'Production';
  return '';
}

function normalizeAccountId(value) {
  const accountId = String(value == null ? '' : value).trim();
  if (!accountId || accountId.length > 256 || /[\u0000-\u001f\u007f]/.test(accountId)) {
    return '';
  }
  return accountId;
}

function normalizeWorkbookId(value) {
  const workbookId = String(value == null ? '' : value).trim();
  return WORKBOOK_ID_PATTERN.test(workbookId) ? workbookId : '';
}

function normalizeRevision(value, { nullable = true } = {}) {
  if (nullable && (value == null || value === '')) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : undefined;
}

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return null;
  }
}

function normalizeSyncState(value, workbookId) {
  if (value == null) return null;
  const source = asPlainObject(value);
  if (!source || Number(source.version) !== 1 || typeof source.conflict !== 'boolean') return null;

  const revision = normalizeRevision(source.revision);
  if (revision === undefined) return null;
  if (source.remoteDeleted != null && typeof source.remoteDeleted !== 'boolean') return null;

  const conflictNoticeId = String(source.conflictNoticeId == null ? '' : source.conflictNoticeId);
  const conflictRemoteRevision = normalizeRevision(source.conflictRemoteRevision);
  const hasConflictNoticeId = source.conflictNoticeId != null;
  const hasConflictRemoteRevision = source.conflictRemoteRevision != null;
  if (
    hasConflictNoticeId !== hasConflictRemoteRevision ||
    (hasConflictNoticeId &&
      (!source.conflict ||
        !CONFLICT_NOTICE_ID_PATTERN.test(conflictNoticeId) ||
        !conflictRemoteRevision))
  ) {
    return null;
  }
  if (hasConflictRemoteRevision && conflictRemoteRevision === undefined) return null;

  const hasBaseWorkbook = Object.prototype.hasOwnProperty.call(source, 'baseWorkbook');
  const hasBaseRevision = Object.prototype.hasOwnProperty.call(source, 'baseRevision');
  let baseWorkbook = null;
  let baseRevision = null;
  if (hasBaseWorkbook || hasBaseRevision) {
    baseWorkbook = clonePlain(source.baseWorkbook);
    baseRevision = normalizeRevision(source.baseRevision, { nullable: false });
    if (
      !asPlainObject(baseWorkbook) ||
      String(baseWorkbook.id || '') !== workbookId ||
      !baseRevision ||
      (revision && baseRevision > revision)
    ) {
      return null;
    }
  }

  return {
    version: 1,
    revision,
    conflict: source.conflict,
    ...(source.remoteDeleted === true ? { remoteDeleted: true } : {}),
    ...(conflictNoticeId && conflictRemoteRevision
      ? { conflictNoticeId, conflictRemoteRevision }
      : {}),
    ...(baseWorkbook && baseRevision ? { baseRevision, baseWorkbook } : {})
  };
}

function normalizeDurableEnvelope(value, expectedScope = {}) {
  const source = asPlainObject(value);
  if (!source || Number(source.version) !== DURABLE_SYNC_STATE_VERSION) return null;
  const cloudEnvironment = normalizeCloudEnvironment(source.cloudEnvironment);
  const accountId = normalizeAccountId(source.accountId);
  const workbookId = normalizeWorkbookId(source.workbookId);
  if (!(cloudEnvironment && accountId && workbookId)) return null;
  if (
    (expectedScope.cloudEnvironment &&
      cloudEnvironment !== normalizeCloudEnvironment(expectedScope.cloudEnvironment)) ||
    (expectedScope.accountId && accountId !== normalizeAccountId(expectedScope.accountId)) ||
    (expectedScope.workbookId && workbookId !== normalizeWorkbookId(expectedScope.workbookId))
  ) {
    return null;
  }
  if (typeof source.autoSyncEnabled !== 'boolean') return null;
  const syncState = normalizeSyncState(source.syncState, workbookId);
  if (source.syncState != null && !syncState) return null;
  const updatedAt = String(source.updatedAt == null ? '' : source.updatedAt)
    .trim()
    .slice(0, 64);
  return {
    version: DURABLE_SYNC_STATE_VERSION,
    cloudEnvironment,
    accountId,
    workbookId,
    syncState,
    autoSyncEnabled: source.autoSyncEnabled,
    ...(updatedAt ? { updatedAt } : {})
  };
}

function createCloudSyncStateStorage(options = {}) {
  const fs = options.fs || nodeFs;
  const path = options.path || nodePath;
  const crypto = options.crypto || nodeCrypto;
  const rootDir = path.resolve(String(options.rootDir || ''));
  const maximumBytes = Math.max(1024, Number(options.maximumBytes) || MAX_DURABLE_SYNC_STATE_BYTES);
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
  const createTempId =
    typeof options.createTempId === 'function'
      ? options.createTempId
      : () =>
          typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : crypto.randomBytes(16).toString('hex');
  let writeQueue = Promise.resolve();

  if (!String(options.rootDir || '').trim()) {
    throw new Error('Cloud sync state storage requires an Application Support directory.');
  }

  function scope(value = {}) {
    const cloudEnvironment = normalizeCloudEnvironment(value.cloudEnvironment);
    const accountId = normalizeAccountId(value.accountId);
    const workbookId = normalizeWorkbookId(value.workbookId);
    if (!(cloudEnvironment && accountId && workbookId)) {
      const error = new Error('The durable iCloud sync state scope is invalid.');
      error.code = 'cloud_sync_state_scope_invalid';
      throw error;
    }
    return { cloudEnvironment, accountId, workbookId };
  }

  function location(value) {
    const normalized = scope(value);
    const environmentDirectory = normalized.cloudEnvironment.toLowerCase();
    const directory = path.join(rootDir, environmentDirectory, 'anchors');
    const digest = crypto
      .createHash('sha256')
      .update(
        `cavalry-cloud-sync-state-v1\0${normalized.cloudEnvironment}\0${normalized.accountId}\0${normalized.workbookId}`,
        'utf8'
      )
      .digest('hex');
    return {
      ...normalized,
      directory,
      filePath: path.join(directory, `${digest}.json`)
    };
  }

  async function ensureDirectory(directory) {
    const privateDirectories = [rootDir, path.dirname(directory), directory];
    for (const privateDirectory of privateDirectories) {
      await fs.mkdir(privateDirectory, { recursive: true, mode: 0o700 });
      if (typeof fs.chmod === 'function') await fs.chmod(privateDirectory, 0o700);
    }
  }

  function enqueue(operation) {
    const next = writeQueue.catch(() => undefined).then(operation);
    writeQueue = next;
    return next;
  }

  async function hasOtherOwner(target) {
    let files;
    try {
      files = await fs.readdir(target.directory);
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
    for (const name of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const filePath = path.join(target.directory, name);
      const file = await fs.stat(filePath);
      if (!file.isFile() || file.size > maximumBytes) {
        throw Object.assign(new Error('Cavalry could not verify the saved iCloud account scope.'), {
          code: 'cloud_sync_state_corrupt'
        });
      }
      let envelope;
      try {
        envelope = normalizeDurableEnvelope(JSON.parse(await fs.readFile(filePath, 'utf8')));
      } catch (_error) {
        envelope = null;
      }
      if (!envelope) {
        throw Object.assign(new Error('Cavalry could not verify the saved iCloud account scope.'), {
          code: 'cloud_sync_state_corrupt'
        });
      }
      if (envelope.workbookId === target.workbookId && envelope.accountId !== target.accountId)
        return true;
    }
    return false;
  }

  async function load(value) {
    await writeQueue.catch(() => undefined);
    const target = location(value);
    let serialized;
    try {
      const file = await fs.stat(target.filePath);
      if (!file.isFile() || file.size > maximumBytes) {
        return { ok: false, status: 'corrupt', code: 'cloud_sync_state_oversize' };
      }
      serialized = await fs.readFile(target.filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        if (await hasOtherOwner(target)) {
          // A newly encountered account must not inherit another account's
          // local workbook. Persist the opt-out before exposing a ready scope.
          const seeded = await save({ ...target, syncState: null, autoSyncEnabled: false });
          return { ...seeded, status: 'loaded' };
        }
        return { ok: true, status: 'missing', envelope: null };
      }
      throw error;
    }
    if (Buffer.byteLength(serialized, 'utf8') > maximumBytes) {
      return { ok: false, status: 'corrupt', code: 'cloud_sync_state_oversize' };
    }
    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch (_error) {
      return { ok: false, status: 'corrupt', code: 'cloud_sync_state_corrupt' };
    }
    const envelope = normalizeDurableEnvelope(parsed, target);
    if (!envelope) {
      return { ok: false, status: 'corrupt', code: 'cloud_sync_state_corrupt' };
    }
    return { ok: true, status: 'loaded', envelope };
  }

  async function save(value = {}) {
    const target = location(value);
    if (typeof value.autoSyncEnabled !== 'boolean') {
      const error = new Error('The durable iCloud autosave preference is invalid.');
      error.code = 'cloud_sync_state_invalid';
      throw error;
    }
    const envelope = normalizeDurableEnvelope(
      {
        version: DURABLE_SYNC_STATE_VERSION,
        cloudEnvironment: target.cloudEnvironment,
        accountId: target.accountId,
        workbookId: target.workbookId,
        syncState: value.syncState == null ? null : value.syncState,
        autoSyncEnabled: value.autoSyncEnabled,
        updatedAt: String(now() || '').slice(0, 64)
      },
      target
    );
    if (!envelope) {
      const error = new Error('The durable iCloud sync state is invalid.');
      error.code = 'cloud_sync_state_invalid';
      throw error;
    }
    const serialized = `${JSON.stringify(envelope)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > maximumBytes) {
      const error = new Error('The durable iCloud sync state exceeds its size limit.');
      error.code = 'cloud_sync_state_oversize';
      throw error;
    }

    return enqueue(async () => {
      await ensureDirectory(target.directory);
      const token = String(createTempId() || '')
        .replace(/[^A-Za-z0-9._-]/g, '')
        .slice(0, 96);
      if (!token) throw new Error('A unique cloud sync state temporary filename is required.');
      const tempPath = `${target.filePath}.${process.pid || 'process'}.${token}.tmp`;
      try {
        await fs.writeFile(tempPath, serialized, {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx'
        });
        if (typeof fs.chmod === 'function') await fs.chmod(tempPath, 0o600);
        const fileHandle = await fs.open(tempPath, 'r');
        try {
          await fileHandle.sync();
        } finally {
          await fileHandle.close();
        }
        await fs.rename(tempPath, target.filePath);
        if (typeof fs.chmod === 'function') await fs.chmod(target.filePath, 0o600);
        const directoryHandle = await fs.open(target.directory, 'r');
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      } catch (error) {
        try {
          if (typeof fs.rm === 'function') await fs.rm(tempPath, { force: true });
          else if (typeof fs.unlink === 'function') await fs.unlink(tempPath);
        } catch (_cleanupError) {
          // Keep the original persistence failure.
        }
        throw error;
      }
      return { ok: true, status: 'saved', envelope };
    });
  }

  async function remove(value) {
    const target = location(value);
    return enqueue(async () => {
      try {
        if (typeof fs.rm === 'function') await fs.rm(target.filePath, { force: true });
        else await fs.unlink(target.filePath);
      } catch (error) {
        if (!(error && error.code === 'ENOENT')) throw error;
      }
      return { ok: true, status: 'removed' };
    });
  }

  return Object.freeze({ load, remove, save });
}

module.exports = {
  DURABLE_SYNC_STATE_VERSION,
  MAX_DURABLE_SYNC_STATE_BYTES,
  createCloudSyncStateStorage,
  normalizeCloudEnvironment,
  normalizeDurableEnvelope,
  normalizeSyncState
};
