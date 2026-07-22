// Tests for draft source metadata projections.
// Locks browser-safe source display data without importing renderer, Advisor, API, or checkpoint workflows.

import { describe, expect, it } from 'vitest';

import {
  buildDraftSourceMetadataViewModel,
  buildExternalDraftOriginLabel,
  buildExternalDraftSourceLabel,
  buildExternalDraftSourceMetadataViewModel,
  countExternalDraftDuplicateWarnings
} from '@cavalry/action-review/application/drafts/draft-source-metadata-view-model-service.js';

function makeExternalDraft(overrides = {}) {
  return Object.assign(
    {
      id: 'draft-external',
      createdAt: '2026-07-02T10:00:00.000Z',
      source: {
        type: 'external_api',
        externalDraftGroupId: 'source-group'
      }
    },
    overrides
  );
}

function makeExternalGroup(overrides = {}) {
  return Object.assign(
    {
      draft_group_id: 'group-1',
      created_at: '2026-07-03T10:00:00.000Z',
      origin: {
        origin: 'chatgpt_action',
        provider: 'chatgpt',
        idempotencyKey: 'idem-1'
      },
      summary: {
        ready: 2,
        needs_review: 1,
        blocked: 3
      },
      drafts: [
        {
          validation_issues: [
            { code: 'possible_duplicate' },
            { code: 'duplicate_candidate' },
            { code: 'missing_required_field' }
          ]
        }
      ]
    },
    overrides
  );
}

describe('draft source metadata view-model service', () => {
  it('keeps hidden and malformed source metadata display fallbacks stable without mutating input', () => {
    const draft = {
      id: 'draft-hidden',
      createdAt: '2026-07-02T10:00:00.000Z',
      source: { type: 'unknown', provider: 'openai', model: 'gpt-test' }
    };
    const group = makeExternalGroup();
    const before = JSON.stringify({ draft, group });

    expect(buildExternalDraftSourceMetadataViewModel({}, group)).toEqual({
      visible: false,
      rows: []
    });
    expect(buildExternalDraftSourceMetadataViewModel({ source: null }, group)).toEqual({
      visible: false,
      rows: []
    });
    expect(buildExternalDraftSourceMetadataViewModel(draft, group)).toEqual({
      visible: false,
      rows: []
    });
    expect(JSON.stringify({ draft, group })).toBe(before);
  });

  it('preserves external origin labels, source labels, counts, timestamp source, and badge copy', () => {
    const model = buildExternalDraftSourceMetadataViewModel(
      makeExternalDraft(),
      makeExternalGroup()
    );

    expect(model).toMatchObject({
      visible: true,
      originLabel: 'ChatGPT prepared these Cavalry drafts.',
      panelCopy: 'Nothing has changed yet. Review and apply only what looks right.',
      sourceLabel: 'ChatGPT / Companion API / Beta GPT Action',
      groupId: 'source-group',
      groupLabel: 'Group source-group',
      createdAt: '2026-07-03T10:00:00.000Z',
      createdAtFallbackLabel: 'Created by Companion API',
      readyCount: 2,
      needsReviewCount: 1,
      blockedCount: 3,
      duplicateWarningCount: 2,
      duplicateWarningLabel: '2 duplicate warnings',
      hasIdempotencyKey: true,
      unchangedLabel: 'Nothing has changed yet'
    });
    expect(model.rows).toEqual([
      { id: 'source', label: 'ChatGPT / Companion API / Beta GPT Action' },
      { id: 'group', label: 'Group source-group' },
      { id: 'created-at', label: '', createdAt: '2026-07-03T10:00:00.000Z' },
      { id: 'ready', label: '2 ready' },
      { id: 'needs-review', label: '1 needs review' },
      { id: 'blocked', label: '3 blocked' },
      { id: 'duplicate-warnings', label: '2 duplicate warnings' },
      { id: 'idempotency-key', label: 'Idempotency key present' },
      { id: 'unchanged', label: 'Nothing has changed yet' }
    ]);
  });

  it('keeps manual, local, and unknown origin source labels stable without inventing provider or model labels', () => {
    expect(buildExternalDraftOriginLabel({ origin: 'manual_action_plan_import' })).toBe(
      'Manual import prepared these Cavalry drafts.'
    );
    expect(buildExternalDraftSourceLabel({ origin: 'manual_action_plan_import' })).toBe(
      'Manual Import'
    );
    expect(buildExternalDraftOriginLabel({ origin: 'local_dev_api' })).toBe(
      'Local Dev API prepared these Cavalry drafts.'
    );
    expect(buildExternalDraftSourceLabel({ origin: 'local_dev_api' })).toBe(
      'Companion API / Local Dev'
    );
    expect(
      buildExternalDraftOriginLabel({ origin: 'mcp', provider: '', model: 'hidden-model' })
    ).toBe('Companion API prepared these Cavalry drafts.');
    expect(
      buildExternalDraftSourceLabel({ origin: 'mcp', provider: '', model: 'hidden-model' })
    ).toBe('Companion API');

    const missingGroup = buildExternalDraftSourceMetadataViewModel(
      makeExternalDraft({
        source: { type: 'external_api' },
        createdAt: ''
      }),
      null
    );

    expect(missingGroup.rows).toEqual([
      { id: 'source', label: 'Companion API' },
      { id: 'group', label: 'External draft group' },
      { id: 'created-at', label: 'Created by Companion API', createdAt: '' },
      { id: 'ready', label: '0 ready' },
      { id: 'needs-review', label: '0 needs review' },
      { id: 'blocked', label: '0 blocked' },
      { id: 'unchanged', label: 'Nothing has changed yet' }
    ]);
  });

  it('builds the combined source metadata model and duplicate count without mutating draft or group input', () => {
    const draft = makeExternalDraft();
    const group = makeExternalGroup({
      origin: {
        origin: 'manual_action_plan_import',
        idempotency_key: 'snake-idem'
      }
    });
    const before = JSON.stringify({ draft, group });
    const model = buildDraftSourceMetadataViewModel(draft, { externalDraftGroup: group });

    expect(model.external.originLabel).toBe('Manual import prepared these Cavalry drafts.');
    expect(model.external.sourceLabel).toBe('Manual Import');
    expect(countExternalDraftDuplicateWarnings(group)).toBe(2);
    expect(JSON.stringify({ draft, group })).toBe(before);
  });
});
