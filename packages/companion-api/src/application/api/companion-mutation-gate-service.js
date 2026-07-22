// Centralizes which external API mutation classes are allowed in draft-only and checkpointed modes.

import { CavalryApiError } from './cavalry-api-errors.js';

export const COMPANION_MUTATION_KINDS = Object.freeze({
  DRAFT_GROUP_CREATE: 'draft_group_create',
  CHECKPOINTED_ACTION_EXECUTE: 'checkpointed_action_execute',
  CHECKPOINT_ROLLBACK: 'checkpoint_rollback',
  DIRECT_WORKBOOK_MUTATION: 'direct_workbook_mutation'
});

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function runtimeField(runtimeStatus, snakeKey, camelKey, fallback) {
  if (runtimeStatus && typeof runtimeStatus[snakeKey] !== 'undefined') {
    return runtimeStatus[snakeKey];
  }
  if (runtimeStatus && camelKey && typeof runtimeStatus[camelKey] !== 'undefined') {
    return runtimeStatus[camelKey];
  }
  return fallback;
}

export function getCompanionMutationPolicy(runtimeStatus = {}) {
  const aiActionMode =
    asString(runtimeField(runtimeStatus, 'ai_action_mode', 'aiActionMode', 'draft_only')) ||
    'draft_only';
  return {
    aiActionMode,
    draftOnlyAvailable: asBoolean(
      runtimeField(runtimeStatus, 'draft_only_available', 'draftOnlyAvailable', true),
      true
    ),
    checkpointedApplyEnabled: asBoolean(
      runtimeField(runtimeStatus, 'checkpointed_apply_enabled', 'checkpointedApplyEnabled', false),
      false
    ),
    rollbackAvailable: asBoolean(
      runtimeField(runtimeStatus, 'rollback_available', 'rollbackAvailable', true),
      true
    ),
    irreversibleActionsAllowed: asBoolean(
      runtimeField(
        runtimeStatus,
        'irreversible_actions_allowed',
        'irreversibleActionsAllowed',
        false
      ),
      false
    ),
    directMutationEndpointsExposed: asBoolean(
      runtimeField(
        runtimeStatus,
        'direct_mutation_endpoints_exposed',
        'directMutationEndpointsExposed',
        false
      ),
      false
    )
  };
}

function allowed(kind, extra = {}) {
  return Object.assign(
    {
      ok: true,
      mutationKind: kind,
      reviewRequired: true,
      checkpointRequired: false
    },
    extra
  );
}

function blocked(code, message, extra = {}) {
  throw new CavalryApiError(code, message, Object.assign({ status: 403 }, extra));
}

export function assertCompanionMutationAllowed(runtimeStatus, mutationKind) {
  const kind = asString(mutationKind);
  const policy = getCompanionMutationPolicy(runtimeStatus);
  if (policy.irreversibleActionsAllowed || policy.directMutationEndpointsExposed) {
    blocked(
      'direct_mutation_blocked',
      'Companion API direct workbook mutation endpoints must remain disabled.'
    );
  }
  if (kind === COMPANION_MUTATION_KINDS.DRAFT_GROUP_CREATE) {
    if (policy.draftOnlyAvailable === false) {
      blocked('drafts_disabled', 'Draft creation is not enabled for this Cavalry API session.');
    }
    return allowed(kind, {
      checkpointRequired: false
    });
  }
  if (kind === COMPANION_MUTATION_KINDS.CHECKPOINTED_ACTION_EXECUTE) {
    if (policy.aiActionMode !== 'checkpointed_apply' || policy.checkpointedApplyEnabled !== true) {
      blocked(
        'checkpointed_apply_disabled',
        'Checkpointed AI actions are not enabled for this Cavalry API session.'
      );
    }
    return allowed(kind, {
      checkpointRequired: true
    });
  }
  if (kind === COMPANION_MUTATION_KINDS.CHECKPOINT_ROLLBACK) {
    if (policy.rollbackAvailable !== true) {
      blocked(
        'checkpoint_rollback_disabled',
        'Checkpoint rollback is not enabled for this Cavalry API session.'
      );
    }
    return allowed(kind, {
      checkpointRequired: true
    });
  }
  blocked('companion_mutation_blocked', 'This Companion API mutation class is not exposed.');
}
