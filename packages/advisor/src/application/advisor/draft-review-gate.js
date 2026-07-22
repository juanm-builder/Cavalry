import {
  normalizeAdvisorDraftGroup,
  normalizeAdvisorDraftGroups,
  normalizeAiDraft,
  normalizeAiDrafts
} from '@cavalry/action-review/domain/drafts/draft-lifecycle.js';

export const ADVISOR_DRAFT_GATE_SCHEMA_VERSION = 'cavalry.advisor_draft_gate.v1';

export const ADVISOR_DRAFT_GATE_EVENT_TYPES = Object.freeze({
  CANDIDATE_BUILT: 'draft_gate_candidate_built',
  VALIDATION_BLOCKED: 'draft_gate_validation_blocked',
  REVIEW_STARTED: 'draft_gate_review_started',
  APPROVED: 'draft_gate_approved',
  BLOCKED: 'draft_gate_blocked',
  PERSISTED: 'draft_gate_persisted'
});

function asString(value) {
  return String(value || '').trim();
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value, fallback = 0.75) {
  const numeric = asNumber(value, fallback);
  return Math.max(0, Math.min(1, numeric));
}

function uniqueStrings(value) {
  const seen = {};
  return (Array.isArray(value) ? value : [])
    .map(asString)
    .filter(Boolean)
    .filter((item) => {
      if (seen[item]) {
        return false;
      }
      seen[item] = true;
      return true;
    });
}

function callIfFunction(fn, ...args) {
  return typeof fn === 'function' ? fn(...args) : undefined;
}

function getNow(options = {}) {
  return (
    asString(callIfFunction(options.now)) || asString(options.checkedAt) || new Date().toISOString()
  );
}

function getCandidateId(draft, index) {
  return (
    asString(draft && (draft.id || draft.candidateId || draft.candidate_id)) ||
    'draft_candidate_' + String(index + 1)
  );
}

function normalizeGateDecision(candidateId, decision = {}) {
  const rawDecision = asString(decision.decision).toLowerCase();
  const approved = rawDecision === 'approve' || rawDecision === 'approved';
  const blocked = rawDecision === 'block' || rawDecision === 'blocked';
  return {
    candidateId,
    decision: approved ? 'approve' : blocked ? 'block' : 'block',
    confidence: clamp01(decision.confidence, approved ? 0.8 : 0.55),
    reason:
      asString(decision.reason) ||
      (approved ? 'Draft passed Advisor gate review.' : 'Draft did not pass Advisor gate review.'),
    blockingIssues: uniqueStrings(decision.blockingIssues || decision.blocking_issues),
    evidenceRefs: uniqueStrings(decision.evidenceRefs || decision.evidence_refs)
  };
}

function buildRulesDecision(candidateId, draft) {
  return normalizeGateDecision(candidateId, {
    decision: 'approve',
    confidence: Math.max(0.75, clamp01(draft && draft.confidence, 0.75)),
    reason: 'Rules reviewer approved this draft after deterministic validation.',
    evidenceRefs: draft && draft.sourceRefs
  });
}

function buildValidationDecision(candidateId, error) {
  return normalizeGateDecision(candidateId, {
    decision: 'block',
    confidence: 1,
    reason: asString(error) || 'Draft failed deterministic validation.',
    blockingIssues: [asString(error) || 'Draft failed deterministic validation.']
  });
}

function validateCandidate(workbook, draft, options = {}) {
  if (typeof options.validateDraft === 'function') {
    const result = options.validateDraft(workbook, draft);
    if (result && typeof result === 'object') {
      return {
        ok: result.ok !== false,
        error: asString(result.error || result.reason)
      };
    }
    return {
      ok: result !== false,
      error: ''
    };
  }
  return { ok: true, error: '' };
}

function reviewCandidate(workbook, draft, validation, options = {}, candidateId = '') {
  if (typeof options.reviewDraft === 'function') {
    const reviewed = options.reviewDraft({
      workbook,
      draft,
      validation,
      candidateId
    });
    if (reviewed) {
      return normalizeGateDecision(candidateId, reviewed);
    }
  }
  return buildRulesDecision(candidateId, draft);
}

function stampApprovedDraft(draft, decision, options = {}) {
  const reviewer = asString(options.reviewer) || asString(decision.reviewer) || 'rules';
  const checkedAt = getNow(options);
  const source =
    draft && draft.source && typeof draft.source === 'object' && !Array.isArray(draft.source)
      ? draft.source
      : {};
  const sourceRefs = uniqueStrings((draft && draft.sourceRefs) || []);
  return normalizeAiDraft(
    Object.assign({}, draft, {
      status: 'pending',
      error: '',
      source: Object.assign({}, source, {
        gateReview: {
          schema_version: ADVISOR_DRAFT_GATE_SCHEMA_VERSION,
          decision: 'approved',
          reviewer,
          reason: decision.reason,
          checkedAt,
          evidenceRefs: uniqueStrings(
            decision.evidenceRefs.length ? decision.evidenceRefs : sourceRefs
          )
        }
      })
    }),
    0,
    {
      createdAt: draft && draft.createdAt,
      createId: options.createId
    }
  );
}

export function getAdvisorDraftGateReview(draft) {
  const source = draft && draft.source && typeof draft.source === 'object' ? draft.source : {};
  const review =
    source.gateReview || source.gate_review || (draft && (draft.gateReview || draft.gate_review));
  return review && typeof review === 'object' && !Array.isArray(review) ? review : null;
}

export function isAdvisorDraftGateApproved(draft) {
  const review = getAdvisorDraftGateReview(draft);
  return !!(
    review &&
    asString(review.schema_version || review.schemaVersion) === ADVISOR_DRAFT_GATE_SCHEMA_VERSION &&
    asString(review.decision).toLowerCase() === 'approved'
  );
}

export function isAiDraftVisibleAfterGate(draft) {
  if (!draft) {
    return false;
  }
  if (isAdvisorDraftGateApproved(draft)) {
    return true;
  }
  const source = draft.source && typeof draft.source === 'object' ? draft.source : {};
  return !(source.gateRequired === true || source.gate_required === true);
}

export function filterAdvisorDraftGroupsForDraftIds(groups, draftIds, options = {}) {
  const allowed = {};
  uniqueStrings(draftIds).forEach((id) => {
    allowed[id] = true;
  });
  return normalizeAdvisorDraftGroups(groups, options)
    .map((group, index) => {
      const draftIdsForGroup = (group.draftIds || []).filter((draftId) => allowed[draftId]);
      return normalizeAdvisorDraftGroup(
        Object.assign({}, group, {
          draftIds: draftIdsForGroup
        }),
        index,
        options
      );
    })
    .filter((group) => group.draftIds.length);
}

export function runAdvisorDraftReviewGate({
  workbook,
  candidates,
  draftGroups,
  validateDraft,
  reviewDraft,
  reviewer = 'rules',
  now,
  checkedAt,
  createId,
  onEvent
} = {}) {
  const normalizedCandidates = normalizeAiDrafts(candidates, {
    createId,
    createdAt: getNow({ now, checkedAt })
  });
  const approvedDrafts = [];
  const blockedCandidates = [];
  const decisions = [];

  normalizedCandidates.forEach((draft, index) => {
    const candidateId = getCandidateId(draft, index);
    callIfFunction(onEvent, ADVISOR_DRAFT_GATE_EVENT_TYPES.CANDIDATE_BUILT, {
      candidateId,
      draftId: draft.id,
      objectType: draft.objectType,
      operation: draft.operation
    });
    const validation = validateCandidate(workbook, draft, { validateDraft });
    if (!validation.ok) {
      const decision = buildValidationDecision(candidateId, validation.error);
      decisions.push(decision);
      blockedCandidates.push({
        candidateId,
        draft,
        stage: 'validation',
        decision,
        error: validation.error
      });
      callIfFunction(onEvent, ADVISOR_DRAFT_GATE_EVENT_TYPES.VALIDATION_BLOCKED, {
        candidateId,
        draftId: draft.id,
        error: validation.error
      });
      return;
    }
    callIfFunction(onEvent, ADVISOR_DRAFT_GATE_EVENT_TYPES.REVIEW_STARTED, {
      candidateId,
      draftId: draft.id,
      reviewer
    });
    const decision = reviewCandidate(workbook, draft, validation, { reviewDraft }, candidateId);
    decisions.push(decision);
    if (decision.decision !== 'approve') {
      blockedCandidates.push({
        candidateId,
        draft,
        stage: 'review',
        decision,
        error: decision.reason
      });
      callIfFunction(onEvent, ADVISOR_DRAFT_GATE_EVENT_TYPES.BLOCKED, {
        candidateId,
        draftId: draft.id,
        reason: decision.reason,
        blockingIssues: decision.blockingIssues
      });
      return;
    }
    const approvedDraft = stampApprovedDraft(draft, decision, {
      reviewer,
      now,
      checkedAt,
      createId
    });
    approvedDrafts.push(approvedDraft);
    callIfFunction(onEvent, ADVISOR_DRAFT_GATE_EVENT_TYPES.APPROVED, {
      candidateId,
      draftId: approvedDraft.id,
      reviewer,
      reason: decision.reason
    });
  });

  const approvedIds = approvedDrafts.map((draft) => draft.id);
  return {
    approvedDrafts,
    blockedCandidates,
    decisions,
    draftGroups: filterAdvisorDraftGroupsForDraftIds(draftGroups, approvedIds, { createId })
  };
}
