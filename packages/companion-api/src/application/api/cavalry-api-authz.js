import { CavalryApiError } from './cavalry-api-errors.js';

export const CAVALRY_API_SCOPES = Object.freeze({
  READ_CAPABILITIES: 'cavalry.read.capabilities',
  READ_WORKBOOKS: 'cavalry.read.workbooks',
  READ_SUMMARY: 'cavalry.read.summary',
  READ_ACCOUNTS: 'cavalry.read.accounts',
  READ_CATEGORIES: 'cavalry.read.categories',
  READ_TRANSACTIONS_RECENT: 'cavalry.read.transactions.recent',
  DRAFT_CREATE: 'cavalry.draft.create',
  DRAFT_READ: 'cavalry.draft.read',
  DRAFT_APPLY: 'cavalry.draft.apply',
  CHECKPOINT_EXECUTE: 'cavalry.ai.checkpoint.execute',
  CHECKPOINT_READ: 'cavalry.ai.checkpoint.read',
  CHECKPOINT_ROLLBACK: 'cavalry.ai.checkpoint.rollback'
});

export const CAVALRY_API_STABLE_SCOPES = Object.freeze([
  CAVALRY_API_SCOPES.READ_CAPABILITIES,
  CAVALRY_API_SCOPES.READ_WORKBOOKS,
  CAVALRY_API_SCOPES.READ_SUMMARY,
  CAVALRY_API_SCOPES.READ_ACCOUNTS,
  CAVALRY_API_SCOPES.READ_CATEGORIES,
  CAVALRY_API_SCOPES.READ_TRANSACTIONS_RECENT,
  CAVALRY_API_SCOPES.DRAFT_CREATE,
  CAVALRY_API_SCOPES.DRAFT_READ,
  CAVALRY_API_SCOPES.DRAFT_APPLY
]);

export const CAVALRY_API_CHECKPOINT_SCOPES = Object.freeze([
  CAVALRY_API_SCOPES.CHECKPOINT_EXECUTE,
  CAVALRY_API_SCOPES.CHECKPOINT_READ
]);

const LEGACY_SCOPE_ALIASES = Object.freeze({
  'cavalry.read.transactions': CAVALRY_API_SCOPES.READ_TRANSACTIONS_RECENT,
  'cavalry.read.recurring': CAVALRY_API_SCOPES.READ_SUMMARY
});

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function hasScope(caller, scope) {
  const scopes = Array.isArray(caller && caller.scopes) ? caller.scopes.map(asString) : [];
  if (scopes.includes(scope)) {
    return true;
  }
  return scopes.some((candidate) => LEGACY_SCOPE_ALIASES[candidate] === scope);
}

export function assertAuthenticated(caller) {
  if (!caller || !asString(caller.user_id)) {
    throw new CavalryApiError('unauthorized_scope', 'Authentication is required.', {
      status: 401
    });
  }
}

export function assertScope(caller, scope) {
  assertAuthenticated(caller);
  if (!hasScope(caller, scope)) {
    throw new CavalryApiError('unauthorized_scope', 'Required scope is missing: ' + scope, {
      status: 403
    });
  }
}

export function assertWorkbookAccess(caller, workbookId) {
  assertAuthenticated(caller);
  const allowed = Array.isArray(caller.allowed_workbook_ids)
    ? caller.allowed_workbook_ids.map(asString)
    : [];
  if (allowed.length && !allowed.includes(asString(workbookId))) {
    throw new CavalryApiError('unauthorized_scope', 'Caller is not authorized for this workbook.', {
      status: 403
    });
  }
}

export function assertWorkbookScope(caller, workbookId, scope) {
  assertScope(caller, scope);
  assertWorkbookAccess(caller, workbookId);
}
