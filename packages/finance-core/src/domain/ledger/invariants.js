import { normalizeDateKey, roundMoney } from '../money.js';
import { getLedgerHistoricalBalances } from './balances.js';
import { getAccountCurrencyIntegrity } from './account-currency-integrity.js';
import { isTransactionBalanced } from './validation.js';
import {
  getLedgerTransactionFlowKind,
  normalizeLedgerTransactionTemplate,
  summarizeLedgerActivity
} from './transactions.js';

function issue(code, message, detail = '') {
  return {
    code,
    message,
    detail
  };
}

function isObject(value) {
  return !!value && typeof value === 'object';
}

export function validateLedgerInvariants(workbook) {
  const errors = [];
  const warnings = [];
  const source = isObject(workbook) ? workbook : {};
  const accounts = Array.isArray(source.accounts) ? source.accounts : [];
  const categories = Array.isArray(source.categories) ? source.categories : [];
  const transactions = Array.isArray(source.transactions) ? source.transactions : [];
  const accountById = new Map();
  const categoryById = new Map();
  const transactionIds = new Set();

  accounts.forEach((account) => {
    const id = String((account && account.id) || '');
    if (!id) {
      warnings.push(issue('account_missing_id', 'Account is missing an ID.'));
      return;
    }
    accountById.set(id, account);
  });

  categories.forEach((category) => {
    const id = String((category && category.id) || '');
    if (!id) {
      warnings.push(issue('category_missing_id', 'Category is missing an ID.'));
      return;
    }
    categoryById.set(id, category);
    if (category.linkedAccountId && !accountById.has(String(category.linkedAccountId))) {
      errors.push(
        issue('category_missing_linked_account', 'Category links to a missing account.', id)
      );
    }
  });

  transactions.forEach((transaction, index) => {
    const id = transaction && transaction.id;
    if (typeof id !== 'string' || !id.trim()) {
      errors.push(
        issue(
          'transaction_invalid_id',
          'Committed transaction must have a stable string ID.',
          String(index)
        )
      );
    } else if (transactionIds.has(id)) {
      errors.push(
        issue('transaction_duplicate_id', 'Committed transaction IDs must be unique.', id)
      );
    } else {
      transactionIds.add(id);
    }

    const amount = Number(transaction && transaction.amount);
    const baseAmount = Number(transaction && transaction.baseAmount);
    if (!Number.isFinite(amount)) {
      errors.push(
        issue(
          'transaction_invalid_amount',
          'Transaction amount must be numeric and finite.',
          String(id || index)
        )
      );
    } else if (amount === 0) {
      warnings.push(
        issue(
          'transaction_zero_amount',
          'Transaction amount is zero; current manual entry expects positive amounts.',
          String(id || index)
        )
      );
    } else if (amount < 0) {
      warnings.push(
        issue(
          'transaction_negative_amount',
          'Transaction amount is negative; current manual entry stores positive amounts and line directions.',
          String(id || index)
        )
      );
    }
    if (!Number.isFinite(baseAmount)) {
      errors.push(
        issue(
          'transaction_invalid_base_amount',
          'Transaction baseAmount must be numeric and finite.',
          String(id || index)
        )
      );
    }

    if (!normalizeDateKey(transaction && transaction.date)) {
      errors.push(
        issue(
          'transaction_invalid_date',
          'Transaction date must be ISO-like YYYY-MM-DD.',
          String(id || index)
        )
      );
    }
    if (
      transaction &&
      transaction.monthKey &&
      normalizeDateKey(transaction.date).slice(0, 7) !== String(transaction.monthKey)
    ) {
      warnings.push(
        issue(
          'transaction_month_mismatch',
          'Transaction monthKey does not match transaction date.',
          String(id || index)
        )
      );
    }

    const template = String((transaction && transaction.template) || '');
    if (
      template &&
      !normalizeLedgerTransactionTemplate(template) &&
      template !== 'manual_journal' &&
      template !== 'daily_interest' &&
      template !== 'existing_liability'
    ) {
      warnings.push(
        issue(
          'transaction_unknown_template',
          'Transaction template is not a recognized core template.',
          String(id || index)
        )
      );
    }

    const lines = Array.isArray(transaction && transaction.lines) ? transaction.lines : [];
    if (lines.length < 2) {
      errors.push(
        issue(
          'transaction_too_few_lines',
          'Transaction must have at least two ledger lines.',
          String(id || index)
        )
      );
    }
    if (!isTransactionBalanced(transaction)) {
      errors.push(
        issue(
          'transaction_unbalanced',
          'Transaction debit and credit base amounts must balance.',
          String(id || index)
        )
      );
    }
    const categoryId = String((transaction && transaction.categoryId) || '');
    if (categoryId) {
      const category = categoryById.get(categoryId);
      if (!category) {
        errors.push(
          issue(
            'transaction_missing_category',
            'Transaction references a missing category.',
            String(id || index)
          )
        );
      } else if (category.isActive === false) {
        warnings.push(
          issue(
            'transaction_archived_category',
            'Transaction references an archived category.',
            String(id || index)
          )
        );
      }
    } else if (!['transfer', 'opening_balance', 'existing_liability'].includes(template)) {
      warnings.push(
        issue(
          'transaction_uncategorized',
          'Transaction has no category; current model allows uncategorized committed rows.',
          String(id || index)
        )
      );
    }

    if (template === 'transfer' && categoryId) {
      warnings.push(
        issue(
          'transfer_has_category',
          'Transfer transactions should not carry a spending/income category.',
          String(id || index)
        )
      );
    }
    if (
      template === 'transfer' &&
      getLedgerTransactionFlowKind(source, transaction) !== 'transfer'
    ) {
      errors.push(
        issue(
          'transfer_inflates_activity',
          'Transfer is being counted as income or spending.',
          String(id || index)
        )
      );
    }

    lines.forEach((line, lineIndex) => {
      const accountId = String((line && line.accountId) || '');
      const account = accountById.get(accountId);
      if (!account) {
        errors.push(
          issue(
            'line_missing_account',
            'Transaction line references a missing account.',
            `${id || index}:${lineIndex}`
          )
        );
      } else if (account.isActive === false) {
        warnings.push(
          issue(
            'line_archived_account',
            'Transaction line references an archived account.',
            `${id || index}:${accountId}`
          )
        );
      }
      if (!['debit', 'credit'].includes(String((line && line.direction) || ''))) {
        errors.push(
          issue(
            'line_invalid_direction',
            'Transaction line direction must be debit or credit.',
            `${id || index}:${lineIndex}`
          )
        );
      }
      const lineAmount = Number(line && line.amount);
      const lineBaseAmount = Number(line && line.baseAmount);
      if (!Number.isFinite(lineAmount) || !Number.isFinite(lineBaseAmount)) {
        errors.push(
          issue(
            'line_invalid_amount',
            'Line amount and baseAmount must be numeric and finite.',
            `${id || index}:${lineIndex}`
          )
        );
      } else if (lineAmount <= 0 || lineBaseAmount <= 0) {
        warnings.push(
          issue(
            'line_non_positive_amount',
            'Line amount is zero or negative; current manual entry expects positive line amounts.',
            `${id || index}:${lineIndex}`
          )
        );
      }
    });
  });

  accounts.forEach((account) => {
    if (!(account && ['asset', 'liability'].includes(account.group))) {
      return;
    }
    const integrity = getAccountCurrencyIntegrity(source, account.id);
    if (integrity.mismatched || integrity.mixed) {
      warnings.push(
        issue(
          'account_posting_currency_mismatch',
          'Account currency metadata does not match its ledger posting currency.',
          `${account.id}: configured ${integrity.configuredCurrency}; postings ${integrity.postingCurrencies.join(', ')}`
        )
      );
    }
  });

  const activity = summarizeLedgerActivity(source);
  const balances = getLedgerHistoricalBalances(source);
  const draftGroups = [
    ...(Array.isArray(source.aiDrafts) ? source.aiDrafts : []),
    ...(Array.isArray(source.externalDraftGroups) ? source.externalDraftGroups : []),
    ...(Array.isArray(source.advisorDraftGroups) ? source.advisorDraftGroups : [])
  ];

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      transactionCount: transactions.length,
      accountCount: accounts.length,
      categoryCount: categories.length,
      draftCount: draftGroups.length,
      income: activity.income,
      expense: activity.expense,
      savings: activity.savings,
      debt: activity.debt,
      outflow: activity.outflow,
      net: activity.net,
      categoryTotals: activity.categoryTotals,
      balances: Object.fromEntries(
        Object.entries(balances).map(([key, value]) => [key, roundMoney(value)])
      )
    }
  };
}
