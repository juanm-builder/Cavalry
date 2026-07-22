import { roundMoney } from '@cavalry/finance-core/domain/money.js';
import { createValidationIssue, uniqueIssues } from '../../domain/cavalry-action-plan/issues.js';
import { parseCavalryActionPlan } from '../../domain/cavalry-action-plan/parse.js';
import { isValidActionPlanDate } from '../../domain/cavalry-action-plan/validate.js';
import { buildCheckpointDiff } from '../../domain/checkpoints/diff.js';
import { buildInversePatch } from '../../domain/checkpoints/inverse-patch.js';
import {
  fingerprintEntity,
  fingerprintWorkbookCore,
  stableStringify
} from '../../domain/checkpoints/entity-fingerprint.js';
import { summarizeCheckpointChanges } from '../../domain/checkpoints/schema.js';
import { createCheckpoint } from '../checkpoints/checkpoint-service.js';
import { createWorkbookCheckpointStore } from '../checkpoints/checkpoint-store.js';
import { appendCheckpointAuditEvent } from '../checkpoints/checkpoint-audit.js';
import { findTransactionDuplicateCandidates } from '../drafts/duplicate-detection.js';
import { matchAccount, matchCategory } from '../drafts/external-draft-service.js';
import { classifyCheckpointedAction, normalizeCheckpointedActionType } from './blocked-actions.js';

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

function getNow(now) {
  return typeof now === 'function' ? now() : new Date().toISOString();
}

function createFallbackId(prefix) {
  return String(prefix || 'id') + '_' + Math.random().toString(36).slice(2, 10);
}

function actionId(action, index) {
  return asString(action && (action.id || action.action_id)) || 'action_' + String(index + 1);
}

function normalizeCurrency(value, fallback = 'PHP') {
  return asString(value || fallback).toUpperCase();
}

function normalizeDirection(value) {
  const direction = asString(value || 'expense').toLowerCase();
  return ['expense', 'income', 'transfer', 'refund'].includes(direction) ? direction : 'expense';
}

function transactionTemplate(direction, account) {
  if (direction === 'income') return 'income_received';
  if (direction === 'transfer') return 'transfer';
  return account && account.group === 'liability' ? 'expense_charged' : 'expense_paid';
}

function monthKeyFromDate(date) {
  return asString(date).slice(0, 7);
}

function findAccountByHint(workbook, hint) {
  const target = asString(hint).toLowerCase();
  if (!target) return null;
  return (
    (workbook.accounts || []).find(
      (item) =>
        asString(item.id).toLowerCase() === target || asString(item.name).toLowerCase() === target
    ) || null
  );
}

function createPostingLine(createId, accountId, direction, amount, currency, note) {
  const uid = typeof createId === 'function' ? createId : createFallbackId;
  return {
    id: uid('line'),
    accountId,
    direction,
    amount: roundMoney(amount),
    currency,
    baseAmount: roundMoney(amount),
    note
  };
}

function buildTransactionPostingLines({
  workbook,
  action,
  account,
  category,
  direction,
  amount,
  currency,
  createId
}) {
  const lines = [];
  const categoryAccountId =
    asString(category && category.linkedAccountId) || asString(category && category.id);
  if (direction === 'income') {
    if (account)
      lines.push(
        createPostingLine(createId, account.id, 'debit', amount, currency, 'Income received')
      );
    if (categoryAccountId)
      lines.push(
        createPostingLine(
          createId,
          categoryAccountId,
          'credit',
          amount,
          currency,
          'Income category'
        )
      );
    return lines;
  }
  if (direction === 'transfer') {
    const destinationHint =
      action.destination_account_id ||
      action.destination_account_hint ||
      action.to_account_id ||
      action.to_account_hint ||
      action.secondary_account_id ||
      action.secondary_account_hint;
    const destination = findAccountByHint(workbook, destinationHint);
    if (account)
      lines.push(
        createPostingLine(createId, account.id, 'credit', amount, currency, 'Transfer source')
      );
    if (destination)
      lines.push(
        createPostingLine(
          createId,
          destination.id,
          'debit',
          amount,
          currency,
          'Transfer destination'
        )
      );
    return lines;
  }
  if (categoryAccountId)
    lines.push(
      createPostingLine(createId, categoryAccountId, 'debit', amount, currency, 'Expense category')
    );
  if (account)
    lines.push(
      createPostingLine(
        createId,
        account.id,
        'credit',
        amount,
        currency,
        account.group === 'liability' ? 'Liability charge' : 'Payment account'
      )
    );
  return lines;
}

function findTransaction(workbook, action = {}) {
  const id = asString(
    action.transaction_id || action.transactionId || action.target_id || action.targetId
  );
  if (id) {
    return (
      (workbook.transactions || []).find((transaction) => asString(transaction.id) === id) || null
    );
  }
  const match = action.transaction_match || action.transactionMatch || {};
  const candidates = (workbook.transactions || []).filter((transaction) => {
    if (match.date && asString(transaction.date) !== asString(match.date)) return false;
    if (Number(match.amount) > 0 && roundMoney(transaction.amount) !== roundMoney(match.amount))
      return false;
    if (
      match.description &&
      !asString(transaction.description)
        .toLowerCase()
        .includes(asString(match.description).toLowerCase())
    )
      return false;
    return true;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function findRecurringItem(workbook, action = {}) {
  const id = asString(
    action.recurring_item_id || action.recurringItemId || action.target_id || action.targetId
  );
  if (id) {
    return (workbook.recurringItems || []).find((item) => asString(item.id) === id) || null;
  }
  const name = asString(action.name || action.merchant);
  return name
    ? (workbook.recurringItems || []).find(
        (item) => asString(item.name).toLowerCase() === name.toLowerCase()
      ) || null
    : null;
}

function findCategory(workbook, idOrHint) {
  const raw = asString(idOrHint).toLowerCase();
  if (!raw) return null;
  return (
    (workbook.categories || []).find(
      (category) =>
        asString(category.id).toLowerCase() === raw || asString(category.name).toLowerCase() === raw
    ) || null
  );
}

function getBudgetList(workbook) {
  workbook.sheets =
    Array.isArray(workbook.sheets) && workbook.sheets.length
      ? workbook.sheets
      : [{ id: 'sheet_default', budgets: [] }];
  workbook.sheets[0].budgets = Array.isArray(workbook.sheets[0].budgets)
    ? workbook.sheets[0].budgets
    : [];
  return workbook.sheets[0].budgets;
}

function findBudget(workbook, categoryId) {
  return (
    getBudgetList(workbook).find(
      (budget) => asString(budget.categoryId || budget.category_id) === asString(categoryId)
    ) || null
  );
}

function getPlanActions(actionPlan, options = {}) {
  const source = actionPlan && typeof actionPlan === 'object' ? clonePlain(actionPlan) : {};
  if (Array.isArray(source.actions)) {
    return source.actions;
  }
  if (Array.isArray(source.transactions)) {
    return [
      {
        type: 'create_transaction_batch',
        transactions: source.transactions,
        id: source.id || source.action_id
      }
    ];
  }
  if (Array.isArray(source.items)) {
    return source.items.map((item) => Object.assign({ type: 'create_recurring_item' }, item));
  }
  return options.emptyOk ? [] : [];
}

function blockedChange({ action, actionType, code, message, createId, index }) {
  const uid = typeof createId === 'function' ? createId : createFallbackId;
  const issue = createValidationIssue(code, message, {
    severity: 'blocked',
    field: 'type',
    actionId: actionId(action, index)
  });
  return {
    change_id: uid('chg'),
    action_id: actionId(action, index),
    action_type: actionType,
    entity_type: 'draft_group',
    entity_id: actionId(action, index),
    operation: 'update',
    before: null,
    after: null,
    before_fingerprint: null,
    after_fingerprint: null,
    inverse_patch: { type: 'unsupported_rollback' },
    status: 'blocked',
    validation_issues: [issue],
    warnings: [],
    human_summary: message
  };
}

function makeChange({
  workbook,
  action,
  actionType,
  entityType,
  entityId,
  operation,
  before,
  after,
  validationIssues = [],
  warnings = [],
  humanSummary,
  createId,
  index
}) {
  const uid = typeof createId === 'function' ? createId : createFallbackId;
  const diff = buildCheckpointDiff(before, after);
  return {
    change_id: uid('chg'),
    action_id: actionId(action, index),
    action_type: actionType,
    entity_type: entityType,
    entity_id: entityId,
    operation,
    before: diff.before,
    after: diff.after,
    before_fingerprint: diff.before_fingerprint,
    after_fingerprint: diff.after_fingerprint,
    inverse_patch: buildInversePatch({
      operation,
      entityType,
      entityId,
      before: diff.before,
      after: diff.after
    }),
    status: validationIssues.some((issue) => issue.severity === 'blocked') ? 'blocked' : 'applied',
    validation_issues: uniqueIssues(validationIssues),
    warnings: uniqueIssues(warnings),
    human_summary: humanSummary || operation + ' ' + entityType + ' ' + entityId,
    workbook_fingerprint_after_change: fingerprintWorkbookCore(workbook)
  };
}

function applyCreateTransaction({ workbook, action, actionType, plan, createId, index }) {
  const issues = [];
  const warnings = [];
  const uid = typeof createId === 'function' ? createId : createFallbackId;
  const date = asString(action.date || plan.date_default);
  const amount = roundMoney(action.amount);
  const currency = normalizeCurrency(
    action.currency || plan.currency_default || workbook.currency,
    workbook.currency
  );
  const direction = normalizeDirection(action.direction);
  if (!asString(action.description))
    issues.push(
      createValidationIssue('missing_required_field', 'Transaction description is required.', {
        severity: 'blocked',
        field: 'description',
        actionId: actionId(action, index)
      })
    );
  if (!(amount > 0))
    issues.push(
      createValidationIssue('invalid_amount', 'Transaction amount must be positive.', {
        severity: 'blocked',
        field: 'amount',
        actionId: actionId(action, index)
      })
    );
  if (!date || !isValidActionPlanDate(date))
    issues.push(
      createValidationIssue(
        'invalid_date',
        'Transaction needs a valid date before checkpointed apply.',
        {
          severity: 'blocked',
          field: action.date ? 'date' : 'date_default',
          actionId: actionId(action, index)
        }
      )
    );
  const accountMatch = matchAccount(workbook, {
    action_id: actionId(action, index),
    direction,
    payment_account_id: action.payment_account_id,
    payment_account_hint: action.payment_account_hint || action.account_hint || action.account
  });
  if (accountMatch.status !== 'matched')
    issues.push(Object.assign({}, accountMatch.issue, { severity: 'blocked' }));
  const categoryMatch = matchCategory(workbook, {
    action_id: actionId(action, index),
    direction,
    category_id: action.category_id,
    category_hint: action.category_hint || action.category
  });
  if (categoryMatch.status !== 'matched' && direction !== 'transfer')
    issues.push(Object.assign({}, categoryMatch.issue, { severity: 'blocked' }));
  const duplicateCandidates = findTransactionDuplicateCandidates(workbook, {
    date,
    description: action.description,
    amount,
    currency,
    payment_account_id: accountMatch.value && accountMatch.value.id
  });
  if (duplicateCandidates.length) {
    warnings.push(
      createValidationIssue(
        'possible_duplicate',
        'This looks similar to an existing transaction.',
        { severity: 'warning', field: 'amount', actionId: actionId(action, index) }
      )
    );
  }
  const account = accountMatch.value || null;
  const category = categoryMatch.value || null;
  const destinationHint =
    action.destination_account_id ||
    action.destination_account_hint ||
    action.to_account_id ||
    action.to_account_hint ||
    action.secondary_account_id ||
    action.secondary_account_hint;
  if (direction === 'transfer' && !findAccountByHint(workbook, destinationHint)) {
    issues.push(
      createValidationIssue(
        'external_ref_not_found',
        'Transfer destination account target was not found.',
        { severity: 'blocked', field: 'destination_account_id', actionId: actionId(action, index) }
      )
    );
  }
  const transaction = {
    id: uid('txn'),
    date,
    monthKey: monthKeyFromDate(date),
    template: transactionTemplate(direction, account),
    description: asString(action.description),
    merchant: asString(action.merchant),
    amount,
    originalCurrency: currency,
    currency,
    baseAmount: amount,
    fxRateToBase: 0,
    direction,
    categoryId: category ? category.id : '',
    primaryAccountId: account ? account.id : '',
    note: asString(action.notes || action.note),
    source: 'checkpointed_ai_action',
    reference: 'checkpointed:' + actionId(action, index),
    lines: buildTransactionPostingLines({
      workbook,
      action,
      account,
      category,
      direction,
      amount,
      currency,
      createId
    })
  };
  if (!issues.some((issue) => issue.severity === 'blocked')) {
    workbook.transactions = Array.isArray(workbook.transactions) ? workbook.transactions : [];
    workbook.transactions.push(transaction);
  }
  return makeChange({
    workbook,
    action,
    actionType,
    entityType: 'transaction',
    entityId: transaction.id,
    operation: 'create',
    before: null,
    after: transaction,
    validationIssues: issues,
    warnings,
    humanSummary:
      'Created transaction: ' +
      currency +
      ' ' +
      amount.toFixed(2) +
      ' - ' +
      transaction.description,
    createId,
    index
  });
}

function applyUpdateTransaction({
  workbook,
  action,
  actionType,
  plan,
  createId,
  index,
  operation
}) {
  const transaction = findTransaction(workbook, action);
  const issues = [];
  if (!transaction)
    issues.push(
      createValidationIssue('external_ref_not_found', 'Transaction target was not found.', {
        severity: 'blocked',
        field: 'transaction_id',
        actionId: actionId(action, index)
      })
    );
  const before = transaction ? clonePlain(transaction) : null;
  const after = transaction ? clonePlain(transaction) : null;
  if (after && operation === 'archive') {
    after.isArchived = true;
    after.isActive = false;
    after.archivedAt = getNow();
  } else if (after && operation === 'restore') {
    after.isArchived = false;
    after.isActive = true;
    delete after.archivedAt;
  } else if (after) {
    if (action.date) after.date = asString(action.date);
    if (Object.prototype.hasOwnProperty.call(action, 'amount'))
      after.amount = roundMoney(action.amount);
    if (action.currency)
      after.originalCurrency = normalizeCurrency(
        action.currency,
        plan.currency_default || workbook.currency
      );
    if (action.description) after.description = asString(action.description);
    if (
      Object.prototype.hasOwnProperty.call(action, 'notes') ||
      Object.prototype.hasOwnProperty.call(action, 'note')
    )
      after.note = asString(action.notes || action.note);
    const categoryHint =
      action.category_id ||
      action.category_hint ||
      action.suggested_category_id ||
      action.suggested_category_hint;
    if (categoryHint) {
      const category = findCategory(workbook, categoryHint);
      if (category) after.categoryId = category.id;
      else
        issues.push(
          createValidationIssue('external_ref_not_found', 'Category target was not found.', {
            severity: 'blocked',
            field: 'category_id',
            actionId: actionId(action, index)
          })
        );
    }
    const accountHint =
      action.payment_account_id ||
      action.payment_account_hint ||
      action.account_id ||
      action.account_hint;
    if (accountHint) {
      const account =
        (workbook.accounts || []).find(
          (item) =>
            asString(item.id).toLowerCase() === asString(accountHint).toLowerCase() ||
            asString(item.name).toLowerCase() === asString(accountHint).toLowerCase()
        ) || null;
      if (account) after.primaryAccountId = account.id;
      else
        issues.push(
          createValidationIssue('external_ref_not_found', 'Payment account target was not found.', {
            severity: 'blocked',
            field: 'payment_account_id',
            actionId: actionId(action, index)
          })
        );
    }
    if (after.date && !isValidActionPlanDate(after.date))
      issues.push(
        createValidationIssue('invalid_date', 'Transaction date is invalid.', {
          severity: 'blocked',
          field: 'date',
          actionId: actionId(action, index)
        })
      );
    if (!(Number(after.amount) > 0))
      issues.push(
        createValidationIssue('invalid_amount', 'Transaction amount must be positive.', {
          severity: 'blocked',
          field: 'amount',
          actionId: actionId(action, index)
        })
      );
  }
  if (transaction && !issues.some((issue) => issue.severity === 'blocked')) {
    Object.assign(transaction, after);
  }
  return makeChange({
    workbook,
    action,
    actionType,
    entityType: 'transaction',
    entityId: transaction ? transaction.id : actionId(action, index),
    operation,
    before,
    after,
    validationIssues: issues,
    humanSummary:
      operation === 'update'
        ? 'Updated transaction: ' + ((after && after.description) || '')
        : operation + ' transaction: ' + ((after && after.description) || actionId(action, index)),
    createId,
    index
  });
}

function applyCreateRecurringItem({ workbook, action, actionType, plan, createId, index }) {
  const issues = [];
  const warnings = [];
  const uid = typeof createId === 'function' ? createId : createFallbackId;
  if (!asString(action.name))
    issues.push(
      createValidationIssue('missing_required_field', 'Recurring item name is required.', {
        severity: 'blocked',
        field: 'name',
        actionId: actionId(action, index)
      })
    );
  const key = [action.name, action.category_hint, action.category_id]
    .map(asString)
    .join(' ')
    .toLowerCase();
  if (
    /\b(load|top up|topup|rfid|prepaid|airtime|fare|toll|usage)\b/.test(key) ||
    action.confidence === 'low'
  ) {
    warnings.push(
      createValidationIssue(
        'ambiguous_recurring_candidate',
        'This recurring item may be a top-up, load, RFID, or low-confidence candidate.',
        { severity: 'warning', field: 'name', actionId: actionId(action, index) }
      )
    );
  }
  const category =
    action.category_id || action.category_hint
      ? findCategory(workbook, action.category_id || action.category_hint)
      : null;
  const account =
    action.payment_account_id || action.payment_account_hint
      ? (workbook.accounts || []).find(
          (item) =>
            asString(item.id).toLowerCase() ===
              asString(action.payment_account_id || action.payment_account_hint).toLowerCase() ||
            asString(item.name).toLowerCase() ===
              asString(action.payment_account_hint).toLowerCase()
        ) || null
      : null;
  const item = {
    id: uid('recurring'),
    name: asString(action.name),
    amount: roundMoney(action.amount || 0),
    currency: normalizeCurrency(
      action.currency || plan.currency_default || workbook.currency,
      workbook.currency
    ),
    cadence: asString(action.cadence || action.frequency || 'unknown') || 'unknown',
    frequency: asString(action.cadence || action.frequency || 'unknown') || 'unknown',
    nextDueDate: asString(action.next_due_date || action.nextDueDate || plan.date_default),
    anchorDate: asString(action.next_due_date || action.nextDueDate || plan.date_default),
    accountId: account ? account.id : '',
    categoryId: category ? category.id : '',
    merchant: asString(action.merchant),
    isActive: true,
    source: 'checkpointed_ai_action',
    reference: 'checkpointed:' + actionId(action, index)
  };
  if (!issues.some((issue) => issue.severity === 'blocked')) {
    workbook.recurringItems = Array.isArray(workbook.recurringItems) ? workbook.recurringItems : [];
    workbook.recurringItems.push(item);
  }
  return makeChange({
    workbook,
    action,
    actionType,
    entityType: 'recurring_item',
    entityId: item.id,
    operation: 'create',
    before: null,
    after: item,
    validationIssues: issues,
    warnings,
    humanSummary: 'Created recurring item: ' + item.name,
    createId,
    index
  });
}

function applyUpdateRecurringItem({ workbook, action, actionType, createId, index, operation }) {
  const item = findRecurringItem(workbook, action);
  const issues = [];
  if (!item)
    issues.push(
      createValidationIssue('external_ref_not_found', 'Recurring item target was not found.', {
        severity: 'blocked',
        field: 'recurring_item_id',
        actionId: actionId(action, index)
      })
    );
  const before = item ? clonePlain(item) : null;
  const after = item ? clonePlain(item) : null;
  if (after && operation === 'archive') {
    after.isActive = false;
    after.isArchived = true;
  } else if (after && operation === 'restore') {
    after.isActive = true;
    after.isArchived = false;
  } else if (after) {
    if (action.name) after.name = asString(action.name);
    if (Object.prototype.hasOwnProperty.call(action, 'amount'))
      after.amount = roundMoney(action.amount);
    if (action.cadence || action.frequency) {
      after.cadence = asString(action.cadence || action.frequency);
      after.frequency = after.cadence;
    }
  }
  if (item && !issues.some((issue) => issue.severity === 'blocked')) Object.assign(item, after);
  return makeChange({
    workbook,
    action,
    actionType,
    entityType: 'recurring_item',
    entityId: item ? item.id : actionId(action, index),
    operation,
    before,
    after,
    validationIssues: issues,
    humanSummary:
      operation + ' recurring item: ' + ((after && after.name) || actionId(action, index)),
    createId,
    index
  });
}

function applyCategoryAction({ workbook, action, actionType, createId, index, operation }) {
  const uid = typeof createId === 'function' ? createId : createFallbackId;
  const issues = [];
  if (operation === 'create') {
    if (!asString(action.name || action.category_name || action.category_hint))
      issues.push(
        createValidationIssue('missing_required_field', 'Category name is required.', {
          severity: 'blocked',
          field: 'name',
          actionId: actionId(action, index)
        })
      );
    const category = {
      id: asString(action.category_id) || uid('cat'),
      name: asString(action.name || action.category_name || action.category_hint),
      type: asString(action.category_type || action.type_hint || 'expense') || 'expense',
      isActive: true,
      source: 'checkpointed_ai_action'
    };
    if (!issues.some((issue) => issue.severity === 'blocked')) {
      workbook.categories = Array.isArray(workbook.categories) ? workbook.categories : [];
      workbook.categories.push(category);
    }
    return makeChange({
      workbook,
      action,
      actionType,
      entityType: 'category',
      entityId: category.id,
      operation: 'create',
      before: null,
      after: category,
      validationIssues: issues,
      humanSummary: 'Created category: ' + category.name,
      createId,
      index
    });
  }
  if (operation === 'update') {
    const transaction = findTransaction(workbook, action);
    const category = findCategory(
      workbook,
      action.suggested_category_id ||
        action.suggested_category_hint ||
        action.category_id ||
        action.category_hint
    );
    if (!transaction)
      issues.push(
        createValidationIssue('external_ref_not_found', 'Transaction target was not found.', {
          severity: 'blocked',
          field: 'transaction_id',
          actionId: actionId(action, index)
        })
      );
    if (!category)
      issues.push(
        createValidationIssue('external_ref_not_found', 'Category target was not found.', {
          severity: 'blocked',
          field: 'suggested_category_id',
          actionId: actionId(action, index)
        })
      );
    const before = transaction ? clonePlain(transaction) : null;
    const after = transaction
      ? Object.assign(clonePlain(transaction), {
          categoryId: category ? category.id : transaction.categoryId
        })
      : null;
    if (transaction && !issues.some((issue) => issue.severity === 'blocked'))
      Object.assign(transaction, after);
    return makeChange({
      workbook,
      action,
      actionType,
      entityType: 'transaction',
      entityId: transaction ? transaction.id : actionId(action, index),
      operation: 'update',
      before,
      after,
      validationIssues: issues,
      humanSummary: 'Updated transaction category to ' + (category ? category.name : 'unknown'),
      createId,
      index
    });
  }
  const category = findCategory(
    workbook,
    action.category_id || action.category_hint || action.target_id || action.old_name
  );
  if (!category)
    issues.push(
      createValidationIssue('external_ref_not_found', 'Category target was not found.', {
        severity: 'blocked',
        field: 'category_id',
        actionId: actionId(action, index)
      })
    );
  const before = category ? clonePlain(category) : null;
  const after = category
    ? Object.assign(clonePlain(category), {
        name: asString(action.new_name || action.name || action.category_name) || category.name
      })
    : null;
  if (category && !issues.some((issue) => issue.severity === 'blocked'))
    Object.assign(category, after);
  return makeChange({
    workbook,
    action,
    actionType,
    entityType: 'category',
    entityId: category ? category.id : actionId(action, index),
    operation: 'update',
    before,
    after,
    validationIssues: issues,
    humanSummary: 'Renamed category to ' + ((after && after.name) || ''),
    createId,
    index
  });
}

function applyBudgetAction({ workbook, action, actionType, createId, index, operation }) {
  const issues = [];
  const category = findCategory(
    workbook,
    action.category_id || action.category_hint || action.category
  );
  if (!category)
    issues.push(
      createValidationIssue('external_ref_not_found', 'Budget category target was not found.', {
        severity: 'blocked',
        field: 'category_id',
        actionId: actionId(action, index)
      })
    );
  if (operation !== 'archive' && !(Number(action.amount || action.planned || action.budget) > 0))
    issues.push(
      createValidationIssue('invalid_amount', 'Budget amount must be positive.', {
        severity: 'blocked',
        field: 'amount',
        actionId: actionId(action, index)
      })
    );
  const budgets = getBudgetList(workbook);
  const existing = category ? findBudget(workbook, category.id) : null;
  const before = existing ? clonePlain(existing) : null;
  const after =
    category && operation !== 'archive'
      ? Object.assign(clonePlain(existing || {}), {
          categoryId: category.id,
          planned: roundMoney(action.amount || action.planned || action.budget),
          period: asString(action.period || 'monthly') || 'monthly'
        })
      : null;
  if (!issues.some((issue) => issue.severity === 'blocked') && category) {
    const indexExisting = budgets.findIndex(
      (budget) => asString(budget.categoryId || budget.category_id) === category.id
    );
    if (operation === 'archive') {
      if (indexExisting >= 0) budgets.splice(indexExisting, 1);
    } else if (indexExisting >= 0) {
      budgets[indexExisting] = after;
    } else {
      budgets.push(after);
    }
  }
  return makeChange({
    workbook,
    action,
    actionType,
    entityType: 'budget',
    entityId: category ? category.id : actionId(action, index),
    operation: operation === 'archive' ? 'archive' : before ? 'update' : 'create',
    before,
    after,
    validationIssues: issues,
    humanSummary:
      (operation === 'archive' ? 'Archived' : 'Updated') +
      ' budget for ' +
      (category ? category.name : 'unknown'),
    createId,
    index
  });
}

function executeOneAction({ workbook, action, plan, createId, index }) {
  const classification = classifyCheckpointedAction(action);
  const actionType = classification.action_type;
  if (!classification.supported) {
    return blockedChange({
      action,
      actionType,
      code: classification.code,
      message: classification.message,
      createId,
      index
    });
  }
  if (actionType === 'create_transaction')
    return applyCreateTransaction({ workbook, action, actionType, plan, createId, index });
  if (actionType === 'create_transaction_batch') {
    const transactions = Array.isArray(action.transactions) ? action.transactions : [];
    if (!transactions.length) {
      return blockedChange({
        action,
        actionType,
        code: 'missing_required_field',
        message: 'Transaction batch requires transactions.',
        createId,
        index
      });
    }
    return transactions.map((transaction, transactionIndex) =>
      applyCreateTransaction({
        workbook,
        action: Object.assign({}, transaction, {
          id: asString(action.id) ? action.id + ':' + String(transactionIndex + 1) : undefined
        }),
        actionType,
        plan,
        createId,
        index: transactionIndex
      })
    );
  }
  if (actionType === 'update_transaction')
    return applyUpdateTransaction({
      workbook,
      action,
      actionType,
      plan,
      createId,
      index,
      operation: 'update'
    });
  if (actionType === 'archive_transaction')
    return applyUpdateTransaction({
      workbook,
      action,
      actionType,
      plan,
      createId,
      index,
      operation: 'archive'
    });
  if (actionType === 'restore_transaction')
    return applyUpdateTransaction({
      workbook,
      action,
      actionType,
      plan,
      createId,
      index,
      operation: 'restore'
    });
  if (actionType === 'create_recurring_item')
    return applyCreateRecurringItem({ workbook, action, actionType, plan, createId, index });
  if (actionType === 'update_recurring_item')
    return applyUpdateRecurringItem({
      workbook,
      action,
      actionType,
      createId,
      index,
      operation: 'update'
    });
  if (actionType === 'archive_recurring_item')
    return applyUpdateRecurringItem({
      workbook,
      action,
      actionType,
      createId,
      index,
      operation: 'archive'
    });
  if (actionType === 'restore_recurring_item')
    return applyUpdateRecurringItem({
      workbook,
      action,
      actionType,
      createId,
      index,
      operation: 'restore'
    });
  if (actionType === 'update_category_assignment')
    return applyCategoryAction({
      workbook,
      action,
      actionType,
      createId,
      index,
      operation: 'update'
    });
  if (actionType === 'create_category')
    return applyCategoryAction({
      workbook,
      action,
      actionType,
      createId,
      index,
      operation: 'create'
    });
  if (actionType === 'rename_category')
    return applyCategoryAction({
      workbook,
      action,
      actionType,
      createId,
      index,
      operation: 'rename'
    });
  if (actionType === 'update_budget' || actionType === 'create_budget')
    return applyBudgetAction({
      workbook,
      action,
      actionType,
      createId,
      index,
      operation: 'update'
    });
  if (actionType === 'archive_budget')
    return applyBudgetAction({
      workbook,
      action,
      actionType,
      createId,
      index,
      operation: 'archive'
    });
  return blockedChange({
    action,
    actionType,
    code: 'unsupported_checkpoint_action_type',
    message: 'This action is not implemented for checkpointed apply.',
    createId,
    index
  });
}

export function executeCheckpointedActionPlan({
  workbook,
  workbookId,
  actionPlan,
  callerContext,
  executionMode = 'checkpointed_apply',
  sourcePrompt,
  idempotencyKey,
  dryRun = false,
  maxActions = 25,
  createId,
  now,
  requestId
} = {}) {
  if (!workbook || asString(workbook.id) !== asString(workbookId)) {
    return {
      status: 'validation_failed',
      summary: summarizeCheckpointChanges(
        [],
        [
          createValidationIssue('workbook_not_found', 'Workbook was not found.', {
            severity: 'blocked'
          })
        ]
      ),
      applied_changes: [],
      blocked_actions: [
        { action_type: 'workbook', code: 'workbook_not_found', message: 'Workbook was not found.' }
      ],
      validation_issues: [
        createValidationIssue('workbook_not_found', 'Workbook was not found.', {
          severity: 'blocked'
        })
      ],
      warnings: [],
      audit_event_ids: []
    };
  }
  const callerType = asString(
    callerContext &&
      (callerContext.callerType || callerContext.caller_type || callerContext.subject_type)
  );
  if (['beta_gpt_action', 'cloud_api'].includes(callerType) && !asString(idempotencyKey)) {
    return {
      status: 'validation_failed',
      summary: summarizeCheckpointChanges(
        [],
        [
          createValidationIssue(
            'idempotency_key_required',
            'Checkpointed GPT-originated actions require an idempotency key.',
            { severity: 'blocked' }
          )
        ]
      ),
      applied_changes: [],
      blocked_actions: [
        {
          action_type: 'checkpointed_action_plan',
          code: 'idempotency_key_required',
          message: 'Checkpointed GPT-originated actions require an idempotency key.'
        }
      ],
      validation_issues: [
        createValidationIssue(
          'idempotency_key_required',
          'Checkpointed GPT-originated actions require an idempotency key.',
          { severity: 'blocked' }
        )
      ],
      warnings: [],
      audit_event_ids: []
    };
  }
  if (executionMode !== 'checkpointed_apply') {
    return {
      status: 'blocked',
      summary: summarizeCheckpointChanges(
        [],
        [
          createValidationIssue(
            'checkpointed_apply_disabled',
            'Checkpointed AI actions are not enabled.',
            { severity: 'blocked' }
          )
        ]
      ),
      applied_changes: [],
      blocked_actions: [
        {
          action_type: 'checkpointed_action_plan',
          code: 'checkpointed_apply_disabled',
          message: 'Checkpointed AI actions are not enabled.'
        }
      ],
      validation_issues: [
        createValidationIssue(
          'checkpointed_apply_disabled',
          'Checkpointed AI actions are not enabled.',
          { severity: 'blocked' }
        )
      ],
      warnings: [],
      audit_event_ids: []
    };
  }
  const store = createWorkbookCheckpointStore(workbook);
  const parsed = parseCavalryActionPlan(actionPlan, {
    dateDefault: workbook.currentDate,
    currencyDefault: workbook.currency,
    timezone: workbook.timezone,
    source: 'chatgpt'
  });
  const plan = parsed.plan || actionPlan || {};
  const actions = getPlanActions(plan);
  if (actions.length > Math.max(1, Number(maxActions) || 25)) {
    return {
      status: 'validation_failed',
      summary: summarizeCheckpointChanges(
        [],
        [
          createValidationIssue(
            'checkpoint_action_limit_exceeded',
            'Checkpointed action plan contains too many actions.',
            { severity: 'blocked' }
          )
        ]
      ),
      applied_changes: [],
      blocked_actions: [
        {
          action_type: 'checkpointed_action_plan',
          code: 'checkpoint_action_limit_exceeded',
          message: 'Checkpointed action plan contains too many actions.'
        }
      ],
      validation_issues: [
        createValidationIssue(
          'checkpoint_action_limit_exceeded',
          'Checkpointed action plan contains too many actions.',
          { severity: 'blocked' }
        )
      ],
      warnings: [],
      audit_event_ids: []
    };
  }
  const userId =
    asString(callerContext && (callerContext.user_id || callerContext.userId)) || 'unknown';
  const requestFingerprint = fingerprintEntity({
    actionPlan: plan,
    idempotencyKey,
    executionMode
  });
  const replay = store.getIdempotencyRecord(workbook.id, userId, idempotencyKey);
  if (replay) {
    if (replay.request_fingerprint !== requestFingerprint) {
      return {
        status: 'validation_failed',
        summary: summarizeCheckpointChanges(
          [],
          [
            createValidationIssue(
              'idempotency_conflict',
              'Idempotency key was reused with a different checkpointed request.',
              { severity: 'blocked' }
            )
          ]
        ),
        applied_changes: [],
        blocked_actions: [
          {
            action_type: 'checkpointed_action_plan',
            code: 'idempotency_conflict',
            message: 'Idempotency key was reused with a different checkpointed request.'
          }
        ],
        validation_issues: [
          createValidationIssue(
            'idempotency_conflict',
            'Idempotency key was reused with a different checkpointed request.',
            { severity: 'blocked' }
          )
        ],
        warnings: [],
        audit_event_ids: []
      };
    }
    const checkpoint = store.getCheckpoint(workbook.id, replay.checkpoint_id);
    if (checkpoint) {
      return {
        status:
          checkpoint.status === 'applied'
            ? 'applied_with_checkpoint'
            : checkpoint.status === 'partially_applied'
              ? 'partially_applied_with_checkpoint'
              : 'blocked',
        checkpoint_id: checkpoint.checkpoint_id,
        checkpoint_review_url: checkpoint.checkpoint_review_url,
        summary: checkpoint.summary,
        applied_changes: (checkpoint.changes || []).filter((change) => change.status === 'applied'),
        blocked_actions: (checkpoint.changes || [])
          .filter((change) => change.status === 'blocked')
          .map((change) => ({
            action_id: change.action_id,
            action_type: change.action_type,
            code: change.validation_issues[0] && change.validation_issues[0].code,
            message: change.human_summary
          })),
        validation_issues: checkpoint.validation_issues,
        warnings: checkpoint.warnings,
        audit_event_ids: checkpoint.audit_event_ids,
        idempotency_replayed: true,
        message_for_user:
          'I applied reversible Cavalry changes under checkpoint ' +
          checkpoint.checkpoint_id +
          '. Review or undo them in Cavalry.'
      };
    }
  }
  appendCheckpointAuditEvent(workbook, {
    createId,
    event_type: 'checkpoint_execution_requested',
    request_id: requestId,
    workbook_id: workbook.id,
    checkpoint_id: '',
    caller_type: callerType,
    origin: 'chatgpt_companion',
    auth_method: callerContext && (callerContext.authMethod || callerContext.auth_method),
    scopes: callerContext && callerContext.scopes,
    operation_id: 'executeCavalryCheckpointedActionPlan',
    action_count: actions.length,
    idempotency_key_status: idempotencyKey ? 'provided' : 'none',
    outcome: 'requested'
  });
  const beforeFingerprint = fingerprintWorkbookCore(workbook);
  const dryRunWorkbook = dryRun ? clonePlain(workbook) : workbook;
  const changes = actions
    .flatMap((action, index) => {
      const normalized = Object.assign({}, action, {
        type: normalizeCheckpointedActionType(action)
      });
      return executeOneAction({
        workbook: dryRunWorkbook,
        action: normalized,
        plan,
        createId,
        index
      });
    })
    .flat();
  const validationIssues = uniqueIssues(
    (parsed.issues || [])
      .filter(
        (issue) =>
          issue.code !== 'unsupported_action_type' && issue.code !== 'unsafe_direct_mutation_claim'
      )
      .concat(changes.flatMap((change) => change.validation_issues || []))
  );
  const warnings = uniqueIssues(changes.flatMap((change) => change.warnings || []));
  if (dryRun) {
    return {
      status: 'dry_run',
      summary: summarizeCheckpointChanges(changes, validationIssues, warnings),
      applied_changes: changes.filter((change) => change.status === 'applied'),
      blocked_actions: changes
        .filter((change) => change.status === 'blocked')
        .map((change) => ({
          action_id: change.action_id,
          action_type: change.action_type,
          code: change.validation_issues[0] && change.validation_issues[0].code,
          message: change.human_summary
        })),
      validation_issues: validationIssues,
      warnings,
      audit_event_ids: []
    };
  }
  const afterFingerprint = fingerprintWorkbookCore(workbook);
  const actor = {
    type: 'external_ai',
    display_name: 'ChatGPT Companion',
    caller_type: callerType || 'beta_gpt_action',
    auth_method: callerContext && (callerContext.authMethod || callerContext.auth_method)
  };
  const checkpoint = createCheckpoint({
    workbook,
    actor,
    origin: 'chatgpt_companion',
    requestId,
    idempotencyKey,
    sourcePrompt,
    actionPlanId: asString(plan.id || plan.action_plan_id),
    changes,
    validationIssues,
    warnings,
    beforeWorkbookFingerprint: beforeFingerprint,
    afterWorkbookFingerprint: afterFingerprint,
    createId,
    now
  });
  if (idempotencyKey) {
    store.saveIdempotencyRecord({
      workbook_id: workbook.id,
      user_id: userId,
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      checkpoint_id: checkpoint.checkpoint_id,
      created_at: getNow(now)
    });
  }
  changes
    .filter((change) => change.status === 'applied')
    .forEach((change) => {
      appendCheckpointAuditEvent(workbook, {
        createId,
        event_type: 'checkpoint_change_applied',
        request_id: requestId,
        workbook_id: workbook.id,
        checkpoint_id: checkpoint.checkpoint_id,
        caller_type: callerType,
        origin: checkpoint.origin,
        auth_method: actor.auth_method,
        scopes: callerContext && callerContext.scopes,
        operation_id: change.action_type,
        action_count: 1,
        applied_count: 1,
        warning_count: change.warnings.length,
        outcome: 'applied'
      });
    });
  changes
    .filter((change) => change.status === 'blocked')
    .forEach((change) => {
      appendCheckpointAuditEvent(workbook, {
        createId,
        event_type: 'checkpoint_action_blocked',
        request_id: requestId,
        workbook_id: workbook.id,
        checkpoint_id: checkpoint.checkpoint_id,
        caller_type: callerType,
        origin: checkpoint.origin,
        auth_method: actor.auth_method,
        scopes: callerContext && callerContext.scopes,
        operation_id: change.action_type,
        action_count: 1,
        blocked_count: 1,
        outcome: 'blocked'
      });
    });
  const applied = changes.filter((change) => change.status === 'applied');
  const blocked = changes.filter((change) => change.status === 'blocked');
  return {
    status:
      applied.length && blocked.length
        ? 'partially_applied_with_checkpoint'
        : applied.length
          ? 'applied_with_checkpoint'
          : 'blocked',
    checkpoint_id: checkpoint.checkpoint_id,
    checkpoint_review_url: checkpoint.checkpoint_review_url,
    summary: checkpoint.summary,
    applied_changes: applied,
    blocked_actions: blocked.map((change) => ({
      action_id: change.action_id,
      action_type: change.action_type,
      code: change.validation_issues[0] && change.validation_issues[0].code,
      message: change.human_summary
    })),
    validation_issues: validationIssues,
    warnings,
    audit_event_ids: checkpoint.audit_event_ids,
    message_for_user: applied.length
      ? 'I applied ' +
        String(applied.length) +
        ' reversible Cavalry change' +
        (applied.length === 1 ? '' : 's') +
        ' under checkpoint ' +
        checkpoint.checkpoint_id +
        '. Review or undo ' +
        (applied.length === 1 ? 'it' : 'them') +
        ' in Cavalry.'
      : 'Cavalry blocked this checkpointed action plan. No workbook data changed.'
  };
}

export { stableStringify };
