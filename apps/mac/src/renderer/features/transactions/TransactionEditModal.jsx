import React from 'react';
import { createPortal } from 'react-dom';

import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { FinancialValueInput } from '../../shared/FinancialValueInput.jsx';
import { InstitutionMark } from '../../shared/InstitutionSelect.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';

const CONTEXT_KINDS = new Set([
  'bank',
  'cash',
  'wallet',
  'credit_card',
  'investment',
  'liability',
  'asset'
]);

const SECONDARY_TEMPLATES = new Set(['transfer', 'debt_payment', 'liability_payment']);
const DEBT_TEMPLATES = new Set(['debt_payment', 'liability_payment']);

const TEMPLATE_LABELS = Object.freeze({
  bank: {
    expense_paid: 'Payment / withdrawal',
    income_received: 'Deposit / income',
    transfer: 'Bank transfer',
    opening_balance: 'Balance adjustment'
  },
  cash: {
    expense_paid: 'Cash spent',
    income_received: 'Cash received',
    transfer: 'Cash transfer',
    opening_balance: 'Balance adjustment'
  },
  wallet: {
    expense_paid: 'Wallet payment',
    income_received: 'Money received',
    transfer: 'Wallet transfer',
    opening_balance: 'Balance adjustment'
  },
  credit_card: {
    expense_charged: 'Card purchase',
    debt_payment: 'Card payment',
    liability_payment: 'Card payment',
    transfer: 'Balance transfer',
    opening_balance: 'Balance adjustment'
  },
  investment: {
    expense_paid: 'Fee / withdrawal',
    income_received: 'Distribution / income',
    transfer: 'Contribution / transfer',
    opening_balance: 'Valuation adjustment'
  },
  liability: {
    expense_charged: 'New charge / borrowing',
    debt_payment: 'Liability payment',
    liability_payment: 'Liability payment',
    opening_balance: 'Balance adjustment'
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

function Icon({ name, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded${className ? ` ${className}` : ''}`}
    >
      {name}
    </span>
  );
}

function templateLabel(option, contextKind) {
  return TEMPLATE_LABELS[contextKind]?.[option.value] || option.label;
}

function expectedCategoryType(template) {
  if (template === 'income_received') return 'income';
  if (template === 'expense_paid' || template === 'expense_charged') return 'expense';
  if (DEBT_TEMPLATES.has(template)) return 'debt';
  return '';
}

function compatibleWithField(account, template, field) {
  const group = asString(account.group);
  if (field === 'secondaryAccountId') {
    if (DEBT_TEMPLATES.has(template)) return group === 'liability';
    return group === 'asset' || group === 'liability';
  }
  if (template === 'income_received' || template === 'expense_paid') return group === 'asset';
  if (template === 'expense_charged') return group === 'liability';
  if (DEBT_TEMPLATES.has(template)) return group === 'asset';
  return group === 'asset' || group === 'liability';
}

function accountOptionsForField(accounts, template, field, currentValue) {
  return asArray(accounts).filter(
    (account) =>
      asString(account.value) === asString(currentValue) ||
      compatibleWithField(account, template, field)
  );
}

function categoriesForTemplate(categories, template, currentValue) {
  const expectedType = expectedCategoryType(template);
  if (!expectedType) return asArray(categories);
  return asArray(categories).filter(
    (category) =>
      asString(category.value) === asString(currentValue) || category.type === expectedType
  );
}

function currencyMark(currency) {
  const code = asString(currency).toUpperCase();
  if (code === 'PHP') return '₱';
  if (code === 'USD') return '$';
  return code || '₱';
}

function categoryCopy(template) {
  if (template === 'income_received') {
    return { label: 'Source', placeholder: 'Choose income source' };
  }
  if (DEBT_TEMPLATES.has(template)) {
    return { label: 'Debt category', placeholder: 'Choose debt category' };
  }
  return { label: 'Category', placeholder: 'Choose category' };
}

function MessageList({ errors = [], warnings = [] }) {
  const messages = [
    ...asArray(errors).map((item) => ({ ...item, tone: 'status-bad' })),
    ...asArray(warnings).map((item) => ({ ...item, tone: 'status-warn' }))
  ];
  if (!messages.length) return null;
  return (
    <div className="transaction-edit-messages" role="alert">
      {messages.map((message, index) => (
        <div className={`panel-note ${message.tone}`} key={`${message.code || 'message'}-${index}`}>
          {message.message || String(message)}
        </div>
      ))}
    </div>
  );
}

function AccountMark({ account, fallbackIcon }) {
  return (
    <span className="transaction-edit-account-mark">
      <InstitutionMark
        fallbackIcon={account.icon || fallbackIcon || 'account_balance_wallet'}
        institutionId={account.institutionId}
      />
    </span>
  );
}

function AccountField({ disabledOptionId = '', fallbackIcon, field, id, label, options, value }) {
  const actions = useActionBindings();
  const selected = asArray(options).find((option) => option.value === value) || null;
  return (
    <div className="field transaction-edit-field transaction-edit-account-field">
      <label htmlFor={id}>{label}</label>
      <div className="transaction-edit-account-control">
        <AccountMark account={selected || {}} fallbackIcon={fallbackIcon} />
        <select
          id={id}
          value={value || ''}
          {...actions.change('transaction-composer-change', { field })}
        >
          <option value="">Choose account</option>
          {asArray(options).map((option) => (
            <option
              disabled={option.disabled || option.value === disabledOptionId}
              key={option.value}
              value={option.value}
            >
              {option.name || option.label} — {option.balanceLabel}
              {option.hasCurrencyIntegrityIssue ? ' · Repair currency first' : ''}
            </option>
          ))}
        </select>
        {selected ? (
          <small>
            {selected.contextLabel || selected.institution || selected.label} ·{' '}
            {selected.balanceLabel}
            {selected.hasCurrencyIntegrityIssue ? ' · Currency repair required' : ''}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function ContextSummary({ context, account }) {
  const data = asObject(context);
  const selectedAccount = asObject(account);
  return (
    <div className="transaction-edit-context-card">
      <AccountMark account={selectedAccount} fallbackIcon={data.icon} />
      <div className="transaction-edit-context-copy">
        <strong>{selectedAccount.name || 'Transaction account'}</strong>
        <span>
          {selectedAccount.institution || selectedAccount.contextLabel || data.badge || 'Account'}
        </span>
      </div>
      {selectedAccount.balanceLabel ? (
        <div className="transaction-edit-context-balance">
          <small>Current balance</small>
          <b>{selectedAccount.balanceLabel}</b>
        </div>
      ) : null}
    </div>
  );
}

function TransactionEditModalContent({ modal }) {
  const data = asObject(modal);
  const draft = asObject(data.draft);
  const options = asObject(data.options);
  const context = asObject(data.context);
  const actions = useActionBindings();
  const closeModal = actions.action('close-modal');
  const dismiss = useModalDismiss(closeModal.onClick);
  const template = draft.template || 'expense_paid';
  const contextKind = CONTEXT_KINDS.has(context.kind) ? context.kind : 'bank';
  const needsSecondary = SECONDARY_TEMPLATES.has(template);
  const primaryOptions = accountOptionsForField(
    options.accounts,
    template,
    'primaryAccountId',
    draft.primaryAccountId
  );
  const secondaryOptions = accountOptionsForField(
    options.accounts,
    template,
    'secondaryAccountId',
    draft.secondaryAccountId
  );
  const selectedPrimary = asArray(options.accounts).find(
    (option) => option.value === draft.primaryAccountId
  );
  const selectedSecondary = asArray(options.accounts).find(
    (option) => option.value === draft.secondaryAccountId
  );
  const showFxRate =
    draft.currency === 'USD' ||
    [selectedPrimary, selectedSecondary]
      .filter(Boolean)
      .some((account) => account.currency && account.currency !== draft.currency);
  const contextAccount =
    context.account || (DEBT_TEMPLATES.has(template) ? selectedSecondary : selectedPrimary) || {};
  const category = categoryCopy(template);
  const showCategory = Boolean(expectedCategoryType(template));
  const categories = categoriesForTemplate(options.categories, template, draft.categoryId);
  const fieldBinding = (field, bindingOptions) =>
    actions.change('transaction-composer-change', { field }, bindingOptions);
  const hasWarnings = asArray(data.warnings).length > 0;
  const hasCurrencyConversionWarning = asArray(data.warnings).some(
    (warning) => warning?.code === 'account_currency_conversion_confirmation_required'
  );
  const submitBinding = actions.action(
    hasWarnings ? 'confirm-transaction-warnings' : 'submit-transaction'
  );
  const primaryLabel =
    context.primaryLabel ||
    (template === 'income_received'
      ? 'To account'
      : DEBT_TEMPLATES.has(template)
        ? 'Pay from'
        : 'From account');
  const secondaryLabel =
    context.secondaryLabel || (DEBT_TEMPLATES.has(template) ? 'Liability account' : 'To account');

  const content = (
    <div className="modal-backdrop" data-react-modal="transaction-composer" onMouseDown={dismiss}>
      <section
        aria-label="Edit Transaction"
        aria-modal="true"
        className="modal-card transaction-edit-modal"
        data-account-context={contextKind}
        role="dialog"
        style={{ '--transaction-edit-accent': context.accent || 'var(--info)' }}
      >
        <header className="transaction-edit-header">
          <div>
            <h2>{context.title || 'Edit Transaction'}</h2>
            {context.description ? <p>{context.description}</p> : null}
          </div>
          <button
            aria-label="Close"
            className="btn btn-icon transaction-edit-close"
            title="Close"
            type="button"
            {...closeModal}
          >
            <Icon name="close" />
          </button>
        </header>

        <form
          className="transaction-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitBinding.onClick?.(event);
          }}
        >
          <div className="transaction-edit-type-badge">
            <Icon name={context.icon || 'receipt_long'} />
            <strong>{context.badge || 'Account transaction'}</strong>
          </div>

          <ContextSummary account={contextAccount} context={context} />

          <div className="transaction-edit-grid transaction-edit-grid-2">
            <div className="field transaction-edit-field">
              <label htmlFor="transaction-template">Transaction type</label>
              <select id="transaction-template" value={template} {...fieldBinding('template')}>
                {asArray(options.templates).map((option) => (
                  <option key={option.value} value={option.value}>
                    {templateLabel(option, contextKind)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field transaction-edit-field">
              <label htmlFor="transaction-date">Date</label>
              <input
                id="transaction-date"
                type="date"
                value={draft.date || ''}
                {...fieldBinding('date')}
              />
            </div>
          </div>

          <div
            className={`transaction-edit-grid transaction-edit-account-grid${
              needsSecondary ? '' : ' single'
            }`}
          >
            <AccountField
              fallbackIcon={context.icon}
              field="primaryAccountId"
              id="transaction-primary-account"
              label={primaryLabel}
              options={primaryOptions}
              value={draft.primaryAccountId}
            />
            {needsSecondary ? (
              <AccountField
                disabledOptionId={template === 'transfer' ? draft.primaryAccountId : ''}
                fallbackIcon={
                  DEBT_TEMPLATES.has(template) ? context.icon : 'account_balance_wallet'
                }
                field="secondaryAccountId"
                id="transaction-secondary-account"
                label={secondaryLabel}
                options={secondaryOptions}
                value={draft.secondaryAccountId}
              />
            ) : null}
          </div>

          <div className="transaction-edit-grid transaction-edit-money-grid">
            <div className="field transaction-edit-field">
              <label htmlFor="transaction-amount">{context.amountLabel || 'Amount'}</label>
              <div className="transaction-edit-money-control">
                <span aria-hidden="true">{currencyMark(draft.currency)}</span>
                <FinancialValueInput
                  allowNegative={false}
                  id="transaction-amount"
                  min="0"
                  value={draft.amount || ''}
                  {...fieldBinding('amount')}
                />
              </div>
            </div>
            <div className="field transaction-edit-field transaction-edit-currency-field">
              <label htmlFor="transaction-currency">Currency</label>
              <select
                id="transaction-currency"
                value={draft.currency || 'PHP'}
                {...fieldBinding('currency')}
              >
                {asArray(options.currencies).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className={`transaction-edit-grid transaction-edit-grid-2 transaction-edit-copy-grid${
              showCategory ? '' : ' single'
            }`}
          >
            {showCategory ? (
              <div className="field transaction-edit-field">
                <label htmlFor="transaction-category">{category.label}</label>
                <CategorizedSelect
                  aria-label={category.label}
                  id="transaction-category"
                  options={categories}
                  placeholder={category.placeholder}
                  value={draft.categoryId || ''}
                  {...fieldBinding('categoryId')}
                />
              </div>
            ) : null}
            <div className="field transaction-edit-field">
              <label htmlFor="transaction-description">Description</label>
              <input
                id="transaction-description"
                placeholder={context.descriptionPlaceholder || 'What was this for?'}
                type="text"
                value={draft.description || ''}
                {...fieldBinding('description')}
              />
            </div>
          </div>

          {showFxRate ? (
            <div className="field transaction-edit-field transaction-edit-fx-field">
              <label htmlFor="transaction-fx-rate">FX rate to base</label>
              <input
                id="transaction-fx-rate"
                min="0"
                step="0.0001"
                type="number"
                value={draft.fxRateToBase || ''}
                {...fieldBinding('fxRateToBase')}
              />
            </div>
          ) : null}

          <details className="transaction-edit-optional" open={draft.note ? true : undefined}>
            <summary>
              <Icon name="format_list_bulleted" />
              <span>Additional details — Optional</span>
              <Icon name="expand_more" />
            </summary>
            <div className="field transaction-edit-field transaction-edit-note-field">
              <label htmlFor="transaction-note">Note</label>
              <textarea
                id="transaction-note"
                placeholder="Add a note or reference…"
                rows="3"
                value={draft.note || ''}
                {...fieldBinding('note')}
              />
            </div>
          </details>

          <MessageList errors={data.errors} warnings={data.warnings} />

          <div className="transaction-edit-actions">
            <button className="btn btn-primary transaction-edit-submit" type="submit">
              <Icon name={hasWarnings ? 'warning' : 'save'} />
              {hasWarnings
                ? hasCurrencyConversionWarning
                  ? 'Confirm Conversion & Save'
                  : 'Post Anyway'
                : 'Save Changes'}
            </button>
            <button className="btn transaction-edit-cancel" type="button" {...closeModal}>
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

export function TransactionEditModal({ modal, onAction }) {
  if (typeof onAction === 'function') {
    return (
      <ActionBindingProvider onAction={onAction}>
        <TransactionEditModalContent modal={modal} />
      </ActionBindingProvider>
    );
  }
  return <TransactionEditModalContent modal={modal} />;
}
