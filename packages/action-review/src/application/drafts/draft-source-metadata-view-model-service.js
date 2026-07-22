// Keeps source origin labels read-only and separate from external draft contracts or draft actions.

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

export function countExternalDraftDuplicateWarnings(group = {}) {
  return (group && Array.isArray(group.drafts) ? group.drafts : []).reduce((count, draft) => {
    return (
      count +
      (Array.isArray(draft.validation_issues)
        ? draft.validation_issues.filter((issue) => {
            return (
              issue && (issue.code === 'possible_duplicate' || issue.code === 'duplicate_candidate')
            );
          }).length
        : 0)
    );
  }, 0);
}

export function buildExternalDraftOriginLabel(origin = {}) {
  if (origin.origin === 'manual_action_plan_import') {
    return 'Manual import prepared these Cavalry drafts.';
  }
  if (origin.origin === 'chatgpt_action') {
    return 'ChatGPT prepared these Cavalry drafts.';
  }
  if (origin.origin === 'local_dev_api') {
    return 'Local Dev API prepared these Cavalry drafts.';
  }
  return 'Companion API prepared these Cavalry drafts.';
}

export function buildExternalDraftSourceLabel(origin = {}) {
  if (origin.origin === 'manual_action_plan_import') {
    return 'Manual Import';
  }
  if (origin.origin === 'chatgpt_action') {
    return 'ChatGPT / Companion API / Beta GPT Action';
  }
  if (origin.origin === 'local_dev_api') {
    return 'Companion API / Local Dev';
  }
  return 'Companion API';
}

export function buildExternalDraftSourceMetadataViewModel(draft = {}, group = null) {
  const source = draft && draft.source && typeof draft.source === 'object' ? draft.source : {};
  if (source.type !== 'external_api') {
    return {
      visible: false,
      rows: []
    };
  }
  const origin = asObject(group && group.origin);
  const summary = asObject(group && group.summary);
  const groupId = asString(source.externalDraftGroupId || (group && group.draft_group_id) || '');
  const createdAt = asString(
    (group && group.created_at) || origin.createdAt || draft.createdAt || ''
  );
  const duplicateWarningCount = countExternalDraftDuplicateWarnings(group);
  const readyCount = Number(summary.ready) || 0;
  const needsReviewCount = Number(summary.needs_review) || 0;
  const blockedCount = Number(summary.blocked) || 0;
  const originLabel = buildExternalDraftOriginLabel(origin);
  const sourceLabel = buildExternalDraftSourceLabel(origin);
  const duplicateWarningLabel = duplicateWarningCount
    ? String(duplicateWarningCount) +
      ' duplicate warning' +
      (duplicateWarningCount === 1 ? '' : 's')
    : '';
  const hasIdempotencyKey = !!(origin.idempotencyKey || origin.idempotency_key);
  const rows = [
    { id: 'source', label: sourceLabel },
    { id: 'group', label: groupId ? 'Group ' + groupId : 'External draft group' },
    { id: 'created-at', label: createdAt ? '' : 'Created by Companion API', createdAt },
    { id: 'ready', label: String(readyCount) + ' ready' },
    { id: 'needs-review', label: String(needsReviewCount) + ' needs review' },
    { id: 'blocked', label: String(blockedCount) + ' blocked' }
  ];
  if (duplicateWarningLabel) {
    rows.push({ id: 'duplicate-warnings', label: duplicateWarningLabel });
  }
  if (hasIdempotencyKey) {
    rows.push({ id: 'idempotency-key', label: 'Idempotency key present' });
  }
  rows.push({ id: 'unchanged', label: 'Nothing has changed yet' });
  return {
    visible: true,
    originLabel,
    panelCopy: 'Nothing has changed yet. Review and apply only what looks right.',
    sourceLabel,
    groupId,
    groupLabel: groupId ? 'Group ' + groupId : 'External draft group',
    createdAt,
    createdAtFallbackLabel: 'Created by Companion API',
    readyCount,
    needsReviewCount,
    blockedCount,
    duplicateWarningCount,
    duplicateWarningLabel,
    hasIdempotencyKey,
    unchangedLabel: 'Nothing has changed yet',
    rows
  };
}

export function buildDraftSourceMetadataViewModel(draft = {}, options = {}) {
  return {
    external: buildExternalDraftSourceMetadataViewModel(
      draft,
      options.externalDraftGroup || options.group || null
    )
  };
}
