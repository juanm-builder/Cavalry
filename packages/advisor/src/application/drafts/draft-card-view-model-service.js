import {
  normalizeAdvisorTransactionDraftFields,
  normalizeAdvisorTransactionTemplate
} from '../../domain/advisor/transaction-drafts.js';
import {
  getMeaningfulLedgerCleanupPayload,
  normalizeLedgerReviewPayload
} from '../../domain/advisor/ledger-drafts.js';
import {
  getTemplateLabel,
  titleCaseLabel
} from '@cavalry/finance-core/application/dashboard/dashboard-view-model-helpers.js';
import { getAiDraftStatusLabel, getAiDraftStatusTone } from './draft-review-view-model-service.js';

const MONTH_NAMES = Object.freeze([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]);
const RESOLVABLE_DRAFT_STATUSES = Object.freeze(['pending', 'needs_fix', 'failed']);

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asString(value));
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatDisplayDate(dateValue) {
  const date = parseISODate(dateValue);
  if (!date) {
    return String(dateValue || 'No date');
  }
  return (
    MONTH_NAMES[date.getMonth()] + ' ' + String(date.getDate()) + ', ' + String(date.getFullYear())
  );
}

function formatMoneyWithCurrency(value, currency) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  } catch (error) {
    return Number(value || 0).toFixed(2) + ' ' + currency;
  }
}

function getEntityName(collection, id, typedName, fallback) {
  const draftId = asString(id);
  const found = draftId ? asArray(collection).find((item) => item && item.id === draftId) : null;
  return found && found.name ? found.name : asString(typedName) || fallback || '';
}

function cleanAdvisorEditValue(value) {
  return String(value || '')
    .replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, '')
    .replace(/\b(?:please|thanks|thank you)\b\.?$/i, '')
    .replace(/[,.!?;:]+$/g, '')
    .trim()
    .slice(0, 80);
}

function formatAdvisorDraftSubject(value, fallback) {
  const cleaned = cleanAdvisorEditValue(value || fallback || '');
  if (!cleaned) {
    return '';
  }
  return cleaned === cleaned.toLowerCase() ? titleCaseLabel(cleaned, cleaned) : cleaned;
}

function getAdvisorTransactionDraftSubject(fields, template) {
  if (template === 'income_received') {
    if (fields.counterpartyName) {
      return 'Income from ' + fields.counterpartyName;
    }
    return formatAdvisorDraftSubject(fields.description || fields.categoryName, 'Incoming money');
  }
  if (template === 'transfer') {
    const route = [fields.primaryAccountName, fields.secondaryAccountName]
      .filter(Boolean)
      .join(' to ');
    return route ? 'Transfer: ' + route : 'Transfer';
  }
  if (template === 'debt_payment' || template === 'liability_payment') {
    return formatAdvisorDraftSubject(fields.description, 'Credit card payment');
  }
  if (template === 'opening_balance') {
    return fields.primaryAccountName
      ? 'Opening balance for ' + fields.primaryAccountName
      : 'Opening balance';
  }
  return formatAdvisorDraftSubject(
    fields.description || fields.counterpartyName || fields.categoryName,
    getTemplateLabel(template)
  );
}

function normalizeValidation(validation) {
  const result = validation && typeof validation === 'object' ? validation : {};
  return {
    ok: result.ok !== false,
    error: asString(result.error || result.reason)
  };
}

export function getAiDraftObjectLabel(objectType) {
  const map = {
    transaction: 'Transaction',
    account: 'Account',
    category: 'Category',
    counterparty: 'Counterparty',
    recurringItem: 'Recurring Item',
    billSubscription: 'Bill / Subscription',
    budget: 'Budget',
    ledgerCleanup: 'Ledger Cleanup',
    ledgerReview: 'Ledger Review'
  };
  return map[asString(objectType)] || titleCaseLabel(objectType, 'Item');
}

export function formatAiDraftDate(value) {
  const dateKey = String(value || '').slice(0, 10);
  return dateKey && parseISODate(dateKey) ? formatDisplayDate(dateKey) : 'Not dated';
}

export function getAiDraftTrustLabels(draft) {
  const source = asObject(draft && draft.source);
  const intake = asObject(source.intake);
  const review = asObject(source.gateReview);
  const labels = [];
  if (intake.interpreter === 'model') {
    labels.push('Model interpreted');
  }
  if (review.reviewer === 'model' && asString(review.decision).toLowerCase() === 'approved') {
    labels.push('Model approved');
  } else if (review.reviewer === 'rules') {
    labels.push('Not model reviewed');
  }
  if (intake.attachmentStatus === 'image_verified' || intake.evidenceSource === 'image') {
    labels.push('Image verified');
  } else if (
    intake.attachmentStatus === 'attachment_failed' ||
    intake.evidenceSource === 'text_after_attachment'
  ) {
    labels.push('Image not verified');
  }
  if (intake.attachmentStatus === 'document_extracted') {
    labels.push('Document extracted');
  }
  return labels.filter((label, index, list) => list.indexOf(label) === index);
}

export function getAiDraftAccountDisplayName(draft) {
  const proposed = asObject(draft && draft.proposed);
  return String(proposed.name || (draft && draft.title) || '')
    .replace(/^Create\s+/i, '')
    .trim();
}

export function getAiDraftAccountTypeLabel(draft) {
  const proposed = asObject(draft && draft.proposed);
  const subtype = titleCaseLabel(proposed.subtype || '', '');
  const group = titleCaseLabel(proposed.group || '', 'Account');
  if (subtype && subtype !== group) {
    return subtype + ' account';
  }
  return group + ' account';
}

export function getAiDraftMoneyTone(draft) {
  const safeDraft = asObject(draft);
  if (safeDraft.objectType !== 'transaction') {
    if (safeDraft.objectType === 'ledgerCleanup') return 'info';
    if (safeDraft.objectType === 'ledgerReview') return 'warn';
    if (safeDraft.objectType === 'budget') return 'info';
    if (safeDraft.objectType === 'recurringItem' || safeDraft.objectType === 'billSubscription')
      return 'bad';
    return 'info';
  }
  const proposed = asObject(safeDraft.proposed);
  const fields = normalizeAdvisorTransactionDraftFields(proposed.fields);
  const template = normalizeAdvisorTransactionTemplate(proposed.template || fields.template);
  if (template === 'income_received') return 'good';
  if (template === 'expense_paid' || template === 'expense_charged') return 'bad';
  if (template === 'debt_payment' || template === 'liability_payment') return 'warn';
  return 'info';
}

export function getAiDraftMoneyIcon(tone) {
  if (tone === 'good') return 'south_west';
  if (tone === 'bad') return 'north_east';
  if (tone === 'warn') return 'priority_high';
  return 'sync_alt';
}

export function getAiDraftKindLabel(draft) {
  const safeDraft = asObject(draft);
  if (safeDraft.objectType === 'ledgerCleanup') return 'Ledger Cleanup';
  if (safeDraft.objectType === 'ledgerReview') return 'Ledger Review';
  if (safeDraft.objectType === 'account')
    return safeDraft.operation === 'create' ? 'New Account' : 'Account Change';
  if (safeDraft.objectType === 'budget') return 'Budget Change';
  if (safeDraft.objectType === 'recurringItem' || safeDraft.objectType === 'billSubscription')
    return 'Recurring Item';
  if (safeDraft.objectType !== 'transaction') return getAiDraftObjectLabel(safeDraft.objectType);
  const proposed = asObject(safeDraft.proposed);
  const fields = normalizeAdvisorTransactionDraftFields(proposed.fields);
  const template = normalizeAdvisorTransactionTemplate(proposed.template || fields.template);
  if (template === 'income_received') return 'Incoming Money';
  if (template === 'expense_paid') return 'Expense';
  if (template === 'expense_charged') return 'Card Charge';
  if (template === 'transfer') return 'Transfer';
  if (template === 'debt_payment' || template === 'liability_payment') return 'Debt Payment';
  if (template === 'opening_balance') return 'Opening Balance';
  return 'Transaction';
}

export function getAiDraftDisplayAmount(draft, workbook = {}) {
  const safeDraft = asObject(draft);
  const safeWorkbook = asObject(workbook);
  if (safeDraft.objectType !== 'transaction') {
    if (safeDraft.objectType === 'ledgerCleanup') {
      const cleanup = getMeaningfulLedgerCleanupPayload(safeWorkbook, safeDraft.proposed);
      const total =
        cleanup.categoryChanges.length +
        cleanup.counterpartyChanges.length +
        cleanup.transactionPatches.length;
      return String(total) + ' change' + (total === 1 ? '' : 's');
    }
    if (safeDraft.objectType === 'ledgerReview') {
      const review = normalizeLedgerReviewPayload(safeDraft.proposed);
      const count =
        review.counts.reviewItemCount ||
        review.groups.reduce((sum, group) => sum + group.items.length, 0);
      return String(count) + ' review item' + (count === 1 ? '' : 's');
    }
    const proposed = asObject(safeDraft.proposed);
    const value = Number(proposed.amount || proposed.planned || proposed.openingBalance || 0) || 0;
    return value > 0
      ? formatMoneyWithCurrency(value, proposed.currency || safeWorkbook.currency || 'PHP')
      : titleCaseLabel(safeDraft.operation, 'Draft');
  }
  const proposed = asObject(safeDraft.proposed);
  const fields = normalizeAdvisorTransactionDraftFields(proposed.fields);
  return fields.amount > 0
    ? formatMoneyWithCurrency(fields.amount, fields.currency || safeWorkbook.currency || 'PHP')
    : 'Amount needed';
}

export function getAiDraftReviewTitle(draft, workbook = {}) {
  const safeDraft = asObject(draft);
  if (safeDraft.objectType !== 'transaction') {
    if (safeDraft.objectType === 'account') {
      const name = getAiDraftAccountDisplayName(safeDraft) || 'account';
      return safeDraft.operation === 'create'
        ? 'Create ' + name
        : titleCaseLabel(safeDraft.operation, 'Update') + ' ' + name;
    }
    return safeDraft.title || getAiDraftKindLabel(safeDraft);
  }
  const safeWorkbook = asObject(workbook);
  const proposed = asObject(safeDraft.proposed);
  const fields = normalizeAdvisorTransactionDraftFields(proposed.fields);
  const template = normalizeAdvisorTransactionTemplate(proposed.template || fields.template);
  const category = getEntityName(
    safeWorkbook.categories,
    fields.categoryId,
    fields.categoryName || proposed.createCategoryName,
    ''
  );
  const counterparty = getEntityName(
    safeWorkbook.counterparties,
    fields.counterpartyId,
    fields.counterpartyName,
    ''
  );
  const account = getEntityName(
    safeWorkbook.accounts,
    fields.primaryAccountId,
    fields.primaryAccountName,
    ''
  );
  const subject = getAdvisorTransactionDraftSubject(fields, template);
  if (template === 'income_received') {
    return subject || 'Income from ' + (counterparty || category || 'source');
  }
  if (template === 'transfer') {
    const toAccount = getEntityName(
      safeWorkbook.accounts,
      fields.secondaryAccountId,
      fields.secondaryAccountName,
      ''
    );
    return (
      'Transfer' +
      (account || toAccount ? ': ' + [account, toAccount].filter(Boolean).join(' to ') : '')
    );
  }
  if (template === 'debt_payment' || template === 'liability_payment') {
    return subject + (account ? ' from ' + account : '');
  }
  return subject || category || counterparty || safeDraft.title || 'Expense draft';
}

export function getAiDraftTitleEditField(draft) {
  const safeDraft = asObject(draft);
  if (safeDraft.objectType !== 'transaction') {
    return 'title';
  }
  const proposed = asObject(safeDraft.proposed);
  const fields = normalizeAdvisorTransactionDraftFields(proposed.fields);
  const template = normalizeAdvisorTransactionTemplate(proposed.template || fields.template);
  if (template === 'transfer') {
    return fields.secondaryAccountId ? 'secondaryAccountId' : 'secondaryAccountName';
  }
  if (template === 'income_received') {
    return fields.counterpartyId
      ? 'counterpartyId'
      : fields.categoryId
        ? 'categoryId'
        : 'counterpartyName';
  }
  if (template === 'debt_payment' || template === 'liability_payment') {
    return fields.secondaryAccountId ? 'secondaryAccountId' : 'secondaryAccountName';
  }
  return fields.categoryId
    ? 'categoryId'
    : fields.categoryName || proposed.createCategoryName
      ? 'categoryName'
      : 'title';
}

export function getAiDraftReviewStatus(draft, validation) {
  const safeValidation = normalizeValidation(validation);
  if (!safeValidation.ok) {
    return { label: 'Needs details', tone: 'warn', icon: 'help' };
  }
  if (draft && draft.objectType === 'ledgerReview') {
    return { label: 'Review', tone: 'info', icon: 'manage_search' };
  }
  return { label: 'Ready', tone: 'good', icon: 'task_alt' };
}

export function buildAiDraftDisplayViewModel(workbook, draft, options = {}) {
  const safeDraft = asObject(draft);
  const validation = normalizeValidation(options.validation);
  const canResolve = RESOLVABLE_DRAFT_STATUSES.indexOf(asString(safeDraft.status)) >= 0;
  const canConfirm = canResolve && validation.ok;
  const isCleanup = safeDraft.objectType === 'ledgerCleanup';
  const isReview = safeDraft.objectType === 'ledgerReview';
  const validationMessage =
    validation.error || safeDraft.error || 'Needs more detail before it can be applied.';
  const cardTone =
    safeDraft.status === 'confirmed'
      ? 'posted'
      : safeDraft.status === 'rejected'
        ? 'dismissed'
        : validation.ok
          ? 'draft'
          : 'needs_info';
  const statusCopy =
    safeDraft.status === 'confirmed'
      ? isReview
        ? 'Marked reviewed. No workbook changes were made.'
        : 'Applied to the workbook.'
      : safeDraft.status === 'rejected'
        ? 'Rejected and kept for history.'
        : validation.ok
          ? isReview
            ? 'Manual review only. Mark reviewed when finished.'
            : isCleanup
              ? 'Not applied yet. Review the listed changes, then apply or reject.'
              : 'Ready to apply. A snapshot will be created first.'
          : isReview
            ? 'This review draft needs source transactions.'
            : isCleanup
              ? /no proposed changes/i.test(validationMessage)
                ? 'No real changes remain after filtering the proposal.'
                : 'Fix the blocking detail before applying.'
              : 'Fix the blocking detail before posting.';
  const displayStatusLabel =
    canResolve && validation.ok ? 'Ready' : getAiDraftStatusLabel(safeDraft.status);
  const moneyTone = getAiDraftMoneyTone(safeDraft);
  const reviewStatus = getAiDraftReviewStatus(safeDraft, validation);
  return {
    draftId: asString(safeDraft.id),
    objectType: asString(safeDraft.objectType),
    operation: asString(safeDraft.operation),
    operationLabel: titleCaseLabel(safeDraft.operation, 'Create'),
    status: asString(safeDraft.status),
    statusLabel: getAiDraftStatusLabel(safeDraft.status),
    statusTone: getAiDraftStatusTone(safeDraft.status),
    displayStatusLabel,
    statusCopy,
    reviewStatus,
    cardTone,
    canResolve,
    canConfirm,
    isCleanup,
    isReview,
    validation,
    validationMessage,
    kindLabel: getAiDraftKindLabel(safeDraft),
    objectLabel: getAiDraftObjectLabel(safeDraft.objectType),
    title: getAiDraftReviewTitle(safeDraft, workbook),
    titleEditField: getAiDraftTitleEditField(safeDraft),
    moneyTone,
    moneyIcon: getAiDraftMoneyIcon(moneyTone),
    amountDisplay: getAiDraftDisplayAmount(safeDraft, workbook),
    amountEditField: safeDraft.objectType === 'transaction' ? 'amount' : 'proposed',
    confidenceLabel: String(Math.round((Number(safeDraft.confidence) || 0) * 100)) + '% confidence',
    createdAtLabel: formatAiDraftDate(safeDraft.createdAt),
    trustLabels: getAiDraftTrustLabels(safeDraft)
  };
}

export function buildAiDraftQueueItemViewModel(workbook, draft, options = {}) {
  return buildAiDraftDisplayViewModel(workbook, draft, options);
}

export function buildAiDraftCardViewModel(workbook, draft, options = {}) {
  return buildAiDraftDisplayViewModel(workbook, draft, options);
}

export function buildAiDraftDetailHeaderViewModel(workbook, draft, options = {}) {
  return buildAiDraftDisplayViewModel(workbook, draft, options);
}
