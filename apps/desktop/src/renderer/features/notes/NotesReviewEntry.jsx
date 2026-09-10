import React from 'react';
import { PrivateValue } from '../../shared/PrivateValue.jsx';
import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { CavalrySelect } from '../../shared/CavalrySelect.jsx';
import { isCreditCardAccount, paymentLabel } from './notes-parser.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return String(value == null ? '' : value);
}

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function categoryIcon(entry) {
  if (entry.categoryIcon) return entry.categoryIcon;
  const descriptor = `${entry.categoryName} ${entry.description}`.toLowerCase();
  if (/transport|commute|fare|taxi|grab/.test(descriptor)) return 'directions_car';
  if (/coffee|cafe/.test(descriptor)) return 'local_cafe';
  if (/grocery|groceries|market/.test(descriptor)) return 'shopping_cart';
  if (/food|meal|dining|restaurant/.test(descriptor)) return 'restaurant';
  if (/salary|income|paycheck/.test(descriptor)) return 'payments';
  if (/utility|electric|water|internet/.test(descriptor)) return 'bolt';
  if (/health|medical|doctor|medicine/.test(descriptor)) return 'medical_services';
  if (/shopping|clothes/.test(descriptor)) return 'shopping_bag';
  if (/subscription|membership/.test(descriptor)) return 'autorenew';
  return entry.template === 'income_received' ? 'arrow_downward' : 'receipt_long';
}

function formatAmount(value, currency) {
  const code = asString(currency || 'PHP').toUpperCase() || 'PHP';
  try {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: Number(value) % 1 ? 2 : 0,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  } catch (_error) {
    return `${code} ${(Number(value) || 0).toLocaleString('en-PH')}`;
  }
}

function accountTypeLabel(account) {
  if (!account) return '';
  const method = paymentLabel(account);
  return method === account.name ? account.name : `${account.name} · ${method}`;
}

function ReviewEditor({ entry, workbook, onCancel, onChange, onSave, disabled }) {
  const categories = asArray(workbook && workbook.categories).filter(
    (category) =>
      category &&
      category.isActive !== false &&
      ['expense', 'income'].includes(asString(category.type).toLowerCase())
  );
  const accounts = asArray(workbook && workbook.accounts).filter(
    (account) =>
      account &&
      account.isActive !== false &&
      ['asset', 'liability'].includes(asString(account.group).toLowerCase())
  );
  const selectedCategory =
    categories.find((category) => asString(category.id) === asString(entry.categoryId)) || null;
  const eligibleAccounts = accounts.filter((account) =>
    selectedCategory?.type === 'income'
      ? account.group === 'asset'
      : account.group === 'asset' || isCreditCardAccount(account)
  );
  const currencies = Array.from(
    new Set([
      asString(workbook && workbook.currency).toUpperCase() || 'PHP',
      ...(/^[A-Z]{3}$/.test(asString(entry.currency)) ? [entry.currency] : []),
      ...eligibleAccounts
        .map((account) => asString(account.currency).toUpperCase())
        .filter(Boolean),
      'PHP',
      'USD'
    ])
  );
  const selectedAccount =
    eligibleAccounts.find((account) => asString(account.id) === asString(entry.primaryAccountId)) ||
    null;
  const workbookCurrency = asString(workbook && workbook.currency).toUpperCase() || 'PHP';
  const selectedAccountCurrency =
    asString(selectedAccount && selectedAccount.currency).toUpperCase() || entry.currency;
  const needsFxRate =
    entry.currency !== workbookCurrency || selectedAccountCurrency !== entry.currency;
  const fieldAccessibility = (field) => {
    const describedBy = asArray(entry.issues)
      .map((item, index) => (item.field === field ? `${entry.id}-issue-${index}` : ''))
      .filter(Boolean)
      .join(' ');
    return describedBy
      ? { 'aria-describedby': describedBy, 'aria-invalid': true }
      : { 'aria-invalid': false };
  };

  return (
    <div className="notes-review-editor">
      <PrivateValue as="blockquote" className="notes-source-text">
        {entry.sourceText}
      </PrivateValue>
      <div className="notes-editor-grid">
        <div className="field notes-editor-description">
          <label htmlFor={`${entry.id}-description`}>Description</label>
          <input
            {...fieldAccessibility('description')}
            id={`${entry.id}-description`}
            onChange={(event) => onChange('description', event.target.value)}
            type="text"
            value={entry.description}
          />
        </div>
        <div className="field">
          <label htmlFor={`${entry.id}-amount`}>Amount</label>
          <input
            {...fieldAccessibility('amount')}
            id={`${entry.id}-amount`}
            inputMode="decimal"
            min="0"
            onChange={(event) => onChange('amount', event.target.value)}
            type="number"
            value={entry.amount}
          />
        </div>
        <div className="field">
          <label htmlFor={`${entry.id}-currency`}>Currency</label>
          <CavalrySelect
            {...fieldAccessibility('currency')}
            aria-label="Currency"
            id={`${entry.id}-currency`}
            onChange={(event) => onChange('currency', event.target.value)}
            options={currencies.map((currency) => ({ value: currency, label: currency }))}
            showLeadingIcon={false}
            value={entry.currency}
          />
        </div>
        <div className="field">
          <label htmlFor={`${entry.id}-category`}>Category</label>
          <CavalrySelect
            {...fieldAccessibility('categoryId')}
            aria-label="Category"
            id={`${entry.id}-category`}
            leadingIcon="category"
            onChange={(event) => onChange('categoryId', event.target.value)}
            options={categories.map((category) => ({
              value: category.id,
              label: category.name,
              icon: category.icon || 'category',
              meta: category.type === 'income' ? 'Income' : ''
            }))}
            placeholder="Choose category"
            value={entry.categoryId}
          />
        </div>
        <div className="field">
          <label htmlFor={`${entry.id}-account`}>Payment account</label>
          <CavalrySelect
            {...fieldAccessibility('primaryAccountId')}
            aria-label="Payment account"
            id={`${entry.id}-account`}
            leadingIcon="account_balance_wallet"
            onChange={(event) => onChange('primaryAccountId', event.target.value)}
            options={eligibleAccounts.map((account) => ({
              value: account.id,
              label: accountTypeLabel(account),
              icon: 'account_balance_wallet'
            }))}
            placeholder="Choose account"
            value={entry.primaryAccountId}
          />
        </div>
        <div className="field">
          <label htmlFor={`${entry.id}-date`}>Date</label>
          <input
            {...fieldAccessibility('date')}
            id={`${entry.id}-date`}
            onChange={(event) => onChange('date', event.target.value)}
            type="date"
            value={entry.date}
          />
        </div>
        {needsFxRate ? (
          <div className="field">
            <PrivateValue as="label" htmlFor={`${entry.id}-fx-rate`}>
              {entry.currency} to {workbookCurrency} rate
            </PrivateValue>
            <input
              {...fieldAccessibility('fxRateToBase')}
              id={`${entry.id}-fx-rate`}
              inputMode="decimal"
              min="0"
              onChange={(event) => onChange('fxRateToBase', event.target.value)}
              type="number"
              value={entry.fxRateToBase || ''}
            />
          </div>
        ) : null}
      </div>

      {entry.issues.length ? (
        <PrivateValue
          as="ul"
          aria-label={`Line ${entry.lineNumber} issues`}
          className="notes-editor-issues"
        >
          {entry.issues.map((item, index) => (
            <PrivateValue
              as="li"
              id={`${entry.id}-issue-${index}`}
              key={`${item.code}:${item.field}`}
            >
              {item.message}
            </PrivateValue>
          ))}
        </PrivateValue>
      ) : null}
      <div className="notes-editor-actions">
        <span />
        <button className="btn" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="btn btn-primary" disabled={disabled} onClick={onSave} type="button">
          {entry.transactionId ? 'Save changes' : 'Confirm details'}
        </button>
      </div>
    </div>
  );
}

export function ReviewEntry({
  entry,
  position,
  isEditing,
  editingEntry,
  workbook,
  onEdit,
  onEditChange,
  onEditCancel,
  onEditSave,
  onRemove,
  disabled = false
}) {
  const hasAmount = Number.isFinite(Number(entry.amount)) && Number(entry.amount) > 0;
  const paymentAccount = asArray(workbook?.accounts).find(
    (account) => asString(account.id) === asString(entry.primaryAccountId)
  );
  const amountTone = entry.template === 'income_received' ? 'good' : 'bad';
  const amountDirection = amountTone === 'good' ? 'Income' : 'Expense';
  const amountSign = amountTone === 'good' ? '+' : '−';
  return (
    <article
      className={`notes-review-entry${entry.transactionId ? '' : ' needs-review'}${isEditing ? ' is-editing' : ''}`}
    >
      <div className="notes-review-summary">
        <span
          className="notes-category-icon"
          style={
            entry.categoryColor ? { '--notes-category-color': entry.categoryColor } : undefined
          }
        >
          <Icon name={categoryIcon(entry)} />
        </span>
        <span className="notes-entry-copy">
          <PrivateValue as="strong">{entry.categoryName}</PrivateValue>
          <PrivateValue as="small">{entry.description}</PrivateValue>
          <PrivateValue as="small">
            {entry.date || 'Date needed'} ·{' '}
            {entry.transactionId ? 'Added' : entry.issues.length ? 'Check details' : 'Ready'}
          </PrivateValue>
        </span>
        <PrivateValue
          as="strong"
          aria-label={
            hasAmount
              ? `${amountDirection} ${formatAmount(entry.amount, entry.currency)}`
              : 'Check amount'
          }
          className={`notes-entry-amount ${amountTone}`}
        >
          {hasAmount
            ? `${amountSign}${formatAmount(entry.amount, entry.currency)}`
            : 'Check amount'}
        </PrivateValue>
        <PrivateValue as="span" className="notes-payment-pill">
          {paymentAccount?.name || entry.paymentLabel}
        </PrivateValue>
        <PrivateValue
          as="button"
          aria-expanded={isEditing}
          aria-label={`Edit transaction ${position}: ${entry.description}`}
          className="notes-edit-button"
          id={`notes-edit-${entry.id}`}
          disabled={disabled}
          onClick={() => onEdit(entry)}
          type="button"
        >
          <Icon name={isEditing ? 'expand_less' : 'edit'} />
        </PrivateValue>
      </div>
      {!entry.transactionId ? (
        <div className="notes-entry-review-meta">
          <PrivateValue as="span">{entry.issues[0]?.message || entry.sourceText}</PrivateValue>
          <button
            type="button"
            aria-label={`Remove draft ${position}`}
            disabled={disabled}
            onClick={() => onRemove(entry.id)}
          >
            Remove
          </button>
        </div>
      ) : null}
      {isEditing ? (
        <ReviewEditor
          entry={editingEntry}
          disabled={disabled}
          onCancel={onEditCancel}
          onChange={onEditChange}
          onSave={onEditSave}
          workbook={workbook}
        />
      ) : null}
    </article>
  );
}
