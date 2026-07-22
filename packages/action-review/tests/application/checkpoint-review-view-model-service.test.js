// Tests for the checkpoint review view-model service.
// Locks down browser-safe checkpoint review panel display projection before renderer wiring.

import { describe, expect, it } from 'vitest';

import {
  buildCheckpointChangeRowViewModel,
  buildCheckpointReviewPanelViewModel,
  getCheckpointChangeTitle
} from '@cavalry/action-review/application/checkpoints/checkpoint-review-view-model-service.js';

function makeChange(overrides = {}) {
  return Object.assign(
    {
      change_id: 'chg_1',
      action_type: 'create_transaction',
      entity_type: 'transaction',
      entity_id: 'txn_1',
      operation: 'create',
      status: 'applied',
      human_summary: 'Created Coffee Shop transaction.',
      inverse_patch: { type: 'delete_entity' }
    },
    overrides
  );
}

function makeCheckpoint(overrides = {}) {
  return Object.assign(
    {
      checkpoint_id: 'cp_2026_07_01_000001',
      workbook_id: 'wb_1',
      created_at: '2026-07-01T09:00:00.000Z',
      status: 'applied_with_checkpoint',
      origin: 'chatgpt_companion',
      source_prompt: 'Add this transaction from ChatGPT.',
      summary: {
        applied: 1,
        blocked: 0,
        warnings: 0
      },
      changes: [makeChange()]
    },
    overrides
  );
}

describe('checkpoint review view-model service', () => {
  it('builds sorted selected checkpoint display data without mutating input', () => {
    const checkpoints = [
      makeCheckpoint({
        checkpoint_id: 'cp_old',
        created_at: '2026-07-01T09:00:00.000Z',
        summary: { applied: 1, blocked: 0, warnings: 0 }
      }),
      makeCheckpoint({
        checkpoint_id: 'cp_new_b',
        created_at: '2026-07-02T09:00:00.000Z',
        summary: { applied: 2, blocked: 1, warnings: 1 },
        changes: [
          makeChange({ change_id: 'chg_applied', inverse_patch: { type: 'update_entity' } }),
          makeChange({
            change_id: 'chg_blocked',
            status: 'blocked',
            human_summary: 'Blocked missing date.'
          })
        ]
      }),
      makeCheckpoint({
        checkpoint_id: 'cp_new_a',
        created_at: '2026-07-02T09:00:00.000Z'
      })
    ];
    const before = JSON.stringify(checkpoints);
    const viewModel = buildCheckpointReviewPanelViewModel(checkpoints, {
      selectedCheckpointId: 'missing-checkpoint'
    });

    expect(JSON.stringify(checkpoints)).toBe(before);
    expect(viewModel).toMatchObject({
      visible: true,
      badgeLabel: 'Checkpointed AI actions',
      selectedCheckpointId: 'cp_new_b',
      headerCopy:
        'ChatGPT applied reversible changes in Cavalry. Nothing was permanently deleted. Review the checkpoint and undo anything that does not look right.',
      sourcePrompt: 'Add this transaction from ChatGPT.',
      rollbackButton: {
        action: 'preview-checkpoint-rollback',
        checkpointId: 'cp_new_b',
        disabled: false
      },
      meta: {
        checkpointId: 'cp_new_b',
        createdAt: '2026-07-02T09:00:00.000Z',
        statusLabel: 'applied with checkpoint',
        origin: 'chatgpt_companion'
      }
    });
    expect(viewModel.metrics).toEqual([
      { id: 'applied', label: 'Applied', value: 2, icon: 'task_alt', tone: 'posted' },
      { id: 'blocked', label: 'Blocked', value: 1, icon: 'block', tone: 'needs_info' },
      { id: 'warnings', label: 'Warnings', value: 1, icon: 'error', tone: 'needs_info' },
      { id: 'reversible', label: 'Reversible', value: 1, icon: 'undo', tone: 'info' }
    ]);
    expect(viewModel.pickerItems.map((item) => item.checkpointId)).toEqual([
      'cp_new_b',
      'cp_new_a',
      'cp_old'
    ]);
    expect(viewModel.pickerItems[0]).toMatchObject({
      active: true,
      appliedCount: 2,
      blockedCount: 1
    });
  });

  it('preserves selected checkpoint and exposes fallback copy plus disabled rollback state', () => {
    const viewModel = buildCheckpointReviewPanelViewModel(
      [
        makeCheckpoint({
          checkpoint_id: 'cp_selected',
          origin: '',
          source_prompt: '',
          status: '',
          summary: {},
          changes: [
            makeChange({
              entity_id: 'txn_unsupported',
              inverse_patch: { type: 'unsupported_rollback' }
            })
          ]
        })
      ],
      {
        selectedCheckpointId: 'cp_selected'
      }
    );

    expect(viewModel).toMatchObject({
      selectedCheckpointId: 'cp_selected',
      sourcePrompt: 'Review the exact checkpoint before deciding what to keep.',
      rollbackButton: {
        disabled: true
      },
      meta: {
        statusLabel: 'applied',
        origin: 'chatgpt_companion'
      }
    });
    expect(viewModel.metrics.find((metric) => metric.id === 'reversible').value).toBe(0);
  });

  it('limits picker and change rows while exposing hidden change count', () => {
    const checkpoints = Array.from({ length: 9 }, (_item, index) =>
      makeCheckpoint({
        checkpoint_id: 'cp_' + String(index + 1),
        created_at: '2026-07-0' + String(index + 1) + 'T09:00:00.000Z'
      })
    );
    const changes = Array.from({ length: 13 }, (_item, index) =>
      makeChange({
        change_id: 'chg_' + String(index + 1),
        entity_id: 'txn_' + String(index + 1)
      })
    );
    checkpoints[8] = makeCheckpoint({
      checkpoint_id: 'cp_9',
      created_at: '2026-07-09T09:00:00.000Z',
      changes
    });

    const viewModel = buildCheckpointReviewPanelViewModel(checkpoints);

    expect(viewModel.selectedCheckpointId).toBe('cp_9');
    expect(viewModel.pickerItems).toHaveLength(8);
    expect(viewModel.visibleChangeRows).toHaveLength(12);
    expect(viewModel.hiddenChangeCount).toBe(1);
  });

  it('builds current change-row titles, status tones, and transaction targets', () => {
    expect(
      getCheckpointChangeTitle(
        makeChange({
          operation: 'update',
          entity_type: 'recurring_item'
        })
      )
    ).toBe('Update Recurring Item');

    expect(buildCheckpointChangeRowViewModel(makeChange())).toMatchObject({
      status: 'applied',
      statusLabel: 'applied',
      statusTone: 'info',
      icon: 'task_alt',
      title: 'Create Transaction',
      summary: 'Created Coffee Shop transaction.',
      target: {
        action: 'open-checkpoint-change-target',
        entityType: 'transaction',
        entityId: 'txn_1'
      }
    });
    expect(
      buildCheckpointChangeRowViewModel(
        makeChange({
          status: 'blocked',
          entity_type: 'budget',
          entity_id: 'budget_1',
          human_summary: '',
          operation: 'update'
        })
      )
    ).toMatchObject({
      statusLabel: 'blocked',
      statusTone: 'needs_info',
      icon: 'block',
      summary: 'budget_1',
      target: null
    });
    expect(
      buildCheckpointChangeRowViewModel(
        makeChange({
          status: 'rollback_conflict'
        })
      ).statusTone
    ).toBe('bad');
    expect(
      buildCheckpointChangeRowViewModel(
        makeChange({
          status: 'rolled_back'
        })
      )
    ).toMatchObject({
      statusTone: 'posted',
      icon: 'undo'
    });
  });

  it('returns an invisible model when no checkpoints are present', () => {
    expect(buildCheckpointReviewPanelViewModel([])).toEqual({
      visible: false,
      selectedCheckpointId: '',
      checkpoints: [],
      pickerItems: [],
      visibleChangeRows: []
    });
  });
});
