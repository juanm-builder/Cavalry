import React, { useMemo, useRef, useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { CavalrySelect } from '../../shared/CavalrySelect.jsx';

import { submitNotesBatchCommand } from './notes-controller.js';
import { parseNotesWithAi } from './notes-ai-parser.js';
import { isCreditCardAccount, paymentLabel, resolveNotesEntry } from './notes-parser.js';

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

function ReviewEditor({ entry, workbook, onCancel, onChange, onRemove, onSave }) {
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

  return (
    <div className="notes-review-editor">
      <div className="notes-editor-grid">
        <div className="field notes-editor-description">
          <label htmlFor={`${entry.id}-description`}>Description</label>
          <input
            id={`${entry.id}-description`}
            onChange={(event) => onChange('description', event.target.value)}
            type="text"
            value={entry.description}
          />
        </div>
        <div className="field">
          <label htmlFor={`${entry.id}-amount`}>Amount</label>
          <input
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
            id={`${entry.id}-date`}
            onChange={(event) => onChange('date', event.target.value)}
            type="date"
            value={entry.date}
          />
        </div>
        {needsFxRate ? (
          <div className="field">
            <label htmlFor={`${entry.id}-fx-rate`}>
              {entry.currency} to {workbookCurrency} rate
            </label>
            <input
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
        <ul aria-label={`Line ${entry.lineNumber} issues`} className="notes-editor-issues">
          {entry.issues.map((item) => (
            <li key={`${item.code}:${item.field}`}>{item.message}</li>
          ))}
        </ul>
      ) : null}
      {entry.issues.some((item) => item.code === 'possible_duplicate_transaction') ? (
        <label className="notes-duplicate-approval">
          <input
            checked={entry.allowDuplicate === true}
            onChange={(event) => onChange('allowDuplicate', event.target.checked)}
            type="checkbox"
          />
          Save it even though it looks like a duplicate
        </label>
      ) : null}

      <div className="notes-editor-actions">
        <button className="btn notes-remove-button" onClick={onRemove} type="button">
          <Icon name="delete" />
          Remove
        </button>
        <span />
        <button className="btn" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onSave} type="button">
          Done
        </button>
      </div>
    </div>
  );
}

function ReviewEntry({
  entry,
  isEditing,
  editingEntry,
  workbook,
  onEdit,
  onEditChange,
  onEditCancel,
  onEditSave,
  onRemove
}) {
  const amountTone = entry.template === 'income_received' ? 'good' : 'bad';
  const amountDirection = amountTone === 'good' ? 'Income' : 'Expense';
  const amountSign = amountTone === 'good' ? '+' : '−';
  return (
    <article
      className={`notes-review-entry${entry.issues.length ? ' needs-review' : ''}${isEditing ? ' is-editing' : ''}`}
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
          <strong>{entry.categoryName}</strong>
          <small>{entry.description}</small>
        </span>
        <strong
          aria-label={`${amountDirection} ${formatAmount(entry.amount, entry.currency)}`}
          className={`notes-entry-amount ${amountTone}`}
        >
          {amountSign}
          {formatAmount(Math.abs(Number(entry.amount) || 0), entry.currency)}
        </strong>
        <span className="notes-payment-pill">{entry.paymentLabel}</span>
        {entry.issues.length ? (
          <span className="notes-review-badge">
            <Icon name="error" />
            Needs review
          </span>
        ) : (
          <span aria-label="Ready" className="notes-ready-mark" title="Ready">
            <Icon name="check_circle" />
          </span>
        )}
        <button
          aria-expanded={isEditing}
          aria-label={`Edit line ${entry.lineNumber}`}
          className="notes-edit-button"
          onClick={() => onEdit(entry)}
          type="button"
        >
          <Icon name={isEditing ? 'expand_less' : 'edit'} />
        </button>
      </div>
      {isEditing ? (
        <ReviewEditor
          entry={editingEntry}
          onCancel={onEditCancel}
          onChange={onEditChange}
          onRemove={() => onRemove(entry.id)}
          onSave={onEditSave}
          workbook={workbook}
        />
      ) : null}
    </article>
  );
}

function initialText(workbookId) {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  try {
    return window.localStorage.getItem(`cavalry.notes.${workbookId || 'workbook'}`) || '';
  } catch (_error) {
    return '';
  }
}

function persistText(workbookId, value) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const key = `cavalry.notes.${workbookId || 'workbook'}`;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch (_error) {
    // Notes remain usable when browser storage is unavailable.
  }
}

export function NotesRoute({ advisor, workbook = {}, services = {}, onAction, onCommandResult }) {
  const [text, setText] = useState(() => initialText(workbook.id));
  const [entries, setEntries] = useState([]);
  const [editingEntry, setEditingEntry] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [canConfigureAi, setCanConfigureAi] = useState(false);
  const processRequest = useRef(0);
  const lines = useMemo(() => text.split(/\r?\n/).filter((line) => line.trim()).length, [text]);
  const unresolvedCount = entries.filter((entry) => entry.issues.length).length;
  const readyToSave = entries.length > 0 && unresolvedCount === 0 && !editingEntry && !processing;

  const updateText = (value) => {
    processRequest.current += 1;
    setText(value);
    persistText(workbook.id, value);
    setEntries([]);
    setEditingEntry(null);
    setNotice('');
    setError('');
    setCanConfigureAi(false);
  };
  const processTransactions = async () => {
    if (!lines || processing) return;
    const request = processRequest.current + 1;
    processRequest.current = request;
    setProcessing(true);
    setEntries([]);
    setEditingEntry(null);
    setNotice('');
    setError('');
    setCanConfigureAi(false);
    try {
      const result = await parseNotesWithAi(text, workbook, {
        advisor,
        createId: services.createId,
        today: services.today || services.defaultDate
      });
      if (processRequest.current !== request) return;
      setEntries(result.entries);
      setNotice(result.notice || '');
      setCanConfigureAi(result.canConfigure === true);
      setError(result.entries.length ? '' : 'Enter at least one transaction to process.');
    } catch (_error) {
      if (processRequest.current !== request) return;
      setError('Cavalry could not process these notes. Try again.');
    } finally {
      if (processRequest.current === request) setProcessing(false);
    }
  };
  const clearNotes = () => {
    updateText('');
    setEntries([]);
    setEditingEntry(null);
    setNotice('');
    setError('');
    setCanConfigureAi(false);
  };
  const saveEdit = () => {
    if (!editingEntry) return;
    const resolved = resolveNotesEntry(workbook, editingEntry, { manuallyReviewed: true });
    const duplicateIssue = editingEntry.issues.find(
      (item) => item.code === 'possible_duplicate_transaction'
    );
    if (duplicateIssue && editingEntry.allowDuplicate !== true) {
      resolved.issues = [...resolved.issues, duplicateIssue];
    }
    setEntries((current) => current.map((entry) => (entry.id === resolved.id ? resolved : entry)));
    if (resolved.issues.length) {
      setEditingEntry(resolved);
      return;
    }
    setEditingEntry(null);
    setNotice('');
  };
  const removeEntry = (entryId) => {
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    setEditingEntry(null);
    setNotice('Transaction removed from this batch.');
  };
  const saveTransactions = () => {
    if (!readyToSave) return;
    const result = submitNotesBatchCommand(workbook, entries, services);
    if (!result.ok) {
      const saveIssue = result.errors?.[0];
      if (
        saveIssue?.code === 'possible_duplicate_transaction' &&
        Number(saveIssue.lineNumber) > 0
      ) {
        setEntries((current) =>
          current.map((entry) =>
            entry.lineNumber === Number(saveIssue.lineNumber)
              ? {
                  ...entry,
                  issues: [
                    {
                      code: saveIssue.code,
                      field: 'allowDuplicate',
                      message: saveIssue.message || 'This may already be in your records.'
                    }
                  ]
                }
              : entry
          )
        );
      }
      setError(saveIssue?.message || 'The transactions could not be saved.');
      return;
    }
    onCommandResult?.(result);
    const savedCount = result.count || entries.length;
    setText('');
    persistText(workbook.id, '');
    setEntries([]);
    setEditingEntry(null);
    setError('');
    setCanConfigureAi(false);
    setNotice(`${savedCount} transaction${savedCount === 1 ? '' : 's'} saved to your records.`);
  };

  return (
    <section className="notes-route" data-react-route="notes">
      <header className="notes-page-header">
        <div>
          <h1>Notes</h1>
        </div>
        <button
          className="btn notes-clear-button"
          disabled={processing || (!text && !entries.length)}
          onClick={clearNotes}
          type="button"
        >
          <Icon name="delete" />
          Clear notes
        </button>
      </header>

      {notice || error ? (
        <div
          aria-live="polite"
          className={`notes-route-notice${error ? ' is-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          <Icon name={error ? 'error' : notice.includes('saved') ? 'check_circle' : 'info'} />
          <span>{error || notice}</span>
          {!error && canConfigureAi ? (
            <button
              onClick={() =>
                onAction?.({ type: 'route/navigate', payload: { routeId: 'settings' } })
              }
              type="button"
            >
              Open AI settings
            </button>
          ) : !error && notice.includes('saved') ? (
            <button
              onClick={() => onAction?.({ type: 'route/navigate', payload: { routeId: 'ledger' } })}
              type="button"
            >
              View transactions
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="notes-workspace">
        <section className="notes-panel notes-entry-panel">
          <header>
            <div>
              <h2>Quick entry</h2>
            </div>
            <span className="notes-ai-badge">
              <Icon name="auto_awesome" />
              Cavalry AI
            </span>
          </header>
          <label className="notes-textarea-label" htmlFor="notes-quick-entry">
            Transaction notes
          </label>
          <textarea
            autoCapitalize="sentences"
            id="notes-quick-entry"
            disabled={processing}
            onChange={(event) => updateText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void processTransactions();
              }
            }}
            placeholder={
              '₱1,000 transportation credit card\n₱180 coffee cash\n₱2,450 groceries debit'
            }
            spellCheck="true"
            value={text}
          />
          <footer className="notes-panel-footer">
            <span>
              {processing
                ? 'Cavalry AI is reading your notes…'
                : lines
                  ? `${lines} line${lines === 1 ? '' : 's'} ready to process`
                  : 'Start with an amount, category, and payment method'}
            </span>
            <button
              className="btn btn-primary notes-process-button"
              disabled={!lines || processing}
              onClick={() => void processTransactions()}
              type="button"
            >
              <Icon name="auto_awesome" />
              {processing ? 'Processing…' : 'Process transactions'}
            </button>
          </footer>
        </section>

        <section className="notes-panel notes-review-panel">
          <header>
            <div>
              <h2>Review transactions</h2>
            </div>
            {entries.length ? (
              <span
                className={
                  unresolvedCount ? 'notes-review-count needs-review' : 'notes-review-count'
                }
              >
                {unresolvedCount
                  ? `${unresolvedCount} need${unresolvedCount === 1 ? 's' : ''} review`
                  : 'All ready'}
              </span>
            ) : null}
          </header>
          <div className="notes-review-list">
            {entries.length ? (
              entries.map((entry) => (
                <ReviewEntry
                  key={entry.id}
                  editingEntry={editingEntry}
                  entry={entry}
                  isEditing={editingEntry?.id === entry.id}
                  onEdit={(selected) =>
                    setEditingEntry(editingEntry?.id === selected.id ? null : { ...selected })
                  }
                  onEditCancel={() => setEditingEntry(null)}
                  onEditChange={(field, value) =>
                    setEditingEntry((current) => ({ ...current, [field]: value }))
                  }
                  onEditSave={saveEdit}
                  onRemove={removeEntry}
                  workbook={workbook}
                />
              ))
            ) : (
              <div className="notes-review-empty">
                <span>
                  <Icon name="receipt_long" />
                </span>
                <strong>Your review will appear here</strong>
              </div>
            )}
          </div>
          <footer className="notes-panel-footer notes-save-footer">
            {entries.length ? (
              <span>
                {unresolvedCount
                  ? `Resolve ${unresolvedCount} item${unresolvedCount === 1 ? '' : 's'} before saving`
                  : `${entries.length} transaction${entries.length === 1 ? '' : 's'} ready`}
              </span>
            ) : (
              <span>Nothing will be saved until you confirm the batch</span>
            )}
            <button
              className="btn btn-primary notes-save-button"
              disabled={!readyToSave}
              onClick={saveTransactions}
              type="button"
            >
              <Icon name="check" />
              {entries.length
                ? `Save ${entries.length} transaction${entries.length === 1 ? '' : 's'}`
                : 'Save transactions'}
            </button>
          </footer>
        </section>
      </div>
    </section>
  );
}
