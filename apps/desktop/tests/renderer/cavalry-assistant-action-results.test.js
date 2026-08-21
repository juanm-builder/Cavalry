import { describe, expect, it } from 'vitest';

import {
  cavalryAssistantActionReceiptMessage,
  normalizeCavalryAssistantActionResult
} from '../../src/renderer/features/assistant/cavalry-assistant-action-results.js';

describe('Cavalry assistant action results', () => {
  it('keeps a confirmation proposal distinct from failure and completion', () => {
    const result = normalizeCavalryAssistantActionResult(
      {
        ok: false,
        status: 'confirmation_required',
        changed: false,
        confirmation: { required: true },
        errors: [{ code: 'confirmation_required', message: 'Confirm this replacement.' }]
      },
      { toolName: 'replace_transaction', access: 'write', title: 'Replace transaction' }
    );

    expect(result).toMatchObject({
      lifecycle: 'awaiting_confirmation',
      commitStatus: 'not_attempted',
      verificationStatus: 'not_attempted',
      changed: false
    });
    expect(result.receipt.access).toBe('write');
    expect(cavalryAssistantActionReceiptMessage(result.receipt)).toContain('Please confirm');
  });

  it('grounds a completed receipt in the returned entity and exact account', () => {
    const result = normalizeCavalryAssistantActionResult(
      {
        ok: true,
        status: 'completed',
        changed: true,
        commitStatus: 'committed',
        verificationStatus: 'verified',
        persistence: { status: 'saved', durable: true },
        data: {
          transaction: {
            id: 'txn_42',
            description: 'Flight tickets',
            amount: 24500,
            currency: 'PHP',
            date: '2026-08-21',
            lines: [
              {
                accountId: 'card_bpi',
                accountName: 'BPI Platinum Card',
                role: 'destination'
              }
            ]
          }
        }
      },
      {
        actionId: 'transactions.ledger.create',
        toolName: 'create_transaction',
        actionVerb: 'Recorded',
        access: 'write'
      }
    );

    expect(result.receipt).toMatchObject({
      access: 'write',
      lifecycle: 'completed',
      commitStatus: 'committed',
      verificationStatus: 'verified',
      entity: { id: 'txn_42', label: 'Flight tickets' },
      accounts: [{ id: 'card_bpi', name: 'BPI Platinum Card', role: 'destination' }]
    });
    const message = cavalryAssistantActionReceiptMessage(result.receipt);
    expect(message).toContain('Recorded “Flight tickets”');
    expect(message).toContain('BPI Platinum Card');
    expect(message).toContain('PHP');
  });

  it('presents a successful write no-op as already current without claiming save or failure', () => {
    const result = normalizeCavalryAssistantActionResult(
      {
        ok: true,
        status: 'unchanged',
        changed: false,
        commitStatus: 'not_applicable',
        verificationStatus: 'verified',
        data: {
          action: 'already_present',
          memory: { id: 'memory_item_1', label: 'Use concise replies' }
        }
      },
      {
        actionId: 'memory.local.remember',
        toolName: 'remember_memory',
        title: 'Remember memory',
        actionVerb: 'Remembered',
        access: 'write'
      }
    );

    expect(result).toMatchObject({
      ok: true,
      lifecycle: 'completed',
      changed: false,
      commitStatus: 'not_applicable',
      verificationStatus: 'verified',
      persistence: { status: 'not_required', durable: true }
    });
    const message = cavalryAssistantActionReceiptMessage(result.receipt);
    expect(message).toBe('No change was needed for “Use concise replies”. It was already current.');
    expect(message).not.toMatch(/saved|failed|could not/i);
  });

  it('reports rollback plainly and strips technical error artifacts', () => {
    const result = normalizeCavalryAssistantActionResult(
      {
        ok: false,
        status: 'rolled_back',
        changed: false,
        data: { transaction: { id: 'txn_original', description: 'Original record' } },
        errors: [
          {
            code: 'replacement_failed',
            message: 'The second replacement was invalid.',
            stack: 'private stack',
            payload: { raw: true }
          }
        ]
      },
      { toolName: 'replace_transaction', access: 'write' }
    );

    expect(result).toMatchObject({
      lifecycle: 'rolled_back',
      commitStatus: 'rolled_back',
      changed: false
    });
    expect(result.errors[0]).not.toHaveProperty('stack');
    expect(result.errors[0]).not.toHaveProperty('payload');
    expect(cavalryAssistantActionReceiptMessage(result.receipt)).toContain(
      'kept the original record'
    );
  });

  it('reports every grounded replacement rather than collapsing a structural correction', () => {
    const result = normalizeCavalryAssistantActionResult(
      {
        ok: true,
        status: 'completed',
        changed: true,
        commitStatus: 'committed',
        verificationStatus: 'verified',
        persistence: { status: 'saved', durable: true },
        data: {
          replacedTransaction: { id: 'txn_old', description: 'Combined purchase' },
          replacements: [
            {
              id: 'txn_food',
              description: 'Groceries',
              amount: 800,
              currency: 'PHP',
              date: '2026-08-21',
              accounts: [{ id: 'wallet', name: 'Main Wallet', role: 'funding' }]
            },
            {
              id: 'txn_ride',
              description: 'Taxi',
              amount: 200,
              currency: 'PHP',
              date: '2026-08-21',
              accounts: [{ id: 'card', name: 'Travel Card', role: 'charged' }]
            }
          ]
        }
      },
      { toolName: 'replace_transaction', actionVerb: 'Replaced', access: 'write' }
    );

    expect(result.receipt).toMatchObject({
      entity: { id: 'txn_old', label: 'Combined purchase' },
      items: [
        {
          id: 'txn_food',
          label: 'Groceries',
          amount: 800,
          currency: 'PHP',
          accounts: [{ id: 'wallet', name: 'Main Wallet', role: 'funding' }]
        },
        {
          id: 'txn_ride',
          label: 'Taxi',
          amount: 200,
          currency: 'PHP',
          accounts: [{ id: 'card', name: 'Travel Card', role: 'charged' }]
        }
      ]
    });
    const message = cavalryAssistantActionReceiptMessage(result.receipt);
    expect(message).toContain('Replaced “Combined purchase”');
    expect(message).toContain('Groceries · PHP 800 · Main Wallet · 2026-08-21');
    expect(message).toContain('Taxi · PHP 200 · Travel Card · 2026-08-21');
  });

  it('does not call a committed but unverified mutation fully verified', () => {
    const result = normalizeCavalryAssistantActionResult(
      {
        ok: false,
        status: 'verification_failed',
        changed: true,
        commitStatus: 'committed',
        verificationStatus: 'failed',
        persistence: { status: 'saved', durable: true },
        data: { account: { id: 'acct_1', name: 'Main Wallet' } }
      },
      { toolName: 'update_account', access: 'write' }
    );

    expect(result.receipt).toMatchObject({
      lifecycle: 'failed',
      commitStatus: 'committed',
      verificationStatus: 'failed'
    });
    expect(cavalryAssistantActionReceiptMessage(result.receipt)).toContain('saved the change');
    expect(cavalryAssistantActionReceiptMessage(result.receipt)).toContain('could not verify');
  });

  it('fails closed when a write result lacks durable commit evidence', () => {
    const result = normalizeCavalryAssistantActionResult(
      {
        ok: true,
        status: 'completed',
        changed: true,
        data: { transaction: { id: 'txn_unproven', description: 'Unproven change' } }
      },
      {
        toolName: 'create_transaction',
        actionVerb: 'Recorded',
        access: 'write'
      }
    );

    expect(result.receipt).toMatchObject({
      lifecycle: 'failed',
      commitStatus: 'not_committed',
      verificationStatus: 'not_attempted'
    });
    expect(result).toMatchObject({
      ok: false,
      status: 'commit_unconfirmed',
      errors: [expect.objectContaining({ code: 'durable_commit_receipt_required' })]
    });
    expect(cavalryAssistantActionReceiptMessage(result.receipt)).toContain(
      'could not prove that this change was durably saved'
    );
  });

  it('does not trust status labels without an allowlisted durable persistence receipt', () => {
    const result = normalizeCavalryAssistantActionResult(
      {
        ok: true,
        status: 'completed',
        changed: true,
        commitStatus: 'committed',
        verificationStatus: 'verified',
        persistence: {
          status: 'saved',
          durable: false,
          path: '/private/workbook.cavalry',
          raw: { secret: true }
        },
        data: { account: { id: 'acct_1', name: 'Wallet' } }
      },
      { toolName: 'update_account', actionVerb: 'Updated', access: 'write' }
    );

    expect(result.receipt.persistence).toEqual({ status: 'unconfirmed', durable: false });
    expect(cavalryAssistantActionReceiptMessage(result.receipt)).toContain(
      'could not prove that this change was durably saved'
    );
  });

  it('projects only the public result envelope and allowlisted issue fields', () => {
    const result = normalizeCavalryAssistantActionResult(
      {
        ok: false,
        status: 'failed',
        changed: false,
        toolName: 'update_account',
        workbook: { secret: 'must not cross the boundary' },
        debug: { commandOutput: 'private' },
        data: {
          account: { id: 'acct_1', name: 'Wallet' },
          nested: {
            workbook: { secret: 'private' },
            raw: { token: 'private' },
            debug: 'private',
            safeLabel: 'Visible'
          }
        },
        errors: [
          {
            code: 'account_currency_repair_required',
            message: 'Repair the account currency.',
            accountId: 'acct_1',
            stack: 'private stack',
            payload: { token: 'private' },
            unknownSecret: 'private'
          }
        ]
      },
      { toolName: 'update_account', access: 'write' }
    );

    expect(result).not.toHaveProperty('workbook');
    expect(result).not.toHaveProperty('debug');
    expect(result.data).toEqual({
      account: { id: 'acct_1', name: 'Wallet' },
      nested: { safeLabel: 'Visible' }
    });
    expect(result.errors[0]).toEqual({
      code: 'account_currency_repair_required',
      message: 'Repair the account currency.',
      accountId: 'acct_1'
    });
  });

  it('sanitizes persisted error and confirmation messages before presentation', () => {
    const credential = `${'s'}${'k'}-${'A'.repeat(24)}`;
    const privatePath = ['', 'Users', 'private-user', 'provider.js:42'].join('/');
    const unsafeBody = `<html><body>${credential}</body></html>\n    at ${privatePath}`;
    const result = normalizeCavalryAssistantActionResult(
      {
        ok: false,
        status: 'failed',
        changed: false,
        errors: [
          { code: 'provider_body', message: unsafeBody },
          { code: 'provider_key', message: `Provider rejected ${credential}` }
        ],
        confirmation: {
          required: true,
          action: '<script>approve()</script>',
          message: `Approve with token=${credential}`
        }
      },
      { toolName: 'update_account', access: 'write' }
    );

    expect(result.errors.map((error) => error.message)).toEqual([
      'Cavalry could not complete that action.',
      'Provider rejected [redacted credential]'
    ]);
    expect(result.confirmation).toMatchObject({
      action: 'complete this action',
      message: 'Approve with token=[redacted]'
    });
    expect(cavalryAssistantActionReceiptMessage(result.receipt)).toBe(
      'Cavalry could not complete that action.'
    );
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(JSON.stringify(result)).not.toContain(privatePath);
    expect(JSON.stringify(result)).not.toMatch(/<html|<script|provider\.js/i);
  });
});
