import { normalizeAdvisorConversationState } from './advisor-conversation-state.js';
import { normalizeAdvisorMessageViewModel } from './contracts.js';
import { normalizeAdvisorAttachments } from '../../domain/advisor/image-attachments.js';
import { normalizeAdvisorReference } from '../../domain/advisor/references.js';
import {
  normalizeAdvisorTransactionDraftFields,
  normalizeAdvisorTransactionFieldEvidence,
  normalizeAdvisorTransactionTemplate
} from '../../domain/advisor/transaction-drafts.js';

const TRANSACTION_ACTION_STATUSES = new Set([
  'draft',
  'needs_info',
  'posted',
  'dismissed',
  'invalid'
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value || '').trim();
}

function stringArray(value, limit = 8) {
  return (Array.isArray(value) ? value : [])
    .map(asString)
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, limit);
}

function fallbackId(prefix, index, options) {
  const candidate = `${prefix}_${String(index)}`;
  if (typeof options.createId !== 'function') {
    return candidate;
  }
  return asString(options.createId(candidate, index)) || candidate;
}

function fallbackTimestamp(options) {
  if (typeof options.now === 'function') {
    const value = options.now();
    return value instanceof Date ? value.toISOString() : asString(value);
  }
  return asString(options.now);
}

function normalizeReferences(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeAdvisorReference)
    .filter((reference) => reference.token && reference.source_refs.length);
}

function normalizeTransactionDraftAction(action, index, options) {
  const source = asObject(action);
  const fields = normalizeAdvisorTransactionDraftFields(
    Object.assign({}, asObject(source.fields), {
      template: asObject(source.fields).template || source.template
    })
  );
  const status = asString(source.status);
  return {
    id: asString(source.id) || fallbackId('advisor_transaction_action', index, options),
    type: 'transaction_draft',
    status: TRANSACTION_ACTION_STATUSES.has(status) ? status : 'needs_info',
    template: normalizeAdvisorTransactionTemplate(source.template || fields.template),
    fields,
    missingFields: stringArray(source.missingFields || source.missing_fields),
    confidence: Math.max(0, Math.min(1, Number(source.confidence) || 0)),
    reason: asString(source.reason),
    sourceUserMessageId: asString(source.sourceUserMessageId || source.source_user_message_id),
    postedTransactionId: asString(source.postedTransactionId || source.posted_transaction_id),
    aiDraftId: asString(source.aiDraftId || source.ai_draft_id),
    createCategoryName: asString(source.createCategoryName || source.create_category_name),
    fieldEvidence: normalizeAdvisorTransactionFieldEvidence(
      source.fieldEvidence || source.field_evidence
    ),
    sourceRefs: stringArray(source.sourceRefs || source.source_refs),
    sourceAttachmentId: asString(source.sourceAttachmentId || source.source_attachment_id)
  };
}

function normalizeAction(action, index, options) {
  const type = asString(action && action.type);
  if (type === 'transaction_draft') {
    return normalizeTransactionDraftAction(action, index, options);
  }
  if (['draft_group_reference', 'open_draft_review'].includes(type)) {
    const draftGroupId = asString(action && (action.draftGroupId || action.draft_group_id));
    if (!draftGroupId) return null;
    return {
      id: asString(action && action.id) || fallbackId('advisor_draft_group_action', index, options),
      type: 'open_draft_review',
      label: asString(action && action.label) || 'Review prepared draft',
      draftGroupId,
      reviewUrl: asString(action && (action.reviewUrl || action.review_url))
    };
  }
  return normalizeAdvisorMessageViewModel({ actions: [action] }).actions[0] || null;
}

function normalizeMessage(message, index, threadIndex, options) {
  const source = asObject(message);
  const viewModel = normalizeAdvisorMessageViewModel(
    Object.assign({}, source, {
      text: source.text || source.content
    })
  );
  return {
    id: asString(source.id) || fallbackId(`advisor_thread_${threadIndex}_message`, index, options),
    role: source.role === 'user' ? 'user' : 'assistant',
    text: viewModel.text,
    createdAt: asString(source.createdAt || source.created_at) || fallbackTimestamp(options),
    references: normalizeReferences(source.references),
    actions: (Array.isArray(source.actions) ? source.actions : [])
      .map((action, actionIndex) => normalizeAction(action, actionIndex, options))
      .filter(Boolean),
    attachments: normalizeAdvisorAttachments(source.attachments, { allowInvalid: true })
      .attachments,
    responseV2: viewModel.responseV2,
    evidenceWorkspace: viewModel.evidenceWorkspace,
    draftGroups: viewModel.draftGroups,
    turnTrace: viewModel.turnTrace,
    traceSummary: viewModel.traceSummary,
    advisorMeta: viewModel.advisorMeta
  };
}

function normalizeThread(thread, index, options) {
  const source = asObject(thread);
  const messages = (Array.isArray(source.messages) ? source.messages : [])
    .map((message, messageIndex) => normalizeMessage(message, messageIndex, index, options))
    .filter((message) => message.text || message.role === 'user' || message.actions.length);
  const createdAt = asString(source.createdAt || source.created_at) || fallbackTimestamp(options);
  return {
    id: asString(source.id) || fallbackId('advisor_thread', index, options),
    title: asString(source.title) || 'New chat',
    createdAt,
    updatedAt:
      asString(source.updatedAt || source.updated_at) || messages.at(-1)?.createdAt || createdAt,
    rangeLabel: asString(source.rangeLabel || source.range_label),
    messages,
    conversationState: normalizeAdvisorConversationState(
      source.conversationState || source.conversation_state
    )
  };
}

export function hydrateAdvisorWorkbook(workbook, options = {}) {
  const source = asObject(workbook);
  const settings = asObject(source.settings);
  const advisorThreads = (Array.isArray(source.advisorThreads) ? source.advisorThreads : []).map(
    (thread, index) => normalizeThread(thread, index, options)
  );
  const savedActiveThreadId = asString(settings.activeAdvisorThreadId);
  const activeAdvisorThreadId = advisorThreads.some((thread) => thread.id === savedActiveThreadId)
    ? savedActiveThreadId
    : advisorThreads[0]?.id || '';

  return Object.assign({}, source, {
    settings: Object.assign({}, settings, { activeAdvisorThreadId }),
    advisorThreads
  });
}

export function getActiveAdvisorThread(workbook) {
  const source = asObject(workbook);
  const activeThreadId = asString(asObject(source.settings).activeAdvisorThreadId);
  return (
    (Array.isArray(source.advisorThreads) ? source.advisorThreads : []).find(
      (thread) => asString(thread && thread.id) === activeThreadId
    ) || null
  );
}
