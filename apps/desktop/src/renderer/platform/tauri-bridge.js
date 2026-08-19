import { getCavalryHostBroker, openExternalUrl } from './tauri-host-broker.js';
import { createTauriUpdateBridge } from './tauri-updates.js';

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
  const platformHint = String(
    globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || ''
  ).toLowerCase();
  const macUrls = [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
  ];
  const windowsUrls = ['ms-settings:privacy-microphone'];
  const candidates = platformHint.includes('win')
    ? [...windowsUrls, ...macUrls]
    : [...macUrls, ...windowsUrls];

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
  const updates = createTauriUpdateBridge();
  const broker = getCavalryHostBroker();
  broker.subscribe('cavalry-command', (command) => {
    if (command === 'check-for-updates') void updates.checkForUpdates();
  });

  return Object.freeze({
    files: {
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
      linkAppleIdentity: () => invoke('cavalry-cloud:link-apple'),
      signInWithApple: () => invoke('cavalry-cloud:sign-in-apple'),
      signInWithGoogle: () => invoke('cavalry-cloud:sign-in-google'),
      signOut: () => invoke('cavalry-cloud:sign-out'),
      updateProfile: (payload) => invoke('cavalry-cloud:update-profile', payload),
      listWorkbooks: () => invoke('cavalry-cloud:list-workbooks'),
      uploadWorkbook: (payload) => invoke('cavalry-cloud:upload-workbook', payload),
      downloadWorkbook: (payload) => invoke('cavalry-cloud:download-workbook', payload),
      deleteWorkbook: (payload) => invoke('cavalry-cloud:delete-workbook', payload),
      listFeedbackReports: (payload) => invoke('cavalry-cloud:list-feedback-reports', payload),
      submitFeedbackReport: (payload) => invoke('cavalry-cloud:submit-feedback-report', payload),
      getFeedbackAttachment: (payload) => invoke('cavalry-cloud:get-feedback-attachment', payload),
      onStateChanged: (callback) => subscribe('cavalry-cloud:state-changed', callback)
    },
    updates
  });
}
