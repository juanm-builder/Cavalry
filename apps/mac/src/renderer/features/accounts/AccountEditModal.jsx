import React, { useMemo, useState } from 'react';

import {
  findInstitutionById,
  isTimeDepositSubtype,
  resolveInstitution
} from '@cavalry/finance-core';

import { InstitutionMark } from '../../shared/InstitutionSelect.jsx';
import {
  ACCOUNT_TYPE_OPTIONS,
  AmountField,
  CARD_NETWORK_OPTIONS,
  CURRENCY_OPTIONS,
  DAY_OPTIONS,
  DETAIL_KEYS_BY_TYPE,
  INVESTMENT_TYPE_OPTIONS,
  Icon,
  InstitutionField,
  LIABILITY_TYPE_OPTIONS,
  ModalFrame,
  NoteField,
  OptionalDetails,
  QuickInstitutionPicker,
  SegmentedField,
  SelectField,
  TextField,
  TypeBadge,
  accountDetailsFor,
  createDefaultDetails
} from './AccountCreateWizardParts.jsx';

const WALLET_PROVIDERS = Object.freeze(['gcash', 'mayawallet', 'grabpay', 'shopeepay']);
const CARD_ISSUERS = Object.freeze(['bdo', 'bpi', 'metrobank', 'hsbc']);

const EDIT_CONTEXT_COPY = Object.freeze({
  bank: {
    editTitle: 'Edit Bank Account',
    balanceLabel: 'Current balance',
    institutionLabel: 'Bank',
    institutionPlaceholder: 'Search or choose bank',
    institutionSubtype: 'bank'
  },
  cash: {
    editTitle: 'Edit Cash Account',
    balanceLabel: 'Current balance'
  },
  wallet: {
    editTitle: 'Edit E-Wallet Account',
    balanceLabel: 'Current balance',
    institutionLabel: 'Provider name',
    institutionPlaceholder: 'Search or enter e-wallet provider',
    institutionSubtype: 'wallet'
  },
  credit_card: {
    editTitle: 'Edit Credit Card',
    balanceLabel: 'Current balance owed',
    institutionLabel: 'Issuer name',
    institutionPlaceholder: 'Search or enter card issuer',
    institutionSubtype: 'credit_card'
  },
  investment: {
    editTitle: 'Edit Investment Account',
    balanceLabel: 'Current market value',
    institutionLabel: 'Platform / Broker',
    institutionPlaceholder: 'Search platform, broker, bank, or custodian',
    institutionSubtype: 'investment'
  },
  liability: {
    editTitle: 'Edit Liability Account',
    balanceLabel: 'Outstanding balance',
    institutionLabel: 'Lender / Institution',
    institutionPlaceholder: 'Search lender or financial institution',
    institutionSubtype: 'loan'
  },
  asset: {
    id: 'asset',
    label: 'Asset Account',
    badge: 'Asset account',
    group: 'asset',
    subtype: 'asset',
    icon: 'account_balance_wallet',
    accent: '#14804f',
    editTitle: 'Edit Asset Account',
    balanceLabel: 'Current balance',
    institutionLabel: 'Institution / Provider',
    institutionPlaceholder: 'Search or enter institution',
    institutionSubtype: ''
  }
});

const ICON_OPTIONS = Object.freeze({
  bank: [
    ['account_balance', 'Bank'],
    ['savings', 'Savings'],
    ['account_balance_wallet', 'Account'],
    ['payments', 'Payments'],
    ['paid', 'Money']
  ],
  cash: [
    ['payments', 'Cash'],
    ['account_balance_wallet', 'Wallet'],
    ['local_atm', 'Cash machine'],
    ['paid', 'Money'],
    ['attach_money', 'Currency']
  ],
  wallet: [
    ['account_balance_wallet', 'Wallet'],
    ['smartphone', 'Mobile'],
    ['qr_code_2', 'QR payments'],
    ['payments', 'Payments'],
    ['send_money', 'Send money']
  ],
  credit_card: [
    ['credit_card', 'Credit card'],
    ['payment', 'Payment card'],
    ['card_membership', 'Membership card'],
    ['account_balance_wallet', 'Card wallet'],
    ['receipt_long', 'Card statement']
  ],
  investment: [
    ['trending_up', 'Growth'],
    ['query_stats', 'Portfolio'],
    ['show_chart', 'Market'],
    ['savings', 'Savings'],
    ['currency_bitcoin', 'Crypto']
  ],
  liability: [
    ['request_quote', 'Liability'],
    ['receipt_long', 'Statement'],
    ['home', 'Home loan'],
    ['directions_car', 'Auto loan'],
    ['real_estate_agent', 'Loan']
  ],
  asset: [
    ['account_balance_wallet', 'Asset'],
    ['inventory_2', 'Property'],
    ['diamond', 'Valuable'],
    ['home', 'Home'],
    ['directions_car', 'Vehicle']
  ]
});

const ACCOUNT_TYPE_BY_ID = new Map(
  ACCOUNT_TYPE_OPTIONS.filter((option) => !option.disabled).map((option) => [option.id, option])
);

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function effectiveInstitutionId(account) {
  return (
    findInstitutionById(account?.institutionId)?.id ||
    resolveInstitution(account?.institution)?.id ||
    ''
  );
}

function normalizedContextId(value) {
  const normalized = asText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (['bank', 'savings', 'checking'].includes(normalized)) return 'bank';
  if (normalized === 'cash') return 'cash';
  if (['wallet', 'e_wallet', 'ewallet'].includes(normalized)) return 'wallet';
  if (['credit_card', 'card'].includes(normalized)) return 'credit_card';
  if (
    [
      'investment',
      'time_deposit',
      'timedeposit',
      'short_term_investment',
      'short_term_investments'
    ].includes(normalized)
  )
    return 'investment';
  if (['liability', 'loan'].includes(normalized)) return 'liability';
  if (normalized === 'asset') return 'asset';
  return '';
}

export function resolveAccountEditContext(account = {}, requestedContext = '') {
  const requestedValue =
    requestedContext && typeof requestedContext === 'object'
      ? requestedContext.id || requestedContext.kind || requestedContext.type
      : requestedContext;
  const explicitId = normalizedContextId(requestedValue);
  const resolvedSubtypeId = normalizedContextId(account.subtype);
  const subtypeId = resolvedSubtypeId === 'asset' ? '' : resolvedSubtypeId;
  const institution =
    findInstitutionById(effectiveInstitutionId(account)) || resolveInstitution(account.name);
  const group = asText(account.group).toLowerCase();
  const accountName = asText(account.name).toLowerCase();
  const inferredId =
    /credit\s*card|mastercard|visa/.test(accountName) && group === 'liability'
      ? 'credit_card'
      : group === 'liability'
        ? 'liability'
        : institution?.type === 'e_wallet'
          ? 'wallet'
          : institution?.type === 'bank' || institution?.type === 'digital_bank'
            ? 'bank'
            : /(^|\s)cash($|\s)|petty cash/.test(accountName)
              ? 'cash'
              : '';
  const id = explicitId || subtypeId || inferredId || 'asset';
  const baseOption = ACCOUNT_TYPE_BY_ID.get(id) || EDIT_CONTEXT_COPY.asset;
  const definition = {
    ...baseOption,
    ...(EDIT_CONTEXT_COPY[id] || EDIT_CONTEXT_COPY.asset)
  };
  return requestedContext && typeof requestedContext === 'object'
    ? { ...definition, ...requestedContext, id }
    : definition;
}

function stringDetails(account, contextId) {
  const original = asObject(account?.details);
  const next = { ...createDefaultDetails() };
  Object.entries(original).forEach(([key, value]) => {
    next[key] = value == null ? '' : String(value);
  });
  if (contextId === 'bank') {
    const existing = asText(next.bankAccountType).toLowerCase();
    const subtype = asText(account?.subtype).toLowerCase();
    next.bankAccountType = ['savings', 'checking', 'other'].includes(existing)
      ? existing
      : ['savings', 'checking'].includes(subtype)
        ? subtype
        : 'savings';
  }
  return next;
}

function mergedDetails(originalDetails, contextId, details) {
  const merged = { ...asObject(originalDetails) };
  (DETAIL_KEYS_BY_TYPE[contextId] || []).forEach((key) => delete merged[key]);
  return {
    ...merged,
    ...accountDetailsFor(contextId, details)
  };
}

function hasExistingOptionalDetails(account, contextId) {
  const details = asObject(account?.details);
  const hasContextDetails = (DETAIL_KEYS_BY_TYPE[contextId] || []).some((key) => {
    const value = details[key];
    return String(value == null ? '' : value).trim();
  });
  return (
    hasContextDetails ||
    Boolean(asText(account?.note)) ||
    (contextId === 'investment' &&
      isTimeDepositSubtype(account?.subtype) &&
      ['placementDate', 'maturityDate', 'interestRate', 'estimatedMaturityAmount'].some((key) =>
        Boolean(asText(account?.[key]))
      ))
  );
}

function AccountAppearancePicker({
  contextId,
  icon,
  institutionId,
  logoMode,
  onChooseIcon,
  onChooseLogo
}) {
  const institution = findInstitutionById(institutionId);
  const options = ICON_OPTIONS[contextId] || ICON_OPTIONS.asset;
  return (
    <fieldset className="account-edit-appearance">
      <legend>Account icon / logo</legend>
      <div className="account-edit-appearance-options">
        {institution ? (
          <button
            aria-label={`Use ${institution.shortName} logo`}
            aria-pressed={logoMode === 'institution'}
            className={logoMode === 'institution' ? 'is-selected' : ''}
            onClick={onChooseLogo}
            type="button"
          >
            <InstitutionMark institutionId={institution.id} />
            <span>{institution.shortName}</span>
            <small>Logo</small>
            {logoMode === 'institution' ? (
              <Icon className="account-edit-appearance-check" name="check" />
            ) : null}
          </button>
        ) : null}
        {options.map(([value, label]) => {
          const selected = logoMode === 'icon' && icon === value;
          return (
            <button
              aria-label={`Use ${label} icon`}
              aria-pressed={selected}
              className={selected ? 'is-selected' : ''}
              key={value}
              onClick={() => onChooseIcon(value)}
              type="button"
            >
              <span className="account-edit-generic-mark">
                <Icon name={value} />
              </span>
              <span>{label}</span>
              <small>Icon</small>
              {selected ? <Icon className="account-edit-appearance-check" name="check" /> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function AccountEditSummary({
  account,
  balanceCopy,
  balanceLabel,
  context,
  icon,
  institutionId,
  logoMode,
  name
}) {
  return (
    <section className="account-edit-summary" aria-label="Account summary">
      <span className="account-edit-summary-mark">
        <InstitutionMark
          fallbackIcon={icon || context.icon}
          institutionId={logoMode === 'institution' ? institutionId : ''}
        />
      </span>
      <span className="account-edit-summary-copy">
        <strong>{name || context.label}</strong>
        <small>
          {context.label}
          {account?.isActive === false ? ' · Archived' : ''}
        </small>
      </span>
      <span className="account-edit-summary-balance">
        <small>{balanceLabel || context.balanceLabel}</small>
        <strong>{balanceCopy || 'Not available'}</strong>
      </span>
    </section>
  );
}

export function AccountEditModal({
  account = {},
  balanceCopy = '',
  balanceLabel = '',
  context: requestedContext = '',
  currencyLocked = false,
  type = '',
  error = '',
  onCancel,
  onSubmit
}) {
  const context = useMemo(
    () => resolveAccountEditContext(account, requestedContext || type),
    [account, requestedContext, type]
  );
  const institutionIdAtOpen = effectiveInstitutionId(account);
  const [name, setName] = useState(account.name || '');
  const [institution, setInstitution] = useState(account.institution || '');
  const [institutionId, setInstitutionId] = useState(institutionIdAtOpen);
  const [customInstitution, setCustomInstitution] = useState(() => {
    const quickOptions = context.id === 'wallet' ? WALLET_PROVIDERS : CARD_ISSUERS;
    return ['wallet', 'credit_card'].includes(context.id)
      ? !quickOptions.includes(institutionIdAtOpen)
      : false;
  });
  const [currency, setCurrency] = useState(account.currency || 'PHP');
  const [openedDate, setOpenedDate] = useState(account.openedDate || '');
  const [note, setNote] = useState(account.note || '');
  const [details, setDetails] = useState(() => stringDetails(account, context.id));
  const [icon, setIcon] = useState(account.icon || context.icon);
  const [logoMode, setLogoMode] = useState(
    account.logoMode === 'icon' || !institutionIdAtOpen ? 'icon' : 'institution'
  );
  const [placementDate, setPlacementDate] = useState(account.placementDate || '');
  const [maturityDate, setMaturityDate] = useState(account.maturityDate || '');
  const [interestRate, setInterestRate] = useState(String(account.interestRate || ''));
  const [estimatedMaturityAmount, setEstimatedMaturityAmount] = useState(
    String(account.estimatedMaturityAmount || '')
  );
  const isTimeDeposit = isTimeDepositSubtype(account.subtype);
  const optionalOpen = hasExistingOptionalDetails(account, context.id);

  function setDetail(key, value) {
    setDetails((current) => ({ ...current, [key]: value }));
  }

  function setInstitutionValue(next) {
    setInstitution(next.institution);
    setInstitutionId(next.institutionId);
    setLogoMode(next.institutionId ? 'institution' : 'icon');
  }

  function chooseQuickInstitution(providerId) {
    const provider = findInstitutionById(providerId);
    if (!provider) return;
    setInstitution(provider.shortName);
    setInstitutionId(provider.id);
    setCustomInstitution(false);
    setLogoMode('institution');
  }

  function chooseOtherInstitution() {
    setInstitution('');
    setInstitutionId('');
    setCustomInstitution(true);
    setLogoMode('icon');
  }

  function renderAppearance() {
    return (
      <AccountAppearancePicker
        contextId={context.id}
        icon={icon}
        institutionId={institutionId}
        logoMode={logoMode}
        onChooseIcon={(nextIcon) => {
          setIcon(nextIcon);
          setLogoMode('icon');
        }}
        onChooseLogo={() => setLogoMode('institution')}
      />
    );
  }

  function renderCommonDateAndCurrency() {
    return (
      <div className="account-flow-grid account-flow-grid-2">
        <SelectField
          disabled={currencyLocked}
          help={
            currencyLocked
              ? 'This account has history. Use the currency repair review if the original setup was wrong; a real currency conversion needs a new account or conversion workflow.'
              : ''
          }
          id="edit-account-currency"
          label="Currency"
          onChange={setCurrency}
          options={CURRENCY_OPTIONS}
          required
          value={currency}
        />
        <TextField
          id="edit-account-opened"
          label="Opened date"
          onChange={setOpenedDate}
          required
          type="date"
          value={openedDate}
        />
      </div>
    );
  }

  function renderInstitutionField() {
    return (
      <InstitutionField
        id="edit-account-institution"
        institution={institution}
        institutionId={institutionId}
        label={context.institutionLabel}
        onChange={setInstitutionValue}
        placeholder={context.institutionPlaceholder}
        subtype={context.institutionSubtype}
      />
    );
  }

  function renderBankFields() {
    return (
      <>
        <TextField
          icon="person"
          id="edit-account-name"
          label="Account name"
          onChange={setName}
          placeholder="e.g., BDO Savings"
          required
          value={name}
        />
        {renderInstitutionField()}
        {renderAppearance()}
        <div className="account-flow-grid account-flow-bank-row">
          <SegmentedField
            label="Account type"
            name="edit-bank-account-type"
            onChange={(value) => setDetail('bankAccountType', value)}
            options={[
              ['savings', 'Savings'],
              ['checking', 'Checking'],
              ['other', 'Other']
            ]}
            value={details.bankAccountType}
          />
          <SelectField
            disabled={currencyLocked}
            help={
              currencyLocked
                ? 'This account has history. Use the currency repair review if the original setup was wrong; a real currency conversion needs a new account or conversion workflow.'
                : ''
            }
            id="edit-account-currency"
            label="Currency"
            onChange={setCurrency}
            options={CURRENCY_OPTIONS}
            required
            value={currency}
          />
        </div>
        <TextField
          id="edit-account-opened"
          label="Opened date"
          onChange={setOpenedDate}
          required
          type="date"
          value={openedDate}
        />
        <OptionalDetails defaultOpen={optionalOpen}>
          <div className="account-flow-grid account-flow-grid-3">
            <TextField
              id="edit-account-number"
              inputMode="numeric"
              label="Account number (last 4 digits)"
              maxLength={4}
              onChange={(value) => setDetail('accountNumber', value.replace(/\D/g, ''))}
              placeholder="e.g., 9012"
              value={details.accountNumber}
            />
            <TextField
              id="edit-bank-interest-rate"
              inputMode="decimal"
              label="Interest rate (p.a.)"
              onChange={(value) => setDetail('interestRate', value)}
              pattern="[0-9]*([.][0-9]{0,2})?"
              placeholder="e.g., 1.50"
              value={details.interestRate}
            />
            <TextField
              id="edit-bank-branch"
              label="Branch"
              onChange={(value) => setDetail('branch', value)}
              placeholder="e.g., Makati"
              value={details.branch}
            />
          </div>
          <NoteField note={note} setNote={setNote} />
        </OptionalDetails>
      </>
    );
  }

  function renderCashFields() {
    return (
      <>
        <TextField
          icon="account_balance_wallet"
          id="edit-account-name"
          label="Cash account name"
          onChange={setName}
          placeholder="e.g., Wallet, Petty Cash"
          required
          value={name}
        />
        {renderAppearance()}
        {renderCommonDateAndCurrency()}
        <OptionalDetails
          defaultOpen={optionalOpen}
          description="Add a location or notes if they help identify this cash account."
        >
          <TextField
            id="edit-cash-location"
            label="Location"
            onChange={(value) => setDetail('location', value)}
            placeholder="e.g., Wallet, home safe, office drawer"
            value={details.location}
          />
          <NoteField note={note} setNote={setNote} />
        </OptionalDetails>
      </>
    );
  }

  function renderWalletFields() {
    return (
      <>
        <QuickInstitutionPicker
          institutionId={institutionId}
          label="Provider"
          onChoose={chooseQuickInstitution}
          onOther={chooseOtherInstitution}
          options={WALLET_PROVIDERS}
          otherSelected={customInstitution}
        />
        {customInstitution ? renderInstitutionField() : null}
        {renderAppearance()}
        <TextField
          help="Use a name that is easy to recognize in transactions."
          icon="account_balance_wallet"
          id="edit-account-name"
          label="E-wallet name"
          onChange={setName}
          placeholder="e.g., My E-Wallet"
          required
          value={name}
        />
        {renderCommonDateAndCurrency()}
        <OptionalDetails defaultOpen={optionalOpen}>
          <div className="account-flow-grid account-flow-grid-2">
            <TextField
              id="edit-wallet-mobile"
              label="Mobile number"
              onChange={(value) => setDetail('mobileNumber', value)}
              placeholder="e.g., 0917 123 4567"
              value={details.mobileNumber}
            />
            <TextField
              id="edit-wallet-email"
              label="Email"
              onChange={(value) => setDetail('email', value)}
              placeholder="e.g., name@email.com"
              type="email"
              value={details.email}
            />
          </div>
          <TextField
            id="edit-wallet-reference"
            label="Account ID / Reference"
            onChange={(value) => setDetail('accountReference', value)}
            placeholder="Optional provider reference"
            value={details.accountReference}
          />
          <NoteField note={note} setNote={setNote} />
        </OptionalDetails>
      </>
    );
  }

  function renderCreditCardFields() {
    return (
      <>
        <QuickInstitutionPicker
          institutionId={institutionId}
          label="Issuer"
          onChoose={chooseQuickInstitution}
          onOther={chooseOtherInstitution}
          options={CARD_ISSUERS}
          otherSelected={customInstitution}
        />
        {customInstitution ? renderInstitutionField() : null}
        {renderAppearance()}
        <TextField
          help="Use a name that distinguishes this card from your other accounts."
          icon="credit_card"
          id="edit-account-name"
          label="Card name"
          onChange={setName}
          placeholder="e.g., BPI Credit Card"
          required
          value={name}
        />
        {renderCommonDateAndCurrency()}
        <OptionalDetails
          defaultOpen
          description="Keep card terms here without changing its ledger balance."
        >
          <div className="account-flow-grid account-flow-grid-3">
            <AmountField
              currency={currency}
              id="edit-credit-limit"
              label="Credit limit"
              onChange={(value) => setDetail('creditLimit', value)}
              value={details.creditLimit}
            />
            <SelectField
              id="edit-card-network"
              label="Card network"
              onChange={(value) => setDetail('cardNetwork', value)}
              options={CARD_NETWORK_OPTIONS}
              placeholder="Select network"
              value={details.cardNetwork}
            />
            <TextField
              help="Enter only the last 4 digits."
              id="edit-card-number"
              inputMode="numeric"
              label="Card number (last 4 digits)"
              maxLength={4}
              onChange={(value) => setDetail('accountNumber', value.replace(/\D/g, ''))}
              placeholder="e.g., 1234"
              value={details.accountNumber}
            />
            <TextField
              id="edit-card-interest-rate"
              inputMode="decimal"
              label="Interest rate (p.a.)"
              onChange={(value) => setDetail('interestRate', value)}
              pattern="[0-9]*([.][0-9]{0,2})?"
              placeholder="e.g., 18.00"
              value={details.interestRate}
            />
            <AmountField
              currency={currency}
              id="edit-card-annual-fee"
              label="Annual fee"
              onChange={(value) => setDetail('annualFee', value)}
              value={details.annualFee}
            />
            <SelectField
              id="edit-card-billing-day"
              label="Billing day"
              onChange={(value) => setDetail('billingDay', value)}
              options={DAY_OPTIONS}
              placeholder="Select day…"
              value={details.billingDay}
            />
            <SelectField
              id="edit-card-due-day"
              label="Due day"
              onChange={(value) => setDetail('dueDay', value)}
              options={DAY_OPTIONS}
              placeholder="Select day…"
              value={details.dueDay}
            />
          </div>
          <NoteField note={note} setNote={setNote} />
        </OptionalDetails>
      </>
    );
  }

  function renderInvestmentFields() {
    return (
      <>
        {renderInstitutionField()}
        {renderAppearance()}
        <TextField
          icon="trending_up"
          id="edit-account-name"
          label="Investment name"
          onChange={setName}
          placeholder="e.g., Long-term Portfolio"
          required
          value={name}
        />
        {renderCommonDateAndCurrency()}
        <OptionalDetails defaultOpen={optionalOpen}>
          <div className="account-flow-grid account-flow-grid-2">
            <SelectField
              id="edit-investment-type"
              label="Investment type"
              onChange={(value) => setDetail('investmentType', value)}
              options={INVESTMENT_TYPE_OPTIONS}
              placeholder="Select type…"
              value={details.investmentType}
            />
            <TextField
              id="edit-investment-reference"
              label="Account ID / Reference"
              onChange={(value) => setDetail('accountReference', value)}
              value={details.accountReference}
            />
            <AmountField
              currency={currency}
              id="edit-investment-cost-basis"
              label="Cost basis"
              onChange={(value) => setDetail('costBasis', value)}
              value={details.costBasis}
            />
            <AmountField
              currency={currency}
              id="edit-investment-contribution"
              label="Monthly contribution"
              onChange={(value) => setDetail('monthlyContribution', value)}
              value={details.monthlyContribution}
            />
          </div>
          {isTimeDeposit ? (
            <div className="account-flow-grid account-flow-grid-2 account-edit-time-deposit-fields">
              <TextField
                id="edit-account-placement-date"
                label="Placement date"
                onChange={setPlacementDate}
                type="date"
                value={placementDate}
              />
              <TextField
                id="edit-account-maturity-date"
                label="Maturity date"
                onChange={setMaturityDate}
                type="date"
                value={maturityDate}
              />
              <TextField
                id="edit-account-interest-rate"
                inputMode="decimal"
                label="Deposit interest rate (p.a.)"
                onChange={setInterestRate}
                value={interestRate}
              />
              <AmountField
                currency={currency}
                id="edit-account-maturity-amount"
                label="Estimated maturity amount"
                onChange={setEstimatedMaturityAmount}
                value={estimatedMaturityAmount}
              />
            </div>
          ) : null}
          <NoteField note={note} setNote={setNote} />
        </OptionalDetails>
      </>
    );
  }

  function renderLiabilityFields() {
    return (
      <>
        {renderInstitutionField()}
        {renderAppearance()}
        <TextField
          icon="request_quote"
          id="edit-account-name"
          label="Liability name"
          onChange={setName}
          placeholder="e.g., Auto Loan"
          required
          value={name}
        />
        {renderCommonDateAndCurrency()}
        <OptionalDetails defaultOpen={optionalOpen}>
          <div className="account-flow-grid account-flow-grid-3">
            <SelectField
              id="edit-liability-type"
              label="Liability type"
              onChange={(value) => setDetail('loanType', value)}
              options={LIABILITY_TYPE_OPTIONS}
              placeholder="Select type…"
              value={details.loanType}
            />
            <AmountField
              currency={currency}
              id="edit-liability-original-balance"
              label="Original balance"
              onChange={(value) => setDetail('originalBalance', value)}
              value={details.originalBalance}
            />
            <TextField
              id="edit-liability-interest-rate"
              inputMode="decimal"
              label="Interest rate (p.a.)"
              onChange={(value) => setDetail('interestRate', value)}
              pattern="[0-9]*([.][0-9]{0,2})?"
              placeholder="e.g., 6.50"
              value={details.interestRate}
            />
            <AmountField
              currency={currency}
              id="edit-liability-payment"
              label="Monthly payment"
              onChange={(value) => setDetail('monthlyPayment', value)}
              value={details.monthlyPayment}
            />
            <SelectField
              id="edit-liability-due-day"
              label="Payment due day"
              onChange={(value) => setDetail('paymentDueDay', value)}
              options={DAY_OPTIONS}
              placeholder="Select day…"
              value={details.paymentDueDay}
            />
            <TextField
              id="edit-liability-maturity"
              label="Maturity / End date"
              onChange={(value) => setDetail('maturityDate', value)}
              type="date"
              value={details.maturityDate}
            />
          </div>
          <TextField
            id="edit-liability-reference"
            label="Account ID / Reference"
            onChange={(value) => setDetail('accountReference', value)}
            value={details.accountReference}
          />
          <NoteField note={note} setNote={setNote} />
        </OptionalDetails>
      </>
    );
  }

  function renderAssetFields() {
    return (
      <>
        <TextField
          icon="account_balance_wallet"
          id="edit-account-name"
          label="Account name"
          onChange={setName}
          required
          value={name}
        />
        {renderInstitutionField()}
        {renderAppearance()}
        {renderCommonDateAndCurrency()}
        <OptionalDetails defaultOpen={optionalOpen}>
          <NoteField note={note} setNote={setNote} />
        </OptionalDetails>
      </>
    );
  }

  function renderFields() {
    if (context.id === 'bank') return renderBankFields();
    if (context.id === 'cash') return renderCashFields();
    if (context.id === 'wallet') return renderWalletFields();
    if (context.id === 'credit_card') return renderCreditCardFields();
    if (context.id === 'investment') return renderInvestmentFields();
    if (context.id === 'liability') return renderLiabilityFields();
    return renderAssetFields();
  }

  function submit(event) {
    event.preventDefault();
    onSubmit({
      accountId: account.id,
      name,
      group: account.group,
      subtype: account.subtype,
      institution,
      institutionId,
      currency,
      openedDate,
      note,
      icon,
      logoMode,
      details: mergedDetails(account.details, context.id, details),
      ...(isTimeDeposit
        ? { placementDate, maturityDate, interestRate, estimatedMaturityAmount }
        : {})
    });
  }

  return (
    <ModalFrame
      className={`account-flow-modal account-edit-modal account-flow-${context.id}`}
      error={error}
      onCancel={onCancel}
      title={context.editTitle}
    >
      <form
        className="account-flow-form account-edit-form"
        onSubmit={submit}
        style={{ '--account-accent': context.accent }}
      >
        <TypeBadge option={context} />
        <AccountEditSummary
          account={account}
          balanceCopy={balanceCopy}
          balanceLabel={balanceLabel}
          context={context}
          icon={icon}
          institutionId={institutionId}
          logoMode={logoMode}
          name={name}
        />
        <p className="account-edit-ledger-note">
          <Icon name="info" />
          Account details can be changed here. Record a transaction to adjust the balance.
        </p>
        <div className="account-flow-fields">{renderFields()}</div>
        <button className="btn btn-primary account-flow-save" type="submit">
          <Icon name="save" />
          Save Changes
        </button>
        <button className="btn account-edit-cancel" onClick={onCancel} type="button">
          Cancel
        </button>
      </form>
    </ModalFrame>
  );
}
