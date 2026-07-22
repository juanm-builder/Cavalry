// Tests for Advisor category cleanup draft preparation.

import { describe, expect, it } from 'vitest';
import {
  buildAdvisorCategoryCleanupDraftsFromToolResults,
  buildAdvisorPreparedDraftReferenceActions,
  filterAdvisorActionsForPreparedDrafts,
  mergeAdvisorPreparedDraftGroups,
  persistAdvisorPreparedDraftsToWorkbook
} from '@cavalry/advisor/application/advisor/category-cleanup-drafts.js';

describe('advisor category cleanup draft preparation', () => {
  const toolResult = {
    toolResultVersion: 'cavalry.advisor_tool_result.v1',
    toolCallId: 'tool_prepare_category_drafts',
    toolName: 'prepare_category_drafts',
    ok: true,
    data: {
      proposal_kind: 'category_cleanup',
      candidate_count: 1,
      candidate_cleanup: {
        categoryChanges: [
          {
            action: 'rename',
            categoryId: 'misc',
            name: 'Needs Review',
            type: 'expense'
          }
        ],
        transactionPatches: [
          {
            transactionId: 'txn-misc',
            categoryId: 'food'
          }
        ]
      },
      draft_group_preview: {
        title: 'Category cleanup proposals',
        summary: 'Prepare reviewable category cleanup drafts from the safe candidate changes.',
        impactPreview: {
          affectedTransactions: 1,
          categoriesRenamed: 1
        }
      }
    },
    sourceRefs: ['category:misc', 'transaction:txn-misc']
  };

  it('builds reviewable ledger cleanup drafts from proposal tool results', () => {
    const prepared = buildAdvisorCategoryCleanupDraftsFromToolResults({
      taskSpec: { intent: 'categorization_review' },
      toolResults: [toolResult],
      requestId: 'request-one',
      traceId: 'trace-one',
      createdAt: '2026-06-21T00:00:00.000Z'
    });

    expect(prepared.drafts).toHaveLength(1);
    expect(prepared.drafts[0]).toMatchObject({
      id: 'ai_draft_category_cleanup_request-one_tool_prepare_category_drafts_1',
      operation: 'edit',
      objectType: 'ledgerCleanup',
      status: 'pending',
      title: 'Category cleanup proposal'
    });
    expect(prepared.drafts[0].sourceRefs).toEqual(
      expect.arrayContaining([
        'category:misc',
        'transaction:txn-misc',
        'advisor:request:request-one',
        'advisor:trace:trace-one',
        'advisor:tool:tool_prepare_category_drafts'
      ])
    );
    expect(prepared.drafts[0].proposed.categoryChanges[0]).toMatchObject({
      action: 'rename',
      categoryId: 'misc',
      name: 'Needs Review'
    });
    expect(prepared.draftGroups).toEqual([
      expect.objectContaining({
        groupId: 'ai_draft_group_category_cleanup_request-one_tool_prepare_category_drafts_1',
        draftIds: [prepared.drafts[0].id],
        impactPreview: expect.objectContaining({
          affectedTransactions: 1,
          categoriesRenamed: 1
        })
      })
    ]);
  });

  it('persists prepared drafts and merges them ahead of preview-only groups', () => {
    const workbook = {
      aiDrafts: [],
      advisorDraftGroups: []
    };
    const prepared = buildAdvisorCategoryCleanupDraftsFromToolResults({
      taskSpec: { intent: 'categorization_review' },
      toolResults: [toolResult],
      requestId: 'request-two',
      traceId: 'trace-two',
      createdAt: '2026-06-21T00:00:00.000Z'
    });
    const persisted = persistAdvisorPreparedDraftsToWorkbook(workbook, prepared, {
      createdAt: '2026-06-21T00:00:00.000Z'
    });
    const mergedGroups = mergeAdvisorPreparedDraftGroups(
      [
        {
          groupId: 'advisor_draft_group_1',
          taskSpecId: 'categorization_review',
          title: 'Category cleanup proposals',
          summary: 'Preview only.',
          draftIds: [],
          status: 'pending'
        }
      ],
      persisted.draftGroups
    );

    expect(workbook.aiDrafts.map((draft) => draft.id)).toEqual([prepared.drafts[0].id]);
    expect(workbook.advisorDraftGroups[0].draftIds).toEqual([prepared.drafts[0].id]);
    expect(mergedGroups).toEqual(persisted.draftGroups);
    expect(buildAdvisorPreparedDraftReferenceActions(persisted.drafts)).toEqual([
      expect.objectContaining({
        type: 'ai_draft_reference',
        aiDraftId: prepared.drafts[0].id,
        status: 'pending'
      })
    ]);
  });

  it('reuses active cleanup drafts instead of creating duplicates', () => {
    const existingPrepared = buildAdvisorCategoryCleanupDraftsFromToolResults({
      toolResults: [toolResult],
      requestId: 'request-existing',
      traceId: 'trace-existing',
      createdAt: '2026-06-21T00:00:00.000Z'
    });
    const workbook = {
      aiDrafts: existingPrepared.drafts,
      advisorDraftGroups: existingPrepared.draftGroups
    };
    const nextPrepared = buildAdvisorCategoryCleanupDraftsFromToolResults({
      workbook,
      toolResults: [toolResult],
      requestId: 'request-next',
      traceId: 'trace-next',
      createdAt: '2026-06-22T00:00:00.000Z'
    });

    expect(nextPrepared.drafts).toHaveLength(1);
    expect(nextPrepared.drafts[0].id).toBe(existingPrepared.drafts[0].id);
    expect(nextPrepared.reusedDrafts.map((draft) => draft.id)).toEqual([
      existingPrepared.drafts[0].id
    ]);
    expect(
      filterAdvisorActionsForPreparedDrafts(
        [{ id: 'prepare_category_cleanup_draft' }, { id: 'compare_before_after_categories' }],
        nextPrepared
      ).map((action) => action.id)
    ).toEqual(['compare_before_after_categories']);
  });

  it('creates review-only drafts when categorization needs evidence before cleanup', () => {
    const prepared = buildAdvisorCategoryCleanupDraftsFromToolResults({
      toolResults: [
        {
          toolCallId: 'tool_prepare_category_drafts',
          toolName: 'prepare_category_drafts',
          ok: true,
          data: {
            proposal_kind: 'category_cleanup',
            candidate_count: 0,
            candidate_cleanup: {},
            packet: {
              period: { start: '2026-06-01', end: '2026-06-30', label: 'June 2026' },
              counts: {
                transactions_reviewed: 2,
                transactions_in_vague_or_missing_categories: 1
              },
              sample_transactions_needing_review: [
                {
                  transaction_id: 'txn-needs-review',
                  date: '2026-06-12',
                  description: 'Unknown store',
                  amount: '120.00',
                  currency: 'PHP',
                  current_category: 'Random',
                  source_refs: ['transaction:txn-needs-review']
                }
              ]
            }
          },
          sourceRefs: ['transaction:txn-needs-review']
        }
      ],
      requestId: 'request-review',
      traceId: 'trace-review',
      createdAt: '2026-06-21T00:00:00.000Z'
    });

    expect(prepared.drafts).toHaveLength(1);
    expect(prepared.drafts[0]).toMatchObject({
      objectType: 'ledgerReview',
      title: 'Category review needed',
      status: 'pending'
    });
    expect(prepared.drafts[0].proposed.groups[0].items[0]).toMatchObject({
      transactionId: 'txn-needs-review',
      currentCategory: 'Random'
    });
    expect(
      filterAdvisorActionsForPreparedDrafts(
        [{ id: 'prepare_category_cleanup_draft' }, { id: 'compare_before_after_categories' }],
        prepared
      ).map((action) => action.id)
    ).toEqual([]);
  });
});
