// Tests for the Advisor brain domain contract.

import { describe, expect, it } from 'vitest';
import {
  advisorBrainMessageClaimsDirectMutation,
  looksLikeAdvisorBrainWorkbookPrompt,
  normalizeAdvisorBrainContextRequests,
  normalizeAdvisorBrainResponse
} from '@cavalry/advisor/domain/advisor/brain.js';

const workbook = {
  currency: 'PHP',
  categories: [{ id: 'food', name: 'Food', type: 'expense', isActive: true }],
  counterparties: [{ id: 'store', name: 'Store', kind: 'merchant', isActive: true }],
  recurringItems: [
    {
      id: 'netflix',
      name: 'Netflix',
      categoryId: 'food',
      amount: 549,
      anchorDate: '2026-06-01',
      isActive: true
    }
  ],
  sheets: [{ id: 'sheet-june', name: 'June', budgets: [{ categoryId: 'food', planned: 1000 }] }],
  transactions: [{ id: 'txn-one', date: '2026-06-18', template: 'expense_paid', amount: 150 }],
  aiDrafts: []
};

describe('advisor brain domain contract', () => {
  it('routes workbook-wide write prompts without stealing obvious transaction creates', () => {
    expect(
      looksLikeAdvisorBrainWorkbookPrompt('create a transaction for 150 food from Cash today')
    ).toBe(false);
    expect(
      looksLikeAdvisorBrainWorkbookPrompt('edit transaction txn-one and change it to Food')
    ).toBe(true);
    expect(looksLikeAdvisorBrainWorkbookPrompt('delete the Food category')).toBe(true);
    expect(looksLikeAdvisorBrainWorkbookPrompt('track Netflix as a monthly subscription')).toBe(
      true
    );
    expect(looksLikeAdvisorBrainWorkbookPrompt('clean up my ledger labels')).toBe(true);
  });

  it('normalizes context requests to supported workbook slices', () => {
    expect(
      normalizeAdvisorBrainContextRequests([
        { kind: 'transactions', query: 'store', limit: 99 },
        { kind: 'subscriptions' },
        { kind: 'unknown' }
      ])
    ).toEqual([
      { kind: 'transactions', query: 'store', source_refs: [], limit: 50 },
      { kind: 'recurring_items', query: '', source_refs: [], limit: 0 }
    ]);
  });

  it('replaces direct-mutation claims and keeps delete drafts reviewable', () => {
    expect(advisorBrainMessageClaimsDirectMutation('I deleted the Food category.')).toBe(true);

    const result = normalizeAdvisorBrainResponse(
      workbook,
      {
        message: 'I deleted the Food category.',
        drafts: [
          {
            operation: 'delete',
            objectType: 'category',
            targetId: 'food',
            title: 'Delete Food',
            proposed: { id: 'food' },
            sourceRefs: ['category:food'],
            confidence: 0.8
          }
        ],
        questions: [],
        references: [],
        context_requests: []
      },
      { createdAt: '2026-06-21T00:00:00.000Z' }
    );

    expect(result.message).toContain('Nothing has changed');
    expect(result.safety_warnings).toEqual(['direct_mutation_claim_replaced']);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      operation: 'delete',
      objectType: 'category',
      targetId: 'food',
      status: 'needs_fix',
      error:
        'Category is still referenced. Archive it, choose a replacement category, or uncategorize the references before hard delete.',
      sourceRefs: ['category:food']
    });
  });

  it('marks unsafe or unsupported drafts instead of accepting them silently', () => {
    const result = normalizeAdvisorBrainResponse(
      workbook,
      {
        message: 'Prepared drafts.',
        drafts: [
          {
            operation: 'delete',
            objectType: 'category',
            targetId: 'missing',
            proposed: { id: 'missing' }
          },
          { operation: 'create', objectType: 'widget', proposed: { name: 'Bad' } }
        ],
        questions: [],
        references: [],
        context_requests: []
      },
      { createdAt: '2026-06-21T00:00:00.000Z' }
    );

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      operation: 'delete',
      objectType: 'category',
      targetId: 'missing',
      status: 'needs_fix',
      error: 'Category not found.'
    });
    expect(result.rejected_drafts).toEqual([
      { index: 0, error: 'Category not found.' },
      { index: 1, error: 'Unsupported Brain draft operation or object type.' }
    ]);
  });
});
