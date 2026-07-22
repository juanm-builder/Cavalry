// Tests for the checkpoint domain model.

import { describe, expect, it } from 'vitest';

import {
  getCheckpointIdFromReviewUrl,
  getCheckpointReviewUrl
} from '@cavalry/action-review/domain/checkpoints/checkpoint-id.js';
import {
  createRollbackConflict,
  detectRollbackConflict
} from '@cavalry/action-review/domain/checkpoints/conflicts.js';
import { buildCheckpointDiff } from '@cavalry/action-review/domain/checkpoints/diff.js';
import { fingerprintWorkbookCore } from '@cavalry/action-review/domain/checkpoints/entity-fingerprint.js';
import { buildInversePatch } from '@cavalry/action-review/domain/checkpoints/inverse-patch.js';
import { summarizeCheckpointChanges } from '@cavalry/action-review/domain/checkpoints/schema.js';
import { validateCheckpoint } from '@cavalry/action-review/domain/checkpoints/validation.js';

function makeAppliedChange() {
  const before = { id: 'txn_1', description: 'Old', amount: 100 };
  const after = { id: 'txn_1', description: 'New', amount: 120 };
  const diff = buildCheckpointDiff(before, after);
  return {
    change_id: 'chg_1',
    action_id: 'act_1',
    action_type: 'update_transaction',
    entity_type: 'transaction',
    entity_id: 'txn_1',
    operation: 'update',
    before: diff.before,
    after: diff.after,
    before_fingerprint: diff.before_fingerprint,
    after_fingerprint: diff.after_fingerprint,
    inverse_patch: buildInversePatch({
      operation: 'update',
      entityType: 'transaction',
      entityId: 'txn_1',
      before: diff.before,
      after: diff.after
    }),
    status: 'applied',
    validation_issues: [],
    warnings: [],
    human_summary: 'Updated transaction'
  };
}

describe('checkpoint domain model', () => {
  it('fingerprints workbook core data without checkpoint metadata', () => {
    const workbook = {
      id: 'wb_1',
      transactions: [{ id: 'txn_1', amount: 100 }],
      checkpoints: [{ checkpoint_id: 'cp_1' }],
      checkpointAuditEvents: [{ audit_event_id: 'audit_1' }],
      checkpointIdempotencyRecords: [{ idempotency_key: 'secret-ish-key' }]
    };
    const before = fingerprintWorkbookCore(workbook);

    workbook.checkpoints.push({ checkpoint_id: 'cp_2' });
    workbook.checkpointAuditEvents.push({ audit_event_id: 'audit_2' });
    expect(fingerprintWorkbookCore(workbook)).toBe(before);

    workbook.transactions[0].amount = 101;
    expect(fingerprintWorkbookCore(workbook)).not.toBe(before);
  });

  it('builds reversible diffs and validates a checkpoint schema', () => {
    const change = makeAppliedChange();
    const checkpoint = {
      checkpoint_id: 'cp_2026_06_28_000001',
      checkpoint_version: '1.0',
      workbook_id: 'wb_1',
      actor: { type: 'external_ai', display_name: 'ChatGPT Companion' },
      origin: 'chatgpt_companion',
      status: 'applied',
      created_at: '2026-06-28T00:00:00.000Z',
      summary: summarizeCheckpointChanges([change]),
      changes: [change],
      validation_issues: [],
      warnings: []
    };

    expect(change.inverse_patch).toMatchObject({
      type: 'restore_before_snapshot',
      entity_type: 'transaction',
      entity_id: 'txn_1'
    });
    expect(validateCheckpoint(checkpoint)).toMatchObject({ ok: true, issues: [] });
    expect(getCheckpointIdFromReviewUrl(getCheckpointReviewUrl(checkpoint.checkpoint_id))).toBe(
      checkpoint.checkpoint_id
    );
  });

  it('rejects malformed checkpoints and does not double-count blocked changes', () => {
    const blockedChange = {
      change_id: 'chg_blocked',
      action_id: 'act_blocked',
      action_type: 'delete_all_transactions',
      entity_type: 'draft_group',
      entity_id: 'act_blocked',
      operation: 'update',
      status: 'blocked',
      validation_issues: [{ code: 'irreversible_action_blocked', severity: 'blocked' }]
    };
    const summary = summarizeCheckpointChanges([blockedChange], blockedChange.validation_issues);

    expect(summary.blocked).toBe(1);
    expect(summary.irreversible_actions_blocked).toBe(1);
    expect(validateCheckpoint({ checkpoint_id: '../bad', checkpoint_version: 'x' }).ok).toBe(false);
  });

  it('detects rollback conflicts when a changed entity drifted after the checkpoint', () => {
    const change = makeAppliedChange();

    expect(detectRollbackConflict(change, change.after)).toBeNull();
    const reason = detectRollbackConflict(change, {
      id: 'txn_1',
      description: 'User edited later',
      amount: 120
    });
    expect(reason).toMatchObject({ reason: 'entity_changed_after_checkpoint' });
    expect(
      createRollbackConflict(
        change,
        { id: 'txn_1', description: 'User edited later', amount: 120 },
        reason
      )
    ).toMatchObject({
      change_id: 'chg_1',
      safe_options: expect.arrayContaining(['manual_review'])
    });
  });
});
