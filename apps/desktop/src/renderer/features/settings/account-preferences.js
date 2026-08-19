export const ACCOUNT_STORAGE_KEY = 'cavalry.account.v1';

// This local profile is the unconfigured/offline fallback. Hosted identity is
// projected from Google by the main-process cloud controller when available.
export const DEFAULT_ACCOUNT_PROFILE = Object.freeze({
  name: '',
  email: ''
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asTrimmedString(value, maxLength) {
  return String(value == null ? '' : value)
    .trim()
    .slice(0, maxLength);
}

export function normalizeAccountProfile(value) {
  const source = asObject(value);
  return {
    name: asTrimmedString(source.name, 80),
    email: asTrimmedString(source.email, 120)
  };
}

export function readAccountProfile(storage) {
  if (!(storage && typeof storage.getItem === 'function')) {
    return normalizeAccountProfile(DEFAULT_ACCOUNT_PROFILE);
  }
  try {
    const stored = storage.getItem(ACCOUNT_STORAGE_KEY);
    return stored
      ? normalizeAccountProfile(JSON.parse(stored))
      : normalizeAccountProfile(DEFAULT_ACCOUNT_PROFILE);
  } catch (_error) {
    return normalizeAccountProfile(DEFAULT_ACCOUNT_PROFILE);
  }
}

export function writeAccountProfile(storage, profile) {
  const normalized = normalizeAccountProfile(profile);
  if (!(storage && typeof storage.setItem === 'function')) return normalized;
  try {
    storage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(normalized));
  } catch (_error) {
    // The profile is an enhancement; blocked storage must never break Settings.
  }
  return normalized;
}
