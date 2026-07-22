// Shared draft lifecycle rules for reviewable workbook changes.

export const AI_DRAFT_STATUSES = ['pending', 'needs_fix', 'confirmed', 'rejected', 'failed'];
export const AI_DRAFT_OPERATIONS = ['create', 'edit', 'archive', 'delete'];
export const AI_DRAFT_OBJECT_TYPES = [
  'transaction',
  'account',
  'category',
  'counterparty',
  'billSubscription',
  'recurringItem',
  'budget',
  'ledgerCleanup',
  'ledgerReview'
];
export const AI_DRAFT_ACTIVE_STATUSES = ['pending', 'needs_fix', 'failed'];
export const AI_DRAFT_RESOLVED_STATUSES = ['confirmed', 'rejected'];
export const AI_DRAFT_GROUP_STATUSES = ['pending', 'partially_reviewed', 'confirmed', 'rejected'];

function titleCaseLabel(value, fallback) {
  const source = String(value || fallback || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!source) {
    return '';
  }
  return source
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeErrorMessage(error) {
  return String(error && error.message ? error.message : error || '').trim();
}

function createFallbackId(prefix) {
  return String(prefix || 'id');
}

export function normalizeAiDraftPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return { ...value };
  }
}

export function normalizeAiDraft(draft, index = 0, options = {}) {
  const source = draft && typeof draft === 'object' ? draft : {};
  const createId = typeof options.createId === 'function' ? options.createId : createFallbackId;
  const createdAt = options.createdAt || new Date().toISOString();
  const status = AI_DRAFT_STATUSES.includes(String(source.status || ''))
    ? String(source.status)
    : 'pending';
  const operation = AI_DRAFT_OPERATIONS.includes(String(source.operation || ''))
    ? String(source.operation)
    : 'create';
  const objectType = AI_DRAFT_OBJECT_TYPES.includes(
    String(source.objectType || source.object_type || '')
  )
    ? String(source.objectType || source.object_type)
    : 'transaction';
  const sourceRefs = Array.isArray(source.sourceRefs)
    ? source.sourceRefs
    : Array.isArray(source.source_refs)
      ? source.source_refs
      : [];
  return {
    id: String(source.id || createId('ai_draft_' + index)),
    status,
    operation,
    objectType,
    targetId: String(source.targetId || source.target_id || '').trim(),
    title: String(
      source.title || titleCaseLabel(operation, 'Draft') + ' ' + titleCaseLabel(objectType, 'Item')
    ).trim(),
    summary: String(source.summary || '').trim(),
    proposed: normalizeAiDraftPayload(source.proposed),
    before: normalizeAiDraftPayload(source.before),
    source: normalizeAiDraftPayload(source.source),
    sourceRefs: sourceRefs.map((ref) => String(ref || '').trim()).filter(Boolean),
    confidence: Math.max(0, Math.min(1, Number(source.confidence || 0) || 0)),
    reason: String(source.reason || '').trim(),
    createdAt: String(source.createdAt || source.created_at || createdAt),
    resolvedAt: String(source.resolvedAt || source.resolved_at || '').trim(),
    resultObjectId: String(source.resultObjectId || source.result_object_id || '').trim(),
    snapshotId: String(source.snapshotId || source.snapshot_id || '').trim(),
    error: String(source.error || '').trim()
  };
}

export function normalizeAiDrafts(value, options = {}) {
  return (Array.isArray(value) ? value : [])
    .map((draft, index) => normalizeAiDraft(draft, index, options))
    .filter(
      (draft) =>
        draft.id &&
        AI_DRAFT_OPERATIONS.includes(draft.operation) &&
        AI_DRAFT_OBJECT_TYPES.includes(draft.objectType)
    );
}

function normalizeDraftGroupImpactPreview(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    affectedTransactions: Math.max(
      0,
      Math.round(Number(source.affectedTransactions || source.affected_transactions || 0) || 0)
    ),
    categoriesCreated: Math.max(
      0,
      Math.round(Number(source.categoriesCreated || source.categories_created || 0) || 0)
    ),
    categoriesRenamed: Math.max(
      0,
      Math.round(Number(source.categoriesRenamed || source.categories_renamed || 0) || 0)
    ),
    categoriesArchived: Math.max(
      0,
      Math.round(Number(source.categoriesArchived || source.categories_archived || 0) || 0)
    )
  };
}

export function normalizeAdvisorDraftGroup(group, index = 0, options = {}) {
  const source = group && typeof group === 'object' ? group : {};
  const createId = typeof options.createId === 'function' ? options.createId : createFallbackId;
  const status = AI_DRAFT_GROUP_STATUSES.includes(String(source.status || ''))
    ? String(source.status)
    : 'pending';
  const draftIds = (
    Array.isArray(source.draftIds)
      ? source.draftIds
      : Array.isArray(source.draft_ids)
        ? source.draft_ids
        : []
  )
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  return {
    groupId: String(source.groupId || source.group_id || createId('ai_draft_group_' + index)),
    taskSpecId: String(source.taskSpecId || source.task_spec_id || '').trim(),
    title: String(source.title || 'Advisor draft group').trim(),
    summary: String(source.summary || '').trim(),
    draftIds,
    status,
    impactPreview: normalizeDraftGroupImpactPreview(source.impactPreview || source.impact_preview)
  };
}

export function normalizeAdvisorDraftGroups(value, options = {}) {
  return (Array.isArray(value) ? value : [])
    .map((group, index) => normalizeAdvisorDraftGroup(group, index, options))
    .filter((group) => group.groupId && group.draftIds.length);
}

export function isAiDraftActive(draft) {
  return AI_DRAFT_ACTIVE_STATUSES.includes(String((draft && draft.status) || ''));
}

export function isAiDraftResolved(draft) {
  return AI_DRAFT_RESOLVED_STATUSES.includes(String((draft && draft.status) || ''));
}

export function getAiDrafts(workbook) {
  return Array.isArray(workbook && workbook.aiDrafts) ? workbook.aiDrafts : [];
}

export function getAdvisorDraftGroups(workbook) {
  return Array.isArray(workbook && workbook.advisorDraftGroups) ? workbook.advisorDraftGroups : [];
}

export function findAiDraftById(workbook, draftId) {
  const id = String(draftId || '').trim();
  if (!id) {
    return null;
  }
  return getAiDrafts(workbook).find((draft) => draft.id === id) || null;
}

export function findAdvisorDraftGroupById(workbook, groupId) {
  const id = String(groupId || '').trim();
  if (!id) {
    return null;
  }
  return getAdvisorDraftGroups(workbook).find((group) => group.groupId === id) || null;
}

export function findAdvisorDraftGroupsForDraft(workbook, draftId) {
  const id = String(draftId || '').trim();
  if (!id) {
    return [];
  }
  return getAdvisorDraftGroups(workbook).filter(
    (group) => Array.isArray(group.draftIds) && group.draftIds.includes(id)
  );
}

export function getAdvisorDraftGroupStatusForDrafts(drafts) {
  const list = (Array.isArray(drafts) ? drafts : []).filter(Boolean);
  if (!list.length) {
    return 'pending';
  }
  const resolved = list.filter(isAiDraftResolved);
  if (!resolved.length) {
    return 'pending';
  }
  if (resolved.length < list.length) {
    return 'partially_reviewed';
  }
  if (list.every((draft) => draft.status === 'confirmed')) {
    return 'confirmed';
  }
  if (list.every((draft) => draft.status === 'rejected')) {
    return 'rejected';
  }
  return 'partially_reviewed';
}

export function refreshAdvisorDraftGroupStatuses(workbook, options = {}) {
  if (!workbook) {
    return [];
  }
  const drafts = getAiDrafts(workbook);
  const groups = normalizeAdvisorDraftGroups(workbook.advisorDraftGroups, options).map(
    (group, index) => {
      const memberDrafts = group.draftIds
        .map((draftId) => drafts.find((draft) => draft.id === draftId) || null)
        .filter(Boolean);
      return normalizeAdvisorDraftGroup(
        Object.assign({}, group, {
          status: getAdvisorDraftGroupStatusForDrafts(memberDrafts)
        }),
        index,
        options
      );
    }
  );
  workbook.advisorDraftGroups = groups;
  return groups;
}

export function upsertAdvisorDraftGroups(existingGroups, nextGroups, options = {}) {
  const existing = normalizeAdvisorDraftGroups(existingGroups, options);
  const incoming = normalizeAdvisorDraftGroups(nextGroups, options);
  const byId = {};
  existing.forEach((group) => {
    byId[group.groupId] = group;
  });
  incoming.forEach((group) => {
    byId[group.groupId] = group;
  });
  return existing
    .filter((group) => incoming.every((item) => item.groupId !== group.groupId))
    .concat(incoming)
    .filter((group) => byId[group.groupId]);
}

export function findAiDraftBySourceRef(workbook, sourceRef) {
  const ref = String(sourceRef || '').trim();
  if (!ref) {
    return null;
  }
  return (
    getAiDrafts(workbook).find(
      (draft) => Array.isArray(draft.sourceRefs) && draft.sourceRefs.includes(ref)
    ) || null
  );
}

export function getAdvisorDraftReference(draftId) {
  return 'advisor:draft:' + String(draftId || '').trim();
}

export function getAdvisorActionSourceRef(threadId, messageId, actionId) {
  return (
    'advisor:' +
    String(threadId || 'thread') +
    ':' +
    String(messageId || 'message') +
    ':' +
    String(actionId || 'action')
  );
}

export function getAiDraftStatusFromAdvisorAction(action) {
  const status = String((action && action.status) || '');
  if (status === 'draft') {
    return 'pending';
  }
  if (status === 'posted') {
    return 'confirmed';
  }
  if (status === 'dismissed') {
    return 'rejected';
  }
  return 'needs_fix';
}

export function buildResolvedAdvisorActionUpdate(draft, action = {}) {
  if (!isAiDraftResolved(draft)) {
    return null;
  }
  if (draft.status === 'confirmed') {
    return {
      status: 'posted',
      postedTransactionId: draft.resultObjectId || action.postedTransactionId || ''
    };
  }
  return { status: 'dismissed' };
}

export function getUnknownAiDraftSourceRefs(workbook, draft) {
  const refs = Array.isArray(draft && draft.sourceRefs) ? draft.sourceRefs : [];
  const transactionIds = new Set(
    ((workbook && workbook.transactions) || []).map((transaction) => transaction.id)
  );
  const accountIds = new Set(((workbook && workbook.accounts) || []).map((account) => account.id));
  const categoryIds = new Set(
    ((workbook && workbook.categories) || []).map((category) => category.id)
  );
  const counterpartyIds = new Set(
    ((workbook && workbook.counterparties) || []).map((counterparty) => counterparty.id)
  );
  const recurringIds = new Set(
    ((workbook && workbook.recurringItems) || []).map((item) => item.id)
  );
  const sheetIds = new Set(((workbook && workbook.sheets) || []).map((sheet) => sheet.id));
  return refs.filter((ref) => {
    if (/^advisor:/.test(ref) || /^advisor-message:/.test(ref)) {
      return false;
    }
    const parts = String(ref).split(':');
    const type = parts[0];
    const id = parts.slice(1).join(':');
    if (type === 'transaction') return !transactionIds.has(id);
    if (type === 'account') return !accountIds.has(id);
    if (type === 'category') return !categoryIds.has(id);
    if (type === 'counterparty') return !counterpartyIds.has(id);
    if (type === 'recurringItem' || type === 'billSubscription') return !recurringIds.has(id);
    if (type === 'budget') return id && !sheetIds.has(id.split(':')[0]);
    if (type === 'sheet') return id && !sheetIds.has(id);
    return false;
  });
}

export function validateAiDraftSourceRefs(workbook, draft) {
  const unknown = getUnknownAiDraftSourceRefs(workbook, draft);
  return unknown.length ? 'Unknown source references: ' + unknown.join(', ') : '';
}

export function buildAiDraftResolutionUpdate(status, options = {}) {
  const resolvedAt = String(options.resolvedAt || new Date().toISOString());
  if (status === 'confirmed') {
    const update = {
      status: 'confirmed',
      resolvedAt,
      error: ''
    };
    if (Object.prototype.hasOwnProperty.call(options, 'resultObjectId')) {
      update.resultObjectId = String(options.resultObjectId || '');
    }
    if (Object.prototype.hasOwnProperty.call(options, 'snapshotId')) {
      update.snapshotId = String(options.snapshotId || '');
    }
    return update;
  }
  if (status === 'rejected') {
    return {
      status: 'rejected',
      resolvedAt,
      error: ''
    };
  }
  if (status === 'needs_fix') {
    return {
      status: 'needs_fix',
      error: normalizeErrorMessage(options.error)
    };
  }
  if (status === 'failed') {
    return {
      status: 'failed',
      snapshotId: String(options.snapshotId || ''),
      error: normalizeErrorMessage(options.error)
    };
  }
  throw new Error('Unsupported AI draft resolution status.');
}

export function findTransactionByReference(workbook, reference) {
  const ref = String(reference || '').trim();
  if (!ref) {
    return null;
  }
  return (
    (workbook && workbook.transactions ? workbook.transactions : []).find(
      (transaction) => String((transaction && transaction.reference) || '') === ref
    ) || null
  );
}
