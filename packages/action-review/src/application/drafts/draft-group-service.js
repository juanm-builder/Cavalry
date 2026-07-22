import {
  createDraftGroup,
  ensureExternalDraftCollections,
  findExternalDraftGroup,
  persistExternalDraftGroup,
  summarizeDraftItems
} from './draft-group-model.js';
import { detectDraftGroupConflicts } from './draft-conflict-service.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isReviewableStatus(status) {
  return ['pending_review', 'partially_ready', 'needs_info', 'blocked'].includes(asString(status));
}

export function createLocalDraftGroup({
  workbook,
  title,
  drafts,
  origin = {},
  validationIssues,
  createId,
  now
} = {}) {
  ensureExternalDraftCollections(workbook);
  const group = createDraftGroup({
    workbook,
    title,
    origin: Object.assign(
      {
        origin: 'local_dev_api',
        provider: 'local'
      },
      origin || {}
    ),
    drafts,
    validationIssues,
    createId,
    now
  });
  return persistExternalDraftGroup(workbook, group);
}

export function listDraftGroupsForReview(workbook, options = {}) {
  const includeResolved = options.includeResolved === true;
  return asArray(workbook && workbook.externalDraftGroups)
    .filter((group) => includeResolved || isReviewableStatus(group && group.status))
    .filter((group) => options.includeHidden === true || !group.hidden_at)
    .slice()
    .sort((a, b) => asString(b && b.created_at).localeCompare(asString(a && a.created_at)));
}

export function buildDraftGroupReviewModel(workbook, draftGroupId, options = {}) {
  const group = findExternalDraftGroup(workbook, draftGroupId);
  if (!group) {
    return {
      ok: false,
      code: 'draft_group_not_found',
      message: 'Draft group was not found.',
      group: null,
      drafts: []
    };
  }
  const conflictResult = detectDraftGroupConflicts(workbook, group, {
    requireReady: false,
    selectedDraftIds: options.selectedDraftIds
  });
  const summary = summarizeDraftItems(group.drafts || []);
  return {
    ok: true,
    code: 'ok',
    message: '',
    group,
    draftGroupId: group.draft_group_id,
    title: group.title,
    status: group.status,
    reviewUrl: group.review_url,
    summary,
    drafts: asArray(group.drafts).map((draft) => ({
      draftId: draft.draft_id,
      type: draft.type,
      status: draft.status,
      title: draft.title,
      summary: draft.display_summary,
      proposedValues: draft.proposed_values || {},
      validationIssues: draft.validation_issues || [],
      conflicts: conflictResult.conflicts.filter(
        (conflict) => asString(conflict.draft_id) === asString(draft.draft_id)
      )
    })),
    canApply:
      isReviewableStatus(group.status) &&
      summary.ready > 0 &&
      conflictResult.blockingConflicts.length === 0,
    canReject: isReviewableStatus(group.status),
    conflicts: conflictResult.conflicts,
    blockingConflicts: conflictResult.blockingConflicts,
    warningConflicts: conflictResult.warningConflicts
  };
}

export function hideDraftGroup(workbook, draftGroupId, options = {}) {
  const group = findExternalDraftGroup(workbook, draftGroupId);
  if (!group) {
    throw new Error('Draft group was not found.');
  }
  if (!['rejected', 'applied', 'expired'].includes(asString(group.status))) {
    throw new Error('Only resolved draft groups can be hidden.');
  }
  group.hidden_at = typeof options.now === 'function' ? options.now() : new Date().toISOString();
  return group;
}
