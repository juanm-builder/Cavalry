export const CAVALRY_ACTION_PLAN_VERSION = '1.0';

export const CAVALRY_ACTION_PLAN_SOURCES = Object.freeze([
  'chatgpt',
  'cavalry_companion_gpt',
  'manual',
  'unknown'
]);

export const CAVALRY_ACTION_TYPES = Object.freeze([
  'create_transaction',
  'create_transaction_batch',
  'create_recurring_item',
  'update_category_assignment',
  'update_budget'
]);

export const CAVALRY_DRAFT_ITEM_TYPES = Object.freeze([
  'transaction',
  'recurring_item',
  'category_change',
  'budget_change',
  'account_change'
]);

export const CAVALRY_ACTION_DIRECTIONS = Object.freeze([
  'expense',
  'income',
  'transfer',
  'refund',
  'unknown'
]);

export const CAVALRY_CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

export const CAVALRY_RECURRING_CADENCES = Object.freeze([
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
  'unknown'
]);

export const CAVALRY_BUDGET_PERIODS = Object.freeze(['monthly', 'weekly', 'yearly']);

export const ACTION_TYPE_ALIASES = Object.freeze({
  add_transaction: 'create_transaction',
  record_transaction: 'create_transaction',
  create_expense: 'create_transaction',
  add_expense: 'create_transaction',
  add_transactions: 'create_transaction_batch',
  create_transactions: 'create_transaction_batch',
  transaction_batch: 'create_transaction_batch',
  create_transaction_drafts: 'create_transaction_batch',
  add_recurring_item: 'create_recurring_item',
  create_subscription: 'create_recurring_item',
  add_subscription: 'create_recurring_item',
  create_recurring: 'create_recurring_item',
  categorize_transaction: 'update_category_assignment',
  recategorize_transaction: 'update_category_assignment',
  change_category: 'update_category_assignment',
  category_change: 'update_category_assignment',
  budget_change: 'update_budget',
  set_budget: 'update_budget'
});

export const DIRECT_MUTATION_ACTION_TYPES = Object.freeze([
  'apply',
  'apply_draft',
  'apply_drafts',
  'post_transaction',
  'post_transactions',
  'create_posted_transaction',
  'delete_transaction',
  'delete_transactions',
  'delete',
  'archive',
  'archive_transaction',
  'edit_transaction_directly',
  'update_workbook',
  'mutate_workbook',
  'create_account',
  'delete_account',
  'create_category',
  'delete_category'
]);

export function isSupportedActionPlanVersion(value) {
  return String(value || '').trim() === CAVALRY_ACTION_PLAN_VERSION;
}

export function isSupportedActionType(value) {
  return CAVALRY_ACTION_TYPES.includes(String(value || '').trim());
}

export function normalizeActionType(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return ACTION_TYPE_ALIASES[raw] || raw;
}

export function isDirectMutationActionType(value) {
  const normalized = normalizeActionType(value);
  return DIRECT_MUTATION_ACTION_TYPES.includes(normalized);
}
