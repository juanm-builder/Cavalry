import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { CavalrySelect } from '../../shared/CavalrySelect.jsx';

import { submitNotesBatchCommand } from './notes-controller.js';
import { parseNotesWithAi } from './notes-ai-parser.js';
import {
  isCreditCardAccount,
  paymentLabel,
  resolveNotesEntry,
  validateNotesEntry
} from './notes-parser.js';

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

function ReviewEditor({ entry, workbook, onCancel, onChange, onSave }) {
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
            <label htmlFor={`${entry.id}-fx-rate`}>
              {entry.currency} to {workbookCurrency} rate
            </label>
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
        <ul aria-label={`Line ${entry.lineNumber} issues`} className="notes-editor-issues">
          {entry.issues.map((item, index) => (
            <li id={`${entry.id}-issue-${index}`} key={`${item.code}:${item.field}`}>
              {item.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="notes-editor-actions">
        <span />
        <button className="btn" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onSave} type="button">
          Save changes
        </button>
      </div>
    </div>
  );
}

function ReviewEntry({
  entry,
  position,
  isEditing,
  editingEntry,
  workbook,
  onEdit,
  onEditChange,
  onEditCancel,
  onEditSave
}) {
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
        <button
          aria-expanded={isEditing}
          aria-label={`Edit transaction ${position}: ${entry.description}`}
          className="notes-edit-button"
          id={`notes-edit-${entry.id}`}
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

function entriesStorageKey(workbookId) {
  return `cavalry.notes.entries.${workbookId || 'workbook'}`;
}

function transactionFingerprint(transaction) {
  if (!transaction) return '';
  return JSON.stringify(transaction);
}

function transactionPrimaryAccountId(workbook, transaction) {
  const accountsById = new Map(
    asArray(workbook && workbook.accounts).map((account) => [asString(account?.id), account])
  );
  const template = asString(transaction?.template);
  const direction = template === 'income_received' ? 'debit' : 'credit';
  const group = template === 'expense_charged' ? 'liability' : 'asset';
  const line = asArray(transaction?.lines).find((candidate) => {
    const account = accountsById.get(asString(candidate?.accountId));
    return candidate?.direction === direction && account?.group === group;
  });
  return asString(line?.accountId);
}

function entryFromTransaction(workbook, transaction, priorEntry = {}) {
  const entry = {
    ...priorEntry,
    id: asString(priorEntry.id) || `notes-transaction-${asString(transaction.id)}`,
    lineNumber: Number(priorEntry.lineNumber) || 1,
    sourceText: asString(priorEntry.sourceText) || asString(transaction.description),
    amount: Number(transaction.amount) || 0,
    currency:
      asString(
        transaction.originalCurrency || transaction.currency || workbook.currency
      ).toUpperCase() || 'PHP',
    fxRateToBase: Number(transaction.fxRateToBase) || 0,
    date: asString(transaction.date),
    description: asString(transaction.description),
    categoryId: asString(transaction.categoryId),
    primaryAccountId: transactionPrimaryAccountId(workbook, transaction),
    template: asString(transaction.template),
    counterpartyId: asString(transaction.counterpartyId),
    transactionNote: asString(transaction.note),
    transactionId: asString(transaction.id),
    transactionFingerprint: transactionFingerprint(transaction),
    issues: []
  };
  return { ...resolveNotesEntry(workbook, entry), issues: [] };
}

function reconcileEntries(workbook, entries) {
  const transactionsById = new Map(
    asArray(workbook && workbook.transactions).map((transaction) => [
      asString(transaction?.id),
      transaction
    ])
  );
  return asArray(entries)
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || !asString(entry.id)) return null;
      const transactionId = asString(entry.transactionId);
      if (transactionId) {
        const transaction = transactionsById.get(transactionId);
        return transaction ? entryFromTransaction(workbook, transaction, entry) : null;
      }
      const resolved = resolveNotesEntry(workbook, entry);
      return { ...resolved, transactionId: '', issues: validateNotesEntry(workbook, resolved) };
    })
    .filter(Boolean);
}

function initialEntries(workbook) {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(entriesStorageKey(workbook.id)) || '[]');
    return reconcileEntries(workbook, parsed);
  } catch (_error) {
    return [];
  }
}

function persistEntries(workbookId, entries) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const key = entriesStorageKey(workbookId);
  try {
    const listedEntries = asArray(entries);
    if (listedEntries.length) window.localStorage.setItem(key, JSON.stringify(listedEntries));
    else window.localStorage.removeItem(key);
  } catch (_error) {
    // The current list remains available for this session when storage is unavailable.
  }
}

export function NotesRoute({ advisor, workbook = {}, services = {}, onAction, onCommandResult }) {
  const workbookId = asString(workbook.id) || 'workbook';
  const [text, setText] = useState(() => initialText(workbook.id));
  const [entries, setEntries] = useState(() => initialEntries(workbook));
  const [editingEntry, setEditingEntry] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [canConfigureAi, setCanConfigureAi] = useState(false);
  const [parseMode, setParseMode] = useState('local');
  const processRequest = useRef(0);
  const entriesWorkbookId = useRef(workbookId);
  const focusTransactionsAfterUpdate = useRef(false);
  const latestWorkbook = useRef(workbook);
  const mounted = useRef(true);
  const latestTransactions = useRef(workbook.transactions);
  const transactionsHeadingRef = useRef(null);
  const lines = useMemo(() => text.split(/\r?\n/).filter((line) => line.trim()).length, [text]);
  const unresolvedCount = entries.filter((entry) => !entry.transactionId).length;

  useLayoutEffect(() => {
    latestWorkbook.current = workbook;
  }, [workbook]);

  useEffect(() => {
    if (entriesWorkbookId.current !== workbookId) {
      processRequest.current += 1;
      entriesWorkbookId.current = workbookId;
      setText(initialText(workbookId));
      setEntries(initialEntries(workbook));
      setEditingEntry(null);
      setNotice('');
      setError('');
      setProcessing(false);
      return;
    }
    persistEntries(workbookId, entries);
  }, [entries, workbook, workbookId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      processRequest.current += 1;
    };
  }, []);

  useEffect(() => {
    if (latestTransactions.current === workbook.transactions) return;
    latestTransactions.current = workbook.transactions;
    setEntries((current) => reconcileEntries(workbook, current));
  }, [workbook, workbook.transactions]);

  useEffect(() => {
    if (!focusTransactionsAfterUpdate.current || !entries.length) return;
    focusTransactionsAfterUpdate.current = false;
    transactionsHeadingRef.current?.focus();
  }, [entries]);

  const focusEditButton = (entryId) => {
    if (!entryId || typeof window === 'undefined') return;
    const focus = () => document.getElementById(`notes-edit-${entryId}`)?.focus();
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focus);
    else window.setTimeout(focus, 0);
  };

  const updateText = (value) => {
    processRequest.current += 1;
    setText(value);
    persistText(workbook.id, value);
    setNotice('');
    setError('');
    setCanConfigureAi(false);
    setParseMode('local');
  };
  const processTransactions = async () => {
    if (!lines || processing) return;
    const workbookAtStart = workbook;
    const request = processRequest.current + 1;
    processRequest.current = request;
    setProcessing(true);
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
      if (
        !mounted.current ||
        processRequest.current !== request ||
        latestWorkbook.current !== workbookAtStart
      ) {
        return;
      }
      if (!result.entries.length) {
        setError('Enter at least one transaction to add.');
        return;
      }

      const batchId =
        typeof services.createId === 'function'
          ? services.createId('notes_batch')
          : `notes-batch-${Date.now().toString(36)}-${request}`;
      const parsedEntries = result.entries.map((entry) => ({
        ...entry,
        id: `${batchId}-${entry.lineNumber}`,
        issues: validateNotesEntry(workbook, entry),
        transactionId: ''
      }));
      const savableEntries = parsedEntries.filter((entry) => !entry.issues.length);
      let listedEntries = parsedEntries;
      let savedCount = 0;

      if (savableEntries.length) {
        const commandResult = submitNotesBatchCommand(workbook, savableEntries, services);
        if (commandResult.ok) {
          const savedByEntryId = new Map(
            savableEntries.map((entry, index) => [entry.id, commandResult.transactions[index]])
          );
          listedEntries = parsedEntries.map((entry) => {
            const transaction = savedByEntryId.get(entry.id);
            return transaction
              ? {
                  ...entry,
                  transactionId: transaction.id,
                  transactionFingerprint: transactionFingerprint(transaction),
                  issues: []
                }
              : entry;
          });
          savedCount = commandResult.count || commandResult.transactions.length;
          onCommandResult?.(commandResult);
        } else {
          const saveIssue = commandResult.errors?.[0];
          listedEntries = parsedEntries.map((entry) =>
            savableEntries.some((candidate) => candidate.id === entry.id)
              ? {
                  ...entry,
                  issues: [
                    {
                      code: saveIssue?.code || 'notes.transaction_not_saved',
                      field: 'transaction',
                      message: saveIssue?.message || 'This transaction could not be added.'
                    }
                  ]
                }
              : entry
          );
          setError(saveIssue?.message || 'The transactions could not be added.');
        }
      }

      const needsDetailsCount = listedEntries.length - savedCount;
      const summary = [
        savedCount ? `${savedCount} transaction${savedCount === 1 ? '' : 's'} added.` : '',
        needsDetailsCount
          ? `${needsDetailsCount} ${needsDetailsCount === 1 ? 'needs' : 'need'} details; use Edit to finish.`
          : '',
        result.notice || ''
      ]
        .filter(Boolean)
        .join(' ');
      focusTransactionsAfterUpdate.current = true;
      setEntries((current) => [...current, ...listedEntries]);
      setText('');
      persistText(workbook.id, '');
      setNotice(summary);
      setCanConfigureAi(result.canConfigure === true);
      setParseMode(result.mode || 'local');
    } catch (_error) {
      if (!mounted.current || processRequest.current !== request) return;
      setError('Cavalry could not process these notes. Try again.');
    } finally {
      if (mounted.current && processRequest.current === request) setProcessing(false);
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
    const existingTransaction = asArray(workbook.transactions).find(
      (transaction) => asString(transaction?.id) === asString(editingEntry.transactionId)
    );
    if (editingEntry.transactionId && !existingTransaction) {
      setNotice('');
      setError('This transaction no longer exists. Its saved Notes row was removed.');
      setEntries((current) => current.filter((entry) => entry.id !== editingEntry.id));
      setEditingEntry(null);
      return;
    }
    if (
      existingTransaction &&
      editingEntry.transactionFingerprint &&
      transactionFingerprint(existingTransaction) !== editingEntry.transactionFingerprint
    ) {
      setNotice('');
      setError(
        'This transaction changed elsewhere. Cancel and reopen Edit to use its latest details.'
      );
      setEntries((current) => reconcileEntries(workbook, current));
      return;
    }
    const resolved = resolveNotesEntry(workbook, editingEntry, { manuallyReviewed: true });
    resolved.issues = validateNotesEntry(workbook, resolved);
    if (resolved.issues.length) {
      setEditingEntry(resolved);
      setNotice('');
      setError('Fix the highlighted details before saving.');
      return;
    }
    const result = submitNotesBatchCommand(workbook, [resolved], services);
    if (!result.ok) {
      const saveIssue = result.errors?.[0];
      const failed = {
        ...resolved,
        issues: [
          {
            code: saveIssue?.code || 'notes.transaction_not_saved',
            field: 'transaction',
            message: saveIssue?.message || 'This transaction could not be saved.'
          }
        ]
      };
      setEditingEntry(failed);
      setError(saveIssue?.message || 'The transaction could not be saved.');
      return;
    }
    onCommandResult?.(result);
    const transaction = result.transactions[0];
    const saved = {
      ...resolved,
      transactionId: transaction?.id || resolved.transactionId,
      transactionFingerprint: transactionFingerprint(transaction),
      issues: []
    };
    setEntries((current) => current.map((entry) => (entry.id === saved.id ? saved : entry)));
    setEditingEntry(null);
    focusEditButton(saved.id);
    setError('');
    setCanConfigureAi(false);
    setNotice(resolved.transactionId ? 'Transaction updated.' : 'Transaction added.');
  };

  return (
    <section className="notes-route" data-react-route="notes">
      <header className="notes-page-header">
        <div>
          <h1>Notes</h1>
        </div>
        <button
          aria-label="Clear the Notes draft and list; saved transactions stay in the ledger"
          className="btn notes-clear-button"
          disabled={processing || (!text && !entries.length)}
          onClick={clearNotes}
          title="Clear the draft and this list. Saved transactions stay in the ledger."
          type="button"
        >
          <Icon name="delete" />
          Clear view
        </button>
      </header>

      {notice || error ? (
        <div
          aria-live={error ? undefined : 'polite'}
          className={`notes-route-notice${error ? ' is-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          <Icon
            name={error ? 'error' : /\b(?:added|updated)\b/i.test(notice) ? 'check_circle' : 'info'}
          />
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
          ) : !error && /\b(?:added|updated)\b/i.test(notice) ? (
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
              {parseMode === 'ai'
                ? 'AI enhanced'
                : parseMode === 'hybrid'
                  ? 'AI + local'
                  : 'Smart entry'}
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
                ? 'Reading and adding your transactions…'
                : lines
                  ? `${lines} line${lines === 1 ? '' : 's'} ready to add`
                  : 'Start with an amount and description; payment method is optional'}
            </span>
            <button
              className="btn btn-primary notes-process-button"
              disabled={!lines || processing}
              onClick={() => void processTransactions()}
              type="button"
            >
              <Icon name="auto_awesome" />
              {processing ? 'Adding…' : 'Add transactions'}
            </button>
          </footer>
        </section>

        <section className="notes-panel notes-review-panel">
          <header>
            <div>
              <h2 ref={transactionsHeadingRef} tabIndex={-1}>
                Transactions
              </h2>
            </div>
            {entries.length ? (
              <span
                className={
                  unresolvedCount ? 'notes-review-count needs-review' : 'notes-review-count'
                }
              >
                {unresolvedCount
                  ? `${entries.length - unresolvedCount} added · ${unresolvedCount} need${
                      unresolvedCount === 1 ? 's' : ''
                    } details`
                  : `${entries.length} added`}
              </span>
            ) : null}
          </header>
          <div className="notes-review-list">
            {entries.length ? (
              entries.map((entry, index) => (
                <ReviewEntry
                  key={entry.id}
                  editingEntry={editingEntry}
                  entry={entry}
                  isEditing={editingEntry?.id === entry.id}
                  position={index + 1}
                  onEdit={(selected) => {
                    setError('');
                    setEditingEntry(editingEntry?.id === selected.id ? null : { ...selected });
                  }}
                  onEditCancel={() => {
                    const entryId = editingEntry?.id;
                    setEditingEntry(null);
                    setError('');
                    focusEditButton(entryId);
                  }}
                  onEditChange={(field, value) => {
                    setError('');
                    setEditingEntry((current) => ({ ...current, [field]: value }));
                  }}
                  onEditSave={saveEdit}
                  workbook={workbook}
                />
              ))
            ) : (
              <div className="notes-review-empty">
                <span>
                  <Icon name="receipt_long" />
                </span>
                <strong>Added transactions will appear here</strong>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
