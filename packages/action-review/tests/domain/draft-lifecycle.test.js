// Tests for the shared review draft lifecycle.

import { describe, expect, it } from 'vitest';
import {
  buildAiDraftResolutionUpdate,
  buildResolvedAdvisorActionUpdate,
  findAiDraftById,
  findAiDraftBySourceRef,
  findAdvisorDraftGroupById,
  findAdvisorDraftGroupsForDraft,
  findTransactionByReference,
  getAiDraftStatusFromAdvisorAction,
  getAdvisorActionSourceRef,
  getAdvisorDraftGroupStatusForDrafts,
  getAdvisorDraftGroups,
  getAdvisorDraftReference,
  getUnknownAiDraftSourceRefs,
  isAiDraftActive,
  isAiDraftResolved,
  normalizeAdvisorDraftGroup,
  normalizeAdvisorDraftGroups,
  normalizeAiDraft,
  normalizeAiDrafts,
  refreshAdvisorDraftGroupStatuses,
  upsertAdvisorDraftGroups,
  validateAiDraftSourceRefs
} from '@cavalry/action-review/domain/drafts/draft-lifecycle.js';

describe('advisor draft lifecycle', () => {
  const workbook = {
    aiDrafts: [
      {
        id: 'draft-open',
        status: 'pending',
        sourceRefs: ['advisor:thread:message:action-open']
      },
      {
        id: 'draft-posted',
        status: 'confirmed',
        sourceRefs: ['advisor:thread:message:action-posted'],
        resultObjectId: 'txn-posted'
      },
      {
        id: 'draft-rejected',
        status: 'rejected',
        sourceRefs: ['advisor:thread:message:action-rejected']
      }
    ],
    transactions: [
      {
        id: 'txn-posted',
        reference: 'advisor:draft:draft-posted'
      }
    ]
  };

  it('classifies active and resolved draft statuses', () => {
    expect(isAiDraftActive(workbook.aiDrafts[0])).toBe(true);
    expect(isAiDraftResolved(workbook.aiDrafts[0])).toBe(false);
    expect(isAiDraftActive(workbook.aiDrafts[1])).toBe(false);
    expect(isAiDraftResolved(workbook.aiDrafts[1])).toBe(true);
    expect(isAiDraftResolved(workbook.aiDrafts[2])).toBe(true);
  });

  it('finds resolved drafts by id or source reference so they are not re-created', () => {
    expect(findAiDraftById(workbook, 'draft-posted')?.status).toBe('confirmed');
    expect(findAiDraftBySourceRef(workbook, 'advisor:thread:message:action-posted')?.id).toBe(
      'draft-posted'
    );
  });

  it('builds stable advisor draft transaction references', () => {
    const reference = getAdvisorDraftReference('draft-posted');
    expect(reference).toBe('advisor:draft:draft-posted');
    expect(findTransactionByReference(workbook, reference)?.id).toBe('txn-posted');
  });

  it('normalizes imported AI drafts without renderer state', () => {
    const drafts = normalizeAiDrafts(
      [
        {
          id: 'draft-imported',
          status: 'posted',
          operation: 'edit',
          object_type: 'budget',
          source_refs: [' transaction:txn-posted ', '', 'advisor-message:user-one'],
          confidence: 1.4,
          proposed: { name: 'Netflix' }
        }
      ],
      { createdAt: '2026-06-18T00:00:00.000Z' }
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      id: 'draft-imported',
      status: 'pending',
      operation: 'edit',
      objectType: 'budget',
      title: 'Edit Budget',
      sourceRefs: ['transaction:txn-posted', 'advisor-message:user-one'],
      confidence: 1
    });
    expect(drafts[0].proposed).toEqual({ name: 'Netflix' });
  });

  it('can create deterministic fallback IDs for tests and imports', () => {
    const draft = normalizeAiDraft({}, 2, {
      createdAt: '2026-06-18T00:00:00.000Z',
      createId: (prefix) => `${prefix}_fixed`
    });

    expect(draft.id).toBe('ai_draft_2_fixed');
    expect(draft.createdAt).toBe('2026-06-18T00:00:00.000Z');
    expect(draft.objectType).toBe('transaction');
  });

  it('normalizes advisor draft groups for reviewable cleanup batches', () => {
    const group = normalizeAdvisorDraftGroup({
      group_id: 'group-one',
      task_spec_id: 'task-one',
      title: 'Category cleanup',
      summary: 'Review proposed category changes.',
      draft_ids: ['draft-one', '', 'draft-two'],
      impact_preview: {
        affected_transactions: 12,
        categories_created: 2,
        categories_renamed: 1,
        categories_archived: 0
      }
    });

    expect(group).toEqual({
      groupId: 'group-one',
      taskSpecId: 'task-one',
      title: 'Category cleanup',
      summary: 'Review proposed category changes.',
      draftIds: ['draft-one', 'draft-two'],
      status: 'pending',
      impactPreview: {
        affectedTransactions: 12,
        categoriesCreated: 2,
        categoriesRenamed: 1,
        categoriesArchived: 0
      }
    });
    expect(normalizeAdvisorDraftGroups([group, { draftIds: [] }])).toHaveLength(1);
  });

  it('finds and upserts persisted advisor draft groups by id', () => {
    const groupWorkbook = {
      aiDrafts: [
        { id: 'draft-one', status: 'pending' },
        { id: 'draft-two', status: 'confirmed' },
        { id: 'draft-three', status: 'rejected' }
      ],
      advisorDraftGroups: normalizeAdvisorDraftGroups([
        {
          groupId: 'group-one',
          title: 'Category cleanup',
          draftIds: ['draft-one', 'draft-two'],
          status: 'pending'
        }
      ])
    };

    expect(getAdvisorDraftGroups(groupWorkbook)).toHaveLength(1);
    expect(findAdvisorDraftGroupById(groupWorkbook, 'group-one')?.draftIds).toEqual([
      'draft-one',
      'draft-two'
    ]);
    expect(findAdvisorDraftGroupsForDraft(groupWorkbook, 'draft-one')).toHaveLength(1);
    expect(getAdvisorDraftGroupStatusForDrafts(groupWorkbook.aiDrafts.slice(0, 2))).toBe(
      'partially_reviewed'
    );
    expect(refreshAdvisorDraftGroupStatuses(groupWorkbook)[0].status).toBe('partially_reviewed');
    expect(
      upsertAdvisorDraftGroups(groupWorkbook.advisorDraftGroups, [
        {
          groupId: 'group-one',
          title: 'Category cleanup',
          draftIds: ['draft-two'],
          status: 'partially_reviewed'
        },
        {
          groupId: 'group-two',
          title: 'Budget review',
          draftIds: ['draft-three']
        }
      ])
    ).toEqual([
      expect.objectContaining({
        groupId: 'group-one',
        draftIds: ['draft-two'],
        status: 'partially_reviewed'
      }),
      expect.objectContaining({
        groupId: 'group-two',
        draftIds: ['draft-three'],
        status: 'pending'
      })
    ]);
  });

  it('validates AI draft source references across workbook collections', () => {
    const sourceWorkbook = {
      transactions: [{ id: 'txn-posted' }],
      categories: [{ id: 'food' }],
      counterparties: [{ id: 'globe' }],
      recurringItems: [{ id: 'netflix' }],
      sheets: [{ id: 'sheet-june' }]
    };
    const draft = normalizeAiDraft({
      sourceRefs: [
        'advisor:thread:message:action',
        'advisor-message:user-one',
        'transaction:txn-posted',
        'category:missing',
        'counterparty:globe',
        'billSubscription:netflix',
        'budget:sheet-june:food',
        'sheet:missing-sheet'
      ]
    });

    expect(getUnknownAiDraftSourceRefs(sourceWorkbook, draft)).toEqual([
      'category:missing',
      'sheet:missing-sheet'
    ]);
    expect(validateAiDraftSourceRefs(sourceWorkbook, draft)).toBe(
      'Unknown source references: category:missing, sheet:missing-sheet'
    );
  });

  it('maps advisor actions and resolved drafts without re-opening posted work', () => {
    expect(getAdvisorActionSourceRef('thread-one', 'message-one', 'draft-one')).toBe(
      'advisor:thread-one:message-one:draft-one'
    );
    expect(getAiDraftStatusFromAdvisorAction({ status: 'draft' })).toBe('pending');
    expect(getAiDraftStatusFromAdvisorAction({ status: 'posted' })).toBe('confirmed');
    expect(getAiDraftStatusFromAdvisorAction({ status: 'dismissed' })).toBe('rejected');
    expect(buildResolvedAdvisorActionUpdate(workbook.aiDrafts[1], {})).toEqual({
      status: 'posted',
      postedTransactionId: 'txn-posted'
    });
    expect(buildResolvedAdvisorActionUpdate(workbook.aiDrafts[2], {})).toEqual({
      status: 'dismissed'
    });
  });

  it('builds normalized lifecycle updates for apply, reject, needs-fix, and failure', () => {
    expect(
      buildAiDraftResolutionUpdate('confirmed', {
        resolvedAt: '2026-06-18T01:00:00.000Z',
        resultObjectId: 'txn-one',
        snapshotId: 'snapshot-one'
      })
    ).toEqual({
      status: 'confirmed',
      resolvedAt: '2026-06-18T01:00:00.000Z',
      resultObjectId: 'txn-one',
      snapshotId: 'snapshot-one',
      error: ''
    });
    expect(
      buildAiDraftResolutionUpdate('rejected', {
        resolvedAt: '2026-06-18T02:00:00.000Z'
      })
    ).toEqual({
      status: 'rejected',
      resolvedAt: '2026-06-18T02:00:00.000Z',
      error: ''
    });
    expect(buildAiDraftResolutionUpdate('needs_fix', { error: 'Missing category' })).toEqual({
      status: 'needs_fix',
      error: 'Missing category'
    });
    expect(
      buildAiDraftResolutionUpdate('failed', {
        snapshotId: 'snapshot-two',
        error: new Error('Could not post')
      })
    ).toEqual({
      status: 'failed',
      snapshotId: 'snapshot-two',
      error: 'Could not post'
    });
  });
});
