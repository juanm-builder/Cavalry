// Tests for Advisor-dependent draft review view models.
// Locks down browser-safe draft review route display projections before renderer wiring.

import { describe, expect, it } from 'vitest';

import {
  buildDraftReviewQueueGroupViewModels,
  buildDraftReviewRouteViewModel,
  getAdvisorDraftGroupStatusLabel,
  getAdvisorDraftGroupStatusTone,
  getAiDraftStatusLabel,
  getAiDraftStatusTone
} from '@cavalry/advisor/application/drafts/draft-review-view-model-service.js';

function makeDraft(overrides = {}) {
  return Object.assign(
    {
      id: 'draft-ready',
      status: 'pending',
      operation: 'create',
      objectType: 'transaction',
      title: 'Ready draft',
      createdAt: '2026-07-01T10:00:00.000Z',
      source: {},
      proposed: {}
    },
    overrides
  );
}

function makeWorkbook() {
  return {
    id: 'wb-draft-review',
    aiDrafts: [
      makeDraft({
        id: 'draft-ready',
        title: 'Ready draft',
        createdAt: '2026-07-02T10:00:00.000Z'
      }),
      makeDraft({
        id: 'draft-needs-details',
        title: 'Needs account',
        createdAt: '2026-07-03T10:00:00.000Z',
        status: 'needs_fix'
      }),
      makeDraft({
        id: 'draft-hidden-gate',
        title: 'Hidden gate draft',
        createdAt: '2026-07-04T10:00:00.000Z',
        source: { gateRequired: true }
      }),
      makeDraft({
        id: 'draft-approved-gate',
        title: 'Approved gate draft',
        createdAt: '2026-07-05T10:00:00.000Z',
        source: {
          gateRequired: true,
          gateReview: {
            schema_version: 'cavalry.advisor_draft_gate.v1',
            decision: 'approved'
          }
        }
      }),
      makeDraft({
        id: 'draft-confirmed',
        title: 'Confirmed draft',
        status: 'confirmed',
        createdAt: '2026-07-06T10:00:00.000Z'
      }),
      makeDraft({
        id: 'draft-rejected',
        title: 'Rejected draft',
        status: 'rejected',
        createdAt: '2026-07-07T10:00:00.000Z'
      })
    ],
    advisorDraftGroups: [
      {
        groupId: 'group-1',
        title: 'Trip cleanup',
        summary: 'Review two related drafts.',
        status: 'partially_reviewed',
        draftIds: ['draft-ready', 'draft-needs-details', 'missing-draft']
      },
      {
        groupId: 'group-2',
        title: 'Resolved group',
        status: 'confirmed',
        draftIds: ['draft-confirmed']
      }
    ]
  };
}

function validationForDraft(_workbook, draft) {
  return draft && draft.id === 'draft-needs-details'
    ? { ok: false, error: 'Choose an account.' }
    : { ok: true, error: '' };
}

describe('draft review view-model service', () => {
  it('builds route counts, ordering, selected fallback, and command copy without mutating input', () => {
    const workbook = makeWorkbook();
    const before = JSON.stringify(workbook);
    const viewModel = buildDraftReviewRouteViewModel(workbook, {
      selectedDraftId: 'missing-selection',
      validateDraft: validationForDraft
    });

    expect(JSON.stringify(workbook)).toBe(before);
    expect(viewModel).toMatchObject({
      openCount: 3,
      selectedDraftId: 'draft-needs-details',
      readyDraftIds: ['draft-approved-gate', 'draft-ready'],
      needsFixDraftIds: ['draft-needs-details'],
      confirmedDraftIds: ['draft-confirmed'],
      rejectedDraftIds: ['draft-rejected'],
      commandBar: {
        title: '3 drafts need your decision',
        copy: 'Some drafts need one more detail. Nothing changes until you apply a draft.',
        showActions: true
      }
    });
    expect(viewModel.reviewDraftIds).toEqual([
      'draft-needs-details',
      'draft-approved-gate',
      'draft-ready'
    ]);
    expect(viewModel.activeDraftIds).not.toContain('draft-hidden-gate');
  });

  it('preserves selected draft when it is still reviewable and exposes empty-state copy', () => {
    const selected = buildDraftReviewRouteViewModel(makeWorkbook(), {
      selectedDraftId: 'draft-ready',
      validateDraft: validationForDraft
    });
    const empty = buildDraftReviewRouteViewModel({ aiDrafts: [] });

    expect(selected.selectedDraftId).toBe('draft-ready');
    expect(empty).toMatchObject({
      openCount: 0,
      selectedDraftId: '',
      reviewDraftIds: [],
      commandBar: {
        title: 'No drafts need review',
        copy: 'The review queue is clear.',
        showActions: false
      },
      queue: {
        totalCount: 0,
        subtitle: '0 drafts need your decision.',
        visibleDraftIds: [],
        hiddenCount: 0
      }
    });
  });

  it('builds queue visibility metadata for first-five and show-all modes', () => {
    const draftIds = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
    const collapsed = buildDraftReviewRouteViewModel(
      {
        aiDrafts: draftIds.map((id, index) =>
          makeDraft({
            id,
            createdAt: '2026-07-0' + String(index + 1) + 'T10:00:00.000Z'
          })
        )
      },
      { selectedDraftId: 'd2' }
    ).queue;
    const expanded = buildDraftReviewRouteViewModel(
      {
        aiDrafts: draftIds.map((id, index) =>
          makeDraft({
            id,
            createdAt: '2026-07-0' + String(index + 1) + 'T10:00:00.000Z'
          })
        )
      },
      { showAll: true }
    ).queue;

    expect(collapsed).toMatchObject({
      totalCount: 6,
      visibleDraftIds: ['d6', 'd5', 'd4', 'd3', 'd2'],
      hiddenCount: 1,
      showToggle: true,
      toggleIcon: 'visibility',
      toggleLabel: 'View all 6'
    });
    expect(expanded).toMatchObject({
      visibleDraftIds: ['d6', 'd5', 'd4', 'd3', 'd2', 'd1'],
      hiddenCount: 0,
      showToggle: true,
      toggleIcon: 'visibility_off',
      toggleLabel: 'Show first 5'
    });
  });

  it('builds advisor draft group chip display models for visible review drafts', () => {
    const workbook = makeWorkbook();
    const chips = buildDraftReviewQueueGroupViewModels(
      workbook.advisorDraftGroups,
      workbook.aiDrafts,
      {
        reviewDraftIds: ['draft-needs-details', 'draft-ready'],
        selectedDraftId: 'draft-needs-details'
      }
    );

    expect(chips).toEqual([
      {
        groupId: 'group-1',
        title: 'Trip cleanup',
        status: 'partially_reviewed',
        statusLabel: 'Partially reviewed',
        statusTone: 'warn',
        draftCount: 2,
        firstDraftId: 'draft-ready',
        active: false
      }
    ]);
  });

  it('keeps current status label and tone copy stable', () => {
    expect(getAiDraftStatusLabel('failed')).toBe('Needs Fix');
    expect(getAiDraftStatusLabel('confirmed')).toBe('Confirmed');
    expect(getAiDraftStatusTone('rejected')).toBe('dismissed');
    expect(getAdvisorDraftGroupStatusLabel('pending')).toBe('Pending');
    expect(getAdvisorDraftGroupStatusLabel('partially_reviewed')).toBe('Partially reviewed');
    expect(getAdvisorDraftGroupStatusTone('confirmed')).toBe('good');
    expect(getAdvisorDraftGroupStatusTone('rejected')).toBe('bad');
  });
});
