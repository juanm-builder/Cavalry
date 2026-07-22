import { getAccountCurrencyIntegrity } from '../../domain/ledger/account-currency-integrity.js';
import {
  getLedgerHistoricalBalances,
  getLedgerNativeBalancesByCurrency
} from '../../domain/ledger/balances.js';
import { validateLedgerInvariants } from '../../domain/ledger/invariants.js';
import { roundMoney } from '../../domain/money.js';
import { isTransactionBalanced } from '../../domain/ledger/validation.js';
import { cloneWorkbook, commandError, commandOk } from '../types/command-result.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeCurrency(value, fallback = '') {
  return asString(value || fallback).toUpperCase();
}

function getWorkbookBaseCurrency(workbook) {
  return normalizeCurrency(workbook && workbook.currency, 'PHP') || 'PHP';
}

function getAccount(workbook, accountId) {
  const id = asString(accountId);
  return (
    (workbook && Array.isArray(workbook.accounts) ? workbook.accounts : []).find(
      (account) => asString(account && account.id) === id
    ) || null
  );
}

function issue(code, message, details = {}) {
  return { code, message, ...details };
}

function collectAccountLineRecords(workbook, accountId) {
  const id = asString(accountId);
  const records = [];
  (workbook && Array.isArray(workbook.transactions) ? workbook.transactions : []).forEach(
    (transaction, transactionIndex) => {
      (transaction && Array.isArray(transaction.lines) ? transaction.lines : []).forEach(
        (line, lineIndex) => {
          if (asString(line && line.accountId) !== id) return;
          records.push({ transaction, transactionIndex, line, lineIndex });
        }
      );
    }
  );
  return records;
}

function fingerprintText(value) {
  const text = String(value || '');
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 16777619);
    second ^= code + index;
    second = Math.imul(second, 3266489917);
  }
  return `account-currency-repair:${text.length}:${(first >>> 0).toString(16)}:${(
    second >>> 0
  ).toString(16)}`;
}

function repairFingerprint(workbook, account, records, targetCurrency) {
  return fingerprintText(
    JSON.stringify({
      workbookCurrency: getWorkbookBaseCurrency(workbook),
      account: account
        ? {
            id: asString(account.id),
            group: asString(account.group),
            currency: normalizeCurrency(account.currency)
          }
        : null,
      targetCurrency,
      lines: records.map(({ transaction, transactionIndex, line, lineIndex }) => ({
        transactionIndex,
        transactionId: asString(transaction && transaction.id),
        lineIndex,
        lineId: asString(line && line.id),
        accountId: asString(line && line.accountId),
        direction: asString(line && line.direction),
        amount: line && line.amount,
        currency: normalizeCurrency(line && line.currency),
        baseAmount: line && line.baseAmount
      }))
    })
  );
}

function cloneCurrencyBuckets(value) {
  return Object.fromEntries(
    Object.entries(value || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amount]) => [currency, roundMoney(Number(amount) || 0)])
  );
}

function buildLineChanges(records, targetCurrency, baseCurrency) {
  if (targetCurrency !== baseCurrency) return [];
  return records
    .filter(({ line }) => {
      return (
        normalizeCurrency(line && line.currency) !== targetCurrency ||
        roundMoney(Number(line && line.amount) || 0) !==
          roundMoney(Number(line && line.baseAmount) || 0)
      );
    })
    .map(({ transaction, transactionIndex, line, lineIndex }) => ({
      transactionId: asString(transaction && transaction.id),
      transactionIndex,
      transactionDate: asString(transaction && transaction.date),
      transactionDescription: asString(transaction && transaction.description),
      lineId: asString(line && line.id),
      lineIndex,
      before: {
        currency: normalizeCurrency(line && line.currency),
        amount: Number(line && line.amount),
        baseAmount: Number(line && line.baseAmount)
      },
      after: {
        currency: targetCurrency,
        amount: roundMoney(Number(line && line.baseAmount) || 0),
        baseAmount: Number(line && line.baseAmount)
      }
    }));
}

function applyPreviewToWorkbook(workbook, preview) {
  const account = getAccount(workbook, preview.accountId);
  if (account) account.currency = preview.targetCurrency;
  const changesByLocation = new Map(
    preview.lineChanges.map((change) => [`${change.transactionIndex}:${change.lineIndex}`, change])
  );
  (workbook && Array.isArray(workbook.transactions) ? workbook.transactions : []).forEach(
    (transaction, transactionIndex) => {
      (transaction && Array.isArray(transaction.lines) ? transaction.lines : []).forEach(
        (line, lineIndex) => {
          const change = changesByLocation.get(`${transactionIndex}:${lineIndex}`);
          if (!change) return;
          line.currency = change.after.currency;
          line.amount = change.after.amount;
        }
      );
    }
  );
}

function issueSignature(value) {
  return [
    asString(value && value.code),
    asString(value && value.detail),
    asString(value && value.message)
  ].join('|');
}

function findNewInvariantIssues(before, after) {
  const previous = new Set(
    [...(before.errors || []), ...(before.warnings || [])].map(issueSignature)
  );
  return [...(after.errors || []), ...(after.warnings || [])].filter(
    (item) => !previous.has(issueSignature(item))
  );
}

function balancesMatch(before, after) {
  const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return Array.from(ids).every(
    (id) => roundMoney(Number(before[id]) || 0) === roundMoney(Number(after[id]) || 0)
  );
}

export function buildAccountCurrencyRepairPreview(workbook, input = {}) {
  const accountId = asString(input.accountId);
  const baseCurrency = getWorkbookBaseCurrency(workbook);
  const targetCurrency = normalizeCurrency(input.targetCurrency, baseCurrency);
  const account = getAccount(workbook, accountId);
  const records = collectAccountLineRecords(workbook, accountId);
  const integrity = getAccountCurrencyIntegrity(workbook, accountId);
  const blockers = [];

  if (!workbook || typeof workbook !== 'object') {
    blockers.push(issue('account_currency_repair_workbook_required', 'A workbook is required.'));
  }
  if (!account) {
    blockers.push(
      issue('account_currency_repair_account_not_found', 'The account could not be found.', {
        accountId
      })
    );
  } else if (!(account.group === 'asset' || account.group === 'liability')) {
    blockers.push(
      issue(
        'account_currency_repair_unsupported_account',
        'Only asset and liability accounts have repairable posting currencies.',
        { accountId, accountGroup: asString(account.group) }
      )
    );
  }
  if (!/^[A-Z]{3}$/.test(targetCurrency)) {
    blockers.push(
      issue('account_currency_repair_currency_invalid', 'Choose a valid three-letter currency.', {
        targetCurrency
      })
    );
  }

  const hasNonTargetPostings = integrity.postingCurrencies.some(
    (currency) => currency !== targetCurrency
  );
  if (targetCurrency !== baseCurrency && hasNonTargetPostings) {
    blockers.push(
      issue(
        'account_currency_repair_target_unsupported',
        'Mixed posting history can only be corrected automatically to the workbook base currency.',
        {
          accountId,
          baseCurrency,
          targetCurrency,
          postingCurrencies: integrity.postingCurrencies
        }
      )
    );
  }

  const lineChanges = buildLineChanges(records, targetCurrency, baseCurrency);
  if (lineChanges.length > 0) {
    const transactionIndexById = new Map();
    const seenLineIds = new Set();
    records.forEach(({ transaction, transactionIndex, line, lineIndex }) => {
      const transactionId = asString(transaction && transaction.id);
      const lineId = asString(line && line.id);
      if (!transactionId) {
        blockers.push(
          issue(
            'account_currency_repair_transaction_id_required',
            'Every affected transaction needs an id before it can be repaired.',
            { transactionIndex }
          )
        );
      } else if (
        transactionIndexById.has(transactionId) &&
        transactionIndexById.get(transactionId) !== transactionIndex
      ) {
        blockers.push(
          issue(
            'account_currency_repair_duplicate_transaction_id',
            'Affected transaction ids must be unique before repair.',
            { transactionId }
          )
        );
      } else {
        transactionIndexById.set(transactionId, transactionIndex);
      }
      if (!lineId) {
        blockers.push(
          issue(
            'account_currency_repair_line_id_required',
            'Every affected ledger line needs an id before it can be repaired.',
            { transactionId, transactionIndex, lineIndex }
          )
        );
      } else if (seenLineIds.has(lineId)) {
        blockers.push(
          issue(
            'account_currency_repair_duplicate_line_id',
            'Affected ledger line ids must be unique before repair.',
            { lineId }
          )
        );
      } else {
        seenLineIds.add(lineId);
      }
      const amount = Number(line && line.amount);
      const baseAmount = Number(line && line.baseAmount);
      if (!Number.isFinite(amount) || !Number.isFinite(baseAmount) || baseAmount <= 0) {
        blockers.push(
          issue(
            'account_currency_repair_invalid_line_amount',
            'Affected ledger lines need finite, positive base amounts before repair.',
            { transactionId, lineId, amount, baseAmount }
          )
        );
      }
    });
    const checkedTransactions = new Set();
    records.forEach(({ transaction, transactionIndex }) => {
      if (checkedTransactions.has(transactionIndex)) return;
      checkedTransactions.add(transactionIndex);
      if (!isTransactionBalanced(transaction)) {
        blockers.push(
          issue(
            'account_currency_repair_unbalanced_transaction',
            'Repair cannot proceed while an affected transaction is unbalanced.',
            { transactionId: asString(transaction && transaction.id), transactionIndex }
          )
        );
      }
    });
  }

  if (integrity.missingCurrencyLineIds.length > 0) {
    blockers.push(
      issue(
        'account_currency_repair_missing_line_currency',
        'Affected ledger lines with missing currencies require manual review.',
        { lineIds: integrity.missingCurrencyLineIds }
      )
    );
  }

  const beforeHistoricalBalances = getLedgerHistoricalBalances(workbook || {});
  const beforeNativeByCurrency = cloneCurrencyBuckets(
    getLedgerNativeBalancesByCurrency(workbook || {})[accountId]
  );
  const preview = {
    ok: blockers.length === 0,
    mode: 'correct_metadata_and_postings',
    repairKind: lineChanges.length > 0 ? 'base_currency_posting_correction' : 'metadata_only',
    accountId,
    accountName: asString(account && account.name),
    accountGroup: asString(account && account.group),
    baseCurrency,
    configuredCurrency: integrity.configuredCurrency,
    targetCurrency,
    postingCurrencies: integrity.postingCurrencies,
    integrity,
    fingerprint: repairFingerprint(workbook || {}, account, records, targetCurrency),
    blockers,
    lineChanges,
    affectedLineCount: records.length,
    changedLineCount: lineChanges.length,
    affectedTransactionIds: integrity.transactionIds,
    affectedTransactionCount: integrity.transactionIds.length,
    metadataChange:
      !!account && normalizeCurrency(account.currency, baseCurrency) !== targetCurrency,
    requiresConfirmation:
      (!!account && normalizeCurrency(account.currency, baseCurrency) !== targetCurrency) ||
      lineChanges.length > 0,
    before: {
      historicalBaseBalance: roundMoney(Number(beforeHistoricalBalances[accountId]) || 0),
      nativeByCurrency: beforeNativeByCurrency
    },
    after: {
      historicalBaseBalance: roundMoney(Number(beforeHistoricalBalances[accountId]) || 0),
      nativeByCurrency: beforeNativeByCurrency
    },
    bookValueDelta: 0
  };

  if (preview.ok && preview.requiresConfirmation) {
    const simulatedWorkbook = cloneWorkbook(workbook);
    applyPreviewToWorkbook(simulatedWorkbook, preview);
    const afterHistoricalBalances = getLedgerHistoricalBalances(simulatedWorkbook);
    preview.after = {
      historicalBaseBalance: roundMoney(Number(afterHistoricalBalances[accountId]) || 0),
      nativeByCurrency: cloneCurrencyBuckets(
        getLedgerNativeBalancesByCurrency(simulatedWorkbook)[accountId]
      )
    };
    preview.bookValueDelta = roundMoney(
      preview.after.historicalBaseBalance - preview.before.historicalBaseBalance
    );
  }

  return preview;
}

export function repairAccountCurrency(workbook, input = {}) {
  const preview = buildAccountCurrencyRepairPreview(workbook, input);
  if (!preview.ok) {
    return commandError(workbook, preview.blockers[0], { preview });
  }
  if (!asString(input.expectedFingerprint)) {
    return commandError(
      workbook,
      issue(
        'account_currency_repair_preview_required',
        'Review a current repair preview before applying this change.'
      ),
      { preview }
    );
  }
  if (asString(input.expectedFingerprint) !== preview.fingerprint) {
    return commandError(
      workbook,
      issue(
        'account_currency_repair_stale',
        'The account changed after the repair preview. Review it again before continuing.',
        { accountId: preview.accountId }
      ),
      { preview }
    );
  }
  if (input.confirmed !== true) {
    return commandError(
      workbook,
      issue(
        'account_currency_repair_confirmation_required',
        'Explicit confirmation is required before correcting account currency history.',
        { accountId: preview.accountId, targetCurrency: preview.targetCurrency }
      ),
      { preview }
    );
  }
  if (!preview.requiresConfirmation) {
    return commandOk(workbook, { changed: false, preview, repair: null });
  }

  const beforeInvariants = validateLedgerInvariants(workbook || {});
  const beforeHistoricalBalances = getLedgerHistoricalBalances(workbook || {});
  const nextWorkbook = cloneWorkbook(workbook);
  applyPreviewToWorkbook(nextWorkbook, preview);

  const affectedTransactions = new Set(preview.affectedTransactionIds);
  const unbalancedTransactions = (nextWorkbook.transactions || []).filter(
    (transaction) =>
      affectedTransactions.has(asString(transaction && transaction.id)) &&
      !isTransactionBalanced(transaction)
  );
  const afterHistoricalBalances = getLedgerHistoricalBalances(nextWorkbook);
  const afterInvariants = validateLedgerInvariants(nextWorkbook);
  const afterIntegrity = getAccountCurrencyIntegrity(nextWorkbook, preview.accountId);
  const newInvariantIssues = findNewInvariantIssues(beforeInvariants, afterInvariants);
  const validationFailures = [];

  if (unbalancedTransactions.length > 0) {
    validationFailures.push(
      issue(
        'account_currency_repair_unbalanced_transaction',
        'The proposed repair would leave an affected transaction unbalanced.',
        { transactionIds: unbalancedTransactions.map((transaction) => asString(transaction.id)) }
      )
    );
  }
  if (!balancesMatch(beforeHistoricalBalances, afterHistoricalBalances)) {
    validationFailures.push(
      issue(
        'account_currency_repair_book_value_changed',
        'The proposed repair changed historical book values and was discarded.'
      )
    );
  }
  if (
    afterIntegrity.configuredCurrency !== preview.targetCurrency ||
    afterIntegrity.mismatched ||
    afterIntegrity.mixed
  ) {
    validationFailures.push(
      issue(
        'account_currency_repair_integrity_not_restored',
        'The proposed repair did not restore a single trustworthy account currency.',
        { integrity: afterIntegrity }
      )
    );
  }
  if (newInvariantIssues.length > 0) {
    validationFailures.push(
      issue(
        'account_currency_repair_new_invariant_issues',
        'The proposed repair introduced new workbook integrity issues and was discarded.',
        { issues: newInvariantIssues }
      )
    );
  }

  if (validationFailures.length > 0) {
    return commandError(
      workbook,
      issue(
        'account_currency_repair_validation_failed',
        'The account currency repair could not be applied safely.',
        { failures: validationFailures }
      ),
      { preview }
    );
  }

  const repair = {
    accountId: preview.accountId,
    fromCurrency: preview.configuredCurrency,
    targetCurrency: preview.targetCurrency,
    repairKind: preview.repairKind,
    changedLineCount: preview.changedLineCount,
    affectedTransactionIds: preview.affectedTransactionIds,
    bookValueDelta: 0,
    fingerprint: preview.fingerprint
  };
  return commandOk(nextWorkbook, {
    changed: true,
    preview,
    repair,
    events: [
      { type: 'account-currency-repaired', repair },
      { type: 'schedule-save' },
      { type: 'render' }
    ]
  });
}
