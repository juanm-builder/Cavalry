import {
  buildTransactionRouteViewModel,
  findInstitutionById,
  getAccountBalanceSnapshotAsOf,
  getAccountCurrencyIntegrity,
  getLedgerTransactionTemplateConfig,
  getTransactionComposerDefaults,
  isNaturalDebitGroup,
  resolveTransactionRowReferences,
  resolveInstitution,
  validateTransactionTableViewState
} from '@cavalry/finance-core';

import { buildCsvImportPreviewModel } from '../import-export/import-export-controller.js';
import { formatUiDateTime } from '../../shared/date-format.js';
import { CREATE_TYPE_OPTIONS } from './transaction-model-options.js';
import {
  buildPeriodLabel,
  buildTransactionRowModel,
  formatDirectionalTransactionMoney,
  formatTransactionMoney
} from './transaction-row-presentation.js';

const TEMPLATE_OPTIONS = Object.freeze([
  { value: 'expense_paid', label: 'Expense paid' },
  { value: 'expense_charged', label: 'Expense charged' },
  { value: 'income_received', label: 'Income received' },
  { value: 'merchant_refund', label: 'Merchant refund' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'debt_payment', label: 'Debt payment' },
  { value: 'liability_payment', label: 'Liability payment' },
  { value: 'opening_balance', label: 'Opening balance' }
]);

const ACCOUNT_EDIT_CONTEXTS = Object.freeze({
  bank: {
    kind: 'bank',
    title: 'Edit Bank Transaction',
    badge: 'Bank transaction',
    label: 'Bank account',
    fieldLabel: 'bank account',
    icon: 'account_balance',
    accent: '#14804f',
    description: 'Update the activity recorded against this bank account.',
    descriptionPlaceholder: 'e.g., ATM withdrawal, deposit, or bank transfer'
  },
  cash: {
    kind: 'cash',
    title: 'Edit Cash Transaction',
    badge: 'Cash transaction',
    label: 'Cash account',
    fieldLabel: 'cash account',
    icon: 'payments',
    accent: '#14804f',
    description: 'Update this cash movement and its balance impact.',
    descriptionPlaceholder: 'e.g., Cash purchase or cash received'
  },
  wallet: {
    kind: 'wallet',
    title: 'Edit E-Wallet Transaction',
    badge: 'E-wallet transaction',
    label: 'E-wallet',
    fieldLabel: 'e-wallet',
    icon: 'account_balance_wallet',
    accent: '#14804f',
    description: 'Update this wallet payment, receipt, or transfer.',
    descriptionPlaceholder: 'e.g., QR payment, wallet top-up, or transfer'
  },
  credit_card: {
    kind: 'credit_card',
    title: 'Edit Credit Card Transaction',
    badge: 'Credit card transaction',
    label: 'Credit card',
    fieldLabel: 'credit card',
    icon: 'credit_card',
    accent: '#7048d7',
    description: 'Update this card purchase, fee, refund, or payment.',
    descriptionPlaceholder: 'e.g., Card purchase, annual fee, or payment'
  },
  investment: {
    kind: 'investment',
    title: 'Edit Investment Transaction',
    badge: 'Investment transaction',
    label: 'Investment account',
    fieldLabel: 'investment account',
    icon: 'trending_up',
    accent: '#1756b5',
    description: 'Update this contribution, withdrawal, distribution, or transfer.',
    descriptionPlaceholder: 'e.g., Contribution, distribution, or account fee'
  },
  liability: {
    kind: 'liability',
    title: 'Edit Liability Transaction',
    badge: 'Liability transaction',
    label: 'Liability account',
    fieldLabel: 'liability account',
    icon: 'request_quote',
    accent: '#bf2f31',
    description: 'Update this loan, debt, or liability payment.',
    descriptionPlaceholder: 'e.g., Loan payment, interest, or adjustment'
  },
  asset: {
    kind: 'asset',
    title: 'Edit Asset Transaction',
    badge: 'Asset transaction',
    label: 'Asset account',
    fieldLabel: 'asset account',
    icon: 'account_balance_wallet',
    accent: '#14804f',
    description: 'Update this account activity and its balance impact.',
    descriptionPlaceholder: 'Describe this transaction'
  }
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value);
}

function byId(items) {
  return new Map(asArray(items).map((item) => [asString(item && item.id), item]));
}

function titleCase(value) {
  return (
    asString(value)
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase()) || 'Transaction'
  );
}

function accountEditContextKind(account) {
  const subtype = asString(account && account.subtype).toLowerCase();
  const group = asString(account && account.group).toLowerCase();
  const details = asObject(account && account.details);
  if (['bank', 'savings', 'checking'].includes(subtype)) return 'bank';
  if (subtype === 'cash') return 'cash';
  if (['wallet', 'e_wallet', 'ewallet'].includes(subtype)) return 'wallet';
  if (['credit_card', 'card'].includes(subtype)) return 'credit_card';
  if (['investment', 'time_deposit'].includes(subtype)) return 'investment';
  if (
    group === 'liability' &&
    (asString(account && account.icon).toLowerCase() === 'credit_card' ||
      details.creditLimit != null ||
      details.cardNetwork ||
      /credit\s*card/i.test(asString(account && account.name)))
  ) {
    return 'credit_card';
  }
  if (group === 'liability' || ['loan', 'liability'].includes(subtype)) return 'liability';

  // Older workbooks can predate account subtypes. Preserve contextual editing
  // when a known bank or e-wallet can still be identified from saved metadata.
  const institution =
    findInstitutionById(account && account.institutionId) ||
    findInstitutionById(details.institutionId) ||
    findInstitutionById(details.providerId) ||
    [
      account && account.institution,
      details.provider,
      details.providerName,
      details.walletProvider,
      details.walletProviderName,
      account && account.name
    ]
      .map(resolveInstitution)
      .find(Boolean);
  if (institution?.type === 'e_wallet') return 'wallet';
  if (institution?.type === 'bank' || institution?.type === 'digital_bank') return 'bank';
  return 'asset';
}

function contextualAccountLabel(template, definition, field) {
  if (field === 'secondary') {
    if (template === 'debt_payment' || template === 'liability_payment') {
      return definition.kind === 'credit_card' ? 'Credit card' : 'Liability account';
    }
    return 'To account';
  }
  if (template === 'income_received') return `Received into ${definition.fieldLabel}`;
  if (template === 'expense_charged') return `Charged to ${definition.fieldLabel}`;
  if (template === 'expense_paid') return `Paid from ${definition.fieldLabel}`;
  if (template === 'merchant_refund') return `Refunded to ${definition.fieldLabel}`;
  if (template === 'debt_payment' || template === 'liability_payment') return 'Payment from';
  if (template === 'transfer') return 'From account';
  return definition.label;
}

function contextualAmountLabel(template, definition) {
  if (template === 'expense_charged' && definition.kind === 'credit_card') {
    return 'Purchase amount';
  }
  if (template === 'debt_payment' || template === 'liability_payment') return 'Payment amount';
  if (template === 'income_received') return 'Amount received';
  if (template === 'expense_paid') return 'Amount paid';
  if (template === 'merchant_refund') return 'Refund amount';
  if (template === 'transfer') return 'Transfer amount';
  return 'Transaction amount';
}

function formatTransactionDate(value) {
  const stamp = Date.parse(`${asString(value)}T00:00:00Z`);
  if (!Number.isFinite(stamp)) return asString(value) || '—';
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(stamp));
}

export { formatTransactionMoney };

function isBalanceAccount(account) {
  return !!(account && (account.group === 'asset' || account.group === 'liability'));
}

function findLine(lines, accounts, group, direction) {
  return (
    asArray(lines).find((line) => {
      const account = accounts.get(asString(line && line.accountId));
      return line && line.direction === direction && account && account.group === group;
    }) || null
  );
}

function getTransactionAccountDraft(workbook, transaction) {
  const accounts = byId(workbook && workbook.accounts);
  const lines = asArray(transaction && transaction.lines);
  const template = asString(transaction && transaction.template);
  let primaryAccountId = '';
  let secondaryAccountId = '';
  if (template === 'income_received') {
    primaryAccountId = asString(findLine(lines, accounts, 'asset', 'debit')?.accountId);
  } else if (template === 'expense_paid') {
    primaryAccountId = asString(findLine(lines, accounts, 'asset', 'credit')?.accountId);
  } else if (template === 'expense_charged') {
    primaryAccountId = asString(findLine(lines, accounts, 'liability', 'credit')?.accountId);
  } else if (template === 'merchant_refund') {
    primaryAccountId = asString(
      lines.find(
        (line) =>
          line &&
          line.direction === 'debit' &&
          isBalanceAccount(accounts.get(asString(line.accountId)))
      )?.accountId
    );
  } else if (template === 'transfer') {
    primaryAccountId = asString(
      lines.find(
        (line) =>
          line &&
          line.direction === 'credit' &&
          isBalanceAccount(accounts.get(asString(line.accountId)))
      )?.accountId
    );
    secondaryAccountId = asString(
      lines.find(
        (line) =>
          line &&
          line.direction === 'debit' &&
          isBalanceAccount(accounts.get(asString(line.accountId)))
      )?.accountId
    );
  } else if (template === 'debt_payment' || template === 'liability_payment') {
    primaryAccountId = asString(findLine(lines, accounts, 'asset', 'credit')?.accountId);
    secondaryAccountId = asString(findLine(lines, accounts, 'liability', 'debit')?.accountId);
  } else {
    primaryAccountId = asString(
      lines.find((line) => line && isBalanceAccount(accounts.get(asString(line.accountId))))
        ?.accountId
    );
  }
  return { primaryAccountId, secondaryAccountId };
}

export function buildTransactionComposerDraft(workbook, transactionId = '', options = {}) {
  const transaction =
    asArray(workbook && workbook.transactions).find(
      (item) => asString(item && item.id) === asString(transactionId)
    ) || null;
  if (!transaction) {
    return {
      ...getTransactionComposerDefaults(workbook || {}, { defaultDate: options.defaultDate }),
      transactionId: '',
      allowDuplicate: false
    };
  }
  const accountDraft = getTransactionAccountDraft(workbook, transaction);
  return {
    transactionId: asString(transaction.id),
    template: asString(transaction.template || 'expense_paid'),
    amount: Number(transaction.amount) || 0,
    currency: asString(
      transaction.originalCurrency ||
        transaction.currency ||
        (workbook && workbook.currency) ||
        'PHP'
    ).toUpperCase(),
    date: asString(transaction.date),
    fxRateToBase: Number(transaction.fxRateToBase) || 0,
    description: asString(transaction.description),
    categoryId: asString(transaction.categoryId),
    primaryAccountId: accountDraft.primaryAccountId || asString(transaction.primaryAccountId),
    secondaryAccountId: accountDraft.secondaryAccountId || asString(transaction.secondaryAccountId),
    counterpartyId: asString(transaction.counterpartyId),
    counterpartyName: '',
    counterpartyKind: 'other',
    note: asString(transaction.note),
    recurringItemId: asString(transaction.recurringItemId),
    allowDuplicate: false
  };
}

function buildFilterOptions(workbook) {
  const accounts = asArray(workbook && workbook.accounts)
    .slice()
    .sort((left, right) => asString(left && left.name).localeCompare(asString(right && right.name)))
    .map((account) => ({
      value: asString(account.id),
      label: `${asString(account.name)}${account.isActive === false ? ' • archived' : ''}`
    }));
  const categories = asArray(workbook && workbook.categories)
    .slice()
    .sort((left, right) => asString(left && left.name).localeCompare(asString(right && right.name)))
    .map((category) => ({
      value: asString(category.id),
      label: `${asString(category.name)}${category.isActive === false ? ' • archived' : ''}`,
      type: asString(category.type)
    }));
  return { accounts, categories };
}

function buildComposerOptions(workbook, include = {}) {
  const balanceSnapshot = getAccountBalanceSnapshotAsOf(workbook || {});
  const includedAccountIds = new Set(asArray(include.accountIds).map(asString));
  const includedCategoryIds = new Set(asArray(include.categoryIds).map(asString));
  const accounts = asArray(workbook && workbook.accounts)
    .filter(
      (account) =>
        account &&
        isBalanceAccount(account) &&
        (account.isActive !== false || includedAccountIds.has(asString(account.id)))
    )
    .map((account) => {
      const accountId = asString(account.id);
      const contextKind = accountEditContextKind(account);
      const context = ACCOUNT_EDIT_CONTEXTS[contextKind];
      const logoMode = asString(account.logoMode).toLowerCase() === 'icon' ? 'icon' : 'institution';
      const configuredCurrency =
        asString(account.currency).toUpperCase() ||
        asString(workbook && workbook.currency).toUpperCase() ||
        'PHP';
      const integrity = getAccountCurrencyIntegrity(workbook, accountId);
      const hasCurrencyIntegrityIssue = integrity.mismatched || integrity.mixed;
      const balanceCurrency = hasCurrencyIntegrityIssue
        ? asString(workbook && workbook.currency).toUpperCase() || 'PHP'
        : configuredCurrency;
      const balance =
        Number(
          (hasCurrencyIntegrityIssue ? balanceSnapshot.historical : balanceSnapshot.display)?.[
            accountId
          ]
        ) || 0;
      return {
        value: accountId,
        name: asString(account.name),
        label: `${asString(account.name)} • ${context.label}${
          account.isActive === false ? ' • archived' : ''
        }${hasCurrencyIntegrityIssue ? ' • currency repair required' : ''}`,
        group: asString(account.group),
        subtype: asString(account.subtype),
        institution: asString(account.institution),
        institutionId: logoMode === 'icon' ? '' : asString(account.institutionId),
        logoMode,
        details: asObject(account.details),
        isArchived: account.isActive === false,
        contextKind,
        contextLabel: context.label,
        icon: asString(account.icon) || context.icon,
        accent: context.accent,
        currency: configuredCurrency,
        balanceCurrency,
        hasCurrencyIntegrityIssue,
        postingCurrencies: integrity.postingCurrencies,
        disabled: hasCurrencyIntegrityIssue && !includedAccountIds.has(accountId),
        balance,
        balanceLabel: formatTransactionMoney(balance, balanceCurrency)
      };
    });
  const categories = asArray(workbook && workbook.categories)
    .filter(
      (category) =>
        category && (category.isActive !== false || includedCategoryIds.has(asString(category.id)))
    )
    .map((category) => ({
      value: asString(category.id),
      label: `${asString(category.name)}${category.isActive === false ? ' • archived' : ''}`,
      isArchived: category.isActive === false,
      type: asString(category.type)
    }));
  const currencies = Array.from(
    new Set(
      [
        asString((workbook && workbook.currency) || 'PHP').toUpperCase(),
        ...asArray(workbook && workbook.accounts).map((account) =>
          asString(account && account.currency).toUpperCase()
        ),
        'PHP',
        'USD'
      ].filter(Boolean)
    )
  );
  return {
    templates: TEMPLATE_OPTIONS,
    accounts,
    categories,
    currencies: currencies.map((currency) => ({ value: currency, label: currency }))
  };
}

function buildEditComposerContext(state, draft, options) {
  const template = asString(draft.template || 'expense_paid');
  const primaryAccount = asArray(options.accounts).find(
    (account) => account.value === asString(draft.primaryAccountId)
  );
  const secondaryAccount = asArray(options.accounts).find(
    (account) => account.value === asString(draft.secondaryAccountId)
  );
  const filteredAccountId = asString(state?.view?.accountId);
  const filteredAccount = [primaryAccount, secondaryAccount].find(
    (account) => account && account.value === filteredAccountId
  );
  const debtContext = ['debt_payment', 'liability_payment'].includes(template);
  const account =
    filteredAccount ||
    (debtContext ? secondaryAccount : primaryAccount) ||
    secondaryAccount ||
    null;
  const definition =
    ACCOUNT_EDIT_CONTEXTS[account?.contextKind] ||
    ACCOUNT_EDIT_CONTEXTS[account?.group === 'liability' ? 'liability' : 'asset'];
  const templateConfig = getLedgerTransactionTemplateConfig(template);
  return {
    ...definition,
    account,
    primaryLabel: contextualAccountLabel(template, definition, 'primary'),
    secondaryLabel: contextualAccountLabel(template, definition, 'secondary'),
    amountLabel: contextualAmountLabel(template, definition),
    templateConfig
  };
}

function getCreateType(template) {
  const value = asString(template);
  const canonicalTemplate = value === 'expense_charged' ? 'expense_paid' : value;
  return CREATE_TYPE_OPTIONS.find((option) => option.template === canonicalTemplate) || null;
}

function isCreateCreditCard(account) {
  return !!(account && account.group === 'liability' && account.contextKind === 'credit_card');
}

function isCreateCardPayment(kind, selection) {
  return !!(
    kind &&
    kind.kind === 'transfer' &&
    selection.primaryAccount?.group === 'asset' &&
    isCreateCreditCard(selection.secondaryAccount)
  );
}

function buildCreateReviewRows(kind, draft, selection) {
  const amount = formatTransactionMoney(draft.amount, draft.currency);
  const date = formatTransactionDate(draft.date);
  const primaryAccount = selection.primaryAccount;
  const secondaryAccount = selection.secondaryAccount;
  const category = selection.category;
  const isCreditCardExpense =
    kind?.kind === 'expense' &&
    draft.template === 'expense_charged' &&
    isCreateCreditCard(primaryAccount);
  const isCardPayment = isCreateCardPayment(kind, selection);
  if (!kind) return [];
  if (kind.kind === 'income') {
    return [
      {
        label: 'To',
        value: primaryAccount?.name || '—',
        detail: primaryAccount?.balanceLabel || ''
      },
      { label: 'Amount', value: amount, tone: 'good' },
      { label: 'Date', value: date },
      { label: 'Source', value: category?.label || '—', icon: 'payments' },
      { label: 'Description', value: asString(draft.description) || '—' },
      { label: 'Note', value: asString(draft.note) || '—' }
    ];
  }
  if (kind.kind === 'refund') {
    return [
      {
        label: 'Refunded to',
        value: primaryAccount?.name || '—',
        detail: primaryAccount?.balanceLabel || ''
      },
      { label: 'Refund amount', value: amount, tone: 'good' },
      { label: 'Date', value: date },
      { label: 'Original category', value: category?.label || '—', icon: 'category' },
      { label: 'Description', value: asString(draft.description) || '—' },
      { label: 'Note', value: asString(draft.note) || '—' }
    ];
  }
  if (kind.kind === 'expense') {
    return [
      {
        label: isCreditCardExpense ? 'Charged to' : 'Paid from',
        value: primaryAccount?.name || '—',
        detail: isCreditCardExpense
          ? `Balance owed ${primaryAccount?.balanceLabel || '—'}`
          : primaryAccount?.balanceLabel || ''
      },
      {
        label: isCreditCardExpense ? 'Purchase amount' : 'Amount paid',
        value: amount,
        tone: isCreditCardExpense ? 'card' : 'bad'
      },
      { label: 'Date', value: date },
      { label: 'Category', value: category?.label || '—', icon: 'category' },
      { label: 'Description', value: asString(draft.description) || '—' },
      { label: 'Note', value: asString(draft.note) || '—' }
    ];
  }
  return [
    {
      label: isCardPayment ? 'Payment from' : 'From',
      value: primaryAccount?.name || '—',
      detail: primaryAccount?.balanceLabel || ''
    },
    {
      label: isCardPayment ? 'Credit card' : 'To',
      value: secondaryAccount?.name || '—',
      detail: isCardPayment
        ? `Balance owed ${secondaryAccount?.balanceLabel || '—'}`
        : secondaryAccount?.balanceLabel || ''
    },
    { label: isCardPayment ? 'Payment amount' : 'Amount', value: amount },
    { label: 'Date', value: date },
    { label: 'Note', value: asString(draft.note) || '—' }
  ];
}

function buildCreateImpact(kind, draft, selection) {
  if (!kind) return null;
  const amount = formatTransactionMoney(draft.amount, draft.currency);
  const accountName = selection.primaryAccount?.name || 'selected account';
  const isCreditCardExpense =
    kind.kind === 'expense' &&
    draft.template === 'expense_charged' &&
    isCreateCreditCard(selection.primaryAccount);
  const isCardPayment = isCreateCardPayment(kind, selection);
  if (kind.kind === 'income') {
    return {
      tone: 'good',
      icon: 'arrow_upward',
      prefix: `This will increase your ${accountName} by`,
      amount
    };
  }
  if (kind.kind === 'refund') {
    return {
      tone: 'good',
      icon: 'undo',
      prefix: `This will reduce spending in the original category and credit ${accountName} by`,
      amount,
      suffix: '. It will not be counted as new income.'
    };
  }
  if (kind.kind === 'expense') {
    if (isCreditCardExpense) {
      return {
        tone: 'card',
        icon: 'credit_card',
        prefix: `This will increase your ${accountName} balance owed by`,
        amount,
        suffix: '. Record the card payment later as a transfer so it is not counted twice.'
      };
    }
    return {
      tone: 'bad',
      icon: 'arrow_downward',
      prefix: `This will decrease your ${accountName} by`,
      amount
    };
  }
  if (isCardPayment) {
    return {
      tone: 'card',
      icon: 'credit_card',
      prefix: `This will reduce your ${selection.secondaryAccount.name} balance owed by`,
      amount,
      suffix: '. It will not be counted as another expense.'
    };
  }
  return {
    tone: 'info',
    icon: 'verified_user',
    prefix: "This is a transfer. Your total balance won't change.",
    amount: ''
  };
}

function buildCreateComposerModel(workbook, modal) {
  const draft = asObject(modal.draft);
  const options = buildComposerOptions(workbook);
  const kind = getCreateType(draft.template);
  const accounts = !kind
    ? options.accounts
    : kind.kind === 'income'
      ? options.accounts.filter((account) => account.group === 'asset')
      : kind.kind === 'expense'
        ? options.accounts.filter(
            (account) => account.group === 'asset' || isCreateCreditCard(account)
          )
        : kind.kind === 'refund'
          ? options.accounts.filter((account) => ['asset', 'liability'].includes(account.group))
          : options.accounts;
  const categories = kind
    ? options.categories.filter((category) => category.type === (kind.categoryType || kind.kind))
    : [];
  const selection = {
    primaryAccount: options.accounts.find(
      (account) => account.value === asString(draft.primaryAccountId)
    ),
    secondaryAccount: options.accounts.find(
      (account) => account.value === asString(draft.secondaryAccountId)
    ),
    category: options.categories.find((category) => category.value === asString(draft.categoryId))
  };
  const workbookCurrency = asString(workbook && workbook.currency).toUpperCase() || 'PHP';
  const isCreditCardExpense =
    kind?.kind === 'expense' &&
    draft.template === 'expense_charged' &&
    isCreateCreditCard(selection.primaryAccount);
  const isCardPayment = isCreateCardPayment(kind, selection);
  const accountCurrencies = new Set(accounts.map((account) => account.currency));
  const selectedBalanceAccounts = [selection.primaryAccount, selection.secondaryAccount].filter(
    (account) => account && ['asset', 'liability'].includes(account.group)
  );
  const transactionCurrency = asString(draft.currency).toUpperCase() || workbookCurrency;
  const needsAccountCurrencyConversion = selectedBalanceAccounts.some(
    (account) => asString(account.currency).toUpperCase() !== transactionCurrency
  );
  const showFxRate =
    needsAccountCurrencyConversion ||
    (['expense', 'refund'].includes(kind?.kind) &&
      transactionCurrency === 'USD' &&
      workbookCurrency !== 'USD');
  const step = ['type', 'details', 'review'].includes(modal.step)
    ? modal.step
    : kind
      ? 'details'
      : 'type';
  return {
    type: 'composer',
    mode: 'create',
    title: step === 'review' ? 'Review Transaction' : 'Add Transaction',
    step,
    draft,
    kind,
    kindOptions: CREATE_TYPE_OPTIONS,
    errors: asArray(modal.errors),
    warnings: asArray(modal.warnings),
    options: {
      accounts,
      categories,
      currencies: options.currencies
    },
    primaryAccountLabel:
      kind?.kind === 'income'
        ? 'To account'
        : kind?.kind === 'refund'
          ? 'Refunded to'
          : kind?.kind === 'expense'
            ? isCreditCardExpense
              ? 'Charged to'
              : selection.primaryAccount
                ? 'Paid from'
                : 'Paid with'
            : isCardPayment
              ? 'Payment from'
              : 'From account',
    secondaryAccountLabel: isCardPayment ? 'Credit card to pay' : 'To account',
    primaryAccountPlaceholder:
      kind?.kind === 'expense'
        ? 'Choose cash, bank, e-wallet, or credit card'
        : kind?.kind === 'refund'
          ? 'Choose where the refund landed'
          : 'Choose account',
    amountLabel:
      kind?.kind === 'refund'
        ? 'Refund amount'
        : isCreditCardExpense
          ? 'Purchase amount'
          : isCardPayment
            ? 'Payment amount'
            : 'Amount',
    guidance: isCreditCardExpense
      ? {
          tone: 'card',
          icon: 'credit_card',
          title: 'Credit card purchase',
          message:
            'This records the expense now and increases the amount owed. Pay the card later with a transfer.'
        }
      : kind?.kind === 'refund'
        ? {
            tone: 'good',
            icon: 'undo',
            title: 'Merchant refund',
            message:
              'Choose the original expense category. Cavalry will subtract this amount from that category instead of treating it as income.'
          }
        : isCardPayment
          ? {
              tone: 'card',
              icon: 'payments',
              title: 'Credit card payment',
              message: 'This reduces the card balance and will not be counted as another expense.'
            }
          : null,
    showCurrency:
      accountCurrencies.size > 1 || asString(draft.currency).toUpperCase() !== workbookCurrency,
    showFxRate,
    fxRateLabel:
      workbookCurrency === 'PHP' &&
      (transactionCurrency === 'USD' ||
        selectedBalanceAccounts.some((account) => account.currency === 'USD'))
        ? 'USD to PHP rate'
        : `FX rate to ${workbookCurrency}`,
    selection,
    reviewRows: buildCreateReviewRows(kind, draft, selection),
    impact: buildCreateImpact(kind, draft, selection)
  };
}

function buildAccountRunningBalances(workbook, accountId) {
  const account = asArray(workbook && workbook.accounts).find(
    (item) => asString(item && item.id) === asString(accountId)
  );
  if (!account) return null;
  const naturalDebit = isNaturalDebitGroup(account.group);
  let balance = 0;
  const transactions = asArray(workbook && workbook.transactions)
    .slice()
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const dateResult = asString(left.item && left.item.date).localeCompare(
        asString(right.item && right.item.date)
      );
      return dateResult || left.index - right.index;
    });
  const balances = new Map();
  for (const { item } of transactions) {
    for (const line of asArray(item && item.lines)) {
      if (asString(line && line.accountId) !== asString(account.id)) continue;
      const positive = naturalDebit ? line.direction === 'debit' : line.direction === 'credit';
      balance += (positive ? 1 : -1) * (Number(line.baseAmount ?? line.amount) || 0);
    }
    balances.set(asString(item && item.id), { balance, date: asString(item && item.date) });
  }
  return { account, balances };
}

function getAccountBalanceAtTransaction(workbook, transaction, account) {
  if (!account) return null;
  return (
    buildAccountRunningBalances(workbook, account.id)?.balances.get(
      asString(transaction && transaction.id)
    ) || null
  );
}

function formatSignedTransactionMoney(value, currency) {
  const amount = Number(value) || 0;
  const formatted = formatTransactionMoney(amount, currency);
  return amount > 0 ? `+${formatted}` : formatted;
}

function transactionBalanceTone(account, value) {
  const amount = Number(value) || 0;
  if (!amount) return 'neutral';
  if (account?.group === 'liability') return amount > 0 ? 'bad' : 'good';
  return amount > 0 ? 'good' : 'bad';
}

function transactionChangeTone(account, value) {
  const amount = Number(value) || 0;
  if (!amount) return 'neutral';
  if (account?.group === 'liability') return amount > 0 ? 'bad' : 'good';
  return amount > 0 ? 'good' : 'bad';
}

function buildTransactionDetailContext(transaction, account) {
  const template = asString(transaction && transaction.template);
  const accountName = asString(account && account.name) || 'Account';
  const isLiability = account?.group === 'liability';
  const balanceLabel = isLiability ? 'Balance owed' : `${accountName} balance`;
  if (template === 'expense_paid') {
    return {
      accountLabel: 'Paid from',
      movementLabel: `Paid from ${accountName}`,
      beforeLabel: `${balanceLabel} before`,
      afterLabel: `${balanceLabel} after`
    };
  }
  if (template === 'expense_charged') {
    return {
      accountLabel: 'Charged to',
      movementLabel: `Charged to ${accountName}`,
      beforeLabel: 'Balance owed before',
      afterLabel: 'Balance owed after'
    };
  }
  if (template === 'merchant_refund') {
    return {
      accountLabel: 'Refunded to',
      movementLabel: `Refunded to ${accountName}`,
      beforeLabel: `${balanceLabel} before`,
      afterLabel: `${balanceLabel} after`
    };
  }
  if (template === 'income_received') {
    return {
      accountLabel: 'Received in',
      movementLabel: `Received in ${accountName}`,
      beforeLabel: `${balanceLabel} before`,
      afterLabel: `${balanceLabel} after`
    };
  }
  return {
    accountLabel: 'Account',
    movementLabel: titleCase(template),
    beforeLabel: `${balanceLabel} before`,
    afterLabel: `${balanceLabel} after`
  };
}

function buildTransactionModalModel(workbook, state) {
  const modal = state && state.modal;
  if (!modal) return null;
  if (modal.type === 'composer') {
    if (!(modal.draft && modal.draft.transactionId)) {
      return buildCreateComposerModel(workbook, modal);
    }
    const draft = asObject(modal.draft);
    const options = buildComposerOptions(workbook, {
      accountIds: [draft.primaryAccountId, draft.secondaryAccountId].filter(Boolean),
      categoryIds: [draft.categoryId].filter(Boolean)
    });
    return {
      type: 'composer',
      mode: 'edit',
      title: 'Edit Transaction',
      draft,
      errors: asArray(modal.errors),
      warnings: asArray(modal.warnings),
      options,
      context: buildEditComposerContext(state, draft, options)
    };
  }
  const transaction =
    asArray(workbook && workbook.transactions).find(
      (item) => asString(item && item.id) === asString(modal.transactionId)
    ) || null;
  if (!transaction) return null;
  const accountById = byId(workbook && workbook.accounts);
  const categoryById = byId(workbook && workbook.categories);
  const references = resolveTransactionRowReferences(workbook, transaction, {
    accountById,
    categoryById
  });
  const filteredAccountId = asString(state?.view?.accountId);
  const filteredAccount = asArray(transaction.lines).some(
    (line) => asString(line && line.accountId) === filteredAccountId
  )
    ? accountById.get(filteredAccountId)
    : null;
  const account = isBalanceAccount(filteredAccount) ? filteredAccount : references.primaryAccount;
  const category = references.category;
  const template = asString(transaction.template);
  const isRefund = template === 'merchant_refund' || template === 'refund';
  const isExpense =
    !isRefund &&
    (category?.type === 'expense' ||
      ['expense_paid', 'expense_charged', 'debt_payment', 'liability_payment'].includes(template));
  const tone = isRefund || template === 'income_received' ? 'good' : isExpense ? 'bad' : 'info';
  const signedAmount = (isExpense ? -1 : 1) * (Number(transaction.amount) || 0);
  const detailAmount = formatTransactionMoney(
    signedAmount,
    transaction.originalCurrency || (workbook && workbook.currency)
  );
  const balanceAtTransaction = getAccountBalanceAtTransaction(workbook, transaction, account);
  const accountChange = account
    ? asArray(transaction.lines).reduce((total, line) => {
        if (asString(line && line.accountId) !== asString(account.id)) return total;
        const naturalDebit = isNaturalDebitGroup(account.group);
        const positive = naturalDebit ? line.direction === 'debit' : line.direction === 'credit';
        return total + (positive ? 1 : -1) * (Number(line.baseAmount ?? line.amount) || 0);
      }, 0)
    : 0;
  const beforeBalance = balanceAtTransaction ? balanceAtTransaction.balance - accountChange : null;
  const baseCurrency = workbook && workbook.currency;
  const detailContext = buildTransactionDetailContext(transaction, account);
  if (modal.type === 'delete') {
    return {
      type: 'delete',
      transactionId: asString(transaction.id),
      title: 'Delete Transaction',
      description: asString(transaction.description),
      date: asString(transaction.date),
      amount: formatTransactionMoney(
        transaction.amount,
        transaction.originalCurrency || (workbook && workbook.currency)
      ),
      errors: asArray(modal.errors)
    };
  }
  return {
    type: 'detail',
    transactionId: asString(transaction.id),
    title: asString(transaction.description || 'Transaction detail'),
    date: asString(transaction.date),
    displayDate: formatUiDateTime(
      transaction.dateTime || transaction.timestamp || transaction.date
    ),
    typeLabel: titleCase(transaction.template),
    tone,
    icon: isExpense
      ? 'restaurant'
      : transaction.template === 'income_received'
        ? 'trending_up'
        : 'sync_alt',
    amount: detailAmount,
    accountChange: formatSignedTransactionMoney(accountChange, baseCurrency),
    accountLabel: detailContext.accountLabel,
    movementLabel: detailContext.movementLabel,
    account: account?.name || 'Workbook',
    category: category?.name || 'Uncategorized',
    beforeLabel: detailContext.beforeLabel,
    beforeBalance: beforeBalance == null ? '' : formatTransactionMoney(beforeBalance, baseCurrency),
    beforeTone: beforeBalance == null ? 'info' : transactionBalanceTone(account, beforeBalance),
    afterLabel: detailContext.afterLabel,
    afterBalance: balanceAtTransaction
      ? formatTransactionMoney(balanceAtTransaction.balance, baseCurrency)
      : '',
    afterTone: balanceAtTransaction
      ? transactionBalanceTone(account, balanceAtTransaction.balance)
      : 'info',
    changeTone: transactionChangeTone(account, accountChange),
    runningBalance: balanceAtTransaction
      ? formatTransactionMoney(balanceAtTransaction.balance, workbook && workbook.currency)
      : '',
    balanceDate: balanceAtTransaction?.date || '',
    note: asString(transaction.note)
  };
}

export function buildTransactionFeatureModel(workbook, state = {}) {
  const viewState = validateTransactionTableViewState(state.view || {});
  const route = buildTransactionRouteViewModel(workbook || {}, viewState);
  const table = route.tableView;
  const periodLabel = buildPeriodLabel(table.state);
  const summaryRoute = buildTransactionRouteViewModel(workbook || {}, {
    ...viewState,
    type: 'all',
    page: 1
  });
  const totals = summaryRoute.ledgerTotals;
  const transactions = asArray(workbook && workbook.transactions);
  const dates = transactions
    .map((item) => asString(item && item.date))
    .filter(Boolean)
    .sort();
  const amounts = transactions.map((item) => Math.abs(Number(item && item.amount) || 0));
  const amountMax = Math.max(1, ...amounts);
  const options = {
    ...buildFilterOptions(workbook),
    dateRange: { min: dates[0] || '', max: dates[dates.length - 1] || '' },
    amountRange: {
      min: 0,
      max: Math.ceil(amountMax),
      step: Math.max(1, Math.ceil(amountMax / 200)),
      currency: asString(workbook && workbook.currency) || 'PHP'
    }
  };
  const runningBalanceModel = buildAccountRunningBalances(workbook, table.state.accountId);
  const accountFilterLabel =
    asArray(options.accounts).find((option) => option.value === table.state.accountId)?.label || '';
  const startLabel = route.pageStartLabel;
  const endLabel = route.pageEndLabel;
  const incomeTone = totals.income > 0 ? 'good' : 'neutral';
  const expenseTone = totals.expense > 0 ? 'bad' : totals.expense < 0 ? 'good' : 'neutral';
  const netTone = totals.net > 0 ? 'good' : totals.net < 0 ? 'bad' : 'neutral';
  return {
    filterType: table.state.type,
    filterOpen: !!state.filterOpen,
    activeFilterCount: table.activeFilterCount,
    accountFilterLabel,
    showRunningBalance: !!runningBalanceModel,
    filters: {
      accountId: table.state.accountId,
      categoryId: table.state.categoryId,
      search: table.state.search,
      type: table.state.type,
      minAmount: table.state.minAmount,
      maxAmount: table.state.maxAmount,
      start: table.state.dateRange.start,
      end: table.state.dateRange.end,
      sortKey: table.state.sort.key,
      sortDirection: table.state.sort.direction,
      pageSize: table.state.pageSize
    },
    filterOptions: options,
    stats: [
      {
        id: 'income',
        label: 'Total Income',
        value: formatDirectionalTransactionMoney(
          totals.income,
          workbook && workbook.currency,
          incomeTone
        ),
        subtitle: periodLabel,
        icon: 'trending_up',
        tone: incomeTone,
        action: 'open-dashboard-flow',
        payload: { flowType: 'income' }
      },
      {
        id: 'expense',
        label: 'Total Expenses',
        value: formatDirectionalTransactionMoney(
          totals.expense,
          workbook && workbook.currency,
          expenseTone
        ),
        subtitle: periodLabel,
        icon: 'trending_down',
        tone: expenseTone,
        action: 'open-dashboard-flow',
        payload: { flowType: 'expense' }
      },
      {
        id: 'net',
        label: 'Net',
        value: formatDirectionalTransactionMoney(
          totals.net,
          workbook && workbook.currency,
          netTone
        ),
        subtitle: periodLabel,
        icon: 'calculate',
        tone: netTone
      }
    ],
    rows: asArray(table.rows).map((row) =>
      buildTransactionRowModel(row, {
        baseCurrency: workbook && workbook.currency,
        account: runningBalanceModel?.account,
        runningBalances: runningBalanceModel?.balances,
        showRunningBalance: !!runningBalanceModel
      })
    ),
    pagination: {
      visible: table.rowCount > 0,
      currentPage: table.page,
      totalPages: table.totalPages,
      pageSize: table.pageSize,
      copy: table.rowCount ? `${startLabel}-${endLabel} of ${table.rowCount}` : '0 of 0'
    },
    emptyState: table.emptyState,
    modal: buildTransactionModalModel(workbook, state),
    importPreview: buildCsvImportPreviewModel(workbook, state.importSession)
  };
}
