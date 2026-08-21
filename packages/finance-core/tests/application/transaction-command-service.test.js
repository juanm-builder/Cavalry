import { describe, expect, it } from 'vitest';

import {
  deleteLedgerTransactionCommand,
  replaceLedgerTransactionCommand,
  submitManualTransactionCommand
} from '@cavalry/finance-core/application/transactions/transaction-command-service.js';
import { reconcileRecurringOccurrence } from '@cavalry/finance-core/application/recurring/recurring-reconciliation-service.js';
import { getAssetLiabilityTotalsAsOf } from '@cavalry/finance-core/domain/ledger/balances.js';
import { isTransactionBalanced } from '@cavalry/finance-core/domain/ledger/validation.js';
import {
  cloneFixture,
  makeMinimalWorkbook,
  makeRefundWorkbook
} from '../fixtures/core-workbook-fixtures.js';

function makeValidInput(overrides = {}) {
  return Object.assign(
    {
      template: 'expense_paid',
      amount: '120',
      currency: 'PHP',
      date: '2026-06-30',
      description: 'Coffee',
      categoryId: 'food',
      primaryAccountId: 'cash'
    },
    overrides
  );
}

describe('transaction command service', () => {
  it('creates a transaction immutably and returns domain events', () => {
    const workbook = makeMinimalWorkbook();
    const result = submitManualTransactionCommand(workbook, makeValidInput());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.workbook).not.toBe(workbook);
    expect(workbook.transactions).toHaveLength(0);
    expect(result.workbook.transactions).toHaveLength(1);
    expect(result.transaction).toMatchObject({
      id: 'txn_0',
      template: 'expense_paid',
      description: 'Coffee',
      categoryId: 'food',
      amount: 120
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'refresh-generated-daily-interest',
      'set-ledger-page',
      'navigate',
      'schedule-save',
      'render',
      'reset-form'
    ]);
    expect(result.events.find((event) => event.type === 'navigate')).toMatchObject({
      route: 'ledger'
    });
  });

  it('routes an expense assigned to a liability account as a charged expense', () => {
    const workbook = makeMinimalWorkbook();
    workbook.accounts.push({
      id: 'credit-card',
      name: 'Credit Card',
      group: 'liability',
      subtype: 'credit_card',
      currency: 'PHP',
      isActive: true
    });

    const result = submitManualTransactionCommand(
      workbook,
      makeValidInput({ primaryAccountId: 'credit-card' })
    );

    expect(result.ok).toBe(true);
    expect(result.intent.composerInput.template).toBe('expense_charged');
    expect(result.transaction).toMatchObject({
      template: 'expense_charged',
      lines: expect.arrayContaining([
        expect.objectContaining({ accountId: 'credit-card', direction: 'credit' })
      ])
    });
  });

  it('replaces a transaction with multiple validated records in one immutable command', () => {
    const workbook = makeMinimalWorkbook();
    const created = submitManualTransactionCommand(workbook, makeValidInput());
    const result = replaceLedgerTransactionCommand(created.workbook, created.transaction.id, [
      makeValidInput({ amount: 100, description: 'Coffee principal' }),
      makeValidInput({ amount: 20, description: 'Coffee fee' })
    ]);

    expect(result.ok).toBe(true);
    expect(result.atomic).toBe(true);
    expect(result.createdTransactions).toHaveLength(2);
    expect(result.workbook.transactions.map((transaction) => transaction.description)).toEqual([
      'Coffee principal',
      'Coffee fee'
    ]);
    expect(created.workbook.transactions).toEqual([created.transaction]);
    expect(result.events.filter((event) => event.type === 'schedule-save')).toHaveLength(1);
  });

  it('leaves the original transaction intact when any replacement is invalid', () => {
    const workbook = makeMinimalWorkbook();
    const created = submitManualTransactionCommand(workbook, makeValidInput());
    const before = cloneFixture(created.workbook);
    const result = replaceLedgerTransactionCommand(created.workbook, created.transaction.id, [
      makeValidInput({ amount: 100, description: 'Coffee principal' }),
      makeValidInput({ amount: 20, description: 'Coffee fee', categoryId: 'missing' })
    ]);

    expect(result).toMatchObject({
      ok: false,
      replacementIndex: 1,
      errors: [expect.objectContaining({ replacementIndex: 1 })]
    });
    expect(result.workbook).toBe(created.workbook);
    expect(created.workbook).toEqual(before);
  });

  it('assigns deterministic operation-scoped transaction and line IDs without reusing the target', () => {
    const created = submitManualTransactionCommand(makeMinimalWorkbook(), makeValidInput());
    const inputs = [
      makeValidInput({ amount: 100, description: 'Coffee principal' }),
      makeValidInput({ amount: 20, description: 'Coffee fee' })
    ];
    const services = { operationKey: 'replace-coffee-operation' };

    const first = replaceLedgerTransactionCommand(
      created.workbook,
      created.transaction.id,
      inputs,
      services
    );
    const secondPreview = replaceLedgerTransactionCommand(
      created.workbook,
      created.transaction.id,
      inputs,
      services
    );
    const allIds = first.createdTransactions.flatMap((transaction) => [
      transaction.id,
      ...transaction.lines.map((line) => line.id)
    ]);

    expect(first.ok).toBe(true);
    expect(allIds).toHaveLength(new Set(allIds).size);
    expect(allIds).not.toContain(created.transaction.id);
    expect(allIds).not.toEqual(
      expect.arrayContaining(created.transaction.lines.map((line) => line.id))
    );
    expect(secondPreview.createdTransactions.map((transaction) => transaction.id)).toEqual(
      first.createdTransactions.map((transaction) => transaction.id)
    );
    expect(first.createdTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'advisor',
          reference: expect.stringMatching(
            /^advisor:companion:replace-coffee-operation:replace:txn_0:fingerprint:/
          )
        })
      ])
    );
  });

  it('returns the prior atomic receipt when an operation key is retried after commit', () => {
    const created = submitManualTransactionCommand(makeMinimalWorkbook(), makeValidInput());
    const inputs = [makeValidInput({ description: 'Corrected coffee' })];
    const services = { operationKey: 'retryable-replacement' };
    const committed = replaceLedgerTransactionCommand(
      created.workbook,
      created.transaction.id,
      inputs,
      services
    );

    const retried = replaceLedgerTransactionCommand(
      committed.workbook,
      created.transaction.id,
      inputs,
      services
    );

    expect(retried).toMatchObject({
      ok: true,
      atomic: true,
      idempotent: true,
      operationKey: 'retryable-replacement',
      receipt: {
        targetTransactionId: created.transaction.id,
        replacementTransactionIds: [committed.createdTransactions[0].id]
      }
    });
    expect(retried.workbook).toBe(committed.workbook);
    expect(retried.createdTransactions).toEqual(committed.createdTransactions);
    expect(retried.fingerprint).toBe(committed.fingerprint);
    expect(retried.events).toEqual([]);
  });

  it('rejects operation-key reuse for different replacements or a different target', () => {
    const coffee = submitManualTransactionCommand(makeMinimalWorkbook(), makeValidInput());
    const tea = submitManualTransactionCommand(
      coffee.workbook,
      makeValidInput({ amount: 20, description: 'Tea' })
    );
    const inputs = [makeValidInput({ description: 'Corrected coffee' })];
    const services = { operationKey: 'single-use-operation-key' };
    const committed = replaceLedgerTransactionCommand(
      tea.workbook,
      coffee.transaction.id,
      inputs,
      services
    );
    const before = cloneFixture(committed.workbook);

    const changedProposal = replaceLedgerTransactionCommand(
      committed.workbook,
      coffee.transaction.id,
      [makeValidInput({ description: 'Different correction' })],
      services
    );
    const changedTarget = replaceLedgerTransactionCommand(
      committed.workbook,
      tea.transaction.id,
      inputs,
      services
    );

    for (const conflict of [changedProposal, changedTarget]) {
      expect(conflict).toMatchObject({
        ok: false,
        errors: [expect.objectContaining({ code: 'transaction.operation_key_conflict' })]
      });
      expect(conflict.workbook).toBe(committed.workbook);
    }
    expect(committed.workbook).toEqual(before);
  });

  it('rejects an approved replacement when the target or referenced workbook state changed', () => {
    const created = submitManualTransactionCommand(makeMinimalWorkbook(), makeValidInput());
    const inputs = [makeValidInput({ description: 'Prepared correction' })];
    const operationKey = 'preconditioned-replacement';
    const prepared = replaceLedgerTransactionCommand(
      created.workbook,
      created.transaction.id,
      inputs,
      { operationKey }
    );

    for (const mutate of [
      (workbook) => {
        workbook.transactions[0].note = 'Edited after preview';
      },
      (workbook) => {
        workbook.accounts.find((account) => account.id === 'cash').name = 'Renamed Cash';
      }
    ]) {
      const changedWorkbook = cloneFixture(created.workbook);
      mutate(changedWorkbook);
      const before = cloneFixture(changedWorkbook);
      const result = replaceLedgerTransactionCommand(
        changedWorkbook,
        created.transaction.id,
        inputs,
        {
          operationKey,
          expectedReplacementFingerprint: prepared.fingerprint,
          expectedTargetFingerprint: prepared.targetFingerprint
        }
      );

      expect(result).toMatchObject({
        ok: false,
        errors: [expect.objectContaining({ code: 'transaction.replacement_precondition_failed' })]
      });
      expect(result.workbook).toBe(changedWorkbook);
      expect(changedWorkbook).toEqual(before);
    }
  });

  it.each([0, 1, 2])(
    'rolls back the complete candidate when replacement stage %i is invalid',
    (invalidIndex) => {
      const created = submitManualTransactionCommand(makeMinimalWorkbook(), makeValidInput());
      const before = cloneFixture(created.workbook);
      const inputs = ['First split', 'Second split', 'Third split'].map((description, index) =>
        makeValidInput({
          amount: 40,
          description,
          ...(index === invalidIndex ? { categoryId: 'missing' } : {})
        })
      );

      const result = replaceLedgerTransactionCommand(
        created.workbook,
        created.transaction.id,
        inputs,
        { operationKey: `invalid-stage-${invalidIndex}` }
      );

      expect(result).toMatchObject({
        ok: false,
        replacementIndex: invalidIndex,
        errors: [expect.objectContaining({ replacementIndex: invalidIndex })]
      });
      expect(result.workbook).toBe(created.workbook);
      expect(created.workbook).toEqual(before);
    }
  );

  it('rolls back prepared replacements when a later duplicate still needs confirmation', () => {
    const coffee = submitManualTransactionCommand(makeMinimalWorkbook(), makeValidInput());
    const tea = submitManualTransactionCommand(
      coffee.workbook,
      makeValidInput({ amount: 20, description: 'Tea' })
    );
    const before = cloneFixture(tea.workbook);

    const result = replaceLedgerTransactionCommand(
      tea.workbook,
      coffee.transaction.id,
      [
        makeValidInput({ amount: 100, description: 'Coffee principal' }),
        makeValidInput({ amount: 20, description: 'Tea' })
      ],
      { operationKey: 'duplicate-at-second-stage' }
    );

    expect(result).toMatchObject({
      ok: true,
      confirmationPending: true,
      replacementIndex: 1,
      warnings: [expect.objectContaining({ code: 'possible_duplicate_transaction' })]
    });
    expect(result.workbook).toBe(tea.workbook);
    expect(tea.workbook).toEqual(before);
  });

  it('rejects replacement ID collisions and preserves the original workbook', () => {
    const created = submitManualTransactionCommand(makeMinimalWorkbook(), makeValidInput());
    const original = created.transaction;
    const before = cloneFixture(created.workbook);
    const result = replaceLedgerTransactionCommand(
      created.workbook,
      original.id,
      [makeValidInput({ description: 'Colliding replacement' })],
      {
        operationKey: 'collision-operation',
        buildTransaction(_workbook, fields) {
          return {
            id: original.id,
            date: fields.date,
            monthKey: fields.date.slice(0, 7),
            template: 'expense_paid',
            eventKind: 'purchase',
            description: fields.description,
            categoryId: fields.categoryId,
            originalCurrency: fields.currency,
            amount: Number(fields.amount),
            baseAmount: Number(fields.amount),
            source: 'advisor',
            reference: 'advisor:companion:collision-operation:replace:txn_0:fingerprint:collision',
            lines: original.lines.map((line) => ({ ...line }))
          };
        }
      }
    );

    expect(result).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ code: 'transaction.replacement_id_collision' })]
    });
    expect(result.workbook).toBe(created.workbook);
    expect(created.workbook).toEqual(before);
  });

  it('guards reimbursement and recurring-linked records from structural replacement', () => {
    const reimbursement = submitManualTransactionCommand(makeMinimalWorkbook(), makeValidInput());
    reimbursement.workbook.transactions[0].eventKind = 'reimbursement';
    const reimbursementBefore = cloneFixture(reimbursement.workbook);
    const blockedReimbursement = replaceLedgerTransactionCommand(
      reimbursement.workbook,
      reimbursement.transaction.id,
      [makeValidInput({ description: 'Reinterpreted reimbursement' })],
      { operationKey: 'replace-reimbursement' }
    );

    expect(blockedReimbursement).toMatchObject({
      ok: false,
      errors: [
        expect.objectContaining({ code: 'transaction.reimbursement_replacement_unsupported' })
      ]
    });
    expect(reimbursement.workbook).toEqual(reimbursementBefore);

    const recurring = submitManualTransactionCommand(makeMinimalWorkbook(), makeValidInput());
    recurring.workbook.transactions[0].recurringItemId = 'recurring-coffee';
    const recurringBefore = cloneFixture(recurring.workbook);
    const blockedRecurring = replaceLedgerTransactionCommand(
      recurring.workbook,
      recurring.transaction.id,
      [makeValidInput({ description: 'Reinterpreted recurring expense' })]
    );

    expect(blockedRecurring).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ code: 'transaction.recurring_replacement_unsupported' })]
    });
    expect(recurring.workbook).toEqual(recurringBefore);
  });

  it('records an occurrence-specific reconciliation when posting from a bill', () => {
    const workbook = makeMinimalWorkbook();
    workbook.accounts.push(
      { id: 'bank', name: 'Bank', group: 'asset', currency: 'PHP', isActive: true },
      {
        id: 'salary-income',
        name: 'Salary Income',
        group: 'income',
        currency: 'PHP',
        isActive: true
      }
    );
    workbook.categories.push({
      id: 'salary',
      name: 'Salary',
      type: 'income',
      currency: 'PHP',
      linkedAccountId: 'salary-income',
      isActive: true
    });
    workbook.recurringItems = [
      {
        id: 'recurring-coffee',
        kind: 'bill',
        name: 'Coffee plan',
        categoryId: 'food',
        accountId: 'cash',
        amount: 120,
        frequency: 'Monthly',
        anchorDate: '2026-06-30',
        isActive: true
      }
    ];

    const result = submitManualTransactionCommand(
      workbook,
      makeValidInput({
        recurringTrackingMode: 'link',
        recurringItemId: 'recurring-coffee',
        recurringOccurrenceDate: '2026-06-30',
        sourceRoute: 'bills'
      })
    );

    expect(result.ok).toBe(true);
    expect(result.transaction.recurringItemId).toBe('recurring-coffee');
    expect(result.transaction.recurringOccurrenceDate).toBe('2026-06-30');
    expect(result.workbook.recurringReconciliations).toEqual([
      expect.objectContaining({
        recurringItemId: 'recurring-coffee',
        occurrenceDate: '2026-06-30',
        transactionId: result.transaction.id,
        decision: 'matched',
        method: 'explicit',
        allocatedBaseAmount: 120,
        confidence: 100
      })
    ]);
    expect(result.events.find((event) => event.type === 'navigate')).toMatchObject({
      route: 'bills'
    });

    const edited = submitManualTransactionCommand(
      result.workbook,
      makeValidInput({
        transactionId: result.transaction.id,
        amount: '60',
        description: 'Coffee plan partial payment'
      }),
      { now: '2026-07-01T00:00:00.000Z' }
    );
    const occurrence = {
      id: 'recurring-coffee:2026-06-30:0',
      recurringItemId: 'recurring-coffee',
      recurringItem: workbook.recurringItems[0],
      name: 'Coffee plan',
      categoryId: 'food',
      accountId: 'cash',
      dueDate: '2026-06-30',
      amount: 120
    };

    expect(edited.ok).toBe(true);
    expect(edited.transaction.recurringItemId).toBe('recurring-coffee');
    expect(edited.workbook.recurringReconciliations[0]).toMatchObject({
      transactionId: result.transaction.id,
      allocatedBaseAmount: 60,
      updatedAt: '2026-07-01T00:00:00.000Z'
    });
    expect(reconcileRecurringOccurrence(edited.workbook, occurrence)).toMatchObject({
      decision: 'partial',
      settlement: { allocatedBaseAmount: 60, remainingBaseAmount: 60 }
    });

    const retyped = submitManualTransactionCommand(
      result.workbook,
      {
        transactionId: result.transaction.id,
        template: 'income_received',
        amount: '120',
        currency: 'PHP',
        date: '2026-06-30',
        description: 'Salary correction',
        categoryId: 'salary',
        primaryAccountId: 'bank'
      },
      { now: '2026-07-02T00:00:00.000Z' }
    );

    expect(retyped.ok).toBe(true);
    expect(retyped.workbook.recurringReconciliations[0]).toMatchObject({
      transactionId: result.transaction.id,
      decision: 'rejected',
      allocatedBaseAmount: 0,
      invalidatedReason: 'unsupported_template',
      updatedAt: '2026-07-02T00:00:00.000Z'
    });
    expect(reconcileRecurringOccurrence(retyped.workbook, occurrence)).toMatchObject({
      decision: 'unmatched',
      settlement: { allocatedBaseAmount: 0 }
    });
  });

  it('edits an existing transaction without mutating the prior workbook', () => {
    const workbook = makeMinimalWorkbook();
    const created = submitManualTransactionCommand(workbook, makeValidInput());
    const originalId = created.transaction.id;
    const edited = submitManualTransactionCommand(
      created.workbook,
      makeValidInput({
        transactionId: originalId,
        amount: '155',
        description: 'Coffee refill'
      })
    );

    expect(edited.ok).toBe(true);
    expect(edited.workbook).not.toBe(created.workbook);
    expect(created.workbook.transactions[0].description).toBe('Coffee');
    expect(edited.workbook.transactions).toHaveLength(1);
    expect(edited.workbook.transactions[0]).toMatchObject({
      id: originalId,
      amount: 155,
      description: 'Coffee refill'
    });
    expect(edited.isEdit).toBe(true);
    expect(edited.events.map((event) => event.type)).toEqual([
      'refresh-generated-daily-interest',
      'refresh-generated-daily-interest',
      'set-ledger-page',
      'navigate',
      'schedule-save',
      'render'
    ]);
  });

  it('returns validation errors without mutating the workbook', () => {
    const workbook = makeMinimalWorkbook();
    const before = cloneFixture(workbook);
    const result = submitManualTransactionCommand(
      workbook,
      makeValidInput({
        categoryId: 'missing'
      })
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      {
        code: 'invalid_expense_category',
        field: 'categoryId',
        message: 'Pick an expense category.'
      }
    ]);
    expect(workbook).toEqual(before);
  });

  it('returns duplicate confirmation events before producing a mutation', () => {
    const workbook = makeMinimalWorkbook();
    const created = submitManualTransactionCommand(workbook, makeValidInput());
    const before = cloneFixture(created.workbook);
    const duplicate = submitManualTransactionCommand(created.workbook, makeValidInput());

    expect(duplicate.ok).toBe(true);
    expect(duplicate.warnings[0]).toMatchObject({
      code: 'possible_duplicate_transaction',
      transactionId: 'txn_0'
    });
    expect(duplicate.events).toEqual([
      {
        type: 'confirm-duplicate-transaction',
        warning: duplicate.warnings[0]
      }
    ]);
    expect(created.workbook).toEqual(before);
    const allowed = submitManualTransactionCommand(
      created.workbook,
      makeValidInput({
        allowDuplicate: true
      })
    );
    expect(allowed.ok).toBe(true);
    expect(allowed.workbook).not.toBe(created.workbook);
    expect(allowed.workbook.transactions).toHaveLength(2);
  });

  it('deletes a transaction immutably and returns save/render events', () => {
    const workbook = makeMinimalWorkbook();
    const created = submitManualTransactionCommand(workbook, makeValidInput());
    created.workbook.recurringReconciliations = [
      {
        id: 'match-coffee',
        recurringItemId: 'recurring-coffee',
        occurrenceDate: '2026-06-30',
        transactionId: created.transaction.id,
        decision: 'matched',
        method: 'manual'
      }
    ];
    const result = deleteLedgerTransactionCommand(created.workbook, created.transaction.id);

    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(created.workbook);
    expect(created.workbook.transactions).toHaveLength(1);
    expect(result.workbook.transactions).toEqual([]);
    expect(created.workbook.recurringReconciliations).toHaveLength(1);
    expect(result.workbook.recurringReconciliations).toEqual([]);
    expect(result.transaction.id).toBe(created.transaction.id);
    expect(result.events.map((event) => event.type)).toEqual([
      'refresh-generated-daily-interest',
      'close-modal',
      'schedule-save',
      'render'
    ]);
  });

  it('keeps a transfer net-worth-neutral and reverses both sides of a deleted expense', () => {
    const workbook = makeMinimalWorkbook();
    workbook.accounts.push(
      { id: 'freedom-fund', name: 'Freedom Fund', group: 'asset', currency: 'PHP', isActive: true },
      { id: 'travel-fund', name: 'Travel Fund', group: 'asset', currency: 'PHP', isActive: true }
    );
    workbook.transactions.push(
      {
        id: 'opening-freedom',
        date: '2026-01-01',
        template: 'opening_balance',
        amount: 200000,
        baseAmount: 200000,
        lines: [
          {
            accountId: 'freedom-fund',
            direction: 'debit',
            amount: 200000,
            currency: 'PHP',
            baseAmount: 200000
          },
          {
            accountId: 'opening_balance_equity',
            direction: 'credit',
            amount: 200000,
            currency: 'PHP',
            baseAmount: 200000
          }
        ]
      },
      {
        id: 'opening-travel',
        date: '2026-01-01',
        template: 'opening_balance',
        amount: 20000,
        baseAmount: 20000,
        lines: [
          {
            accountId: 'travel-fund',
            direction: 'debit',
            amount: 20000,
            currency: 'PHP',
            baseAmount: 20000
          },
          {
            accountId: 'opening_balance_equity',
            direction: 'credit',
            amount: 20000,
            currency: 'PHP',
            baseAmount: 20000
          }
        ]
      }
    );
    const accommodation = submitManualTransactionCommand(
      workbook,
      makeValidInput({
        amount: '14306.68',
        date: '2026-07-06',
        description: 'Accommodation to Taiwan',
        primaryAccountId: 'travel-fund'
      })
    );
    const beforeTransferNetWorth = getAssetLiabilityTotalsAsOf(
      accommodation.workbook,
      '2026-07-12'
    ).netWorth;
    const transfer = submitManualTransactionCommand(accommodation.workbook, {
      template: 'transfer',
      amount: '150000',
      currency: 'PHP',
      date: '2026-07-11',
      description: 'Freedom Fund to Travel Fund',
      primaryAccountId: 'freedom-fund',
      secondaryAccountId: 'travel-fund'
    });

    expect(transfer.ok).toBe(true);
    expect(isTransactionBalanced(transfer.transaction)).toBe(true);
    expect(transfer.transaction.lines).toEqual([
      expect.objectContaining({
        accountId: 'travel-fund',
        direction: 'debit',
        amount: 150000,
        baseAmount: 150000
      }),
      expect.objectContaining({
        accountId: 'freedom-fund',
        direction: 'credit',
        amount: 150000,
        baseAmount: 150000
      })
    ]);
    expect(getAssetLiabilityTotalsAsOf(transfer.workbook, '2026-07-12').netWorth).toBe(
      beforeTransferNetWorth
    );

    const deleted = deleteLedgerTransactionCommand(transfer.workbook, accommodation.transaction.id);
    expect(deleted.ok).toBe(true);
    expect(
      deleted.workbook.transactions.some((item) => item.id === accommodation.transaction.id)
    ).toBe(false);
    expect(deleted.workbook.transactions.some((item) => item.id === transfer.transaction.id)).toBe(
      true
    );
    expect(getAssetLiabilityTotalsAsOf(deleted.workbook, '2026-07-12').netWorth).toBe(220000);
  });

  it('blocks new postings to an account whose configured and historical currencies disagree', () => {
    const workbook = makeMinimalWorkbook();
    workbook.accounts.find((account) => account.id === 'cash').currency = 'USD';
    workbook.transactions.push({
      id: 'txn-prior-cash',
      date: '2026-06-01',
      template: 'opening_balance',
      description: 'Prior PHP cash',
      amount: 112,
      baseAmount: 112,
      originalCurrency: 'PHP',
      lines: [
        {
          id: 'line-prior-cash',
          accountId: 'cash',
          direction: 'debit',
          amount: 112,
          currency: 'PHP',
          baseAmount: 112
        },
        {
          id: 'line-prior-equity',
          accountId: 'opening_balance_equity',
          direction: 'credit',
          amount: 112,
          currency: 'PHP',
          baseAmount: 112
        }
      ]
    });
    const before = cloneFixture(workbook);

    const result = submitManualTransactionCommand(workbook, makeValidInput());

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'account_currency_repair_required',
        accountId: 'cash',
        configuredCurrency: 'USD',
        postingCurrencies: ['PHP'],
        affectedTransactionIds: ['txn-prior-cash']
      })
    ]);
    expect(workbook).toEqual(before);
  });

  it('requires both an explicit rate and confirmation for a cross-currency account posting', () => {
    const workbook = makeMinimalWorkbook();
    workbook.accounts.push({
      id: 'usd-wallet',
      name: 'USD Wallet',
      group: 'asset',
      currency: 'USD',
      isActive: true
    });
    const input = makeValidInput({ primaryAccountId: 'usd-wallet' });

    const missingRate = submitManualTransactionCommand(workbook, input);
    expect(missingRate.ok).toBe(false);
    expect(missingRate.errors[0]).toMatchObject({
      code: 'account_currency_conversion_rate_required',
      field: 'fxRateToBase'
    });

    const confirmation = submitManualTransactionCommand(workbook, {
      ...input,
      fxRateToBase: 61.75
    });
    expect(confirmation.ok).toBe(true);
    expect(confirmation.workbook).toBe(workbook);
    expect(confirmation.intent.currencyConversionWarning).toMatchObject({
      code: 'account_currency_conversion_confirmation_required',
      transactionCurrency: 'PHP',
      fxRateToBase: 61.75,
      rateDisclosure: '1 USD = PHP 61.75',
      accounts: [{ accountId: 'usd-wallet', accountName: 'USD Wallet', accountCurrency: 'USD' }]
    });
    expect(confirmation.intent.currencyConversionWarning.message).toContain(
      'Transaction currency: PHP'
    );
    expect(confirmation.intent.currencyConversionWarning.message).toContain(
      'USD Wallet (configured USD)'
    );
    expect(confirmation.intent.currencyConversionWarning.message).toContain('1 USD = PHP 61.75');
    expect(confirmation.events[0].type).toBe('confirm-currency-conversion');

    const nonBooleanApproval = submitManualTransactionCommand(workbook, {
      ...input,
      fxRateToBase: 61.75,
      allowCurrencyConversion: 'true'
    });
    expect(nonBooleanApproval.workbook).toBe(workbook);
    expect(nonBooleanApproval.warnings[0].code).toBe(
      'account_currency_conversion_confirmation_required'
    );

    const posted = submitManualTransactionCommand(workbook, {
      ...input,
      fxRateToBase: 61.75,
      allowCurrencyConversion: true
    });
    expect(posted.ok).toBe(true);
    expect(posted.transaction.fxRateToBase).toBe(61.75);
    expect(posted.transaction.lines.find((line) => line.accountId === 'usd-wallet')).toMatchObject({
      amount: 1.94,
      currency: 'USD',
      baseAmount: 120
    });
  });

  it('preserves native lines and stored FX during a metadata-only edit', () => {
    const workbook = makeMinimalWorkbook();
    workbook.settings.usdToBaseRate = 70;
    workbook.accounts.find((account) => account.id === 'cash').currency = 'USD';
    workbook.accounts.push({
      id: 'random-income',
      name: 'Random Finds Income',
      group: 'income',
      currency: 'PHP',
      isActive: true
    });
    workbook.categories.push({
      id: 'random-finds',
      name: 'Random Finds',
      type: 'income',
      linkedAccountId: 'random-income',
      isActive: true
    });
    workbook.transactions.push({
      id: 'txn-found-cash',
      date: '2026-07-15',
      monthKey: '2026-07',
      template: 'income_received',
      description: 'Found cash',
      categoryId: 'random-finds',
      originalCurrency: 'PHP',
      amount: 20,
      baseAmount: 20,
      fxRateToBase: 0,
      lines: [
        {
          id: 'line-found-cash',
          accountId: 'cash',
          direction: 'debit',
          amount: 0.32,
          currency: 'USD',
          baseAmount: 20
        },
        {
          id: 'line-found-income',
          accountId: 'random-income',
          direction: 'credit',
          amount: 20,
          currency: 'PHP',
          baseAmount: 20
        }
      ]
    });

    const edited = submitManualTransactionCommand(workbook, {
      transactionId: 'txn-found-cash',
      template: 'income_received',
      amount: 20,
      currency: 'PHP',
      date: '2026-07-15',
      description: 'Found cash in old bag',
      categoryId: 'random-finds',
      primaryAccountId: 'cash'
    });

    expect(edited.ok).toBe(true);
    expect(edited.intent.preserveExistingPostings).toBe(true);
    expect(edited.intent.currencyConversionWarning).toBeNull();
    expect(edited.transaction.description).toBe('Found cash in old bag');
    expect(edited.transaction.fxRateToBase).toBe(0);
    expect(edited.transaction.lines).toEqual(workbook.transactions[0].lines);
    expect(edited.transaction.lines[0]).toMatchObject({
      amount: 0.32,
      currency: 'USD',
      baseAmount: 20
    });
  });

  it('preserves refund postings during a metadata-only edit', () => {
    const workbook = makeRefundWorkbook();
    const existing = workbook.transactions.find(
      (transaction) => transaction.id === 'txn-refund-unclear'
    );
    const edited = submitManualTransactionCommand(workbook, {
      transactionId: existing.id,
      template: existing.template,
      amount: existing.amount,
      currency: existing.originalCurrency,
      date: existing.date,
      description: 'Store refund received',
      categoryId: existing.categoryId,
      primaryAccountId: 'cash'
    });

    expect(edited.ok).toBe(true);
    expect(edited.intent.preserveExistingPostings).toBe(true);
    expect(edited.transaction.description).toBe('Store refund received');
    expect(edited.transaction.lines).toEqual(existing.lines);
    expect(edited.transaction.lines[0]).toMatchObject({
      accountId: 'cash',
      direction: 'debit',
      baseAmount: 50
    });
  });
});
