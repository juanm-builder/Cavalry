import {
  archiveAccount,
  buildAccountCurrencyRepairPreview,
  buildAccountRouteViewModel,
  convertLedgerLineToBase,
  createAccount,
  deleteAccount,
  findAccountById,
  findInstitutionById,
  getAccountUsage,
  getAccountCurrencyIntegrity,
  isNaturalDebitGroup,
  isTimeDepositSubtype,
  resolveInstitution,
  restoreAccount,
  repairAccountCurrency,
  retireAccount,
  roundMoney,
  updateAccount
} from '@cavalry/finance-core';
import {
  cloneWorkbook,
  commandError,
  commandOk
} from '@cavalry/finance-core/application/types/command-result.js';

export const ACCOUNT_ACTIONS = Object.freeze({
  CREATE: 'account/create',
  UPDATE: 'account/update',
  ARCHIVE: 'account/archive',
  RESTORE: 'account/restore',
  RETIRE: 'account/retire',
  REPAIR_CURRENCY: 'account/repair-currency',
  DELETE: 'account/delete'
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function errorResult(workbook, error, fallbackCode = 'account.command_failed') {
  return commandError(workbook, {
    code: asText(error?.code) || fallbackCode,
    message: asText(error?.message) || 'The account change could not be completed.',
    ...(error?.details ? { details: error.details } : {})
  });
}

function deterministicServices(workbook, action, services = {}) {
  let sequence = 0;
  const payload = action?.payload || {};
  const seed = asArray(workbook?.accounts).length + asArray(workbook?.transactions).length;
  return {
    ...services,
    createId:
      typeof services.createId === 'function'
        ? services.createId
        : (prefix = 'id') =>
            `${asText(prefix).replace(/[^a-z0-9_-]+/gi, '_')}_${seed + ++sequence}`,
    today:
      typeof services.today === 'function'
        ? services.today
        : () => asText(payload.openedDate) || `${Number(workbook?.year) || 1970}-01-01`
  };
}

function changedOrError(originalWorkbook, nextWorkbook, operation, event, warnings = []) {
  if (!operation?.changed) {
    return errorResult(originalWorkbook, {
      code: 'account.not_changed',
      message: 'The account was not found or is protected and cannot be changed.'
    });
  }
  return commandOk(nextWorkbook, {
    events: [event],
    warnings
  });
}

export function executeAccountCommand(workbook, action, services = {}) {
  if (!workbook || typeof workbook !== 'object') {
    return errorResult(workbook, {
      code: 'account.workbook_required',
      message: 'Open a workbook before changing accounts.'
    });
  }

  const type = asText(action?.type);
  const payload = action?.payload && typeof action.payload === 'object' ? action.payload : {};
  const accountId = asText(payload.accountId);
  const nextWorkbook = cloneWorkbook(workbook);
  const commandServices = deterministicServices(nextWorkbook, action, services);

  try {
    if (type === ACCOUNT_ACTIONS.CREATE) {
      const operation = createAccount(nextWorkbook, payload, commandServices);
      return changedOrError(workbook, nextWorkbook, operation, {
        type: 'account.created',
        accountId: operation.account?.id || ''
      });
    }

    if (!accountId) {
      return errorResult(workbook, {
        code: 'account.id_required',
        message: 'Choose an account before continuing.'
      });
    }

    if (type === ACCOUNT_ACTIONS.REPAIR_CURRENCY) {
      return repairAccountCurrency(workbook, {
        accountId,
        targetCurrency: payload.targetCurrency,
        expectedFingerprint: payload.expectedFingerprint,
        confirmed: payload.confirmed === true
      });
    }

    if (type === ACCOUNT_ACTIONS.UPDATE) {
      const operation = updateAccount(nextWorkbook, accountId, payload, commandServices);
      return changedOrError(workbook, nextWorkbook, operation, {
        type: 'account.updated',
        accountId
      });
    }

    if (type === ACCOUNT_ACTIONS.ARCHIVE) {
      const operation = archiveAccount(nextWorkbook, accountId);
      return changedOrError(workbook, nextWorkbook, operation, {
        type: 'account.archived',
        accountId
      });
    }

    if (type === ACCOUNT_ACTIONS.RESTORE) {
      const operation = restoreAccount(nextWorkbook, accountId);
      return changedOrError(workbook, nextWorkbook, operation, {
        type: 'account.restored',
        accountId
      });
    }

    if (type === ACCOUNT_ACTIONS.RETIRE) {
      const operation = retireAccount(nextWorkbook, accountId);
      return changedOrError(workbook, nextWorkbook, operation, {
        type: 'account.retired',
        accountId
      });
    }

    if (type === ACCOUNT_ACTIONS.DELETE) {
      const operation = deleteAccount(nextWorkbook, accountId);
      const archived = operation?.archived === true;
      return changedOrError(
        workbook,
        nextWorkbook,
        operation,
        {
          type: archived ? 'account.archived' : 'account.deleted',
          accountId,
          removedTransactionIds: asArray(operation?.removedTransactionIds)
        },
        archived
          ? [
              {
                code: 'account.archived_instead_of_deleted',
                message:
                  'The account has history or references, so it was archived instead of deleted.'
              }
            ]
          : []
      );
    }

    return errorResult(workbook, {
      code: 'account.action_unknown',
      message: `Unsupported account action: ${type || 'empty'}.`
    });
  } catch (error) {
    return errorResult(workbook, error);
  }
}

export function formatAccountMoney(value, currency = 'PHP') {
  const amount = roundMoney(value);
  const code = asText(currency).toUpperCase() || 'PHP';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch (_error) {
    return `${code} ${amount.toFixed(2)}`;
  }
}

function accountTypeLabel(account) {
  if (isTimeDepositSubtype(account?.subtype)) return 'Time Deposit';
  const knownLabels = {
    bank: 'Bank Account',
    cash: 'Cash',
    checking: 'Checking',
    credit_card: 'Credit Card',
    investment: 'Investment',
    loan: 'Loan',
    other_asset: 'Other Asset',
    savings: 'Savings',
    wallet: 'E-Wallet'
  };
  const normalizedSubtype = asText(account?.subtype)
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  if (knownLabels[normalizedSubtype]) return knownLabels[normalizedSubtype];
  const contextualLabels = {
    bank: 'Bank Account',
    cash: 'Cash',
    wallet: 'E-Wallet',
    credit_card: 'Credit Card',
    investment: 'Investment',
    liability: 'Liability'
  };
  const contextKind = accountContextKind(account);
  if (contextualLabels[contextKind]) return contextualLabels[contextKind];
  if (account?.group === 'liability') return 'Liability';
  const subtype = asText(account?.subtype).replace(/[_-]+/g, ' ');
  if (!subtype) return 'Asset Account';
  return subtype.replace(/\b\w/g, (character) => character.toUpperCase());
}

function accountContextKind(account) {
  const subtype = asText(account?.subtype)
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  const group = asText(account?.group).toLowerCase();
  if (['bank', 'savings', 'checking'].includes(subtype)) return 'bank';
  if (subtype === 'cash') return 'cash';
  if (['wallet', 'e_wallet', 'ewallet'].includes(subtype)) return 'wallet';
  if (['credit_card', 'card'].includes(subtype)) return 'credit_card';
  if (['investment', 'time_deposit'].includes(subtype)) return 'investment';
  if (group === 'liability' || ['loan', 'liability'].includes(subtype)) return 'liability';
  const institution =
    findInstitutionById(asText(account?.institutionId)) ||
    resolveInstitution(asText(account?.institution)) ||
    resolveInstitution(asText(account?.name));
  if (institution?.type === 'e_wallet') return 'wallet';
  if (institution?.type === 'bank' || institution?.type === 'digital_bank') return 'bank';
  if (/(^|\s)cash($|\s)|petty cash/i.test(asText(account?.name))) return 'cash';
  return 'asset';
}

function accountValueTone(group, value) {
  const amount = Number(value) || 0;
  if (amount === 0) return 'neutral';
  if (group === 'liability') return amount > 0 ? 'bad' : 'good';
  return amount > 0 ? 'good' : 'bad';
}

function accountIcon(account) {
  const customIcon = asText(account?.icon);
  if (customIcon) return customIcon;
  return {
    bank: 'account_balance',
    cash: 'payments',
    wallet: 'account_balance_wallet',
    credit_card: 'credit_card',
    investment: isTimeDepositSubtype(account?.subtype) ? 'savings' : 'trending_up',
    liability: 'request_quote',
    asset: 'account_balance_wallet'
  }[accountContextKind(account)];
}

function accountInstitution(account) {
  return asText(account?.institution) || accountTypeLabel(account);
}

function accountInstitutionId(account) {
  const persisted = asText(account?.institutionId);
  if (persisted && findInstitutionById(persisted)) return persisted;
  const resolved = resolveInstitution(asText(account?.institution));
  return resolved ? resolved.id : '';
}

function accountLogoMode(account) {
  const savedMode = asText(account?.logoMode).toLowerCase();
  if (savedMode === 'icon' || savedMode === 'institution') return savedMode;
  if (accountInstitutionId(account)) return 'institution';
  return asText(account?.icon) ? 'icon' : 'institution';
}

function accountInstitutionColor(account) {
  return findInstitutionById(accountInstitutionId(account))?.color || '';
}

function transactionTypeLabel(template) {
  return (
    asText(template)
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase()) || 'Transaction'
  );
}

function transactionIcon(template) {
  return (
    {
      debt_payment: 'payments',
      expense_charged: 'credit_card',
      expense_paid: 'shopping_cart',
      income_received: 'trending_up',
      liability_payment: 'payments',
      opening_balance: 'account_balance_wallet',
      transfer: 'sync_alt'
    }[asText(template)] || 'receipt_long'
  );
}

function getAccountHistoryRows(
  workbook,
  account,
  currency,
  asOfDate = '',
  useHistoricalBase = false
) {
  let runningBalance = 0;
  const naturalDebit = isNaturalDebitGroup(account?.group);
  const cutoff = asText(asOfDate);
  const baseCurrency = asText(workbook?.currency).toUpperCase() || 'PHP';
  const accountById = new Map(asArray(workbook?.accounts).map((item) => [asText(item?.id), item]));
  const categoryById = new Map(
    asArray(workbook?.categories).map((item) => [asText(item?.id), item])
  );
  return asArray(workbook?.transactions)
    .slice()
    .sort((left, right) => asText(left?.date).localeCompare(asText(right?.date)))
    .reduce((rows, transaction) => {
      const transactionDate = asText(transaction?.date);
      if (cutoff && transactionDate && transactionDate > cutoff) return rows;
      const change = asArray(transaction?.lines).reduce((total, line) => {
        if (line?.accountId !== account?.id) return total;
        const positive = naturalDebit ? line.direction === 'debit' : line.direction === 'credit';
        const amount = useHistoricalBase
          ? Number(line.baseAmount ?? line.amount) || 0
          : currency === baseCurrency
            ? convertLedgerLineToBase(workbook, line, account)
            : Number(line.amount) || 0;
        return roundMoney(total + (positive ? 1 : -1) * amount);
      }, 0);
      if (!change) return rows;
      const beforeBalance = runningBalance;
      runningBalance = roundMoney(runningBalance + change);
      const template = asText(transaction?.template);
      const category = categoryById.get(asText(transaction?.categoryId));
      const relatedAccounts = Array.from(
        new Set(
          asArray(transaction?.lines)
            .filter((line) => asText(line?.accountId) !== asText(account?.id))
            .map((line) => accountById.get(asText(line?.accountId))?.name)
            .filter(Boolean)
        )
      );
      const transactionCurrency =
        asText(transaction?.originalCurrency || transaction?.currency).toUpperCase() ||
        baseCurrency;
      const transactionAmount = Number(
        transaction?.amount ?? transaction?.baseAmount ?? Math.abs(change)
      );
      const changeTone = accountValueTone(account?.group, change);
      const balanceTone = accountValueTone(account?.group, runningBalance);
      return rows.concat({
        transactionId: asText(transaction?.id),
        date: asText(transaction?.date),
        description: asText(transaction?.description) || 'Transaction',
        typeLabel: transactionTypeLabel(template),
        icon: transactionIcon(template),
        accountName: asText(account?.name) || 'Account',
        categoryName:
          asText(category?.name) ||
          (template === 'transfer'
            ? 'Transfer'
            : template === 'opening_balance'
              ? 'Opening balance'
              : 'Uncategorized'),
        relatedAccountNames: relatedAccounts,
        relatedAccountCopy: template === 'transfer' ? relatedAccounts.join(', ') : '',
        note: asText(transaction?.note),
        amount: Number.isFinite(transactionAmount) ? transactionAmount : Math.abs(change),
        amountCopy: formatAccountMoney(
          Number.isFinite(transactionAmount) ? transactionAmount : Math.abs(change),
          transactionCurrency
        ),
        change,
        changeCopy: formatAccountMoney(change, currency),
        changeTone,
        beforeBalance,
        beforeBalanceCopy: formatAccountMoney(beforeBalance, currency),
        runningBalance,
        balanceCopy: formatAccountMoney(runningBalance, currency),
        balanceTone,
        title: [
          asText(transaction?.date),
          asText(transaction?.description),
          formatAccountMoney(runningBalance, currency)
        ]
          .filter(Boolean)
          .join(' - ')
      });
    }, [])
    .slice(-8)
    .reverse();
}

export function buildAccountsFeatureModel(workbook, options = {}) {
  const currency = asText(workbook?.currency).toUpperCase() || 'PHP';
  const coreModel = buildAccountRouteViewModel(workbook || {}, {
    includeArchived: options.showArchived === true,
    selectedAccountId: options.selectedAccountId || '',
    asOfDate: options.asOfDate || ''
  });
  const baseBalances = coreModel.balances?.trustedBase || coreModel.balances?.valuation || {};
  const historicalBalances = coreModel.balances?.historical || {};
  const displayBalances = coreModel.balances?.display || coreModel.balances?.native || {};
  const accounts = asArray(coreModel.balanceAccounts)
    .map((item) => findAccountById(workbook, item.value))
    .filter(Boolean);
  const selectedAccount = coreModel.selectedAccountId
    ? findAccountById(workbook, coreModel.selectedAccountId)
    : null;
  const selectedUsage = selectedAccount ? getAccountUsage(workbook, selectedAccount.id) : null;
  const assetTotal = roundMoney(coreModel.summary?.totalAssets || 0);
  const liabilityTotal = roundMoney(coreModel.summary?.totalLiabilities || 0);

  const accountRows = accounts.map((account) => {
    const configuredCurrency = asText(account.currency).toUpperCase() || currency;
    const integrity = getAccountCurrencyIntegrity(workbook, account.id);
    const hasCurrencyIntegrityIssue = integrity.mismatched || integrity.mixed;
    const balanceCurrency = hasCurrencyIntegrityIssue ? currency : configuredCurrency;
    const balance = roundMoney(
      (hasCurrencyIntegrityIssue ? historicalBalances : displayBalances)[account.id] || 0
    );
    const baseBalance = roundMoney(baseBalances[account.id] || 0);
    const usage = getAccountUsage(workbook, account.id);
    const isArchived = account.isActive === false;
    const isSystem = account.isSystem === true;
    return {
      id: account.id,
      name: account.name || '',
      currency: configuredCurrency,
      balanceCurrency,
      configuredCurrency,
      postingCurrencies: integrity.postingCurrencies,
      hasCurrencyMismatch: integrity.mismatched,
      hasMixedCurrencies: integrity.mixed,
      hasCurrencyIntegrityIssue,
      isArchived,
      isSelected: selectedAccount?.id === account.id,
      isSystem,
      icon: accountIcon(account),
      logoMode: accountLogoMode(account),
      tone: account.group === 'liability' ? 'bad' : 'good',
      typeLabel: accountTypeLabel(account),
      group: account.group || 'asset',
      subtype: account.subtype || '',
      contextKind: accountContextKind(account),
      institution: accountInstitution(account),
      institutionId: accountInstitutionId(account),
      institutionColor: accountInstitutionColor(account),
      balanceCell: {
        accountId: account.id,
        value: balance,
        currency: balanceCurrency,
        copy: formatAccountMoney(balance, balanceCurrency),
        baseValue: baseBalance,
        baseCurrency: currency,
        baseCopy: formatAccountMoney(baseBalance, currency),
        tone: accountValueTone(account.group, balance),
        canToggle: false
      },
      activityCopy: hasCurrencyIntegrityIssue
        ? 'Currency repair required'
        : usage.transactionCount
          ? `${usage.transactionCount} transaction${usage.transactionCount === 1 ? '' : 's'}`
          : 'No activity',
      activityPercent: '',
      activityTone: hasCurrencyIntegrityIssue ? 'bad' : 'info',
      canArchive: !isArchived && !isSystem,
      canRestore: isArchived && !isSystem,
      canPostDailyInterest: isTimeDepositSubtype(account.subtype),
      canRedeemTimeDeposit: isTimeDepositSubtype(account.subtype),
      canRetire: account.group === 'liability' && !isArchived && !isSystem,
      canDelete: !isSystem,
      hasReferences: usage.hasReferences
    };
  });

  const selectedIntegrity = selectedAccount
    ? getAccountCurrencyIntegrity(workbook, selectedAccount.id)
    : null;
  const selectedHasCurrencyIntegrityIssue = !!(
    selectedIntegrity &&
    (selectedIntegrity.mismatched || selectedIntegrity.mixed)
  );
  const selectedCurrency = selectedAccount
    ? asText(selectedAccount.currency).toUpperCase() || currency
    : currency;
  const selectedBalanceCurrency = selectedHasCurrencyIntegrityIssue ? currency : selectedCurrency;
  const selectedBalance = selectedAccount
    ? roundMoney(
        (selectedHasCurrencyIntegrityIssue ? historicalBalances : displayBalances)[
          selectedAccount.id
        ] || 0
      )
    : 0;
  const selectedRepairPreview = selectedHasCurrencyIntegrityIssue
    ? buildAccountCurrencyRepairPreview(workbook, {
        accountId: selectedAccount.id,
        targetCurrency: currency
      })
    : null;
  return {
    currency,
    asOfLabel: options.asOfLabel || options.asOfDate || 'All dates',
    showArchived: options.showArchived === true,
    selectedAccountId: coreModel.selectedAccountId,
    summary: {
      netWorthCopy: formatAccountMoney(assetTotal - liabilityTotal, currency),
      netWorthTone: accountValueTone('asset', assetTotal - liabilityTotal),
      assetCopy: formatAccountMoney(assetTotal, currency),
      assetTone: accountValueTone('asset', assetTotal),
      creditCopy: formatAccountMoney(liabilityTotal, currency),
      creditTone: accountValueTone('liability', liabilityTotal)
    },
    accountRows,
    selectedAccount: selectedAccount
      ? {
          id: selectedAccount.id,
          name: selectedAccount.name || '',
          currency: selectedCurrency,
          configuredCurrency: selectedCurrency,
          balanceCurrency: selectedBalanceCurrency,
          postingCurrencies: selectedIntegrity?.postingCurrencies || [],
          hasCurrencyMismatch: selectedIntegrity?.mismatched === true,
          hasMixedCurrencies: selectedIntegrity?.mixed === true,
          hasCurrencyIntegrityIssue: selectedHasCurrencyIntegrityIssue,
          currencyIntegrityCopy: selectedHasCurrencyIntegrityIssue
            ? selectedIntegrity?.missingCurrencyLineIds?.length
              ? 'Some historical postings have no recorded currency, so Cavalry cannot treat this balance as fully verified.'
              : `This account is set to ${selectedCurrency}, but its ledger contains ${
                  selectedIntegrity?.postingCurrencies?.join(' and ') || 'different'
                } postings.`
            : '',
          repairPreview: selectedRepairPreview,
          canRepairCurrency:
            selectedRepairPreview?.ok === true &&
            selectedRepairPreview?.requiresConfirmation === true,
          openedDate: selectedAccount.openedDate || '',
          isArchived: selectedAccount.isActive === false,
          isSystem: selectedAccount.isSystem === true,
          hasHistory: selectedUsage?.hasHistory === true,
          icon: accountIcon(selectedAccount),
          logoMode: accountLogoMode(selectedAccount),
          tone: selectedAccount.group === 'liability' ? 'bad' : 'good',
          typeLabel: accountTypeLabel(selectedAccount),
          group: selectedAccount.group || 'asset',
          subtype: selectedAccount.subtype || '',
          contextKind: accountContextKind(selectedAccount),
          institution: accountInstitution(selectedAccount),
          institutionName: asText(selectedAccount.institution),
          institutionId: accountInstitutionId(selectedAccount),
          institutionColor: accountInstitutionColor(selectedAccount),
          note: selectedAccount.note || '',
          balanceCopy: formatAccountMoney(selectedBalance, selectedBalanceCurrency),
          balanceLabel: selectedHasCurrencyIntegrityIssue
            ? `Historical book balance (${selectedBalanceCurrency})`
            : '',
          balanceTone: accountValueTone(selectedAccount.group, selectedBalance),
          changeCopy: '',
          changeTone: 'info',
          changePercentCopy: '',
          activityLabel: '',
          asOfLabel: options.asOfLabel || options.asOfDate || 'All dates',
          historyRows: getAccountHistoryRows(
            workbook,
            selectedAccount,
            selectedBalanceCurrency,
            options.asOfDate || '',
            selectedHasCurrencyIntegrityIssue
          )
        }
      : null
  };
}
