// Tests for the provider-neutral draft review projection.
// Locks down the browser-safe draft review view model without importing Node-only draft fingerprinting.

import { describe, expect, it } from 'vitest';

import {
  buildDraftGroupReviewProjection,
  getDraftGroupIssueCounts,
  isDraftGroupReviewableStatus,
  summarizeDraftGroupForReview
} from '@cavalry/action-review/application/drafts/draft-review-projection.js';

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeWorkbook() {
  return {
    id: 'wb_projection',
    externalDraftGroups: [
      {
        draft_group_id: 'dg_ready',
        title: 'Ready review',
        status: 'pending_review',
        review_url: 'cavalry://draft-groups/dg_ready',
        created_at: '2026-06-30T10:00:00.000Z',
        origin: { origin: 'local_dev_api', provider: 'local' },
        validation_issues: [
          {
            code: 'group_note',
            severity: 'info',
            message: 'Group-level note.'
          }
        ],
        drafts: [
          {
            draft_id: 'draft_ready',
            type: 'transaction',
            status: 'ready',
            title: 'Coffee',
            display_summary: 'Coffee - PHP 120',
            proposed_values: {
              amount: 120,
              payment_account_id: 'cash',
              category_id: 'food'
            },
            validation_issues: [
              {
                code: 'needs_receipt_check',
                severity: 'warning',
                message: 'Receipt was not attached.'
              }
            ]
          },
          {
            draft_id: 'draft_info',
            type: 'transaction',
            status: 'needs_info',
            title: 'Unknown merchant',
            display_summary: 'Needs merchant details',
            proposed_values: {}
          }
        ]
      },
      {
        draft_group_id: 'dg_applied',
        title: 'Resolved review',
        status: 'applied',
        drafts: [
          {
            draft_id: 'draft_applied',
            status: 'ready',
            title: 'Applied item'
          }
        ]
      }
    ]
  };
}

describe('draft review projection', () => {
  it('summarizes a ready reviewable group with warning conflicts', () => {
    const workbook = makeWorkbook();
    const projection = buildDraftGroupReviewProjection(workbook, 'dg_ready', {
      conflicts: [
        {
          code: 'duplicate_pending_draft',
          severity: 'warning',
          message: 'Another pending draft looks similar.',
          draft_id: 'draft_ready'
        }
      ]
    });

    expect(projection).toMatchObject({
      ok: true,
      code: 'ok',
      draftGroupId: 'dg_ready',
      title: 'Ready review',
      status: 'pending_review',
      reviewable: true,
      canApply: true,
      canReject: true,
      summary: {
        total: 2,
        ready: 1,
        needs_review: 0,
        needs_info: 1,
        blocked: 0
      },
      issueCounts: {
        total: 3,
        validationIssues: 2,
        groupValidationIssues: 1,
        draftValidationIssues: 1,
        conflicts: 1,
        blockingConflicts: 0,
        warningConflicts: 1,
        infoConflicts: 0
      }
    });
    expect(projection.drafts[0]).toMatchObject({
      draftId: 'draft_ready',
      type: 'transaction',
      status: 'ready',
      title: 'Coffee',
      summary: 'Coffee - PHP 120'
    });
    expect(projection.drafts[0].conflicts).toHaveLength(1);
  });

  it('blocks apply when blocking conflicts are present', () => {
    const group = makeWorkbook().externalDraftGroups[0];
    const summary = summarizeDraftGroupForReview(group, [
      {
        code: 'missing_account',
        severity: 'blocked',
        message: 'Draft account reference no longer exists.',
        draft_id: 'draft_ready'
      }
    ]);

    expect(summary.reviewable).toBe(true);
    expect(summary.canApply).toBe(false);
    expect(summary.canReject).toBe(true);
    expect(summary.issueCounts.blockingConflicts).toBe(1);
    expect(summary.blockingConflicts[0].code).toBe('missing_account');
  });

  it('marks resolved groups as non-reviewable without hiding their summary', () => {
    const projection = buildDraftGroupReviewProjection(makeWorkbook(), 'dg_applied');

    expect(isDraftGroupReviewableStatus('applied')).toBe(false);
    expect(projection).toMatchObject({
      ok: true,
      status: 'applied',
      reviewable: false,
      canApply: false,
      canReject: false,
      summary: {
        total: 1,
        ready: 1
      }
    });
  });

  it('returns a defensive empty projection for a missing draft group id', () => {
    expect(buildDraftGroupReviewProjection(makeWorkbook(), 'missing')).toMatchObject({
      ok: false,
      code: 'draft_group_not_found',
      message: 'Draft group was not found.',
      draftGroupId: 'missing',
      reviewable: false,
      canApply: false,
      canReject: false,
      summary: {
        total: 0
      },
      drafts: []
    });
  });

  it('counts validation issues and conflicts defensively', () => {
    const group = {
      validation_issues: [{ severity: 'info' }],
      drafts: [
        {
          status: 'not_a_real_status',
          validation_issues: [{ severity: 'blocked' }]
        }
      ]
    };
    const counts = getDraftGroupIssueCounts(group, [
      { severity: 'info' },
      { severity: 'warning' },
      { severity: 'blocked' }
    ]);
    const summary = summarizeDraftGroupForReview(group);

    expect(counts).toEqual({
      total: 5,
      validationIssues: 2,
      groupValidationIssues: 1,
      draftValidationIssues: 1,
      conflicts: 3,
      blockingConflicts: 1,
      warningConflicts: 1,
      infoConflicts: 1
    });
    expect(summary.summary).toMatchObject({
      total: 1,
      ready: 0,
      needs_review: 0,
      needs_info: 0,
      blocked: 1
    });
  });

  it('does not mutate workbook, draft group, or returned clones', () => {
    const workbook = makeWorkbook();
    const before = clonePlain(workbook);
    const projection = buildDraftGroupReviewProjection(workbook, 'dg_ready');

    projection.drafts[0].proposedValues.amount = 999;
    projection.validationIssues.push({ code: 'changed' });

    expect(workbook).toEqual(before);
  });
});
