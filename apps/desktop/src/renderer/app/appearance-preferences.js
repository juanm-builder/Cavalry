export const APPEARANCE_STORAGE_KEY = 'cavalry.appearance.v1';

export const DEFAULT_CUSTOM_PALETTE = Object.freeze({
  scheme: 'dark',
  background: '#101114',
  surface: '#1b1d22',
  text: '#f5f6f8',
  textSoft: '#aeb3bd',
  accent: '#7c9cff',
  good: '#55c995',
  warn: '#e1ac54',
  bad: '#e47777'
});

export const CUSTOM_COLOR_FIELDS = Object.freeze([
  Object.freeze({ id: 'background', label: 'Background' }),
  Object.freeze({ id: 'surface', label: 'Cards & panels' }),
  Object.freeze({ id: 'text', label: 'Primary text' }),
  Object.freeze({ id: 'textSoft', label: 'Secondary text' }),
  Object.freeze({ id: 'accent', label: 'Accent' }),
  Object.freeze({ id: 'good', label: 'Positive' }),
  Object.freeze({ id: 'warn', label: 'Caution' }),
  Object.freeze({ id: 'bad', label: 'Negative' })
]);

export const APPEARANCE_THEMES = Object.freeze([
  Object.freeze({
    id: 'cerulean',
    label: 'Cerulean',
    description: 'Bright blue, warm paper, and crisp ink',
    scheme: 'light',
    swatches: Object.freeze(['#1a3fe9', '#499eee', '#fef7d7'])
  }),
  Object.freeze({
    id: 'dark',
    label: 'Dark',
    description: 'Neutral charcoal and soft white',
    scheme: 'dark',
    swatches: Object.freeze(['#0d0e10', '#202227', '#f4f5f7'])
  }),
  Object.freeze({
    id: 'white',
    label: 'White',
    description: 'Clean white and crisp graphite',
    scheme: 'light',
    swatches: Object.freeze(['#f4f5f7', '#ffffff', '#20242b'])
  }),
  Object.freeze({
    id: 'parchment',
    label: 'Parchment',
    description: 'Warm paper and sage',
    scheme: 'light',
    swatches: Object.freeze(['#f3eee4', '#fffdf8', '#347b62'])
  }),
  Object.freeze({
    id: 'custom',
    label: 'Custom',
    description: 'Your own colors, saved on this Mac',
    scheme: 'dark',
    swatches: Object.freeze([
      DEFAULT_CUSTOM_PALETTE.background,
      DEFAULT_CUSTOM_PALETTE.surface,
      DEFAULT_CUSTOM_PALETTE.accent
    ])
  })
]);

export const APPEARANCE_DENSITIES = Object.freeze([
  Object.freeze({ id: 'comfortable', label: 'Comfortable' }),
  Object.freeze({ id: 'compact', label: 'Compact' })
]);

export const DEFAULT_APPEARANCE_PREFERENCES = Object.freeze({
  theme: 'cerulean',
  density: 'comfortable',
  navigation: 'expanded',
  customPalette: DEFAULT_CUSTOM_PALETTE
});

const THEME_IDS = new Set(APPEARANCE_THEMES.map((theme) => theme.id));
const DENSITY_IDS = new Set(APPEARANCE_DENSITIES.map((density) => density.id));
const NAVIGATION_MODES = new Set(['expanded', 'compact']);
const COLOR_SCHEMES = new Set(['dark', 'light']);
const LEGACY_THEME_MIGRATIONS = Object.freeze({
  evergreen: 'dark',
  midnight: 'dark',
  aubergine: 'dark',
  ember: 'dark',
  cloud: 'white'
});
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeColor(value, fallback) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

export function normalizeCustomPalette(value) {
  const source = asObject(value);
  return {
    scheme: COLOR_SCHEMES.has(source.scheme) ? source.scheme : DEFAULT_CUSTOM_PALETTE.scheme,
    ...Object.fromEntries(
      CUSTOM_COLOR_FIELDS.map(({ id }) => [
        id,
        normalizeColor(source[id], DEFAULT_CUSTOM_PALETTE[id])
      ])
    )
  };
}

export function getAppearanceTheme(themeId) {
  return (
    APPEARANCE_THEMES.find((theme) => theme.id === themeId) ||
    APPEARANCE_THEMES.find((theme) => theme.id === DEFAULT_APPEARANCE_PREFERENCES.theme)
  );
}

export function normalizeAppearancePreferences(value) {
  const source = asObject(value);
  const migratedTheme = LEGACY_THEME_MIGRATIONS[source.theme] || source.theme;
  return {
    theme: THEME_IDS.has(migratedTheme) ? migratedTheme : DEFAULT_APPEARANCE_PREFERENCES.theme,
    density: DENSITY_IDS.has(source.density)
      ? source.density
      : DEFAULT_APPEARANCE_PREFERENCES.density,
    navigation: NAVIGATION_MODES.has(source.navigation)
      ? source.navigation
      : DEFAULT_APPEARANCE_PREFERENCES.navigation,
    customPalette: normalizeCustomPalette(source.customPalette)
  };
}

export function readAppearancePreferences(storage) {
  if (!(storage && typeof storage.getItem === 'function')) {
    return normalizeAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  }
  try {
    const stored = storage.getItem(APPEARANCE_STORAGE_KEY);
    return stored
      ? normalizeAppearancePreferences(JSON.parse(stored))
      : normalizeAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  } catch (_error) {
    return normalizeAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  }
}

export function writeAppearancePreferences(storage, preferences) {
  const normalized = normalizeAppearancePreferences(preferences);
  if (!(storage && typeof storage.setItem === 'function')) return normalized;
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
  } catch (_error) {
    // Appearance is an enhancement; blocked storage must never prevent the app from loading.
  }
  return normalized;
}
