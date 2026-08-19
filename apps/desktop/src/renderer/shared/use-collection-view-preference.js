import { useCallback, useState } from 'react';

const VIEW_MODES = new Set(['grid', 'list']);

export const COLLECTION_VIEW_PREFERENCE_KEYS = Object.freeze({
  accounts: 'cavalry.view.accounts.v1',
  categories: 'cavalry.view.categories.v1'
});

const COLLECTION_VIEW_DEFAULTS = Object.freeze({
  accounts: 'list',
  categories: 'grid'
});

function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_error) {
    return null;
  }
}

function normalizeView(value, fallback) {
  return VIEW_MODES.has(value) ? value : fallback;
}

export function readCollectionViewPreference(storage, key, fallback) {
  if (!(storage && typeof storage.getItem === 'function')) return fallback;
  try {
    return normalizeView(storage.getItem(key), fallback);
  } catch (_error) {
    return fallback;
  }
}

export function writeCollectionViewPreference(storage, key, view, fallback) {
  const normalized = normalizeView(view, fallback);
  if (!(storage && typeof storage.setItem === 'function')) return normalized;
  try {
    storage.setItem(key, normalized);
  } catch (_error) {
    // View preferences are best-effort; blocked storage must not affect navigation.
  }
  return normalized;
}

export function useCollectionViewPreference(collection, preferredStorage) {
  const storage = typeof preferredStorage === 'undefined' ? browserStorage() : preferredStorage;
  const key = COLLECTION_VIEW_PREFERENCE_KEYS[collection];
  const defaultView = COLLECTION_VIEW_DEFAULTS[collection] || 'list';
  const [view, setViewState] = useState(() =>
    readCollectionViewPreference(storage, key, defaultView)
  );
  const setView = useCallback(
    (nextView) => {
      const normalized = writeCollectionViewPreference(storage, key, nextView, defaultView);
      setViewState(normalized);
    },
    [defaultView, key, storage]
  );

  return [view, setView];
}
