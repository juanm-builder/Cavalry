import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch (_error) {
    // Tests that deliberately replace or block storage still need DOM cleanup.
  }
});
