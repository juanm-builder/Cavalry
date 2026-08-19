import { describe, expect, it } from 'vitest';

import { localDateKey } from '../../src/renderer/platform/ports.js';

describe('renderer clock dates', () => {
  it('formats the calendar date in the runtime timezone instead of truncating UTC', () => {
    const date = new Date(2026, 6, 16, 0, 30, 0);

    expect(localDateKey(date)).toBe('2026-07-16');
  });

  it('rejects invalid clock values', () => {
    expect(localDateKey('not-a-date')).toBe('');
  });
});
