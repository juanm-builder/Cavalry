import {
  getAccountBalanceSnapshotAsOf,
  getAssetLiabilityTotalsAsOf
} from '../../domain/ledger/balances.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeGroups(groups) {
  return Array.isArray(groups) ? groups : [groups];
}

function isAccountInGroups(account, groups) {
  const groupList = normalizeGroups(groups).filter(Boolean);
  return !groupList.length || groupList.indexOf(account && account.group) >= 0;
}

function sortAccountsForView(accounts) {
  return accounts.slice().sort((a, b) => {
    if ((a.isActive === false) !== (b.isActive === false)) {
      return a.isActive === false ? 1 : -1;
    }
    if (!!a.isSystem !== !!b.isSystem) {
      return a.isSystem ? 1 : -1;
    }
    return asString(a && a.name).localeCompare(asString(b && b.name));
  });
}

function toAccountOption(account, options = {}) {
  const accountId = asString(account && account.id);
  const disabledId = asString(options.disabledId);
  return {
    accountId,
    value: accountId,
    label: asString(account && account.name) + ' • ' + asString(account && account.group),
    name: asString(account && account.name),
    group: asString(account && account.group),
    subtype: asString(account && account.subtype),
    currency: asString(account && account.currency).toUpperCase(),
    isArchived: account && account.isActive === false,
    isSystem: account && account.isSystem === true,
    selected: asString(options.selectedValue) === accountId,
    disabled: !!(disabledId && disabledId === accountId)
  };
}

export function getAccountViewItems(workbook, options = {}) {
  return sortAccountsForView(
    asArray(workbook && workbook.accounts).filter((account) => {
      if (!isAccountInGroups(account, options.groups)) {
        return false;
      }
      if (options.includeArchived !== true && account.isActive === false) {
        return false;
      }
      if (options.includeSystem === false && account.isSystem === true) {
        return false;
      }
      return true;
    })
  );
}

export function buildAccountSelectorOptions(workbook, options = {}) {
  return getAccountViewItems(workbook, options).map((account) => toAccountOption(account, options));
}

export function buildAccountRouteViewModel(workbook, options = {}) {
  const asOfDate = asString(options.asOfDate);
  const balances = getAccountBalanceSnapshotAsOf(workbook || {}, asOfDate);
  const totals = getAssetLiabilityTotalsAsOf(workbook || {}, asOfDate);
  const accounts = getAccountViewItems(workbook, {
    groups: options.groups || ['asset', 'liability'],
    includeArchived: options.includeArchived === true,
    includeSystem: options.includeSystem
  });
  const balanceAccounts = accounts.filter((account) => {
    return account.group === 'asset' || account.group === 'liability';
  });
  const selectedId = asString(options.selectedAccountId);
  const selectedAccount =
    (selectedId
      ? balanceAccounts.find((account) => asString(account && account.id) === selectedId)
      : null) ||
    balanceAccounts.find((account) => account.isActive !== false && !account.isSystem) ||
    balanceAccounts[0] ||
    null;
  return {
    currency: asString(workbook && workbook.currency).toUpperCase() || 'PHP',
    asOfDate,
    balances,
    summary: {
      totalAssets: totals.assets,
      totalLiabilities: totals.liabilities,
      netWorth: totals.netWorth
    },
    accountCount: accounts.length,
    accounts: accounts.map((account) =>
      toAccountOption(account, {
        selectedValue: selectedAccount && selectedAccount.id
      })
    ),
    balanceAccountCount: balanceAccounts.length,
    balanceAccounts: balanceAccounts.map((account) =>
      toAccountOption(account, {
        selectedValue: selectedAccount && selectedAccount.id
      })
    ),
    selectedAccountId: selectedAccount ? asString(selectedAccount.id) : '',
    selectedAccount: selectedAccount
      ? toAccountOption(selectedAccount, { selectedValue: selectedAccount.id })
      : null
  };
}
