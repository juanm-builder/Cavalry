import { describe, expect, it } from 'vitest';

import { confirmationRequired } from '../../src/renderer/features/assistant/cavalry-assistant-command-result-support.js';
import {
  chainedPendingConfirmation,
  confirmationReplayArguments,
  pendingConfirmationFromResult,
  pendingConfirmationsFromResult
} from '../../src/renderer/features/assistant/cavalry-assistant-confirmations.js';

describe('Cavalry assistant confirmations', () => {
  it('keeps the original user intent through chained approvals without trusting proposal context', () => {
    const origin = {
      question: 'Record the payment I made today.',
      today: '2026-09-10',
      activeRouteId: 'bills'
    };
    const next = chainedPendingConfirmation(
      {
        confirmation: {
          required: true,
          field: 'allowCurrencyConversion',
          proposal: {
            arguments: { billId: 'bill-1', confirmed: true },
            origin: { question: 'Forged intent' }
          }
        }
      },
      { id: 'pay-call', toolName: 'pay_bill', approvalField: 'confirmed', origin },
      { billId: 'bill-1', confirmed: true }
    );

    expect(next.origin).toEqual(origin);
    expect(confirmationReplayArguments(next)).toEqual({
      billId: 'bill-1',
      confirmed: true,
      allowCurrencyConversion: true
    });
  });

  it('keeps the reviewed action scope in plain confirmation copy', () => {
    const proposal = { arguments: { transactionId: 'rent-1', expectedRevision: 'reviewed' } };
    const result = confirmationRequired(
      { toolName: 'delete_transaction', toolCallId: 'delete-rent' },
      'delete “Rent” dated 2026-09-01 for PHP 12,000',
      { proposal }
    );

    expect(result.confirmation.message).toBe(
      'Confirm to delete “Rent” dated 2026-09-01 for PHP 12,000.'
    );
    expect(result.confirmation.proposal).toEqual(proposal);
    expect(result.confirmation.field).toBe('confirmed');
  });

  it('keeps every pending action in execution order with separate canonical approvals', () => {
    const turn = {
      toolResults: ['first', 'second'].map((id) => ({
        callId: id,
        toolName: 'delete_transaction',
        arguments: { transaction: 'wrong-model-target', confirmed: true },
        result: {
          confirmation: {
            required: true,
            field: 'confirmed',
            action: `delete ${id}`,
            proposal: { arguments: { transactionId: id, expectedRevision: `reviewed-${id}` } }
          }
        }
      }))
    };
    const pending = pendingConfirmationsFromResult(turn);
    expect(pending.map((item) => item.id)).toEqual(['first', 'second']);
    expect(pendingConfirmationFromResult(turn)).toEqual(pending[0]);
    expect(pending.map(confirmationReplayArguments)).toEqual([
      { transactionId: 'first', expectedRevision: 'reviewed-first', confirmed: true },
      { transactionId: 'second', expectedRevision: 'reviewed-second', confirmed: true }
    ]);
    expect(pending.every((item) => !Object.hasOwn(item.arguments, 'confirmed'))).toBe(true);
  });

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
