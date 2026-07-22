import { createValidationIssue, uniqueIssues } from '../../domain/cavalry-action-plan/issues.js';
import { sha256Hex } from '../../domain/fingerprints/sha256.js';
import { getDraftGroupReviewUrl } from './review-url.js';

export const EXTERNAL_DRAFT_ORIGINS = Object.freeze([
  'chatgpt_action',
  'chatgpt_app',
  'mcp',
  'manual_action_plan_import',
  'local_dev_api'
]);

export const DRAFT_GROUP_STATUSES = Object.freeze([
  'pending_review',
  'partially_ready',
  'needs_info',
  'blocked',
  'applied',
  'rejected',
  'expired'
]);

export const DRAFT_ITEM_STATUSES = Object.freeze([
  'ready',
  'needs_review',
  'needs_info',
  'blocked'
]);

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key]))
      .join(',') +
    '}'
  );
}

export function fingerprintValue(value) {
  return sha256Hex(stableStringify(value));
}

export function getWorkbookCoreFingerprint(workbook) {
  const clone = clonePlain(workbook || {});
  delete clone.externalDraftGroups;
  delete clone.externalApiAuditEvents;
  delete clone.externalApiIdempotencyRecords;
  delete clone.aiDrafts;
  delete clone.advisorDraftGroups;
  return fingerprintValue(clone);
}

export function normalizeExternalDraftOrigin(origin = {}, options = {}) {
  const source = origin && typeof origin === 'object' ? origin : {};
  const rawOrigin = asString(source.origin || options.origin || 'local_dev_api');
  return {
    origin: EXTERNAL_DRAFT_ORIGINS.includes(rawOrigin) ? rawOrigin : 'local_dev_api',
    provider: asString(source.provider || options.provider || 'unknown') || 'unknown',
    externalConversationId:
      asString(source.externalConversationId || source.external_conversation_id) || null,
    externalMessageId: asString(source.externalMessageId || source.external_message_id) || null,
    externalActionId: asString(source.externalActionId || source.external_action_id) || null,
    idempotencyKey:
      asString(source.idempotencyKey || source.idempotency_key || options.idempotencyKey) || null,
    requestId: asString(source.requestId || source.request_id || options.requestId) || null,
    authMethod: asString(source.authMethod || source.auth_method || options.authMethod) || null,
    userAgent: asString(source.userAgent || source.user_agent || options.userAgent) || null,
    requestIpHash:
      asString(source.requestIpHash || source.request_ip_hash || options.requestIpHash) || null,
    createdAt:
      asString(source.createdAt || source.created_at || options.createdAt) ||
      new Date().toISOString()
  };
}

export function summarizeDraftItems(drafts) {
  const list = Array.isArray(drafts) ? drafts : [];
  return list.reduce(
    (summary, draft) => {
      summary.total += 1;
      const status = DRAFT_ITEM_STATUSES.includes(asString(draft && draft.status))
        ? draft.status
        : 'blocked';
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

export function getDraftGroupStatus(summary) {
  const total = Number(summary && summary.total) || 0;
  if (!total || Number(summary && summary.blocked) === total) {
    return 'blocked';
  }
  if (Number(summary && summary.needs_info) > 0 && Number(summary && summary.ready) === 0) {
    return 'needs_info';
  }
  if (
    Number(summary && summary.ready) > 0 &&
    (Number(summary && summary.needs_review) > 0 ||
      Number(summary && summary.needs_info) > 0 ||
      Number(summary && summary.blocked) > 0)
  ) {
    return 'partially_ready';
  }
  return 'pending_review';
}

export function ensureExternalDraftCollections(workbook) {
  if (!workbook) {
    throw new Error('Workbook is required.');
  }
  workbook.externalDraftGroups = Array.isArray(workbook.externalDraftGroups)
    ? workbook.externalDraftGroups
    : [];
  workbook.externalApiAuditEvents = Array.isArray(workbook.externalApiAuditEvents)
    ? workbook.externalApiAuditEvents
    : [];
  workbook.externalApiIdempotencyRecords = Array.isArray(workbook.externalApiIdempotencyRecords)
    ? workbook.externalApiIdempotencyRecords
    : [];
  return workbook;
}

export function normalizeDraftItem(item, index = 0, options = {}) {
  const source = item && typeof item === 'object' ? item : {};
  const status = DRAFT_ITEM_STATUSES.includes(asString(source.status)) ? source.status : 'blocked';
  return {
    draft_id: asString(
      source.draft_id ||
        source.draftId ||
        (options.createId ? options.createId('d_' + String(index + 1)) : 'd_' + String(index + 1))
    ),
    type: asString(source.type || 'transaction'),
    status,
    title: asString(source.title || 'Draft'),
    display_summary: asString(source.display_summary || source.displaySummary || ''),
    proposed_values: clonePlain(source.proposed_values || source.proposedValues || {}),
    original_values:
      source.original_values || source.originalValues
        ? clonePlain(source.original_values || source.originalValues)
        : undefined,
    validation_issues: uniqueIssues(source.validation_issues || source.validationIssues || []),
    duplicate_candidates: Array.isArray(source.duplicate_candidates || source.duplicateCandidates)
      ? clonePlain(source.duplicate_candidates || source.duplicateCandidates)
      : undefined,
    source_action_id: asString(source.source_action_id || source.sourceActionId) || undefined,
    source_refs: Array.isArray(source.source_refs || source.sourceRefs)
      ? (source.source_refs || source.sourceRefs).map(asString).filter(Boolean)
      : undefined
  };
}

export function createDraftGroup({
  workbook,
  title,
  origin,
  drafts,
  validationIssues,
  auditEventId,
  createId,
  now
} = {}) {
  const createdAt = typeof now === 'function' ? now() : new Date().toISOString();
  const uid =
    typeof createId === 'function'
      ? createId
      : (prefix) => prefix + '_' + Math.random().toString(36).slice(2, 10);
  const draftGroupId = uid('dg');
  const normalizedDrafts = (Array.isArray(drafts) ? drafts : []).map((draft, index) =>
    normalizeDraftItem(draft, index, { createId: uid })
  );
  const summary = summarizeDraftItems(normalizedDrafts);
  return {
    draft_group_id: draftGroupId,
    workbook_id: asString(workbook && workbook.id),
    title: asString(title || 'External draft group'),
    status: getDraftGroupStatus(summary),
    origin: normalizeExternalDraftOrigin(origin, { createdAt }),
    created_at: createdAt,
    review_url: getDraftGroupReviewUrl(draftGroupId),
    summary,
    drafts: normalizedDrafts,
    validation_issues: uniqueIssues(validationIssues || []),
    audit_event_id: asString(auditEventId || uid('audit')),
    message: buildDraftGroupMessage(summary)
  };
}

export function buildDraftGroupMessage(summary) {
  const total = Number(summary && summary.total) || 0;
  if (!total) {
    return 'No drafts were prepared.';
  }
  const noun = total === 1 ? 'draft' : 'drafts';
  const reviewCount =
    (Number(summary.needs_review) || 0) +
    (Number(summary.needs_info) || 0) +
    (Number(summary.blocked) || 0);
  if (reviewCount) {
    return 'Prepared ' + String(total) + ' ' + noun + '. Review them in Cavalry before applying.';
  }
  return (
    'Prepared ' +
    String(total) +
    ' ' +
    noun +
    '. Review ' +
    (total === 1 ? 'it' : 'them') +
    ' in Cavalry before applying.'
  );
}

export function findExternalDraftGroup(workbook, draftGroupId) {
  const id = asString(draftGroupId);
  return (
    (workbook && Array.isArray(workbook.externalDraftGroups)
      ? workbook.externalDraftGroups
      : []
    ).find((group) => asString(group && group.draft_group_id) === id) || null
  );
}

export function persistExternalDraftGroup(workbook, draftGroup) {
  ensureExternalDraftCollections(workbook);
  const index = workbook.externalDraftGroups.findIndex(
    (group) => group.draft_group_id === draftGroup.draft_group_id
  );
  if (index >= 0) {
    workbook.externalDraftGroups[index] = draftGroup;
  } else {
    workbook.externalDraftGroups.push(draftGroup);
  }
  return draftGroup;
}

export function createBlockedDraftItem(action, message, code = 'unsupported_action_type') {
  return normalizeDraftItem({
    draft_id: '',
    type: 'transaction',
    status: 'blocked',
    title: 'Unsupported action',
    display_summary: message,
    proposed_values: action || {},
    validation_issues: [
      createValidationIssue(code, message, {
        severity: 'blocked',
        actionId: action && action.id
      })
    ],
    source_action_id: action && action.id
  });
}
