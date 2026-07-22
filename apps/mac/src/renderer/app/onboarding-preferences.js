export const ONBOARDING_STORAGE_KEY = 'cavalry.onboarding.v1';

export const WELCOME_STATES = Object.freeze({
  PENDING: 'pending',
  SEEN: 'seen'
});

// The guided tour is intentionally not persisted here: it opens on every
// workbook creation (session state in AppShell), not once per machine.
export const DEFAULT_ONBOARDING_STATE = Object.freeze({
  welcome: WELCOME_STATES.PENDING,
  checklistDismissed: false
});

const WELCOME_IDS = new Set(Object.values(WELCOME_STATES));

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeOnboardingState(value) {
  const source = asObject(value);
  return {
    welcome: WELCOME_IDS.has(source.welcome) ? source.welcome : DEFAULT_ONBOARDING_STATE.welcome,
    checklistDismissed: source.checklistDismissed === true
  };
}

export function readOnboardingState(storage) {
  if (!(storage && typeof storage.getItem === 'function')) {
    return normalizeOnboardingState(DEFAULT_ONBOARDING_STATE);
  }
  try {
    const stored = storage.getItem(ONBOARDING_STORAGE_KEY);
    return stored
      ? normalizeOnboardingState(JSON.parse(stored))
      : normalizeOnboardingState(DEFAULT_ONBOARDING_STATE);
  } catch (_error) {
    return normalizeOnboardingState(DEFAULT_ONBOARDING_STATE);
  }
}

export function writeOnboardingState(storage, state) {
  const normalized = normalizeOnboardingState(state);
  if (!(storage && typeof storage.setItem === 'function')) return normalized;
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(normalized));
  } catch (_error) {
    // Onboarding is an enhancement; blocked storage must never prevent the app from loading.
  }
  return normalized;
}
