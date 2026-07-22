import {
  CAVALRY_ACTION_DIRECTIONS,
  CAVALRY_ACTION_PLAN_VERSION,
  CAVALRY_ACTION_TYPES,
  CAVALRY_BUDGET_PERIODS,
  CAVALRY_CONFIDENCE_LEVELS,
  CAVALRY_RECURRING_CADENCES,
  isDirectMutationActionType,
  isSupportedActionPlanVersion,
  isSupportedActionType
} from './schema.js';
import { createValidationIssue, uniqueIssues } from './issues.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function isPlainObject(value) {
  return !!(value && typeof value === 'object' && !Array.isArray(value));
}

export function isValidActionPlanDate(value) {
  const raw = asString(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function addMissing(issues, field, action, message) {
  issues.push(
    createValidationIssue('missing_required_field', message || field + ' is required.', {
      severity: 'blocked',
      field,
      actionId: action && action.id
    })
  );
}

function addInvalidEnum(issues, field, action, value, allowed) {
  issues.push(
    createValidationIssue(
      'invalid_schema',
      field + ' must be one of: ' + allowed.join(', ') + '.',
      {
        severity: 'blocked',
        field,
        actionId: action && action.id,
        suggestedFix: value ? 'Use a supported value instead of "' + value + '".' : ''
      }
    )
  );
}

function validateCurrency(currency, issues, action, options = {}) {
  const normalized = asString(currency).toUpperCase();
  if (!normalized) {
    return;
  }
  const supported = Array.isArray(options.supportedCurrencies)
    ? options.supportedCurrencies.map((item) => asString(item).toUpperCase()).filter(Boolean)
    : [];
  if (supported.length && !supported.includes(normalized)) {
    issues.push(
      createValidationIssue(
        'unsupported_currency',
        'Currency is not supported by this workbook: ' + normalized,
        {
          severity: 'error',
          field: 'currency',
          actionId: action && action.id
        }
      )
    );
  }
}

function validateTransactionAction(action, issues, options, parentPlan) {
  if (!asString(action.description)) {
    addMissing(issues, 'description', action, 'Transaction description is required.');
  }
  if (!(Number(action.amount) > 0)) {
    issues.push(
      createValidationIssue('invalid_amount', 'Transaction amount must be positive.', {
        severity: 'blocked',
        field: 'amount',
        actionId: action && action.id
      })
    );
  }
  if (!CAVALRY_ACTION_DIRECTIONS.includes(asString(action.direction))) {
    addInvalidEnum(issues, 'direction', action, action.direction, CAVALRY_ACTION_DIRECTIONS);
  }
  const date = asString(action.date || parentPlan.date_default);
  if (!date) {
    addMissing(
      issues,
      'date',
      action,
      'Transaction date is required or date_default must be provided.'
    );
  } else if (!isValidActionPlanDate(date)) {
    issues.push(
      createValidationIssue('invalid_date', 'Transaction date must be a valid YYYY-MM-DD date.', {
        severity: 'error',
        field: action.date ? 'date' : 'date_default',
        actionId: action && action.id
      })
    );
  }
  const currency = asString(action.currency || parentPlan.currency_default);
  if (!currency) {
    addMissing(
      issues,
      'currency',
      action,
      'Transaction currency is required or currency_default must be provided.'
    );
  } else {
    validateCurrency(currency, issues, action, options);
  }
  if (action.confidence && !CAVALRY_CONFIDENCE_LEVELS.includes(asString(action.confidence))) {
    addInvalidEnum(issues, 'confidence', action, action.confidence, CAVALRY_CONFIDENCE_LEVELS);
  }
}

function validateTransactionBatchAction(action, issues, options, parentPlan) {
  if (!Array.isArray(action.transactions) || !action.transactions.length) {
    addMissing(
      issues,
      'transactions',
      action,
      'Transaction batch requires at least one transaction.'
    );
    return;
  }
  action.transactions.forEach((transaction, index) => {
    validateTransactionAction(
      Object.assign({ id: action.id ? action.id + ':' + String(index + 1) : '' }, transaction),
      issues,
      options,
      parentPlan
    );
  });
}

function validateRecurringItemAction(action, issues, options, parentPlan) {
  if (!asString(action.name)) {
    addMissing(issues, 'name', action, 'Recurring item name is required.');
  }
  if (Object.prototype.hasOwnProperty.call(action, 'amount') && !(Number(action.amount) >= 0)) {
    issues.push(
      createValidationIssue(
        'invalid_amount',
        'Recurring item amount must be zero or positive when provided.',
        {
          severity: 'blocked',
          field: 'amount',
          actionId: action && action.id
        }
      )
    );
  }
  if (action.currency || parentPlan.currency_default) {
    validateCurrency(action.currency || parentPlan.currency_default, issues, action, options);
  }
  if (action.next_due_date && !isValidActionPlanDate(action.next_due_date)) {
    issues.push(
      createValidationIssue(
        'invalid_date',
        'Recurring item next_due_date must be a valid YYYY-MM-DD date.',
        {
          severity: 'error',
          field: 'next_due_date',
          actionId: action && action.id
        }
      )
    );
  }
  if (action.cadence && !CAVALRY_RECURRING_CADENCES.includes(asString(action.cadence))) {
    addInvalidEnum(issues, 'cadence', action, action.cadence, CAVALRY_RECURRING_CADENCES);
  }
  if (action.confidence && !CAVALRY_CONFIDENCE_LEVELS.includes(asString(action.confidence))) {
    addInvalidEnum(issues, 'confidence', action, action.confidence, CAVALRY_CONFIDENCE_LEVELS);
  }
}

function validateCategoryChangeAction(action, issues) {
  if (!asString(action.transaction_id) && !isPlainObject(action.transaction_match)) {
    addMissing(
      issues,
      'transaction_id',
      action,
      'Category changes require transaction_id or transaction_match.'
    );
  }
  if (
    isPlainObject(action.transaction_match) &&
    action.transaction_match.date &&
    !isValidActionPlanDate(action.transaction_match.date)
  ) {
    issues.push(
      createValidationIssue(
        'invalid_date',
        'transaction_match.date must be a valid YYYY-MM-DD date.',
        {
          severity: 'error',
          field: 'transaction_match.date',
          actionId: action && action.id
        }
      )
    );
  }
  if (!asString(action.suggested_category_id) && !asString(action.suggested_category_hint)) {
    addMissing(
      issues,
      'suggested_category_hint',
      action,
      'Category changes require a suggested category ID or hint.'
    );
  }
  if (action.confidence && !CAVALRY_CONFIDENCE_LEVELS.includes(asString(action.confidence))) {
    addInvalidEnum(issues, 'confidence', action, action.confidence, CAVALRY_CONFIDENCE_LEVELS);
  }
}

function validateBudgetChangeAction(action, issues, options, parentPlan) {
  if (!asString(action.category_id) && !asString(action.category_hint)) {
    addMissing(issues, 'category_hint', action, 'Budget changes require a category ID or hint.');
  }
  if (!(Number(action.amount) > 0)) {
    issues.push(
      createValidationIssue('invalid_amount', 'Budget amount must be positive.', {
        severity: 'blocked',
        field: 'amount',
        actionId: action && action.id
      })
    );
  }
  if (action.period && !CAVALRY_BUDGET_PERIODS.includes(asString(action.period))) {
    addInvalidEnum(issues, 'period', action, action.period, CAVALRY_BUDGET_PERIODS);
  }
  if (action.currency || parentPlan.currency_default) {
    validateCurrency(action.currency || parentPlan.currency_default, issues, action, options);
  }
  if (action.confidence && !CAVALRY_CONFIDENCE_LEVELS.includes(asString(action.confidence))) {
    addInvalidEnum(issues, 'confidence', action, action.confidence, CAVALRY_CONFIDENCE_LEVELS);
  }
}

export function validateCavalryActionPlan(plan, options = {}) {
  const source = isPlainObject(plan) ? plan : {};
  const issues = [];
  if (!isSupportedActionPlanVersion(source.cavalry_action_plan_version)) {
    issues.push(
      createValidationIssue(
        'invalid_schema',
        'Unsupported CavalryActionPlan version. Expected ' + CAVALRY_ACTION_PLAN_VERSION + '.',
        {
          severity: 'blocked',
          field: 'cavalry_action_plan_version'
        }
      )
    );
  }
  const expectedWorkbookId = asString(options.workbookId || options.workbook_id);
  if (
    expectedWorkbookId &&
    source.workbook_id &&
    asString(source.workbook_id) !== expectedWorkbookId
  ) {
    issues.push(
      createValidationIssue('workbook_mismatch', 'Action plan targets a different workbook.', {
        severity: 'blocked',
        field: 'workbook_id'
      })
    );
  }
  if (source.date_default && !isValidActionPlanDate(source.date_default)) {
    issues.push(
      createValidationIssue('invalid_date', 'date_default must be a valid YYYY-MM-DD date.', {
        severity: 'error',
        field: 'date_default'
      })
    );
  }
  if (source.currency_default) {
    validateCurrency(source.currency_default, issues, null, options);
  }
  if (!Array.isArray(source.actions)) {
    issues.push(
      createValidationIssue('missing_required_field', 'Action plan requires an actions array.', {
        severity: 'blocked',
        field: 'actions'
      })
    );
    return {
      ok: false,
      issues: uniqueIssues(issues)
    };
  }
  if (!source.actions.length) {
    issues.push(
      createValidationIssue(
        'missing_required_field',
        'Action plan must contain at least one action.',
        {
          severity: 'blocked',
          field: 'actions'
        }
      )
    );
  }
  if (source.actions.length > (Number(options.maxActions) || 100)) {
    issues.push(
      createValidationIssue('invalid_schema', 'Action plan contains too many actions.', {
        severity: 'blocked',
        field: 'actions'
      })
    );
  }
  source.actions.forEach((action) => {
    const type = asString(action && action.type);
    if (isDirectMutationActionType(type)) {
      issues.push(
        createValidationIssue(
          'unsafe_direct_mutation_claim',
          'Direct workbook mutation actions are not supported externally.',
          {
            severity: 'blocked',
            field: 'type',
            actionId: action && action.id
          }
        )
      );
      return;
    }
    if (!isSupportedActionType(type)) {
      issues.push(
        createValidationIssue(
          'unsupported_action_type',
          'Unsupported Cavalry action type: ' + (type || 'missing') + '.',
          {
            severity: 'blocked',
            field: 'type',
            actionId: action && action.id
          }
        )
      );
      return;
    }
    if (!CAVALRY_ACTION_TYPES.includes(type)) {
      return;
    }
    if (type === 'create_transaction') validateTransactionAction(action, issues, options, source);
    if (type === 'create_transaction_batch')
      validateTransactionBatchAction(action, issues, options, source);
    if (type === 'create_recurring_item')
      validateRecurringItemAction(action, issues, options, source);
    if (type === 'update_category_assignment')
      validateCategoryChangeAction(action, issues, options, source);
    if (type === 'update_budget') validateBudgetChangeAction(action, issues, options, source);
  });
  const unique = uniqueIssues(issues);
  return {
    ok: unique.every((issue) => issue.severity !== 'blocked'),
    issues: unique
  };
}
