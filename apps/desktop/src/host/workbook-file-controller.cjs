const defaultFs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');

const MAX_RECENT_WORKBOOKS = 8;

function normalizeWorkbookPath(value) {
  const filePath = String(value || '');
  return path.isAbsolute(filePath) ? path.normalize(filePath) : '';
}

function errorCode(error) {
  return String((error && (error.code || (error.cause && error.cause.code))) || '');
}

function isMissingFileError(error) {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isPermissionError(error) {
  const code = errorCode(error);
  return code === 'EPERM' || code === 'EACCES';
}

// A raw "EPERM: operation not permitted" tells the reader nothing about the cause, which on macOS
// is almost always a folder the operating system protects until the application is granted access.
function describeReadFailure(error, filePath) {
  if (isPermissionError(error)) {
    return `Cavalry is not allowed to read ${filePath}. Grant Cavalry access to that folder in your operating system privacy settings, then try again.`;
  }
  return error && error.message ? error.message : 'The linked workbook file could not be opened.';
}

function recentWorkbookId(filePath) {
  return crypto
    .createHash('sha256')
    .update(String(filePath || ''))
    .digest('hex')
    .slice(0, 24);
}

function validTimestamp(value) {
  const timestamp = String(value || '');
  return timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp : '';
}

function createWorkbookFileController({
  app,
  ipcMain,
  dialog,
  shell,
  recoveryStore,
  fs = defaultFs,
  appTitle = 'Cavalry for Mac',
  now = () => new Date().toISOString(),
  getWorkbookPersistenceService,
  assertTrustedSender
} = {}) {
  let activeWorkbookPath = '';
  let activeWorkbookRecoveredFromBackup = false;
  let recentWorkbooks = [];
  let workbookPersistenceServicePromise = null;

  function getFileStatePath() {
    return path.join(app.getPath('userData'), 'cavalry-file-state.json');
  }

  async function loadFileState() {
    try {
      const raw = await fs.readFile(getFileStatePath(), 'utf8');
      const parsed = JSON.parse(raw);
      activeWorkbookPath = normalizeWorkbookPath(parsed && parsed.activeWorkbookPath);
      const seenPaths = new Set();
      recentWorkbooks = [];
      for (const entry of Array.isArray(parsed && parsed.recentWorkbooks)
        ? parsed.recentWorkbooks
        : []) {
        const filePath = normalizeWorkbookPath(entry && entry.filePath);
        if (!filePath || seenPaths.has(filePath)) continue;
        seenPaths.add(filePath);
        recentWorkbooks.push({
          filePath,
          lastUsedAt: validTimestamp(entry && entry.lastUsedAt),
          savedAt: validTimestamp(entry && entry.savedAt)
        });
        if (recentWorkbooks.length >= MAX_RECENT_WORKBOOKS) break;
      }
      if (
        activeWorkbookPath &&
        !recentWorkbooks.some((entry) => entry.filePath === activeWorkbookPath)
      ) {
        recentWorkbooks.unshift({
          filePath: activeWorkbookPath,
          lastUsedAt: validTimestamp(parsed && parsed.activeWorkbookLastUsedAt) || now(),
          savedAt: ''
        });
      }
      recentWorkbooks = recentWorkbooks.slice(0, MAX_RECENT_WORKBOOKS);
    } catch (_error) {
      activeWorkbookPath = '';
      recentWorkbooks = [];
    }
  }

  async function saveFileState() {
    await fs.mkdir(path.dirname(getFileStatePath()), { recursive: true });
    await fs.writeFile(
      getFileStatePath(),
      JSON.stringify({ activeWorkbookPath, recentWorkbooks }, null, 2),
      'utf8'
    );
  }

  function getFileName(filePath) {
    return filePath ? path.basename(filePath) : '';
  }

  function getRecentWorkbooks() {
    return recentWorkbooks.slice(0, MAX_RECENT_WORKBOOKS).map((entry) => ({
      id: recentWorkbookId(entry.filePath),
      fileName: getFileName(entry.filePath),
      folderName: path.basename(path.dirname(entry.filePath)),
      lastUsedAt: entry.lastUsedAt,
      savedAt: entry.savedAt
    }));
  }

  function touchRecentWorkbook(filePath, { savedAt = '' } = {}) {
    const normalizedPath = normalizeWorkbookPath(filePath);
    if (!normalizedPath) return;
    const previous = recentWorkbooks.find((entry) => entry.filePath === normalizedPath);
    recentWorkbooks = [
      {
        filePath: normalizedPath,
        lastUsedAt: now(),
        savedAt: validTimestamp(savedAt) || (previous && previous.savedAt) || ''
      },
      ...recentWorkbooks.filter((entry) => entry.filePath !== normalizedPath)
    ].slice(0, MAX_RECENT_WORKBOOKS);
    if (app && typeof app.addRecentDocument === 'function') {
      try {
        app.addRecentDocument(normalizedPath);
      } catch (_error) {
        // Cavalry's own MRU remains available when the OS recent-documents API is unavailable.
      }
    }
  }

  function removeRecentWorkbook(filePath) {
    recentWorkbooks = recentWorkbooks.filter((entry) => entry.filePath !== filePath);
  }

  function loadWorkbookPersistenceService() {
    if (typeof getWorkbookPersistenceService === 'function') {
      return getWorkbookPersistenceService();
    }
    if (!workbookPersistenceServicePromise) {
      workbookPersistenceServicePromise = import('./workbook-file-persistence.mjs');
    }
    return workbookPersistenceServicePromise;
  }

  async function readWorkbookFile(filePath) {
    try {
      const persistence = await loadWorkbookPersistenceService();
      if (typeof persistence.readWorkbookFileWithRecovery === 'function') {
        const recovered = await persistence.readWorkbookFileWithRecovery(filePath);
        return Object.assign(
          {
            ok: true,
            fileName: getFileName(filePath),
            text: recovered.text,
            workbookId: recovered.decoded?.workbook?.id,
            savedAt: recovered.savedAt
          },
          recovered.recoveredFromBackup === true
            ? {
                recoveredFromBackup: true,
                backupFileName: getFileName(recovered.backupPath),
                warning: recovered.warning
              }
            : {}
        );
      }
      const [text, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
      return {
        ok: true,
        fileName: getFileName(filePath),
        text,
        savedAt: stats.mtime.toISOString()
      };
    } catch (error) {
      return {
        ok: false,
        missing: isMissingFileError(error),
        permissionDenied: isPermissionError(error),
        fileName: getFileName(filePath),
        error: describeReadFailure(error, filePath)
      };
    }
  }

  async function getActiveWorkbookFile() {
    if (!activeWorkbookPath) {
      return { ok: false, empty: true, fileName: '' };
    }
    const result = await readWorkbookFile(activeWorkbookPath);
    if (result.recoveredFromBackup && recoveryStore) {
      // Startup reads this linked export before the recovery cache. Do not let
      // an older .bak change recovery selection before the durable save is read.
      const existing = await recoveryStore.load();
      let recovered;
      if (existing?.cleared || (existing?.ok && existing.text)) {
        recovered = existing;
      } else if (existing?.empty === true) {
        recovered = await recoveryStore.recover(result.text);
      } else {
        throw new Error(
          existing?.error ||
            'The saved workbook could not be read safely. Recovery files have been kept.'
        );
      }
      activeWorkbookPath = '';
      activeWorkbookRecoveredFromBackup = false;
      await saveFileState();
      return recovered;
    }
    activeWorkbookRecoveredFromBackup = result.recoveredFromBackup === true;
    return result;
  }

  async function openWorkbookPath(filePath) {
    const result = await readWorkbookFile(filePath);
    if (!result.ok) return result;
    if (result.recoveredFromBackup && recoveryStore) {
      const recovered = await recoveryStore.recover(result.text);
      activeWorkbookPath = '';
      activeWorkbookRecoveredFromBackup = false;
      touchRecentWorkbook(filePath, { savedAt: result.savedAt });
      await saveFileState();
      return recovered;
    }
    activeWorkbookPath = filePath;
    activeWorkbookRecoveredFromBackup = result.recoveredFromBackup === true;
    touchRecentWorkbook(filePath, { savedAt: result.savedAt });
    await saveFileState();
    return { ...result, recentWorkbooks: getRecentWorkbooks() };
  }

  async function writeWorkbookFile(filePath, html) {
    const persistence = await loadWorkbookPersistenceService();
    const result = await persistence.safeWriteWorkbookFile(filePath, html, {
      skipBackup: activeWorkbookRecoveredFromBackup && filePath === activeWorkbookPath
    });
    if (filePath === activeWorkbookPath) {
      activeWorkbookRecoveredFromBackup = false;
    }
    return {
      ok: true,
      fileName: getFileName(filePath),
      savedAt: result.savedAt,
      backupFileName: result.backupPath ? getFileName(result.backupPath) : ''
    };
  }

  function registerFileHandlers() {
    if (typeof assertTrustedSender !== 'function') {
      throw new Error('A trusted IPC sender guard is required.');
    }
    const handle = (channel, handler) => {
      ipcMain.handle(channel, (event, ...args) => {
        assertTrustedSender(event);
        return handler(event, ...args);
      });
    };

    handle('cavalry-files:get-active', async () => getActiveWorkbookFile());

    handle('cavalry-files:list-recent', async () => ({
      ok: true,
      workbooks: [...(recoveryStore ? await recoveryStore.list() : []), ...getRecentWorkbooks()]
    }));

    if (recoveryStore) {
      handle('cavalry-files:recovery-load', () => recoveryStore.load());
      handle('cavalry-files:recovery-save', (_event, payload) => recoveryStore.save(payload?.html));
      handle('cavalry-files:recovery-clear', () => recoveryStore.clear());
    }

    handle('cavalry-files:open-recent', async (_event, payload) => {
      const id = String(payload && payload.id ? payload.id : '');
      if (recoveryStore && id.startsWith('recovery-')) {
        const result = await recoveryStore.open(id);
        activeWorkbookPath = '';
        activeWorkbookRecoveredFromBackup = false;
        await saveFileState();
        return result;
      }
      const recent = recentWorkbooks.find((entry) => recentWorkbookId(entry.filePath) === id);
      if (!recent) {
        return {
          ok: false,
          code: 'invalid_recent_workbook',
          error: 'Choose a workbook from the recent files list.'
        };
      }
      const result = await openWorkbookPath(recent.filePath);
      if (!result.ok && result.missing) {
        removeRecentWorkbook(recent.filePath);
        if (activeWorkbookPath === recent.filePath) activeWorkbookPath = '';
        await saveFileState();
        return {
          ...result,
          error: 'This recent workbook has moved or been deleted.',
          recentWorkbooks: getRecentWorkbooks()
        };
      }
      return result;
    });

    handle('cavalry-files:open', async () => {
      const result = await dialog.showOpenDialog({
        title: `Open ${appTitle} Workbook`,
        properties: ['openFile'],
        filters: [
          { name: 'Cavalry Workbook', extensions: ['html'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      if (result.canceled || !result.filePaths.length) {
        return { ok: false, canceled: true };
      }
      return openWorkbookPath(result.filePaths[0]);
    });

    handle('cavalry-files:save-as', async (_event, payload) => {
      const suggestedName = String(
        payload && payload.suggestedName ? payload.suggestedName : 'cavalry-workbook.html'
      );
      const result = await dialog.showSaveDialog({
        title: `Save ${appTitle} Workbook`,
        defaultPath: suggestedName,
        filters: [{ name: 'Cavalry Workbook', extensions: ['html'] }],
        properties: ['createDirectory']
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true };
      }
      const writeResult = await writeWorkbookFile(result.filePath, payload && payload.html);
      activeWorkbookPath = result.filePath;
      activeWorkbookRecoveredFromBackup = false;
      touchRecentWorkbook(result.filePath, { savedAt: writeResult.savedAt });
      await saveFileState();
      return { ...writeResult, recentWorkbooks: getRecentWorkbooks() };
    });

    handle('cavalry-files:save-active', async (_event, payload) => {
      if (!activeWorkbookPath) {
        return { ok: false, needsFile: true, error: 'No workbook file selected.' };
      }
      const targetPath = activeWorkbookPath;
      try {
        const persistence = await loadWorkbookPersistenceService();
        if (typeof persistence.getWorkbookIdentityFromText === 'function') {
          const target = await readWorkbookFile(targetPath);
          if (!target.ok) return target;
          if (persistence.getWorkbookIdentityFromText(payload?.html) !== target.workbookId) {
            return {
              ok: false,
              needsFile: true,
              error:
                'The linked file belongs to another workbook. Your local recovery copy has been kept; use Save As to choose a file.'
            };
          }
        }
        const writeResult = await writeWorkbookFile(targetPath, payload && payload.html);
        touchRecentWorkbook(targetPath, { savedAt: writeResult.savedAt });
        await saveFileState();
        return { ...writeResult, recentWorkbooks: getRecentWorkbooks() };
      } catch (error) {
        return {
          ok: false,
          fileName: getFileName(targetPath),
          error: error && error.message ? error.message : 'Unable to save the workbook file.'
        };
      }
    });

    handle('cavalry-files:forget-active', async () => {
      activeWorkbookPath = '';
      activeWorkbookRecoveredFromBackup = false;
      await saveFileState();
      return { ok: true };
    });

    handle('cavalry-files:reveal-active', async () => {
      if (!activeWorkbookPath) {
        return { ok: false, error: 'No workbook file selected.' };
      }
      shell.showItemInFolder(activeWorkbookPath);
      return { ok: true, fileName: getFileName(activeWorkbookPath) };
    });
  }

  return {
    getActiveWorkbookPath: () => activeWorkbookPath,
    getRecentWorkbooks,
    setActiveWorkbookPath: (filePath) => {
      activeWorkbookPath = normalizeWorkbookPath(filePath);
      activeWorkbookRecoveredFromBackup = false;
    },
    getActiveWorkbookFile,
    getFileName,
    loadFileState,
    registerFileHandlers,
    saveFileState,
    writeWorkbookFile
  };
}

module.exports = {
  MAX_RECENT_WORKBOOKS,
  createWorkbookFileController
};
