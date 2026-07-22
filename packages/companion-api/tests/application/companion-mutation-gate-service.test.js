// Tests for the Companion API mutation gate service.
// Locks down draft-only and checkpointed mutation policy before API routes can mutate workbook data.

import { describe, expect, it } from 'vitest';

import {
  COMPANION_MUTATION_KINDS,
  assertCompanionMutationAllowed,
  getCompanionMutationPolicy
} from '@cavalry/companion-api/application/api/companion-mutation-gate-service.js';
import { CavalryApiError } from '@cavalry/companion-api/application/api/cavalry-api-errors.js';

describe('Companion API mutation gate service', () => {
  it('allows draft group creation in draft-only mode while requiring review', () => {
    const result = assertCompanionMutationAllowed(
      {
        ai_action_mode: 'draft_only',
        draft_only_available: true,
        checkpointed_apply_enabled: false
      },
      COMPANION_MUTATION_KINDS.DRAFT_GROUP_CREATE
    );

    expect(result).toEqual({
      ok: true,
      mutationKind: 'draft_group_create',
      reviewRequired: true,
      checkpointRequired: false
    });
  });

  it('blocks checkpointed execution unless checkpointed apply is explicitly enabled', () => {
    expect(() =>
      assertCompanionMutationAllowed(
        {
          ai_action_mode: 'draft_only',
          checkpointed_apply_enabled: false
        },
        COMPANION_MUTATION_KINDS.CHECKPOINTED_ACTION_EXECUTE
      )
    ).toThrow(CavalryApiError);

    const result = assertCompanionMutationAllowed(
      {
        ai_action_mode: 'checkpointed_apply',
        checkpointed_apply_enabled: true
      },
      COMPANION_MUTATION_KINDS.CHECKPOINTED_ACTION_EXECUTE
    );

    expect(result).toMatchObject({
      mutationKind: 'checkpointed_action_execute',
      checkpointRequired: true
    });
  });

  it('blocks direct or unknown workbook mutation classes', () => {
    expect(() =>
      assertCompanionMutationAllowed({}, COMPANION_MUTATION_KINDS.DIRECT_WORKBOOK_MUTATION)
    ).toThrow(/not exposed/i);
    expect(() =>
      assertCompanionMutationAllowed(
        {
          direct_mutation_endpoints_exposed: true
        },
        COMPANION_MUTATION_KINDS.DRAFT_GROUP_CREATE
      )
    ).toThrow(/direct workbook mutation/i);
    expect(() =>
      assertCompanionMutationAllowed(
        {
          irreversible_actions_allowed: true
        },
        COMPANION_MUTATION_KINDS.DRAFT_GROUP_CREATE
      )
    ).toThrow(/direct workbook mutation/i);
  });

  it('normalizes snake_case and camelCase runtime fields', () => {
    expect(
      getCompanionMutationPolicy({
        aiActionMode: 'checkpointed_apply',
        checkpointedApplyEnabled: true,
        rollbackAvailable: false
      })
    ).toMatchObject({
      aiActionMode: 'checkpointed_apply',
      checkpointedApplyEnabled: true,
      rollbackAvailable: false
    });
  });
});
