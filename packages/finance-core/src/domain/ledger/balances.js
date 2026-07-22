import { normalizeDateKey, roundMoney } from '../money.js';

export function isNaturalDebitGroup(group) {
  return ['asset', 'expense'].includes(String(group || 'asset'));
}

export function getAccountById(workbook, accountId) {
  return workbook && workbook.accounts
    ? workbook.accounts.find((account) => account.id === accountId) || null
    : null;
}

export function getLedgerBalancesByField(workbook, asOfDate = '', amountField = 'baseAmount') {
  const cutoff = normalizeDateKey(asOfDate);
  const balances = {};
  (workbook && workbook.accounts ? workbook.accounts : []).forEach((account) => {
    balances[account.id] = 0;
  });
  (workbook && workbook.transactions ? workbook.transactions : []).forEach((transaction) => {
    const date = normalizeDateKey(transaction && transaction.date);
    if (cutoff && date && date > cutoff) {
      return;
    }
    (transaction.lines || []).forEach((line) => {
      const account = getAccountById(workbook, line.accountId);
      if (!account) {
        return;
      }
      const sign = isNaturalDebitGroup(account.group)
        ? line.direction === 'debit'
          ? 1
          : -1
        : line.direction === 'credit'
          ? 1
          : -1;
      balances[account.id] = roundMoney(
        (balances[account.id] || 0) + sign * (Number(line[amountField]) || 0)
      );
    });
  });
  return balances;
}

export function getLedgerHistoricalBalancesAsOf(workbook, asOfDate = '') {
  return getLedgerBalancesByField(workbook, asOfDate, 'baseAmount');
}

export function getLedgerHistoricalBalances(workbook) {
  return getLedgerHistoricalBalancesAsOf(workbook, '');
}

export function getLedgerNativeBalancesAsOf(workbook, asOfDate = '') {
  return getLedgerBalancesByField(workbook, asOfDate, 'amount');
}

export function getLedgerNativeBalances(workbook) {
  return getLedgerNativeBalancesAsOf(workbook, '');
}

function normalizeCurrency(value, fallback = '') {
  return String(value || fallback)
    .trim()
    .toUpperCase();
}

function getWorkbookBaseCurrency(workbook) {
  return normalizeCurrency(workbook && workbook.currency, 'PHP') || 'PHP';
}

function getConfiguredFxRate(workbook, fromCurrency, toCurrency) {
  const from = normalizeCurrency(fromCurrency, getWorkbookBaseCurrency(workbook));
  const to = normalizeCurrency(toCurrency, getWorkbookBaseCurrency(workbook));
  if (from === to) {
    return 1;
  }

  const rates = Array.isArray(workbook && workbook.fxRates) ? workbook.fxRates : [];
  const exact = rates.find(
    (rate) =>
      normalizeCurrency(rate && rate.fromCurrency) === from &&
      normalizeCurrency(rate && rate.toCurrency) === to &&
      Number(rate && rate.rate) > 0
  );
  if (exact) {
    return Number(exact.rate);
  }
  const inverse = rates.find(
    (rate) =>
      normalizeCurrency(rate && rate.fromCurrency) === to &&
      normalizeCurrency(rate && rate.toCurrency) === from &&
      Number(rate && rate.rate) > 0
  );
  if (inverse) {
    return 1 / Number(inverse.rate);
  }

  const base = getWorkbookBaseCurrency(workbook);
  const usdToBaseRate =
    Number(workbook && workbook.settings && workbook.settings.usdToBaseRate) || 0;
  if (usdToBaseRate > 0) {
    if (from === 'USD' && to === base) {
      return usdToBaseRate;
    }
    if (from === base && to === 'USD') {
      return 1 / usdToBaseRate;
    }
  }
  return 0;
}

function getLineCurrency(workbook, account, line) {
  return normalizeCurrency(
    line && line.currency,
    normalizeCurrency(account && account.currency, getWorkbookBaseCurrency(workbook))
  );
}

function getLineBalanceSign(account, line) {
  const positive = isNaturalDebitGroup(account && account.group)
    ? line && line.direction === 'debit'
    : line && line.direction === 'credit';
  return positive ? 1 : -1;
}

export function convertLedgerLineToBase(workbook, line, account = null) {
  const baseCurrency = getWorkbookBaseCurrency(workbook);
  const sourceCurrency = getLineCurrency(workbook, account, line);
  const amount = Number(line && line.amount);
  const historicalBaseAmount = Number(line && line.baseAmount) || 0;
  if (!Number.isFinite(amount)) {
    return roundMoney(historicalBaseAmount);
  }
  if (sourceCurrency === baseCurrency) {
    return roundMoney(amount);
  }
  const rate = getConfiguredFxRate(workbook, sourceCurrency, baseCurrency);
  return rate > 0 ? roundMoney(amount * rate) : roundMoney(historicalBaseAmount);
}

export function getLedgerValuationBalancesAsOf(workbook, asOfDate = '') {
  const cutoff = normalizeDateKey(asOfDate);
  const balances = {};
  (workbook && workbook.accounts ? workbook.accounts : []).forEach((account) => {
    balances[account.id] = 0;
  });
  (workbook && workbook.transactions ? workbook.transactions : []).forEach((transaction) => {
    const date = normalizeDateKey(transaction && transaction.date);
    if (cutoff && date && date > cutoff) {
      return;
    }
    (transaction.lines || []).forEach((line) => {
      const account = getAccountById(workbook, line.accountId);
      if (!account) {
        return;
      }
      balances[account.id] = roundMoney(
        (balances[account.id] || 0) +
          getLineBalanceSign(account, line) * convertLedgerLineToBase(workbook, line, account)
      );
    });
  });
  return balances;
}

export function getLedgerValuationBalances(workbook) {
  return getLedgerValuationBalancesAsOf(workbook, '');
}

export function getLedgerNativeBalancesByCurrencyAsOf(workbook, asOfDate = '') {
  const cutoff = normalizeDateKey(asOfDate);
  const balances = {};
  (workbook && workbook.accounts ? workbook.accounts : []).forEach((account) => {
    balances[account.id] = {};
  });
  (workbook && workbook.transactions ? workbook.transactions : []).forEach((transaction) => {
    const date = normalizeDateKey(transaction && transaction.date);
    if (cutoff && date && date > cutoff) {
      return;
    }
    (transaction.lines || []).forEach((line) => {
      const account = getAccountById(workbook, line.accountId);
      if (!account) {
        return;
      }
      const currency = getLineCurrency(workbook, account, line);
      const amount = Number(line && line.amount) || 0;
      balances[account.id][currency] = roundMoney(
        (balances[account.id][currency] || 0) + getLineBalanceSign(account, line) * amount
      );
    });
  });
  return balances;
}

export function getLedgerNativeBalancesByCurrency(workbook) {
  return getLedgerNativeBalancesByCurrencyAsOf(workbook, '');
}

function getCurrencyIntegrityFromBuckets(workbook, account, currencyBalances) {
  const configuredCurrency = normalizeCurrency(
    account && account.currency,
    getWorkbookBaseCurrency(workbook)
  );
  const postingCurrencies = Object.keys(currencyBalances || {})
    .map((currency) => normalizeCurrency(currency))
    .filter(Boolean)
    .sort();
  const mismatched = postingCurrencies.some((currency) => currency !== configuredCurrency);
  return {
    configuredCurrency,
    postingCurrencies,
    mismatched,
    mixed: postingCurrencies.length > 1,
    trustworthy: !mismatched && postingCurrencies.length <= 1
  };
}

function getLedgerTrustedBaseBalanceSnapshotAsOf(workbook, asOfDate = '') {
  const historical = getLedgerHistoricalBalancesAsOf(workbook, asOfDate);
  const valuation = getLedgerValuationBalancesAsOf(workbook, asOfDate);
  const nativeByCurrency = getLedgerNativeBalancesByCurrencyAsOf(workbook, asOfDate);
  const balances = {};
  const currencyIntegrityAccountIds = [];
  (workbook && workbook.accounts ? workbook.accounts : []).forEach((account) => {
    const integrity = getCurrencyIntegrityFromBuckets(
      workbook,
      account,
      nativeByCurrency[account.id]
    );
    const hasCurrencyIntegrityIssue = !!(
      account &&
      (account.group === 'asset' || account.group === 'liability') &&
      !integrity.trustworthy
    );
    if (hasCurrencyIntegrityIssue) currencyIntegrityAccountIds.push(account.id);
    balances[account.id] = roundMoney(
      hasCurrencyIntegrityIssue
        ? Number(historical[account.id]) || 0
        : Number(valuation[account.id]) || 0
    );
  });
  return {
    balances,
    currencyIntegrityAccountIds,
    historical,
    valuation,
    nativeByCurrency
  };
}

export function getLedgerTrustedBaseBalancesAsOf(workbook, asOfDate = '') {
  return getLedgerTrustedBaseBalanceSnapshotAsOf(workbook, asOfDate).balances;
}

export function getLedgerTrustedBaseBalances(workbook) {
  return getLedgerTrustedBaseBalancesAsOf(workbook, '');
}

export function getLedgerDisplayBalancesAsOf(workbook, asOfDate = '') {
  const baseCurrency = getWorkbookBaseCurrency(workbook);
  const nativeByCurrency = getLedgerNativeBalancesByCurrencyAsOf(workbook, asOfDate);
  const valuation = getLedgerValuationBalancesAsOf(workbook, asOfDate);
  const historical = getLedgerHistoricalBalancesAsOf(workbook, asOfDate);
  const balances = {};
  const currencies = {};
  const mixedCurrencyAccountIds = [];
  const currencyIntegrityAccountIds = [];
  (workbook && workbook.accounts ? workbook.accounts : []).forEach((account) => {
    const currencyBalances = nativeByCurrency[account.id] || {};
    const integrity = getCurrencyIntegrityFromBuckets(workbook, account, currencyBalances);
    const postingCurrencies = integrity.postingCurrencies;
    const hasCurrencyIntegrityIssue = !!(
      account &&
      (account.group === 'asset' || account.group === 'liability') &&
      !integrity.trustworthy
    );
    if (hasCurrencyIntegrityIssue) {
      currencyIntegrityAccountIds.push(account.id);
      if (integrity.mixed) mixedCurrencyAccountIds.push(account.id);
      currencies[account.id] = baseCurrency;
      balances[account.id] = roundMoney(historical[account.id] || 0);
      return;
    }
    if (postingCurrencies.length === 1) {
      currencies[account.id] = postingCurrencies[0];
      balances[account.id] = roundMoney(currencyBalances[postingCurrencies[0]] || 0);
      return;
    }
    if (postingCurrencies.length > 1) {
      currencies[account.id] = baseCurrency;
      balances[account.id] = roundMoney(valuation[account.id] || 0);
      return;
    }
    currencies[account.id] = normalizeCurrency(account && account.currency, baseCurrency);
    balances[account.id] = 0;
  });
  return {
    balances,
    currencies,
    nativeByCurrency,
    mixedCurrencyAccountIds,
    currencyIntegrityAccountIds
  };
}

export function getAccountBalanceSnapshotAsOf(workbook, asOfDate = '') {
  const display = getLedgerDisplayBalancesAsOf(workbook, asOfDate);
  const trustedBase = getLedgerTrustedBaseBalanceSnapshotAsOf(workbook, asOfDate);
  return {
    historical: trustedBase.historical,
    native: getLedgerNativeBalancesAsOf(workbook, asOfDate),
    valuation: trustedBase.valuation,
    trustedBase: trustedBase.balances,
    display: display.balances,
    displayCurrency: display.currencies,
    nativeByCurrency: display.nativeByCurrency,
    mixedCurrencyAccountIds: display.mixedCurrencyAccountIds,
    currencyIntegrityAccountIds: display.currencyIntegrityAccountIds
  };
}

export function getAccountBaseBalanceAsOf(workbook, accountId, asOfDate = '') {
  return getLedgerHistoricalBalancesAsOf(workbook, asOfDate)[accountId] || 0;
}

export function getAssetLiabilityTotalsAsOf(workbook, asOfDate = '') {
  const balances = getLedgerTrustedBaseBalancesAsOf(workbook, asOfDate);
  const accounts = workbook && workbook.accounts ? workbook.accounts : [];
  const assets = accounts
    .filter((account) => account.group === 'asset')
    .reduce((sum, account) => roundMoney(sum + Math.max(0, balances[account.id] || 0)), 0);
  const liabilities = accounts
    .filter((account) => account.group === 'liability')
    .reduce((sum, account) => roundMoney(sum + Math.max(0, balances[account.id] || 0)), 0);
  return {
    assets,
    liabilities,
    netWorth: roundMoney(assets - liabilities)
  };
}
