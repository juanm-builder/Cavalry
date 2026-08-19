import React, { useState } from 'react';
import { createPortal } from 'react-dom';

import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
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
  return <span className={`status-pill ${tone || 'info'}`}>{status || 'Upcoming'}</span>;
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
      <div
        aria-label={`${values.recurringItemId ? 'Edit' : 'Add'} bill or subscription`}
        aria-modal="true"
        className="modal-card modal-card-wide bill-form-modal"
        role="dialog"
      >
        <div className="bill-form-header">
          <div>
            <h3>
              {values.recurringItemId
                ? `Edit ${isSubscription ? 'Subscription' : 'Bill'}`
                : `Add ${isSubscription ? 'Subscription' : 'Bill'}`}
            </h3>
            <p>
              {isSubscription
                ? 'Track a recurring service or membership'
                : 'Create a recurring payment reminder'}
            </p>
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
            <div className="panel-note status-bad" role="alert">
              {error}
            </div>
          ) : null}
          <div className="bill-form-body">
            <div className="bill-form-grid">
              <div className="field">
                <label>{isSubscription ? 'Service Name *' : 'Name *'}</label>
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
                <label>{isSubscription ? 'Billing Anchor Date *' : 'Due Date *'}</label>
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
                <label>{isSubscription ? 'Billing Cycle *' : 'Frequency *'}</label>
                <select
                  aria-label="Recurring frequency"
                  name="frequency"
                  onChange={(event) => update('frequency', event.currentTarget.value)}
                  value={values.frequency || 'Monthly'}
                >
                  {asArray(options.frequencies).map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {frequency}
                    </option>
                  ))}
                </select>
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
                <select
                  aria-label="Recurring payment account"
                  name="accountId"
                  onChange={(event) => update('accountId', event.currentTarget.value)}
                  value={values.accountId || ''}
                >
                  <option value="">Not set</option>
                  {asArray(options.accounts).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
                <CavalryIcon
                  className={`mini-icon ${isSubscription ? 'info' : 'warn'}`}
                  name={isSubscription ? 'sync' : 'receipt_long'}
                />
                <span>
                  <strong>{values.name || (isSubscription ? 'Netflix' : 'Internet')}</strong>
                  <small>{values.frequency || 'Monthly'}</small>
                </span>
              </div>
              <div className="bill-preview-details">
                <span>{values.dueDate || 'Due date'}</span>
                <b className="amount neutral">
                  {formatFinancialValue(values.amount || 0)} {values.currency || options.currency}
                </b>
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
              <button className="btn btn-primary" type="submit">
                Save {isSubscription ? 'Subscription' : 'Bill'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
