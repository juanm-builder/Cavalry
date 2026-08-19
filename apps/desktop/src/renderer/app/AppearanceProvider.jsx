import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  APPEARANCE_DENSITIES,
  APPEARANCE_THEMES,
  DEFAULT_CUSTOM_PALETTE,
  DEFAULT_APPEARANCE_PREFERENCES,
  getAppearanceTheme,
  normalizeAppearancePreferences,
  readAppearancePreferences,
  writeAppearancePreferences
} from './appearance-preferences.js';

const noop = () => {};
const DEFAULT_CONTEXT = Object.freeze({
  preferences: DEFAULT_APPEARANCE_PREFERENCES,
  themes: APPEARANCE_THEMES,
  densities: APPEARANCE_DENSITIES,
  setTheme: noop,
  setCustomPalette: noop,
  resetCustomPalette: noop,
  setDensity: noop,
  setNavigation: noop,
  toggleNavigation: noop
});

const AppearanceContext = createContext(DEFAULT_CONTEXT);

function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_error) {
    return null;
  }
}

export function AppearanceProvider({ children, storage }) {
  const resolvedStorage = typeof storage === 'undefined' ? browserStorage() : storage;
  const [preferences, setPreferences] = useState(() => readAppearancePreferences(resolvedStorage));

  const updatePreferences = useCallback((patch) => {
    setPreferences((current) =>
      normalizeAppearancePreferences({
        ...current,
        ...(typeof patch === 'function' ? patch(current) : patch)
      })
    );
  }, []);

  const setTheme = useCallback((theme) => updatePreferences({ theme }), [updatePreferences]);
  const setCustomPalette = useCallback(
    (patch) =>
      updatePreferences((current) => ({
        theme: 'custom',
        customPalette: {
          ...current.customPalette,
          ...(typeof patch === 'function' ? patch(current.customPalette) : patch)
        }
      })),
    [updatePreferences]
  );
  const resetCustomPalette = useCallback(
    () => updatePreferences({ theme: 'custom', customPalette: DEFAULT_CUSTOM_PALETTE }),
    [updatePreferences]
  );
  const setDensity = useCallback((density) => updatePreferences({ density }), [updatePreferences]);
  const setNavigation = useCallback(
    (navigation) => updatePreferences({ navigation }),
    [updatePreferences]
  );
  const toggleNavigation = useCallback(
    () =>
      updatePreferences((current) => ({
        navigation: current.navigation === 'compact' ? 'expanded' : 'compact'
      })),
    [updatePreferences]
  );

  useEffect(() => {
    writeAppearancePreferences(resolvedStorage, preferences);
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const theme = getAppearanceTheme(preferences.theme);
    const scheme = theme.id === 'custom' ? preferences.customPalette.scheme : theme.scheme;
    root.dataset.theme = theme.id;
    root.dataset.colorScheme = scheme;
    root.dataset.density = preferences.density;
    root.style.colorScheme = scheme;
    Object.entries(preferences.customPalette).forEach(([name, value]) => {
      if (name !== 'scheme') root.style.setProperty(`--custom-${name}`, value);
    });
  }, [preferences, resolvedStorage]);

  const themes = useMemo(
    () =>
      APPEARANCE_THEMES.map((theme) =>
        theme.id === 'custom'
          ? {
              ...theme,
              scheme: preferences.customPalette.scheme,
              swatches: [
                preferences.customPalette.background,
                preferences.customPalette.surface,
                preferences.customPalette.accent
              ]
            }
          : theme
      ),
    [preferences.customPalette]
  );

  const value = useMemo(
    () => ({
      preferences,
      themes,
      densities: APPEARANCE_DENSITIES,
      setTheme,
      setCustomPalette,
      resetCustomPalette,
      setDensity,
      setNavigation,
      toggleNavigation
    }),
    [
      preferences,
      resetCustomPalette,
      setCustomPalette,
      setDensity,
      setNavigation,
      setTheme,
      themes,
      toggleNavigation
    ]
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  return useContext(AppearanceContext);
}
