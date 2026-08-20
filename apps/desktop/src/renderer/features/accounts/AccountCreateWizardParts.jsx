import React, { useEffect } from 'react';

import { CavalryIcon, CavalryIconDisc } from '../../shared/CavalryIcon.jsx';
import { createPortal } from 'react-dom';

import { findInstitutionById } from '@cavalry/finance-core';

import { FinancialValueInput } from '../../shared/FinancialValueInput.jsx';
import { CavalrySelect } from '../../shared/CavalrySelect.jsx';
import { InstitutionMark, InstitutionSelect } from '../../shared/InstitutionSelect.jsx';

export function IconDisc({ name, className = '' }) {
  return <CavalryIconDisc className={className} name={name} />;
}

export function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

export const ACCOUNT_TYPE_OPTIONS = [
  {
    id: 'bank',
    label: 'Bank Account',
    description: 'Savings, checking, or other bank accounts',
    group: 'asset',
    subtype: 'bank',
    icon: 'account_balance',
    accent: '#14804f',
    title: 'Add Bank Account',
    badge: 'Bank account',
    nameLabel: 'Account name',
    namePlaceholder: 'e.g., BDO Savings',
    balanceLabel: 'Starting balance',
    dateLabel: 'Balance as of'
  },
  {
    id: 'cash',
    label: 'Cash Account',
    description: 'Cash on hand or in a physical wallet',
    group: 'asset',
    subtype: 'cash',
    icon: 'payments',
    accent: '#14804f',
    title: 'Add Cash Account',
    badge: 'Cash account',
    nameLabel: 'Cash account name',
    namePlaceholder: 'e.g., Wallet, Petty Cash',
    balanceLabel: 'Starting balance',
    dateLabel: 'Balance as of'
  },
  {
    id: 'wallet',
    label: 'E-Wallet',
    description: 'GCash, Maya, GrabPay, and other e-wallets',
    group: 'asset',
    subtype: 'wallet',
    icon: 'account_balance_wallet',
    accent: '#14804f',
    title: 'Add E-Wallet Account',
    badge: 'E-wallet account',
    nameLabel: 'E-wallet name',
    namePlaceholder: 'e.g., My E-Wallet',
    balanceLabel: 'Starting balance',
    dateLabel: 'Balance as of'
  },
  {
    id: 'credit_card',
    label: 'Credit Card',
    description: 'Credit cards and revolving balances',
    group: 'liability',
    subtype: 'credit_card',
    icon: 'credit_card',
    accent: '#7048d7',
    title: 'Add Account',
    badge: 'Credit card account',
    nameLabel: 'Card name',
    namePlaceholder: 'e.g., BPI Credit Card',
    balanceLabel: 'Current balance owed',
    dateLabel: 'Balance as of'
  },
  {
    id: 'investment',
    label: 'Investment Account',
    description: 'Stocks, mutual funds, crypto, and more',
    group: 'asset',
    subtype: 'investment',
    icon: 'trending_up',
    accent: '#1756b5',
    title: 'Add Account',
    badge: 'Investment account',
    nameLabel: 'Investment name',
    namePlaceholder: 'e.g., Long-term Portfolio',
    balanceLabel: 'Current market value',
    dateLabel: 'Valuation date'
  },
  {
    id: 'liability',
    label: 'Liability',
    description: 'Loans, credit lines, or other debts',
    group: 'liability',
    subtype: 'loan',
    icon: 'request_quote',
    accent: '#bf2f31',
    title: 'Add Account',
    badge: 'Liability account',
    nameLabel: 'Liability name',
    namePlaceholder: 'e.g., Auto Loan',
    balanceLabel: 'Outstanding balance',
    dateLabel: 'Balance as of'
  },
  {
    id: 'other_asset',
    label: 'Coming Soon',
    description: 'More account types are on the way',
    icon: 'more_horiz',
    accent: 'var(--text-dim)',
    disabled: true
  }
];

export const DEFAULT_ACCOUNT_DETAILS = Object.freeze({
  bankAccountType: 'savings',
  accountNumber: '',
  branch: '',
  location: '',
  mobileNumber: '',
  email: '',
  accountReference: '',
  cardNetwork: '',
  creditLimit: '0',
  billingDay: '',
  dueDay: '',
  annualFee: '',
  investmentType: '',
  costBasis: '',
  monthlyContribution: '',
  loanType: '',
  originalBalance: '',
  interestRate: '',
  monthlyPayment: '',
  paymentDueDay: '',
  maturityDate: ''
});

export const DETAIL_KEYS_BY_TYPE = Object.freeze({
  bank: ['bankAccountType', 'accountNumber', 'branch', 'interestRate'],
  cash: ['location'],
  wallet: ['mobileNumber', 'email', 'accountReference'],
  credit_card: [
    'cardNetwork',
    'creditLimit',
    'billingDay',
    'dueDay',
    'annualFee',
    'accountNumber',
    'interestRate'
  ],
  investment: ['investmentType', 'accountReference', 'costBasis', 'monthlyContribution'],
  liability: [
    'loanType',
    'originalBalance',
    'interestRate',
    'monthlyPayment',
    'paymentDueDay',
    'maturityDate',
    'accountReference'
  ]
});

export const CURRENCY_OPTIONS = [
  ['PHP', 'PHP'],
  ['USD', 'USD']
];

export const CARD_NETWORK_OPTIONS = [
  ['visa', 'Visa'],
  ['mastercard', 'Mastercard'],
  ['jcb', 'JCB'],
  ['american_express', 'American Express'],
  ['unionpay', 'UnionPay'],
  ['other', 'Other']
];

export const INVESTMENT_TYPE_OPTIONS = [
  ['brokerage', 'Brokerage'],
  ['mutual_fund', 'Mutual Fund / UITF'],
  ['crypto', 'Crypto'],
  ['retirement', 'Retirement'],
  ['time_deposit', 'Time Deposit'],
  ['other', 'Other']
];

export const LIABILITY_TYPE_OPTIONS = [
  ['personal_loan', 'Personal Loan'],
  ['auto_loan', 'Auto Loan'],
  ['home_loan', 'Home Loan'],
  ['line_of_credit', 'Line of Credit'],
  ['other', 'Other']
];

export const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => {
  const day = index + 1;
  return [String(day), String(day)];
});

export function createDefaultDetails() {
  return { ...DEFAULT_ACCOUNT_DETAILS };
}

export function accountDetailsFor(typeId, details) {
  return (DETAIL_KEYS_BY_TYPE[typeId] || []).reduce((result, key) => {
    const value = details[key];
    if (String(value == null ? '' : value).trim()) result[key] = value;
    return result;
  }, {});
}

export function numberValue(value) {
  const parsed = Number(String(value == null ? '' : value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value, currency) {
  try {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: currency || 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch (_error) {
    return `${currency || 'PHP'} ${Number(value || 0).toFixed(2)}`;
  }
}

export function currencySymbol(currency) {
  return currency === 'USD' ? '$' : '₱';
}

export function ModalFrame({ title, error, children, onBack, onCancel, className = '' }) {
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <section
        aria-labelledby="account-create-title"
        aria-modal="true"
        className={`modal-card account-create-modal ${className}`}
        role="dialog"
      >
        <header className={`account-flow-header${onBack ? ' has-back' : ''}`}>
          {onBack ? (
            <button aria-label="Go back" className="btn btn-icon" onClick={onBack} type="button">
              <Icon name="arrow_back" />
            </button>
          ) : null}
          <h2 id="account-create-title">{title}</h2>
          <button aria-label="Close" className="btn btn-icon" onClick={onCancel} type="button">
            <Icon name="close" />
          </button>
        </header>
        {error ? (
          <div className="panel-note status-bad" role="alert">
            {error}
          </div>
        ) : null}
        {children}
      </section>
    </div>,
    document.body
  );
}

export function FieldLabel({ htmlFor, label, required = false }) {
  return (
    <label className={required ? 'is-required' : undefined} htmlFor={htmlFor}>
      {label}
    </label>
  );
}

export function TextField({
  id,
  icon,
  label,
  help,
  onChange,
  placeholder = '',
  required = false,
  type = 'text',
  value,
  ...inputProps
}) {
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div className="field account-flow-field">
      <FieldLabel htmlFor={id} label={label} required={required} />
      <div className={`account-flow-control${icon ? ' has-icon' : ''}`}>
        {icon ? <Icon name={icon} /> : null}
        <input
          {...inputProps}
          aria-describedby={helpId}
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          type={type}
          value={value}
        />
      </div>
      {help ? (
        <small className="account-field-copy" id={helpId}>
          {help}
        </small>
      ) : null}
    </div>
  );
}

export function SelectField({
  disabled = false,
  help = '',
  id,
  label,
  onChange,
  options,
  placeholder = 'Select…',
  required = false,
  value
}) {
  return (
    <div className="field account-flow-field">
      <FieldLabel htmlFor={id} label={label} required={required} />
      <CavalrySelect
        aria-describedby={help ? `${id}-help` : undefined}
        aria-label={label}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        options={options.map(([optionValue, optionLabel]) => ({
          value: optionValue,
          label: optionLabel
        }))}
        placeholder={placeholder}
        showLeadingIcon={false}
        value={value}
      />
      {help ? (
        <small className="account-field-copy" id={`${id}-help`}>
          {help}
        </small>
      ) : null}
    </div>
  );
}

export function AmountField({
  currency = 'PHP',
  id,
  label,
  help,
  onChange,
  required = false,
  value
}) {
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div className="field account-flow-field">
      <FieldLabel htmlFor={id} label={label} required={required} />
      <div className="account-flow-control account-money-control">
        <span aria-hidden="true" className="account-currency-prefix">
          {currencySymbol(currency)}
        </span>
        <FinancialValueInput
          allowNegative={false}
          aria-describedby={helpId}
          id={id}
          min="0"
          onChange={(event) => onChange(event.target.value)}
          required={required}
          value={value}
        />
      </div>
      {help ? (
        <small className="account-field-copy" id={helpId}>
          {help}
        </small>
      ) : null}
    </div>
  );
}

export function InstitutionField({
  id,
  label,
  institution,
  institutionId,
  onChange,
  placeholder,
  required = false,
  subtype
}) {
  return (
    <div className="field account-flow-field account-institution-field">
      <FieldLabel htmlFor={id} label={label} required={required} />
      <InstitutionSelect
        accountSubtype={subtype}
        id={id}
        institution={institution}
        institutionId={institutionId}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}

export function SegmentedField({ label, name, onChange, options, value }) {
  return (
    <fieldset aria-label={label} className="account-segmented-field account-flow-segmented">
      <legend className="is-required">{label}</legend>
      <div className="account-segmented-options">
        {options.map(([optionValue, optionLabel]) => (
          <label className={value === optionValue ? 'is-selected' : ''} key={optionValue}>
            <input
              checked={value === optionValue}
              name={name}
              onChange={() => onChange(optionValue)}
              type="radio"
              value={optionValue}
            />
            <span>{optionLabel}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function OptionalDetails({ children, defaultOpen = false, description = '' }) {
  return (
    <details className="account-flow-optional" open={defaultOpen || undefined}>
      <summary>
        <Icon name="format_list_bulleted" />
        <span className="account-flow-optional-copy">
          <span>Additional details — Optional</span>
          {description ? <small>{description}</small> : null}
        </span>
        <Icon name="expand_more" />
      </summary>
      <div className="account-flow-optional-fields">{children}</div>
    </details>
  );
}

export function NoteField({ note, setNote }) {
  return (
    <div className="field account-flow-field account-note-field">
      <label htmlFor="create-account-note">Notes</label>
      <textarea
        id="create-account-note"
        maxLength={200}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Add notes…"
        value={note}
      />
      <small className="field-counter">{note.length} / 200</small>
    </div>
  );
}

export function TypeBadge({ option }) {
  return (
    <div className="account-flow-type-badge">
      <Icon name={option.icon} />
      <strong>{option.badge}</strong>
    </div>
  );
}

export function QuickInstitutionPicker({
  institutionId,
  label,
  onChoose,
  onOther,
  options,
  otherSelected
}) {
  return (
    <fieldset className="account-quick-picker">
      <legend>{label}</legend>
      <div className="account-quick-picker-grid">
        {options.map((providerId) => {
          const provider = findInstitutionById(providerId);
          const selected = institutionId === providerId && !otherSelected;
          return (
            <button
              aria-pressed={selected}
              className={selected ? 'is-selected' : ''}
              key={providerId}
              onClick={() => onChoose(providerId)}
              type="button"
            >
              <InstitutionMark institutionId={providerId} />
              <span>{provider?.shortName}</span>
              {selected ? <Icon className="account-quick-check" name="check" /> : null}
            </button>
          );
        })}
        <button
          aria-pressed={otherSelected}
          className={otherSelected ? 'is-selected' : ''}
          onClick={onOther}
          type="button"
        >
          <span className="account-other-mark">
            <Icon name="more_horiz" />
          </span>
          <span>Other…</span>
          {otherSelected ? <Icon className="account-quick-check" name="check" /> : null}
        </button>
      </div>
    </fieldset>
  );
}

export function CreditSummary({ balance, currency, limit }) {
  const available = numberValue(limit) - numberValue(balance);
  return (
    <div className="account-flow-credit-summary" role="status">
      <span className="account-flow-credit-icon">
        <Icon name="account_balance_wallet" />
      </span>
      <span>Available credit:</span>
      <strong className={available < 0 ? 'bad' : ''}>{formatMoney(available, currency)}</strong>
    </div>
  );
}
