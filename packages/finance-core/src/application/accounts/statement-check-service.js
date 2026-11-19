import { getAccountBalanceSnapshotAsOf, getAccountById } from '../../domain/ledger/balances.js';

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const timestamp = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}

function toMinorUnits(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value.trim()))
    return null;
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents / 100 === amount ? cents : null;
}

export function validStatementCheckHistory(checks) {
  if (checks === undefined) return true;
  if (!Array.isArray(checks)) return false;
  const dates = new Set();
  return checks.every((entry) => {
    if (
      !validDate(entry?.date) ||
      dates.has(entry.date) ||
      typeof entry.balance !== 'number' ||
      toMinorUnits(entry.balance) === null ||
      typeof entry.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(entry.currency)
    )
      return false;
    dates.add(entry.date);
    return true;
  });
}

export function getStatementCheck(workbook, accountId, date, statementBalance) {
  const account = getAccountById(workbook, accountId);
  if (!account || !['asset', 'liability'].includes(account.group)) {
    return { ok: false, message: 'Choose a bank, cash, or liability account.' };
  }
  if (!validDate(date)) return { ok: false, message: 'Enter a valid statement closing date.' };
  const stated = toMinorUnits(statementBalance);
  if (stated === null)
    return { ok: false, message: 'Enter a closing balance with up to two decimal places.' };
  const snapshot = getAccountBalanceSnapshotAsOf(workbook, date);
  const currency = account.currency;
  const ledgerBalance = snapshot.display[accountId];
  const ledger = toMinorUnits(ledgerBalance);
  if (
    ledger === null ||
    snapshot.displayCurrency[accountId] !== currency ||
    snapshot.currencyIntegrityAccountIds.includes(accountId)
  ) {
    return {
      ok: false,
      message: 'Review the currency of this account’s entries before checking its statement.'
    };
  }
  const difference = stated - ledger;
  if (!Number.isSafeInteger(difference))
    return { ok: false, message: 'The difference is too large to compare accurately.' };
  return {
    ok: true,
    date,
    currency,
    ledgerBalance,
    statementBalance: stated / 100,
    difference: difference / 100,
    matches: difference === 0
  };
}

export function saveStatementCheck(workbook, accountId, date, statementBalance) {
  const check = getStatementCheck(workbook, accountId, date, statementBalance);
  if (!check.ok) return check;
  if (!check.matches)
    return {
      ok: false,
      message: 'The statement and ledger balances must match to save this check.'
    };
  const account = getAccountById(workbook, accountId);
  if (!validStatementCheckHistory(account.statementChecks))
    return { ok: false, message: 'The saved statement checks for this account need review.' };
  const history = account.statementChecks || [];
  const existing = history.find((entry) => entry.date === date);
  if (existing?.balance === check.statementBalance && existing.currency === check.currency)
    return { ok: true, workbook };
  const entry = { date, balance: check.statementBalance, currency: check.currency };
  const statementChecks = [...history.filter((item) => item.date !== date), entry].sort((a, b) =>
    b.date.localeCompare(a.date)
  );
  return {
    ok: true,
    workbook: {
      ...workbook,
      accounts: workbook.accounts.map((item) =>
        item === account ? { ...item, statementChecks } : item
      )
    }
  };
}
