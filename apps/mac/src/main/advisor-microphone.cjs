// Keeps permission status copy and window media checks separate from IPC registration.

'use strict';

function buildAdvisorMicrophoneAccessStatus(status, options = {}) {
  const platform = options.platform || process.platform;
  const normalizedStatus = [
    'not-determined',
    'granted',
    'denied',
    'restricted',
    'unknown'
  ].includes(status)
    ? status
    : 'unknown';
  const granted = normalizedStatus === 'granted';
  const needsSystemSettings =
    platform === 'darwin' && (normalizedStatus === 'denied' || normalizedStatus === 'restricted');
  const messages = {
    granted: 'Microphone access is enabled.',
    'not-determined': 'Cavalry will ask macOS for microphone access when you start voice input.',
    denied:
      'Microphone access is denied. Enable Cavalry for Mac in System Settings > Privacy & Security > Microphone, then quit and reopen Cavalry.',
    restricted:
      'Microphone access is restricted by macOS. Check System Settings, Screen Time, or device management, then quit and reopen Cavalry.',
    unknown: 'Microphone permission status is unavailable.'
  };
  return {
    ok: options.ok !== false,
    status: normalizedStatus,
    granted,
    requestable: platform !== 'darwin' || normalizedStatus === 'not-determined' || granted,
    needsSystemSettings,
    needsRestart: needsSystemSettings,
    message: options.message || messages[normalizedStatus] || messages.unknown
  };
}

function getAdvisorMicrophoneAccessStatus(mediaPreferences, platformName) {
  const preferences = mediaPreferences || null;
  const platform = platformName || process.platform;
  if (platform !== 'darwin') {
    return buildAdvisorMicrophoneAccessStatus('granted', {
      platform,
      message: 'Microphone access is available.'
    });
  }
  if (!(preferences && typeof preferences.getMediaAccessStatus === 'function')) {
    return Object.assign(
      buildAdvisorMicrophoneAccessStatus('unknown', {
        ok: false,
        platform,
        message: 'Microphone permissions are unavailable in this runtime.'
      }),
      {
        error: 'Microphone permissions are unavailable in this runtime.'
      }
    );
  }
  const status = preferences.getMediaAccessStatus('microphone');
  return buildAdvisorMicrophoneAccessStatus(status, { platform });
}

async function requestAdvisorMicrophoneAccess(mediaPreferences, platformName) {
  const preferences = mediaPreferences || null;
  const platform = platformName || process.platform;
  if (platform !== 'darwin') {
    return getAdvisorMicrophoneAccessStatus(preferences, platform);
  }
  const current = getAdvisorMicrophoneAccessStatus(preferences, platform);
  if (!current.ok || current.granted || current.status !== 'not-determined') {
    return current;
  }
  if (!(preferences && typeof preferences.askForMediaAccess === 'function')) {
    return Object.assign({}, current, {
      ok: false,
      error: 'Microphone access cannot be requested from this runtime.'
    });
  }
  const granted = await preferences.askForMediaAccess('microphone');
  const next = getAdvisorMicrophoneAccessStatus(preferences, platform);
  return Object.assign({}, next, {
    granted: !!granted || next.granted
  });
}

async function openAdvisorMicrophoneSettings(shellModule, platformName) {
  const opener = shellModule || null;
  const platform = platformName || process.platform;
  if (platform !== 'darwin') {
    return {
      ok: false,
      opened: false,
      message:
        'Open your operating system microphone settings and allow Cavalry to use the microphone.'
    };
  }
  if (!(opener && typeof opener.openExternal === 'function')) {
    return {
      ok: false,
      opened: false,
      error: 'System Settings cannot be opened from this runtime.',
      message:
        'Open System Settings > Privacy & Security > Microphone, enable Cavalry for Mac, then quit and reopen Cavalry.'
    };
  }
  const urls = [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    'x-apple.systempreferences:com.apple.preference.security'
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      await opener.openExternal(url);
      return {
        ok: true,
        opened: true,
        url,
        message: 'Enable Cavalry for Mac in Microphone settings, then quit and reopen Cavalry.'
      };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    ok: false,
    opened: false,
    error: lastError && lastError.message ? lastError.message : 'Unable to open System Settings.',
    message:
      'Open System Settings > Privacy & Security > Microphone, enable Cavalry for Mac, then quit and reopen Cavalry.'
  };
}

function getAdvisorMediaPermissionTypes(details) {
  if (details && Array.isArray(details.mediaTypes)) {
    return details.mediaTypes.map((type) => String(type || '').toLowerCase()).filter(Boolean);
  }
  if (details && details.mediaType) {
    return [String(details.mediaType).toLowerCase()].filter(Boolean);
  }
  return [];
}

function isAdvisorAudioOnlyMediaPermission(details) {
  const mediaTypes = getAdvisorMediaPermissionTypes(details);
  return (
    mediaTypes.length > 0 &&
    mediaTypes.includes('audio') &&
    !mediaTypes.includes('video') &&
    !mediaTypes.includes('unknown')
  );
}

function isAdvisorWindowFileUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    return (
      parsed.protocol === 'file:' &&
      /\/index\.html$/i.test(decodeURIComponent(parsed.pathname || ''))
    );
  } catch (_error) {
    return false;
  }
}

function isAdvisorDevelopmentWindowUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    return (
      parsed.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(parsed.hostname) &&
      parsed.port === '5173'
    );
  } catch (_error) {
    return false;
  }
}

function isSameAdvisorDevelopmentOrigin(leftUrl, rightUrl) {
  if (!isAdvisorDevelopmentWindowUrl(leftUrl) || !isAdvisorDevelopmentWindowUrl(rightUrl)) {
    return false;
  }
  try {
    return new URL(String(leftUrl)).origin === new URL(String(rightUrl)).origin;
  } catch (_error) {
    return false;
  }
}

function isAdvisorMainWindowWebContents(webContents, appWebContents) {
  if (!webContents || !appWebContents || webContents !== appWebContents) {
    return false;
  }
  if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
    return false;
  }
  const currentUrl = typeof webContents.getURL === 'function' ? webContents.getURL() : '';
  return isAdvisorWindowFileUrl(currentUrl) || isAdvisorDevelopmentWindowUrl(currentUrl);
}

function shouldGrantAdvisorMediaPermission(
  webContents,
  permission,
  requestingOrigin,
  details,
  appWebContents
) {
  if (permission !== 'media') {
    return false;
  }
  if (!isAdvisorAudioOnlyMediaPermission(details)) {
    return false;
  }
  if (!isAdvisorMainWindowWebContents(webContents, appWebContents)) {
    return false;
  }
  const requestUrl =
    (details && (details.requestingUrl || details.securityOrigin)) || requestingOrigin || '';
  if (!requestUrl || requestUrl === 'file://' || isAdvisorWindowFileUrl(requestUrl)) {
    return isAdvisorWindowFileUrl(
      typeof webContents.getURL === 'function' ? webContents.getURL() : ''
    );
  }
  const currentUrl = typeof webContents.getURL === 'function' ? webContents.getURL() : '';
  return isSameAdvisorDevelopmentOrigin(currentUrl, requestUrl);
}

function installAdvisorMediaPermissionHandlers(win) {
  const appWebContents = win && win.webContents;
  const ses = appWebContents && appWebContents.session;
  if (!(
    ses &&
    typeof ses.setPermissionRequestHandler === 'function' &&
    typeof ses.setPermissionCheckHandler === 'function'
  )) {
    return false;
  }
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      shouldGrantAdvisorMediaPermission(webContents, permission, '', details || {}, appWebContents)
    );
  });
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return shouldGrantAdvisorMediaPermission(
      webContents,
      permission,
      requestingOrigin,
      details || {},
      appWebContents
    );
  });
  return true;
}

module.exports = {
  buildAdvisorMicrophoneAccessStatus,
  getAdvisorMediaPermissionTypes,
  getAdvisorMicrophoneAccessStatus,
  installAdvisorMediaPermissionHandlers,
  isAdvisorAudioOnlyMediaPermission,
  isAdvisorDevelopmentWindowUrl,
  isAdvisorMainWindowWebContents,
  isAdvisorWindowFileUrl,
  openAdvisorMicrophoneSettings,
  requestAdvisorMicrophoneAccess,
  shouldGrantAdvisorMediaPermission
};
