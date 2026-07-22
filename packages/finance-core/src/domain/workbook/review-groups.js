export const WORKBOOK_REVIEW_GROUP_STATUSES = Object.freeze([
  'pending',
  'partially_reviewed',
  'confirmed',
  'rejected'
]);

function createFallbackId(prefix) {
  return String(prefix || 'id');
}

function normalizeImpactPreview(value) {
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

export function normalizeWorkbookReviewGroup(group, index = 0, options = {}) {
  const source = group && typeof group === 'object' ? group : {};
  const createId = typeof options.createId === 'function' ? options.createId : createFallbackId;
  const status = WORKBOOK_REVIEW_GROUP_STATUSES.includes(String(source.status || ''))
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
    groupId: String(source.groupId || source.group_id || createId(`ai_draft_group_${index}`)),
    taskSpecId: String(source.taskSpecId || source.task_spec_id || '').trim(),
    title: String(source.title || 'Advisor draft group').trim(),
    summary: String(source.summary || '').trim(),
    draftIds,
    status,
    impactPreview: normalizeImpactPreview(source.impactPreview || source.impact_preview)
  };
}

export function normalizeWorkbookReviewGroups(value, options = {}) {
  return (Array.isArray(value) ? value : [])
    .map((group, index) => normalizeWorkbookReviewGroup(group, index, options))
    .filter((group) => group.groupId && group.draftIds.length);
}
