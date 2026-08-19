/* Apply the saved appearance before the stylesheet paints. React's provider
   remains authoritative and normalizes the same values after startup. */
(() => {
  const root = document.documentElement;
  const defaults = {
    theme: 'cerulean',
    density: 'comfortable',
    customPalette: {
      scheme: 'dark',
      background: '#101114',
      surface: '#1b1d22',
      text: '#f5f6f8',
      textSoft: '#aeb3bd',
      accent: '#7c9cff',
      good: '#55c995',
      warn: '#e1ac54',
      bad: '#e47777'
    }
  };
  const themes = new Set(['cerulean', 'dark', 'white', 'parchment', 'custom']);
  const legacyThemes = {
    evergreen: 'dark',
    midnight: 'dark',
    aubergine: 'dark',
    ember: 'dark',
    cloud: 'white'
  };
  const schemes = new Set(['dark', 'light']);
  const hexColor = /^#[0-9a-f]{6}$/i;

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('cavalry.appearance.v1') || '{}') || {};
  } catch (_error) {
    saved = {};
  }

  const requestedTheme = legacyThemes[saved.theme] || saved.theme;
  const theme = themes.has(requestedTheme) ? requestedTheme : defaults.theme;
  const density = ['comfortable', 'compact'].includes(saved.density)
    ? saved.density
    : defaults.density;
  const savedPalette =
    saved.customPalette && typeof saved.customPalette === 'object' ? saved.customPalette : {};
  const scheme =
    theme === 'custom' && schemes.has(savedPalette.scheme)
      ? savedPalette.scheme
      : theme === 'dark'
        ? 'dark'
        : 'light';

  root.dataset.theme = theme;
  root.dataset.colorScheme = scheme;
  root.dataset.density = density;
  root.style.colorScheme = scheme;

  Object.entries(defaults.customPalette).forEach(([name, fallback]) => {
    if (name === 'scheme') return;
    const value = hexColor.test(savedPalette[name] || '') ? savedPalette[name] : fallback;
    root.style.setProperty(`--custom-${name}`, value.toLowerCase());
  });
})();
