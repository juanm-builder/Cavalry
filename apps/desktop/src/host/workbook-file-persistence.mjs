import fs from 'node:fs/promises';
import path from 'node:path';

import {
  deserializeWorkbookFromFile,
  serializeWorkbookForSave,
  WorkbookPersistenceError
} from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';

const pendingWritesByFileSystem = new WeakMap();

async function fileExists(filePath, fileSystem) {
  try {
    await fileSystem.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

export function getWorkbookBackupPath(filePath, options = {}) {
  if (options.backupPath) {
    return String(options.backupPath);
  }
  return `${String(filePath)}.bak`;
}

export async function createWorkbookBackup(filePath, options = {}) {
  const fileSystem = options.fs || fs;
  const backupPath = getWorkbookBackupPath(filePath, options);
  if (options.skipBackup === true) {
    return {
      created: false,
      backupPath
    };
  }
  if (!(await fileExists(filePath, fileSystem))) {
    return {
      created: false,
      backupPath
    };
  }
  await fileSystem.copyFile(filePath, backupPath);
  return {
    created: true,
    backupPath
  };
}

export async function readWorkbookFileWithRecovery(filePath, options = {}) {
  const fileSystem = options.fs || fs;
  const targetPath = String(filePath || '');
  const backupPath = getWorkbookBackupPath(targetPath, options);
  let primaryError = null;

  try {
    const text = await fileSystem.readFile(targetPath, 'utf8');
    const decoded = deserializeWorkbookFromFile(text, { rejectInvalid: true });
    const stats = await fileSystem.stat(targetPath);
    return {
      text,
      decoded,
      savedAt: stats.mtime.toISOString(),
      recoveredFromBackup: false,
      backupPath: ''
    };
  } catch (error) {
    primaryError = error;
  }

  try {
    const text = await fileSystem.readFile(backupPath, 'utf8');
    const decoded = deserializeWorkbookFromFile(text, { rejectInvalid: true });
    const stats = await fileSystem.stat(backupPath);
    return {
      text,
      decoded,
      savedAt: stats.mtime.toISOString(),
      recoveredFromBackup: true,
      backupPath,
      warning: 'The active workbook was unreadable. Cavalry loaded its last valid backup.'
    };
  } catch (backupError) {
    if (primaryError && typeof primaryError === 'object') {
      primaryError.backupError = backupError;
    }
    throw primaryError;
  }
}

export async function safeWriteWorkbookFile(filePath, text, options = {}) {
  const fileSystem = options.fs || fs;
  const pathApi = options.path || path;
  const key = pathApi.resolve(String(filePath || ''));
  let pendingWrites = pendingWritesByFileSystem.get(fileSystem);
  if (!pendingWrites) {
    pendingWrites = new Map();
    pendingWritesByFileSystem.set(fileSystem, pendingWrites);
  }
  // A workbook and its rolling backup share paths, so overlapping saves must finish
  // in request order. Independent workbook files can still be written concurrently.
  const previous = pendingWrites.get(key) || Promise.resolve();
  const write = previous
    .catch(() => undefined)
    .then(() => writeWorkbookFile(filePath, text, options));
  pendingWrites.set(key, write);
  try {
    return await write;
  } finally {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  }
}

async function writeWorkbookFile(filePath, text, options) {
  const fileSystem = options.fs || fs;
  const pathApi = options.path || path;
  const targetPath = String(filePath || '');
  if (!targetPath) {
    throw new WorkbookPersistenceError('Workbook file path is required.', {
      code: 'workbook_file_path_required'
    });
  }

  // Write-then-rename prevents a partial write from replacing the last valid workbook.
  const tempPath = options.tempPath || `${targetPath}.tmp`;
  await fileSystem.mkdir(pathApi.dirname(targetPath), { recursive: true });
  const backup = await createWorkbookBackup(
    targetPath,
    Object.assign({}, options, {
      fs: fileSystem
    })
  );

  try {
    await fileSystem.writeFile(tempPath, String(text || ''), 'utf8');
    if (typeof options.beforeRename === 'function') {
      await options.beforeRename({
        targetPath,
        tempPath,
        backupPath: backup.backupPath
      });
    }
    await fileSystem.rename(tempPath, targetPath);
  } catch (error) {
    try {
      await fileSystem.rm(tempPath, { force: true });
    } catch (_cleanupError) {
      // Cleanup is best-effort so the original write failure remains observable.
    }
    throw error;
  }

  const stats = await fileSystem.stat(targetPath);
  return {
    ok: true,
    filePath: targetPath,
    savedAt: stats.mtime.toISOString(),
    backupPath: backup.created ? backup.backupPath : '',
    tempPath
  };
}

export async function safeWriteWorkbook(filePath, workbook, options = {}) {
  const serialized = serializeWorkbookForSave(workbook, options);
  const write = await safeWriteWorkbookFile(filePath, serialized.html, options);
  return Object.assign({}, write, {
    validation: serialized.validation
  });
}
