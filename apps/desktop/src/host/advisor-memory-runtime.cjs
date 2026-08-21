// Owns host-side Companion memory persistence, file controls, and request context projection.
'use strict';

const {
  ADVISOR_MEMORY_FILE_NAME,
  createAdvisorMemoryStorage,
  withAdvisorMemoryContext
} = require('./advisor-memory-storage.cjs');

function createAdvisorMemoryRuntime({ app, fs, path, shell } = {}) {
  function getAdvisorMemoryPath() {
    return path.join(app.getPath('userData'), ADVISOR_MEMORY_FILE_NAME);
  }

  const storage = createAdvisorMemoryStorage({
    fs,
    path,
    getMemoryPath: getAdvisorMemoryPath
  });

  async function loadAdvisorMemory() {
    return storage.load();
  }

  async function refreshAdvisorMemory() {
    return storage.refresh();
  }

  async function saveAdvisorMemory(payload) {
    return storage.save(payload || {});
  }

  async function clearAdvisorMemory(payload) {
    return storage.clear(payload || {});
  }

  async function createAdvisorMemoryItem(payload) {
    return storage.createItem(payload || {});
  }

  async function updateAdvisorMemoryItem(payload) {
    return storage.updateItem(payload || {});
  }

  async function deleteAdvisorMemoryItem(payload) {
    return storage.deleteItem(payload || {});
  }

  async function memoryFileForOpen() {
    const filePath = storage.getPath();
    if (typeof fs.access === 'function') {
      try {
        await fs.access(filePath);
      } catch (error) {
        if (!(error && error.code === 'ENOENT')) throw error;
        await loadAdvisorMemory();
      }
    } else {
      await loadAdvisorMemory();
    }
    return {
      path: filePath,
      folderPath: path.dirname(filePath),
      fileName: path.basename(filePath)
    };
  }

  async function openAdvisorMemoryFile() {
    const memory = await memoryFileForOpen();
    if (!(shell && typeof shell.openPath === 'function')) {
      throw new Error('Cavalry cannot open memory.md on this system.');
    }
    const failure = await shell.openPath(memory.path);
    if (failure) throw new Error(String(failure));
    return memory;
  }

  async function openAdvisorMemoryFolder() {
    const memory = await memoryFileForOpen();
    if (!(shell && typeof shell.showItemInFolder === 'function')) {
      throw new Error('Cavalry cannot open the memory.md folder on this system.');
    }
    shell.showItemInFolder(memory.path);
    return memory;
  }

  async function revealAdvisorMemory() {
    return openAdvisorMemoryFolder();
  }

  async function addAdvisorMemoryContext(payload, format) {
    const source = payload || {};
    const provider = String(
      source && source.connection && source.connection.provider ? source.connection.provider : ''
    ).toLowerCase();
    if (!['openai', 'custom'].includes(provider)) return source;
    try {
      const memory = await loadAdvisorMemory();
      return withAdvisorMemoryContext(source, memory, format);
    } catch (_error) {
      // Optional memory must not prevent a request when its local file cannot be read safely.
      // Still pass through the normal network projection so host-only relevance metadata can
      // never escape to a provider on the memory failure path.
      return withAdvisorMemoryContext(source, { memoryEnabled: false }, format);
    }
  }

  return Object.freeze({
    addAdvisorMemoryContext,
    clearAdvisorMemory,
    createAdvisorMemoryItem,
    deleteAdvisorMemoryItem,
    loadAdvisorMemory,
    openAdvisorMemoryFile,
    openAdvisorMemoryFolder,
    refreshAdvisorMemory,
    revealAdvisorMemory,
    saveAdvisorMemory,
    updateAdvisorMemoryItem
  });
}

module.exports = { createAdvisorMemoryRuntime };
