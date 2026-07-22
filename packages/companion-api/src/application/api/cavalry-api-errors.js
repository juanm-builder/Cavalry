import { ExternalDraftServiceError } from '@cavalry/action-review/application/drafts/external-draft-service.js';

export class CavalryApiError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'CavalryApiError';
    this.code = code;
    this.status = Number(options.status || 400);
    this.requestId = options.requestId || '';
    this.issues = options.issues || [];
  }
}

export const CAVALRY_API_PUBLIC_ERROR_CODES = Object.freeze([
  'invalid_action_plan',
  'unsupported_action_type',
  'missing_required_field',
  'invalid_amount',
  'invalid_date',
  'invalid_currency',
  'workbook_not_found',
  'scope_denied',
  'idempotency_conflict',
  'duplicate_candidate',
  'draft_validation_failed',
  'payload_too_large',
  'rate_limited',
  'auth_required',
  'auth_forbidden',
  'server_not_enabled',
  'checkpointed_apply_disabled',
  'checkpoint_scope_denied',
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
  'idempotency_key_required'
]);

export function isCavalryApiError(error) {
  return error instanceof CavalryApiError || error instanceof ExternalDraftServiceError;
}

export function toPublicCavalryApiErrorCode(code, status = 400, message = '') {
  const normalized = String(code || '').trim();
  if (status === 401) return 'auth_required';
  if (status === 403 && normalized === 'blocked_apply_from_external_origin')
    return 'auth_forbidden';
  if (status === 403 && (normalized === 'unauthorized_scope' || normalized === 'workbook_mismatch'))
    return 'scope_denied';
  if (normalized === 'payload_too_large') return 'payload_too_large';
  if (normalized === 'rate_limited') return 'rate_limited';
  if (normalized === 'unsupported_action_type' || normalized === 'unsafe_direct_mutation_claim')
    return 'unsupported_action_type';
  if (normalized === 'missing_required_field') return 'missing_required_field';
  if (normalized === 'invalid_amount') return 'invalid_amount';
  if (normalized === 'invalid_date') return 'invalid_date';
  if (normalized === 'unsupported_currency' || normalized === 'invalid_currency')
    return 'invalid_currency';
  if (normalized === 'idempotency_replay' || normalized === 'idempotency_conflict')
    return 'idempotency_conflict';
  if (normalized === 'possible_duplicate' || normalized === 'duplicate_candidate')
    return 'duplicate_candidate';
  if (normalized === 'external_ref_not_found' && /workbook/i.test(String(message || '')))
    return 'workbook_not_found';
  if (normalized === 'server_not_enabled') return 'server_not_enabled';
  if (CAVALRY_API_PUBLIC_ERROR_CODES.includes(normalized)) return normalized;
  if (normalized === 'draft_validation_failed') return 'draft_validation_failed';
  if (
    normalized === 'invalid_json' ||
    normalized === 'invalid_schema' ||
    normalized === 'workbook_mismatch'
  )
    return 'invalid_action_plan';
  return 'draft_validation_failed';
}

function toPublicIssue(issue) {
  if (!(issue && typeof issue === 'object')) {
    return issue;
  }
  return Object.assign({}, issue, {
    code: toPublicCavalryApiErrorCode(issue.code, 400, issue.message)
  });
}

export function toSafeApiError(error, requestId = '') {
  if (isCavalryApiError(error)) {
    const status = error.status || 400;
    return {
      status,
      body: {
        error: {
          code: toPublicCavalryApiErrorCode(error.code, status, error.message),
          message: error.message || 'The request could not be processed.',
          request_id: error.requestId || requestId,
          issues:
            Array.isArray(error.issues) && error.issues.length
              ? error.issues.map(toPublicIssue)
              : undefined
        }
      }
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: 'server_error',
        message: 'Cavalry could not process the request.',
        request_id: requestId
      }
    }
  };
}
