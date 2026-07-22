export const CAVALRY_DRAFT_GROUP_URL_PREFIX = 'cavalry://draft-groups/';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function isSafeDraftGroupId(value) {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(asString(value));
}

export function getDraftGroupReviewUrl(draftGroupId) {
  const id = asString(draftGroupId);
  return id ? CAVALRY_DRAFT_GROUP_URL_PREFIX + encodeURIComponent(id) : '';
}

export function getDraftGroupIdFromReviewUrl(value) {
  const raw = asString(value);
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'cavalry:' || parsed.hostname !== 'draft-groups') {
      return '';
    }
    const id = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] || '');
    return isSafeDraftGroupId(id) ? id : '';
  } catch (_error) {
    return '';
  }
}

export function isDraftGroupReviewUrl(value) {
  return !!getDraftGroupIdFromReviewUrl(value);
}

export function reviewUrlHasSensitiveData(value) {
  const raw = asString(value);
  if (!raw) {
    return false;
  }
  try {
    const parsed = new URL(raw);
    const sensitivePattern =
      /(token|secret|key|password|account|category|amount|note|description|transaction)/i;
    const queryKeys = Array.from(parsed.searchParams.keys()).join(' ');
    return sensitivePattern.test(queryKeys) || sensitivePattern.test(parsed.hash);
  } catch (_error) {
    return false;
  }
}

export function validateDraftGroupReviewUrl({ workbook, reviewUrl, draftGroupId, userId } = {}) {
  const id = asString(draftGroupId) || getDraftGroupIdFromReviewUrl(reviewUrl);
  if (!isSafeDraftGroupId(id)) {
    return {
      ok: false,
      code: 'malformed_review_url',
      message: 'Review URL is malformed.',
      draftGroupId: ''
    };
  }
  const groups =
    workbook && Array.isArray(workbook.externalDraftGroups) ? workbook.externalDraftGroups : [];
  const group = groups.find((item) => asString(item && item.draft_group_id) === id) || null;
  if (!group) {
    return {
      ok: false,
      code: 'draft_group_not_found',
      message: 'Draft group was not found in this workbook.',
      draftGroupId: id
    };
  }
  if (
    asString(group.workbook_id) &&
    asString(workbook && workbook.id) &&
    asString(group.workbook_id) !== asString(workbook && workbook.id)
  ) {
    return {
      ok: false,
      code: 'cross_workbook_review_url',
      message: 'Draft group belongs to a different workbook.',
      draftGroupId: id
    };
  }
  const requestedUserId = asString(userId);
  if (requestedUserId) {
    const auditEvent =
      (workbook.externalApiAuditEvents || []).find(
        (event) => asString(event && event.draft_group_id) === id
      ) || null;
    if (
      auditEvent &&
      asString(auditEvent.user_id) &&
      asString(auditEvent.user_id) !== requestedUserId
    ) {
      return {
        ok: false,
        code: 'cross_user_review_url',
        message: 'Draft group belongs to a different user.',
        draftGroupId: id
      };
    }
  }
  return { ok: true, code: 'ok', message: '', draftGroupId: id, group };
}
