// Tests that the renderer-safe projection remains browser compatible.
// Keeps the renderer-facing projection clear of Node-only dependencies.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('draft review projection renderer import safety', () => {
  it('imports the projection entrypoint without the Node-only draft model chain', async () => {
    const module =
      await import('@cavalry/action-review/application/drafts/draft-review-projection.js');
    const source = readFileSync(
      fileURLToPath(
        new URL('../../src/application/drafts/draft-review-projection.js', import.meta.url)
      ),
      'utf8'
    );

    expect(module).toHaveProperty('buildDraftGroupReviewProjection');
    expect(module).toHaveProperty('summarizeDraftGroupForReview');
    expect(source).not.toContain('node:');
    expect(source).not.toContain('draft-group-model');
    expect(source).not.toContain('draft-group-service');
    expect(source).not.toContain('draft-conflict-service');
    expect(source).not.toContain('ipcRenderer');
    expect(source).not.toContain('window.');
    expect(source).not.toContain('document.');
  });
});
