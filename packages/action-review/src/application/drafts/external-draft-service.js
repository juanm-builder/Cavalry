import { roundMoney } from '@cavalry/finance-core/domain/money.js';
import {
  normalizeAdvisorDraftGroup,
  normalizeAiDraft,
  upsertAdvisorDraftGroups
} from '../../domain/drafts/draft-lifecycle.js';
import { createValidationIssue, uniqueIssues } from '../../domain/cavalry-action-plan/issues.js';
import { parseCavalryActionPlan } from '../../domain/cavalry-action-plan/parse.js';
import {
  validateCavalryActionPlan,
  isValidActionPlanDate
} from '../../domain/cavalry-action-plan/validate.js';
import { CAVALRY_ACTION_PLAN_VERSION } from '../../domain/cavalry-action-plan/schema.js';
import {
  createDraftGroup,
  ensureExternalDraftCollections,
  fingerprintValue,
  findExternalDraftGroup,
  getWorkbookCoreFingerprint,
  persistExternalDraftGroup,
  stableStringify
} from './draft-group-model.js';
import { findTransactionDuplicateCandidates } from './duplicate-detection.js';

export class ExternalDraftServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'ExternalDraftServiceError';
    this.code = code;
    this.status = Number(options.status || 400);
    this.issues = options.issues || [
      createValidationIssue(code, message, {
        severity: options.severity || 'blocked'
      })
    ];
    this.requestId = options.requestId || '';
  }
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function textKey(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleCase(value) {
  return asString(value).replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function createFallbackId(prefix) {
  return String(prefix || 'id') + '_' + Math.random().toString(36).slice(2, 10);
}

function getNow(now) {
  return typeof now === 'function' ? now() : new Date().toISOString();
}

function getSupportedCurrencies(workbook) {
  return Array.from(
    new Set(
      [
        asString(workbook && workbook.currency).toUpperCase(),
        'PHP',
        'USD',
        ...(Array.isArray(workbook && workbook.accounts)
          ? workbook.accounts.map((account) => asString(account.currency).toUpperCase())
          : [])
      ].filter(Boolean)
    )
  );
}

function normalizeCurrency(value, fallback) {
  return asString(value || fallback).toUpperCase();
}

function getDisplayCurrencySymbol(currency) {
  const normalized = normalizeCurrency(currency);
  if (normalized === 'PHP') return 'PHP';
  if (normalized === 'USD') return 'USD';
  return normalized || 'CUR';
}

function formatAmount(amount, currency) {
  return getDisplayCurrencySymbol(currency) + ' ' + roundMoney(amount).toFixed(2);
}

function getActionId(action, index) {
  return asString(action && action.id) || 'action_' + String(index + 1);
}

function accountAllowedForDraft(account, groups) {
  if (!(account && account.isActive !== false)) {
    return false;
  }
  if (account.isSystem === true) {
    return false;
  }
  return !groups.length || groups.includes(asString(account.group).toLowerCase());
}

function getAccountGroupsForDirection(direction) {
  if (direction === 'income') return ['asset'];
  if (direction === 'expense' || direction === 'refund') return ['asset', 'liability'];
  if (direction === 'transfer') return ['asset', 'liability'];
  return ['asset', 'liability'];
}

function entityMatch(items, id, hint, allowedFilter) {
  const source = (Array.isArray(items) ? items : []).filter(
    (item) => !allowedFilter || allowedFilter(item)
  );
  const normalizedId = asString(id);
  if (normalizedId) {
    const found = source.find((item) => asString(item && item.id) === normalizedId) || null;
    return found
      ? { status: 'matched', value: found, candidates: [] }
      : { status: 'not_found', value: null, candidates: [] };
  }
  const normalizedHint = textKey(hint);
  if (!normalizedHint) {
    return { status: 'not_found', value: null, candidates: [] };
  }
  const exact = source.filter(
    (item) =>
      textKey(item && item.name) === normalizedHint ||
      textKey(item && item.displayName) === normalizedHint ||
      textKey(item && item.id) === normalizedHint
  );
  if (exact.length === 1) {
    return { status: 'matched', value: exact[0], candidates: exact };
  }
  if (exact.length > 1) {
    return { status: 'ambiguous', value: null, candidates: exact };
  }
  const contains = source.filter((item) => {
    const key = textKey(
      [item && item.name, item && item.displayName, item && item.subtype].filter(Boolean).join(' ')
    );
    return key && (key.includes(normalizedHint) || normalizedHint.includes(key));
  });
  if (contains.length === 1) {
    return { status: 'matched', value: contains[0], candidates: contains };
  }
  if (contains.length > 1) {
    return { status: 'ambiguous', value: null, candidates: contains };
  }
  return { status: 'not_found', value: null, candidates: [] };
}

export function matchAccount(workbook, request = {}) {
  const direction = asString(request.direction || 'unknown');
  const groups = getAccountGroupsForDirection(direction);
  const match = entityMatch(
    workbook && workbook.accounts,
    request.account_id || request.payment_account_id,
    request.account_hint || request.payment_account_hint,
    (account) => accountAllowedForDraft(account, groups)
  );
  if (match.status === 'not_found') {
    return Object.assign(match, {
      issue: createValidationIssue(
        request.account_id || request.payment_account_id
          ? 'unknown_account'
          : 'missing_required_field',
        'Payment account could not be matched safely.',
        {
          severity: 'warning',
          field:
            request.account_id || request.payment_account_id
              ? 'payment_account_id'
              : 'payment_account_hint',
          actionId: request.action_id
        }
      )
    });
  }
  if (match.status === 'ambiguous') {
    return Object.assign(match, {
      issue: createValidationIssue(
        'ambiguous_account',
        'Payment account matched more than one active account.',
        {
          severity: 'warning',
          field: 'payment_account_hint',
          actionId: request.action_id
        }
      )
    });
  }
  return match;
}

function getCategoryTypesForDirection(direction) {
  if (direction === 'income') return ['income'];
  if (direction === 'expense' || direction === 'refund' || direction === 'unknown')
    return ['expense'];
  return [];
}

export function matchCategory(workbook, request = {}) {
  const direction = asString(request.direction || 'expense');
  const allowedTypes = getCategoryTypesForDirection(direction);
  if (direction === 'transfer') {
    return { status: 'matched', value: null, candidates: [] };
  }
  const hint = request.category_hint || request.category_name;
  const id = request.category_id;
  if (!(id || hint)) {
    const uncategorized =
      (workbook && Array.isArray(workbook.categories) ? workbook.categories : []).find(
        (category) =>
          category.isActive !== false &&
          (!allowedTypes.length || allowedTypes.includes(asString(category.type).toLowerCase())) &&
          ['uncategorized', 'uncategorised'].includes(textKey(category.name))
      ) || null;
    if (uncategorized) {
      return { status: 'matched', value: uncategorized, candidates: [uncategorized] };
    }
  }
  const match = entityMatch(
    workbook && workbook.categories,
    id,
    hint,
    (category) =>
      category &&
      category.isActive !== false &&
      (!allowedTypes.length || allowedTypes.includes(asString(category.type).toLowerCase()))
  );
  if (match.status === 'not_found') {
    return Object.assign(match, {
      issue: createValidationIssue(
        id ? 'unknown_category' : 'missing_required_field',
        'Category could not be matched safely.',
        {
          severity: 'warning',
          field: id ? 'category_id' : 'category_hint',
          actionId: request.action_id
        }
      )
    });
  }
  if (match.status === 'ambiguous') {
    return Object.assign(match, {
      issue: createValidationIssue(
        'ambiguous_category',
        'Category matched more than one active category.',
        {
          severity: 'warning',
          field: 'category_hint',
          actionId: request.action_id
        }
      )
    });
  }
  return match;
}

function pushIssue(issues, issue) {
  if (issue) {
    issues.push(issue);
  }
}

function getDraftStatusFromIssues(issues, fallback = 'ready') {
  if ((issues || []).some((issue) => issue.severity === 'blocked')) {
    return 'blocked';
  }
  if (
    (issues || []).some(
      (issue) =>
        ['invalid_date', 'missing_required_field', 'invalid_amount'].includes(issue.code) &&
        issue.severity === 'error'
    )
  ) {
    return 'needs_info';
  }
  if ((issues || []).some((issue) => ['warning', 'error'].includes(issue.severity))) {
    return 'needs_review';
  }
  return fallback;
}

function makeActionSourceRefs(action) {
  return Array.isArray(action && action.evidence)
    ? action.evidence.map(asString).filter(Boolean)
    : [];
}

function transactionTemplateFromDraft(direction, account) {
  if (direction === 'income') return 'income_received';
  if (direction === 'transfer') return 'transfer';
  if (direction === 'refund')
    return account && account.group === 'liability' ? 'expense_charged' : 'expense_paid';
  return account && account.group === 'liability' ? 'expense_charged' : 'expense_paid';
}

function buildTransactionDraft(workbook, action, parentPlan, index) {
  const actionId = getActionId(action, index);
  const date = asString(action.date || parentPlan.date_default);
  const currency = normalizeCurrency(
    action.currency || parentPlan.currency_default || workbook.currency,
    workbook.currency || 'PHP'
  );
  const direction = asString(action.direction || 'unknown') || 'unknown';
  const issues = [];
  if (!asString(action.description)) {
    pushIssue(
      issues,
      createValidationIssue('missing_required_field', 'Transaction description is required.', {
        severity: 'error',
        field: 'description',
        actionId
      })
    );
  }
  if (!(Number(action.amount) > 0)) {
    pushIssue(
      issues,
      createValidationIssue('invalid_amount', 'Transaction amount must be positive.', {
        severity: 'blocked',
        field: 'amount',
        actionId
      })
    );
  }
  if (!date || !isValidActionPlanDate(date)) {
    pushIssue(
      issues,
      createValidationIssue(
        'invalid_date',
        'Transaction needs a valid date before it can be applied.',
        {
          severity: 'error',
          field: action.date ? 'date' : 'date_default',
          actionId,
          suggestedFix: 'Use YYYY-MM-DD.'
        }
      )
    );
  }
  const supportedCurrencies = getSupportedCurrencies(workbook);
  if (currency && supportedCurrencies.length && !supportedCurrencies.includes(currency)) {
    pushIssue(
      issues,
      createValidationIssue(
        'unsupported_currency',
        'Currency is not configured for this workbook: ' + currency,
        {
          severity: 'warning',
          field: 'currency',
          actionId
        }
      )
    );
  }
  const accountMatch = matchAccount(workbook, {
    action_id: actionId,
    direction,
    payment_account_id: action.payment_account_id,
    payment_account_hint: action.payment_account_hint
  });
  pushIssue(issues, accountMatch.issue);
  const categoryMatch = matchCategory(workbook, {
    action_id: actionId,
    direction,
    category_id: action.category_id,
    category_hint: action.category_hint
  });
  pushIssue(issues, categoryMatch.issue);
  if (action.requires_review === true || action.confidence === 'low') {
    pushIssue(
      issues,
      createValidationIssue(
        'invalid_schema',
        'The source marked this transaction as low confidence or requiring review.',
        {
          severity: 'warning',
          field: 'confidence',
          actionId
        }
      )
    );
  }
  const duplicateCandidateInput = {
    date,
    description: action.description,
    amount: Number(action.amount) || 0,
    currency,
    payment_account_id: accountMatch.value && accountMatch.value.id
  };
  const duplicateCandidates = findTransactionDuplicateCandidates(workbook, duplicateCandidateInput);
  if (duplicateCandidates.length) {
    pushIssue(
      issues,
      createValidationIssue(
        'possible_duplicate',
        'This looks similar to an existing transaction or pending draft.',
        {
          severity: 'warning',
          field: 'amount',
          actionId
        }
      )
    );
  }
  const accountDisplay = accountMatch.value
    ? accountMatch.value.name
    : asString(action.payment_account_hint || action.payment_account_id);
  const categoryDisplay = categoryMatch.value
    ? categoryMatch.value.name
    : asString(action.category_hint || action.category_id || 'Uncategorized');
  const template = transactionTemplateFromDraft(direction, accountMatch.value);
  const proposedValues = {
    date,
    description: asString(action.description),
    merchant: asString(action.merchant),
    amount: roundMoney(action.amount),
    currency,
    direction,
    template,
    payment_account_id: accountMatch.value
      ? accountMatch.value.id
      : asString(action.payment_account_id),
    payment_account_display: accountDisplay,
    payment_account_group: accountMatch.value ? accountMatch.value.group : '',
    category_id: categoryMatch.value ? categoryMatch.value.id : asString(action.category_id),
    category_display: categoryDisplay,
    category_hint: asString(action.category_hint),
    counterparty_hint: asString(action.counterparty_hint || action.merchant),
    notes: asString(action.notes),
    source_text: asString(action.source_text)
  };
  const display =
    formatAmount(proposedValues.amount, currency) +
    ' ' +
    direction +
    (accountDisplay ? ' via ' + accountDisplay : '') +
    (categoryDisplay ? ' - ' + categoryDisplay : '');
  return {
    type: 'transaction',
    status: getDraftStatusFromIssues(issues),
    title: asString(action.description) || 'Transaction draft',
    display_summary: display,
    proposed_values: proposedValues,
    validation_issues: uniqueIssues(issues),
    duplicate_candidates: duplicateCandidates.length ? duplicateCandidates : undefined,
    source_action_id: actionId,
    source_refs: makeActionSourceRefs(action)
  };
}

function recurringLooksAmbiguous(action) {
  const key = textKey(
    [action && action.name, action && action.merchant, action && action.category_hint]
      .filter(Boolean)
      .join(' ')
  );
  return /\b(load|top up|topup|rfid|prepaid|airtime|fare|toll|usage)\b/.test(key);
}

function buildRecurringDraft(workbook, action, parentPlan, index) {
  const actionId = getActionId(action, index);
  const issues = [];
  if (!asString(action.name)) {
    pushIssue(
      issues,
      createValidationIssue('missing_required_field', 'Recurring item name is required.', {
        severity: 'error',
        field: 'name',
        actionId
      })
    );
  }
  const amountProvided =
    Object.prototype.hasOwnProperty.call(action, 'amount') && Number(action.amount) > 0;
  if (!amountProvided) {
    pushIssue(
      issues,
      createValidationIssue('missing_required_field', 'Recurring item amount is missing or zero.', {
        severity: 'warning',
        field: 'amount',
        actionId
      })
    );
  }
  const cadence = asString(action.cadence || 'unknown');
  if (cadence === 'unknown') {
    pushIssue(
      issues,
      createValidationIssue('missing_required_field', 'Recurring cadence is unknown.', {
        severity: 'warning',
        field: 'cadence',
        actionId
      })
    );
  }
  if (recurringLooksAmbiguous(action) || action.confidence === 'low') {
    pushIssue(
      issues,
      createValidationIssue(
        'invalid_schema',
        'This looks like a top-up, load, RFID, or low-confidence recurring candidate.',
        {
          severity: 'warning',
          field: 'name',
          actionId
        }
      )
    );
  }
  const categoryMatch = matchCategory(workbook, {
    action_id: actionId,
    direction: 'expense',
    category_id: action.category_id,
    category_hint: action.category_hint
  });
  pushIssue(issues, categoryMatch.issue);
  const accountMatch =
    action.payment_account_id || action.payment_account_hint
      ? matchAccount(workbook, {
          action_id: actionId,
          direction: 'expense',
          payment_account_id: action.payment_account_id,
          payment_account_hint: action.payment_account_hint
        })
      : { status: 'not_found', value: null };
  pushIssue(issues, accountMatch.issue);
  const currency = normalizeCurrency(
    action.currency || parentPlan.currency_default || workbook.currency,
    workbook.currency || 'PHP'
  );
  const dueDate = asString(action.next_due_date || parentPlan.date_default);
  if (dueDate && !isValidActionPlanDate(dueDate)) {
    pushIssue(
      issues,
      createValidationIssue('invalid_date', 'Recurring next due date is invalid.', {
        severity: 'error',
        field: 'next_due_date',
        actionId
      })
    );
  }
  const proposedValues = {
    name: asString(action.name),
    amount: amountProvided ? roundMoney(action.amount) : 0,
    currency,
    cadence,
    next_due_date: dueDate,
    payment_account_id: accountMatch.value
      ? accountMatch.value.id
      : asString(action.payment_account_id),
    payment_account_display: accountMatch.value
      ? accountMatch.value.name
      : asString(action.payment_account_hint),
    category_id: categoryMatch.value ? categoryMatch.value.id : asString(action.category_id),
    category_display: categoryMatch.value
      ? categoryMatch.value.name
      : asString(action.category_hint),
    merchant: asString(action.merchant),
    source_transaction_refs: Array.isArray(action.source_transaction_refs)
      ? action.source_transaction_refs
      : []
  };
  return {
    type: 'recurring_item',
    status: getDraftStatusFromIssues(issues),
    title: proposedValues.name || 'Recurring item draft',
    display_summary:
      proposedValues.name +
      (amountProvided ? ' - ' + formatAmount(proposedValues.amount, currency) : '') +
      ' - ' +
      cadence,
    proposed_values: proposedValues,
    validation_issues: uniqueIssues(issues),
    source_action_id: actionId,
    source_refs: makeActionSourceRefs(action).concat(
      proposedValues.source_transaction_refs.map(
        (ref) => 'transaction:' + ref.replace(/^transaction:/, '')
      )
    )
  };
}

function findTransactionForCategoryChange(workbook, action, issues, actionId) {
  const transactionId = asString(action.transaction_id);
  if (transactionId) {
    const found =
      (workbook.transactions || []).find(
        (transaction) => asString(transaction.id) === transactionId
      ) || null;
    if (!found) {
      pushIssue(
        issues,
        createValidationIssue(
          'external_ref_not_found',
          'Transaction ID was not found in this workbook.',
          {
            severity: 'warning',
            field: 'transaction_id',
            actionId
          }
        )
      );
    }
    return found;
  }
  const match = action.transaction_match || {};
  const candidates = (workbook.transactions || []).filter((transaction) => {
    if (match.date && asString(transaction.date) !== asString(match.date)) return false;
    if (Number(match.amount) > 0 && roundMoney(transaction.amount) !== roundMoney(match.amount))
      return false;
    if (match.description && !textKey(transaction.description).includes(textKey(match.description)))
      return false;
    return true;
  });
  if (candidates.length === 1) {
    return candidates[0];
  }
  pushIssue(
    issues,
    createValidationIssue(
      candidates.length > 1 ? 'multiple_transaction_matches' : 'external_ref_not_found',
      candidates.length > 1
        ? 'More than one transaction matches this category change.'
        : 'No transaction matches this category change.',
      {
        severity: 'warning',
        field: 'transaction_match',
        actionId
      }
    )
  );
  return null;
}

function buildCategoryChangeDraft(workbook, action, _parentPlan, index) {
  const actionId = getActionId(action, index);
  const issues = [];
  const transaction = findTransactionForCategoryChange(workbook, action, issues, actionId);
  const categoryMatch = matchCategory(workbook, {
    action_id: actionId,
    direction: 'expense',
    category_id: action.suggested_category_id,
    category_hint: action.suggested_category_hint
  });
  pushIssue(issues, categoryMatch.issue);
  const currentCategory =
    transaction && transaction.categoryId
      ? (workbook.categories || []).find((category) => category.id === transaction.categoryId) ||
        null
      : null;
  const proposedValues = {
    transaction_id: transaction ? transaction.id : asString(action.transaction_id),
    suggested_category_id: categoryMatch.value
      ? categoryMatch.value.id
      : asString(action.suggested_category_id),
    suggested_category_display: categoryMatch.value
      ? categoryMatch.value.name
      : asString(action.suggested_category_hint),
    reason: asString(action.reason)
  };
  return {
    type: 'category_change',
    status: getDraftStatusFromIssues(issues),
    title: transaction ? 'Recategorize ' + transaction.description : 'Category change draft',
    display_summary:
      (transaction ? transaction.description : 'Matched transaction') +
      ' -> ' +
      proposedValues.suggested_category_display,
    proposed_values: proposedValues,
    original_values: transaction
      ? {
          transaction_id: transaction.id,
          category_id: transaction.categoryId || '',
          category_display: currentCategory ? currentCategory.name : ''
        }
      : undefined,
    validation_issues: uniqueIssues(issues),
    source_action_id: actionId
  };
}

function buildBudgetDraft(workbook, action, parentPlan, index) {
  const actionId = getActionId(action, index);
  const issues = [];
  const categoryMatch = matchCategory(workbook, {
    action_id: actionId,
    direction: 'expense',
    category_id: action.category_id,
    category_hint: action.category_hint
  });
  pushIssue(issues, categoryMatch.issue);
  if (!(Number(action.amount) > 0)) {
    pushIssue(
      issues,
      createValidationIssue('invalid_amount', 'Budget amount must be positive.', {
        severity: 'blocked',
        field: 'amount',
        actionId
      })
    );
  }
  const currency = normalizeCurrency(
    action.currency || parentPlan.currency_default || workbook.currency,
    workbook.currency || 'PHP'
  );
  return {
    type: 'budget_change',
    status: getDraftStatusFromIssues(issues),
    title:
      'Update ' +
      (categoryMatch.value ? categoryMatch.value.name : asString(action.category_hint)) +
      ' budget',
    display_summary:
      (categoryMatch.value ? categoryMatch.value.name : asString(action.category_hint)) +
      ' -> ' +
      formatAmount(action.amount, currency) +
      ' ' +
      asString(action.period || 'monthly'),
    proposed_values: {
      category_id: categoryMatch.value ? categoryMatch.value.id : asString(action.category_id),
      category_display: categoryMatch.value
        ? categoryMatch.value.name
        : asString(action.category_hint),
      amount: roundMoney(action.amount),
      currency,
      period: asString(action.period || 'monthly'),
      reason: asString(action.reason)
    },
    validation_issues: uniqueIssues(issues),
    source_action_id: actionId
  };
}

function buildDraftItems(workbook, plan) {
  const items = [];
  (plan.actions || []).forEach((action, actionIndex) => {
    if (action.type === 'create_transaction') {
      items.push(buildTransactionDraft(workbook, action, plan, actionIndex));
      return;
    }
    if (action.type === 'create_transaction_batch') {
      (action.transactions || []).forEach((transaction, transactionIndex) => {
        items.push(
          buildTransactionDraft(
            workbook,
            Object.assign({}, transaction, {
              id:
                transaction.id ||
                (asString(action.id) ? action.id + ':' + String(transactionIndex + 1) : '')
            }),
            plan,
            transactionIndex
          )
        );
      });
      return;
    }
    if (action.type === 'create_recurring_item') {
      items.push(buildRecurringDraft(workbook, action, plan, actionIndex));
      return;
    }
    if (action.type === 'update_category_assignment') {
      items.push(buildCategoryChangeDraft(workbook, action, plan, actionIndex));
      return;
    }
    if (action.type === 'update_budget') {
      items.push(buildBudgetDraft(workbook, action, plan, actionIndex));
      return;
    }
  });
  return items;
}

function getAdvisorStatusForExternalDraft(draft) {
  return draft && (draft.status === 'ready' || draft.status === 'needs_review')
    ? 'pending'
    : 'needs_fix';
}

function buildAdvisorTransactionProjection(draft) {
  const values = draft.proposed_values || {};
  return {
    template: values.template || 'expense_paid',
    fields: {
      template: values.template || 'expense_paid',
      date: values.date || '',
      description: values.description || draft.title || '',
      amount: Number(values.amount) || 0,
      currency: values.currency || '',
      categoryId: values.category_id || '',
      categoryName: values.category_display || values.category_hint || '',
      primaryAccountId: values.payment_account_id || '',
      primaryAccountName: values.payment_account_display || '',
      secondaryAccountId: '',
      secondaryAccountName: '',
      counterpartyId: '',
      counterpartyName: values.counterparty_hint || values.merchant || '',
      counterpartyKind: 'merchant',
      note: values.notes || ''
    },
    evidenceSource: 'external_api'
  };
}

function buildAdvisorRecurringProjection(draft) {
  const values = draft.proposed_values || {};
  return {
    name: values.name || draft.title || '',
    amount: Number(values.amount) || 0,
    currency: values.currency || '',
    frequency: values.cadence || 'unknown',
    cadence: values.cadence || 'unknown',
    anchorDate: values.next_due_date || '',
    nextDueDate: values.next_due_date || '',
    accountId: values.payment_account_id || '',
    categoryId: values.category_id || '',
    sourceTransactionIds: (values.source_transaction_refs || [])
      .map((ref) => asString(ref).replace(/^transaction:/, ''))
      .filter(Boolean)
  };
}

function buildAdvisorCategoryChangeProjection(draft) {
  const values = draft.proposed_values || {};
  return {
    mode: 'ledger_cleanup_v1',
    summary: draft.display_summary || draft.title || '',
    categoryChanges: [],
    counterpartyChanges: [],
    transactionPatches: [
      {
        transactionId: values.transaction_id || '',
        categoryId: values.suggested_category_id || ''
      }
    ].filter((patch) => patch.transactionId && patch.categoryId)
  };
}

function buildAdvisorBudgetProjection(draft) {
  const values = draft.proposed_values || {};
  return {
    categoryId: values.category_id || '',
    amount: Number(values.amount) || 0,
    planned: Number(values.amount) || 0,
    currency: values.currency || '',
    period: values.period || 'monthly',
    reason: values.reason || ''
  };
}

function getAdvisorObjectType(draft) {
  if (draft.type === 'recurring_item') return 'recurringItem';
  if (draft.type === 'category_change') return 'ledgerCleanup';
  if (draft.type === 'budget_change') return 'budget';
  return 'transaction';
}

function getAdvisorProjectionPayload(draft) {
  if (draft.type === 'recurring_item') return buildAdvisorRecurringProjection(draft);
  if (draft.type === 'category_change') return buildAdvisorCategoryChangeProjection(draft);
  if (draft.type === 'budget_change') return buildAdvisorBudgetProjection(draft);
  return buildAdvisorTransactionProjection(draft);
}

export function projectExternalDraftGroupToAdvisorReviewQueue(workbook, group, options = {}) {
  if (!(workbook && group && Array.isArray(group.drafts))) {
    return { drafts: [], draftGroups: [] };
  }
  const createdAt = group.created_at || getNow(options.now);
  const projectedDrafts = group.drafts.map((draft, index) =>
    normalizeAiDraft(
      {
        id: 'external_' + draft.draft_id,
        status: getAdvisorStatusForExternalDraft(draft),
        operation: 'create',
        objectType: getAdvisorObjectType(draft),
        title: draft.title,
        summary: draft.display_summary,
        proposed: getAdvisorProjectionPayload(draft),
        before: draft.original_values || {},
        source: {
          type: 'external_api',
          origin: group.origin,
          externalDraftGroupId: group.draft_group_id,
          externalDraftId: draft.draft_id,
          reviewUrl: group.review_url,
          validationIssues: draft.validation_issues || [],
          gateRequired: false
        },
        sourceRefs: [
          'external-draft-group:' + group.draft_group_id,
          'external-draft:' + draft.draft_id
        ].concat(draft.source_refs || []),
        confidence: draft.status === 'ready' ? 0.9 : 0.55,
        reason: draft.display_summary || 'External draft prepared for Cavalry review.',
        createdAt,
        error:
          draft.status === 'needs_info' || draft.status === 'blocked'
            ? (draft.validation_issues || [])
                .map((issue) => issue.message)
                .filter(Boolean)
                .join(' ')
            : ''
      },
      index,
      {
        createdAt,
        createId: options.createId
      }
    )
  );
  workbook.aiDrafts = Array.isArray(workbook.aiDrafts) ? workbook.aiDrafts : [];
  projectedDrafts.forEach((draft) => {
    const existingIndex = workbook.aiDrafts.findIndex((item) => item.id === draft.id);
    if (existingIndex >= 0) {
      workbook.aiDrafts[existingIndex] = draft;
    } else {
      workbook.aiDrafts.push(draft);
    }
  });
  const projectedGroup = normalizeAdvisorDraftGroup(
    {
      groupId: 'external_' + group.draft_group_id,
      taskSpecId: 'external_api',
      title: group.title || 'External draft group',
      summary: group.message || 'Review external drafts before anything changes.',
      draftIds: projectedDrafts.map((draft) => draft.id),
      status: 'pending',
      impactPreview: {
        affectedTransactions: projectedDrafts.filter(
          (draft) => draft.objectType === 'transaction' || draft.objectType === 'ledgerCleanup'
        ).length
      }
    },
    0,
    {
      createId: options.createId
    }
  );
  workbook.advisorDraftGroups = upsertAdvisorDraftGroups(
    workbook.advisorDraftGroups || [],
    [projectedGroup],
    {
      createId: options.createId
    }
  );
  return {
    drafts: projectedDrafts,
    draftGroups: [projectedGroup]
  };
}

function isSupportedExternalActionType(type) {
  return [
    'create_transaction',
    'create_transaction_batch',
    'create_recurring_item',
    'update_category_assignment',
    'update_budget'
  ].includes(asString(type));
}

function hasSupportedExternalActions(plan) {
  return (
    Array.isArray(plan && plan.actions) &&
    plan.actions.some((action) => isSupportedExternalActionType(action && action.type))
  );
}

function isWholePlanBlockingIssue(issue, options = {}) {
  if (issue && issue.code === 'unsupported_action_type' && options.hasSupportedActions) {
    return false;
  }
  return (
    [
      'unsupported_action_type',
      'unsafe_direct_mutation_claim',
      'workbook_mismatch',
      'invalid_json'
    ].includes(issue && issue.code) ||
    (issue &&
      issue.code === 'invalid_schema' &&
      ['cavalry_action_plan_version', 'actions', 'type'].includes(asString(issue.field)))
  );
}

function countActionPlanActions(plan) {
  return Array.isArray(plan && plan.actions)
    ? plan.actions.reduce(
        (count, action) =>
          count +
          (action &&
          action.type === 'create_transaction_batch' &&
          Array.isArray(action.transactions)
            ? action.transactions.length
            : 1),
        0
      )
    : 0;
}

function countDuplicateWarningsFromDrafts(drafts) {
  return (Array.isArray(drafts) ? drafts : []).reduce(
    (count, draft) =>
      count +
      (draft && Array.isArray(draft.validation_issues)
        ? draft.validation_issues.filter((issue) => issue && issue.code === 'possible_duplicate')
            .length
        : 0),
    0
  );
}

function createAuditEvent({
  workbook,
  caller,
  origin,
  operation,
  scopes,
  idempotencyKey,
  requestFingerprint,
  resultStatus,
  draftGroupId,
  validationIssues,
  actionCount,
  duplicateWarningCount,
  idempotencyResult,
  createId,
  now
}) {
  const uid = typeof createId === 'function' ? createId : createFallbackId;
  const timestamp = getNow(now);
  const uniqueValidationIssues = uniqueIssues(validationIssues || []);
  const event = {
    audit_event_id: uid('audit'),
    occurred_at: timestamp,
    timestamp,
    request_id:
      asString(caller && (caller.requestId || caller.request_id)) ||
      asString(origin && (origin.requestId || origin.request_id)),
    caller_type:
      asString(caller && (caller.callerType || caller.caller_type || caller.subject_type)) ||
      'unknown',
    user_id: asString(caller && (caller.userId || caller.user_id)) || 'unknown',
    workbook_id: asString(workbook && workbook.id),
    origin: asString(origin && origin.origin) || 'local_dev_api',
    auth_method: asString(caller && (caller.authMethod || caller.auth_method)) || 'unknown',
    operation: asString(operation),
    operation_id: asString(operation),
    scopes: Array.isArray(scopes) ? scopes.map(asString).filter(Boolean) : [],
    action_count: Math.max(0, Number(actionCount) || 0),
    idempotency_key: asString(idempotencyKey) || undefined,
    request_fingerprint: asString(requestFingerprint),
    idempotency_result: asString(idempotencyResult || (idempotencyKey ? 'created' : 'none')),
    result_status: asString(resultStatus || 'success'),
    outcome: asString(resultStatus || 'success'),
    draft_group_id: asString(draftGroupId) || undefined,
    validation_issue_count: uniqueValidationIssues.length,
    duplicate_warning_count: Math.max(
      0,
      Number(duplicateWarningCount) ||
        uniqueValidationIssues.filter((issue) => issue && issue.code === 'possible_duplicate')
          .length
    ),
    validation_issue_codes: uniqueValidationIssues.map((issue) => issue.code).filter(Boolean)
  };
  ensureExternalDraftCollections(workbook);
  workbook.externalApiAuditEvents.push(event);
  return event;
}

function getIdempotencyRecord(workbook, caller, origin, idempotencyKey) {
  const key = asString(idempotencyKey);
  if (!key) {
    return null;
  }
  ensureExternalDraftCollections(workbook);
  return (
    workbook.externalApiIdempotencyRecords.find(
      (record) =>
        record.idempotency_key === key &&
        record.user_id === asString(caller && caller.user_id) &&
        record.workbook_id === asString(workbook && workbook.id) &&
        record.origin === asString(origin && origin.origin)
    ) || null
  );
}

function persistIdempotencyRecord(
  workbook,
  caller,
  origin,
  idempotencyKey,
  requestFingerprint,
  draftGroupId,
  now
) {
  const key = asString(idempotencyKey);
  if (!key) {
    return null;
  }
  ensureExternalDraftCollections(workbook);
  const record = {
    user_id: asString(caller && caller.user_id),
    workbook_id: asString(workbook && workbook.id),
    origin: asString(origin && origin.origin),
    idempotency_key: key,
    request_fingerprint: requestFingerprint,
    draft_group_id: draftGroupId,
    created_at: getNow(now)
  };
  workbook.externalApiIdempotencyRecords.push(record);
  return record;
}

function normalizePlanInput(actionPlanInput, options) {
  const parsed = parseCavalryActionPlan(actionPlanInput, {
    dateDefault: options.dateDefault,
    currencyDefault: options.currencyDefault,
    timezone: options.timezone,
    source: options.source
  });
  if (!parsed.plan) {
    throw new ExternalDraftServiceError('invalid_json', 'Action plan JSON could not be parsed.', {
      status: 400,
      issues: parsed.issues
    });
  }
  return parsed;
}

export function createExternalDraftGroupFromActionPlan({
  workbook,
  actionPlan,
  caller,
  origin = {},
  operation = 'createDraftGroupFromActionPlan',
  idempotencyKey,
  createId,
  now
} = {}) {
  if (!workbook) {
    throw new ExternalDraftServiceError('invalid_schema', 'Workbook is required.', { status: 400 });
  }
  ensureExternalDraftCollections(workbook);
  const parsed = normalizePlanInput(actionPlan, {
    dateDefault: workbook.currentDate,
    currencyDefault: workbook.currency,
    timezone: workbook.timezone,
    source: 'chatgpt'
  });
  const validation = validateCavalryActionPlan(parsed.plan, {
    workbookId: workbook.id,
    supportedCurrencies: getSupportedCurrencies(workbook)
  });
  const validationIssues = uniqueIssues([...(parsed.issues || []), ...(validation.issues || [])]);
  const actionCount = countActionPlanActions(parsed.plan);
  const supportedActionsPresent = hasSupportedExternalActions(parsed.plan);
  const wholePlanIssues = validationIssues.filter((issue) =>
    isWholePlanBlockingIssue(issue, {
      hasSupportedActions: supportedActionsPresent
    })
  );
  const requestFingerprint = fingerprintValue({
    operation,
    plan: parsed.plan
  });
  const normalizedOrigin = Object.assign(
    {
      origin: 'local_dev_api',
      provider: 'chatgpt',
      idempotencyKey: idempotencyKey || parsed.plan.idempotency_key
    },
    origin || {}
  );
  const effectiveIdempotencyKey = asString(
    idempotencyKey || normalizedOrigin.idempotencyKey || normalizedOrigin.idempotency_key
  );
  const replayRecord = getIdempotencyRecord(
    workbook,
    caller,
    normalizedOrigin,
    effectiveIdempotencyKey
  );
  if (replayRecord) {
    if (replayRecord.request_fingerprint !== requestFingerprint) {
      const issues = [
        createValidationIssue(
          'idempotency_replay',
          'Idempotency key was reused with a different request body.',
          {
            severity: 'blocked'
          }
        )
      ];
      createAuditEvent({
        workbook,
        caller,
        origin: normalizedOrigin,
        operation,
        scopes: caller && caller.scopes,
        idempotencyKey: effectiveIdempotencyKey,
        requestFingerprint,
        resultStatus: 'validation_failed',
        validationIssues: issues,
        actionCount,
        idempotencyResult: 'conflict',
        createId,
        now
      });
      throw new ExternalDraftServiceError(
        'idempotency_replay',
        'Idempotency key was reused with a different request body.',
        {
          status: 409,
          issues
        }
      );
    }
    const replayed = findExternalDraftGroup(workbook, replayRecord.draft_group_id);
    if (replayed) {
      createAuditEvent({
        workbook,
        caller,
        origin: normalizedOrigin,
        operation,
        scopes: caller && caller.scopes,
        idempotencyKey: effectiveIdempotencyKey,
        requestFingerprint,
        resultStatus: 'success',
        draftGroupId: replayed.draft_group_id,
        validationIssues: [
          createValidationIssue(
            'idempotency_replay',
            'Returned the existing draft group for this idempotency key.',
            {
              severity: 'info'
            }
          )
        ],
        actionCount,
        duplicateWarningCount: countDuplicateWarningsFromDrafts(replayed.drafts),
        idempotencyResult: 'replay',
        createId,
        now
      });
      return Object.assign({}, replayed, { idempotency_replayed: true });
    }
  }
  if (wholePlanIssues.length) {
    createAuditEvent({
      workbook,
      caller,
      origin: normalizedOrigin,
      operation,
      scopes: caller && caller.scopes,
      idempotencyKey: effectiveIdempotencyKey,
      requestFingerprint,
      resultStatus: 'validation_failed',
      validationIssues,
      actionCount,
      idempotencyResult: effectiveIdempotencyKey ? 'created' : 'none',
      createId,
      now
    });
    throw new ExternalDraftServiceError(wholePlanIssues[0].code, wholePlanIssues[0].message, {
      status: wholePlanIssues[0].code === 'workbook_mismatch' ? 403 : 422,
      issues: validationIssues
    });
  }
  const coreBefore = getWorkbookCoreFingerprint(workbook);
  const drafts = buildDraftItems(workbook, parsed.plan);
  const auditEvent = createAuditEvent({
    workbook,
    caller,
    origin: normalizedOrigin,
    operation,
    scopes: caller && caller.scopes,
    idempotencyKey: effectiveIdempotencyKey,
    requestFingerprint,
    resultStatus: 'success',
    validationIssues,
    actionCount,
    duplicateWarningCount: countDuplicateWarningsFromDrafts(drafts),
    idempotencyResult: effectiveIdempotencyKey ? 'created' : 'none',
    createId,
    now
  });
  const group = createDraftGroup({
    workbook,
    title:
      parsed.plan.user_goal ||
      titleCase(operation.replace(/^createCavalry|Drafts$/g, '').replace(/([A-Z])/g, ' $1')) ||
      'External draft group',
    origin: Object.assign({}, normalizedOrigin, {
      idempotencyKey: effectiveIdempotencyKey,
      createdAt: auditEvent.occurred_at
    }),
    drafts,
    validationIssues,
    auditEventId: auditEvent.audit_event_id,
    createId,
    now: () => auditEvent.occurred_at
  });
  auditEvent.draft_group_id = group.draft_group_id;
  persistExternalDraftGroup(workbook, group);
  projectExternalDraftGroupToAdvisorReviewQueue(workbook, group, { createId, now });
  persistIdempotencyRecord(
    workbook,
    caller,
    normalizedOrigin,
    effectiveIdempotencyKey,
    requestFingerprint,
    group.draft_group_id,
    now
  );
  const coreAfter = getWorkbookCoreFingerprint(workbook);
  if (coreBefore !== coreAfter) {
    throw new ExternalDraftServiceError(
      'invalid_schema',
      'External draft creation changed workbook core data.',
      { status: 500 }
    );
  }
  return group;
}

export function createTransactionBatchDraftGroup(options = {}) {
  const request = options.request || {};
  return createExternalDraftGroupFromActionPlan(
    Object.assign({}, options, {
      operation: 'createTransactionDraftBatch',
      actionPlan: {
        cavalry_action_plan_version: CAVALRY_ACTION_PLAN_VERSION,
        source: 'chatgpt',
        date_default: request.date_default || request.dateDefault,
        currency_default: request.currency_default || request.currencyDefault,
        actions: [
          {
            id: request.id || 'transaction_batch',
            type: 'create_transaction_batch',
            idempotency_key: request.idempotency_key || request.idempotencyKey,
            transactions: request.transactions || []
          }
        ]
      }
    })
  );
}

export function createRecurringItemDraftGroup(options = {}) {
  const request = options.request || {};
  return createExternalDraftGroupFromActionPlan(
    Object.assign({}, options, {
      operation: 'createRecurringItemDrafts',
      actionPlan: {
        cavalry_action_plan_version: CAVALRY_ACTION_PLAN_VERSION,
        source: 'chatgpt',
        date_default: request.date_default || request.dateDefault,
        currency_default: request.currency_default || request.currencyDefault,
        actions: (request.items || []).map((item, index) =>
          Object.assign(
            {
              id: item.id || 'recurring_item_' + String(index + 1),
              type: 'create_recurring_item'
            },
            item
          )
        )
      }
    })
  );
}

export function createCategoryChangeDraftGroup(options = {}) {
  const request = options.request || {};
  return createExternalDraftGroupFromActionPlan(
    Object.assign({}, options, {
      operation: 'createCategoryChangeDrafts',
      actionPlan: {
        cavalry_action_plan_version: CAVALRY_ACTION_PLAN_VERSION,
        source: 'chatgpt',
        actions: (request.changes || []).map((item, index) =>
          Object.assign(
            {
              id: item.id || 'category_change_' + String(index + 1),
              type: 'update_category_assignment'
            },
            item
          )
        )
      }
    })
  );
}

function monthKeyFromDate(date) {
  return asString(date).slice(0, 7);
}

function createLine(createId, accountId, direction, amount, currency, note) {
  return {
    id: createId('line'),
    accountId,
    direction,
    amount: roundMoney(amount),
    currency,
    baseAmount: roundMoney(amount),
    note
  };
}

function getCategory(workbook, categoryId) {
  return (workbook.categories || []).find((category) => category.id === categoryId) || null;
}

function buildTransactionFromDraft(workbook, draft, createId) {
  const values = draft.proposed_values || {};
  const existing =
    (workbook.transactions || []).find(
      (transaction) => transaction.reference === 'external:draft:' + draft.draft_id
    ) || null;
  if (existing) {
    return existing;
  }
  const accountId = asString(values.payment_account_id);
  const categoryId = asString(values.category_id);
  const category = getCategory(workbook, categoryId);
  const categoryAccountId = asString(category && category.linkedAccountId) || categoryId;
  const amount = roundMoney(values.amount);
  const currency = normalizeCurrency(values.currency || workbook.currency, workbook.currency);
  const template = asString(
    values.template ||
      transactionTemplateFromDraft(values.direction, { group: values.payment_account_group })
  );
  const lines = [];
  if (template === 'income_received') {
    lines.push(createLine(createId, accountId, 'debit', amount, currency, 'Income received'));
    if (categoryAccountId)
      lines.push(
        createLine(createId, categoryAccountId, 'credit', amount, currency, 'Income category')
      );
  } else if (template === 'expense_charged' || template === 'expense_paid') {
    if (categoryAccountId)
      lines.push(
        createLine(createId, categoryAccountId, 'debit', amount, currency, 'Expense category')
      );
    lines.push(
      createLine(
        createId,
        accountId,
        'credit',
        amount,
        currency,
        template === 'expense_charged' ? 'Liability charge' : 'Payment account'
      )
    );
  } else {
    lines.push(
      createLine(createId, accountId, 'credit', amount, currency, 'External draft transaction')
    );
  }
  return {
    id: createId('txn'),
    date: values.date,
    monthKey: monthKeyFromDate(values.date),
    template,
    description: values.description || draft.title,
    reference: 'external:draft:' + draft.draft_id,
    categoryId,
    counterpartyId: '',
    recurringItemId: '',
    originalCurrency: currency,
    amount,
    baseAmount: amount,
    fxRateToBase: 0,
    note: values.notes || '',
    source: 'external_draft',
    lines
  };
}

function applyTransactionDraft(workbook, draft, createId) {
  const transaction = buildTransactionFromDraft(workbook, draft, createId);
  workbook.transactions = Array.isArray(workbook.transactions) ? workbook.transactions : [];
  if (
    !workbook.transactions.some(
      (item) => item.id === transaction.id || item.reference === transaction.reference
    )
  ) {
    workbook.transactions.push(transaction);
  }
  return transaction.id;
}

function applyRecurringDraft(workbook, draft, createId) {
  const values = draft.proposed_values || {};
  workbook.recurringItems = Array.isArray(workbook.recurringItems) ? workbook.recurringItems : [];
  const existing =
    workbook.recurringItems.find((item) => item.reference === 'external:draft:' + draft.draft_id) ||
    null;
  if (existing) {
    return existing.id;
  }
  const item = {
    id: createId('recurring'),
    name: values.name || draft.title,
    amount: roundMoney(values.amount),
    currency: normalizeCurrency(values.currency || workbook.currency, workbook.currency),
    cadence: values.cadence || 'unknown',
    frequency: values.cadence || 'unknown',
    anchorDate: values.next_due_date || '',
    nextDueDate: values.next_due_date || '',
    accountId: values.payment_account_id || '',
    categoryId: values.category_id || '',
    merchant: values.merchant || '',
    isActive: true,
    reference: 'external:draft:' + draft.draft_id,
    source: 'external_draft'
  };
  workbook.recurringItems.push(item);
  return item.id;
}

function applyCategoryChangeDraft(workbook, draft) {
  const values = draft.proposed_values || {};
  const transaction =
    (workbook.transactions || []).find((item) => item.id === values.transaction_id) || null;
  if (!transaction) {
    throw new ExternalDraftServiceError('external_ref_not_found', 'Transaction no longer exists.', {
      status: 409
    });
  }
  transaction.categoryId = values.suggested_category_id || transaction.categoryId;
  return transaction.id;
}

function applyBudgetDraft(workbook, draft) {
  const values = draft.proposed_values || {};
  const sheet = (workbook.sheets || [])[0];
  if (!sheet) {
    throw new ExternalDraftServiceError('external_ref_not_found', 'No budget sheet exists.', {
      status: 409
    });
  }
  sheet.budgets = Array.isArray(sheet.budgets) ? sheet.budgets : [];
  const existing = sheet.budgets.find((budget) => budget.categoryId === values.category_id) || null;
  if (existing) {
    existing.planned = roundMoney(values.amount);
  } else {
    sheet.budgets.push({ categoryId: values.category_id, planned: roundMoney(values.amount) });
  }
  return sheet.id + ':' + values.category_id;
}

function applyDraftItem(workbook, draft, createId) {
  if (draft.type === 'transaction') return applyTransactionDraft(workbook, draft, createId);
  if (draft.type === 'recurring_item') return applyRecurringDraft(workbook, draft, createId);
  if (draft.type === 'category_change') return applyCategoryChangeDraft(workbook, draft, createId);
  if (draft.type === 'budget_change') return applyBudgetDraft(workbook, draft, createId);
  throw new ExternalDraftServiceError(
    'unsupported_action_type',
    'Unsupported draft item type: ' + draft.type,
    { status: 422 }
  );
}

export function applyExternalDraftGroup({
  workbook,
  draftGroupId,
  selectedDraftIds,
  confirmedByUser,
  caller,
  createId,
  now
} = {}) {
  if (confirmedByUser !== true) {
    throw new ExternalDraftServiceError(
      'blocked_apply_from_external_origin',
      'External draft groups require explicit Cavalry-side confirmation before applying.',
      {
        status: 403
      }
    );
  }
  const group = findExternalDraftGroup(workbook, draftGroupId);
  if (!group) {
    throw new ExternalDraftServiceError('external_ref_not_found', 'Draft group was not found.', {
      status: 404
    });
  }
  if (group.status === 'applied') {
    return group;
  }
  const uid = typeof createId === 'function' ? createId : createFallbackId;
  const selected =
    Array.isArray(selectedDraftIds) && selectedDraftIds.length
      ? new Set(selectedDraftIds.map(asString))
      : null;
  const readyDrafts = (group.drafts || []).filter(
    (draft) => draft.status === 'ready' && (!selected || selected.has(draft.draft_id))
  );
  const resultIds = [];
  readyDrafts.forEach((draft) => {
    const resultId = applyDraftItem(workbook, draft, uid);
    draft.applied_object_id = resultId;
    resultIds.push(resultId);
  });
  group.status = 'applied';
  group.applied_at = getNow(now);
  group.applied_draft_ids = readyDrafts.map((draft) => draft.draft_id);
  group.result_object_ids = resultIds;
  createAuditEvent({
    workbook,
    caller,
    origin: group.origin,
    operation: 'applyExternalDraftGroup',
    scopes: caller && caller.scopes,
    idempotencyKey: group.origin && group.origin.idempotencyKey,
    requestFingerprint: fingerprintValue({
      draftGroupId,
      selectedDraftIds: selectedDraftIds || []
    }),
    resultStatus: 'success',
    draftGroupId: group.draft_group_id,
    validationIssues: [],
    actionCount: readyDrafts.length,
    duplicateWarningCount: countDuplicateWarningsFromDrafts(readyDrafts),
    idempotencyResult: 'none',
    createId: uid,
    now
  });
  return group;
}

export function rejectExternalDraftGroup({ workbook, draftGroupId, caller, createId, now } = {}) {
  const group = findExternalDraftGroup(workbook, draftGroupId);
  if (!group) {
    throw new ExternalDraftServiceError('external_ref_not_found', 'Draft group was not found.', {
      status: 404
    });
  }
  if (group.status === 'rejected') {
    return group;
  }
  group.status = 'rejected';
  group.rejected_at = getNow(now);
  createAuditEvent({
    workbook,
    caller,
    origin: group.origin,
    operation: 'rejectExternalDraftGroup',
    scopes: caller && caller.scopes,
    idempotencyKey: group.origin && group.origin.idempotencyKey,
    requestFingerprint: fingerprintValue({ draftGroupId }),
    resultStatus: 'success',
    draftGroupId: group.draft_group_id,
    validationIssues: [],
    actionCount: Array.isArray(group.drafts) ? group.drafts.length : 0,
    duplicateWarningCount: countDuplicateWarningsFromDrafts(group.drafts),
    idempotencyResult: 'none',
    createId,
    now
  });
  return group;
}

export function getExternalDraftDebugRecord(workbook, draftGroupId) {
  const group = findExternalDraftGroup(workbook, draftGroupId);
  if (!group) {
    return null;
  }
  return {
    draft_group_id: group.draft_group_id,
    status: group.status,
    origin: group.origin,
    audit_event_id: group.audit_event_id,
    validation_issue_codes: (group.validation_issues || []).map((issue) => issue.code),
    request_fingerprint:
      (workbook.externalApiIdempotencyRecords || []).find(
        (record) => record.draft_group_id === group.draft_group_id
      )?.request_fingerprint || ''
  };
}

export { getWorkbookCoreFingerprint, stableStringify };
