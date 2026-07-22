import React, { useState } from 'react';

import { findInstitutionById } from '@cavalry/finance-core';

import {
  ACCOUNT_TYPE_OPTIONS,
  AmountField,
  CARD_NETWORK_OPTIONS,
  CreditSummary,
  CURRENCY_OPTIONS,
  DAY_OPTIONS,
  Icon,
  InstitutionField,
  INVESTMENT_TYPE_OPTIONS,
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

export function AccountCreateWizard({ defaultDate, defaultCurrency, error, onCancel, onSubmit }) {
  const [step, setStep] = useState('type');
  const [typeId, setTypeId] = useState('');
  const [name, setName] = useState('');
  const [autoName, setAutoName] = useState('');
  const [institution, setInstitution] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  const [customInstitution, setCustomInstitution] = useState(false);
  const [currency, setCurrency] = useState(defaultCurrency || 'PHP');
  const [openedDate, setOpenedDate] = useState(defaultDate || '');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [note, setNote] = useState('');
  const [details, setDetails] = useState(createDefaultDetails);
  const selectedType = ACCOUNT_TYPE_OPTIONS.find((option) => option.id === typeId);

  function chooseType(option) {
    if (option.disabled) return;
    const changingType = Boolean(typeId && typeId !== option.id);
    let nextName = name;
    if (changingType) {
      if (autoName && name === autoName) nextName = '';
      setInstitution('');
      setInstitutionId('');
      setCustomInstitution(false);
      setDetails(createDefaultDetails());
      setAutoName('');
    }

    if (option.id === 'wallet' && (!typeId || changingType)) {
      setInstitution('GCash');
      setInstitutionId('gcash');
      if (!nextName) {
        nextName = 'GCash';
        setAutoName('GCash');
      }
    } else if (option.id === 'credit_card' && (!typeId || changingType)) {
      setInstitution('BDO');
      setInstitutionId('bdo');
      if (!nextName) {
        nextName = 'BDO Credit Card';
        setAutoName('BDO Credit Card');
      }
    }

    setName(nextName);
    setTypeId(option.id);
    setStep('details');
  }

  function setDetail(key, value) {
    setDetails((current) => ({ ...current, [key]: value }));
  }

  function setInstitutionValue(next) {
    setInstitution(next.institution);
    setInstitutionId(next.institutionId);
  }

  function editName(value) {
    setName(value);
    setAutoName('');
  }

  function chooseQuickInstitution(providerId) {
    const provider = findInstitutionById(providerId);
    if (!provider) return;
    const suggested =
      typeId === 'credit_card' ? `${provider.shortName} Credit Card` : provider.shortName;
    const shouldSuggest = !name || name === autoName;
    setInstitution(provider.shortName);
    setInstitutionId(provider.id);
    setCustomInstitution(false);
    if (shouldSuggest) {
      setName(suggested);
      setAutoName(suggested);
    }
  }

  function chooseOtherInstitution() {
    setInstitution('');
    setInstitutionId('');
    setCustomInstitution(true);
    if (autoName && name === autoName) setName('');
    setAutoName('');
  }

  function payload() {
    return {
      name,
      group: selectedType.group,
      subtype: selectedType.subtype,
      institution,
      institutionId,
      currency,
      openedDate,
      openingBalance,
      note,
      details: accountDetailsFor(selectedType.id, details)
    };
  }

  function renderBankFields() {
    const accountTypeLabel =
      details.bankAccountType === 'checking'
        ? 'Checking'
        : details.bankAccountType === 'other'
          ? 'Account'
          : 'Savings';
    const suggestion = institution ? `${institution} ${accountTypeLabel}` : '';
    return (
      <>
        <TextField
          icon="person"
          id="create-account-name"
          label="Account name"
          onChange={editName}
          placeholder="e.g., BDO Savings"
          required
          value={name}
        />
        {suggestion && suggestion !== name ? (
          <div className="account-name-suggestion">
            <span>
              <Icon name="auto_awesome" />
              Suggestion: {suggestion}
            </span>
            <button onClick={() => setName(suggestion)} type="button">
              Use
            </button>
          </div>
        ) : null}
        <InstitutionField
          id="create-account-institution"
          institution={institution}
          institutionId={institutionId}
          label="Bank"
          onChange={setInstitutionValue}
          placeholder="Search or choose bank"
          required
          subtype="bank"
        />
        <div className="account-flow-grid account-flow-bank-row">
          <SegmentedField
            label="Account type"
            name="bank-account-type"
            onChange={(value) => setDetail('bankAccountType', value)}
            options={[
              ['savings', 'Savings'],
              ['checking', 'Checking'],
              ['other', 'Other']
            ]}
            value={details.bankAccountType}
          />
          <SelectField
            id="create-account-currency"
            label="Currency"
            onChange={setCurrency}
            options={CURRENCY_OPTIONS}
            required
            value={currency}
          />
        </div>
        <AmountField
          currency={currency}
          id="create-account-balance"
          label="Starting balance"
          onChange={setOpeningBalance}
          required
          value={openingBalance}
        />
        <TextField
          id="create-account-opened"
          label="Balance as of"
          onChange={setOpenedDate}
          required
          type="date"
          value={openedDate}
        />
        <OptionalDetails>
          <div className="account-flow-grid account-flow-grid-3">
            <TextField
              id="create-account-number"
              inputMode="numeric"
              label="Account number (last 4 digits)"
              maxLength={4}
              onChange={(value) => setDetail('accountNumber', value.replace(/\D/g, ''))}
              placeholder="e.g., 9012"
              value={details.accountNumber}
            />
            <TextField
              id="create-bank-interest-rate"
              inputMode="decimal"
              label="Interest rate (p.a.)"
              onChange={(value) => setDetail('interestRate', value)}
              pattern="[0-9]*([.][0-9]{0,2})?"
              placeholder="e.g., 1.50"
              value={details.interestRate}
            />
            <TextField
              id="create-bank-branch"
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
          id="create-account-name"
          label="Cash account name"
          onChange={editName}
          placeholder="e.g., Wallet, Petty Cash"
          required
          value={name}
        />
        <AmountField
          currency={currency}
          id="create-account-balance"
          label="Starting balance"
          onChange={setOpeningBalance}
          required
          value={openingBalance}
        />
        <TextField
          id="create-account-opened"
          label="Balance as of"
          onChange={setOpenedDate}
          required
          type="date"
          value={openedDate}
        />
        <OptionalDetails description="Add location or notes if you want. This is optional.">
          <TextField
            id="create-cash-location"
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
          options={['gcash', 'mayawallet', 'grabpay', 'shopeepay']}
          otherSelected={customInstitution}
        />
        {customInstitution ? (
          <InstitutionField
            id="create-account-institution"
            institution={institution}
            institutionId={institutionId}
            label="Provider name"
            onChange={setInstitutionValue}
            placeholder="Search or enter e-wallet provider"
            required
            subtype="wallet"
          />
        ) : null}
        <TextField
          help="You can edit this name if you want."
          icon="account_balance_wallet"
          id="create-account-name"
          label="E-wallet name"
          onChange={editName}
          placeholder="e.g., My E-Wallet"
          required
          value={name}
        />
        <div className="account-flow-grid account-flow-grid-2">
          <AmountField
            currency={currency}
            id="create-account-balance"
            label="Starting balance"
            onChange={setOpeningBalance}
            required
            value={openingBalance}
          />
          <TextField
            id="create-account-opened"
            label="Balance as of"
            onChange={setOpenedDate}
            required
            type="date"
            value={openedDate}
          />
        </div>
        <OptionalDetails>
          <div className="account-flow-grid account-flow-grid-2">
            <TextField
              id="create-wallet-mobile"
              label="Mobile number"
              onChange={(value) => setDetail('mobileNumber', value)}
              placeholder="e.g., 0917 123 4567"
              value={details.mobileNumber}
            />
            <TextField
              id="create-wallet-email"
              label="Email"
              onChange={(value) => setDetail('email', value)}
              placeholder="e.g., name@email.com"
              type="email"
              value={details.email}
            />
          </div>
          <TextField
            id="create-wallet-reference"
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
          options={['bdo', 'bpi', 'metrobank', 'hsbc']}
          otherSelected={customInstitution}
        />
        {customInstitution ? (
          <InstitutionField
            id="create-account-institution"
            institution={institution}
            institutionId={institutionId}
            label="Issuer name"
            onChange={setInstitutionValue}
            placeholder="Search or enter card issuer"
            required
            subtype="credit_card"
          />
        ) : null}
        <TextField
          help="You can edit this name if you want."
          icon="credit_card"
          id="create-account-name"
          label="Card name"
          onChange={editName}
          placeholder="e.g., BPI Credit Card"
          required
          value={name}
        />
        <div className="account-flow-grid account-flow-grid-2">
          <AmountField
            currency={currency}
            help="0.00 if fully paid"
            id="create-account-balance"
            label="Current balance owed"
            onChange={setOpeningBalance}
            required
            value={openingBalance}
          />
          <AmountField
            currency={currency}
            id="create-credit-limit"
            label="Credit limit"
            onChange={(value) => setDetail('creditLimit', value)}
            required
            value={details.creditLimit}
          />
        </div>
        <CreditSummary balance={openingBalance} currency={currency} limit={details.creditLimit} />
        <TextField
          id="create-account-opened"
          label="Balance as of"
          onChange={setOpenedDate}
          required
          type="date"
          value={openedDate}
        />
        <OptionalDetails
          defaultOpen
          description="Add more details about your card. You can fill these in later."
        >
          <div className="account-flow-grid account-flow-grid-3">
            <SelectField
              id="create-card-network"
              label="Card network"
              onChange={(value) => setDetail('cardNetwork', value)}
              options={CARD_NETWORK_OPTIONS}
              placeholder="Select network"
              value={details.cardNetwork}
            />
            <TextField
              help="Enter only the last 4 digits."
              id="create-card-number"
              inputMode="numeric"
              label="Card number (last 4 digits)"
              maxLength={4}
              onChange={(value) => setDetail('accountNumber', value.replace(/\D/g, ''))}
              placeholder="e.g., 1234"
              value={details.accountNumber}
            />
            <TextField
              id="create-card-interest-rate"
              inputMode="decimal"
              label="Interest rate (p.a.)"
              onChange={(value) => setDetail('interestRate', value)}
              pattern="[0-9]*([.][0-9]{0,2})?"
              placeholder="e.g., 18.00"
              value={details.interestRate}
            />
            <AmountField
              currency={currency}
              id="create-card-annual-fee"
              label="Annual fee"
              onChange={(value) => setDetail('annualFee', value)}
              value={details.annualFee}
            />
            <SelectField
              id="create-card-billing-day"
              label="Billing day"
              onChange={(value) => setDetail('billingDay', value)}
              options={DAY_OPTIONS}
              placeholder="Select day…"
              value={details.billingDay}
            />
            <SelectField
              id="create-card-due-day"
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
        <InstitutionField
          id="create-account-institution"
          institution={institution}
          institutionId={institutionId}
          label="Platform / Broker"
          onChange={setInstitutionValue}
          placeholder="Search platform, broker, bank, or custodian"
          required
          subtype="investment"
        />
        <TextField
          icon="trending_up"
          id="create-account-name"
          label="Investment name"
          onChange={editName}
          placeholder="e.g., Long-term Portfolio"
          required
          value={name}
        />
        <AmountField
          currency={currency}
          id="create-account-balance"
          label="Current market value"
          onChange={setOpeningBalance}
          required
          value={openingBalance}
        />
        <TextField
          id="create-account-opened"
          label="Valuation date"
          onChange={setOpenedDate}
          required
          type="date"
          value={openedDate}
        />
        <OptionalDetails>
          <div className="account-flow-grid account-flow-grid-2">
            <SelectField
              id="create-investment-type"
              label="Investment type"
              onChange={(value) => setDetail('investmentType', value)}
              options={INVESTMENT_TYPE_OPTIONS}
              placeholder="Select type…"
              value={details.investmentType}
            />
            <TextField
              id="create-investment-reference"
              label="Account ID / Reference"
              onChange={(value) => setDetail('accountReference', value)}
              value={details.accountReference}
            />
            <AmountField
              currency={currency}
              id="create-investment-cost-basis"
              label="Cost basis"
              onChange={(value) => setDetail('costBasis', value)}
              value={details.costBasis}
            />
            <AmountField
              currency={currency}
              id="create-investment-contribution"
              label="Monthly contribution"
              onChange={(value) => setDetail('monthlyContribution', value)}
              value={details.monthlyContribution}
            />
          </div>
          <NoteField note={note} setNote={setNote} />
        </OptionalDetails>
      </>
    );
  }

  function renderLiabilityFields() {
    return (
      <>
        <InstitutionField
          id="create-account-institution"
          institution={institution}
          institutionId={institutionId}
          label="Lender / Institution"
          onChange={setInstitutionValue}
          placeholder="Search lender or financial institution"
          required
          subtype="loan"
        />
        <TextField
          icon="request_quote"
          id="create-account-name"
          label="Liability name"
          onChange={editName}
          placeholder="e.g., Auto Loan"
          required
          value={name}
        />
        <div className="account-flow-grid account-flow-grid-2">
          <AmountField
            currency={currency}
            id="create-account-balance"
            label="Outstanding balance"
            onChange={setOpeningBalance}
            required
            value={openingBalance}
          />
          <TextField
            id="create-account-opened"
            label="Balance as of"
            onChange={setOpenedDate}
            required
            type="date"
            value={openedDate}
          />
        </div>
        <OptionalDetails>
          <div className="account-flow-grid account-flow-grid-3">
            <SelectField
              id="create-liability-type"
              label="Liability type"
              onChange={(value) => setDetail('loanType', value)}
              options={LIABILITY_TYPE_OPTIONS}
              placeholder="Select type…"
              value={details.loanType}
            />
            <AmountField
              currency={currency}
              id="create-liability-original-balance"
              label="Original balance"
              onChange={(value) => setDetail('originalBalance', value)}
              value={details.originalBalance}
            />
            <TextField
              id="create-liability-interest-rate"
              inputMode="decimal"
              label="Interest rate (p.a.)"
              onChange={(value) => setDetail('interestRate', value)}
              pattern="[0-9]*([.][0-9]{0,2})?"
              placeholder="e.g., 6.50"
              value={details.interestRate}
            />
            <AmountField
              currency={currency}
              id="create-liability-payment"
              label="Monthly payment"
              onChange={(value) => setDetail('monthlyPayment', value)}
              value={details.monthlyPayment}
            />
            <SelectField
              id="create-liability-due-day"
              label="Payment due day"
              onChange={(value) => setDetail('paymentDueDay', value)}
              options={DAY_OPTIONS}
              placeholder="Select day…"
              value={details.paymentDueDay}
            />
            <TextField
              id="create-liability-maturity"
              label="Maturity / End date"
              onChange={(value) => setDetail('maturityDate', value)}
              type="date"
              value={details.maturityDate}
            />
          </div>
          <TextField
            id="create-liability-reference"
            label="Account ID / Reference"
            onChange={(value) => setDetail('accountReference', value)}
            value={details.accountReference}
          />
          <NoteField note={note} setNote={setNote} />
        </OptionalDetails>
      </>
    );
  }

  function renderFields() {
    if (selectedType.id === 'bank') return renderBankFields();
    if (selectedType.id === 'cash') return renderCashFields();
    if (selectedType.id === 'wallet') return renderWalletFields();
    if (selectedType.id === 'credit_card') return renderCreditCardFields();
    if (selectedType.id === 'investment') return renderInvestmentFields();
    return renderLiabilityFields();
  }

  if (step === 'type') {
    return (
      <ModalFrame
        className="account-type-picker-modal"
        error={error}
        onCancel={onCancel}
        title="Add Account"
      >
        <p className="account-modal-intro">Choose the type of account you want to add.</p>
        <div className="account-type-option-list">
          {ACCOUNT_TYPE_OPTIONS.map((option) => (
            <button
              aria-disabled={option.disabled || undefined}
              className={`account-type-option${option.disabled ? ' is-coming-soon' : ''}`}
              disabled={option.disabled}
              key={option.id}
              onClick={() => chooseType(option)}
              style={{ '--account-option-accent': option.accent }}
              type="button"
            >
              <Icon className="mini-icon" name={option.icon} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {option.disabled ? (
                <span className="account-coming-soon-pill">Coming soon</span>
              ) : (
                <Icon name="chevron_right" />
              )}
            </button>
          ))}
        </div>
      </ModalFrame>
    );
  }

  return (
    <ModalFrame
      className={`account-flow-modal account-flow-${selectedType.id}`}
      error={error}
      onBack={() => setStep('type')}
      onCancel={onCancel}
      title={selectedType.title}
    >
      <form
        className="account-flow-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(payload());
        }}
        style={{ '--account-accent': selectedType.accent }}
      >
        <TypeBadge option={selectedType} />
        <div className="account-flow-fields">{renderFields()}</div>
        <button className="btn btn-primary account-flow-save" type="submit">
          <Icon name="save" />
          Save Account
        </button>
        {selectedType.id === 'wallet' ? (
          <p className="account-flow-privacy">
            <Icon name="lock" />
            Your data stays private and secure.
          </p>
        ) : null}
      </form>
    </ModalFrame>
  );
}
