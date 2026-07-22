import { describe, expect, it } from 'vitest';

import { getTrackedGeneratedFiles } from '../../tools/repo/architecture-report.mjs';

describe('generated artifacts', () => {
  it('keeps generated and private runtime output untracked', () => {
    expect(getTrackedGeneratedFiles()).toEqual([]);
  });
});
