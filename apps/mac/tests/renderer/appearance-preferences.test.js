import { describe, expect, it, vi } from 'vitest';

import {
  APPEARANCE_STORAGE_KEY,
  APPEARANCE_THEMES,
  DEFAULT_CUSTOM_PALETTE,
  DEFAULT_APPEARANCE_PREFERENCES,
  getAppearanceTheme,
  normalizeCustomPalette,
  normalizeAppearancePreferences,
  readAppearancePreferences,
  writeAppearancePreferences
} from '../../src/renderer/app/appearance-preferences.js';

describe('appearance preferences', () => {
  it('normalizes persisted values against the supported design system', () => {
    expect(
      normalizeAppearancePreferences({
        theme: 'cloud',
        density: 'compact',
        navigation: 'compact'
      })
    ).toEqual({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      theme: 'white',
      density: 'compact',
      navigation: 'compact'
    });

    expect(
      normalizeAppearancePreferences({
        theme: 'unknown',
        density: 'tiny',
        navigation: 'hidden'
      })
    ).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
    expect(APPEARANCE_THEMES.map(({ id }) => id)).toEqual(['dark', 'white', 'parchment', 'custom']);
    expect(getAppearanceTheme('white')).toMatchObject({ id: 'white', scheme: 'light' });
  });

  it('normalizes custom colors and rejects unsafe persisted values', () => {
    expect(
      normalizeCustomPalette({
        scheme: 'light',
        background: '#ABCDEF',
        surface: 'red',
        accent: '#12345'
      })
    ).toEqual({
      ...DEFAULT_CUSTOM_PALETTE,
      scheme: 'light',
      background: '#abcdef'
    });
  });

  it('recovers safely from corrupt or unavailable storage', () => {
    expect(
      readAppearancePreferences({
        getItem: () => '{not-json'
      })
    ).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
    expect(
      readAppearancePreferences({
        getItem() {
          throw new Error('Storage blocked');
        }
      })
    ).toEqual(DEFAULT_APPEARANCE_PREFERENCES);

    const setItem = vi.fn(() => {
      throw new Error('Quota exceeded');
    });
    expect(writeAppearancePreferences({ setItem }, { theme: 'midnight' })).toEqual({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      theme: 'dark'
    });
    expect(setItem).toHaveBeenCalledWith(APPEARANCE_STORAGE_KEY, expect.any(String));
  });
});
