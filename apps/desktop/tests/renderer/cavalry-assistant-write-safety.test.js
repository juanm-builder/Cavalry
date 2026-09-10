import { describe, expect, it, vi } from 'vitest';
import {
  executeCavalryAssistantTool,
  getCavalryAssistantToolDefinitions
} from '../../src/renderer/features/assistant/cavalry-assistant-tools.js';
import { cavalryAssistantActionReceiptMessage } from '../../src/renderer/features/assistant/cavalry-assistant-action-results.js';

function makeWorkbook() {
  return {
    id: 'write-safety',
    version: 2,
    name: 'Synthetic ledger',
    year: 2026,
    currency: 'PHP',
    settings: { usdToBaseRate: 58 },
    accounts: [
      {
        id: 'equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        subtype: 'opening_balance',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      },
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        isActive: true,
        openedDate: '2026-01-01'
      },
      {
        id: 'bank',
        name: 'Main Bank',
        group: 'asset',
        subtype: 'bank',
        currency: 'PHP',
        isActive: true,
        openedDate: '2026-01-01',
        note: 'Keep note'
      },
      {
        id: 'expense',
        name: 'Food Expense',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'expense',
        isActive: true
      }
    ],
    transactions: [
      {
        id: 'purchase',
        date: '2026-09-10',
        monthKey: '2026-09',
        template: 'expense_paid',
        description: 'Groceries',
        categoryId: 'food',
        amount: 100,
        baseAmount: 100,
        originalCurrency: 'PHP',
        note: 'Original note',
        lines: [
          {
            id: 'expense-line',
            accountId: 'expense',
            direction: 'debit',
            amount: 100,
            baseAmount: 100,
            currency: 'PHP'
          },
          {
            id: 'cash-line',
            accountId: 'cash',
            direction: 'credit',
            amount: 100,
            baseAmount: 100,
            currency: 'PHP'
          }
        ]
      }
    ],
    counterparties: [],
    recurringItems: [],
    sheets: [],
    aiDrafts: [],
    externalDraftGroups: []
  };
}

function harness(initial = makeWorkbook()) {
  let workbook = initial;
  let sequence = 0;
  const commit = vi.fn((result) => {
    workbook = result.workbook;
    return {
      ...result,
      commitStatus: 'committed',
      verificationStatus: 'verified',
      persistence: { status: 'saved', durable: true }
    };
  });
  const context = {
    getWorkbook: () => workbook,
    commitCommandResult: commit,
    services: {
      createId: (prefix) => `${prefix}-${++sequence}`,
      defaultDate: () => '2026-09-10',
      today: () => '2026-09-10'
    }
  };
  return {
    get workbook() {
      return workbook;
    },
    commit,
    call(name, argumentsValue, extra = {}) {
      return executeCavalryAssistantTool(
        { name, arguments: argumentsValue },
        { ...context, ...extra }
      );
    }
  };
}

describe('assistant financial write safety', () => {
  it('rejects contradictory account/transaction references rather than silently choosing one', async () => {
    const h = harness();
    const before = structuredClone(h.workbook);
    expect(
      await h.call('update_account', { accountId: 'bank', account: 'Cash', note: 'Wrong target' })
    ).toMatchObject({ ok: false, errors: [{ code: 'conflicting_references' }] });
    expect(
      await h.call('delete_transaction', {
        transactionId: 'purchase',
        transaction: 'Unknown purchase'
      })
    ).toMatchObject({ ok: false });
    expect(h.workbook).toEqual(before);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('allows exact IDs to disambiguate identical names and preserves other account fields', async () => {
    const h = harness();
    h.workbook.accounts.push({ ...h.workbook.accounts[2], id: 'bank-other' });
    expect(
      await h.call('update_account', { account: 'Main Bank', note: 'New note' })
    ).toMatchObject({ ok: false, status: 'ambiguous_reference' });
    const result = await h.call('update_account', { accountId: 'bank', note: 'New note' });
    expect(result).toMatchObject({ ok: true });
    expect(h.workbook.accounts.find((account) => account.id === 'bank')).toMatchObject({
      name: 'Main Bank',
      note: 'New note',
      currency: 'PHP',
      openedDate: '2026-01-01'
    });
    expect(h.workbook.accounts.find((account) => account.id === 'bank-other').note).toBe(
      'Keep note'
    );
  });

  it('does not create a second account or opening balance on a repeated create request', async () => {
    const h = harness();
    const args = {
      name: 'Reserve',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      openingBalance: 500
    };
    expect(await h.call('create_account', args)).toMatchObject({ ok: true });
    const saved = structuredClone(h.workbook);
    expect(await h.call('create_account', args)).toMatchObject({
      ok: false,
      changed: false,
      errors: [{ code: 'account_name_exists' }]
    });
    expect(h.workbook).toEqual(saved);
    expect(h.workbook.accounts.filter((account) => account.name === 'Reserve')).toHaveLength(1);
    expect(h.commit).toHaveBeenCalledOnce();
  });

  it.each(['amount', 'note', 'workbook'])(
    'rejects a stale transaction deletion after %s changes',
    async (change) => {
      const h = harness();
      const proposal = await h.call('delete_transaction', { transaction: 'Groceries' });
      if (change === 'amount') {
        const transaction = h.workbook.transactions[0];
        transaction.amount = transaction.baseAmount = 150;
        transaction.lines.forEach((line) => {
          line.amount = line.baseAmount = 150;
        });
      }
      if (change === 'note') h.workbook.transactions[0].note = 'Edited since review';
      if (change === 'workbook') h.workbook.id = 'another-workbook';
      const before = structuredClone(h.workbook);
      expect(
        await h.call(
          'delete_transaction',
          { ...proposal.confirmation.proposal.arguments, confirmed: true },
          { approvedByUser: true }
        )
      ).toMatchObject({
        ok: false,
        status: 'conflict',
        changed: false,
        errors: [{ code: 'confirmation_target_changed' }]
      });
      expect(h.workbook).toEqual(before);
      expect(h.commit).not.toHaveBeenCalled();
    }
  );

  it('requires the captured target even when a caller presents approval', async () => {
    const h = harness();
    expect(
      await h.call(
        'delete_transaction',
        { transactionId: 'purchase', confirmed: true },
        { approvedByUser: true }
      )
    ).toMatchObject({ ok: false, status: 'confirmation_required' });
    const definition = getCavalryAssistantToolDefinitions().find(
      (tool) => tool.name === 'delete_transaction'
    );
    expect(definition.parameters.properties).not.toHaveProperty('expectedTargetState');
    expect(definition.parameters.properties).not.toHaveProperty('confirmed');
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('rejects account deletion if a new reference appears while confirmation is pending', async () => {
    const h = harness();
    const proposal = await h.call('delete_account', { accountId: 'bank' });
    h.workbook.recurringItems.push({
      id: 'new-bill',
      name: 'New bill',
      accountId: 'bank',
      isActive: true
    });
    const before = structuredClone(h.workbook);
    expect(
      await h.call(
        'delete_account',
        { ...proposal.confirmation.proposal.arguments, confirmed: true },
        { approvedByUser: true }
      )
    ).toMatchObject({ ok: false, status: 'conflict', changed: false });
    expect(h.workbook).toEqual(before);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('names a deleted unused account and accurately says archived when its history is preserved', async () => {
    const h = harness();
    const unused = await h.call('delete_account', { accountId: 'bank' });
    const deleted = await h.call(
      'delete_account',
      { ...unused.confirmation.proposal.arguments, confirmed: true },
      { approvedByUser: true }
    );
    expect(deleted).toMatchObject({
      ok: true,
      receipt: { actionVerb: 'Deleted', entity: { id: 'bank', label: 'Main Bank' } }
    });
    expect(h.workbook.accounts.some((account) => account.id === 'bank')).toBe(false);

    const referenced = await h.call('delete_account', { accountId: 'cash' });
    const archived = await h.call(
      'delete_account',
      { ...referenced.confirmation.proposal.arguments, confirmed: true },
      { approvedByUser: true }
    );
    expect(archived).toMatchObject({
      ok: true,
      receipt: { actionVerb: 'Archived', entity: { id: 'cash', label: 'Cash' } }
    });
    expect(cavalryAssistantActionReceiptMessage(archived.receipt)).toContain('Archived');
    expect(h.workbook.transactions).toHaveLength(1);
    expect(h.workbook.accounts.find((account) => account.id === 'cash').isActive).toBe(false);
  });

  it('rejects missing transaction amount and an unknown transfer destination without side effects', async () => {
    const h = harness();
    const before = structuredClone(h.workbook);
    expect(
      await h.call('create_transaction', {
        template: 'expense_paid',
        description: 'New purchase',
        primaryAccountId: 'cash',
        categoryId: 'food'
      })
    ).toMatchObject({ ok: false, changed: false });
    expect(
      await h.call('create_transaction', {
        template: 'transfer',
        amount: 200,
        primaryAccountId: 'cash',
        secondaryAccountId: 'missing',
        date: '2026-09-10',
        description: 'Transfer'
      })
    ).toMatchObject({ ok: false, changed: false });
    expect(h.workbook).toEqual(before);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('requires approval for a duplicate transfer retry rather than posting twice', async () => {
    const h = harness();
    const args = {
      template: 'transfer',
      amount: 200,
      currency: 'PHP',
      primaryAccountId: 'cash',
      secondaryAccountId: 'bank',
      date: '2026-09-10',
      description: 'Move cash'
    };
    expect(await h.call('create_transaction', args)).toMatchObject({ ok: true, changed: true });
    const before = structuredClone(h.workbook);
    expect(await h.call('create_transaction', args)).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      changed: false,
      confirmation: { field: 'allowDuplicate' }
    });
    expect(h.workbook).toEqual(before);
    expect(h.commit).toHaveBeenCalledOnce();
  });

  it('does not post a transfer across account currencies without reviewing the conversion', async () => {
    const h = harness();
    h.workbook.accounts.push({
      id: 'usd',
      name: 'Dollar Savings',
      group: 'asset',
      subtype: 'bank',
      currency: 'USD',
      isActive: true,
      openedDate: '2026-01-01'
    });
    const before = structuredClone(h.workbook);
    expect(
      await h.call('create_transaction', {
        template: 'transfer',
        amount: 5800,
        currency: 'PHP',
        fxRateToBase: 58,
        primaryAccountId: 'cash',
        secondaryAccountId: 'usd',
        date: '2026-09-10',
        description: 'Fund dollar savings'
      })
    ).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      changed: false,
      confirmation: { field: 'allowCurrencyConversion' }
    });
    expect(h.workbook).toEqual(before);
    expect(h.commit).not.toHaveBeenCalled();
  });
});
