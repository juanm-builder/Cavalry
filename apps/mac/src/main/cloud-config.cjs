// Validates the public Supabase values that may be compiled into Cavalry releases.
'use strict';

function asString(value, maximum = 512) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maximum);
}

function isPublishableSupabaseKey(value) {
  const key = asString(value, 2048);
  if (!key || /^sb_secret_/i.test(key) || /service[_-]?role/i.test(key)) return false;
  if (/^sb_publishable_[A-Za-z0-9._-]+$/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && payload.role === 'anon';
  } catch (_error) {
    return false;
  }
}

function normalizeCloudConfig(options = {}) {
  const publishableKey = asString(options.publishableKey, 2048);
  try {
    const url = new URL(asString(options.supabaseUrl, 2048));
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname && url.pathname !== '/') ||
      !isPublishableSupabaseKey(publishableKey)
    ) {
      throw new Error('invalid');
    }
    return { configured: true, origin: url.origin, url: url.origin, publishableKey };
  } catch (_error) {
    return { configured: false, origin: '', url: '', publishableKey: '' };
  }
}

module.exports = { asString, isPublishableSupabaseKey, normalizeCloudConfig };
