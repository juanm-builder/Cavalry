function asString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeCurrency(value, fallback = '') {
  return asString(value || fallback).toUpperCase();
}

function getWorkbookBaseCurrency(workbook) {
  return normalizeCurrency(workbook && workbook.currency, 'PHP') || 'PHP';
}

function getWorkbookAccount(workbook, accountId) {
  const id = asString(accountId);
  return (
    (workbook && Array.isArray(workbook.accounts) ? workbook.accounts : []).find(
      (account) => asString(account && account.id) === id
    ) || null
  );
}

/**
 * Reports the currencies that are actually present on an account's ledger lines.
 * This deliberately scans lines instead of net currency balances: offsetting entries
 * must not be allowed to hide mixed or mismatched posting history.
 */
export function getAccountCurrencyIntegrity(workbook, accountId) {
  const id = asString(accountId);
  const account = getWorkbookAccount(workbook, id);
  const configuredCurrency = normalizeCurrency(
    account && account.currency,
    getWorkbookBaseCurrency(workbook)
  );
  const postingCurrencies = new Set();
  const transactionIds = new Set();
  const lineIds = [];
  const missingCurrencyLineIds = [];
  let lineCount = 0;

  (workbook && Array.isArray(workbook.transactions) ? workbook.transactions : []).forEach(
    (transaction, transactionIndex) => {
      (transaction && Array.isArray(transaction.lines) ? transaction.lines : []).forEach(
        (line, lineIndex) => {
          if (asString(line && line.accountId) !== id) return;
          lineCount += 1;
          const transactionId = asString(transaction && transaction.id);
          if (transactionId) transactionIds.add(transactionId);
          const lineId = asString(line && line.id);
          lineIds.push(
            lineId || `${transactionId || `transaction_${transactionIndex}`}:${lineIndex}`
          );
          const currency = normalizeCurrency(line && line.currency);
          if (currency) postingCurrencies.add(currency);
          else {
            // Older Cavalry workbooks did not persist a currency on every line.
            // Those lines inherit the account's configured currency; retain their
            // ids for diagnostics without treating all legacy history as corrupt.
            if (configuredCurrency) postingCurrencies.add(configuredCurrency);
            missingCurrencyLineIds.push(
              lineId || `${transactionId || `transaction_${transactionIndex}`}:${lineIndex}`
            );
          }
        }
      );
    }
  );

  const currencies = Array.from(postingCurrencies).sort();
  const isBalanceAccount = !!(
    account &&
    (account.group === 'asset' || account.group === 'liability')
  );
  const hasMissingCurrency = missingCurrencyLineIds.length > 0;
  const mismatched =
    isBalanceAccount && currencies.some((currency) => currency !== configuredCurrency);
  const mixed = currencies.length > 1;

  return {
    accountId: id,
    accountName: asString(account && account.name),
    accountGroup: asString(account && account.group),
    exists: !!account,
    isBalanceAccount,
    configuredCurrency,
    postingCurrencies: currencies,
    transactionIds: Array.from(transactionIds),
    lineIds,
    lineCount,
    hasHistory: lineCount > 0,
    hasMissingCurrency,
    missingCurrencyLineIds,
    mismatched,
    mixed,
    consistent: !!account && (!isBalanceAccount || (!mismatched && !mixed))
  };
}
