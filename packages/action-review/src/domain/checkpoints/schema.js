export const CHECKPOINT_VERSION = '1.0';

export const CHECKPOINT_STATUSES = Object.freeze([
  'applied',
  'partially_applied',
  'rolled_back',
  'partially_rolled_back',
  'rollback_conflict',
  'failed'
]);

export const CHECKPOINT_CHANGE_STATUSES = Object.freeze([
  'applied',
  'rolled_back',
  'rollback_conflict',
  'blocked'
]);

export const CHECKPOINT_CHANGE_OPERATIONS = Object.freeze([
  'create',
  'update',
  'archive',
  'restore',
  'merge',
  'split',
  'mark_paid'
]);

export const CHECKPOINT_ENTITY_TYPES = Object.freeze([
  'transaction',
  'recurring_item',
  'category',
  'budget',
  'bill',
  'account',
  'draft_group'
]);

export const CHECKPOINT_ORIGINS = Object.freeze([
  'chatgpt_companion',
  'companion_api',
  'manual_import',
  'local_model',
  'remote_model',
  'user',
  'test'
]);

export const CHECKPOINT_ACTOR_TYPES = Object.freeze(['external_ai', 'user', 'system', 'test']);

export const CHECKPOINTED_ACTION_TYPES = Object.freeze([
  'create_transaction',
  'create_transaction_batch',
  'update_transaction',
  'archive_transaction',
  'restore_transaction',
  'create_recurring_item',
  'update_recurring_item',
  'archive_recurring_item',
  'restore_recurring_item',
  'update_category_assignment',
  'create_category',
  'rename_category',
  'update_budget',
  'create_budget',
  'archive_budget'
]);

export const IRREVERSIBLE_ACTION_TYPES = Object.freeze([
  'delete_workbook',
  'delete_all_transactions',
  'permanently_delete_transaction',
  'permanently_delete_account',
  'permanently_delete_category',
  'clear_version_history',
  'clear_checkpoints',
  'disable_checkpoints',
  'disable_companion_api',
  'change_api_settings',
  'change_auth_settings',
  'export_full_workbook',
  'connect_bank',
  'send_money',
  'make_payment',
  'submit_tax_filing',
  'submit_legal_document',
  'place_investment_trade',
  'create_account',
  'delete_account',
  'delete_category',
  'hard_delete_transaction',
  'apply_draft_group_without_cavalry_ui'
]);

export function createEmptyCheckpointSummary(totalActions = 0) {
  return {
    total_actions: Math.max(0, Number(totalActions) || 0),
    applied: 0,
    blocked: 0,
    needs_review: 0,
    warnings: 0,
    created_entities: 0,
    updated_entities: 0,
    archived_entities: 0,
    reversible: true,
    irreversible_actions_blocked: 0
  };
}

export function summarizeCheckpointChanges(changes = [], validationIssues = [], warnings = []) {
  return changes.reduce(
    (summary, change) => {
      if (change.status === 'applied') {
        summary.applied += 1;
      }
      if (change.status === 'blocked') {
        summary.blocked += 1;
      }
      if (change.operation === 'create' && change.status === 'applied') {
        summary.created_entities += 1;
      }
      if (change.operation === 'update' && change.status === 'applied') {
        summary.updated_entities += 1;
      }
      if (change.operation === 'archive' && change.status === 'applied') {
        summary.archived_entities += 1;
      }
      summary.warnings += Array.isArray(change.warnings) ? change.warnings.length : 0;
      if (
        change.status === 'blocked' &&
        (change.validation_issues || []).some(
          (issue) => issue && issue.code === 'irreversible_action_blocked'
        )
      ) {
        summary.irreversible_actions_blocked += 1;
      }
      return summary;
    },
    Object.assign(createEmptyCheckpointSummary(changes.length), {
      warnings: Array.isArray(warnings) ? warnings.length : 0,
      needs_review: Array.isArray(validationIssues)
        ? validationIssues.filter((issue) => issue && issue.severity === 'warning').length
        : 0
    })
  );
}
