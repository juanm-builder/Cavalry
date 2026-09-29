import { parseNotesTransfer } from './notes-transfer-parser.js';
import { unsupportedNotesIntent } from './notes-value-parser.js';

const asString = (value) => String(value == null ? '' : value);
const asArray = (value) => (Array.isArray(value) ? value : []);
const issue = (code, field, message) => ({ code, field, message });

export function validateNotesEntryFields(
  workbook,
  entry,
  { categories, accounts, isCreditCardAccount }
) {
  const issues = [];
  const isTransfer = entry?.template === 'transfer';
  const sourceTransfer = parseNotesTransfer(asString(entry?.sourceText), accounts);
  const unsupportedIntent = unsupportedNotesIntent(asString(entry?.sourceText));
  if (sourceTransfer && !isTransfer)
    issues.push(
      issue('transfer_kind_invalid', 'review', 'Keep this entry as a transfer between accounts.')
    );
  if (unsupportedIntent)
    issues.push(
      issue(
        'transaction_kind_unsupported',
        'review',
        unsupportedIntent === 'recurring'
          ? 'Use Bills to set up recurring payments.'
          : 'Use Add Transaction for refunds or debt payments.'
      )
    );
  const allAccounts = asArray(workbook && workbook.accounts);
  const category = categories.find(
    (candidate) => asString(candidate.id) === asString(entry && entry.categoryId)
  );
  const account = accounts.find(
    (candidate) => asString(candidate.id) === asString(entry && entry.primaryAccountId)
  );
  const destination = accounts.find(
    (candidate) => asString(candidate.id) === asString(entry?.secondaryAccountId)
  );
  if (isTransfer) {
    if (!destination)
      issues.push(
        issue(
          'transfer_destination_missing',
          'secondaryAccountId',
          'Choose the destination account.'
        )
      );
    if (account && destination && account.id === destination.id)
      issues.push(
        issue(
          'transfer_same_account',
          'secondaryAccountId',
          'Choose two different accounts for the transfer.'
        )
      );
    if (
      account &&
      destination &&
      asString(account.currency || workbook?.currency) !==
        asString(destination.currency || workbook?.currency)
    )
      issues.push(
        issue(
          'transfer_currency_unsupported',
          'secondaryAccountId',
          'Use Add Transaction for transfers between different currencies.'
        )
      );
  }
  const amount = Number(entry && entry.amount);
  const date = asString(entry && entry.date);
  const currency = asString(entry && entry.currency).toUpperCase();
  const workbookCurrency = asString(workbook && workbook.currency).toUpperCase() || 'PHP';
  const dateTimestamp = Date.parse(`${date}T00:00:00Z`);
  const dateIsValid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(dateTimestamp) &&
    new Date(dateTimestamp).toISOString().slice(0, 10) === date;

  if (!(amount > 0) || !Number.isFinite(amount)) {
    issues.push(issue('amount_missing', 'amount', 'Enter an amount greater than zero.'));
  }
  if (!category && !isTransfer) {
    issues.push(issue('category_missing', 'categoryId', 'Choose a category.'));
  } else if (!isTransfer) {
    const linkedAccount = allAccounts.find(
      (candidate) =>
        asString(candidate && candidate.id) === asString(category && category.linkedAccountId)
    );
    const expectedGroup = category.type === 'income' ? 'income' : 'expense';
    if (
      !linkedAccount ||
      linkedAccount.isActive === false ||
      asString(linkedAccount.group).toLowerCase() !== expectedGroup
    ) {
      issues.push(
        issue(
          'category_link_invalid',
          'categoryId',
          `${category.name} is not linked to an active ${expectedGroup} account.`
        )
      );
    }
  }
  if (!account) {
    issues.push(
      issue(
        'payment_missing',
        'primaryAccountId',
        isTransfer ? 'Choose the source account.' : 'Choose a payment account.'
      )
    );
  }
  if (!dateIsValid) {
    issues.push(issue('date_invalid', 'date', 'Choose a valid transaction date.'));
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    issues.push(issue('currency_invalid', 'currency', 'Choose a valid currency.'));
  }
  const accountCurrency = asString(account && account.currency).toUpperCase() || currency;
  if (
    account &&
    currency &&
    (currency !== workbookCurrency || accountCurrency !== currency) &&
    !(Number(entry && entry.fxRateToBase) > 0)
  ) {
    issues.push(
      issue(
        'fx_rate_missing',
        'fxRateToBase',
        `Enter the conversion rate used for this ${currency} transaction.`
      )
    );
  }
  if (!isTransfer && category && account) {
    if (category.type === 'income' && account.group !== 'asset') {
      issues.push(
        issue('income_account_invalid', 'primaryAccountId', 'Income must go to an asset account.')
      );
    }
    if (category.type === 'expense' && !['asset', 'liability'].includes(account.group)) {
      issues.push(
        issue(
          'expense_account_invalid',
          'primaryAccountId',
          'Expenses must use an asset or liability account.'
        )
      );
    }
    if (
      category.type === 'expense' &&
      account.group === 'liability' &&
      !isCreditCardAccount(account)
    ) {
      issues.push(
        issue(
          'expense_liability_invalid',
          'primaryAccountId',
          'Choose a cash, bank, e-wallet, or credit card account.'
        )
      );
    }
  }
  return issues;
}
