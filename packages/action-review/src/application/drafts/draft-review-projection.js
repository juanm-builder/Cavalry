// Keeps renderer-facing draft review data separate from Node-only draft fingerprinting.

const REVIEWABLE_GROUP_STATUSES = Object.freeze([
  'pending_review',
  'partially_ready',
  'needs_info',
  'blocked'
]);

const DRAFT_ITEM_STATUSES = Object.freeze(['ready', 'needs_review', 'needs_info', 'blocked']);

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clonePlain(value) {
  if (value == null) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function getDraftId(draft) {
  return asString(draft && (draft.draft_id || draft.draftId || draft.id));
}

function getDraftStatus(draft) {
  const status = asString(draft && draft.status);
  return DRAFT_ITEM_STATUSES.includes(status) ? status : 'blocked';
}

function getIssueSeverity(issue) {
  return asString(issue && issue.severity) || 'blocked';
}

function isBlockingIssue(issue) {
  const severity = getIssueSeverity(issue);
  return severity !== 'warning' && severity !== 'info';
}

function findExternalDraftGroup(workbook, draftGroupId) {
  const id = asString(draftGroupId);
  return (
    asArray(workbook && workbook.externalDraftGroups).find(
      (group) => asString(group && group.draft_group_id) === id
    ) || null
  );
}

function getDraftConflicts(draft, conflicts) {
  const draftId = getDraftId(draft);
  return asArray(conflicts).filter((conflict) => {
    return asString(conflict && (conflict.draft_id || conflict.draftId)) === draftId;
  });
}

function summarizeDraftItems(drafts) {
  return asArray(drafts).reduce(
    (summary, draft) => {
      const status = getDraftStatus(draft);
      summary.total += 1;
      summary[status] += 1;
      return summary;
    },
    {
      total: 0,
      ready: 0,
      needs_review: 0,
      needs_info: 0,
      blocked: 0
    }
  );
}

export function isDraftGroupReviewableStatus(status) {
  return REVIEWABLE_GROUP_STATUSES.includes(asString(status));
}

export function getDraftGroupIssueCounts(group, conflicts = [], _options = {}) {
  const drafts = asArray(group && group.drafts);
  const groupValidationIssues = asArray(
    group && (group.validation_issues || group.validationIssues)
  );
  const draftValidationIssues = drafts.flatMap((draft) => {
    return asArray(draft && (draft.validation_issues || draft.validationIssues));
  });
  const allValidationIssues = groupValidationIssues.concat(draftValidationIssues);
  const conflictList = asArray(conflicts);
  const blockingConflicts = conflictList.filter(isBlockingIssue);
  const warningConflicts = conflictList.filter(
    (conflict) => getIssueSeverity(conflict) === 'warning'
  );
  const infoConflicts = conflictList.filter((conflict) => getIssueSeverity(conflict) === 'info');
  return {
    total: allValidationIssues.length + conflictList.length,
    validationIssues: allValidationIssues.length,
    groupValidationIssues: groupValidationIssues.length,
    draftValidationIssues: draftValidationIssues.length,
    conflicts: conflictList.length,
    blockingConflicts: blockingConflicts.length,
    warningConflicts: warningConflicts.length,
    infoConflicts: infoConflicts.length
  };
}

export function summarizeDraftGroupForReview(group, conflicts = [], options = {}) {
  const source = group && typeof group === 'object' ? group : {};
  const draftGroupId = asString(source.draft_group_id || source.draftGroupId);
  const status = asString(source.status) || 'blocked';
  const summary = summarizeDraftItems(source.drafts);
  const issueCounts = getDraftGroupIssueCounts(source, conflicts, options);
  const blockingConflicts = asArray(conflicts).filter(isBlockingIssue);
  const warningConflicts = asArray(conflicts).filter((conflict) => {
    return getIssueSeverity(conflict) === 'warning';
  });
  const reviewable = isDraftGroupReviewableStatus(status);
  const drafts = asArray(source.drafts).map((draft) => {
    const draftConflicts = getDraftConflicts(draft, conflicts);
    return {
      draftId: getDraftId(draft),
      type: asString(draft && draft.type) || 'transaction',
      status: getDraftStatus(draft),
      title: asString(draft && draft.title) || 'Draft',
      summary: asString(draft && (draft.display_summary || draft.displaySummary)),
      proposedValues: clonePlain(draft && (draft.proposed_values || draft.proposedValues || {})),
      originalValues: clonePlain(
        draft && (draft.original_values || draft.originalValues || undefined)
      ),
      validationIssues: clonePlain(
        asArray(draft && (draft.validation_issues || draft.validationIssues))
      ),
      duplicateCandidates: clonePlain(
        asArray(draft && (draft.duplicate_candidates || draft.duplicateCandidates))
      ),
      conflicts: clonePlain(draftConflicts)
    };
  });

  return {
    draftGroupId,
    title: asString(source.title) || 'Draft group',
    status,
    reviewUrl: asString(source.review_url || source.reviewUrl),
    createdAt: asString(source.created_at || source.createdAt),
    origin: clonePlain(source.origin || null),
    hiddenAt: asString(source.hidden_at || source.hiddenAt) || null,
    summary,
    issueCounts,
    reviewable,
    canApply: reviewable && summary.ready > 0 && blockingConflicts.length === 0,
    canReject: reviewable,
    validationIssues: clonePlain(asArray(source.validation_issues || source.validationIssues)),
    conflicts: clonePlain(asArray(conflicts)),
    blockingConflicts: clonePlain(blockingConflicts),
    warningConflicts: clonePlain(warningConflicts),
    drafts
  };
}

export function buildDraftGroupReviewProjection(workbook, draftGroupId, options = {}) {
  const id = asString(draftGroupId);
  const group = findExternalDraftGroup(workbook, id);
  if (!group) {
    return {
      ok: false,
      code: 'draft_group_not_found',
      message: 'Draft group was not found.',
      draftGroupId: id,
      title: '',
      status: 'missing',
      reviewable: false,
      canApply: false,
      canReject: false,
      summary: summarizeDraftItems([]),
      issueCounts: getDraftGroupIssueCounts(null, []),
      drafts: [],
      conflicts: [],
      blockingConflicts: [],
      warningConflicts: []
    };
  }

  const conflicts =
    options.conflictResult && Array.isArray(options.conflictResult.conflicts)
      ? options.conflictResult.conflicts
      : asArray(options.conflicts);
  return Object.assign(
    {
      ok: true,
      code: 'ok',
      message: ''
    },
    summarizeDraftGroupForReview(group, conflicts, options)
  );
}
