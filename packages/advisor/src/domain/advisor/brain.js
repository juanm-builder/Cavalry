import {
  AI_DRAFT_OBJECT_TYPES,
  AI_DRAFT_OPERATIONS,
  normalizeAiDraft,
  validateAiDraftSourceRefs
} from '@cavalry/action-review/domain/drafts/draft-lifecycle.js';
import {
  advisorPromptRequestsTransactionHistory,
  advisorTransactionTextKey,
  normalizeAdvisorTransactionDraftFields,
  normalizeAdvisorTransactionTemplate
} from './transaction-drafts.js';

export const ADVISOR_BRAIN_INTENT = 'advisor_brain';
export const ADVISOR_BRAIN_RESPONSE_VERSION = 'cavalry.advisor_brain_response.v1';
export const ADVISOR_BRAIN_CONTEXT_REQUEST_KINDS = [
  'accounts',
  'categories',
  'counterparties',
  'transactions',
  'history',
  'recurring_items',
  'budgets',
  'ai_drafts',
  'full_workbook'
];

const ADVISOR_BRAIN_OBJECT_TYPE_ALIASES = {
  account: 'account',
  accounts: 'account',
  wallet: 'account',
  wallets: 'account',
  bank: 'account',
  banks: 'account',
  card: 'account',
  cards: 'account',
  bill: 'recurringItem',
  bills: 'recurringItem',
  subscription: 'recurringItem',
  subscriptions: 'recurringItem',
  recurring: 'recurringItem',
  recurring_item: 'recurringItem',
  recurring_items: 'recurringItem',
  recurringitem: 'recurringItem',
  bill_subscription: 'billSubscription',
  billsubscription: 'billSubscription',
  merchant: 'counterparty',
  payee: 'counterparty',
  biller: 'counterparty',
  client: 'counterparty',
  employer: 'counterparty',
  sheet_budget: 'budget',
  ledger_cleanup: 'ledgerCleanup',
  ledgercleanup: 'ledgerCleanup',
  ledger_review: 'ledgerReview',
  ledgerreview: 'ledgerReview'
};

const ADVISOR_BRAIN_OPERATION_ALIASES = {
  add: 'create',
  make: 'create',
  track: 'create',
  set: 'edit',
  update: 'edit',
  change: 'edit',
  rename: 'edit',
  fix: 'edit',
  cleanup: 'edit',
  clean: 'edit',
  recategorize: 'edit',
  categorize: 'edit',
  deactivate: 'archive',
  hide: 'archive',
  remove: 'delete',
  destroy: 'delete'
};

function asString(value) {
  return String(value || '').trim();
}

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : []).map(asString).filter(Boolean);
}

function clamp01(value, fallback = 0.6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function normalizeOperation(value) {
  const raw = asString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const normalized = ADVISOR_BRAIN_OPERATION_ALIASES[raw] || raw;
  return AI_DRAFT_OPERATIONS.includes(normalized) ? normalized : '';
}

function normalizeObjectType(value) {
  const raw = asString(value).replace(/[\s-]+/g, '_');
  const key = raw.toLowerCase();
  const normalized = ADVISOR_BRAIN_OBJECT_TYPE_ALIASES[key] || raw;
  return AI_DRAFT_OBJECT_TYPES.includes(normalized) ? normalized : '';
}

function sourceTypeForObjectType(objectType) {
  if (objectType === 'recurringItem' || objectType === 'billSubscription') return 'recurringItem';
  if (objectType === 'budget') return 'budget';
  return objectType;
}

function sourceRefForDraftTarget(draft) {
  const targetId = asString(draft && draft.targetId);
  if (!targetId) {
    return '';
  }
  return sourceTypeForObjectType(draft.objectType) + ':' + targetId;
}

function findDraftTarget(workbook, objectType, targetId) {
  const id = asString(targetId);
  if (!id) return null;
  if (objectType === 'transaction') {
    return (workbook.transactions || []).find((item) => item.id === id) || null;
  }
  if (objectType === 'account') {
    return (workbook.accounts || []).find((item) => item.id === id) || null;
  }
  if (objectType === 'category') {
    return (workbook.categories || []).find((item) => item.id === id) || null;
  }
  if (objectType === 'counterparty') {
    return (workbook.counterparties || []).find((item) => item.id === id) || null;
  }
  if (objectType === 'recurringItem' || objectType === 'billSubscription') {
    return (workbook.recurringItems || []).find((item) => item.id === id) || null;
  }
  if (objectType === 'budget') {
    return (workbook.sheets || []).find((item) => item.id === id) || null;
  }
  if (objectType === 'aiDraft') {
    return (workbook.aiDrafts || []).find((item) => item.id === id) || null;
  }
  return null;
}

function categoryHasReferences(workbook, categoryId) {
  const id = asString(categoryId);
  if (!id) return false;
  return (
    (workbook.transactions || []).some((item) => item.categoryId === id) ||
    (workbook.recurringItems || []).some((item) => item.categoryId === id) ||
    (workbook.sheets || []).some(
      (sheet) =>
        (sheet.budgets || []).some((budget) => budget.categoryId === id) ||
        (sheet.budgetLineItems || []).some((item) => item.categoryId === id) ||
        (sheet.entries || []).some((entry) => entry.categoryId === id)
    )
  );
}

function inferBrainTargetId(raw, objectType, proposed) {
  const source = raw && typeof raw === 'object' ? raw : {};
  if (source.targetId || source.target_id) return asString(source.targetId || source.target_id);
  if (proposed && typeof proposed === 'object') {
    if (objectType === 'transaction') return asString(proposed.transactionId || proposed.id);
    if (objectType === 'budget') return asString(proposed.sheetId || proposed.id);
    return asString(proposed.id);
  }
  return '';
}

function normalizeBrainTransactionProposed(raw, proposed) {
  const source = proposed && typeof proposed === 'object' ? proposed : {};
  const fields = normalizeAdvisorTransactionDraftFields(source.fields || raw.fields || {});
  const template = normalizeAdvisorTransactionTemplate(
    source.template || raw.template || fields.template
  );
  return Object.assign({}, source, {
    template: template || source.template || raw.template || fields.template,
    fields: Object.assign({}, fields, {
      template: template || fields.template
    }),
    missingFields: normalizeStringArray(
      source.missingFields || source.missing_fields || raw.missingFields || raw.missing_fields
    )
  });
}

function normalizeBrainDraftProposed(raw, objectType, operation) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const proposed = source.proposed && typeof source.proposed === 'object' ? source.proposed : {};
  if (objectType === 'transaction') {
    return normalizeBrainTransactionProposed(source, proposed);
  }
  if (operation === 'delete' || operation === 'archive') {
    return Object.assign({}, proposed, {
      id: asString(proposed.id || source.targetId || source.target_id || source.id)
    });
  }
  return Object.assign({}, proposed);
}

function normalizeBrainReferences(value) {
  return (Array.isArray(value) ? value : [])
    .map((reference) => {
      if (typeof reference === 'string') {
        return {
          token: reference,
          source_refs: [reference]
        };
      }
      return {
        token: asString(reference && reference.token),
        source_refs: normalizeStringArray(
          reference && (reference.source_refs || reference.sourceRefs)
        )
      };
    })
    .filter((reference) => reference.token && reference.source_refs.length);
}

function dedupeStrings(items) {
  const seen = new Set();
  return normalizeStringArray(items).filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

function validateBrainDraftShell(workbook, draft) {
  if (!draft) return 'Draft was not returned.';
  if (!AI_DRAFT_OBJECT_TYPES.includes(draft.objectType)) return 'Unsupported AI draft object type.';
  if (!AI_DRAFT_OPERATIONS.includes(draft.operation)) return 'Unsupported AI draft operation.';
  if (
    draft.operation !== 'create' &&
    !findDraftTarget(workbook || {}, draft.objectType, draft.targetId)
  ) {
    return (
      (draft.objectType === 'budget'
        ? 'Budget month'
        : draft.objectType.charAt(0).toUpperCase() + draft.objectType.slice(1)) + ' not found.'
    );
  }
  if (
    draft.objectType === 'category' &&
    draft.operation === 'delete' &&
    categoryHasReferences(workbook || {}, draft.targetId)
  ) {
    return 'Category is still referenced. Archive it, choose a replacement category, or uncategorize the references before hard delete.';
  }
  const refError = validateAiDraftSourceRefs(workbook || {}, draft);
  if (refError) return refError;
  return '';
}

function titleForBrainDraft(objectType, operation, targetId, proposed) {
  const label =
    asString(proposed && (proposed.name || proposed.title || proposed.description)) ||
    targetId ||
    objectType;
  const verb =
    operation === 'delete'
      ? 'Delete'
      : operation === 'archive'
        ? 'Archive'
        : operation === 'edit'
          ? 'Edit'
          : 'Create';
  return verb + ' ' + label;
}

export function advisorBrainMessageClaimsDirectMutation(message) {
  const text = advisorTransactionTextKey(message);
  if (!text) return false;
  if (
    /\b(draft|proposal|proposed|queued|prepared|review|nothing changed|not applied|before applying)\b/.test(
      text
    )
  ) {
    return false;
  }
  return /\b(i|ive|i ve|we|cavalry)\s+(posted|applied|created|updated|edited|deleted|removed|archived|changed)\b/.test(
    text
  );
}

export function normalizeAdvisorBrainContextRequests(value) {
  return (Array.isArray(value) ? value : [])
    .map((request) => {
      const source =
        typeof request === 'string'
          ? { kind: request }
          : request && typeof request === 'object'
            ? request
            : {};
      const rawKind = asString(source.kind || source.type)
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
      const kind =
        rawKind === 'recurring' || rawKind === 'subscriptions' || rawKind === 'subscription'
          ? 'recurring_items'
          : rawKind;
      if (!ADVISOR_BRAIN_CONTEXT_REQUEST_KINDS.includes(kind)) {
        return null;
      }
      const limit = Math.max(
        0,
        Math.min(50, Math.round(Number(source.limit || source.max || 0) || 0))
      );
      return {
        kind,
        query: asString(source.query),
        source_refs: normalizeStringArray(source.source_refs || source.sourceRefs),
        limit
      };
    })
    .filter(Boolean);
}

export function looksLikeAdvisorBrainWorkbookPrompt(prompt, options = {}) {
  const key = ' ' + advisorTransactionTextKey(prompt) + ' ';
  if (!key.trim()) return false;
  const hasWriteVerb =
    /\b(add|create|make|set|update|edit|change|rename|archive|deactivate|delete|remove|track|manage|link|unlink|clean|cleanup|fix|categorize|recategorize)\b/.test(
      key
    );
  if (!hasWriteVerb) return false;
  const destructive = /\b(delete|remove|archive|deactivate)\b/.test(key);
  const workbookObject =
    /\b(category|categories|counterparty|counterparties|merchant|merchants|payee|payees|biller|billers|budget|budgets|bill|bills|subscription|subscriptions|recurring|ledger|cleanup|draft|drafts)\b/.test(
      key
    );
  const transactionEdit =
    /\b(edit|update|change|delete|remove|archive|fix|categorize|recategorize|link|unlink)\b[\s\S]{0,80}\b(transaction|transactions|expense|payment|charge|income|transfer)\b/.test(
      key
    ) ||
    /\b(transaction|transactions|expense|payment|charge|income|transfer)\b[\s\S]{0,80}\b(edit|update|change|delete|remove|archive|fix|categorize|recategorize|link|unlink)\b/.test(
      key
    );
  const simpleTransactionCreate =
    /\b(add|create|record|draft)\b[\s\S]{0,80}\b(transaction|expense|income|transfer|payment|purchase|charge)\b/.test(
      key
    ) &&
    !destructive &&
    !workbookObject &&
    !transactionEdit &&
    !advisorPromptRequestsTransactionHistory(prompt);
  if (simpleTransactionCreate && options.allowSimpleTransactions !== true) {
    return false;
  }
  return (
    destructive ||
    workbookObject ||
    transactionEdit ||
    advisorPromptRequestsTransactionHistory(prompt)
  );
}

export function normalizeAdvisorBrainDraft(workbook, rawDraft, index = 0, options = {}) {
  const source = rawDraft && typeof rawDraft === 'object' ? rawDraft : {};
  const operation = normalizeOperation(source.operation || source.action);
  const objectType = normalizeObjectType(source.objectType || source.object_type || source.type);
  if (!(operation && objectType)) {
    return {
      draft: null,
      error: 'Unsupported Brain draft operation or object type.'
    };
  }
  const proposed = normalizeBrainDraftProposed(source, objectType, operation);
  const targetId = inferBrainTargetId(source, objectType, proposed);
  const sourceRefs = dedupeStrings(
    source.sourceRefs || source.source_refs || proposed.sourceRefs || proposed.source_refs
  );
  const targetRef = operation !== 'create' ? sourceRefForDraftTarget({ objectType, targetId }) : '';
  const draft = normalizeAiDraft(
    {
      id: source.id,
      status: source.status,
      operation,
      objectType,
      targetId,
      title:
        asString(source.title) || titleForBrainDraft(objectType, operation, targetId, proposed),
      summary: asString(source.summary),
      proposed,
      before:
        source.before && typeof source.before === 'object'
          ? source.before
          : operation !== 'create'
            ? findDraftTarget(workbook || {}, objectType, targetId) || {}
            : {},
      source: source.source && typeof source.source === 'object' ? source.source : {},
      sourceRefs: dedupeStrings(sourceRefs.concat(targetRef).filter(Boolean)),
      confidence: clamp01(source.confidence, 0.62),
      reason: asString(source.reason)
    },
    index,
    {
      createdAt: options.createdAt,
      createId: options.createId
    }
  );
  const error = validateBrainDraftShell(workbook || {}, draft);
  if (error) {
    draft.status = 'needs_fix';
    draft.error = error;
  } else if (!['pending', 'needs_fix'].includes(draft.status)) {
    draft.status = 'pending';
    draft.error = '';
  }
  return { draft, error };
}

export function normalizeAdvisorBrainResponse(workbook, parsed, options = {}) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const rawDrafts = Array.isArray(source.drafts) ? source.drafts : [];
  const rejectedDrafts = [];
  const drafts = rawDrafts
    .map((draft, index) => {
      const normalized = normalizeAdvisorBrainDraft(workbook || {}, draft, index, options);
      if (normalized.error) {
        rejectedDrafts.push({
          index,
          error: normalized.error
        });
      }
      return normalized.draft;
    })
    .filter(Boolean);
  let message = asString(source.message || source.summary || source.response);
  const safetyWarnings = [];
  if (advisorBrainMessageClaimsDirectMutation(message)) {
    message = 'I prepared reviewable AI drafts. Nothing has changed in the workbook yet.';
    safetyWarnings.push('direct_mutation_claim_replaced');
  }
  return {
    schema_version: ADVISOR_BRAIN_RESPONSE_VERSION,
    intent: ADVISOR_BRAIN_INTENT,
    message,
    drafts,
    questions: normalizeStringArray(
      source.questions || source.question
        ? Array.isArray(source.questions)
          ? source.questions
          : [source.question]
        : []
    ),
    references: normalizeBrainReferences(source.references || source.source_references),
    context_requests: normalizeAdvisorBrainContextRequests(
      source.context_requests || source.contextRequests
    ),
    rejected_drafts: rejectedDrafts,
    safety_warnings: safetyWarnings,
    context_mode: asString(options.contextMode)
  };
}
