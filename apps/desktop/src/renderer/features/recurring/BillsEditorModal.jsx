import { PrivateValue } from '../../shared/PrivateValue.jsx';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';

import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { CavalrySelect } from '../../shared/CavalrySelect.jsx';
import { CavalryIcon, CavalryIconDisc } from '../../shared/CavalryIcon.jsx';
import { FinancialValueInput, formatFinancialValue } from '../../shared/FinancialValueInput.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';
import { CATEGORY_ACTIONS } from '../categories/category-controller.js';

const RECURRING_CATEGORY_TYPES = Object.freeze(['expense', 'debt']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function emit(onAction, type, payload = {}) {
  return typeof onAction === 'function' ? onAction({ type, payload }) : undefined;
}

function StatusPill({ status, tone }) {
  return (
    <PrivateValue as="span" className={`status-pill ${tone || 'info'}`}>
      {status || 'Upcoming'}
    </PrivateValue>
  );
}

export function BillsEditorModal({ initialValues, options, onAction, onClose }) {
  const dismiss = useModalDismiss(() => onClose(true));
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState('');
  const isSubscription = values.kind === 'subscription';
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  function submit(event) {
    event.preventDefault();
    if (!String(values.name || '').trim()) {
      setError('Name is required.');
      return;
    }
    if (!values.categoryId) {
      setError('Pick an expense or debt category.');
      return;
    }
    if (!values.dueDate) {
      setError('Choose a valid due date.');
      return;
    }
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter a valid amount.');
      return;
    }
    const result = emit(onAction, 'save-recurring-item', {
      ...values,
      amount,
      autoRenew: values.autoRenew === true,
      isActive: values.isActive !== false
    });
    if (result && result.ok === false) {
      setError(
        result.errors && result.errors[0]
          ? result.errors[0].message
          : 'The recurring item could not be saved.'
      );
      return;
    }
    onClose(false);
  }

  const content = (
    <div className="modal-backdrop" data-modal-backdrop="true" onMouseDown={dismiss}>
      <PrivateValue
        as="div"
        aria-label={`${values.recurringItemId ? 'Edit' : 'Add'} bill or subscription`}
        aria-modal="true"
        className="modal-card modal-card-wide bill-form-modal"
        role="dialog"
      >
        <div className="bill-form-header">
          <div>
            <PrivateValue as="h3">
              {values.recurringItemId
                ? `Edit ${isSubscription ? 'Subscription' : 'Bill'}`
                : `Add ${isSubscription ? 'Subscription' : 'Bill'}`}
            </PrivateValue>
            <PrivateValue as="p">
              {values.recurringItemId
                ? 'Edit the usual schedule. Changes for specific months stay in place.'
                : isSubscription
                  ? 'Track a recurring service or membership'
                  : 'Create a recurring payment reminder'}
            </PrivateValue>
          </div>
          <button
            aria-label="Close"
            className="btn btn-icon"
            onClick={() => onClose(true)}
            title="Close"
            type="button"
          >
            <CavalryIcon name="close" />
          </button>
        </div>
        <form className="bill-subscription-form" noValidate onSubmit={submit}>
          <div className="bill-kind-toggle">
            <label className={!isSubscription ? 'active' : ''}>
              <input
                checked={!isSubscription}
                name="kind"
                onChange={() => update('kind', 'bill')}
                type="radio"
                value="bill"
              />
              <CavalryIcon name="receipt_long" />
              Bill
            </label>
            <label className={isSubscription ? 'active' : ''}>
              <input
                checked={isSubscription}
                name="kind"
                onChange={() => update('kind', 'subscription')}
                type="radio"
                value="subscription"
              />
              <CavalryIcon name="sync" />
              Subscription
            </label>
          </div>
          {error ? (
            <PrivateValue as="div" className="panel-note status-bad" role="alert">
              {error}
            </PrivateValue>
          ) : null}
          <div className="bill-form-body">
            <div className="bill-form-grid">
              <div className="field">
                <PrivateValue as="label">
                  {isSubscription ? 'Service Name *' : 'Name *'}
                </PrivateValue>
                <input
                  aria-label="Recurring name"
                  name="name"
                  onChange={(event) => update('name', event.currentTarget.value)}
                  type="text"
                  value={values.name || ''}
                />
              </div>
              <div className="field">
                <label>Amount *</label>
                <FinancialValueInput
                  allowNegative={false}
                  aria-label="Recurring amount"
                  min="0"
                  name="amount"
                  onChange={(event) => update('amount', event.currentTarget.value)}
                  value={values.amount || ''}
                />
              </div>
              <div className="field">
                <PrivateValue as="label">
                  {isSubscription ? 'Billing Anchor Date *' : 'Due Date *'}
                </PrivateValue>
                <input
                  aria-label="Recurring due date"
                  name="dueDate"
                  onChange={(event) => update('dueDate', event.currentTarget.value)}
                  type="date"
                  value={values.dueDate || ''}
                />
                {isSubscription ? (
                  <small>
                    Used to calculate each expected charge; it may be a past known date.
                  </small>
                ) : null}
              </div>
              <div className="field">
                <PrivateValue as="label">
                  {isSubscription ? 'Billing Cycle *' : 'Frequency *'}
                </PrivateValue>
                <CavalrySelect
                  aria-label="Recurring frequency"
                  name="frequency"
                  onChange={(event) => update('frequency', event.currentTarget.value)}
                  options={asArray(options.frequencies).map((frequency) => ({
                    value: frequency,
                    label: frequency
                  }))}
                  showLeadingIcon={false}
                  value={values.frequency || 'Monthly'}
                />
              </div>
              <div className="field">
                <label>Category *</label>
                <CategorizedSelect
                  aria-label="Recurring category"
                  createCategoryType="expense"
                  createCategoryTypes={RECURRING_CATEGORY_TYPES}
                  name="categoryId"
                  onChange={(event) => update('categoryId', event.currentTarget.value)}
                  onCreateCategory={(payload) => emit(onAction, CATEGORY_ACTIONS.CREATE, payload)}
                  options={options.categories}
                  placeholder="Select category"
                  value={values.categoryId || ''}
                />
              </div>
              <div className="field">
                <label>Payment Method</label>
                <CavalrySelect
                  aria-label="Recurring payment account"
                  leadingIcon="account_balance_wallet"
                  name="accountId"
                  onChange={(event) => update('accountId', event.currentTarget.value)}
                  options={[
                    { value: '', label: 'Not set', icon: 'select_all' },
                    ...asArray(options.accounts).map((option) => ({
                      value: option.value,
                      label: option.label,
                      icon: option.icon || 'account_balance_wallet'
                    }))
                  ]}
                  placeholder="Not set"
                  value={values.accountId || ''}
                />
              </div>
              {isSubscription ? (
                <label className="bill-auto-renew-toggle bill-form-full">
                  <input
                    checked={values.autoRenew === true}
                    name="autoRenew"
                    onChange={(event) => update('autoRenew', event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <CavalryIcon name="autorenew" />
                  <span>
                    <strong>Auto-renews</strong>
                    <small>Show this as a recurring subscription renewal.</small>
                  </span>
                </label>
              ) : null}
              <div className="field bill-form-full">
                <label>
                  Notes <span className="label-optional">(Optional)</span>
                </label>
                <textarea
                  name="note"
                  onChange={(event) => update('note', event.currentTarget.value)}
                  value={values.note || ''}
                />
              </div>
            </div>
            <aside className="bill-preview-panel">
              <span className="tag">Preview</span>
              <div className="bill-preview-row">
                <CavalryIconDisc
                  className={`mini-icon ${isSubscription ? 'info' : 'warn'}`}
                  name={isSubscription ? 'sync' : 'receipt_long'}
                />
                <span>
                  <PrivateValue as="strong">
                    {values.name || (isSubscription ? 'Netflix' : 'Internet')}
                  </PrivateValue>
                  <PrivateValue as="small">{values.frequency || 'Monthly'}</PrivateValue>
                </span>
              </div>
              <div className="bill-preview-details">
                <PrivateValue as="span">{values.dueDate || 'Due date'}</PrivateValue>
                <PrivateValue as="b" className="amount neutral">
                  {formatFinancialValue(values.amount || 0)} {values.currency || options.currency}
                </PrivateValue>
              </div>
              <div className="bill-preview-footer">
                <StatusPill status="Upcoming" tone="warn" />
              </div>
            </aside>
          </div>
          <div className="bill-form-footer">
            <label className="bill-active-toggle">
              <input
                checked={values.isActive !== false}
                name="isActive"
                onChange={(event) => update('isActive', event.currentTarget.checked)}
                type="checkbox"
              />
              <span>
                <strong>Active</strong>
                <small>Inactive items stay saved but stay out of Due Next.</small>
              </span>
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => onClose(true)} type="button">
                Cancel
              </button>
              <PrivateValue as="button" className="btn btn-primary" type="submit">
                Save {isSubscription ? 'Subscription' : 'Bill'}
              </PrivateValue>
            </div>
          </div>
        </form>
      </PrivateValue>
    </div>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
