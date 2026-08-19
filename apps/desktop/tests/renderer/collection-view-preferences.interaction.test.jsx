import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AppRouter } from '../../src/renderer/app/AppRouter.jsx';
import { COLLECTION_VIEW_PREFERENCE_KEYS } from '../../src/renderer/shared/use-collection-view-preference.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

function routeElement(routeId, storage) {
  return (
    <AppRouter
      routeId={routeId}
      routeModels={{
        accounts: { summary: {}, accountRows: [], selectedAccount: null },
        categories: { currency: 'PHP', categoryRows: [], showHidden: false }
      }}
      routeProps={{
        accounts: { viewPreferenceStorage: storage },
        categories: { viewPreferenceStorage: storage }
      }}
    />
  );
}

describe('collection view preferences', () => {
  it('preserves independent Accounts and Categories selections across navigation', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const { rerender, unmount } = render(routeElement('accounts', storage));

    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    await user.click(screen.getByRole('button', { name: 'Grid view' }));

    rerender(routeElement('categories', storage));
    expect(screen.getByRole('button', { name: 'Grid view' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    await user.click(screen.getByRole('button', { name: 'List view' }));

    rerender(routeElement('accounts', storage));
    expect(screen.getByRole('button', { name: 'Grid view' }).getAttribute('aria-pressed')).toBe(
      'true'
    );

    rerender(routeElement('categories', storage));
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(storage.getItem(COLLECTION_VIEW_PREFERENCE_KEYS.accounts)).toBe('grid');
    expect(storage.getItem(COLLECTION_VIEW_PREFERENCE_KEYS.categories)).toBe('list');

    unmount();
    render(routeElement('accounts', storage));
    expect(screen.getByRole('button', { name: 'Grid view' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });
});
