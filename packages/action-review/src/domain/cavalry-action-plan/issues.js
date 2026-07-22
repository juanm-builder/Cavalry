export const CAVALRY_ACTION_PLAN_ISSUE_CODES = Object.freeze([
  'unsupported_action_type',
  'invalid_action_plan',
  'invalid_json',
  'invalid_schema',
  'workbook_mismatch',
  'missing_required_field',
  'invalid_amount',
  'invalid_date',
  'invalid_currency',
  'unsupported_currency',
  'ambiguous_account',
  'unknown_account',
  'ambiguous_category',
  'unknown_category',
  'possible_duplicate',
  'duplicate_candidate',
  'unsafe_direct_mutation_claim',
  'unauthorized_scope',
  'scope_denied',
  'auth_required',
  'auth_forbidden',
  'rate_limited',
  'idempotency_replay',
  'idempotency_conflict',
  'external_ref_not_found',
  'workbook_not_found',
  'draft_validation_failed',
  'payload_too_large',
  'server_not_enabled',
  'checkpointed_apply_disabled',
  'checkpoint_action_limit_exceeded',
  'checkpoint_required',
  'checkpoint_create_failed',
  'checkpoint_not_found',
  'checkpoint_cross_workbook_denied',
  'checkpoint_rollback_unavailable',
  'checkpoint_rollback_conflict',
  'checkpoint_already_rolled_back',
  'checkpoint_change_not_reversible',
  'irreversible_action_blocked',
  'raw_mutation_not_allowed',
  'unsupported_checkpoint_action_type',
  'mutation_without_checkpoint_blocked',
  'idempotency_key_required',
  'multiple_transaction_matches',
  'image_or_attachment_not_supported',
  'blocked_apply_from_external_origin'
]);

export const ISSUE_SEVERITIES = Object.freeze(['info', 'warning', 'error', 'blocked']);

export function normalizeIssueSeverity(value, fallback = 'error') {
  const severity = String(value || '')
    .trim()
    .toLowerCase();
  return ISSUE_SEVERITIES.includes(severity) ? severity : fallback;
}

export function createValidationIssue(code, message, options = {}) {
  const normalizedCode = CAVALRY_ACTION_PLAN_ISSUE_CODES.includes(String(code || ''))
    ? String(code)
    : 'invalid_schema';
  return {
    code: normalizedCode,
    severity: normalizeIssueSeverity(options.severity, 'error'),
    message: String(message || normalizedCode).trim(),
    field: String(options.field || '').trim() || undefined,
    action_id: String(options.actionId || options.action_id || '').trim() || undefined,
    suggested_fix: String(options.suggestedFix || options.suggested_fix || '').trim() || undefined
  };
}

export function hasBlockingIssues(issues) {
  return (Array.isArray(issues) ? issues : []).some(
    (issue) => issue && (issue.severity === 'blocked' || issue.severity === 'error')
  );
}

export function uniqueIssues(issues) {
  const seen = new Set();
  return (Array.isArray(issues) ? issues : []).filter((issue) => {
    if (!issue) {
      return false;
    }
    const key = [
      issue.code,
      issue.severity,
      issue.field || '',
      issue.action_id || '',
      issue.message || ''
    ].join('|');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
