import { describe, expect, it } from 'vitest';

import {
  AccountManagementError,
  archiveAccount,
  createAccount,
  deleteAccount,
  findAccountsByName,
  getAccountBalances,
  getAccountUsage,
  listSelectableAccounts,
  normalizeAccount,
  resolveAccountHint,
  restoreAccount,
  retireAccount,
  updateAccount,
  validateAccountInvariants
} from '@cavalry/finance-core/application/accounts/account-management-service.js';
import {
  buildAccountCurrencyRepairPreview,
  repairAccountCurrency
} from '@cavalry/finance-core/application/accounts/account-currency-repair-service.js';
import {
  buildPortableWorkbookHtml,
  parsePortableWorkbookText
} from '@cavalry/finance-core/domain/workbook/portable.js';
import { isTransactionBalanced } from '@cavalry/finance-core/domain/ledger/validation.js';
import {
  cloneAccountScenario,
  makeArchivedAccountWorkbook,
  makeDirtyLegacyAccountWorkbook,
  makeDuplicateishAccountWorkbook,
  makeMinimalAccountWorkbook,
  makeNormalAccountWorkbook
} from '../fixtures/account-scenarios.js';

function makeServices() {
  let lineCounter = 0;
  let transactionCounter = 0;
  return {
    createId(prefix) {
      return prefix + '_service';
    },
    today() {
      return '2026-06-30';
    },
    normalizeAccount(input, index, baseCurrency) {
      return normalizeAccount(
        Object.assign({ id: 'account_' + String(index + 1) }, input),
        index,
        baseCurrency,
        {
          today: () => '2026-06-30'
        }
      );
    },
    createLine(_workbook, accountId, direction, amount, currency, note) {
      lineCounter += 1;
      return {
        id: 'line_' + String(lineCounter),
        accountId,
        direction,
        amount,
        currency,
        baseAmount: amount,
        note
      };
    },
    normalizeTransaction(transaction) {
      transactionCounter += 1;
      return Object.assign(
        {
          id: 'txn_opening_' + String(transactionCounter),
          monthKey: transaction.date.slice(0, 7),
          categoryId: '',
          counterpartyId: '',
          recurringItemId: '',
          reference: '',
          fxRateToBase: 0,
          note: ''
        },
        transaction,
        {
          baseAmount: transaction.amount
        }
      );
    },
    getLedgerTransactionCount(workbook) {
      return (workbook.transactions || []).length;
    }
  };
}

describe('account management service', () => {
  it('normalizes dirty account shapes safely without regenerating existing IDs', () => {
    expect(
      normalizeAccount(
        {
          id: 'legacy-bank',
          name: '  Bank  ',
          group: 'checking',
          currency: 'php',
          details: {
            bankAccountType: '  Checking  ',
            billingDay: '15',
            creditLimit: 'not a number',
            nested: { ignored: true }
          },
          isActive: false
        },
        3,
        'PHP',
        {
          today: () => '2026-06-30'
        }
      )
    ).toMatchObject({
      id: 'legacy-bank',
      name: 'Bank',
      group: 'asset',
      currency: 'PHP',
      details: { bankAccountType: 'Checking', billingDay: 15 },
      openedDate: '2026-06-30',
      isActive: false
    });
  });

  it('validates account invariants and reports duplicate, missing, archived, and missing references', () => {
    const dirty = makeDirtyLegacyAccountWorkbook();
    const duplicateish = makeDuplicateishAccountWorkbook();
    const dirtyResult = validateAccountInvariants(dirty);
    const duplicateResult = validateAccountInvariants(duplicateish);

    expect(dirtyResult.ok).toBe(false);
    expect(dirtyResult.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['account_missing_id', 'account_missing_name', 'line_missing_account'])
    );
    expect(dirtyResult.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'account_invalid_group_normalizes',
        'account_missing_currency',
        'account_archived_flag_missing',
        'line_archived_account'
      ])
    );
    expect(duplicateResult.warnings.map((warning) => warning.code)).toContain(
      'account_duplicate_active_name'
    );
  });

  it('creates asset, wallet, savings/time-deposit, liability, and USD accounts with deterministic IDs', () => {
    const workbook = makeMinimalAccountWorkbook();
    workbook.transactions = [];
    const services = makeServices();

    const cash = createAccount(
      workbook,
      {
        name: '  Cash Test  ',
        group: 'asset',
        subtype: '',
        institution: 'BPI',
        currency: 'PHP',
        openedDate: '2026-06-01'
      },
      services
    );
    expect(cash.account.institution).toBe('BPI');
    const wallet = createAccount(
      workbook,
      {
        name: 'Wallet Test',
        group: 'asset',
        subtype: 'wallet',
        currency: 'PHP',
        openedDate: '2026-06-01'
      },
      services
    );
    const timeDeposit = createAccount(
      workbook,
      {
        name: 'Freedom Fund',
        group: 'short_term_asset',
        currency: 'PHP',
        openedDate: '2026-06-01',
        placementDate: '2026-06-01',
        maturityDate: '2026-12-01',
        interestRate: '5.25',
        estimatedMaturityAmount: '10525'
      },
      services
    );
    const card = createAccount(
      workbook,
      {
        name: 'Credit Card Test',
        group: 'liability',
        currency: 'PHP',
        openedDate: '2026-06-01'
      },
      services
    );
    const usd = createAccount(
      workbook,
      {
        name: 'USD Wallet',
        group: 'asset',
        subtype: 'wallet',
        currency: 'USD',
        openedDate: '2026-06-01'
      },
      services
    );

    expect(cash.account).toMatchObject({
      id: 'account_4',
      name: 'Cash Test',
      group: 'asset',
      subtype: 'cash'
    });
    expect(wallet.account).toMatchObject({ id: 'account_5', subtype: 'wallet' });
    expect(timeDeposit.account).toMatchObject({
      id: 'account_6',
      group: 'asset',
      subtype: 'time_deposit',
      interestRate: 5.25
    });
    expect(card.account).toMatchObject({
      id: 'account_7',
      group: 'liability',
      subtype: 'credit_card'
    });
    expect(usd.account).toMatchObject({ id: 'account_8', currency: 'USD' });
    expect(
      listSelectableAccounts(workbook, { groups: ['asset', 'liability'] }).map(
        (account) => account.id
      )
    ).toEqual(
      expect.arrayContaining([
        cash.account.id,
        wallet.account.id,
        timeDeposit.account.id,
        card.account.id,
        usd.account.id
      ])
    );
  });

  it('validates required account fields without mutating transactions or drafts on failure', () => {
    const workbook = makeMinimalAccountWorkbook();
    const before = cloneAccountScenario(workbook);

    expect(() =>
      createAccount(workbook, { name: ' ', openedDate: '2026-06-01' }, makeServices())
    ).toThrow('Account name is required.');
    expect(() => createAccount(workbook, { name: 'New Account' }, makeServices())).toThrow(
      'Account date is required.'
    );
    expect(workbook).toEqual(before);

    const noRateWorkbook = makeMinimalAccountWorkbook();
    noRateWorkbook.settings.usdToBaseRate = 0;
    const beforeNoRate = cloneAccountScenario(noRateWorkbook);
    expect(() =>
      createAccount(
        noRateWorkbook,
        { name: 'USD No Rate', group: 'asset', currency: 'USD', openedDate: '2026-06-01' },
        makeServices()
      )
    ).toThrow(AccountManagementError);
    expect(noRateWorkbook).toEqual(beforeNoRate);
  });

  it('creates opening-balance transactions without creating drafts', () => {
    const workbook = makeMinimalAccountWorkbook();
    workbook.transactions = [];
    const result = createAccount(
      workbook,
      {
        name: 'Opening Cash',
        group: 'asset',
        currency: 'PHP',
        openedDate: '2026-06-01',
        openingBalance: '1,500'
      },
      makeServices()
    );

    expect(result.openingTransaction).toMatchObject({
      template: 'opening_balance',
      description: 'Opening Cash opening balance',
      amount: 1500
    });
    expect(workbook.transactions).toHaveLength(1);
    expect(workbook.aiDrafts).toEqual([]);
    expect(workbook.externalDraftGroups).toEqual([]);
  });

  it('converts USD opening balances into PHP base amounts while preserving native postings', () => {
    const workbook = makeMinimalAccountWorkbook();
    workbook.settings.usdToBaseRate = 61.75;
    workbook.transactions = [];
    let idSequence = 0;
    const result = createAccount(
      workbook,
      {
        name: 'USD Account',
        group: 'asset',
        subtype: 'bank',
        currency: 'USD',
        openedDate: '2026-07-01',
        openingBalance: '252.15'
      },
      {
        today: () => '2026-07-01',
        createId: (prefix) => `${prefix}_${++idSequence}`
      }
    );

    expect(result.openingTransaction).toMatchObject({
      originalCurrency: 'USD',
      amount: 252.15,
      baseAmount: 15570.26
    });
    expect(result.openingTransaction.lines).toEqual([
      expect.objectContaining({
        accountId: result.account.id,
        direction: 'debit',
        amount: 252.15,
        currency: 'USD',
        baseAmount: 15570.26
      }),
      expect.objectContaining({
        accountId: 'opening_balance_equity',
        direction: 'credit',
        amount: 252.15,
        currency: 'USD',
        baseAmount: 15570.26
      })
    ]);
    expect(isTransactionBalanced(result.openingTransaction)).toBe(true);
  });

  it('routes every history-bearing currency change through conversion or confirmed repair', () => {
    const workbook = makeNormalAccountWorkbook();
    const before = cloneAccountScenario(workbook);

    expect(() =>
      updateAccount(
        workbook,
        'cash',
        { name: 'Cash', subtype: 'cash', currency: 'USD' },
        makeServices()
      )
    ).toThrow('Accounts with transaction history need an explicit currency conversion');
    expect(workbook).toEqual(before);

    workbook.accounts.find((account) => account.id === 'cash').currency = 'USD';
    const mismatch = validateAccountInvariants(workbook).warnings.filter(
      (warning) => warning.code === 'account_posting_currency_mismatch'
    );
    expect(mismatch).toEqual([
      expect.objectContaining({ detail: 'cash: configured USD; postings PHP' })
    ]);

    let repairError = null;
    try {
      updateAccount(
        workbook,
        'cash',
        { name: 'Cash', subtype: 'cash', currency: 'PHP' },
        makeServices()
      );
    } catch (error) {
      repairError = error;
    }
    expect(repairError).toMatchObject({
      code: 'account_currency_repair_required',
      details: {
        accountId: 'cash',
        currentCurrency: 'USD',
        requestedCurrency: 'PHP',
        postingCurrencies: ['PHP'],
        repairKind: 'metadata_only',
        changedLineCount: 0
      }
    });
    expect(workbook.accounts.find((account) => account.id === 'cash').currency).toBe('USD');

    const preview = buildAccountCurrencyRepairPreview(workbook, {
      accountId: 'cash',
      targetCurrency: 'PHP'
    });
    const repaired = repairAccountCurrency(workbook, {
      accountId: 'cash',
      targetCurrency: 'PHP',
      expectedFingerprint: preview.fingerprint,
      confirmed: true
    });
    expect(repaired).toMatchObject({
      ok: true,
      changed: true,
      workbook: { accounts: expect.any(Array) }
    });
    expect(repaired.workbook.accounts.find((account) => account.id === 'cash').currency).toBe(
      'PHP'
    );
  });

  it('renames and edits accounts while preserving IDs, transaction references, balances, and roundtrip shape', () => {
    const workbook = makeNormalAccountWorkbook();
    const beforeTransactionIds = workbook.transactions.map((transaction) => transaction.id);
    const beforeBalance = getAccountBalances(workbook).historical.cash;
    const result = updateAccount(
      workbook,
      'cash',
      {
        name: 'Cash Main',
        subtype: 'wallet',
        currency: 'PHP',
        note: 'Pocket cash'
      },
      makeServices()
    );
    const parsed = parsePortableWorkbookText(buildPortableWorkbookHtml(workbook));

    expect(result.account.id).toBe('cash');
    expect(result.account).toMatchObject({
      name: 'Cash Main',
      subtype: 'wallet',
      note: 'Pocket cash'
    });
    expect(workbook.transactions.map((transaction) => transaction.id)).toEqual(
      beforeTransactionIds
    );
    expect(
      workbook.transactions.some((transaction) =>
        (transaction.lines || []).some((line) => line.accountId === 'cash')
      )
    ).toBe(true);
    expect(getAccountBalances(workbook).historical.cash).toBe(beforeBalance);
    expect(parsed.accounts.find((account) => account.id === 'cash')).toMatchObject({
      name: 'Cash Main',
      subtype: 'wallet'
    });
  });

  it('keeps institution text and IDs consistent while allowing an institution to be cleared', () => {
    const workbook = makeNormalAccountWorkbook();
    const account = workbook.accounts.find((item) => item.id === 'cash');
    account.institution = 'BPI';
    account.institutionId = 'bpi';

    updateAccount(
      workbook,
      'cash',
      {
        name: account.name,
        subtype: account.subtype,
        currency: account.currency,
        institution: '',
        institutionId: ''
      },
      makeServices()
    );
    expect(account).toMatchObject({ institution: '', institutionId: '' });

    account.institution = 'BPI';
    account.institutionId = 'bpi';
    updateAccount(
      workbook,
      'cash',
      {
        name: account.name,
        subtype: account.subtype,
        currency: account.currency,
        institution: 'RCBC'
      },
      makeServices()
    );
    expect(account).toMatchObject({ institution: 'RCBC', institutionId: 'rcbc' });

    updateAccount(
      workbook,
      'cash',
      {
        name: account.name,
        subtype: account.subtype,
        currency: account.currency,
        institution: ''
      },
      makeServices()
    );
    expect(account).toMatchObject({ institution: '', institutionId: '' });

    updateAccount(
      workbook,
      'cash',
      {
        name: account.name,
        subtype: account.subtype,
        currency: account.currency,
        institution: 'RCBC',
        institutionId: 'bpi'
      },
      makeServices()
    );
    expect(account).toMatchObject({ institution: 'BPI', institutionId: 'bpi' });

    updateAccount(
      workbook,
      'cash',
      {
        name: account.name,
        subtype: account.subtype,
        currency: account.currency,
        institution: 'RCBC',
        institutionId: 'not-a-bank'
      },
      makeServices()
    );
    expect(account).toMatchObject({ institution: 'RCBC', institutionId: 'rcbc' });
  });

  it('rejects invalid account edits without corrupting workbook state', () => {
    const workbook = makeNormalAccountWorkbook();
    const before = cloneAccountScenario(workbook);

    expect(() =>
      updateAccount(workbook, 'cash', { name: '', currency: 'PHP' }, makeServices())
    ).toThrow('Account name is required.');
    expect(workbook).toEqual(before);

    const noRateWorkbook = makeNormalAccountWorkbook();
    noRateWorkbook.settings.usdToBaseRate = 0;
    const beforeNoRate = cloneAccountScenario(noRateWorkbook);
    expect(() =>
      updateAccount(noRateWorkbook, 'cash', { name: 'Cash', currency: 'USD' }, makeServices())
    ).toThrow('Set a USD to PHP rate before using USD accounts.');
    expect(noRateWorkbook).toEqual(beforeNoRate);
  });

  it('archives, restores, retires, and deletes accounts according to current safety rules', () => {
    const workbook = makeNormalAccountWorkbook();

    expect(archiveAccount(workbook, 'cash')).toMatchObject({ changed: true });
    expect(workbook.accounts.find((account) => account.id === 'cash').isActive).toBe(false);
    expect(restoreAccount(workbook, 'cash')).toMatchObject({ changed: true });
    expect(workbook.accounts.find((account) => account.id === 'cash').isActive).toBe(true);
    expect(retireAccount(workbook, 'credit-card')).toMatchObject({ changed: true, archived: true });
    expect(workbook.accounts.find((account) => account.id === 'credit-card').isActive).toBe(false);

    const referenced = deleteAccount(workbook, 'cash');
    expect(referenced).toMatchObject({ changed: true, archived: true, deleted: false });
    expect(workbook.accounts.find((account) => account.id === 'cash').isActive).toBe(false);

    workbook.accounts.push({
      id: 'unused',
      name: 'Unused',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      isActive: true
    });
    const unused = deleteAccount(workbook, 'unused');
    expect(unused).toMatchObject({ changed: true, archived: false, deleted: true });
    expect(workbook.accounts.find((account) => account.id === 'unused')).toBeUndefined();
  });

  it('deletes opening-balance-only accounts by removing setup transactions', () => {
    const workbook = makeMinimalAccountWorkbook();
    workbook.accounts.push({
      id: 'setup-only',
      name: 'Setup Only',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      isActive: true
    });
    workbook.transactions = [
      {
        id: 'txn-setup-only',
        date: '2026-06-01',
        monthKey: '2026-06',
        template: 'opening_balance',
        description: 'Setup Only opening balance',
        categoryId: '',
        amount: 100,
        baseAmount: 100,
        lines: [
          {
            id: 'line-setup',
            accountId: 'setup-only',
            direction: 'debit',
            amount: 100,
            currency: 'PHP',
            baseAmount: 100
          },
          {
            id: 'line-equity',
            accountId: 'opening_balance_equity',
            direction: 'credit',
            amount: 100,
            currency: 'PHP',
            baseAmount: 100
          }
        ]
      }
    ];

    const result = deleteAccount(workbook, 'setup-only');
    expect(result).toMatchObject({
      deleted: true,
      archived: false,
      removedTransactionIds: ['txn-setup-only']
    });
    expect(workbook.transactions).toEqual([]);
  });

  it('archives accounts referenced by recurring items, budgets, or sheet entries instead of hard deleting them', () => {
    const workbook = makeMinimalAccountWorkbook();
    workbook.transactions = [
      {
        id: 'txn-primary-only',
        date: '2026-06-01',
        monthKey: '2026-06',
        template: 'memo',
        description: 'Primary account marker',
        categoryId: '',
        primaryAccountId: 'planned-cash',
        amount: 0,
        baseAmount: 0,
        lines: []
      }
    ];
    workbook.accounts.push({
      id: 'planned-cash',
      name: 'Planned Cash',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      isActive: true
    });
    workbook.recurringItems = [{ id: 'rec-planned', accountId: 'planned-cash', isActive: true }];
    workbook.sheets = [
      {
        id: 'sheet-june',
        budgetLineItems: [{ id: 'budget-line', accountId: 'planned-cash' }],
        entries: [{ id: 'entry-line', accountId: 'planned-cash' }]
      }
    ];

    const usage = getAccountUsage(workbook, 'planned-cash');
    expect(usage).toMatchObject({
      transactionCount: 1,
      recurringItemCount: 1,
      budgetLineItemCount: 1,
      sheetEntryCount: 1,
      totalReferences: 4,
      hasNonOpeningReferences: true
    });

    const result = deleteAccount(workbook, 'planned-cash');
    expect(result).toMatchObject({ changed: true, archived: true, deleted: false });
    expect(workbook.accounts.find((account) => account.id === 'planned-cash')).toMatchObject({
      isActive: false
    });
    expect(workbook.recurringItems).toHaveLength(1);
    expect(workbook.sheets[0].budgetLineItems).toHaveLength(1);
    expect(workbook.sheets[0].entries).toHaveLength(1);
  });

  it('summarizes account usage and selector behavior for archived accounts', () => {
    const workbook = makeArchivedAccountWorkbook();
    const usage = getAccountUsage(workbook, 'old-wallet');

    expect(usage).toMatchObject({ transactionCount: 1, hasHistory: true, openingOnly: false });
    expect(
      listSelectableAccounts(workbook, { groups: 'asset' }).map((account) => account.id)
    ).not.toContain('old-wallet');
    expect(
      listSelectableAccounts(workbook, { groups: 'asset', includeArchived: true }).map(
        (account) => account.id
      )
    ).toContain('old-wallet');
  });

  it('resolves account hints by ID or unambiguous name', () => {
    const workbook = makeNormalAccountWorkbook();

    expect(resolveAccountHint(workbook, 'cash').id).toBe('cash');
    expect(resolveAccountHint(workbook, 'Bank Checking').id).toBe('bank-checking');
    expect(findAccountsByName(workbook, 'Cash')).toHaveLength(1);
    expect(resolveAccountHint(makeDuplicateishAccountWorkbook(), 'cash')).toBeNull();
  });
});
