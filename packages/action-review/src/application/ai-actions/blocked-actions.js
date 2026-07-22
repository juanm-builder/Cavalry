import {
  IRREVERSIBLE_ACTION_TYPES,
  CHECKPOINTED_ACTION_TYPES
} from '../../domain/checkpoints/schema.js';

function normalizeType(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function normalizeCheckpointedActionType(action = {}) {
  const raw = normalizeType(action.type || action.action || action.operation);
  const aliases = {
    add_transaction: 'create_transaction',
    add_expense: 'create_transaction',
    record_transaction: 'create_transaction',
    add_transactions: 'create_transaction_batch',
    create_transactions: 'create_transaction_batch',
    add_subscription: 'create_recurring_item',
    create_subscription: 'create_recurring_item',
    categorize_transaction: 'update_category_assignment',
    recategorize_transaction: 'update_category_assignment',
    change_category: 'update_category_assignment',
    set_budget: 'update_budget',
    budget_change: 'update_budget',
    delete_transaction:
      action.transaction_id || action.target_id ? 'archive_transaction' : 'delete_all_transactions',
    remove_transaction:
      action.transaction_id || action.target_id ? 'archive_transaction' : 'delete_all_transactions'
  };
  return aliases[raw] || raw;
}

export function classifyCheckpointedAction(action = {}) {
  const type = normalizeCheckpointedActionType(action);
  if (IRREVERSIBLE_ACTION_TYPES.includes(type)) {
    return {
      supported: false,
      action_type: type,
      code: 'irreversible_action_blocked',
      message:
        'This request is irreversible or changes Companion API safety settings, so Cavalry blocked it.'
    };
  }
  if (!CHECKPOINTED_ACTION_TYPES.includes(type)) {
    return {
      supported: false,
      action_type: type || 'missing',
      code: 'unsupported_checkpoint_action_type',
      message: 'This action type is not supported for checkpointed apply.'
    };
  }
  return {
    supported: true,
    action_type: type,
    code: 'ok',
    message: ''
  };
}
