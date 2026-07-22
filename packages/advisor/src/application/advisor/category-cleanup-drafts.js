import {
  getAiDrafts,
  isAiDraftResolved,
  normalizeAdvisorDraftGroup,
  normalizeAdvisorDraftGroups,
  normalizeAiDraft,
  normalizeAiDrafts,
  upsertAdvisorDraftGroups
} from '@cavalry/action-review/domain/drafts/draft-lifecycle.js';
import {
  normalizeLedgerCleanupPayload,
  normalizeLedgerReviewPayload
} from '../../domain/advisor/ledger-drafts.js';
import { getLedgerCleanupSourceRefsFromPayload } from '../../domain/advisor/packets.js';

function asString(value) {
  return String(value || '').trim();
}

function asInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : fallback;
}

function sanitizeIdPart(value, fallback) {
  const id = asString(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return id || asString(fallback || 'advisor');
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

function getTaskSpecId(taskSpec = {}) {
  return asString(
    taskSpec.id ||
      taskSpec.taskSpecId ||
      taskSpec.specVersion ||
      taskSpec.spec_version ||
      'advisor_task'
  );
}

function getStableArtifactId(prefix, options = {}, result = {}, index = 0) {
  if (typeof options.createId === 'function') {
    return options.createId(prefix);
  }
  return [
    prefix,
    sanitizeIdPart(options.requestId || options.traceId || 'advisor_request'),
    sanitizeIdPart(
      result.toolCallId || result.tool_call_id || result.toolName || result.tool_name || 'tool'
    ),
    String(index + 1)
  ].join('_');
}

function countCleanupChanges(cleanup) {
  return {
    categoryChanges: (cleanup.categoryChanges || []).length,
    counterpartyChanges: (cleanup.counterpartyChanges || []).length,
    transactionPatches: (cleanup.transactionPatches || []).length
  };
}

function hasCleanupChanges(cleanup) {
  const counts = countCleanupChanges(cleanup);
  return !!(counts.categoryChanges || counts.counterpartyChanges || counts.transactionPatches);
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(stableJson).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + stableJson(value[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function getCleanupFingerprint(cleanup) {
  return stableJson(normalizeLedgerCleanupPayload(cleanup));
}

function getReviewFingerprint(review) {
  return stableJson(normalizeLedgerReviewPayload(review));
}

function findExistingDraftByFingerprint(workbook, objectType, fingerprint, normalizePayload) {
  if (!(workbook && fingerprint)) {
    return null;
  }
  return (
    getAiDrafts(workbook).find(
      (draft) =>
        draft &&
        draft.objectType === objectType &&
        stableJson(normalizePayload(draft.proposed)) === fingerprint
    ) || null
  );
}

function getDraftSummary(cleanup, data = {}) {
  const preview = data.draft_group_preview || {};
  const summary = asString(preview.summary);
  if (summary) {
    return summary;
  }
  const counts = countCleanupChanges(cleanup);
  const parts = [];
  if (counts.categoryChanges)
    parts.push(
      String(counts.categoryChanges) +
        ' category change' +
        (counts.categoryChanges === 1 ? '' : 's')
    );
  if (counts.counterpartyChanges)
    parts.push(
      String(counts.counterpartyChanges) +
        ' counterparty change' +
        (counts.counterpartyChanges === 1 ? '' : 's')
    );
  if (counts.transactionPatches)
    parts.push(
      String(counts.transactionPatches) +
        ' transaction update' +
        (counts.transactionPatches === 1 ? '' : 's')
    );
  return parts.length
    ? 'Review ' + parts.join(', ') + ' before applying them.'
    : 'Review category cleanup proposals before applying them.';
}

function getCleanupReason(cleanup, data = {}) {
  const counts = countCleanupChanges(cleanup);
  const safeCount =
    Number(data.candidate_count || 0) ||
    counts.categoryChanges + counts.counterpartyChanges + counts.transactionPatches;
  const parts = [];
  if (counts.categoryChanges) parts.push(String(counts.categoryChanges) + ' category');
  if (counts.counterpartyChanges) parts.push(String(counts.counterpartyChanges) + ' counterparty');
  if (counts.transactionPatches) parts.push(String(counts.transactionPatches) + ' transaction');
  return (
    'Prepared from Advisor cleanup evidence: ' +
    (parts.length ? parts.join(', ') : String(safeCount) + ' safe') +
    ' candidate change' +
    (safeCount === 1 ? '' : 's') +
    '. Review before applying.'
  );
}

function getImpactPreview(cleanup, data = {}) {
  const preview = data.draft_group_preview || {};
  const source = preview.impactPreview || preview.impact_preview || {};
  const categoryChanges = cleanup.categoryChanges || [];
  return {
    affectedTransactions: asInteger(
      source.affectedTransactions ||
        source.affected_transactions ||
        (cleanup.transactionPatches || []).length
    ),
    categoriesCreated: asInteger(
      source.categoriesCreated ||
        source.categories_created ||
        categoryChanges.filter((change) => change.action === 'create').length
    ),
    categoriesRenamed: asInteger(
      source.categoriesRenamed ||
        source.categories_renamed ||
        categoryChanges.filter((change) => change.action === 'rename').length
    ),
    categoriesArchived: asInteger(
      source.categoriesArchived ||
        source.categories_archived ||
        categoryChanges.filter((change) => change.action === 'archive' || change.action === 'merge')
          .length
    )
  };
}

function buildReviewPayloadFromProposalData(data = {}) {
  const packet = data.packet || {};
  const period = packet.period || data.period || {};
  const counts = packet.counts || data.counts || {};
  const sampleRows =
    packet.sample_transactions_needing_review || data.sample_transactions_needing_review || [];
  const groups = [];
  const reviewItems = (Array.isArray(sampleRows) ? sampleRows : [])
    .map((row) => ({
      transactionId: asString(row.transaction_id || row.transactionId),
      date: asString(row.date),
      description: asString(row.description || 'Transaction'),
      amount: Number(row.amount || 0) || 0,
      amountDisplay: asString(row.amount_display || row.amountDisplay || row.amount),
      currency: asString(row.currency),
      currentCategory: asString(row.current_category || row.currentCategory || 'Missing category'),
      reason: asString(row.reason || 'Category needs review before cleanup can be safely applied.'),
      sourceRef: Array.isArray(row.source_refs) && row.source_refs[0] ? row.source_refs[0] : ''
    }))
    .filter((item) => item.transactionId);
  if (reviewItems.length) {
    groups.push({
      id: 'category_review_items',
      title: 'Transactions needing category review',
      reason: 'These rows need clearer labels before Advisor can safely apply cleanup.',
      sourceRefs: uniqueStrings(reviewItems.map((item) => item.sourceRef)),
      items: reviewItems
    });
  }
  return normalizeLedgerReviewPayload({
    summary: 'Review category assignments before preparing cleanup changes.',
    period,
    counts: {
      transactionsReviewed: counts.transactions_reviewed,
      reviewItemCount: reviewItems.length,
      vagueOrMissingTransactions: counts.transactions_in_vague_or_missing_categories,
      duplicateCategoryGroups: counts.duplicate_category_label_groups,
      duplicateCounterpartyGroups: counts.duplicate_counterparty_label_groups,
      safeCandidateChanges: counts.safe_candidate_changes
    },
    groups
  });
}

function buildGroupForDraft({
  draft,
  result,
  taskSpecId,
  summary,
  impactPreview,
  groupId,
  createId
}) {
  const data = result && result.data ? result.data : {};
  const preview = data.draft_group_preview || {};
  return normalizeAdvisorDraftGroup(
    {
      groupId,
      taskSpecId,
      title:
        asString(preview.title) ||
        (draft.objectType === 'ledgerReview'
          ? 'Category review needed'
          : 'Category cleanup proposals'),
      summary,
      draftIds: [draft.id],
      status:
        draft.status === 'confirmed'
          ? 'confirmed'
          : draft.status === 'rejected'
            ? 'rejected'
            : 'pending',
      impactPreview
    },
    0,
    { createId }
  );
}

function isCategoryCleanupProposalResult(result) {
  const data = result && result.data ? result.data : {};
  return !!(
    result &&
    result.ok &&
    data &&
    (asString(result.toolName || result.tool_name) === 'prepare_category_drafts' ||
      asString(result.toolName || result.tool_name) === 'prepare_ledger_cleanup_draft' ||
      asString(data.proposal_kind) === 'category_cleanup')
  );
}

export function buildAdvisorPreparedDraftReferenceActions(preparedDrafts) {
  return normalizeAiDrafts(preparedDrafts).map((draft) => ({
    id: 'advisor_ai_draft_action_' + sanitizeIdPart(draft.id, 'draft'),
    type: 'ai_draft_reference',
    aiDraftId: draft.id,
    title: draft.title,
    summary: draft.summary,
    status: draft.status
  }));
}

export function buildAdvisorCategoryCleanupDraftsFromToolResults({
  workbook,
  taskSpec,
  toolResults,
  requestId,
  traceId,
  createdAt,
  createId
} = {}) {
  const drafts = [];
  const draftGroups = [];
  const skippedResolvedDrafts = [];
  const reusedDrafts = [];
  const timestamp = asString(createdAt) || new Date().toISOString();
  const taskSpecId = getTaskSpecId(taskSpec);
  (Array.isArray(toolResults) ? toolResults : []).forEach((result, index) => {
    if (!isCategoryCleanupProposalResult(result)) {
      return;
    }
    const data = result.data || {};
    const cleanup = normalizeLedgerCleanupPayload(data.candidate_cleanup || data.cleanup || {});
    if (!hasCleanupChanges(cleanup)) {
      const review = buildReviewPayloadFromProposalData(data);
      if (!(review.groups && review.groups.length)) {
        return;
      }
      const reviewFingerprint = getReviewFingerprint(review);
      const existingReviewDraft = findExistingDraftByFingerprint(
        workbook,
        'ledgerReview',
        reviewFingerprint,
        normalizeLedgerReviewPayload
      );
      if (existingReviewDraft && isAiDraftResolved(existingReviewDraft)) {
        skippedResolvedDrafts.push(existingReviewDraft);
        return;
      }
      const draft =
        existingReviewDraft ||
        normalizeAiDraft(
          {
            id: getStableArtifactId(
              'ai_draft_category_review',
              { requestId, traceId, createId },
              result,
              index
            ),
            status: 'pending',
            operation: 'edit',
            objectType: 'ledgerReview',
            title: 'Category review needed',
            summary: review.summary || 'Review category assignments before applying cleanup.',
            proposed: review,
            source: {
              type: 'advisor_tool',
              toolName: asString(result.toolName || result.tool_name),
              toolCallId: asString(result.toolCallId || result.tool_call_id),
              requestId: asString(requestId),
              traceId: asString(traceId),
              taskSpecId,
              proposalKind: 'category_review'
            },
            sourceRefs: uniqueStrings(
              []
                .concat(result.sourceRefs || result.source_refs || [])
                .concat(review.sourceRefs || [])
                .concat(requestId ? ['advisor:request:' + asString(requestId)] : [])
                .concat(traceId ? ['advisor:trace:' + asString(traceId)] : [])
                .concat(result.toolCallId ? ['advisor:tool:' + asString(result.toolCallId)] : [])
            ),
            confidence: 0.5,
            reason:
              'Advisor found category evidence to review, but not enough safe cleanup changes to apply. Classify these rows first, then prepare cleanup again.',
            createdAt: timestamp
          },
          drafts.length,
          { createdAt: timestamp, createId }
        );
      if (existingReviewDraft) {
        reusedDrafts.push(existingReviewDraft);
      }
      const group = buildGroupForDraft({
        draft,
        result,
        taskSpecId,
        summary: draft.summary,
        impactPreview: {
          affectedTransactions: review.counts.reviewItemCount,
          categoriesCreated: 0,
          categoriesRenamed: 0,
          categoriesArchived: 0
        },
        groupId: getStableArtifactId(
          'ai_draft_group_category_review',
          { requestId, traceId, createId },
          result,
          index
        ),
        createId
      });
      drafts.push(draft);
      draftGroups.push(group);
      return;
    }
    const cleanupFingerprint = getCleanupFingerprint(cleanup);
    const existingCleanupDraft = findExistingDraftByFingerprint(
      workbook,
      'ledgerCleanup',
      cleanupFingerprint,
      normalizeLedgerCleanupPayload
    );
    if (existingCleanupDraft && isAiDraftResolved(existingCleanupDraft)) {
      skippedResolvedDrafts.push(existingCleanupDraft);
      return;
    }
    if (existingCleanupDraft) {
      reusedDrafts.push(existingCleanupDraft);
      const group = buildGroupForDraft({
        draft: existingCleanupDraft,
        result,
        taskSpecId,
        summary: existingCleanupDraft.summary || getDraftSummary(cleanup, data),
        impactPreview: getImpactPreview(cleanup, data),
        groupId: getStableArtifactId(
          'ai_draft_group_category_cleanup',
          { requestId, traceId, createId },
          result,
          index
        ),
        createId
      });
      drafts.push(existingCleanupDraft);
      draftGroups.push(group);
      return;
    }
    const draftId = getStableArtifactId(
      'ai_draft_category_cleanup',
      { requestId, traceId, createId },
      result,
      index
    );
    const groupId = getStableArtifactId(
      'ai_draft_group_category_cleanup',
      { requestId, traceId, createId },
      result,
      index
    );
    const summary = getDraftSummary(cleanup, data);
    const sourceRefs = uniqueStrings(
      []
        .concat(result.sourceRefs || result.source_refs || [])
        .concat(getLedgerCleanupSourceRefsFromPayload(cleanup))
        .concat(requestId ? ['advisor:request:' + asString(requestId)] : [])
        .concat(traceId ? ['advisor:trace:' + asString(traceId)] : [])
        .concat(result.toolCallId ? ['advisor:tool:' + asString(result.toolCallId)] : [])
    );
    const draft = normalizeAiDraft(
      {
        id: draftId,
        status: 'pending',
        operation: 'edit',
        objectType: 'ledgerCleanup',
        title: 'Category cleanup proposal',
        summary,
        proposed: cleanup,
        source: {
          type: 'advisor_tool',
          toolName: asString(result.toolName || result.tool_name),
          toolCallId: asString(result.toolCallId || result.tool_call_id),
          requestId: asString(requestId),
          traceId: asString(traceId),
          taskSpecId,
          proposalKind: 'category_cleanup'
        },
        sourceRefs,
        confidence: Number(data.candidate_count || 0) > 0 ? 0.72 : 0.62,
        reason: getCleanupReason(cleanup, data),
        createdAt: timestamp
      },
      drafts.length,
      { createdAt: timestamp, createId }
    );
    const group = buildGroupForDraft({
      draft,
      result,
      taskSpecId,
      summary,
      impactPreview: getImpactPreview(cleanup, data),
      groupId,
      createId
    });
    drafts.push(draft);
    draftGroups.push(group);
  });
  return { drafts, draftGroups, reusedDrafts, skippedResolvedDrafts };
}

export function mergeAdvisorPreparedDraftGroups(previewGroups, preparedGroups) {
  const prepared = normalizeAdvisorDraftGroups(preparedGroups);
  if (!prepared.length) {
    return Array.isArray(previewGroups) ? previewGroups : [];
  }
  const preparedKeys = {};
  const preparedTitles = {};
  prepared.forEach((group) => {
    preparedKeys[asString(group.taskSpecId) + ':' + asString(group.title).toLowerCase()] = true;
    preparedTitles[asString(group.title).toLowerCase()] = true;
  });
  const previews = (Array.isArray(previewGroups) ? previewGroups : []).filter((group) => {
    const key =
      asString(group && group.taskSpecId) + ':' + asString(group && group.title).toLowerCase();
    const hasDraftIds = Array.isArray(group && group.draftIds) && group.draftIds.length;
    const title = asString(group && group.title).toLowerCase();
    return hasDraftIds || (!preparedKeys[key] && !preparedTitles[title]);
  });
  return previews.concat(prepared);
}

export function persistAdvisorPreparedDraftsToWorkbook(workbook, prepared, options = {}) {
  const drafts = normalizeAiDrafts(prepared && prepared.drafts, options);
  const draftGroups = normalizeAdvisorDraftGroups(prepared && prepared.draftGroups, options);
  if (!workbook) {
    return { drafts, draftGroups };
  }
  const existingDrafts = normalizeAiDrafts(workbook.aiDrafts, options);
  const incomingById = {};
  drafts.forEach((draft) => {
    incomingById[draft.id] = draft;
  });
  const nextDrafts = existingDrafts.filter((draft) => {
    const incoming = incomingById[draft.id];
    if (!incoming) {
      return true;
    }
    return isAiDraftResolved(draft);
  });
  drafts.forEach((draft) => {
    const existing = existingDrafts.find((item) => item.id === draft.id);
    if (existing && isAiDraftResolved(existing)) {
      return;
    }
    nextDrafts.push(draft);
  });
  workbook.aiDrafts = nextDrafts;
  workbook.advisorDraftGroups = upsertAdvisorDraftGroups(
    workbook.advisorDraftGroups,
    draftGroups,
    options
  );
  return { drafts, draftGroups };
}

export function filterAdvisorActionsForPreparedDrafts(actions, prepared = {}) {
  const preparedDrafts = normalizeAiDrafts(prepared.drafts);
  const skippedResolvedDrafts = normalizeAiDrafts(prepared.skippedResolvedDrafts);
  const hasPreparedReviewArtifact = preparedDrafts.some(
    (draft) => draft.objectType === 'ledgerCleanup' || draft.objectType === 'ledgerReview'
  );
  const hasReviewedCleanupArtifact = skippedResolvedDrafts.some(
    (draft) => draft.objectType === 'ledgerCleanup'
  );
  const hasCleanupDraft = preparedDrafts.some((draft) => draft.objectType === 'ledgerCleanup');
  return (Array.isArray(actions) ? actions : []).filter((action) => {
    if (!(action && action.id)) {
      return false;
    }
    if (
      (hasPreparedReviewArtifact || hasReviewedCleanupArtifact) &&
      action.id === 'prepare_category_cleanup_draft'
    ) {
      return false;
    }
    if (
      hasPreparedReviewArtifact &&
      !hasCleanupDraft &&
      action.id === 'compare_before_after_categories'
    ) {
      return false;
    }
    return true;
  });
}
