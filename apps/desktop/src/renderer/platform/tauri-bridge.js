import { getCavalryHostBroker, openExternalUrl } from './tauri-host-broker.js';
import { createTauriUpdateBridge } from './tauri-updates.js';
import { createTauriLifecycleBridge } from './tauri-lifecycle.js';

const invoke = (channel, payload) => getCavalryHostBroker().invoke(channel, payload || {});
const subscribe = (channel, callback) => getCavalryHostBroker().subscribe(channel, callback);

function microphoneResult(status, options = {}) {
  const normalized = ['granted', 'denied', 'not-determined', 'unknown'].includes(status)
    ? status
    : 'unknown';
  return {
    ok: options.ok !== false,
    status: normalized,
    granted: normalized === 'granted',
    requestable: normalized !== 'denied',
    needsSystemSettings: normalized === 'denied',
    needsRestart: normalized === 'denied',
    message:
      options.message ||
      (normalized === 'granted'
        ? 'Microphone access is enabled.'
        : normalized === 'denied'
          ? 'Microphone access is denied. Enable Cavalry in system microphone settings.'
          : normalized === 'not-determined'
            ? 'Cavalry will request microphone access when voice input starts.'
            : 'Microphone permission status is unavailable.')
  };
}

async function getMicrophoneStatus() {
  try {
    if (!navigator.permissions?.query) return microphoneResult('unknown');
    const permission = await navigator.permissions.query({ name: 'microphone' });
    return microphoneResult(
      permission.state === 'prompt'
        ? 'not-determined'
        : permission.state === 'granted'
          ? 'granted'
          : 'denied'
    );
  } catch (_error) {
    return microphoneResult('unknown');
  }
}

async function requestMicrophoneAccess() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((track) => track.stop());
    return microphoneResult('granted');
  } catch (error) {
    return microphoneResult('denied', {
      ok: false,
      message: error && error.message ? error.message : 'Microphone access was not granted.'
    });
  }
}

async function openMicrophoneSettings() {
  const candidates = [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
  ];

  for (const url of candidates) {
    try {
      await openExternalUrl(url);
      return { ok: true, opened: true, url };
    } catch (_error) {
      // Try the next known operating-system settings URL.
    }
  }
  return {
    ok: false,
    opened: false,
    message:
      'Open your operating system microphone settings and allow Cavalry to use the microphone.'
  };
}

export function createTauriBridge() {
  const lifecycle = createTauriLifecycleBridge();
  const updates = createTauriUpdateBridge({ beforeExit: lifecycle.prepareToExit });
  const broker = getCavalryHostBroker();
  broker.subscribe('cavalry-command', (command) => {
    if (command === 'check-for-updates') void updates.checkForUpdates();
    if (command === 'reload-window') {
      void lifecycle
        .prepareToExit('reload')
        .then(() => globalThis.location.reload())
        .catch(() => {});
    }
  });

  return Object.freeze({
    files: {
      loadRecoveryWorkbook: () => invoke('cavalry-files:recovery-load'),
      saveRecoveryWorkbook: (payload) => invoke('cavalry-files:recovery-save', payload),
      clearRecoveryWorkbook: () => invoke('cavalry-files:recovery-clear'),
      getActiveWorkbookFile: () => invoke('cavalry-files:get-active'),
      listRecentWorkbooks: () => invoke('cavalry-files:list-recent'),
      openRecentWorkbook: (payload) => invoke('cavalry-files:open-recent', payload),
      openWorkbookFile: () => invoke('cavalry-files:open'),
      saveWorkbookAs: (payload) => invoke('cavalry-files:save-as', payload),
      saveActiveWorkbook: (payload) => invoke('cavalry-files:save-active', payload),
      forgetActiveWorkbookFile: () => invoke('cavalry-files:forget-active'),
      revealActiveWorkbookFile: () => invoke('cavalry-files:reveal-active'),
      onCommand: (callback) => subscribe('cavalry-command', callback)
    },
    companion: {
      publishWorkbook: (payload) => invoke('cavalry-companion:publish-workbook', payload),
      getStatus: () => invoke('cavalry-companion:get-status'),
      onWorkbookUpdated: (callback) => subscribe('cavalry-companion:workbook-updated', callback),
      onStatus: (callback) => subscribe('cavalry-companion:status', callback)
    },
    advisor: {
      getSettings: () => invoke('cavalry-advisor:get-settings'),
      saveSettings: (payload) => invoke('cavalry-advisor:save-settings', payload),
      getMemory: () => invoke('cavalry-advisor:get-memory'),
      refreshMemory: () => invoke('cavalry-advisor:refresh-memory'),
      saveMemory: (payload) => invoke('cavalry-advisor:save-memory', payload),
      clearMemory: (payload) => invoke('cavalry-advisor:clear-memory', payload),
      createMemoryItem: (payload) => invoke('cavalry-advisor:create-memory-item', payload),
      updateMemoryItem: (payload) => invoke('cavalry-advisor:update-memory-item', payload),
      deleteMemoryItem: (payload) => invoke('cavalry-advisor:delete-memory-item', payload),
      openMemoryFile: () => invoke('cavalry-advisor:open-memory-file'),
      openMemoryFolder: () => invoke('cavalry-advisor:open-memory-folder'),
      revealMemory: () => invoke('cavalry-advisor:reveal-memory'),
      getServerStatus: (payload) => invoke('cavalry-advisor:get-server-status', payload),
      startServer: (payload) => invoke('cavalry-advisor:start-server', payload),
      stopServer: (payload) => invoke('cavalry-advisor:stop-server', payload),
      chooseLocalModel: (payload) => invoke('cavalry-advisor:choose-local-model', payload),
      chooseMmproj: (payload) => invoke('cavalry-advisor:choose-mmproj', payload),
      testConnection: (payload) => invoke('cavalry-advisor:test', payload),
      chat: (payload) => invoke('cavalry-advisor:chat', payload),
      runAgentTurn: (payload) => invoke('cavalry-advisor:agent', payload),
      getMicrophoneStatus,
      requestMicrophoneAccess,
      openMicrophoneSettings,
      transcribeAudio: (payload) => invoke('cavalry-advisor:transcribe-audio', payload),
      cancel: (payload) => invoke('cavalry-advisor:cancel', payload),
      onStatus: (callback) => subscribe('cavalry-advisor:status', callback)
    },
    cloud: {
      getState: () => invoke('cavalry-cloud:get-state'),
      setConnection: (payload) => invoke('cavalry-cloud:set-connection', payload),
      selectAccount: (payload) => invoke('cavalry-cloud:select-account', payload),
      signOut: () => invoke('cavalry-cloud:sign-out'),
      cancelAccountSignIn: () => invoke('cavalry-cloud:cancel-account-sign-in'),
      listWorkbooks: () => invoke('cavalry-cloud:list-workbooks'),
      uploadWorkbook: (payload) => invoke('cavalry-cloud:upload-workbook', payload),
      downloadWorkbook: (payload) => invoke('cavalry-cloud:download-workbook', payload),
      downloadConflictPackage: (payload) =>
        invoke('cavalry-cloud:download-conflict-package', payload),
      deleteWorkbook: (payload) => invoke('cavalry-cloud:delete-workbook', payload),
      publishConflictNotice: (payload) => invoke('cavalry-cloud:publish-conflict-notice', payload),
      clearConflictNotice: (payload) => invoke('cavalry-cloud:clear-conflict-notice', payload),
      loadSyncState: (payload) => invoke('cavalry-cloud:load-sync-state', payload),
      saveSyncState: (payload) => invoke('cavalry-cloud:save-sync-state', payload),
      removeSyncState: (payload) => invoke('cavalry-cloud:remove-sync-state', payload),
      onStateChanged: (callback) => subscribe('cavalry-cloud:state-changed', callback)
    },
    updates,
    lifecycle
  });
}
