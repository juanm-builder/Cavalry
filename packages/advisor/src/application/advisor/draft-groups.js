function asString(value) {
  return String(value || '').trim();
}

function asInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : fallback;
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

function normalizeImpactPreview(value = {}) {
  return {
    affectedTransactions: asInteger(value.affectedTransactions || value.affected_transactions),
    categoriesCreated: asInteger(value.categoriesCreated || value.categories_created),
    categoriesRenamed: asInteger(value.categoriesRenamed || value.categories_renamed),
    categoriesArchived: asInteger(value.categoriesArchived || value.categories_archived)
  };
}

export function buildAdvisorDraftGroupsFromToolResults({ taskSpec, toolResults } = {}) {
  const groups = [];
  (Array.isArray(toolResults) ? toolResults : []).forEach((result) => {
    if (!(result && result.ok && result.data && result.data.draft_group_preview)) {
      return;
    }
    const preview = result.data.draft_group_preview;
    groups.push({
      groupId: 'advisor_draft_group_' + String(groups.length + 1),
      taskSpecId: getTaskSpecId(taskSpec),
      title: asString(preview.title || 'Advisor draft group'),
      summary: asString(preview.summary),
      draftIds: Array.isArray(preview.draftIds)
        ? preview.draftIds.map(asString).filter(Boolean)
        : [],
      status: 'pending',
      impactPreview: normalizeImpactPreview(preview.impactPreview || preview.impact_preview)
    });
  });
  return groups;
}
