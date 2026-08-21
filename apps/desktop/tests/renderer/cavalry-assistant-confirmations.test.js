import { describe, expect, it } from 'vitest';

import {
  confirmationReplayArguments,
  pendingConfirmationFromResult
} from '../../src/renderer/features/assistant/cavalry-assistant-confirmations.js';

describe('Cavalry assistant confirmations', () => {
  it('preserves and replays the host-provided canonical proposal', () => {
    const proposal = {
      arguments: {
        id: 'memory-item-7',
        text: 'Keep a six-month emergency fund.',
        expectedRevision: 'revision-reviewed'
      }
    };
    const pending = pendingConfirmationFromResult({
      toolResults: [
        {
          callId: 'memory-update-call',
          toolName: 'update_memory_item',
          arguments: {
            id: 'wrong-model-id',
            text: 'Unreviewed model arguments',
            expectedRevision: 'stale-revision',
            confirmed: true
          },
          result: {
            confirmation: {
              required: true,
              field: 'confirmed',
              message: 'Confirm this memory update.',
              proposal
            }
          }
        }
      ]
    });

    expect(pending).toMatchObject({
      id: 'memory-update-call',
      toolName: 'update_memory_item',
      proposal,
      approvalField: 'confirmed'
    });
    expect(confirmationReplayArguments(pending)).toEqual({
      id: 'memory-item-7',
      text: 'Keep a six-month emergency fund.',
      expectedRevision: 'revision-reviewed',
      confirmed: true
    });
  });

  it('does not invent an approval field for malformed confirmation metadata', () => {
    const pending = pendingConfirmationFromResult({
      toolResults: [
        {
          toolName: 'unsafe_action',
          arguments: { value: 'change' },
          result: { confirmation: { required: true, field: '__proto__' } }
        }
      ]
    });

    expect(pending).toBeNull();
  });
});
