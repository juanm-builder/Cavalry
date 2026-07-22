export const CAVALRY_SYNC_FOUNDATION_VERSION = 'cavalry.sync.foundation.v1';

export const SYNC_ENTITY_TYPES = Object.freeze([
  'workbook',
  'transaction',
  'account',
  'category',
  'draft_group',
  'audit_event'
]);

export const SYNC_OPERATION_TYPES = Object.freeze(['snapshot', 'upsert', 'delete']);

export const CAVALRY_SYNC_DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  mode: 'local_only',
  adapter: 'none',
  allowNetwork: false,
  requireSecrets: false,
  productionCloudReady: false
});

export function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key]))
      .join(',') +
    '}'
  );
}

export function hashValue(value) {
  const source = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 'fnv1a32_' + (hash >>> 0).toString(16).padStart(8, '0');
}

function hasConfiguredSecret(source) {
  return !!asString(
    source.apiKey ||
      source.api_key ||
      source.secret ||
      source.token ||
      source.accessToken ||
      source.refreshToken ||
      source.apiKeyConfigured
  );
}

export function normalizeSyncSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const requestedMode =
    asString(
      source.mode || source.syncMode || (source.enabled === true ? 'local_mock' : 'local_only')
    ) || 'local_only';
  const wantsProductionCloud = ['cloud', 'production_cloud', 'remote'].includes(requestedMode);
  const mode = requestedMode === 'local_mock' ? 'local_mock' : 'local_only';
  return {
    enabled: source.enabled === true && mode === 'local_mock',
    mode,
    requestedMode,
    adapter: mode === 'local_mock' ? 'local_mock' : 'none',
    allowNetwork: false,
    requireSecrets: false,
    productionCloudReady: false,
    blockedReason: wantsProductionCloud ? 'production_cloud_not_implemented' : '',
    userId: asString(source.userId || source.user_id),
    workbookId: asString(source.workbookId || source.workbook_id),
    apiKeyConfigured: hasConfiguredSecret(source)
  };
}

export function getRendererSafeSyncSettings(settings = {}) {
  const normalized = normalizeSyncSettings(settings);
  return {
    enabled: normalized.enabled,
    mode: normalized.mode,
    requestedMode: normalized.requestedMode,
    adapter: normalized.adapter,
    allowNetwork: false,
    requireSecrets: false,
    productionCloudReady: false,
    blockedReason: normalized.blockedReason,
    userId: normalized.userId,
    workbookId: normalized.workbookId,
    apiKeyConfigured: normalized.apiKeyConfigured
  };
}

export function createSyncDeviceMetadata(input = {}) {
  return {
    deviceId: asString(input.deviceId || input.device_id || 'local_device'),
    deviceName: asString(input.deviceName || input.device_name || 'Local device'),
    platform: asString(input.platform || 'mac'),
    appVersion: asString(input.appVersion || input.app_version || ''),
    lastSeenAt: asString(input.lastSeenAt || input.last_seen_at || '')
  };
}

export function createSyncIssue(code, message, detail = {}) {
  return Object.assign(
    {
      code: asString(code),
      severity: detail.severity || 'blocked',
      message: asString(message)
    },
    detail
  );
}

export function createSyncEnvelope(data, options = {}) {
  return {
    syncFoundationVersion: CAVALRY_SYNC_FOUNDATION_VERSION,
    ok: options.ok !== false,
    status: asString(options.status || 'ok'),
    network: false,
    data,
    issues: asArray(options.issues)
  };
}
