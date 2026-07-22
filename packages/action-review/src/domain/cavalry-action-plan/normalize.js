import { roundMoney } from '@cavalry/finance-core/domain/money.js';
import {
  CAVALRY_ACTION_DIRECTIONS,
  CAVALRY_ACTION_PLAN_SOURCES,
  CAVALRY_ACTION_PLAN_VERSION,
  CAVALRY_BUDGET_PERIODS,
  CAVALRY_CONFIDENCE_LEVELS,
  CAVALRY_RECURRING_CADENCES,
  isDirectMutationActionType,
  isSupportedActionType,
  normalizeActionType
} from './schema.js';
import { createValidationIssue, uniqueIssues } from './issues.js';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asStringArray(value, limit = 20) {
  const source = Array.isArray(value) ? value : value == null ? [] : [value];
  const seen = new Set();
  return source
    .map(asString)
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    })
    .slice(0, Math.max(0, Number(limit) || 20));
}

function normalizeCurrency(value) {
  const currency = asString(value).toUpperCase();
  return currency ? currency.replace(/[^A-Z]/g, '').slice(0, 8) : '';
}

function normalizeAmount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? roundMoney(value) : 0;
  }
  const raw = asString(value).replace(/,/g, '');
  const match = /-?[0-9]+(?:\.[0-9]+)?/.exec(raw);
  return match ? roundMoney(Number(match[0]) || 0) : 0;
}

function normalizeConfidence(value) {
  const raw = asString(value).toLowerCase();
  return CAVALRY_CONFIDENCE_LEVELS.includes(raw) ? raw : '';
}

function normalizeDirection(value) {
  const raw = asString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (
    raw === 'expense_paid' ||
    raw === 'expense_charged' ||
    raw === 'purchase' ||
    raw === 'spend'
  ) {
    return 'expense';
  }
  if (raw === 'income_received' || raw === 'revenue') {
    return 'income';
  }
  return CAVALRY_ACTION_DIRECTIONS.includes(raw) ? raw : 'unknown';
}

function normalizeRecurringCadence(value) {
  const raw = asString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (raw === 'annual' || raw === 'annually') return 'yearly';
  if (raw === 'bi_weekly') return 'biweekly';
  return CAVALRY_RECURRING_CADENCES.includes(raw) ? raw : '';
}

function normalizeBudgetPeriod(value) {
  const raw = asString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return CAVALRY_BUDGET_PERIODS.includes(raw) ? raw : '';
}

function copyIfString(target, key, source, keys) {
  for (let index = 0; index < keys.length; index += 1) {
    const value = asString(source[keys[index]]);
    if (value) {
      target[key] = value;
      return;
    }
  }
}

function normalizeCreateTransactionAction(source, normalizedType) {
  const action = {
    type: normalizedType,
    description: asString(source.description || source.name || source.memo || source.merchant),
    amount: normalizeAmount(source.amount || source.value || source.total),
    direction: normalizeDirection(source.direction || source.kind || source.template)
  };
  copyIfString(action, 'id', source, ['id', 'action_id', 'client_id']);
  copyIfString(action, 'date', source, ['date', 'transaction_date']);
  copyIfString(action, 'merchant', source, ['merchant', 'payee', 'counterparty']);
  action.currency = normalizeCurrency(source.currency || source.original_currency);
  copyIfString(action, 'payment_account_id', source, [
    'payment_account_id',
    'account_id',
    'primary_account_id'
  ]);
  copyIfString(action, 'payment_account_hint', source, [
    'payment_account_hint',
    'account_hint',
    'payment_account',
    'account',
    'charged_to'
  ]);
  copyIfString(action, 'category_id', source, ['category_id']);
  copyIfString(action, 'category_hint', source, ['category_hint', 'category', 'category_name']);
  copyIfString(action, 'counterparty_hint', source, [
    'counterparty_hint',
    'counterparty',
    'merchant'
  ]);
  copyIfString(action, 'notes', source, ['notes', 'note', 'memo']);
  copyIfString(action, 'source_text', source, ['source_text', 'sourceText', 'prompt']);
  copyIfString(action, 'idempotency_key', source, ['idempotency_key', 'idempotencyKey']);
  const confidence = normalizeConfidence(source.confidence);
  if (confidence) action.confidence = confidence;
  const evidence = asStringArray(source.evidence || source.source_refs || source.sourceRefs, 20);
  if (evidence.length) action.evidence = evidence;
  if (
    Object.prototype.hasOwnProperty.call(source, 'requires_review') ||
    Object.prototype.hasOwnProperty.call(source, 'requiresReview')
  ) {
    action.requires_review = source.requires_review === true || source.requiresReview === true;
  }
  return action;
}

function normalizeTransactionBatchAction(source, normalizedType, issues) {
  const rawTransactions = Array.isArray(source.transactions)
    ? source.transactions
    : Array.isArray(source.items)
      ? source.items
      : [];
  const action = {
    type: normalizedType,
    transactions: rawTransactions.map((item) =>
      normalizeCreateTransactionAction(asObject(item), 'create_transaction')
    )
  };
  copyIfString(action, 'id', source, ['id', 'action_id', 'client_id']);
  copyIfString(action, 'idempotency_key', source, ['idempotency_key', 'idempotencyKey']);
  if (!Array.isArray(source.transactions) && !Array.isArray(source.items)) {
    issues.push(
      createValidationIssue(
        'missing_required_field',
        'Transaction batches require a transactions array.',
        {
          severity: 'blocked',
          field: 'transactions',
          actionId: action.id
        }
      )
    );
  }
  return action;
}

function normalizeRecurringItemAction(source, normalizedType) {
  const action = {
    type: normalizedType,
    name: asString(source.name || source.description || source.merchant),
    cadence:
      normalizeRecurringCadence(source.cadence || source.frequency || source.period) || 'unknown'
  };
  copyIfString(action, 'id', source, ['id', 'action_id', 'client_id']);
  if (Object.prototype.hasOwnProperty.call(source, 'amount')) {
    action.amount = normalizeAmount(source.amount);
  }
  action.currency = normalizeCurrency(source.currency);
  copyIfString(action, 'next_due_date', source, [
    'next_due_date',
    'nextDueDate',
    'anchor_date',
    'date'
  ]);
  copyIfString(action, 'payment_account_id', source, [
    'payment_account_id',
    'account_id',
    'primary_account_id'
  ]);
  copyIfString(action, 'payment_account_hint', source, [
    'payment_account_hint',
    'account_hint',
    'payment_account',
    'account'
  ]);
  copyIfString(action, 'category_id', source, ['category_id']);
  copyIfString(action, 'category_hint', source, ['category_hint', 'category', 'category_name']);
  copyIfString(action, 'merchant', source, ['merchant', 'payee']);
  const refs = asStringArray(
    source.source_transaction_refs ||
      source.sourceTransactionRefs ||
      source.source_transaction_ids ||
      source.transaction_ids,
    50
  );
  if (refs.length) action.source_transaction_refs = refs;
  const confidence = normalizeConfidence(source.confidence);
  if (confidence) action.confidence = confidence;
  const evidence = asStringArray(source.evidence || source.source_refs || source.sourceRefs, 20);
  if (evidence.length) action.evidence = evidence;
  if (
    Object.prototype.hasOwnProperty.call(source, 'requires_review') ||
    Object.prototype.hasOwnProperty.call(source, 'requiresReview')
  ) {
    action.requires_review = source.requires_review === true || source.requiresReview === true;
  }
  return action;
}

function normalizeCategoryChangeAction(source, normalizedType) {
  const match = asObject(source.transaction_match || source.transactionMatch);
  const action = {
    type: normalizedType,
    suggested_category_hint: asString(
      source.suggested_category_hint ||
        source.suggestedCategoryHint ||
        source.category_hint ||
        source.category
    )
  };
  copyIfString(action, 'id', source, ['id', 'action_id', 'client_id']);
  copyIfString(action, 'transaction_id', source, ['transaction_id', 'transactionId']);
  if (Object.keys(match).length) {
    action.transaction_match = {};
    copyIfString(action.transaction_match, 'date', match, ['date']);
    if (Object.prototype.hasOwnProperty.call(match, 'amount')) {
      action.transaction_match.amount = normalizeAmount(match.amount);
    }
    copyIfString(action.transaction_match, 'description', match, [
      'description',
      'merchant',
      'payee'
    ]);
  }
  copyIfString(action, 'current_category_hint', source, [
    'current_category_hint',
    'currentCategoryHint',
    'current_category'
  ]);
  copyIfString(action, 'suggested_category_id', source, [
    'suggested_category_id',
    'suggestedCategoryId',
    'category_id'
  ]);
  copyIfString(action, 'reason', source, ['reason', 'notes']);
  const confidence = normalizeConfidence(source.confidence);
  if (confidence) action.confidence = confidence;
  return action;
}

function normalizeBudgetChangeAction(source, normalizedType) {
  const action = {
    type: normalizedType,
    category_hint: asString(source.category_hint || source.categoryHint || source.category),
    amount: normalizeAmount(source.amount || source.planned || source.budget),
    period: normalizeBudgetPeriod(source.period) || 'monthly'
  };
  copyIfString(action, 'id', source, ['id', 'action_id', 'client_id']);
  copyIfString(action, 'category_id', source, ['category_id', 'categoryId']);
  action.currency = normalizeCurrency(source.currency);
  copyIfString(action, 'reason', source, ['reason', 'notes']);
  const confidence = normalizeConfidence(source.confidence);
  if (confidence) action.confidence = confidence;
  return action;
}

function normalizeAction(source, issues) {
  const actionSource = asObject(source);
  const rawType = actionSource.type || actionSource.action || actionSource.operation;
  const normalizedType = normalizeActionType(rawType);
  if (isDirectMutationActionType(rawType)) {
    const actionId = asString(actionSource.id || actionSource.action_id);
    issues.push(
      createValidationIssue(
        'unsafe_direct_mutation_claim',
        'External action plans cannot apply, post, delete, archive, or directly mutate workbook data.',
        { severity: 'blocked', field: 'type', actionId }
      )
    );
    return Object.assign({}, actionSource, {
      id: actionId || undefined,
      type: normalizedType || asString(rawType)
    });
  }
  if (!isSupportedActionType(normalizedType)) {
    const actionId = asString(actionSource.id || actionSource.action_id);
    issues.push(
      createValidationIssue(
        'unsupported_action_type',
        'Unsupported Cavalry action type: ' + asString(rawType || 'missing'),
        {
          severity: 'blocked',
          field: 'type',
          actionId
        }
      )
    );
    return Object.assign({}, actionSource, {
      id: actionId || undefined,
      type: normalizedType || asString(rawType)
    });
  }
  if (normalizedType === 'create_transaction')
    return normalizeCreateTransactionAction(actionSource, normalizedType);
  if (normalizedType === 'create_transaction_batch')
    return normalizeTransactionBatchAction(actionSource, normalizedType, issues);
  if (normalizedType === 'create_recurring_item')
    return normalizeRecurringItemAction(actionSource, normalizedType);
  if (normalizedType === 'update_category_assignment')
    return normalizeCategoryChangeAction(actionSource, normalizedType);
  return normalizeBudgetChangeAction(actionSource, normalizedType);
}

function getRawActions(source, issues) {
  if (Array.isArray(source.actions)) {
    return source.actions;
  }
  if (Array.isArray(source.transactions)) {
    return [
      {
        type: 'create_transaction_batch',
        transactions: source.transactions,
        idempotency_key: source.idempotency_key || source.idempotencyKey
      }
    ];
  }
  if (Array.isArray(source.items)) {
    return [
      {
        type: 'create_recurring_item_batch',
        items: source.items
      }
    ];
  }
  issues.push(
    createValidationIssue('missing_required_field', 'Action plan requires an actions array.', {
      severity: 'blocked',
      field: 'actions'
    })
  );
  return [];
}

export function normalizeCavalryActionPlan(value, options = {}) {
  const source = asObject(value);
  const issues = [];
  const normalizedSource = asString(source.source || options.source || 'unknown').toLowerCase();
  const plan = {
    cavalry_action_plan_version: asString(
      source.cavalry_action_plan_version || source.version || CAVALRY_ACTION_PLAN_VERSION
    ),
    source: CAVALRY_ACTION_PLAN_SOURCES.includes(normalizedSource) ? normalizedSource : 'unknown',
    generated_at: asString(source.generated_at || source.generatedAt),
    workbook_id: asString(source.workbook_id || source.workbookId),
    workbook_name: asString(source.workbook_name || source.workbookName),
    timezone: asString(source.timezone || options.timezone),
    currency_default: normalizeCurrency(
      source.currency_default ||
        source.currencyDefault ||
        source.default_currency ||
        options.currencyDefault
    ),
    date_default: asString(source.date_default || source.dateDefault || options.dateDefault),
    user_goal: asString(source.user_goal || source.userGoal || source.goal),
    assumptions: asStringArray(source.assumptions, 20),
    actions: []
  };
  plan.actions = getRawActions(source, issues).map((action) => normalizeAction(action, issues));
  Object.keys(plan).forEach((key) => {
    if (
      (plan[key] === '' || (Array.isArray(plan[key]) && !plan[key].length)) &&
      key !== 'actions'
    ) {
      delete plan[key];
    }
  });
  return {
    plan,
    issues: uniqueIssues(issues)
  };
}
