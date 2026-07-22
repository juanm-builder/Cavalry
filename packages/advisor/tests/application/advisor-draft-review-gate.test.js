// Tests for the Advisor draft review gate.

import { describe, expect, it } from 'vitest';
import {
  ADVISOR_DRAFT_GATE_SCHEMA_VERSION,
  isAiDraftVisibleAfterGate,
  runAdvisorDraftReviewGate
} from '@cavalry/advisor/application/advisor/draft-review-gate.js';

function makeCandidate(overrides = {}) {
  return Object.assign(
    {
      id: 'candidate-1',
      status: 'pending',
      operation: 'create',
      objectType: 'category',
      title: 'Create Travel',
      summary: 'Create a reviewed category.',
      proposed: {
        name: 'Travel',
        type: 'expense'
      },
      before: {},
      source: {
        type: 'test',
        gateRequired: true
      },
      sourceRefs: ['category:travel'],
      confidence: 0.82,
      reason: 'Test candidate'
    },
    overrides
  );
}

describe('advisor draft review gate', () => {
  it('approves valid candidates and stamps gate metadata', () => {
    const events = [];
    const result = runAdvisorDraftReviewGate({
      workbook: {},
      candidates: [makeCandidate()],
      draftGroups: [
        {
          groupId: 'group-1',
          draftIds: ['candidate-1'],
          title: 'Draft group'
        }
      ],
      validateDraft: () => ({ ok: true }),
      checkedAt: '2026-06-24T12:00:00.000Z',
      now: () => '2026-06-24T12:00:00.000Z',
      onEvent: (type, metadata) => events.push({ type, metadata })
    });

    expect(result.approvedDrafts).toHaveLength(1);
    expect(result.blockedCandidates).toHaveLength(0);
    expect(result.approvedDrafts[0]).toMatchObject({
      id: 'candidate-1',
      status: 'pending',
      source: {
        gateReview: {
          schema_version: ADVISOR_DRAFT_GATE_SCHEMA_VERSION,
          decision: 'approved',
          reviewer: 'rules',
          checkedAt: '2026-06-24T12:00:00.000Z'
        }
      }
    });
    expect(result.draftGroups[0].draftIds).toEqual(['candidate-1']);
    expect(events.map((event) => event.type)).toEqual([
      'draft_gate_candidate_built',
      'draft_gate_review_started',
      'draft_gate_approved'
    ]);
  });

  it('blocks candidates that fail deterministic validation before review', () => {
    const reviewCalls = [];
    const result = runAdvisorDraftReviewGate({
      workbook: {},
      candidates: [makeCandidate()],
      validateDraft: () => ({ ok: false, error: 'Category name is required.' }),
      reviewDraft: (input) => {
        reviewCalls.push(input);
        return { decision: 'approve' };
      },
      checkedAt: '2026-06-24T12:00:00.000Z'
    });

    expect(result.approvedDrafts).toHaveLength(0);
    expect(result.blockedCandidates).toEqual([
      expect.objectContaining({
        candidateId: 'candidate-1',
        stage: 'validation',
        error: 'Category name is required.',
        decision: expect.objectContaining({
          decision: 'block',
          blockingIssues: ['Category name is required.']
        })
      })
    ]);
    expect(reviewCalls).toHaveLength(0);
  });

  it('blocks valid candidates when the Advisor reviewer withholds approval', () => {
    const result = runAdvisorDraftReviewGate({
      workbook: {},
      candidates: [makeCandidate()],
      validateDraft: () => ({ ok: true }),
      reviewDraft: () => ({
        decision: 'block',
        confidence: 0.66,
        reason: 'Evidence does not identify the target account.',
        blockingIssues: ['Missing account evidence'],
        evidenceRefs: ['advisor-message:one']
      }),
      reviewer: 'model'
    });

    expect(result.approvedDrafts).toHaveLength(0);
    expect(result.blockedCandidates).toEqual([
      expect.objectContaining({
        stage: 'review',
        decision: expect.objectContaining({
          decision: 'block',
          confidence: 0.66,
          reason: 'Evidence does not identify the target account.',
          blockingIssues: ['Missing account evidence'],
          evidenceRefs: ['advisor-message:one']
        })
      })
    ]);
  });

  it('falls back to the rules reviewer when no model reviewer is configured', () => {
    const result = runAdvisorDraftReviewGate({
      workbook: {},
      candidates: [makeCandidate({ confidence: 0.91 })],
      validateDraft: () => ({ ok: true })
    });

    expect(result.decisions[0]).toMatchObject({
      decision: 'approve',
      confidence: 0.91,
      reason: 'Rules reviewer approved this draft after deterministic validation.'
    });
    expect(result.approvedDrafts[0].source.gateReview.reviewer).toBe('rules');
  });

  it('keeps approved and legacy drafts visible while hiding unapproved gate-required drafts', () => {
    const approved = runAdvisorDraftReviewGate({
      workbook: {},
      candidates: [makeCandidate()],
      validateDraft: () => ({ ok: true })
    }).approvedDrafts[0];

    expect(isAiDraftVisibleAfterGate(approved)).toBe(true);
    expect(isAiDraftVisibleAfterGate(makeCandidate({ source: { type: 'legacy' } }))).toBe(true);
    expect(isAiDraftVisibleAfterGate(makeCandidate())).toBe(false);
  });
});
