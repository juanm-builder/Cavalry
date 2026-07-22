import { roundMoney } from '@cavalry/finance-core/domain/money.js';
import { getLedgerHistoricalBalancesAsOf } from '@cavalry/finance-core/domain/ledger/balances.js';
import {
  findTransactionByReference,
  getAdvisorDraftReference
} from '@cavalry/action-review/domain/drafts/draft-lifecycle.js';

export const ADVISOR_TRANSACTION_TEMPLATES = [
  'expense_paid',
  'expense_charged',
  'income_received',
  'transfer',
  'debt_payment',
  'liability_payment',
  'opening_balance'
];
export const ADVISOR_TRANSACTION_INTAKE_ROUTES = [
  'new_transaction_batch',
  'update_pending_draft',
  'clarification',
  'cancel',
  'not_transaction'
];
export const ADVISOR_TRANSACTION_INTAKE_SCHEMA_VERSION =
  'cavalry.transaction_intake_interpretation.v1';
export const ADVISOR_TRANSACTION_INTAKE_SCHEMA_VERSION_V2 =
  'cavalry.transaction_intake_interpretation.v2';
export const ADVISOR_TRANSACTION_DRAFT_REVIEW_SCHEMA_VERSION =
  'cavalry.transaction_draft_review.v1';
export const ADVISOR_TRANSACTION_BATCH_LIMIT = 20;
export const ADVISOR_TRANSACTION_FIELD_EVIDENCE_KEYS = [
  'template',
  'date',
  'amount',
  'category',
  'primaryAccount',
  'secondaryAccount',
  'counterparty',
  'description'
];
export const ADVISOR_FINANCE_INTENT_KINDS = Object.freeze({
  PURCHASE: 'purchase',
  CARD_CHARGE: 'card_charge',
  LIABILITY_PAYMENT: 'liability_payment',
  TRANSFER: 'transfer',
  INCOME: 'income',
  REVISE: 'revise',
  DELETE: 'delete',
  ENTITY_CREATE: 'entity_create',
  UNKNOWN: 'unknown'
});

export const ADVISOR_TRANSACTION_TEMPLATE_ALIASES = {
  expense: 'expense_paid',
  purchase: 'expense_paid',
  spend: 'expense_paid',
  charge: 'expense_charged',
  charged: 'expense_charged',
  income: 'income_received',
  salary: 'income_received',
  transfer: 'transfer',
  debt: 'debt_payment',
  payment: 'debt_payment',
  liability: 'debt_payment',
  opening: 'opening_balance',
  opening_balance: 'opening_balance'
};

export function normalizeAdvisorTransactionTemplate(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const template = ADVISOR_TRANSACTION_TEMPLATE_ALIASES[raw] || raw;
  return ADVISOR_TRANSACTION_TEMPLATES.includes(template) ? template : '';
}

function parseAdvisorAmountNumberText(numberText, scaleText = '') {
  const base = Number(String(numberText || '').replace(/,/g, '')) || 0;
  const scale = String(scaleText || '')
    .trim()
    .toLowerCase();
  const multiplier = scale === 'k' ? 1000 : scale === 'm' ? 1000000 : 1;
  return base > 0 ? roundMoney(base * multiplier) : 0;
}

function parseAdvisorAmountFieldValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? roundMoney(value) : 0;
  }
  const raw = String(value || '').trim();
  if (!raw) {
    return 0;
  }
  const direct =
    /^(?:\u20b1|\$|PHP|USD|php|usd|p)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*([kKmM])?\s*(?:pesos?|pese|php|usd|\$)?$/i.exec(
      raw
    );
  if (direct && direct[1]) {
    return parseAdvisorAmountNumberText(direct[1], direct[2]);
  }
  return parseAdvisorAmountFromText(raw);
}

export function normalizeAdvisorTransactionDraftFields(value) {
  const source = value && typeof value === 'object' ? value : {};
  const amount = parseAdvisorAmountFieldValue(source.amount);
  return {
    template: normalizeAdvisorTransactionTemplate(source.template),
    date: normalizeAdvisorDateKey(source.date) || String(source.date || '').trim(),
    description: String(source.description || '').trim(),
    amount: amount > 0 ? roundMoney(amount) : 0,
    currency: String(source.currency || '')
      .trim()
      .toUpperCase(),
    categoryId: String(source.categoryId || '').trim(),
    categoryName: String(source.categoryName || '').trim(),
    primaryAccountId: String(source.primaryAccountId || '').trim(),
    primaryAccountName: String(source.primaryAccountName || '').trim(),
    secondaryAccountId: String(source.secondaryAccountId || '').trim(),
    secondaryAccountName: String(source.secondaryAccountName || '').trim(),
    counterpartyId: String(source.counterpartyId || '').trim(),
    counterpartyName: String(source.counterpartyName || '').trim(),
    counterpartyKind: String(source.counterpartyKind || 'other')
      .trim()
      .toLowerCase(),
    note: String(source.note || '').trim()
  };
}

function clampAdvisorConfidence(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function normalizeAdvisorStringArray(value, limit = 8) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, Math.max(0, Math.round(Number(limit) || 8)));
}

function normalizeAdvisorEvidenceText(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeAdvisorEvidenceText(item))
      .filter(Boolean)
      .join(' ')
      .trim()
      .slice(0, 240);
  }
  if (value && typeof value === 'object') {
    return normalizeAdvisorEvidenceText(
      value.text || value.sourceText || value.source_text || value.evidence || value.value || ''
    );
  }
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function getAdvisorEvidenceAliasValue(source, aliases) {
  for (let index = 0; index < aliases.length; index += 1) {
    const value = source[aliases[index]];
    const normalized = normalizeAdvisorEvidenceText(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

export function normalizeAdvisorTransactionFieldEvidence(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    template: getAdvisorEvidenceAliasValue(source, [
      'template',
      'type',
      'transactionType',
      'transaction_type'
    ]),
    date: getAdvisorEvidenceAliasValue(source, ['date', 'dateText', 'date_text', 'when', 'time']),
    amount: getAdvisorEvidenceAliasValue(source, [
      'amount',
      'amountText',
      'amount_text',
      'price',
      'total',
      'cost',
      'money'
    ]),
    category: getAdvisorEvidenceAliasValue(source, ['category', 'categoryName', 'category_name']),
    primaryAccount: getAdvisorEvidenceAliasValue(source, [
      'primaryAccount',
      'primary_account',
      'primaryAccountName',
      'primary_account_name',
      'account',
      'accountName',
      'account_name',
      'paymentAccount',
      'payment_account',
      'paidFrom',
      'paid_from',
      'chargedTo',
      'charged_to',
      'sourceAccount',
      'source_account'
    ]),
    secondaryAccount: getAdvisorEvidenceAliasValue(source, [
      'secondaryAccount',
      'secondary_account',
      'secondaryAccountName',
      'secondary_account_name',
      'destinationAccount',
      'destination_account',
      'paidTo',
      'paid_to',
      'toAccount',
      'to_account'
    ]),
    counterparty: getAdvisorEvidenceAliasValue(source, [
      'counterparty',
      'counterpartyName',
      'counterparty_name',
      'merchant',
      'merchantName',
      'merchant_name',
      'payee',
      'payer',
      'receivedFrom',
      'received_from'
    ]),
    description: getAdvisorEvidenceAliasValue(source, [
      'description',
      'descriptionText',
      'description_text',
      'purpose',
      'item',
      'items',
      'memo',
      'note'
    ])
  };
}

function getAdvisorTransactionFieldEvidenceFromSource(source) {
  const extraction =
    source &&
    source.extraction &&
    typeof source.extraction === 'object' &&
    !Array.isArray(source.extraction)
      ? source.extraction
      : {};
  return normalizeAdvisorTransactionFieldEvidence(
    (source &&
      (source.fieldEvidence ||
        source.field_evidence ||
        source.fieldsEvidence ||
        source.fields_evidence ||
        source.evidence)) ||
      extraction.fieldEvidence ||
      extraction.field_evidence ||
      extraction.evidence ||
      {}
  );
}

function normalizeAdvisorTransactionExtraction(item) {
  const source = item && typeof item === 'object' ? item : {};
  const extraction =
    source.extraction && typeof source.extraction === 'object' && !Array.isArray(source.extraction)
      ? source.extraction
      : source;
  return {
    imageEvidence: String(extraction.imageEvidence || extraction.image_evidence || '').trim(),
    sourceAttachmentId: String(
      extraction.sourceAttachmentId ||
        extraction.source_attachment_id ||
        source.sourceAttachmentId ||
        source.source_attachment_id ||
        ''
    ).trim(),
    usedUserText: extraction.usedUserText === true || extraction.used_user_text === true,
    usedImageText: extraction.usedImageText === true || extraction.used_image_text === true,
    uncertainFields: normalizeAdvisorStringArray(
      extraction.uncertainFields || extraction.uncertain_fields,
      12
    ),
    fieldEvidence: getAdvisorTransactionFieldEvidenceFromSource(source)
  };
}

export function normalizeAdvisorTransactionIntakeRoute(value, fallback = 'new_transaction_batch') {
  const route = String(value || '')
    .trim()
    .toLowerCase();
  if (ADVISOR_TRANSACTION_INTAKE_ROUTES.includes(route)) {
    return route;
  }
  const normalizedFallback = String(fallback || '')
    .trim()
    .toLowerCase();
  return ADVISOR_TRANSACTION_INTAKE_ROUTES.includes(normalizedFallback)
    ? normalizedFallback
    : 'new_transaction_batch';
}

function normalizeAdvisorTransactionIntakeItem(item, prompt = '') {
  const source = item && typeof item === 'object' ? item : {};
  const fields = normalizeAdvisorTransactionDraftFields(source.fields || {});
  const template = normalizeAdvisorTransactionTemplate(source.template || fields.template);
  const fieldEvidence = getAdvisorTransactionFieldEvidenceFromSource(source);
  const missingFields = normalizeAdvisorStringArray(
    source.missingFields ||
      source.missing_fields ||
      source.missing ||
      source.needsFields ||
      source.needs_fields,
    12
  );
  const extractionSource =
    source.extraction && typeof source.extraction === 'object' && !Array.isArray(source.extraction)
      ? source.extraction
      : {};
  const sourceAttachmentId = String(
    source.sourceAttachmentId ||
      source.source_attachment_id ||
      source.attachmentId ||
      source.attachment_id ||
      extractionSource.sourceAttachmentId ||
      extractionSource.source_attachment_id ||
      ''
  ).trim();
  return {
    prompt: String(source.sourceText || source.source_text || source.prompt || prompt || '').trim(),
    sourceText: String(
      source.sourceText || source.source_text || source.prompt || prompt || ''
    ).trim(),
    sourceAttachmentId,
    intent: {
      template,
      confidence: clampAdvisorConfidence(source.confidence, 0),
      reason: String(source.reason || '').trim(),
      fields: Object.assign({}, fields, {
        template: fields.template || template
      }),
      sourceAttachmentId,
      extraction: normalizeAdvisorTransactionExtraction(source),
      fieldEvidence,
      missing_fields: missingFields,
      missingFields
    }
  };
}

function getAdvisorTransactionDraftReviewDecisionText(source) {
  return String(
    source.decision ||
      source.verdict ||
      source.status ||
      source.action ||
      source.gateDecision ||
      source.gate_decision ||
      source.result ||
      ''
  )
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, '')
    .replace(/\s+/g, ' ');
}

function advisorReviewDecisionHasApprovalSignal(text) {
  const raw = String(text || '').trim();
  if (
    !raw ||
    /\b(no|not|block|blocked|reject|rejected|deny|denied|unsafe|fail|failed|missing|needs|cannot|cant)\b/.test(
      raw
    )
  ) {
    return false;
  }
  return (
    /^(approve|approved|approval|go|go signal|pass|passed|allow|allowed|accept|accepted|yes|ok|okay|ready|proceed)(?:\b|$)/.test(
      raw
    ) ||
    /\b(safe to approve|approved|approval|go signal|passed|pass|proceed|accepted|ready)\b/.test(raw)
  );
}

function advisorReviewDecisionHasBlockSignal(text) {
  const raw = String(text || '').trim();
  return /\b(block|blocked|reject|rejected|deny|denied|no|not approved|not approve|do not approve|dont approve|needs clarification|needs detail|needs details|unsafe|fail|failed|missing|invented|mixed|unsupported)\b/.test(
    raw
  );
}

function advisorReviewReasonHasBlockSignal(text) {
  const raw = String(text || '').trim();
  return /\b(block|blocked|reject|rejected|missing|unsafe|invented|mixed|unsupported|fail|failed|cannot|can't|not approve|not approved|did not approve|does not match|not faithful|wrong row|another row)\b/.test(
    raw
  );
}

export function normalizeAdvisorTransactionIntakeInterpretation(parsed, prompt = '', options = {}) {
  const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const sourceIntent = String(source.intent || '').trim();
  const rawTransactions = Array.isArray(parsed)
    ? parsed
    : Array.isArray(source.transactions)
      ? source.transactions
      : [];
  const fallbackRoute =
    sourceIntent === 'not_transaction'
      ? 'not_transaction'
      : sourceIntent === 'needs_info'
        ? 'clarification'
        : 'new_transaction_batch';
  const route = normalizeAdvisorTransactionIntakeRoute(
    source.route || source.intake_route,
    fallbackRoute
  );
  const usePendingDraft =
    source.usePendingDraft === true ||
    source.use_pending_draft === true ||
    (route === 'update_pending_draft' &&
      source.usePendingDraft !== false &&
      source.use_pending_draft !== false);
  const legacySingle =
    !rawTransactions.length && (source.template || source.fields) ? [source] : rawTransactions;
  const transactions = legacySingle
    .slice(0, ADVISOR_TRANSACTION_BATCH_LIMIT)
    .map((item) => normalizeAdvisorTransactionIntakeItem(item, prompt))
    .filter(
      (item) =>
        item.intent &&
        (item.intent.template ||
          (item.intent.fields &&
            (item.intent.fields.amount > 0 ||
              item.intent.fields.description ||
              item.intent.fields.categoryName ||
              item.intent.fields.primaryAccountName ||
              item.intent.fields.secondaryAccountName ||
              item.intent.fields.counterpartyName)))
    );
  const schemaVersion = String(
    source.schema_version ||
      source.schemaVersion ||
      source.intake_schema_version ||
      options.schemaVersion ||
      ADVISOR_TRANSACTION_INTAKE_SCHEMA_VERSION
  ).trim();
  return {
    schema_version: schemaVersion || ADVISOR_TRANSACTION_INTAKE_SCHEMA_VERSION,
    route,
    usePendingDraft,
    transactions,
    questions: normalizeAdvisorStringArray(
      source.questions || source.clarifying_questions || (source.question ? [source.question] : []),
      4
    ),
    reason: String(source.reason || source.question || '').trim(),
    confidence: clampAdvisorConfidence(
      source.confidence,
      transactions.reduce(
        (max, item) => Math.max(max, clampAdvisorConfidence(item.intent.confidence, 0)),
        0
      )
    ),
    source: String(options.source || source.source || '').trim() || 'model'
  };
}

export function normalizeAdvisorTransactionDraftReviewDecision(value, candidateId = '') {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawDecision = getAdvisorTransactionDraftReviewDecisionText(source);
  const blockingIssues = normalizeAdvisorStringArray(
    source.blockingIssues || source.blocking_issues,
    8
  );
  const reason = String(source.reason || '').trim();
  const reasonKey = reason.toLowerCase();
  const explicitApproved =
    source.approved === true || source.goSignal === true || source.go_signal === true;
  const explicitBlocked =
    source.approved === false || source.goSignal === false || source.go_signal === false;
  const approved =
    explicitApproved ||
    advisorReviewDecisionHasApprovalSignal(rawDecision) ||
    (!rawDecision &&
      !blockingIssues.length &&
      /\b(faithful|matches|match|passed deterministic|passes deterministic|safe to approve|approved|approve)\b/.test(
        reasonKey
      ) &&
      !/\b(block|blocked|missing|unsafe|invented|mixed|unsupported|fail|failed|cannot|can't)\b/.test(
        reasonKey
      ));
  const blocked =
    explicitBlocked ||
    advisorReviewDecisionHasBlockSignal(rawDecision) ||
    (!approved && blockingIssues.length > 0);
  return {
    schema_version: ADVISOR_TRANSACTION_DRAFT_REVIEW_SCHEMA_VERSION,
    candidateId: String(source.candidateId || source.candidate_id || candidateId || '').trim(),
    decision: approved ? 'approve' : blocked ? 'block' : 'block',
    confidence: clampAdvisorConfidence(source.confidence, approved ? 0.82 : 0.6),
    reason:
      reason ||
      (approved
        ? 'Model reviewer approved this transaction draft.'
        : 'Model reviewer did not approve this transaction draft.'),
    blockingIssues,
    evidenceRefs: normalizeAdvisorStringArray(source.evidenceRefs || source.evidence_refs, 8)
  };
}

export function isAdvisorTransactionDraftReviewDecisionUsable(value, normalizedDecision = null) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const decision = normalizedDecision || normalizeAdvisorTransactionDraftReviewDecision(source);
  if (decision.decision === 'approve') {
    return true;
  }
  if (decision.decision !== 'block') {
    return false;
  }
  const rawDecision = getAdvisorTransactionDraftReviewDecisionText(source);
  const blockingIssues = normalizeAdvisorStringArray(
    source.blockingIssues || source.blocking_issues,
    8
  );
  const reason = String(source.reason || '')
    .trim()
    .toLowerCase();
  if (blockingIssues.length > 0 || advisorReviewReasonHasBlockSignal(reason)) {
    return true;
  }
  return (
    advisorReviewDecisionHasBlockSignal(rawDecision) &&
    !/^(block|blocked|reject|rejected|deny|denied|no|not approved|not approve)$/.test(rawDecision)
  );
}

function advisorCanUseAccountForDraft(account, options = {}) {
  return !!(
    account &&
    account.isActive !== false &&
    (options.allowSystemAccounts === true || account.isSystem !== true)
  );
}

export function getAdvisorTransactionTemplateConfig(template) {
  const value = String(template || 'expense_paid');
  if (value === 'income_received') {
    return {
      categoryTypes: ['income'],
      primaryLabel: 'Received Into',
      primaryGroups: ['asset'],
      primaryPlaceholder: 'Choose the receiving asset account',
      secondaryLabel: '',
      secondaryGroups: [],
      secondaryPlaceholder: '',
      counterpartyLabel: 'Received From',
      counterpartyKinds: ['employer', 'family', 'client', 'other'],
      usesCounterparty: true,
      usesCategory: true
    };
  }
  if (value === 'expense_charged') {
    return {
      categoryTypes: ['expense'],
      primaryLabel: 'Charged To',
      primaryGroups: ['liability'],
      primaryPlaceholder: 'Choose the liability account',
      secondaryLabel: '',
      secondaryGroups: [],
      secondaryPlaceholder: '',
      counterpartyLabel: 'Merchant / Payee',
      counterpartyKinds: ['merchant', 'biller', 'other'],
      usesCounterparty: true,
      usesCategory: true
    };
  }
  if (value === 'debt_payment' || value === 'liability_payment') {
    return {
      categoryTypes: ['debt'],
      primaryLabel: 'Paid From',
      primaryGroups: ['asset'],
      primaryPlaceholder: 'Choose the paying asset account',
      secondaryLabel: 'Paid To',
      secondaryGroups: ['liability'],
      secondaryPlaceholder: 'Choose the liability being reduced',
      counterpartyLabel: '',
      counterpartyKinds: [],
      usesCounterparty: false,
      usesCategory: true
    };
  }
  if (value === 'transfer') {
    return {
      categoryTypes: [],
      primaryLabel: 'From Account',
      primaryGroups: ['asset', 'liability'],
      primaryPlaceholder: 'Choose the source account',
      secondaryLabel: 'To Account',
      secondaryGroups: ['asset', 'liability'],
      secondaryPlaceholder: 'Choose the destination account',
      counterpartyLabel: '',
      counterpartyKinds: [],
      usesCounterparty: false,
      usesCategory: false
    };
  }
  if (value === 'opening_balance') {
    return {
      categoryTypes: [],
      primaryLabel: 'Account',
      primaryGroups: ['asset', 'liability'],
      primaryPlaceholder: 'Choose the account being opened',
      secondaryLabel: '',
      secondaryGroups: [],
      secondaryPlaceholder: '',
      counterpartyLabel: '',
      counterpartyKinds: [],
      usesCounterparty: false,
      usesCategory: false
    };
  }
  if (value === 'manual_journal') {
    return {
      categoryTypes: [],
      primaryLabel: 'Account',
      primaryGroups: [],
      primaryPlaceholder: '',
      secondaryLabel: '',
      secondaryGroups: [],
      secondaryPlaceholder: '',
      counterpartyLabel: '',
      counterpartyKinds: [],
      usesCounterparty: false,
      usesCategory: false
    };
  }
  return {
    categoryTypes: ['expense'],
    primaryLabel: 'Paid From',
    primaryGroups: ['asset'],
    primaryPlaceholder: 'Choose the paying asset account',
    secondaryLabel: '',
    secondaryGroups: [],
    secondaryPlaceholder: '',
    counterpartyLabel: 'Paid To',
    counterpartyKinds: ['merchant', 'biller', 'other'],
    usesCounterparty: true,
    usesCategory: true
  };
}

export function advisorTransactionTextKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bcreditcard\b/g, 'credit card')
    .replace(/\bcc\b/g, 'credit card')
    .replace(/\bacct\b/g, 'account')
    .replace(/\bexp\b/g, 'expense')
    .replace(/\bpayed\b/g, 'paid')
    .replace(/\b(?:credt|credut|cred)\b/g, 'credit')
    .replace(/\bbalnce\b/g, 'balance')
    .replace(/\bstatment\b/g, 'statement')
    .replace(/\bmin\s+due\b/g, 'minimum due')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function advisorPromptRequestsTransactionHistory(prompt) {
  const text = ' ' + advisorTransactionTextKey(prompt) + ' ';
  return /\b(?:same as|same category|same merchant|same payee|same account|same amount|last time|last one|last transaction|previous|prior|repeat|recreate|again|as usual|usual|like last|like before|similar to|copy)\b/.test(
    text
  );
}

export function advisorTransactionFieldLabel(field, template) {
  const labels = {
    template: 'transaction type',
    date: 'date',
    amount: 'amount',
    categoryId: 'category',
    primaryAccountId: 'account',
    secondaryAccountId: 'second account'
  };
  if (field === 'primaryAccountId') {
    const config = getAdvisorTransactionTemplateConfig(template);
    if (template === 'expense_paid') {
      return 'payment account';
    }
    if (template === 'expense_charged') {
      return 'credit card or loan account';
    }
    return (config.primaryLabel || labels[field]).toLowerCase();
  }
  if (field === 'secondaryAccountId') {
    const config = getAdvisorTransactionTemplateConfig(template);
    return (config.secondaryLabel || labels[field]).toLowerCase();
  }
  return (
    labels[field] ||
    String(field || '')
      .replace(/Id$/, '')
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
  );
}

function todayISO() {
  const date = new Date();
  return formatISODate(date);
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatISODate(date) {
  return (
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  );
}

function addDaysISO(value, days) {
  const date = parseISODate(value);
  if (!date) {
    return '';
  }
  date.setDate(date.getDate() + (Number(days) || 0));
  return formatISODate(date);
}

export function normalizeAdvisorDateKey(dateValue) {
  const direct = String(dateValue || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) {
    const parsed = parseISODate(direct[0]);
    return parsed ? direct[0] : '';
  }
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return formatISODate(date);
}

export function extractAdvisorAmountMentions(text) {
  const raw = String(text || '');
  const mentions = [];
  const amountRegex =
    /(?:(\u20b1|\$|PHP|USD|php|usd|p)\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s*([kKmM]))?(?:\s*(pesos?|pese|php|usd|\$))?/gi;
  let match = amountRegex.exec(raw);
  while (match) {
    const start = match.index;
    const end = amountRegex.lastIndex;
    const before = raw.charAt(start - 1);
    const after = raw.charAt(end);
    const prefix = raw.slice(Math.max(0, start - 14), start).toLowerCase();
    const afterText = raw.slice(end, end + 24).toLowerCase();
    const listMarkerText = raw.slice(start, Math.min(raw.length, end + 4));
    const prefixCurrency = String(match[1] || '').trim();
    const scaleText = String(match[3] || '').trim();
    const suffixCurrency = String(match[4] || '').trim();
    const amount = parseAdvisorAmountNumberText(match[2], scaleText);
    const currencySignal = [prefixCurrency, suffixCurrency].join(' ');
    const currency = /\$|\busd\b/i.test(currencySignal)
      ? 'USD'
      : /\u20b1|\bphp\b|\bp\b|pesos?|pese/i.test(currencySignal)
        ? 'PHP'
        : '';
    const looksLikeMonthDay =
      /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s*$/i.test(
        prefix
      );
    const looksLikeListMarker =
      (start === 0 || /\n\s*$/.test(raw.slice(0, start))) && /^\d+\s*[\.)]\s/.test(listMarkerText);
    const looksLikeCount =
      /^\s*(transactions?|entries|drafts?|accounts?|categories?|items?|rows?)\b/.test(afterText);
    const looksLikeUnitCount =
      !currency &&
      amount <= 50 &&
      /^\s*(?:coffees?|cups?|orders?|pieces?|pcs|servings?|pax|people|persons?|guests?|tickets?|items?|products?|meals?|drinks?|bottles?|packs?|boxes?|sets?)\b/.test(
        afterText
      );
    if (
      amount > 0 &&
      before !== '-' &&
      after !== '-' &&
      before !== '/' &&
      after !== '/' &&
      !looksLikeMonthDay &&
      !looksLikeListMarker &&
      !looksLikeCount &&
      !looksLikeUnitCount
    ) {
      mentions.push({
        start,
        end,
        text: match[0].trim(),
        numberText: String(match[2] || '') + scaleText,
        amount,
        currency
      });
    }
    match = amountRegex.exec(raw);
  }
  return mentions;
}

function advisorLooksLikeDelimitedTransactionRow(text) {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return /\s[-\u2013\u2014|]\s/.test(raw) && /[A-Za-z]/.test(raw);
}

function advisorLooksLikeTransactionListRow(text) {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) {
    return false;
  }
  if (advisorLooksLikeDelimitedTransactionRow(raw)) {
    return true;
  }
  return (
    parseAdvisorAmountFromText(raw) > 0 &&
    /\b(paid|pay|spent|spend|used|use|bought|buy|charged|charge|received|receive|transferred|transfer|moved|move|sent|send|gave|give|handed)\b/i.test(
      raw
    )
  );
}

function parseAdvisorDelimitedRowAmount(text) {
  const raw = String(text || '');
  if (!advisorLooksLikeDelimitedTransactionRow(raw)) {
    return 0;
  }
  const mentions = extractAdvisorAmountMentions(raw);
  if (mentions.length !== 1) {
    return 0;
  }
  return mentions[0].amount;
}

export function parseAdvisorAmountFromText(text) {
  const raw = String(text || '');
  const shorthandOnly =
    /^\s*(?:\u20b1|\$|PHP|USD|php|usd|p)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*([kKmM])\s*(?:pesos?|pese|php|usd|\$)?\s*$/i.exec(
      raw
    );
  if (shorthandOnly && shorthandOnly[1]) {
    return parseAdvisorAmountNumberText(shorthandOnly[1], shorthandOnly[2]);
  }
  const oneTransactionTotal =
    /\b(?:one|single)\s+transaction\b[\s\S]{0,32}?(?:so|total|for|=)?\s*(?:\u20b1|\$|PHP|USD|php|usd|p)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*([kKmM])?/i.exec(
      raw
    );
  if (oneTransactionTotal && oneTransactionTotal[1]) {
    const amount = parseAdvisorAmountNumberText(oneTransactionTotal[1], oneTransactionTotal[2]);
    return extractAdvisorAmountMentions(raw).some(
      (mention) => roundMoney(mention.amount) === amount
    )
      ? amount
      : 0;
  }
  const explicit =
    /(?:\u20b1|\$|PHP|USD|php|usd|p)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*([kKmM])?|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*([kKmM])?(?:\s*(?:pesos?|pese|php|usd)\b|\s*\$)/i.exec(
      raw
    );
  if (explicit) {
    return parseAdvisorAmountNumberText(explicit[1] || explicit[3], explicit[2] || explicit[4]);
  }
  const delimitedRowAmount = parseAdvisorDelimitedRowAmount(raw);
  if (delimitedRowAmount > 0) {
    return delimitedRowAmount;
  }
  const expandedContextual =
    /\b(?:amount|total|balance|payment amount|bill amount|statement balance|minimum due)\b[\s\S]{0,96}?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*([kKmM])?/i.exec(
      raw
    );
  if (expandedContextual) {
    const amount = parseAdvisorAmountNumberText(expandedContextual[1], expandedContextual[2]);
    return extractAdvisorAmountMentions(raw).some(
      (mention) => roundMoney(mention.amount) === amount
    )
      ? amount
      : 0;
  }
  const contextual =
    /\b(?:amount|for|cost|costs|paid|payed|payoff|settled|settle|balance|bill|spend|spent|charged|transferred|transfer|received|sent|send|gave|give|handed|used|buy|bought|purchase|purchased)\b[\s\S]{0,48}?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*([kKmM])?/i.exec(
      raw
    );
  if (contextual) {
    const amount = parseAdvisorAmountNumberText(contextual[1], contextual[2]);
    return extractAdvisorAmountMentions(raw).some(
      (mention) => roundMoney(mention.amount) === amount
    )
      ? amount
      : 0;
  }
  const reverseContextual =
    /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*([kKmM])?[\s\S]{0,48}?\b(?:paid|payed|payoff|settled|settle|balance|bill|spend|spent|charged|transferred|transfer|received|sent|send|gave|give|handed|used|purchase|purchased)\b/i.exec(
      raw
    );
  if (reverseContextual) {
    const amount = parseAdvisorAmountNumberText(reverseContextual[1], reverseContextual[2]);
    return extractAdvisorAmountMentions(raw).some(
      (mention) => roundMoney(mention.amount) === amount
    )
      ? amount
      : 0;
  }
  return 0;
}

export function advisorPromptSupportsAmount(prompt, amount) {
  const numeric = roundMoney(Number(amount) || 0);
  if (!(numeric > 0)) {
    return false;
  }
  return extractAdvisorAmountMentions(prompt).some(
    (mention) => roundMoney(mention.amount) === numeric
  );
}

function advisorFieldValueTextMatches(sourceText, value) {
  const sourceKey = advisorTransactionTextKey(sourceText);
  const valueKey = advisorTransactionTextKey(value);
  if (!(sourceKey && valueKey)) {
    return false;
  }
  if (sourceKey.indexOf(valueKey) >= 0 || valueKey.indexOf(sourceKey) >= 0) {
    return true;
  }
  const tokens = valueKey.split(/\s+/).filter((token) => token.length > 2);
  return tokens.length > 0 && tokens.every((token) => sourceKey.indexOf(token) >= 0);
}

function advisorFieldHasTextSupport(sourceText, evidenceText, value) {
  return (
    advisorFieldValueTextMatches(sourceText, value) ||
    advisorFieldValueTextMatches(evidenceText, value)
  );
}

function advisorFieldEvidenceHasAnyValue(evidence) {
  return ADVISOR_TRANSACTION_FIELD_EVIDENCE_KEYS.some((key) =>
    String((evidence && evidence[key]) || '').trim()
  );
}

export function validateAdvisorTransactionFieldEvidence(intent, prompt = '', options = {}) {
  const sourceText = String(options.sourceText || prompt || '').trim();
  const fields = normalizeAdvisorTransactionDraftFields((intent && intent.fields) || {});
  const fieldEvidence = normalizeAdvisorTransactionFieldEvidence(
    intent &&
      (intent.fieldEvidence ||
        intent.field_evidence ||
        intent.evidence ||
        (intent.extraction &&
          (intent.extraction.fieldEvidence ||
            intent.extraction.field_evidence ||
            intent.extraction.evidence)))
  );
  const invalidReasons = [];
  const warnings = [];
  const supportedFields = [];
  if (fields.amount > 0) {
    const evidenceSupportsAmount = advisorPromptSupportsAmount(fieldEvidence.amount, fields.amount);
    const sourceMentions = extractAdvisorAmountMentions(sourceText);
    const sourceOnlyRepeatsSameAmount =
      sourceMentions.length > 0 &&
      sourceMentions.every((mention) => roundMoney(mention.amount) === roundMoney(fields.amount));
    if (
      evidenceSupportsAmount ||
      sourceOnlyRepeatsSameAmount ||
      options.allowUnsupportedAmount === true
    ) {
      supportedFields.push('amount');
    } else {
      invalidReasons.push(
        'Amount evidence does not support the proposed amount for this transaction candidate.'
      );
    }
  }
  if (advisorFieldEvidenceHasAnyValue(fieldEvidence)) {
    [
      { key: 'date', value: fields.date, label: 'date' },
      { key: 'primaryAccount', value: fields.primaryAccountName, label: 'payment account' },
      { key: 'secondaryAccount', value: fields.secondaryAccountName, label: 'second account' },
      { key: 'counterparty', value: fields.counterpartyName, label: 'merchant or payee' },
      { key: 'description', value: fields.description, label: 'description' }
    ].forEach((item) => {
      if (!item.value) {
        return;
      }
      if (advisorFieldHasTextSupport(sourceText, fieldEvidence[item.key], item.value)) {
        supportedFields.push(item.key);
        return;
      }
      if (String(fieldEvidence[item.key] || '').trim()) {
        warnings.push(
          item.label +
            ' is normalized from evidence text: ' +
            String(fieldEvidence[item.key] || '').trim()
        );
      }
    });
  }
  return {
    ok: invalidReasons.length === 0,
    invalidReasons,
    warnings,
    fieldEvidence,
    supportedFields: supportedFields.filter((field, index, list) => list.indexOf(field) === index)
  };
}

export function parseAdvisorDateFromText(text, options = {}) {
  const raw = String(text || '');
  const explicit = /\b[0-9]{4}\b/.test(raw) ? normalizeAdvisorDateKey(raw) : '';
  if (explicit) {
    return explicit;
  }
  const inline = /(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (inline && parseISODate(inline[1])) {
    return inline[1];
  }
  const monthNames = {
    january: 0,
    jan: 0,
    february: 1,
    feb: 1,
    march: 2,
    mar: 2,
    april: 3,
    apr: 3,
    may: 4,
    june: 5,
    jun: 5,
    july: 6,
    jul: 6,
    august: 7,
    aug: 7,
    september: 8,
    sep: 8,
    sept: 8,
    october: 9,
    oct: 9,
    november: 10,
    nov: 10,
    december: 11,
    dec: 11
  };
  const monthMatch =
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+([0-9]{1,2})(?:st|nd|rd|th)?(?:,\s*([0-9]{4}))?\b/i.exec(
      raw
    );
  if (monthMatch) {
    const monthIndex = monthNames[String(monthMatch[1] || '').toLowerCase()];
    const day = Number(monthMatch[2]) || 0;
    const currentDate = String(options.currentDate || todayISO());
    const fallbackYear = Number(currentDate.slice(0, 4)) || new Date().getFullYear();
    const year = Number(monthMatch[3]) || fallbackYear;
    const parsed = new Date(year, monthIndex, day);
    if (
      parsed &&
      parsed.getFullYear() === year &&
      parsed.getMonth() === monthIndex &&
      parsed.getDate() === day
    ) {
      return formatISODate(parsed);
    }
  }
  const currentDate = String(options.currentDate || todayISO());
  if (/\b(today|todya|tdy)\b/i.test(raw)) {
    return currentDate;
  }
  if (/\byesterday\b/i.test(raw)) {
    return addDaysISO(currentDate, -1);
  }
  return '';
}

function advisorFinanceIntentText(prompt) {
  return ' ' + advisorTransactionTextKey(prompt) + ' ';
}

function advisorTextHasLiabilityPaymentCue(text) {
  return (
    /\b(?:credit card|card|loan|debt)\s+(?:bill|payment|payoff|pay off|balance|statement|statement balance|minimum due)\b/.test(
      text
    ) ||
    /\b(?:bill|payment|payoff|pay off|balance|statement balance|minimum due)\s+(?:for|to|on|of|toward|towards)\s+(?:my\s+|the\s+)?(?:credit card|card|loan|debt)\b/.test(
      text
    ) ||
    /\b(?:pay|paid|paying|settle|settled|clear|cleared)\s+(?:for\s+)?(?:my\s+|the\s+)?(?:credit card|card|loan|debt)\b/.test(
      text
    ) ||
    /\b(?:pay|paid|paying|settle|settled|clear|cleared)\s+(?:the\s+)?(?:statement balance|minimum due|card balance|loan balance)\b/.test(
      text
    ) ||
    /\b(?:paid off|pay off|paying off|payoff)\s+(?:my\s+|the\s+)?(?:credit card|card|loan|debt)\b/.test(
      text
    ) ||
    /\b(?:statement balance|minimum due|card balance|loan balance)\b/.test(text)
  );
}

function advisorTextHasCardChargeCue(text) {
  if (advisorTextHasLiabilityPaymentCue(text)) {
    return false;
  }
  return (
    /\b(?:charge|charged|billed)\s+(?:to|on)\s+(?:my\s+|the\s+)?(?:[a-z0-9]+\s+){0,4}(?:credit card|card|visa|mastercard|amex)\b/.test(
      text
    ) ||
    /\b(?:credit card|card|visa|mastercard|amex)\s+(?:charge|charged|purchase|expense)\b/.test(
      text
    ) ||
    /\bon\s+(?:my\s+|the\s+)?(?:[a-z0-9]+\s+){0,4}(?:credit card|card|visa|mastercard|amex)\b/.test(
      text
    ) ||
    /\b(?:buy|bought|purchase|purchased|paid for|spent|expense)\b[\s\S]{0,80}\b(?:with|using|on)\s+(?:my\s+|the\s+)?(?:[a-z0-9]+\s+){0,4}(?:credit card|card|visa|mastercard|amex)\b/.test(
      text
    )
  );
}

export function advisorPromptImpliesLiabilityPayment(prompt) {
  return advisorTextHasLiabilityPaymentCue(advisorFinanceIntentText(prompt));
}

export function classifyAdvisorFinanceIntent(prompt, options = {}) {
  const raw = String(prompt || '');
  const text = advisorFinanceIntentText(raw);
  const amount = parseAdvisorAmountFromText(raw);
  const amountMentions = extractAdvisorAmountMentions(raw);
  const amountMention =
    amountMentions.find((mention) => roundMoney(mention.amount) === roundMoney(amount)) ||
    amountMentions[0] ||
    null;
  const explicitDate = parseAdvisorDateFromText(raw, options);
  const defaultDate =
    normalizeAdvisorDateKey(options.currentDate) ||
    (options.currentDate ? String(options.currentDate) : todayISO());
  const dateDefaulted = !explicitDate && options.defaultDateForUndated === true;
  let kind = ADVISOR_FINANCE_INTENT_KINDS.UNKNOWN;
  let template = '';
  let confidence = 0.35;
  let reason = 'No strong finance intent signal.';
  if (
    /\b(?:delete|remove|void|cancel)\b[\s\S]{0,80}\b(?:transaction|draft|entry|payment|expense|income)\b/.test(
      text
    )
  ) {
    kind = ADVISOR_FINANCE_INTENT_KINDS.DELETE;
    confidence = 0.7;
    reason = 'Delete language targets an existing finance record.';
  } else if (
    /\b(?:revise|edit|update|change|correct|fix)\b[\s\S]{0,80}\b(?:transaction|draft|entry|payment|expense|income)\b/.test(
      text
    )
  ) {
    kind = ADVISOR_FINANCE_INTENT_KINDS.REVISE;
    confidence = 0.7;
    reason = 'Revision language targets an existing finance record.';
  } else if (
    /\b(?:add|create|make|new)\s+(?:a\s+|an\s+|the\s+)?(?:account|category|counterparty|merchant|payee|wallet)\b/.test(
      text
    )
  ) {
    kind = ADVISOR_FINANCE_INTENT_KINDS.ENTITY_CREATE;
    confidence = 0.65;
    reason = 'Entity creation language targets workbook setup.';
  } else if (advisorTextHasLiabilityPaymentCue(text)) {
    kind = ADVISOR_FINANCE_INTENT_KINDS.LIABILITY_PAYMENT;
    template = 'debt_payment';
    confidence = 0.9;
    reason = 'Credit-card bill/payment language describes reducing a liability.';
  } else if (
    /\b(?:transfer|transferred|move|moved|send|sent|gave|give|handed)\b/.test(text) &&
    /\b(?:from|to|into|between|account|wallet|cash|gcash|maya|bank|savings|checking|card)\b/.test(
      text
    )
  ) {
    kind = ADVISOR_FINANCE_INTENT_KINDS.TRANSFER;
    template = 'transfer';
    confidence = 0.78;
    reason = 'Movement language describes money moving between accounts.';
  } else if (advisorTextHasCardChargeCue(text)) {
    kind = ADVISOR_FINANCE_INTENT_KINDS.CARD_CHARGE;
    template = 'expense_charged';
    confidence = 0.86;
    reason = 'Charged-to-card language describes a new liability-backed expense.';
  } else if (/\b(?:received|salary|income|paid by|from employer|payroll|paycheck)\b/.test(text)) {
    kind = ADVISOR_FINANCE_INTENT_KINDS.INCOME;
    template = 'income_received';
    confidence = 0.75;
    reason = 'Received-income language describes income.';
  } else if (
    /\b(?:paid|spent|buy|used|bought|purchase|purchased|expense|bill)\b/.test(text) ||
    amount > 0
  ) {
    kind = ADVISOR_FINANCE_INTENT_KINDS.PURCHASE;
    template = 'expense_paid';
    confidence = amount > 0 ? 0.68 : 0.55;
    reason = 'Purchase or paid-expense language describes an asset-paid expense.';
  }
  return {
    kind,
    template,
    confidence,
    reason,
    amount,
    currency: amountMention && amountMention.currency ? amountMention.currency : '',
    date: explicitDate || (dateDefaulted ? defaultDate : ''),
    dateDefaulted,
    sourceText: raw,
    evidence: {
      amount: amountMention ? amountMention.text : '',
      date: explicitDate ? explicitDate : '',
      template: template || kind
    }
  };
}

function getAdvisorTransactionListBody(prompt) {
  const raw = String(prompt || '')
    .replace(/\r/g, '\n')
    .trim();
  if (!raw) {
    return '';
  }
  const header =
    /\b(?:also\s+)?(?:add|record|log|post|create|enter|book|save|put)\s+(?:(?:these|thse|this|the|my|some|\d+)\s*)?(?:transactions?|expenses?|payments?|purchases?|entries?)\b(?:\s+for\s+(?:today|todya|tdy|yesterday))?\s*[:\-]?\s*/i.exec(
      raw
    );
  if (header) {
    const afterHeader = raw.slice(header.index + header[0].length).trim();
    if (afterHeader) {
      return afterHeader;
    }
  }
  return raw;
}

function cleanAdvisorTransactionListRow(value) {
  return String(value || '')
    .replace(/^\s*(?:[-*]\s+|\d+\s*[\.)](?!\d)\s*)/, '')
    .replace(/\s+/g, ' ')
    .replace(/[,.!?;:]+$/g, '')
    .trim();
}

function splitAdvisorTransactionListRows(prompt) {
  const body = getAdvisorTransactionListBody(prompt);
  if (!body) {
    return [];
  }
  return body
    .split(/\n+|;+/)
    .map((line) => cleanAdvisorTransactionListRow(line))
    .filter(Boolean)
    .slice(0, ADVISOR_TRANSACTION_BATCH_LIMIT);
}

function splitAdvisorNarrativeSentences(prompt) {
  const body = getAdvisorTransactionListBody(prompt) || String(prompt || '');
  const normalized = body
    .replace(/^[\s?!.:,;-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return [];
  }
  const matches = normalized.match(/[^.!?;]+[.!?;]?/g) || [];
  return matches
    .map((sentence) =>
      sentence
        .replace(/^[\s?!.:,;-]+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);
}

function advisorNarrativeSentenceIsFiller(sentence) {
  const key = advisorTransactionTextKey(sentence);
  if (!key) {
    return true;
  }
  if (
    /\b(?:add|create|make|track|open|opened)\b[\s\S]{0,80}\b(?:new\s+)?(?:bank\s+|savings\s+|checking\s+|current\s+|wallet\s+|cash\s+|credit\s+card\s+|card\s+)?account\b/.test(
      key
    ) &&
    !/\b(?:paid|spent|bought|buy|purchase|purchased|charged|charge|transferred|transfer|received|salary|income|expense|payment)\b/.test(
      key
    )
  ) {
    return true;
  }
  if (extractAdvisorAmountMentions(sentence).length) {
    return false;
  }
  if (/^(hi|hello|hey|thanks|thank you|thankyou)$/.test(key)) {
    return true;
  }
  return /\b(?:can|could|please|help)\b[\s\S]{0,60}\b(?:add|record|log|post|create|enter|book|save)\b[\s\S]{0,60}\b(?:all\s+)?(?:these|this|the|my|multiple|transactions?|expenses?|payments?|purchases?|entries?)\b/.test(
    key
  );
}

function advisorNarrativeSentenceStartsTransaction(sentence) {
  return /\b(?:spent|spend|bought|buy|purchase|purchased|paid|pay|charged|charge|went|ate|eat|dined|had|got|ordered|visited|received|transferred|transfer|moved|sent|gave|handed)\b/i.test(
    String(sentence || '')
  );
}

function advisorNarrativeSentenceHasMerchantCue(sentence) {
  const match = /\b(?:at|from|to)\s+(?:my\s+|the\s+)?([A-Za-z][A-Za-z0-9&.' -]{1,60})/.exec(
    String(sentence || '')
  );
  return !!(match && match[1] && !advisorLooksLikeTransactionListAccountName(match[1]));
}

function advisorNarrativeSentenceIsPaymentContinuation(sentence) {
  const raw = String(sentence || '');
  if (extractAdvisorAmountMentions(raw).length) {
    return false;
  }
  if (
    /\b(?:spent|spend|bought|buy|purchase|purchased|went|ate|eat|dined|had|got|ordered|visited|received|transferred|transfer|moved|sent|send|gave|handed)\b/i.test(
      raw
    )
  ) {
    return false;
  }
  return (
    /\b(?:it|that|this)?\s*(?:was\s+)?(?:paid|charged|billed)\b[\s\S]{0,50}\b(?:cash|card|credit\s+card|debit\s+card|gcash|maya|wallet|bank|paypal)\b/i.test(
      raw
    ) ||
    /\b(?:using|with|from|via|through)\s+(?:my\s+|the\s+)?(?:cash|card|credit\s+card|debit\s+card|gcash|maya|wallet|bank|paypal)\b/i.test(
      raw
    )
  );
}

function advisorNarrativeTextHasAmount(text) {
  return extractAdvisorAmountMentions(text).length > 0;
}

function advisorNarrativeSentenceIsSharedPaymentContinuation(sentence) {
  const raw = String(sentence || '');
  return (
    /\b(?:everything|all(?:\s+of)?\s+(?:these|them|it|this|the\s+transactions?|the\s+purchases?|the\s+expenses?)|they|both|each(?:\s+one)?)\b[\s\S]{0,70}\b(?:was|were|is|are)?\s*(?:paid|charged|billed)\b[\s\S]{0,70}\b(?:cash|card|credit\s+card|debit\s+card|gcash|maya|wallet|bank|paypal)\b/i.test(
      raw
    ) ||
    /\b(?:everything|all(?:\s+of)?\s+(?:these|them|it|this|the\s+transactions?|the\s+purchases?|the\s+expenses?)|they|both|each(?:\s+one)?)\b[\s\S]{0,70}\b(?:using|with|from|via|through)\s+(?:my\s+|the\s+)?(?:cash|card|credit\s+card|debit\s+card|gcash|maya|wallet|bank|paypal)\b/i.test(
      raw
    )
  );
}

function advisorNarrativeTextLooksLikeAccountOpeningEvent(text) {
  const key = advisorTransactionTextKey(text);
  if (!key) {
    return false;
  }
  const asksForAccount =
    /\b(?:add|create|make|track|open|opened)\b[\s\S]{0,80}\b(?:new\s+)?(?:bank\s+|savings\s+|checking\s+|credit\s+card\s+|wallet\s+)?account\b/.test(
      key
    ) ||
    /\bopened\s+(?:a\s+)?(?:bank\s+|savings\s+|checking\s+|credit\s+card\s+|wallet\s+)?account\b/.test(
      key
    );
  if (!asksForAccount) {
    return false;
  }
  const hasAccountOpeningCue =
    /\b(?:opened|opening balance|initial balance|amounting to|with balance|with an? balance|funded with|starting balance)\b/.test(
      key
    );
  const hasTransactionCue =
    /\b(?:paid|spent|bought|buy|purchase|purchased|charged|charge|transferred|transfer|received|salary|income|expense|payment)\b/.test(
      key
    );
  return hasAccountOpeningCue && !hasTransactionCue;
}

function splitAdvisorNarrativeTransactionGroups(prompt) {
  const sentences = splitAdvisorNarrativeSentences(prompt);
  const groups = [];
  let current = [];
  const pushCurrent = () => {
    const text = current.join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      groups.push(text);
    }
    current = [];
  };
  const appendSharedPayment = (sentence) => {
    const text = String(sentence || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      return;
    }
    if (current.length) {
      pushCurrent();
    }
    for (let index = 0; index < groups.length; index += 1) {
      if (!advisorTransactionTextKey(groups[index]).includes(advisorTransactionTextKey(text))) {
        groups[index] = (groups[index] + ' ' + text).replace(/\s+/g, ' ').trim();
      }
    }
  };
  sentences.forEach((sentence) => {
    if (advisorNarrativeSentenceIsFiller(sentence)) {
      return;
    }
    if (advisorNarrativeSentenceIsSharedPaymentContinuation(sentence)) {
      appendSharedPayment(sentence);
      return;
    }
    const hasAmount = advisorNarrativeTextHasAmount(sentence);
    const currentHasAmount = advisorNarrativeTextHasAmount(current.join(' '));
    const startsTransaction = advisorNarrativeSentenceStartsTransaction(sentence);
    const isContinuation = advisorNarrativeSentenceIsPaymentContinuation(sentence);
    if (!current.length) {
      if (startsTransaction || hasAmount) {
        current = [sentence];
      }
      return;
    }
    if (hasAmount) {
      if (!currentHasAmount) {
        if (
          startsTransaction &&
          !isContinuation &&
          advisorNarrativeSentenceHasMerchantCue(sentence)
        ) {
          pushCurrent();
          current = [sentence];
        } else {
          current.push(sentence);
        }
      } else {
        pushCurrent();
        current = [sentence];
      }
      return;
    }
    if (isContinuation) {
      current.push(sentence);
      return;
    }
    if (startsTransaction) {
      pushCurrent();
      current = [sentence];
      return;
    }
    current.push(sentence);
  });
  pushCurrent();
  return groups.slice(0, ADVISOR_TRANSACTION_BATCH_LIMIT);
}

function parseAdvisorTransactionListRowAmount(row) {
  const mentions = extractAdvisorAmountMentions(row);
  if (!mentions.length) {
    return null;
  }
  const explicitMentions = mentions.filter((mention) => mention.currency);
  return explicitMentions[0] || mentions[0];
}

function getAdvisorTransactionListRowParts(row) {
  return String(row || '')
    .split(/\s+(?:[-\u2013\u2014|])\s+/)
    .map((part) => cleanAdvisorEditValue(part))
    .filter(Boolean);
}

function advisorPartContainsAmountMention(part, mention) {
  if (!(part && mention)) {
    return false;
  }
  if (String(part).indexOf(mention.text) >= 0) {
    return true;
  }
  const amount = parseAdvisorAmountFromText(part);
  return roundMoney(amount) === roundMoney(mention.amount);
}

function findAdvisorTransactionListAmountPartIndex(parts, mention) {
  for (let index = 0; index < parts.length; index += 1) {
    if (advisorPartContainsAmountMention(parts[index], mention)) {
      return index;
    }
  }
  return -1;
}

function cleanAdvisorListRowAccountName(value) {
  return cleanAdvisorEditValue(value)
    .replace(/^(?:from|using|with|on|charged to|charged on|paid from)\s+(?:my\s+)?/i, '')
    .trim();
}

function advisorLooksLikeTransactionListAccountName(value) {
  return /\b(?:cash|card|credit\s+card|debit\s+card|gcash|maya|paymaya|wallet|bank|checking|savings|fund|loan|paypal|account)\b/i.test(
    String(value || '')
  );
}

function extractAdvisorListRowAccountNameFromText(value) {
  const raw = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  const match =
    /\b(?:from|using|with|on|charged\s+to|charged\s+on|paid\s+from)\s+(?:my\s+)?([A-Za-z][A-Za-z0-9&.' -]{1,50}?)(?=\s+(?:for|to|on|at|dated|date)\b|[,.!?;:]|$)/i.exec(
      raw
    );
  if (!match || !match[1] || !advisorLooksLikeTransactionListAccountName(match[1])) {
    return '';
  }
  return cleanAdvisorListRowAccountName(match[1]);
}

function extractAdvisorListRowLeadingAccountName(value) {
  const raw = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  const match =
    /^(cash|gcash|maya|paymaya|credit\s+card|debit\s+card|card|wallet|bank|checking|savings|paypal)\b/i.exec(
      raw
    );
  return match && match[1] ? cleanAdvisorListRowAccountName(match[1]) : '';
}

function cleanAdvisorListRowDetailText(value) {
  return cleanAdvisorEditValue(value)
    .replace(/^(?:me|myself)\s+(?:some\s+|a\s+|an\s+|the\s+)?/i, '')
    .replace(/\b(?:priced|price|costing|costs?|worth)\s+(?:at|for)?\s*$/i, '')
    .replace(/\b(?:for|on|using|with|from|charged\s+to|charged\s+on|paid\s+from)\s*$/i, '')
    .replace(/\bwas\s*[,.;:]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAdvisorListRowPostAmountDetail(value, accountName) {
  let text = cleanAdvisorEditValue(value);
  const account = cleanAdvisorEditValue(accountName);
  if (account) {
    const escapedAccount = account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp('^' + escapedAccount + '\\b', 'i'), '');
  }
  return cleanAdvisorListRowDetailText(text)
    .replace(
      /^(?:i\s+)?(?:to\s+)?(?:pay|paid|spend|spent|buy|bought|purchase|purchased)\s+(?:for\s+)?/i,
      ''
    )
    .replace(/^for\s+/i, '')
    .replace(
      /\b(?:charged\s+to|charged\s+on|using|with|from|on)\s+(?:my\s+)?[A-Za-z][A-Za-z0-9&.' -]{1,50}$/i,
      ''
    )
    .replace(/\bwas\s*[,.;:]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAdvisorPurposeDescription(value) {
  const cleaned = cleanAdvisorEditValue(value);
  if (/^(?:alowance|allowence)$/i.test(cleaned)) {
    return 'allowance';
  }
  return cleaned;
}

function inferAdvisorAsPurposeDescription(raw) {
  const match =
    /\bas\s+(?!a\s+|an\s+|the\s+)([A-Za-z][A-Za-z0-9&.' -]{1,60}?)(?:\s+[-\u2013\u2014|]\s+|\s+(?:from|using|with|on|today|yesterday)\b|[.!?]|$)/i.exec(
      String(raw || '')
    );
  return match && match[1] ? normalizeAdvisorPurposeDescription(match[1]) : '';
}

function cleanAdvisorListRowAmountPartDetail(value, mention) {
  let text = cleanAdvisorEditValue(value);
  if (mention && mention.text && text.indexOf(mention.text) >= 0) {
    text = text.replace(mention.text, ' ');
  } else if (mention && mention.numberText) {
    const escapedNumber = String(mention.numberText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(
      new RegExp(
        '(?:\\u20b1|\\$|PHP|USD|php|usd|p)?\\s*' +
          escapedNumber +
          '(?:\\s*(?:pesos?|pese|php|usd|\\$))?',
        'i'
      ),
      ' '
    );
  }
  text = text
    .replace(/\b(?:pesos?|pese|php|usd)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleanAdvisorListRowPostAmountDetail(text, '');
}

function advisorListRowDetailLooksGeneric(value) {
  return /^(?:i\s+)?(?:used|paid|pay|spent|spend|charged|charge|sent|send|gave|give|handed|transferred|transfer|moved|move|bought|buy|purchased|purchase)$/i.test(
    cleanAdvisorListRowDetailText(value)
  );
}

function cleanAdvisorListRowCounterpartyName(value) {
  const raw = cleanAdvisorEditValue(value);
  const atMatch = /\bat\s+([A-Za-z][A-Za-z0-9&.' -]{1,60})$/i.exec(raw);
  const source = atMatch && atMatch[1] ? atMatch[1] : raw;
  const cleaned = cleanAdvisorEditValue(source)
    .replace(
      /\b(?:phone load|parking fee|toll fee|food|meal|meals|grocery|groceries|transport|subscription|subscriptions|utility|utilities|allowance|alowance|allowence|load|parking|ride|toll|fee|expense|bill|payment)\b$/i,
      ''
    )
    .replace(/\bwas\s*[,.;:]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !cleaned &&
    /^(?:food|meal|meals|grocery|groceries|transport|subscription|subscriptions|utility|utilities|allowance|alowance|allowence|load|phone load|parking|parking fee|toll|toll fee|fee|expense|bill|payment)$/i.test(
      raw
    )
  ) {
    return '';
  }
  return cleaned || cleanAdvisorEditValue(value);
}

function inferAdvisorTransactionListTemplate(row, accountName) {
  const accountText = String(accountName || '');
  const inferred = inferAdvisorTransactionTemplateFromText(row);
  const accountLooksLikeLiability = /\b(credit\s+card|card|loan)\b/i.test(accountText);
  const rowLooksLikeLiabilityPayment =
    /\b(?:credit\s+card\s+payment|card\s+payment|loan\s+payment|pay(?:ing|ed)?\s+(?:my\s+)?(?:credit\s+card|card|loan)|paid\s+(?:my\s+)?(?:credit\s+card|card|loan))\b/i.test(
      String(row || '')
    ) && !/\bpaid\s+for\b/i.test(String(row || ''));
  if (/\bcharged\s+to\b/i.test(String(row || '')) && accountText && !accountLooksLikeLiability) {
    return 'expense_paid';
  }
  if (accountLooksLikeLiability && !rowLooksLikeLiabilityPayment) {
    return 'expense_charged';
  }
  if (inferred) {
    return inferred;
  }
  if (/\b(credit\s+card|card|loan)\b/i.test(String(accountName || row))) {
    return 'expense_charged';
  }
  if (
    /\b(received|recieved|salary|income|payroll|allowance|alowance|allowence)\b/i.test(
      String(row || '')
    )
  ) {
    return 'income_received';
  }
  return 'expense_paid';
}

function formatAdvisorTransactionListAmountForPrompt(amount, currency) {
  const value = String(roundMoney(amount));
  if (currency === 'USD') {
    return value + ' USD';
  }
  if (currency === 'PHP') {
    return value + ' PHP';
  }
  return value + ' pesos';
}

function buildAdvisorTransactionListPrompt(row, fields) {
  const template = normalizeAdvisorTransactionTemplate(fields.template);
  const amountText =
    fields.amount > 0
      ? formatAdvisorTransactionListAmountForPrompt(fields.amount, fields.currency)
      : '';
  const action =
    template === 'income_received'
      ? 'I received'
      : template === 'transfer'
        ? 'I transferred'
        : template === 'expense_charged'
          ? 'I charged'
          : 'I paid';
  let normalized = [fields.date, action, amountText].filter(Boolean).join(' ');
  if (fields.description) {
    normalized += ' for ' + fields.description;
  }
  if (fields.primaryAccountName) {
    normalized += (template === 'expense_charged' ? ' on ' : ' from ') + fields.primaryAccountName;
  }
  return normalized.replace(/\s+/g, ' ').trim() || row;
}

function getAdvisorNarrativeAccountPattern() {
  return "([A-Za-z0-9&.' -]{0,36}?(?:credit\\s+card|debit\\s+card|card|cash|gcash|maya|paymaya|wallet|checking|savings|fund|paypal|bank\\s+account|bank|loan))";
}

function cleanAdvisorNarrativeAccountName(value) {
  return cleanAdvisorListRowAccountName(value)
    .replace(/^(?:using|with|from|via|thru|through|to|on)\s+(?:my\s+|the\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAdvisorNarrativeAccountName(text) {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) {
    return '';
  }
  const accountPattern = getAdvisorNarrativeAccountPattern();
  const patterns = [
    new RegExp(
      '\\bpaid\\s+(?:using|with|from|via|thru|through)\\s+(?:my\\s+|the\\s+)?' +
        accountPattern +
        '\\b',
      'ig'
    ),
    new RegExp(
      '\\b(?:using|with|from|via|thru|through)\\s+(?:my\\s+|the\\s+)?' + accountPattern + '\\b',
      'ig'
    ),
    new RegExp(
      '\\b(?:charged|charge|billed)\\s+(?:to|on|thru|through)\\s+(?:my\\s+|the\\s+)?' +
        accountPattern +
        '\\b',
      'ig'
    ),
    new RegExp('\\bon\\s+(?:my\\s+|the\\s+)?' + accountPattern + '\\b', 'ig')
  ];
  for (let patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
    const pattern = patterns[patternIndex];
    let match = pattern.exec(raw);
    let last = '';
    while (match) {
      if (match[1] && advisorLooksLikeTransactionListAccountName(match[1])) {
        last = match[1];
      }
      match = pattern.exec(raw);
    }
    if (last) {
      return cleanAdvisorNarrativeAccountName(last);
    }
  }
  return '';
}

function cleanAdvisorNarrativeCounterpartyName(value) {
  const cleaned = cleanAdvisorEditValue(value)
    .replace(
      /\b(?:coffee|coffees|food|meal|meals|drink|drinks|soap|groceries|grocery|medicine|meds|item|items|stuff|things|order|purchase)\b$/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || cleanAdvisorListRowCounterpartyName(value);
}

function cleanAdvisorNarrativeDetail(value, accountName) {
  let text = cleanAdvisorEditValue(value)
    .replace(
      /^(?:and\s+then\s+)?(?:i\s+)?(?:also\s+)?(?:spent|spend|paid|pay|charged|charge|bought|buy|purchase|purchased|went|ate|eat|had|got|ordered|visited)\s*/i,
      ''
    )
    .replace(/^(?:me|myself)\s+(?:some\s+|a\s+|an\s+|the\s+)?/i, '')
    .replace(/^to\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const account = cleanAdvisorEditValue(accountName);
  if (account) {
    const escapedAccount = account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(
      new RegExp(
        '\\b(?:paid\\s+(?:using|with|from|via|thru|through)|using|with|from|via|thru|through|charged\\s+(?:to|on|thru|through)|on)\\s+(?:my\\s+|the\\s+)?' +
          escapedAccount +
          '\\b.*$',
        'i'
      ),
      ''
    );
  }
  return cleanAdvisorListRowDetailText(text)
    .replace(/\b(?:i|it|that|this)\s+(?:was\s+)?(?:paid|charged|billed)\b.*$/i, '')
    .replace(
      /\b(?:paid|using|with|from|via|thru|through|charged|on)\s+(?:my\s+|the\s+)?(?:cash|card|credit\s+card|debit\s+card|gcash|maya|wallet|bank|paypal)\b.*$/i,
      ''
    )
    .replace(/\bwas$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAdvisorNarrativePlacePurpose(text) {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const match =
    /\b(?:went|go|visited|ate|dined)\s+(?:at|to)\s+(?:the\s+)?([A-Z][A-Za-z0-9&.' -]{1,60}?)(?=\s+to\s+(?:eat|buy|get|purchase|have|order)\b|[.!?]|$)/.exec(
      raw
    );
  if (match && match[1]) {
    const purpose =
      /\bto\s+(?:eat|buy|get|purchase|have|order)\s+(?:some\s+|a\s+|an\s+|the\s+)?(.+?)(?:[.!?]|$)/i.exec(
        raw
      );
    return {
      counterpartyName: cleanAdvisorNarrativeCounterpartyName(match[1]),
      description:
        purpose && purpose[1]
          ? cleanAdvisorEditValue(purpose[1])
          : cleanAdvisorNarrativeCounterpartyName(match[1])
    };
  }
  const boughtAt =
    /\b(?:bought|buy|purchased|purchase|got|ordered)\s+(?:some\s+|a\s+|an\s+|the\s+)?(.+?)\s+(?:at|in|from)\s+(?:the\s+)?([A-Z][A-Za-z0-9&.' -]{1,60}?)(?=\s+(?:for|worth|amounting|paid|charged|using|with|on)\b|[.!?]|$)/.exec(
      raw
    );
  if (boughtAt && boughtAt[1] && boughtAt[2]) {
    return {
      counterpartyName: cleanAdvisorNarrativeCounterpartyName(boughtAt[2]),
      description: cleanAdvisorNarrativeDetail(boughtAt[1], '')
    };
  }
  const mealAt =
    /\b(?:ate|had|got|ordered|dined)\b[\s\S]{0,80}?\bat\s+(?:the\s+)?([A-Z][A-Za-z0-9&.' -]{1,60}?)(?=\s+for\b|[.!?]|\s+i\s+(?:spent|paid|was|got|charged)\b|$)/.exec(
      raw
    );
  if (mealAt && mealAt[1]) {
    const meal = /\b(lunch|dinner|breakfast|coffee|meal|food|snack|brunch)\b/i.exec(raw);
    return {
      counterpartyName: cleanAdvisorNarrativeCounterpartyName(mealAt[1]),
      description: meal && meal[1] ? cleanAdvisorEditValue(meal[1]) : 'meal'
    };
  }
  return null;
}

function extractAdvisorNarrativeAmountDetail(text, amountMention, accountName) {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!(raw && amountMention)) {
    return '';
  }
  const afterAmount = raw.slice(amountMention.end).trim();
  const worthMatch =
    /\bworth\s+of\s+(.+?)(?=\s+(?:at|in|from|paid|charged|using|with|on)\b|[.!?]|$)/i.exec(
      afterAmount
    );
  if (worthMatch && worthMatch[1]) {
    return cleanAdvisorNarrativeDetail(worthMatch[1], accountName);
  }
  const afterMatch =
    /\b(?:on|at|for|to buy|to purchase|get|got|bought|buy|buying|purchasing)\s+(?:some\s+|a\s+|an\s+|the\s+)?(.+?)(?=\.\s*(?:i|it|that|this)\s+(?:paid|was paid|charged|was charged|billed|was billed)\b|\s+(?:paid|using|with|from|via|thru|through|charged|on my|using my|with my)\b|[.!?]|$)/i.exec(
      afterAmount
    );
  if (afterMatch && afterMatch[1] && !advisorLooksLikeTransactionListAccountName(afterMatch[1])) {
    return cleanAdvisorNarrativeDetail(afterMatch[1], accountName);
  }
  const beforeAmount = raw.slice(0, amountMention.start).trim();
  const beforePlace = extractAdvisorNarrativePlacePurpose(beforeAmount);
  if (beforePlace && beforePlace.description) {
    return beforePlace.description;
  }
  const beforePurpose =
    /\b(?:bought|buy|purchased|purchase|had|got|ordered|ate|drank)\s+(?:some\s+|a\s+|an\s+|the\s+|cup\s+of\s+)?(.+?)(?:\s+worth|\s+for|$)/i.exec(
      beforeAmount
    );
  if (beforePurpose && beforePurpose[1]) {
    return cleanAdvisorNarrativeDetail(beforePurpose[1], accountName)
      .replace(/^cup\s+of\s+/i, '')
      .trim();
  }
  const beforeMatch =
    /\b(?:at|from|to)\s+(?:the\s+)?([A-Z][A-Za-z0-9&.' -]{1,60}?)(?=\s+(?:for|because|where|when|today|yesterday|i|it|was|were|paid|charged|using|with|on)\b|[.!?]|$)/.exec(
      beforeAmount
    );
  return beforeMatch && beforeMatch[1]
    ? cleanAdvisorNarrativeDetail(beforeMatch[1], accountName)
    : '';
}

function inferAdvisorNarrativeIncomeDescription(text) {
  const raw = String(text || '');
  if (/\b(allowance|alowance|allowence)\b/i.test(raw)) {
    return 'allowance';
  }
  if (/\b(salary|payroll|paycheck|wage)\b/i.test(raw)) {
    return 'salary';
  }
  if (/\b(income|payment)\b/i.test(raw)) {
    return 'income';
  }
  const family =
    /\b(?:given\s+to\s+me\s+by|sent\s+by|transferred\s+by|paid\s+by|received\s+from|from|by)\s+(?:my\s+)?(mother|mom|father|dad|parent|parents|sister|brother|aunt|uncle|cousin|wife|husband|partner|friend)\b/i.exec(
      raw
    );
  if (family && family[1]) {
    return 'income from ' + advisorTitleCaseName(family[1]);
  }
  if (/\b(received|recieved)\b/i.test(raw)) {
    return 'income';
  }
  return '';
}

function inferAdvisorNarrativeIncomeCounterpartyName(text) {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const family =
    /\b(?:given\s+to\s+me\s+by|sent\s+by|transferred\s+by|paid\s+by|received\s+from|from|by)\s+(?:my\s+)?(mother|mom|father|dad|parent|parents|sister|brother|aunt|uncle|cousin|wife|husband|partner|friend)\b/i.exec(
      raw
    );
  if (family && family[1]) {
    return advisorTitleCaseName(family[1]);
  }
  const named =
    /\b(?:given\s+to\s+me\s+by|sent\s+by|transferred\s+by|paid\s+by|received\s+from|from|by)\s+([A-Z][A-Za-z0-9&.' -]{1,60}?)(?=\s+(?:for|as|on|today|yesterday)\b|[.!?]|$)/.exec(
      raw
    );
  return named && named[1] ? cleanAdvisorEditValue(named[1]) : '';
}

function parseAdvisorNarrativeTransactionGroup(group, options = {}) {
  const sourceText = cleanAdvisorTransactionListRow(group);
  const amountMention = parseAdvisorTransactionListRowAmount(sourceText);
  if (!amountMention) {
    return null;
  }
  const accountName = extractAdvisorNarrativeAccountName(sourceText);
  const template = inferAdvisorTransactionListTemplate(sourceText, accountName);
  const placePurpose = extractAdvisorNarrativePlacePurpose(sourceText);
  const amountDetail = extractAdvisorNarrativeAmountDetail(sourceText, amountMention, accountName);
  const incomeDescription =
    template === 'income_received' ? inferAdvisorNarrativeIncomeDescription(sourceText) : '';
  const incomeCounterparty =
    template === 'income_received' ? inferAdvisorNarrativeIncomeCounterpartyName(sourceText) : '';
  const description = cleanAdvisorEditValue(
    incomeDescription ||
      (placePurpose && placePurpose.description) ||
      amountDetail ||
      cleanAdvisorListRowAmountPartDetail(sourceText, amountMention)
  );
  const counterpartyName = cleanAdvisorEditValue(
    incomeCounterparty ||
      (placePurpose && placePurpose.counterpartyName) ||
      cleanAdvisorNarrativeCounterpartyName(amountDetail || description)
  );
  const fields = normalizeAdvisorTransactionDraftFields({
    template,
    date: parseAdvisorDateFromText(sourceText, options) || String(options.fallbackDate || ''),
    description: description || counterpartyName || sourceText,
    amount: amountMention.amount,
    currency: amountMention.currency,
    primaryAccountName: accountName,
    counterpartyName,
    counterpartyKind:
      template === 'income_received' &&
      /\b(mother|mom|father|dad|parent|parents|sister|brother|aunt|uncle|cousin|wife|husband|partner|friend)\b/i.test(
        counterpartyName
      )
        ? 'family'
        : ''
  });
  return {
    sourceText,
    prompt: buildAdvisorTransactionListPrompt(sourceText, fields),
    fields
  };
}

function parseAdvisorNarrativeTransactionRows(prompt, options = {}) {
  const fallbackDate =
    parseAdvisorDateFromText(prompt, options) ||
    (options.defaultDateForUndatedRows === true ? String(options.currentDate || '') : '');
  const rowOptions = Object.assign({}, options, { fallbackDate });
  return splitAdvisorNarrativeTransactionGroups(prompt)
    .filter((group) => !advisorNarrativeTextLooksLikeAccountOpeningEvent(group))
    .map((group) => parseAdvisorNarrativeTransactionGroup(group, rowOptions))
    .filter(Boolean)
    .slice(0, ADVISOR_TRANSACTION_BATCH_LIMIT);
}

function parseAdvisorTransactionListRow(row, options = {}) {
  const cleanedRow = cleanAdvisorTransactionListRow(row);
  if (
    !cleanedRow ||
    advisorNarrativeTextLooksLikeAccountOpeningEvent(cleanedRow) ||
    !advisorLooksLikeTransactionListRow(cleanedRow)
  ) {
    return null;
  }
  const amountMention = parseAdvisorTransactionListRowAmount(cleanedRow);
  const parts = getAdvisorTransactionListRowParts(cleanedRow);
  const amountPartIndex = findAdvisorTransactionListAmountPartIndex(parts, amountMention);
  const date = parseAdvisorDateFromText(cleanedRow, options) || String(options.fallbackDate || '');
  const isUndelimitedNaturalRow = parts.length === 1 && amountMention && amountMention.start >= 0;
  const naturalBeforeAmountDetail = isUndelimitedNaturalRow
    ? cleanAdvisorListRowDetailText(cleanedRow.slice(0, amountMention.start))
    : '';
  const naturalAfterAmountText = isUndelimitedNaturalRow ? cleanedRow.slice(amountMention.end) : '';
  const naturalLeadingAccount = isUndelimitedNaturalRow
    ? extractAdvisorListRowLeadingAccountName(naturalAfterAmountText)
    : '';
  const naturalAfterAmountDetail = isUndelimitedNaturalRow
    ? cleanAdvisorListRowPostAmountDetail(naturalAfterAmountText, naturalLeadingAccount)
    : '';
  const detailParts = isUndelimitedNaturalRow
    ? [
        naturalAfterAmountDetail &&
        (!naturalBeforeAmountDetail || advisorListRowDetailLooksGeneric(naturalBeforeAmountDetail))
          ? naturalAfterAmountDetail
          : naturalBeforeAmountDetail
      ]
    : amountPartIndex >= 0
      ? parts.slice(0, amountPartIndex)
      : parts.slice();
  if (!isUndelimitedNaturalRow && amountPartIndex >= 0) {
    const amountPartDetail = cleanAdvisorListRowAmountPartDetail(
      parts[amountPartIndex],
      amountMention
    );
    if (amountPartDetail && !advisorLooksLikeTransactionListAccountName(amountPartDetail)) {
      detailParts.push(amountPartDetail);
    }
  }
  let accountParts = amountPartIndex >= 0 ? parts.slice(amountPartIndex + 1) : [];
  if (
    !accountParts.length &&
    amountPartIndex > 0 &&
    advisorLooksLikeTransactionListAccountName(parts[amountPartIndex - 1])
  ) {
    accountParts = [parts[amountPartIndex - 1]];
    detailParts.splice(amountPartIndex - 1, 1);
  }
  const dateIndex = detailParts.findIndex(
    (part) => parseAdvisorDateFromText(part, options) === date
  );
  if (dateIndex >= 0) {
    detailParts.splice(dateIndex, 1);
  }
  const detailText = cleanAdvisorListRowDetailText(detailParts.join(' '));
  const accountName =
    cleanAdvisorListRowAccountName(accountParts.join(' ')) ||
    naturalLeadingAccount ||
    (isUndelimitedNaturalRow
      ? extractAdvisorListRowAccountNameFromText(naturalAfterAmountText)
      : '') ||
    extractAdvisorListRowAccountNameFromText(cleanedRow);
  const amount = amountMention ? amountMention.amount : 0;
  const currency = amountMention && amountMention.currency ? amountMention.currency : '';
  const template = inferAdvisorTransactionListTemplate(cleanedRow, accountName);
  const inferredDescription = inferAdvisorAsPurposeDescription(cleanedRow);
  const counterpartyName =
    inferAdvisorCounterpartyNameFromPrompt({ counterparties: [] }, cleanedRow) ||
    cleanAdvisorListRowCounterpartyName(detailText);
  const hasUsefulSignal = amount > 0 || date || accountName;
  if (!hasUsefulSignal) {
    return null;
  }
  const fields = normalizeAdvisorTransactionDraftFields({
    template,
    date,
    description: inferredDescription || detailText || counterpartyName || cleanedRow,
    amount,
    currency,
    primaryAccountName: accountName,
    counterpartyName
  });
  return {
    sourceText: cleanedRow,
    prompt: buildAdvisorTransactionListPrompt(cleanedRow, fields),
    fields
  };
}

export function parseAdvisorTransactionListRows(prompt, options = {}) {
  const rows = splitAdvisorTransactionListRows(prompt);
  const fallbackDate =
    parseAdvisorDateFromText(prompt, options) ||
    (options.defaultDateForUndatedRows === true ? String(options.currentDate || '') : '');
  const rowOptions = Object.assign({}, options, {
    fallbackDate
  });
  const parsedRows = rows
    .map((row) => parseAdvisorTransactionListRow(row, rowOptions))
    .filter(Boolean);
  if (parsedRows.length > 1) {
    return parsedRows;
  }
  const narrativeRows = parseAdvisorNarrativeTransactionRows(prompt, options);
  return narrativeRows.length > 1 ? narrativeRows : [];
}

function collectAdvisorPreflightEntityMentions(items, prompt, limit, map, filter) {
  return (Array.isArray(items) ? items : [])
    .filter(
      (item) =>
        item &&
        item.isActive !== false &&
        (!filter || filter(item)) &&
        advisorPromptMentionsName(prompt, item.name)
    )
    .slice(0, Math.max(0, Math.round(Number(limit || 8) || 8)))
    .map(map);
}

function collectAdvisorPreflightPaymentWords(prompt) {
  const raw = String(prompt || '');
  const words = [];
  const pattern =
    /\b(cash|credit\s+card|debit\s+card|card|gcash|maya|paymaya|wallet|bank|checking|savings|paypal)\b/gi;
  let match = pattern.exec(raw);
  while (match) {
    const text = String(match[1] || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      text &&
      !words.some((item) => advisorTransactionTextKey(item) === advisorTransactionTextKey(text))
    ) {
      words.push(text);
    }
    match = pattern.exec(raw);
  }
  return words.slice(0, 12);
}

function collectAdvisorPreflightDateMentions(prompt, options = {}) {
  const raw = String(prompt || '');
  const mentions = [];
  const add = (text, date) => {
    const cleaned = String(text || '').trim();
    const normalizedDate = normalizeAdvisorDateKey(date) || String(date || '').trim();
    if (
      cleaned &&
      normalizedDate &&
      !mentions.some((item) => item.text === cleaned && item.date === normalizedDate)
    ) {
      mentions.push({ text: cleaned, date: normalizedDate });
    }
  };
  if (/\b(today|todya|tdy)\b/i.test(raw)) {
    add((/\b(today|todya|tdy)\b/i.exec(raw) || [])[0], String(options.currentDate || todayISO()));
  }
  if (/\byesterday\b/i.test(raw)) {
    add('yesterday', addDaysISO(String(options.currentDate || todayISO()), -1));
  }
  const parsed = parseAdvisorDateFromText(raw, options);
  if (parsed) {
    const inline =
      /\b(?:\d{4}-\d{2}-\d{2}|jan(?:uary)?\s+\d{1,2}|feb(?:ruary)?\s+\d{1,2}|mar(?:ch)?\s+\d{1,2}|apr(?:il)?\s+\d{1,2}|may\s+\d{1,2}|jun(?:e)?\s+\d{1,2}|jul(?:y)?\s+\d{1,2}|aug(?:ust)?\s+\d{1,2}|sep(?:t|tember)?\s+\d{1,2}|oct(?:ober)?\s+\d{1,2}|nov(?:ember)?\s+\d{1,2}|dec(?:ember)?\s+\d{1,2})\b/i.exec(
        raw
      );
    add(inline && inline[0] ? inline[0] : parsed, parsed);
  }
  return mentions.slice(0, 8);
}

export function buildAdvisorTransactionIntakePreflightHints(
  workbook = {},
  prompt = '',
  options = {}
) {
  const safeWorkbook = workbook || {};
  const sourceText = String(prompt || '').trim();
  const sentenceGroups = splitAdvisorNarrativeTransactionGroups(sourceText)
    .map((group, index) => ({
      index,
      text: group,
      amountMentions: extractAdvisorAmountMentions(group).map((mention) => ({
        text: mention.text,
        amount: mention.amount,
        currency: mention.currency
      })),
      date: parseAdvisorDateFromText(group, options),
      paymentWords: collectAdvisorPreflightPaymentWords(group),
      hasCorrectionCue: /\b(?:actually|sorry|rather|instead|not|no)\b/i.test(group)
    }))
    .slice(0, ADVISOR_TRANSACTION_BATCH_LIMIT);
  return {
    amountMentions: extractAdvisorAmountMentions(sourceText)
      .map((mention) => ({
        text: mention.text,
        amount: mention.amount,
        currency: mention.currency,
        start: mention.start,
        end: mention.end
      }))
      .slice(0, ADVISOR_TRANSACTION_BATCH_LIMIT * 2),
    dateMentions: collectAdvisorPreflightDateMentions(sourceText, options),
    sentenceGroups,
    paymentWords: collectAdvisorPreflightPaymentWords(sourceText),
    correctionCues: normalizeAdvisorStringArray(
      sourceText.match(/\b(?:actually|sorry|rather|instead|not|no)\b/gi) || [],
      8
    ),
    workbookVocab: {
      accounts: collectAdvisorPreflightEntityMentions(
        safeWorkbook.accounts,
        sourceText,
        12,
        (account) => ({
          id: account.id,
          name: account.name,
          group: account.group,
          subtype: account.subtype || ''
        }),
        (account) =>
          advisorCanUseAccountForDraft(account) && ['asset', 'liability'].includes(account.group)
      ),
      categories: collectAdvisorPreflightEntityMentions(
        safeWorkbook.categories,
        sourceText,
        12,
        (category) => ({
          id: category.id,
          name: category.name,
          type: category.type
        }),
        (category) => ['expense', 'income', 'debt'].includes(category.type)
      ),
      counterparties: collectAdvisorPreflightEntityMentions(
        safeWorkbook.counterparties,
        sourceText,
        12,
        (counterparty) => ({
          id: counterparty.id,
          name: counterparty.name,
          kind: counterparty.kind || 'other'
        }),
        null
      )
    }
  };
}

export function promptStartsNewAdvisorTransactionDrafts(prompt, options = {}) {
  const text = String(prompt || '');
  const key = advisorTransactionTextKey(text);
  if (!key) {
    return false;
  }
  if (advisorPromptRequestsCategoryReview(text)) {
    return false;
  }
  if (parseAdvisorTransactionListRows(text, options).length > 1) {
    return true;
  }
  const addCommand =
    /\b(?:also\s+)?(?:add|record|log|post|create|enter|book|save|put)\s+(?:(?:these|thse|this|the|my|some|\d+)\s*)?(?:transactions?|expenses?|payments?|purchases?|charges?|entries?)\b/.test(
      key
    );
  const pluralCommand =
    /\b(?:also\s+)?(?:add|record|log|post|create|enter|book|save|put)\b[\s\S]{0,80}\b(?:transactions|expenses|payments|purchases|charges|entries)\b/.test(
      key
    );
  return addCommand || pluralCommand;
}

export function advisorPromptReferencesAttachedImage(prompt) {
  return /\b(?:images?|imgs?|photos?|pictures?|pics?|receipts?|screenshots?|attachments?|attached|attach|uploaded|uploads?)\b/i.test(
    String(prompt || '')
  );
}

export function advisorPromptExplicitlyIgnoresAttachedImage(prompt) {
  return /\b(?:ignore|skip|exclude|without|do\s+not\s+use|don't\s+use|dont\s+use)\b[\s\S]{0,60}\b(?:images?|imgs?|photos?|pictures?|pics?|receipts?|screenshots?|attachments?|attached|uploaded|uploads?)\b/i.test(
    String(prompt || '')
  );
}

function advisorPromptUsesImagesAsSupportingEvidence(prompt) {
  return (
    /\b(?:with|using|use|attached|attach(?:ed)?|included)\b[\s\S]{0,40}\b(?:receipts?|images?|imgs?|photos?|pictures?|pics?|screenshots?|attachments?)\b[\s\S]{0,60}\b(?:support|supporting|proof|evidence|reference|attached)\b/i.test(
      String(prompt || '')
    ) ||
    /\b(?:with\s+)?(?:receipts?|images?|imgs?|photos?|pictures?|pics?|screenshots?|attachments?)\s+attached\b/i.test(
      String(prompt || '')
    )
  );
}

function getAdvisorRequestedTransactionCount(prompt) {
  const raw = String(prompt || '');
  const match =
    /\b(?:add|record|log|post|create|enter|book|save|put)\s+(?:these|this|the|my|some\s+)?([0-9]{1,2})\s+(?:transactions?|expenses?|payments?|purchases?|charges?|entries?)\b/i.exec(
      raw
    ) ||
    /\b([0-9]{1,2})\s+(?:transactions?|expenses?|payments?|purchases?|charges?|entries?)\b/i.exec(
      raw
    );
  return match && match[1] ? Math.max(0, Math.round(Number(match[1]) || 0)) : 0;
}

function getAdvisorPromptImageItemCount(prompt) {
  const match =
    /\b([0-9]{1,2})\s+(?:images?|imgs?|photos?|pictures?|pics?|receipts?|screenshots?|attachments?|uploads?)\b/i.exec(
      String(prompt || '')
    );
  return match && match[1] ? Math.max(0, Math.round(Number(match[1]) || 0)) : 0;
}

export function shouldUseAdvisorMixedTransactionImageIntake(prompt, rows = [], imageCount = 0) {
  const parsedRows = Array.isArray(rows) ? rows : [];
  const attachmentCount = Math.max(0, Math.round(Number(imageCount || 0) || 0));
  if (
    !parsedRows.length ||
    !attachmentCount ||
    advisorPromptExplicitlyIgnoresAttachedImage(prompt)
  ) {
    return false;
  }
  if (getAdvisorPromptImageItemCount(prompt) > 0) {
    return true;
  }
  if (
    /\ball\s+(?:of\s+)?these\s+(?:transactions?|expenses?|payments?|purchases?|charges?|entries?)\b/i.test(
      String(prompt || '')
    ) &&
    !advisorPromptUsesImagesAsSupportingEvidence(prompt)
  ) {
    return true;
  }
  const requestedCount = getAdvisorRequestedTransactionCount(prompt);
  if (requestedCount > parsedRows.length) {
    return true;
  }
  return (
    advisorPromptReferencesAttachedImage(prompt) &&
    /\b(?:text|typed|manual|listed|rows?)\b/i.test(String(prompt || ''))
  );
}

export function shouldPreferTextTransactionIntakeWithImages(prompt, rows = [], imageCount = 0) {
  const parsedRows = Array.isArray(rows) ? rows : [];
  const attachmentCount = Math.max(0, Math.round(Number(imageCount || 0) || 0));
  if (!parsedRows.length) {
    return false;
  }
  if (!attachmentCount || advisorPromptExplicitlyIgnoresAttachedImage(prompt)) {
    return true;
  }
  if (shouldUseAdvisorMixedTransactionImageIntake(prompt, parsedRows, attachmentCount)) {
    return false;
  }
  return true;
}

function advisorPromptRequestsCategoryReview(prompt) {
  const text = String(prompt || '').toLowerCase();
  if (!text) {
    return false;
  }
  const asksForReview =
    /\b(review|recommend|recommendation|suggest|suggestion|suggestions|improve|improvements|audit|analyze|analyse|check|look at|tell me|what categories|which categories|should i add|should we add|categories i should add|categories to add)\b/.test(
      text
    );
  const mentionsCategorization =
    /\b(categorizing|categorize|categorized|category|categories|label|labels|counterparty|counterparties|merchant|merchants|payee|payees|ledger)\b/.test(
      text
    );
  const mentionsLedgerScope =
    /\b(transaction|transactions|spending|spend|expense|expenses|purchase|purchases|charge|charges|payment|payments|merchant|merchants|ledger)\b/.test(
      text
    );
  const directlyCreatesCategory =
    /\b(?:add|create|make|new)\s+(?:a\s+|an\s+|the\s+)?(?:category|categories)\s*(?:called|named|for|as|with name)?\b/.test(
      text
    );
  const directlyMutatesCategory =
    /\b(rename|delete|archive|deactivate|merge|recategorize|reclassify|change|edit|update)\b/.test(
      text
    );
  return !!(
    asksForReview &&
    mentionsCategorization &&
    mentionsLedgerScope &&
    !directlyCreatesCategory &&
    !directlyMutatesCategory
  );
}

export function looksLikeAdvisorTransactionPrompt(prompt) {
  const text = String(prompt || '').toLowerCase();
  if (!text || /\badd\s+up\b/.test(text)) {
    return false;
  }
  if (advisorPromptRequestsCategoryReview(text)) {
    return false;
  }
  const hasCommandVerb =
    /\b(add|record|log|post|create|enter|book|save|put|transfer|transferred|move|moved|send|sent)\b/.test(
      text
    );
  const hasTransactionNoun =
    /\b(transaction|transactions|expense|expenses|income|transfer|transfers|payment|payments|purchase|purchases|bill|bills|charge|charges|entry|entries)\b/.test(
      text
    );
  const hasActivitySignal =
    /\b(paid|charged|spent|received|salary|opening balance|bought|groceries|grocery|gcash|cash|card|wallet|pesos?|php|transferred|transfer|moved|move|sent|send|gave|give|handed)\b|\u20b1|\$/.test(
      text
    );
  const hasAmount = parseAdvisorAmountFromText(text) > 0;
  const asksToAddTransactions =
    /\b(can|could|please|help|need|want|wanna|would like)\b[\s\S]{0,80}\b(add|record|log|post|create|enter|book|save)\b[\s\S]{0,80}\b(transaction|transactions|expense|expenses|payment|payments|purchase|purchases|entry|entries)\b/.test(
      text
    );
  return (
    asksToAddTransactions ||
    (hasCommandVerb && (hasTransactionNoun || hasAmount || hasActivitySignal)) ||
    (hasAmount &&
      hasActivitySignal &&
      /\b(paid|charged|spent|received|bought|transfer|transferred|move|moved|send|sent|gave|give|handed|salary)\b/.test(
        text
      ))
  );
}

export function inferAdvisorTransactionTemplateFromText(text, pendingTemplate = '') {
  const raw = String(text || '').toLowerCase();
  const semanticDecision = classifyAdvisorFinanceIntent(raw);
  if (semanticDecision.template === 'debt_payment') {
    return 'debt_payment';
  }
  if (semanticDecision.template === 'expense_charged') {
    return 'expense_charged';
  }
  if (/\b(transfer|transferred|move|moved)\b/.test(raw)) {
    return 'transfer';
  }
  if (
    /\b(send|sent)\b/.test(raw) &&
    /\b(to|into)\s+(?:my\s+)?(gcash|cash|wallet|checking|savings|fund|account|card|bank|maya)\b/.test(
      raw
    )
  ) {
    return 'transfer';
  }
  if (
    /\b(gave|give|handed)\b/.test(raw) &&
    /\b(cash|gcash|wallet|bank|account|fund|savings|checking|maya)\b/.test(raw)
  ) {
    return 'transfer';
  }
  if (/\b(opening balance|initial balance)\b/.test(raw)) {
    return 'opening_balance';
  }
  if (
    /\b(card payment|credit card payment|loan payment|debt payment|pay.*card|paid.*card|pay.*loan)\b/.test(
      raw
    )
  ) {
    return 'debt_payment';
  }
  if (
    /\b(charge|charged)\s+to\s+(my\s+)?(gcash|cash|wallet|debit|checking|savings)\b/.test(raw) ||
    (/\bpaid\b/.test(raw) && /\b(gcash|cash|wallet|debit|checking|savings)\b/.test(raw))
  ) {
    return 'expense_paid';
  }
  if (/\b(charged|charge to|credit card charge|on my card)\b/.test(raw)) {
    return 'expense_charged';
  }
  if (/\b(received|salary|income|paid by|from employer)\b/.test(raw)) {
    return 'income_received';
  }
  if (/\b(paid|spent|buy|used|bought|purchase|prepaid|load|expense|bill)\b/.test(raw)) {
    return 'expense_paid';
  }
  return normalizeAdvisorTransactionTemplate(pendingTemplate) || '';
}

export function advisorPromptMentionsName(prompt, name) {
  const key = advisorTransactionTextKey(name);
  if (!key) {
    return false;
  }
  return (' ' + advisorTransactionTextKey(prompt) + ' ').indexOf(' ' + key + ' ') >= 0;
}

export function advisorPromptImpliesAssetPayment(prompt) {
  const raw = String(prompt || '').toLowerCase();
  return (
    /\b(charge|charged)\s+to\s+(my\s+)?(gcash|cash|wallet|debit|checking|savings)\b/.test(raw) ||
    (/\bpaid\b/.test(raw) && /\b(gcash|cash|wallet|debit|checking|savings)\b/.test(raw))
  );
}

export function advisorPromptImpliesLiabilityCharge(prompt) {
  const raw = String(prompt || '').toLowerCase();
  return (
    /\b(charged|charge|billed)\b[\s\S]{0,30}\b(credit card|card|loan)\b/.test(raw) ||
    /\b(credit card|card)\b[\s\S]{0,30}\b(charge|charged|billed)\b/.test(raw) ||
    /\bon\s+(my\s+)?(credit card|card)\b/.test(raw)
  );
}

export function advisorPromptImpliesLiabilityAccount(prompt) {
  return (
    advisorPromptImpliesLiabilityCharge(prompt) || advisorPromptImpliesLiabilityPayment(prompt)
  );
}

export function inferAdvisorCategoryNameFromPrompt(workbook, prompt, template) {
  const allowedTypes = getAdvisorTransactionTemplateConfig(template).categoryTypes || [];
  const allowed = (category) =>
    category.isActive !== false && (!allowedTypes.length || allowedTypes.includes(category.type));
  const text = advisorTransactionTextKey(prompt);
  const categoryHints = [
    { name: 'Allowance', types: ['income'], pattern: /\b(allowance|alowance|allowence)\b/ },
    {
      name: 'Shopping',
      types: ['expense'],
      pattern:
        /\b(laptop|computer|electronics|gadget|device|appliance|mall|department store|soap|shoes?|clothes?|clothing|bag|bags|hermes|airpods?|shopee|lazada|shopping)\b/
    },
    {
      name: 'Food',
      types: ['expense'],
      pattern:
        /\b(food|meal|meals|coffee|restaurant|cafe|lunch|dinner|breakfast|starbucks|uncle moe'?s|harlan|holden|wolfgang)\b/
    },
    {
      name: 'Phone Load',
      types: ['expense'],
      pattern: /\b(load|prepaid|airtime|mobile data|data plan|phone plan)\b/
    },
    {
      name: 'Transport',
      types: ['expense'],
      pattern: /\b(lalamove|grab|taxi|bus|train|jeep|fare|fuel|gas|parking|toll|transport)\b/
    },
    {
      name: 'Groceries',
      types: ['expense'],
      pattern: /\b(grocery|groceries|supermarket|market|foodland)\b/
    },
    {
      name: 'Subscriptions',
      types: ['expense'],
      pattern:
        /\b(subscription|netflix|spotify|youtube|icloud|google one|prime|hbo|disney|chatgpt|openai|vercel)\b/
    },
    {
      name: 'Utilities',
      types: ['expense'],
      pattern:
        /\b(utility|utilities|electric|electricity|water|internet|meralco|pldt|globe|smart)\b/
    },
    { name: 'Salary', types: ['income'], pattern: /\b(salary|payroll|paycheck|wage)\b/ },
    { name: 'Freelance', types: ['income'], pattern: /\b(freelance|client|invoice)\b/ },
    {
      name: 'Credit Card Payment',
      types: ['debt'],
      pattern:
        /\b(card payment|credit card payment|credit card bill|card bill|loan payment|debt payment|statement balance|minimum due|pay.*card|paid.*card|pay.*loan)\b/
    }
  ];
  for (let hintIndex = 0; hintIndex < categoryHints.length; hintIndex += 1) {
    const hint = categoryHints[hintIndex];
    const hintAllowed =
      !allowedTypes.length || (hint.types || []).some((type) => allowedTypes.includes(type));
    if (!hintAllowed || !hint.pattern.test(text)) {
      continue;
    }
    const found = (workbook.categories || []).find(
      (category) =>
        allowed(category) &&
        advisorTransactionTextKey(category.name) === advisorTransactionTextKey(hint.name)
    );
    if (found) {
      return found.name;
    }
    return hint.name;
  }
  const familyRelation = /\b(brother|sister|mom|mother|dad|father|parent|family)\b/.exec(text);
  if (familyRelation) {
    const relationKey =
      familyRelation[1] === 'dad'
        ? 'father'
        : familyRelation[1] === 'mom'
          ? 'mother'
          : familyRelation[1];
    const familyCategory = (workbook.categories || []).find((category) => {
      const key = advisorTransactionTextKey(category.name);
      return (
        allowed(category) &&
        (key === 'family support' ||
          key === 'family income' ||
          key === 'income from ' + relationKey ||
          key === relationKey + ' support' ||
          key === 'for others' ||
          key === 'others' ||
          key === 'family')
      );
    });
    if (familyCategory) {
      return familyCategory.name;
    }
    if (allowedTypes.indexOf('income') >= 0) {
      return 'Family Support';
    }
  }
  return '';
}

export function cleanAdvisorEditValue(value) {
  return String(value || '')
    .replace(/^[\"'\u201c\u201d\u2018\u2019]+|[\"'\u201c\u201d\u2018\u2019]+$/g, '')
    .replace(/\b(?:please|thanks|thank you)\b\.?$/i, '')
    .replace(/[,.!?;:]+$/g, '')
    .trim()
    .slice(0, 80);
}

function inferAdvisorAmountFirstDescription(raw) {
  const amountMention = parseAdvisorTransactionListRowAmount(raw);
  if (!amountMention) {
    return '';
  }
  const parts = getAdvisorTransactionListRowParts(raw);
  const amountPartIndex = findAdvisorTransactionListAmountPartIndex(parts, amountMention);
  if (amountPartIndex >= 0) {
    const detail = cleanAdvisorListRowAmountPartDetail(parts[amountPartIndex], amountMention);
    if (detail && !advisorLooksLikeTransactionListAccountName(detail)) {
      return detail;
    }
  }
  return '';
}

export function inferAdvisorDescriptionFromPrompt(prompt) {
  const raw = String(prompt || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) {
    return '';
  }
  let match = /\bdescription\s+(?:to|as|=)\s+(.+?)(?:[.!?]|$)/i.exec(raw);
  if (match && match[1]) {
    return cleanAdvisorEditValue(match[1]);
  }
  match =
    /\b(?:used|use)\s+(?:the\s+)?(?:\u20b1|\$|PHP|USD|php|p)?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*(?:pesos?|php|usd)?\s+to\s+(?:buy|purchase|get)\s+(.+?)(?:[.!?]|$)/i.exec(
      raw
    );
  if (match && match[1]) {
    return cleanAdvisorEditValue(match[1]);
  }
  match =
    /\b(?:buy|bought|purchase|purchased|get|got)\s+(?:a\s+|an\s+|the\s+)?(.+?)(?:\s+(?:for|from|using|with|on|today|yesterday)\b|[.!?]|$)/i.exec(
      raw
    );
  if (match && match[1]) {
    return cleanAdvisorEditValue(match[1]);
  }
  match =
    /\bfor\s+(?![0-9]+(?:\s*(?:pesos?|php|usd)\b)?)(.+?)(?:\s+(?:from|using|with|on|today|yesterday)\b|[.!?]|$)/i.exec(
      raw
    );
  if (match && match[1]) {
    return cleanAdvisorEditValue(match[1]);
  }
  const asPurposeDescription = inferAdvisorAsPurposeDescription(raw);
  if (asPurposeDescription) {
    return asPurposeDescription;
  }
  const amountFirstDescription = inferAdvisorAmountFirstDescription(raw);
  if (amountFirstDescription) {
    return amountFirstDescription;
  }
  const parsedRow = parseAdvisorTransactionListRow(raw);
  if (parsedRow && parsedRow.fields && parsedRow.fields.description) {
    const description = cleanAdvisorEditValue(parsedRow.fields.description);
    if (description && advisorTransactionTextKey(description) !== advisorTransactionTextKey(raw)) {
      return description;
    }
  }
  const commaParts = raw
    .split(',')
    .map((part) => cleanAdvisorEditValue(part))
    .filter(Boolean);
  for (let index = commaParts.length - 1; index >= 0; index -= 1) {
    const part = commaParts[index];
    if (
      !part ||
      /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec|today|yesterday|date|amount|php|pesos?|gcash|cash|wallet|card|credit|from|to|using|with)\b|\u20b1|\$/i.test(
        part
      ) ||
      /^(?:\u20b1|\$|p)?\s*[0-9,.]+$/i.test(part)
    ) {
      continue;
    }
    return part.slice(0, 80);
  }
  return '';
}

function advisorDescriptionLooksLikeRawTransactionText(value, fields = {}) {
  const raw = cleanAdvisorEditValue(value);
  if (!raw) {
    return false;
  }
  if (extractAdvisorAmountMentions(raw).length > 0) {
    return true;
  }
  if (advisorLooksLikeDelimitedTransactionRow(raw)) {
    const fieldAccount = cleanAdvisorEditValue(
      fields.primaryAccountName || fields.secondaryAccountName
    );
    return (
      !fieldAccount ||
      advisorTransactionTextKey(raw).includes(advisorTransactionTextKey(fieldAccount))
    );
  }
  return false;
}

function normalizeAdvisorTransactionDescriptionForDisplay(value, prompt, fields = {}) {
  const raw = cleanAdvisorEditValue(value);
  const promptDescription = inferAdvisorDescriptionFromPrompt(prompt);
  const rowDescription =
    raw && advisorDescriptionLooksLikeRawTransactionText(raw, fields)
      ? inferAdvisorDescriptionFromPrompt(raw)
      : '';
  const candidates = [rowDescription, promptDescription, raw]
    .map((candidate) =>
      cleanAdvisorEditValue(candidate)
        .replace(/\bwas\s*[,.;:]*$/i, '')
        .trim()
    )
    .filter(Boolean);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!advisorDescriptionLooksLikeRawTransactionText(candidate, fields)) {
      return candidate;
    }
  }
  return candidates[0] || raw;
}

function getActiveCounterparties(workbook) {
  return (workbook && workbook.counterparties ? workbook.counterparties : []).filter(
    (counterparty) => counterparty.isActive !== false
  );
}

function advisorTitleCaseName(value) {
  return String(value || '')
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .trim();
}

function advisorAccountNameMatch(workbook, rawName) {
  return advisorFindEntityByName(
    (workbook && workbook.accounts) || [],
    rawName,
    (account) => account.isActive !== false
  );
}

function advisorLooksLikeAccountName(workbook, rawName) {
  const match = advisorAccountNameMatch(workbook, rawName);
  return !!(match.item || match.ambiguous);
}

function cleanAdvisorAccountPhrase(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:my|the|a|an)\s+/i, '')
    .replace(
      /\b(?:and|then|also)\s+(?:i\s+)?(?:transferred|transfer|moved|move|sent|send|gave|give|handed)\b.*$/i,
      ''
    )
    .replace(/\b(?:for|because|where|when|today|yesterday|on)\b.*$/i, '')
    .replace(/[,.!?;:]+$/g, '')
    .trim()
    .slice(0, 80);
}

function resolveAdvisorTransferAccountName(workbook, rawName) {
  const cleaned = cleanAdvisorAccountPhrase(rawName);
  if (!cleaned) {
    return '';
  }
  const match = advisorFindEntityByName(
    (workbook && workbook.accounts) || [],
    cleaned,
    (account) =>
      advisorCanUseAccountForDraft(account) && ['asset', 'liability'].includes(account.group)
  );
  if (match.item) {
    return match.item.name;
  }
  return match.ambiguous ? '' : cleaned;
}

function firstAdvisorRegexCapture(text, patterns) {
  for (let index = 0; index < patterns.length; index += 1) {
    const match = patterns[index].exec(text);
    if (match && match[1]) {
      return match[1];
    }
  }
  return '';
}

export function inferAdvisorTransferAccountNamesFromPrompt(workbook, prompt) {
  const text = String(prompt || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    return {
      primaryAccountName: '',
      secondaryAccountName: ''
    };
  }
  const sourceName = firstAdvisorRegexCapture(text, [
    /\b(?:from|using|with|out of)\s+(?:my\s+)?([^,.;]+?)(?=\s+(?:to|into)\s+(?:my\s+)?|[,.!?]|$)/i,
    /\b(?:of)\s+(?:my\s+)?([^,.;]+?)(?=\s+(?:to|into)\s+(?:my\s+)?|[,.!?]|$)/i,
    /\b[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*(?:pesos?|php|usd)?\s+(?:of\s+)?(?:my\s+)?([^,.;]+?)(?=\s+(?:to|into)\s+(?:my\s+)?)/i
  ]);
  const destinationName = firstAdvisorRegexCapture(text, [
    /\b(?:to|into)\s+(?:my\s+)?([^,.;]+?)(?=\s+(?:and|then|also)\s+(?:i\s+)?(?:transferred|transfer|moved|move|sent|send|gave|give|handed)\b|[,.!?]|$)/i,
    /\b(?:to|into)\s+(?:my\s+)?([^,.;]+?)(?=\s+\b(?:for|because|where|when|today|yesterday|on)\b|$)/i
  ]);
  return {
    primaryAccountName: resolveAdvisorTransferAccountName(workbook, sourceName),
    secondaryAccountName: resolveAdvisorTransferAccountName(workbook, destinationName)
  };
}

function advisorPromptHasExplicitTotalCue(text) {
  return /\b(total|combined|altogether|all together|overall|in total|sum of|summed|one transaction|single transaction)\b/i.test(
    String(text || '')
  );
}

function advisorPromptRequestsLiabilityAmountReference(prompt) {
  const text = advisorTransactionTextKey(prompt);
  if (!text) {
    return false;
  }
  return (
    /\b(match|matches|matching|cover|covers|equal|equals|equivalent|same as|set aside|reserve)\b[\s\S]{0,56}\b(liability|liabilities|debt|debts|credit card|card balance|card liability)\b/.test(
      text
    ) ||
    /\b(liability|liabilities|debt|debts|credit card|card balance|card liability)\b[\s\S]{0,56}\b(match|matches|matching|cover|covers|equal|equals|equivalent|same amount|amount)\b/.test(
      text
    )
  );
}

function getAdvisorActiveLiabilityBalanceRows(workbook, options = {}) {
  const asOfDate =
    normalizeAdvisorDateKey(options.currentDate || options.asOfDate || options.as_of_date) || '';
  const balances = getLedgerHistoricalBalancesAsOf(workbook || {}, asOfDate);
  return (workbook && workbook.accounts ? workbook.accounts : [])
    .filter(
      (account) =>
        account &&
        account.isActive !== false &&
        account.isSystem !== true &&
        account.group === 'liability'
    )
    .map((account) => ({
      account,
      balance: roundMoney(Math.max(0, Number(balances[account.id] || 0) || 0))
    }))
    .filter((row) => row.balance > 0);
}

function getAdvisorReferencedLiabilityAmount(workbook, prompt, options = {}) {
  if (!advisorPromptRequestsLiabilityAmountReference(prompt)) {
    return null;
  }
  const rows = getAdvisorActiveLiabilityBalanceRows(workbook, options);
  if (!rows.length) {
    return null;
  }
  const mentioned = advisorFindEntityMention(
    rows.map((row) => row.account),
    prompt,
    null
  );
  if (mentioned) {
    const row = rows.find((item) => item.account.id === mentioned.id);
    return row && row.balance > 0
      ? {
          amount: row.balance,
          account: row.account,
          sourceRefs: ['account:' + row.account.id]
        }
      : null;
  }
  const text = advisorTransactionTextKey(prompt);
  if (/\b(credit card|card liability|card balance|card)\b/.test(text)) {
    const cardRows = rows.filter((row) =>
      /\b(card|credit)\b/.test(
        advisorTransactionTextKey([row.account.name, row.account.subtype].join(' '))
      )
    );
    if (cardRows.length === 1) {
      return {
        amount: cardRows[0].balance,
        account: cardRows[0].account,
        sourceRefs: ['account:' + cardRows[0].account.id]
      };
    }
  }
  if (rows.length === 1 || /\b(liabilities|debts)\b/.test(text)) {
    const amount = roundMoney(rows.reduce((sum, row) => sum + row.balance, 0));
    return amount > 0
      ? {
          amount,
          account: rows.length === 1 ? rows[0].account : null,
          sourceRefs: rows.map((row) => 'account:' + row.account.id)
        }
      : null;
  }
  return null;
}

function buildAdvisorReferencedAmountTransferResult(workbook, prompt, options = {}) {
  const reference = getAdvisorReferencedLiabilityAmount(workbook, prompt, options);
  if (!(reference && reference.amount > 0)) {
    return null;
  }
  const accounts = inferAdvisorTransferAccountNamesFromPrompt(workbook, prompt);
  if (!(accounts.primaryAccountName || accounts.secondaryAccountName)) {
    return null;
  }
  const destination = accounts.secondaryAccountName || 'destination account';
  const liabilityName =
    reference.account && reference.account.name ? reference.account.name : 'liabilities';
  const note = 'Amount resolved from current ' + liabilityName + ' balance for review.';
  return {
    prompt: String(prompt || '').trim(),
    sourceText: String(prompt || '').trim(),
    route: 'new_transaction_batch',
    usePendingDraft: false,
    interpreter: 'rules',
    evidenceSource: 'account_balance_reference',
    intent: {
      template: 'transfer',
      confidence: 0.82,
      reason:
        'Rules-based transfer draft using the current liability balance as the requested amount reference.',
      allowUnsupportedAmount: true,
      evidenceSource: 'account_balance_reference',
      sourceRefs: reference.sourceRefs,
      fields: {
        template: 'transfer',
        date: parseAdvisorDateFromText(prompt, options),
        description: 'Transfer to ' + destination,
        amount: reference.amount,
        currency: (workbook && workbook.currency) || 'PHP',
        categoryId: '',
        categoryName: '',
        primaryAccountId: '',
        primaryAccountName: accounts.primaryAccountName,
        secondaryAccountId: '',
        secondaryAccountName: accounts.secondaryAccountName,
        counterpartyId: '',
        counterpartyName: '',
        counterpartyKind: 'other',
        note
      },
      missing_fields: [],
      amountResolution: {
        kind: 'liability_balance',
        amount: reference.amount,
        accountId: (reference.account && reference.account.id) || '',
        accountName: (reference.account && reference.account.name) || '',
        sourceRefs: reference.sourceRefs
      }
    }
  };
}

function getAdvisorTransferAmountSegment(raw, mention, nextMention) {
  const before = String(raw || '').slice(Math.max(0, mention.start - 96), mention.start);
  const verbRegex =
    /\b(?:i\s+)?(?:also\s+)?(?:transferred|transfer|moved|move|sent|send|gave|give|handed)\b/gi;
  let verbMatch = null;
  let nextVerbMatch = verbRegex.exec(before);
  while (nextVerbMatch) {
    verbMatch = nextVerbMatch;
    nextVerbMatch = verbRegex.exec(before);
  }
  if (!verbMatch) {
    return '';
  }
  const after = String(raw || '')
    .slice(mention.start, nextMention ? nextMention.start : undefined)
    .replace(
      /\s+(?:and|plus|then)\s*(?:i\s+)?(?:also\s+)?(?:transferred|transfer|moved|move|sent|send|gave|give|handed)\s*$/i,
      ''
    )
    .replace(/[,.!?;:]+$/g, '')
    .trim();
  return ((verbMatch && verbMatch[0] ? verbMatch[0] : 'I transferred') + ' ' + after)
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildAdvisorExplicitTransferIntentResults(workbook, prompt, options = {}) {
  const raw = String(prompt || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw || !/\b(transferred|transfer|moved|move|sent|send|gave|give|handed)\b/i.test(raw)) {
    return [];
  }
  const mentions = extractAdvisorAmountMentions(raw).slice(0, ADVISOR_TRANSACTION_BATCH_LIMIT);
  if (!mentions.length) {
    const referencedAmountResult = buildAdvisorReferencedAmountTransferResult(
      workbook,
      raw,
      options
    );
    return referencedAmountResult ? [referencedAmountResult] : [];
  }
  if (!mentions.length || (mentions.length > 1 && advisorPromptHasExplicitTotalCue(raw))) {
    return [];
  }
  const sharedAccounts = inferAdvisorTransferAccountNamesFromPrompt(workbook, raw);
  return mentions
    .map((mention, index) => {
      const segment = getAdvisorTransferAmountSegment(raw, mention, mentions[index + 1]);
      if (!segment) {
        return null;
      }
      const segmentAccounts = inferAdvisorTransferAccountNamesFromPrompt(workbook, segment);
      const primaryAccountName =
        segmentAccounts.primaryAccountName || sharedAccounts.primaryAccountName;
      const secondaryAccountName =
        segmentAccounts.secondaryAccountName || sharedAccounts.secondaryAccountName;
      if (!(primaryAccountName || secondaryAccountName)) {
        return null;
      }
      const currency = /\busd\b|\$/i.test(segment)
        ? 'USD'
        : /\bphp\b|\u20b1/i.test(segment)
          ? 'PHP'
          : '';
      const date =
        parseAdvisorDateFromText(segment, options) ||
        parseAdvisorDateFromText(raw, options) ||
        (options.defaultDateForUndatedRows === true ? String(options.currentDate || '') : '');
      const description = secondaryAccountName ? 'Transfer to ' + secondaryAccountName : 'Transfer';
      return {
        prompt: segment,
        intent: {
          template: 'transfer',
          confidence: 0.72,
          reason: 'Rules-based transfer draft from explicit amount and account text.',
          fields: {
            template: 'transfer',
            date,
            description,
            amount: mention.amount,
            currency,
            categoryId: '',
            categoryName: '',
            primaryAccountId: '',
            primaryAccountName,
            secondaryAccountId: '',
            secondaryAccountName,
            counterpartyId: '',
            counterpartyName: '',
            counterpartyKind: 'other',
            note: ''
          },
          missing_fields: []
        }
      };
    })
    .filter(Boolean);
}

export function advisorTransactionIntentResultHasRulesSignal(result, pendingAction = null) {
  if (pendingAction) {
    return true;
  }
  const intent = (result && result.intent) || {};
  const fields = normalizeAdvisorTransactionDraftFields(intent.fields || {});
  return !!(
    normalizeAdvisorTransactionTemplate(intent.template || fields.template) ||
    fields.date ||
    fields.amount > 0 ||
    fields.categoryName ||
    fields.primaryAccountName ||
    fields.secondaryAccountName ||
    fields.counterpartyName ||
    parseAdvisorAmountFromText(result && result.prompt)
  );
}

export function shouldUseAdvisorRulesTransactionIntentResults(
  workbook,
  results,
  prompt = '',
  pendingAction = null,
  options = {}
) {
  const items = (Array.isArray(results) ? results : []).filter((result) => result && result.intent);
  if (
    !items.length ||
    !items.every((result) => advisorTransactionIntentResultHasRulesSignal(result, pendingAction))
  ) {
    return false;
  }
  return items.some((result) => {
    const validation = validateAdvisorTransactionIntent(
      workbook,
      result.intent,
      result.prompt || prompt,
      pendingAction,
      options
    );
    const fields = validation && validation.fields ? validation.fields : {};
    return !!(
      validation.ok ||
      (validation.invalidReasons || []).length ||
      validation.template ||
      fields.amount > 0 ||
      fields.categoryName ||
      fields.primaryAccountName ||
      fields.secondaryAccountName ||
      fields.counterpartyName
    );
  });
}

export function inferAdvisorCounterpartyNameFromPrompt(workbook, prompt) {
  const text = advisorTransactionTextKey(prompt);
  const mentioned = advisorFindEntityMention(getActiveCounterparties(workbook), prompt, null);
  if (mentioned) {
    return mentioned.name;
  }
  const hints = [
    { name: 'OpenAI', pattern: /\b(openai|chatgpt)\b/ },
    { name: 'Lalamove', pattern: /\blalamove\b/ },
    { name: 'Netflix', pattern: /\bnetflix\b/ },
    { name: 'Spotify', pattern: /\bspotify\b/ },
    { name: 'YouTube', pattern: /\byoutube\b/ },
    { name: 'iCloud', pattern: /\bicloud\b/ },
    { name: 'Vercel', pattern: /\bvercel\b/ }
  ];
  for (let hintIndex = 0; hintIndex < hints.length; hintIndex += 1) {
    if (hints[hintIndex].pattern.test(text)) {
      const existing = advisorFindEntityByName(
        getActiveCounterparties(workbook),
        hints[hintIndex].name,
        null
      );
      return existing.item ? existing.item.name : hints[hintIndex].name;
    }
  }
  const raw = String(prompt || '')
    .replace(/\s+/g, ' ')
    .trim();
  const familyMatch =
    /\b(?:from|by|paid by|sent by|transferred by|received from|to)\s+(?:my\s+)?(sister|brother|mother|mom|father|dad|parent|aunt|uncle|cousin|wife|husband|partner|friend)\b/i.exec(
      raw
    ) ||
    /\bmy\s+(sister|brother|mother|mom|father|dad|parent|aunt|uncle|cousin|wife|husband|partner|friend)\b/i.exec(
      raw
    );
  if (familyMatch && familyMatch[1]) {
    return advisorTitleCaseName(familyMatch[1]);
  }
  const merchantMatch =
    /\b(?:at|from|to|for|with)\s+(?:my\s+)?([A-Z][A-Za-z0-9&.' -]{1,40}?)(?=\s+(?:as|for|from|to|using|with|charged|paid|on|in|today|yesterday|\d|k\b|m\b|php|pesos?|pese|PHP|USD|p|\u20b1|\$)|[,.!?]|$)/.exec(
      raw
    );
  if (merchantMatch && merchantMatch[1]) {
    const name = merchantMatch[1]
      .replace(/\b(my|the|a|an)\b/gi, '')
      .replace(/[-\u2013\u2014|]\s*$/g, '')
      .trim();
    if (
      name &&
      !/\b(brother|sister|mom|mother|dad|father|credit card|card|gcash|cash|wallet)\b/i.test(name)
    ) {
      return name.slice(0, 48);
    }
  }
  return '';
}

export function advisorFindEntityByName(items, rawName, allowedFilter) {
  const name = advisorTransactionTextKey(rawName);
  const source = (items || []).filter((item) => !allowedFilter || allowedFilter(item));
  if (!name) {
    return { item: null, ambiguous: false };
  }
  const exact = source.filter(
    (item) =>
      advisorTransactionTextKey(item.name) === name || advisorTransactionTextKey(item.id) === name
  );
  if (exact.length === 1) {
    return { item: exact[0], ambiguous: false };
  }
  const contains = source.filter((item) => {
    const key = advisorTransactionTextKey(item.name);
    return key && (name.indexOf(key) >= 0 || key.indexOf(name) >= 0);
  });
  if (contains.length === 1) {
    return { item: contains[0], ambiguous: false };
  }
  return {
    item: null,
    ambiguous: exact.length > 1 || contains.length > 1
  };
}

export function advisorFindEntityMention(items, prompt, allowedFilter) {
  const text = ' ' + advisorTransactionTextKey(prompt) + ' ';
  const matches = (items || []).filter((item) => {
    const key = advisorTransactionTextKey(item.name);
    return key && text.indexOf(' ' + key + ' ') >= 0 && (!allowedFilter || allowedFilter(item));
  });
  if (matches.length === 1) {
    return matches[0];
  }
  return null;
}

function getCategoryById(workbook, categoryId) {
  return workbook && workbook.categories
    ? workbook.categories.find((category) => category.id === categoryId) || null
    : null;
}

function getAccountById(workbook, accountId) {
  return workbook && workbook.accounts
    ? workbook.accounts.find((account) => account.id === accountId) || null
    : null;
}

function getCounterpartyById(workbook, counterpartyId) {
  return workbook && workbook.counterparties
    ? workbook.counterparties.find((counterparty) => counterparty.id === counterpartyId) || null
    : null;
}

function getAdvisorResultIntent(result) {
  if (result && result.intent && typeof result.intent === 'object') {
    return result.intent;
  }
  return result && typeof result === 'object' ? result : {};
}

function getAdvisorResultPrompt(result, fallbackPrompt) {
  const intent = getAdvisorResultIntent(result);
  return String(
    (result && result.prompt) ||
      intent.sourceText ||
      intent.source_text ||
      intent.prompt ||
      fallbackPrompt ||
      ''
  ).trim();
}

function advisorRelayMentionsPerson(text) {
  return /\b(sister|brother|mother|mom|father|dad|parent|aunt|uncle|cousin|wife|husband|partner|friend)\b/i.test(
    String(text || '')
  );
}

function inferAdvisorRelayBridgeName(text) {
  const match =
    /\b(?:my\s+)?(sister|brother|mother|mom|father|dad|parent|aunt|uncle|cousin|wife|husband|partner|friend)\b/i.exec(
      String(text || '')
    );
  return match && match[1] ? advisorTitleCaseName(match[1]) : '';
}

function advisorRelayHasOutgoingVerb(text) {
  return /\b(sent|send|gave|give|handed|transferred|transfer|moved|move)\b/i.test(
    String(text || '')
  );
}

function advisorRelayHasIncomingVerb(text, template) {
  return (
    template === 'income_received' ||
    /\b(received|bank transferred|bank transfer|transferred|transfer|sent back|deposited|deposit)\b/i.test(
      String(text || '')
    )
  );
}

function advisorRelayAmount(fields, prompt) {
  return fields.amount > 0 ? fields.amount : parseAdvisorAmountFromText(prompt);
}

function resolveAdvisorRelayAccountFromText(workbook, fields, prompt, role, template) {
  const groups = ['asset', 'liability'];
  if (role === 'source') {
    const primary = resolveAdvisorAccount(
      workbook,
      fields.primaryAccountId,
      fields.primaryAccountName,
      prompt,
      groups
    );
    return primary.item;
  }
  if (role === 'fieldDestination') {
    const secondary = resolveAdvisorAccount(
      workbook,
      fields.secondaryAccountId,
      fields.secondaryAccountName,
      '',
      groups
    );
    return secondary.item;
  }
  if (template === 'income_received') {
    const primary = resolveAdvisorAccount(
      workbook,
      fields.primaryAccountId,
      fields.primaryAccountName,
      prompt,
      ['asset']
    );
    if (primary.item) {
      return primary.item;
    }
  }
  const secondary = resolveAdvisorAccount(
    workbook,
    fields.secondaryAccountId,
    fields.secondaryAccountName,
    prompt,
    groups
  );
  if (secondary.item) {
    return secondary.item;
  }
  const mentioned = resolveAdvisorAccount(workbook, '', '', prompt, groups);
  return mentioned.item;
}

function getAdvisorRelayOutgoingCandidate(workbook, result, index, fullPrompt) {
  const intent = getAdvisorResultIntent(result);
  const fields = normalizeAdvisorTransactionDraftFields(intent.fields);
  const template = normalizeAdvisorTransactionTemplate(intent.template || fields.template);
  const prompt = getAdvisorResultPrompt(result, fullPrompt);
  const text = [prompt, fields.description, fields.note].filter(Boolean).join(' ');
  const amount = advisorRelayAmount(fields, text);
  const sourceAccount = resolveAdvisorRelayAccountFromText(
    workbook,
    fields,
    text,
    'source',
    template
  );
  const fieldDestination = resolveAdvisorRelayAccountFromText(
    workbook,
    fields,
    text,
    'fieldDestination',
    template
  );
  const externalPerson = advisorRelayMentionsPerson(text) || advisorRelayMentionsPerson(fullPrompt);
  if (!(
    amount > 0 &&
    sourceAccount &&
    !fieldDestination &&
    externalPerson &&
    (template === 'transfer' || advisorRelayHasOutgoingVerb(text))
  )) {
    return null;
  }
  return {
    index,
    result,
    intent,
    fields,
    prompt,
    amount,
    sourceAccount
  };
}

function getAdvisorRelayIncomingCandidate(workbook, result, index, fullPrompt) {
  const intent = getAdvisorResultIntent(result);
  const fields = normalizeAdvisorTransactionDraftFields(intent.fields);
  const template = normalizeAdvisorTransactionTemplate(intent.template || fields.template);
  const prompt = getAdvisorResultPrompt(result, fullPrompt);
  const text = [prompt, fields.description, fields.note].filter(Boolean).join(' ');
  const amount = advisorRelayAmount(fields, text);
  const destinationAccount = resolveAdvisorRelayAccountFromText(
    workbook,
    fields,
    text,
    'destination',
    template
  );
  if (!(amount > 0 && destinationAccount && advisorRelayHasIncomingVerb(text, template))) {
    return null;
  }
  return {
    index,
    result,
    intent,
    fields,
    prompt,
    amount,
    destinationAccount
  };
}

function buildAdvisorRelayTransferResult(outgoing, incoming, fullPrompt) {
  const bridgeName =
    inferAdvisorRelayBridgeName(outgoing.prompt) ||
    inferAdvisorRelayBridgeName(fullPrompt) ||
    'intermediary';
  const destinationName = incoming.destinationAccount.name;
  const sourceFields = outgoing.fields;
  const noteParts = [
    sourceFields.note,
    'Netted from person-mediated transfer via ' + bridgeName + '.'
  ].filter(Boolean);
  return Object.assign({}, outgoing.result || {}, {
    prompt: outgoing.prompt || fullPrompt,
    intent: Object.assign({}, outgoing.intent || {}, {
      template: 'transfer',
      reason:
        'Matched an equal incoming transfer through ' +
        bridgeName +
        '; netted as an internal transfer.',
      fields: Object.assign({}, sourceFields, {
        template: 'transfer',
        date: sourceFields.date || incoming.fields.date,
        description: 'Transfer to ' + destinationName + ' via ' + bridgeName,
        amount: outgoing.amount,
        currency: sourceFields.currency || incoming.fields.currency,
        categoryId: '',
        categoryName: '',
        primaryAccountId: outgoing.sourceAccount.id,
        primaryAccountName: outgoing.sourceAccount.name,
        secondaryAccountId: incoming.destinationAccount.id,
        secondaryAccountName: destinationName,
        counterpartyId: '',
        counterpartyName: '',
        counterpartyKind: 'other',
        note: noteParts.join(' ')
      }),
      missing_fields: []
    })
  });
}

export function normalizeAdvisorRelayTransactionIntentResults(workbook, results, prompt = '') {
  const items = Array.isArray(results) ? results : [];
  const hasPersonReference =
    advisorRelayMentionsPerson(prompt) ||
    items.some((item) => advisorRelayMentionsPerson(getAdvisorResultPrompt(item, '')));
  if (items.length < 2 || !hasPersonReference) {
    return items;
  }
  const outgoingCandidates = items
    .map((item, index) => getAdvisorRelayOutgoingCandidate(workbook || {}, item, index, prompt))
    .filter(Boolean);
  if (!outgoingCandidates.length) {
    return items;
  }
  const incomingCandidates = items
    .map((item, index) => getAdvisorRelayIncomingCandidate(workbook || {}, item, index, prompt))
    .filter(Boolean);
  for (let incomingIndex = 0; incomingIndex < incomingCandidates.length; incomingIndex += 1) {
    const incoming = incomingCandidates[incomingIndex];
    const priorOutgoing = outgoingCandidates.filter(
      (candidate) => candidate.index < incoming.index
    );
    const relayOutgoing = priorOutgoing.length ? priorOutgoing : outgoingCandidates;
    const outgoingTotal = roundMoney(
      relayOutgoing.reduce((sum, candidate) => sum + candidate.amount, 0)
    );
    if (outgoingTotal !== roundMoney(incoming.amount)) {
      continue;
    }
    const outgoingIndexes = relayOutgoing.reduce((indexMap, candidate) => {
      indexMap[candidate.index] = true;
      return indexMap;
    }, {});
    return items.reduce((normalized, item, index) => {
      if (index === incoming.index) {
        return normalized;
      }
      if (outgoingIndexes[index]) {
        const outgoing = relayOutgoing.find((candidate) => candidate.index === index);
        normalized.push(buildAdvisorRelayTransferResult(outgoing, incoming, prompt));
        return normalized;
      }
      normalized.push(item);
      return normalized;
    }, []);
  }
  return items;
}

export function resolveAdvisorCategory(workbook, fields, prompt, template) {
  const allowedTypes = getAdvisorTransactionTemplateConfig(template).categoryTypes || [];
  const allowedFilter = (category) =>
    category.isActive !== false && (!allowedTypes.length || allowedTypes.includes(category.type));
  const inferredCategoryName = inferAdvisorCategoryNameFromPrompt(workbook, prompt, template);
  const fieldCategoryName =
    fields.categoryName ||
    (fields.categoryId && getCategoryById(workbook, fields.categoryId)
      ? getCategoryById(workbook, fields.categoryId).name
      : '');
  if (
    inferredCategoryName &&
    (!fieldCategoryName || !advisorPromptMentionsName(prompt, fieldCategoryName))
  ) {
    const inferred = advisorFindEntityByName(
      workbook.categories || [],
      inferredCategoryName,
      allowedFilter
    );
    if (inferred.item || inferred.ambiguous) {
      return inferred;
    }
  }
  const byId = fields.categoryId ? getCategoryById(workbook, fields.categoryId) : null;
  if (byId && allowedFilter(byId)) {
    return {
      item: byId,
      ambiguous: false
    };
  }
  const named = advisorFindEntityByName(
    workbook.categories || [],
    fields.categoryName,
    allowedFilter
  );
  if (named.item || named.ambiguous) {
    return named;
  }
  const mentioned = advisorFindEntityMention(workbook.categories || [], prompt, allowedFilter);
  return {
    item: mentioned,
    ambiguous: false
  };
}

export function resolveAdvisorAccount(workbook, id, name, prompt, groups, options = {}) {
  const allowed = (account) =>
    advisorCanUseAccountForDraft(account, options) &&
    (!groups.length || groups.includes(account.group));
  const byId = id ? getAccountById(workbook, id) : null;
  if (byId && allowed(byId)) {
    return {
      item: byId,
      ambiguous: false
    };
  }
  if (byId && !allowed(byId)) {
    return {
      item: null,
      ambiguous: false
    };
  }
  const namedAny = advisorFindEntityByName(
    workbook.accounts || [],
    name,
    (account) => account.isActive !== false && (!groups.length || groups.includes(account.group))
  );
  if (namedAny.item && !allowed(namedAny.item)) {
    return {
      item: null,
      ambiguous: false
    };
  }
  const named = advisorFindEntityByName(workbook.accounts || [], name, allowed);
  if (named.item || named.ambiguous) {
    return named;
  }
  const mentioned = advisorFindEntityMention(workbook.accounts || [], prompt, allowed);
  if (mentioned) {
    return {
      item: mentioned,
      ambiguous: false
    };
  }
  if (groups.includes('liability') && advisorPromptImpliesLiabilityAccount(prompt)) {
    const liabilityMatches = (workbook.accounts || []).filter((account) => {
      const key = advisorTransactionTextKey([account.name, account.subtype].join(' '));
      return (
        allowed(account) && account.group === 'liability' && /\b(card|credit|loan)\b/.test(key)
      );
    });
    if (liabilityMatches.length === 1) {
      return {
        item: liabilityMatches[0],
        ambiguous: false
      };
    }
    if (liabilityMatches.length > 1) {
      return {
        item: null,
        ambiguous: true
      };
    }
  }
  return {
    item: null,
    ambiguous: false
  };
}

export function resolveAdvisorAnyAccount(workbook, id, name, prompt) {
  return resolveAdvisorAccount(workbook, id, name, prompt, ['asset', 'liability']);
}

export function coerceAdvisorTransactionTemplate(
  workbook,
  requestedTemplate,
  fields,
  prompt,
  pendingTemplate
) {
  const requested = normalizeAdvisorTransactionTemplate(requestedTemplate);
  const inferred = inferAdvisorTransactionTemplateFromText(prompt, pendingTemplate);
  const semanticDecision = classifyAdvisorFinanceIntent(prompt);
  if (
    semanticDecision.template === 'debt_payment' &&
    (!requested ||
      ['expense_paid', 'expense_charged', 'debt_payment', 'liability_payment'].includes(
        requested
      ) ||
      inferred === 'debt_payment')
  ) {
    return 'debt_payment';
  }
  if (
    semanticDecision.template === 'expense_charged' &&
    (!requested || ['expense_paid', 'expense_charged'].includes(requested))
  ) {
    return 'expense_charged';
  }
  const accountResult =
    requested === 'expense_paid' ||
    requested === 'expense_charged' ||
    inferred === 'expense_paid' ||
    inferred === 'expense_charged'
      ? resolveAdvisorAnyAccount(
          workbook,
          fields.primaryAccountId,
          fields.primaryAccountName,
          prompt
        )
      : { item: null };
  if (
    (requested === 'expense_paid' || inferred === 'expense_paid') &&
    accountResult.item &&
    accountResult.item.group === 'asset'
  ) {
    return 'expense_paid';
  }
  if (
    (requested === 'expense_charged' || inferred === 'expense_charged') &&
    accountResult.item &&
    accountResult.item.group === 'liability'
  ) {
    return 'expense_charged';
  }
  if (
    (requested === 'expense_paid' || inferred === 'expense_paid') &&
    accountResult.item &&
    accountResult.item.group === 'liability' &&
    !advisorPromptImpliesAssetPayment(prompt)
  ) {
    return 'expense_charged';
  }
  if (requested === 'expense_charged' && inferred === 'expense_paid') {
    return 'expense_paid';
  }
  if (
    requested === 'expense_paid' &&
    inferred === 'expense_charged' &&
    !advisorPromptImpliesAssetPayment(prompt)
  ) {
    return 'expense_charged';
  }
  if (requested === 'expense_charged') {
    if (accountResult.item && accountResult.item.group === 'asset') {
      return 'expense_paid';
    }
    if (advisorPromptImpliesAssetPayment(prompt)) {
      return 'expense_paid';
    }
  }
  return requested || inferred || normalizeAdvisorTransactionTemplate(pendingTemplate) || '';
}

export function resolveAdvisorCounterparty(workbook, fields, prompt) {
  const inferredName = inferAdvisorCounterpartyNameFromPrompt(workbook, prompt);
  const fieldCounterpartyName =
    fields.counterpartyName ||
    (fields.counterpartyId && getCounterpartyById(workbook, fields.counterpartyId)
      ? getCounterpartyById(workbook, fields.counterpartyId).name
      : '');
  if (
    inferredName &&
    (!fieldCounterpartyName || !advisorPromptMentionsName(prompt, fieldCounterpartyName))
  ) {
    if (advisorLooksLikeAccountName(workbook, inferredName)) {
      return null;
    }
    const inferred = advisorFindEntityByName(getActiveCounterparties(workbook), inferredName, null);
    return (
      inferred.item || {
        id: '',
        name: inferredName,
        kind: /\b(sister|brother|mother|mom|father|dad|parent|aunt|uncle|cousin|wife|husband|partner|friend)\b/i.test(
          inferredName
        )
          ? 'family'
          : 'merchant',
        isActive: true
      }
    );
  }
  const byId = fields.counterpartyId ? getCounterpartyById(workbook, fields.counterpartyId) : null;
  if (byId && byId.isActive !== false) {
    return byId;
  }
  if (advisorLooksLikeAccountName(workbook, fields.counterpartyName)) {
    return null;
  }
  const named = advisorFindEntityByName(
    getActiveCounterparties(workbook),
    fields.counterpartyName,
    null
  );
  if (named.item) {
    return named.item;
  }
  return advisorFindEntityMention(getActiveCounterparties(workbook), prompt, null);
}

export function mergeAdvisorTransactionFields(base, incoming) {
  const merged = Object.assign(
    {},
    normalizeAdvisorTransactionDraftFields(base),
    normalizeAdvisorTransactionDraftFields(incoming)
  );
  Object.keys(merged).forEach((key) => {
    if (merged[key] === '' || merged[key] === 0) {
      const previous = normalizeAdvisorTransactionDraftFields(base)[key];
      if (previous) {
        merged[key] = previous;
      }
    }
  });
  return merged;
}

function getUsdToBaseRate(workbook) {
  return Number(workbook && workbook.settings && workbook.settings.usdToBaseRate) || 0;
}

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch (_error) {
    return Object.assign({}, value || {});
  }
}

function missingFieldsMessage(validation) {
  return (
    (validation.invalidReasons || []).join(' ') ||
    'Missing required fields: ' +
      (validation.missingFields || [])
        .map((field) => advisorTransactionFieldLabel(field, validation.template))
        .join(', ')
  );
}

function advisorDraftAllowsUnsupportedAmount(proposed) {
  return !!(
    proposed &&
    (proposed.manualEdit === true ||
      proposed.allowUnsupportedAmount === true ||
      proposed.evidenceSource === 'image')
  );
}

function normalizeAdvisorMissingTransactionFieldName(value) {
  const key = advisorTransactionTextKey(value);
  if (!key) {
    return '';
  }
  if (key === 'template' || key === 'type' || key === 'transaction type') {
    return 'template';
  }
  if (key === 'date' || key === 'when') {
    return 'date';
  }
  if (key === 'amount' || key === 'price' || key === 'total' || key === 'cost') {
    return 'amount';
  }
  if (/\bcategory\b/.test(key)) {
    return 'categoryId';
  }
  if (/\b(secondary|destination|to account|paid to|second account)\b/.test(key)) {
    return 'secondaryAccountId';
  }
  if (
    /\b(account|primary|payment account|paid from|charged to|source account|card|cash)\b/.test(key)
  ) {
    return 'primaryAccountId';
  }
  if (/\b(merchant|payee|payer|counterparty|vendor|store)\b/.test(key)) {
    return 'counterpartyName';
  }
  if (/\b(description|purpose|item|memo|note)\b/.test(key)) {
    return 'description';
  }
  return String(value || '').trim();
}

function advisorValidationMissingFieldStillOpen(field, context) {
  const fields = (context && context.fields) || {};
  const config = (context && context.config) || null;
  if (field === 'template') {
    return !context.template;
  }
  if (field === 'date') {
    return !fields.date || !parseISODate(fields.date);
  }
  if (field === 'amount') {
    return !(fields.amount > 0);
  }
  if (field === 'categoryId') {
    return !!(config && config.usesCategory && !(context.category && context.category.id));
  }
  if (field === 'primaryAccountId') {
    return !!(
      config &&
      config.primaryGroups.length &&
      !(context.primaryAccount && context.primaryAccount.id)
    );
  }
  if (field === 'secondaryAccountId') {
    return !!(
      config &&
      config.secondaryGroups.length &&
      !(context.secondaryAccount && context.secondaryAccount.id)
    );
  }
  if (field === 'counterpartyName') {
    return false;
  }
  if (field === 'description') {
    return false;
  }
  return true;
}

export function getAiDraftTransactionPrompt(draft) {
  const source = draft && draft.source && typeof draft.source === 'object' ? draft.source : {};
  return String(source.prompt || source.userPrompt || '').trim();
}

export function validateAdvisorTransactionIntent(
  workbook,
  intent,
  prompt = '',
  pendingAction = null,
  options = {}
) {
  const sourceWorkbook = workbook || {};
  const pendingFields = pendingAction && pendingAction.fields ? pendingAction.fields : {};
  const rawFields = mergeAdvisorTransactionFields(
    pendingFields,
    intent && intent.fields ? intent.fields : {}
  );
  const template = coerceAdvisorTransactionTemplate(
    sourceWorkbook,
    normalizeAdvisorTransactionTemplate(intent && intent.template) || rawFields.template,
    rawFields,
    prompt,
    pendingAction && pendingAction.template
  );
  const semanticDecision = classifyAdvisorFinanceIntent(prompt, options);
  const parsedPromptAmount = parseAdvisorAmountFromText(prompt);
  const hasPromptText = !!String(prompt || '').trim();
  const amountCameFromPendingDraft =
    pendingFields.amount > 0 && roundMoney(pendingFields.amount) === roundMoney(rawFields.amount);
  const allowUnsupportedAmount = !!(intent && intent.allowUnsupportedAmount);
  const sourceMissingFields = normalizeAdvisorStringArray(
    intent && (intent.missingFields || intent.missing_fields),
    12
  )
    .map(normalizeAdvisorMissingTransactionFieldName)
    .filter(Boolean);
  const sourceMarkedAmountMissing =
    sourceMissingFields.includes('amount') && !(rawFields.amount > 0);
  const fieldEvidenceValidation = validateAdvisorTransactionFieldEvidence(intent || {}, prompt, {
    allowUnsupportedAmount,
    sourceText: prompt
  });
  const promptAmountMentions = extractAdvisorAmountMentions(prompt);
  const canUsePromptAmountFallback =
    !advisorFieldEvidenceHasAnyValue(fieldEvidenceValidation.fieldEvidence) ||
    promptAmountMentions.length <= 1;
  const rawAmountSupported =
    !hasPromptText ||
    allowUnsupportedAmount ||
    amountCameFromPendingDraft ||
    fieldEvidenceValidation.supportedFields.includes('amount') ||
    (canUsePromptAmountFallback && advisorPromptSupportsAmount(prompt, rawFields.amount));
  const resolvedAmount = sourceMarkedAmountMissing
    ? 0
    : rawFields.amount > 0 && rawAmountSupported
      ? rawFields.amount
      : canUsePromptAmountFallback
        ? parsedPromptAmount
        : 0;
  const parsedDate =
    normalizeAdvisorDateKey(rawFields.date) ||
    parseAdvisorDateFromText(rawFields.date || prompt, options);
  const fallbackDate =
    normalizeAdvisorDateKey(options.currentDate) ||
    (options.currentDate ? String(options.currentDate) : todayISO());
  const dateDefaulted = !parsedDate && options.defaultDateForUndated === true;
  const fields = Object.assign({}, rawFields, {
    template,
    currency: rawFields.currency || sourceWorkbook.currency,
    date: parsedDate || (dateDefaulted ? fallbackDate : ''),
    amount: resolvedAmount
  });
  const missing = [];
  const invalid = [];
  const config = template ? getAdvisorTransactionTemplateConfig(template) : null;
  if (!template) {
    missing.push('template');
  }
  if (!fields.date || !parseISODate(fields.date)) {
    missing.push('date');
  }
  if (!(fields.amount > 0)) {
    missing.push('amount');
  }
  if (rawFields.amount > 0 && hasPromptText && !rawAmountSupported && !missing.includes('amount')) {
    missing.push('amount');
  }
  if (
    fields.currency === 'USD' &&
    sourceWorkbook.currency === 'PHP' &&
    !getUsdToBaseRate(sourceWorkbook)
  ) {
    invalid.push('Set a USD to PHP rate before posting USD transactions.');
  }
  invalid.push(...fieldEvidenceValidation.invalidReasons);

  let category = null;
  let primaryAccount = null;
  let secondaryAccount = null;
  if (config && config.usesCategory) {
    const categoryInferenceText = [prompt, fields.description, fields.counterpartyName]
      .filter(Boolean)
      .join(' ');
    const inferredCategoryName = inferAdvisorCategoryNameFromPrompt(
      sourceWorkbook,
      categoryInferenceText,
      template
    );
    if (
      inferredCategoryName &&
      (!fields.categoryName ||
        !advisorPromptMentionsName(categoryInferenceText, fields.categoryName))
    ) {
      fields.categoryId = '';
      fields.categoryName = inferredCategoryName;
    }
    const categoryResult = resolveAdvisorCategory(sourceWorkbook, fields, prompt, template);
    category = categoryResult.item;
    if (categoryResult.ambiguous || !category) {
      missing.push('categoryId');
    }
  }
  const accountOptions = {
    allowSystemAccounts: options.allowSystemAccounts === true
  };
  if (config && config.primaryGroups.length) {
    const primaryResult = resolveAdvisorAccount(
      sourceWorkbook,
      fields.primaryAccountId,
      fields.primaryAccountName,
      prompt,
      config.primaryGroups,
      accountOptions
    );
    primaryAccount = primaryResult.item;
    if (primaryResult.ambiguous || !primaryAccount) {
      missing.push('primaryAccountId');
    }
  }
  if (config && config.secondaryGroups.length) {
    const secondaryResult = resolveAdvisorAccount(
      sourceWorkbook,
      fields.secondaryAccountId,
      fields.secondaryAccountName,
      prompt,
      config.secondaryGroups,
      accountOptions
    );
    secondaryAccount = secondaryResult.item;
    if (secondaryResult.ambiguous || !secondaryAccount) {
      missing.push('secondaryAccountId');
    }
  }
  if (
    template === 'transfer' &&
    primaryAccount &&
    secondaryAccount &&
    primaryAccount.id === secondaryAccount.id
  ) {
    missing.push('secondaryAccountId');
  }

  const counterparty =
    config && config.usesCounterparty
      ? resolveAdvisorCounterparty(sourceWorkbook, fields, prompt)
      : null;
  const normalizedFallbackCounterpartyName = cleanAdvisorEditValue(fields.counterpartyName)
    .replace(/\bwas\s*[,.;:]*$/i, '')
    .trim();
  const fallbackCounterpartyName = advisorLooksLikeAccountName(
    sourceWorkbook,
    normalizedFallbackCounterpartyName
  )
    ? ''
    : normalizedFallbackCounterpartyName;
  const cleanedFields = Object.assign({}, fields, {
    description: normalizeAdvisorTransactionDescriptionForDisplay(
      fields.description,
      prompt,
      fields
    ),
    categoryId: category ? category.id : '',
    categoryName: category ? category.name : fields.categoryName,
    primaryAccountId: primaryAccount ? primaryAccount.id : '',
    primaryAccountName: primaryAccount ? primaryAccount.name : fields.primaryAccountName,
    secondaryAccountId: secondaryAccount ? secondaryAccount.id : '',
    secondaryAccountName: secondaryAccount ? secondaryAccount.name : fields.secondaryAccountName,
    counterpartyId: counterparty ? counterparty.id : '',
    counterpartyName: counterparty ? counterparty.name : fallbackCounterpartyName,
    counterpartyKind:
      fields.counterpartyKind || (template === 'income_received' ? 'client' : 'merchant')
  });
  sourceMissingFields.forEach((field) => {
    if (
      !missing.includes(field) &&
      advisorValidationMissingFieldStillOpen(field, {
        template,
        fields: cleanedFields,
        config,
        category,
        primaryAccount,
        secondaryAccount
      })
    ) {
      missing.push(field);
    }
  });
  const uniqueMissing = missing.filter(
    (field, index, list) => field && list.indexOf(field) === index
  );
  return {
    ok: uniqueMissing.length === 0 && invalid.length === 0,
    template,
    fields: cleanedFields,
    missingFields: uniqueMissing,
    invalidReasons: invalid,
    confidence: Math.max(
      0,
      Math.min(1, Number(intent && intent.confidence ? intent.confidence : 0.55) || 0.55)
    ),
    reason: String(intent && intent.reason ? intent.reason : '').trim(),
    semanticDecision,
    dateDefaulted,
    allowUnsupportedAmount,
    fieldEvidence: fieldEvidenceValidation.fieldEvidence,
    evidenceWarnings: fieldEvidenceValidation.warnings,
    evidenceSource: String((intent && intent.evidenceSource) || '').trim(),
    sourceRefs: normalizeAdvisorStringArray(
      (intent && intent.sourceRefs) || (intent && intent.source_refs),
      8
    )
  };
}

export function buildValidatedAdvisorTransactionDraft(
  workbook,
  draft,
  options = {},
  services = {}
) {
  const proposed =
    draft && draft.proposed && typeof draft.proposed === 'object' ? draft.proposed : {};
  if (draft && draft.operation === 'delete') {
    const targetId = String(draft.targetId || proposed.transactionId || proposed.id || '').trim();
    const transaction =
      (workbook && workbook.transactions ? workbook.transactions : []).find(
        (item) => item.id === targetId
      ) || null;
    if (!transaction) {
      throw new Error('Transaction not found.');
    }
    return {
      ok: true,
      template: transaction.template || '',
      fields: {},
      missingFields: [],
      invalidReasons: [],
      confidence: Math.max(
        0,
        Math.min(1, Number(draft && draft.confidence ? draft.confidence : 0.7) || 0.7)
      ),
      reason: String(draft && draft.reason ? draft.reason : 'Delete transaction draft.').trim()
    };
  }
  const fields = normalizeAdvisorTransactionDraftFields(proposed.fields);
  const template = normalizeAdvisorTransactionTemplate(proposed.template || fields.template);
  const prompt = getAiDraftTransactionPrompt(draft);
  let validation = validateAdvisorTransactionIntent(
    workbook,
    {
      template,
      fields,
      confidence: draft && draft.confidence,
      reason: draft && draft.reason,
      allowUnsupportedAmount: advisorDraftAllowsUnsupportedAmount(proposed),
      fieldEvidence: proposed.fieldEvidence || proposed.field_evidence,
      missingFields: proposed.missingFields || proposed.missing_fields
    },
    prompt,
    null,
    options
  );
  if (
    !validation.ok &&
    String(proposed.createCategoryName || fields.categoryName || '').trim() &&
    validation.missingFields.includes('categoryId') &&
    typeof services.ensureAdvisorDraftCategory === 'function'
  ) {
    const simulatedWorkbook = clonePlain(workbook);
    services.ensureAdvisorDraftCategory(
      simulatedWorkbook,
      proposed.createCategoryName || fields.categoryName,
      template || validation.template
    );
    validation = validateAdvisorTransactionIntent(
      simulatedWorkbook,
      {
        template: template || validation.template,
        fields,
        confidence: draft && draft.confidence,
        reason: draft && draft.reason,
        allowUnsupportedAmount: advisorDraftAllowsUnsupportedAmount(proposed),
        fieldEvidence: proposed.fieldEvidence || proposed.field_evidence,
        missingFields: proposed.missingFields || proposed.missing_fields
      },
      prompt,
      null,
      options
    );
  }
  if (!validation.ok && !options.allowNeedsFix) {
    throw new Error(missingFieldsMessage(validation));
  }
  return validation;
}

export function applyTransactionAiDraftMutation(workbook, draft, services = {}, options = {}) {
  const proposed = (draft && draft.proposed) || {};
  const draftReference = getAdvisorDraftReference(draft && draft.id);
  const findByReference =
    typeof services.findTransactionByReference === 'function'
      ? services.findTransactionByReference
      : findTransactionByReference;
  const existingAdvisorTransaction = findByReference(workbook, draftReference);
  if (
    existingAdvisorTransaction &&
    !(draft && (draft.operation === 'edit' || draft.operation === 'delete'))
  ) {
    return existingAdvisorTransaction.id;
  }
  const findById =
    typeof services.findTransactionById === 'function'
      ? services.findTransactionById
      : (sourceWorkbook, transactionId) =>
          (sourceWorkbook && sourceWorkbook.transactions ? sourceWorkbook.transactions : []).find(
            (transaction) => transaction.id === transactionId
          ) || null;
  if (draft && draft.operation === 'delete') {
    const targetId = String(draft.targetId || proposed.transactionId || proposed.id || '').trim();
    const target = findById(workbook, targetId);
    if (!target) {
      throw new Error('Transaction not found.');
    }
    workbook.transactions = (workbook.transactions || []).filter(
      (transaction) => transaction.id !== target.id
    );
    return target.id;
  }
  if (
    draft &&
    draft.operation === 'edit' &&
    proposed.recurringItemId &&
    Array.isArray(proposed.transactionIds)
  ) {
    const recurringItem =
      (workbook.recurringItems || []).find((item) => item.id === proposed.recurringItemId) || null;
    if (!recurringItem) {
      throw new Error('Recurring item not found.');
    }
    proposed.transactionIds.forEach((transactionId) => {
      const transaction = findById(workbook, transactionId);
      if (!transaction) {
        throw new Error('Transaction not found: ' + transactionId);
      }
      transaction.recurringItemId = recurringItem.id;
    });
    return proposed.transactionIds.join(',');
  }
  if (draft && draft.operation === 'edit' && draft.targetId) {
    const target = findById(workbook, draft.targetId);
    if (!target) {
      throw new Error('Transaction not found.');
    }
    if (typeof services.buildLedgerTransactionFromDraftFields !== 'function') {
      throw new Error('Transaction edit service is not available.');
    }
    const targetIndex = (workbook.transactions || []).findIndex(
      (transaction) => transaction.id === target.id
    );
    const edited = services.buildLedgerTransactionFromDraftFields(
      workbook,
      proposed.fields || {},
      target,
      targetIndex,
      {
        source: target.source || 'advisor',
        reference: target.reference || draftReference
      }
    );
    if (!(edited && edited.id === target.id)) {
      throw new Error('Transaction edit did not preserve the target transaction id.');
    }
    workbook.transactions[targetIndex] = edited;
    return edited.id;
  }
  const template = normalizeAdvisorTransactionTemplate(
    proposed.template || (proposed.fields && proposed.fields.template)
  );
  const fields = normalizeAdvisorTransactionDraftFields(proposed.fields);
  if (
    !fields.categoryId &&
    String(proposed.createCategoryName || fields.categoryName || '').trim() &&
    typeof services.ensureAdvisorDraftCategory === 'function'
  ) {
    const categoryResult = services.ensureAdvisorDraftCategory(
      workbook,
      proposed.createCategoryName || fields.categoryName,
      template
    );
    if (categoryResult && categoryResult.category) {
      fields.categoryId = categoryResult.category.id;
      fields.categoryName = categoryResult.category.name;
    }
  }
  const validation = validateAdvisorTransactionIntent(
    workbook,
    {
      template,
      fields,
      confidence: draft && draft.confidence,
      reason: draft && draft.reason,
      allowUnsupportedAmount: advisorDraftAllowsUnsupportedAmount(proposed),
      fieldEvidence: proposed.fieldEvidence || proposed.field_evidence,
      missingFields: proposed.missingFields || proposed.missing_fields
    },
    getAiDraftTransactionPrompt(draft),
    null,
    options
  );
  if (!validation.ok) {
    throw new Error(missingFieldsMessage(validation));
  }
  if (typeof services.createLedgerTransactionFromValidation !== 'function') {
    throw new Error('Transaction posting service is not available.');
  }
  return services.createLedgerTransactionFromValidation(workbook, validation, {
    reference: draftReference
  });
}
