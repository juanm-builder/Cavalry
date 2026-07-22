import { isAiDraftVisibleAfterGate } from '../advisor/draft-review-gate.js';

const ACTIVE_DRAFT_STATUSES = Object.freeze(['pending', 'needs_fix', 'failed']);

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getDraftId(draft) {
  return asString(draft && draft.id);
}

function uniqueIds(values) {
  const seen = {};
  return asArray(values)
    .map(asString)
    .filter(Boolean)
    .filter((id) => {
      if (seen[id]) {
        return false;
      }
      seen[id] = true;
      return true;
    });
}

function pluralizeDraft(count, singularCopy, pluralCopy) {
  return String(count) + ' ' + (count === 1 ? singularCopy : pluralCopy);
}

function normalizeValidation(result) {
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

function getDisplayValidation(workbook, draft, options = {}) {
  const draftId = getDraftId(draft);
  const validations = options.validationByDraftId || {};
  if (draftId && Object.prototype.hasOwnProperty.call(validations, draftId)) {
    return normalizeValidation(validations[draftId]);
  }
  if (typeof options.validateDraft === 'function') {
    return normalizeValidation(options.validateDraft(workbook, draft));
  }
  return { ok: true, error: '' };
}

function getSortedDrafts(workbook) {
  return asArray(workbook && workbook.aiDrafts)
    .slice()
    .sort((a, b) => {
      return asString(b && b.createdAt).localeCompare(asString(a && a.createdAt));
    });
}

function getDraftIds(drafts) {
  return asArray(drafts).map(getDraftId).filter(Boolean);
}

function getDraftMap(drafts) {
  const map = {};
  asArray(drafts).forEach((draft) => {
    const id = getDraftId(draft);
    if (id) {
      map[id] = draft;
    }
  });
  return map;
}

export function getAiDraftStatusLabel(status) {
  const map = {
    pending: 'Pending',
    needs_fix: 'Needs Fix',
    failed: 'Needs Fix',
    confirmed: 'Confirmed',
    rejected: 'Rejected'
  };
  return map[asString(status)] || 'Pending';
}

export function getAiDraftStatusTone(status) {
  if (status === 'confirmed') return 'posted';
  if (status === 'rejected') return 'dismissed';
  if (status === 'needs_fix' || status === 'failed') return 'needs_info';
  return 'draft';
}

export function getAdvisorDraftGroupStatusLabel(status) {
  const map = {
    pending: 'Pending',
    partially_reviewed: 'Partially reviewed',
    confirmed: 'Confirmed',
    rejected: 'Rejected'
  };
  return map[asString(status)] || 'Pending';
}

export function getAdvisorDraftGroupStatusTone(status) {
  if (status === 'confirmed') return 'good';
  if (status === 'rejected') return 'bad';
  if (status === 'partially_reviewed') return 'warn';
  return 'info';
}

export function buildDraftReviewCommandBarViewModel(input = {}) {
  const readyCount = Math.max(0, Number(input.readyCount || 0) || 0);
  const needsFixCount = Math.max(0, Number(input.needsFixCount || 0) || 0);
  const confirmedCount = Math.max(0, Number(input.confirmedCount || 0) || 0);
  const rejectedCount = Math.max(0, Number(input.rejectedCount || 0) || 0);
  const openCount = readyCount + needsFixCount;
  return {
    title: openCount
      ? pluralizeDraft(openCount, 'draft needs your decision', 'drafts need your decision')
      : 'No drafts need review',
    copy: openCount
      ? needsFixCount
        ? 'Some drafts need one more detail. Nothing changes until you apply a draft.'
        : 'Review the ready draft' +
          (readyCount === 1 ? '' : 's') +
          ', then apply, save for later, or reject.'
      : 'The review queue is clear.',
    showActions: openCount > 0,
    metrics: [
      { id: 'ready', label: 'Ready', count: readyCount, icon: 'task_alt', tone: 'posted' },
      {
        id: 'needs_fix',
        label: 'Needs details',
        count: needsFixCount,
        icon: 'help',
        tone: 'needs_info'
      },
      {
        id: 'confirmed',
        label: 'Applied',
        count: confirmedCount,
        icon: 'check_circle',
        tone: 'posted'
      },
      { id: 'rejected', label: 'Dismissed', count: rejectedCount, icon: 'block', tone: 'dismissed' }
    ]
  };
}

export function buildDraftReviewQueueViewModel(draftIds, options = {}) {
  const ids = uniqueIds(draftIds);
  const showAll = options.showAll === true;
  const visibleDraftIds = showAll ? ids : ids.slice(0, 5);
  const hiddenCount = Math.max(0, ids.length - visibleDraftIds.length);
  return {
    totalCount: ids.length,
    subtitle:
      ids.length === 1
        ? 'One draft needs your decision.'
        : String(ids.length) + ' drafts need your decision.',
    visibleDraftIds,
    hiddenCount,
    showToggle: ids.length > 5,
    toggleCopy: showAll
      ? 'Showing all ' + String(ids.length)
      : 'Showing 5 of ' + String(ids.length),
    toggleIcon: showAll ? 'visibility_off' : 'visibility',
    toggleLabel: showAll ? 'Show first 5' : 'View all ' + String(ids.length)
  };
}

export function buildDraftReviewQueueGroupViewModels(groups, drafts, options = {}) {
  const draftMap = getDraftMap(drafts);
  const activeIds = {};
  uniqueIds(options.reviewDraftIds || getDraftIds(drafts)).forEach((id) => {
    activeIds[id] = true;
  });
  const selectedDraftId = asString(options.selectedDraftId);
  return asArray(groups)
    .filter((group) => {
      return asArray(group && group.draftIds).some((draftId) => activeIds[asString(draftId)]);
    })
    .map((group) => {
      const draftIdsForGroup = asArray(group && group.draftIds)
        .map(asString)
        .filter((draftId) => draftId && draftMap[draftId]);
      const firstDraftId =
        draftIdsForGroup.find((draftId) => activeIds[draftId]) || draftIdsForGroup[0] || '';
      const status = asString(group && group.status) || 'pending';
      return {
        groupId: asString(group && group.groupId),
        title: asString(group && group.title) || 'Draft group',
        status,
        statusLabel: getAdvisorDraftGroupStatusLabel(status),
        statusTone: getAdvisorDraftGroupStatusTone(status),
        draftCount: draftIdsForGroup.length,
        firstDraftId,
        active: !!(firstDraftId && firstDraftId === selectedDraftId)
      };
    });
}

export function buildDraftReviewRouteViewModel(workbook, options = {}) {
  const drafts = getSortedDrafts(workbook);
  const activeDrafts = drafts.filter((draft) => {
    return (
      ACTIVE_DRAFT_STATUSES.indexOf(asString(draft && draft.status)) >= 0 &&
      isAiDraftVisibleAfterGate(draft)
    );
  });
  const readyDraftIds = getDraftIds(
    activeDrafts.filter((draft) => {
      return getDisplayValidation(workbook, draft, options).ok;
    })
  );
  const needsFixDraftIds = getDraftIds(
    activeDrafts.filter((draft) => {
      return !getDisplayValidation(workbook, draft, options).ok;
    })
  );
  const confirmedDraftIds = getDraftIds(
    drafts.filter((draft) => draft && draft.status === 'confirmed')
  );
  const rejectedDraftIds = getDraftIds(
    drafts.filter((draft) => draft && draft.status === 'rejected')
  );
  const reviewDraftIds = needsFixDraftIds.concat(readyDraftIds);
  const requestedSelectedDraftId = asString(options.selectedDraftId);
  const selectedDraftId =
    reviewDraftIds.indexOf(requestedSelectedDraftId) >= 0
      ? requestedSelectedDraftId
      : reviewDraftIds[0] || '';
  const commandBar = buildDraftReviewCommandBarViewModel({
    readyCount: readyDraftIds.length,
    needsFixCount: needsFixDraftIds.length,
    confirmedCount: confirmedDraftIds.length,
    rejectedCount: rejectedDraftIds.length
  });
  return {
    draftIds: getDraftIds(drafts),
    activeDraftIds: getDraftIds(activeDrafts),
    readyDraftIds,
    needsFixDraftIds,
    confirmedDraftIds,
    rejectedDraftIds,
    openCount: readyDraftIds.length + needsFixDraftIds.length,
    reviewDraftIds,
    selectedDraftId,
    hasOpenDrafts: reviewDraftIds.length > 0,
    commandBar,
    queue: buildDraftReviewQueueViewModel(reviewDraftIds, {
      showAll: options.showAll
    })
  };
}
