import { PrivateValue } from '../../shared/PrivateValue.jsx';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { submitNotesBatchCommand } from './notes-controller.js';
import { parseNotesWithAi } from './notes-ai-parser.js';
import { parseNotesText, resolveNotesEntry } from './notes-parser.js';
import {
  withNotesBatchDuplicateReview,
  withNotesDuplicateReview
} from './notes-duplicate-review.js';
import { ReviewEntry } from './NotesReviewEntry.jsx';
import {
  readNotesDraft,
  writeNotesDraft,
  reconcileNotesDraft,
  sourceKeys,
  transactionFingerprint
} from './notes-draft-storage.js';

export function NotesRoute({ advisor, workbook = {}, services = {}, onAction, onCommandResult }) {
  const workbookId = String(workbook.id || 'workbook');
  const [draft, setDraft] = useState(() => readNotesDraft(workbook));
  const { text, entries, editingEntry, reviewedText } = draft;
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [canConfigureAi, setCanConfigureAi] = useState(false);
  const [undoDraft, setUndoDraft] = useState(null);
  const processRequest = useRef(0);
  const entriesWorkbookId = useRef(workbookId);
  const latestWorkbook = useRef(workbook);
  const mounted = useRef(true);
  const commitLock = useRef(false);
  const latestTransactions = useRef(workbook.transactions);
  const transactionsHeadingRef = useRef(null);
  const lines = useMemo(() => text.split(/\r?\n/).filter((line) => line.trim()).length, [text]);
  const pending = entries.filter((entry) => !entry.transactionId);
  const ready = pending.filter((entry) => !entry.issues.length);
  const changedSinceReview = pending.length > 0 && text !== reviewedText;

  useLayoutEffect(() => {
    latestWorkbook.current = workbook;
  }, [workbook]);
  useEffect(() => {
    if (entriesWorkbookId.current !== workbookId) {
      processRequest.current += 1;
      entriesWorkbookId.current = workbookId;
      latestTransactions.current = workbook.transactions;
      setDraft(readNotesDraft(workbook));
      setNotice('');
      setError('');
      setUndoDraft(null);
      setProcessing(false);
      return;
    }
    setStorageFailed(draft.loadFailed || !writeNotesDraft(workbookId, draft));
  }, [draft, workbook, workbookId]);
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
    setDraft((current) => reconcileNotesDraft(workbook, current));
  }, [workbook, workbook.transactions]);

  const focusEditButton = (entryId) => {
    window.requestAnimationFrame(() => document.getElementById(`notes-edit-${entryId}`)?.focus());
  };
  const updateText = (value) => {
    processRequest.current += 1;
    setDraft((current) => ({ ...current, text: value, loadFailed: false }));
    setNotice('');
    setError('');
    setUndoDraft(null);
    setCanConfigureAi(false);
  };
  const reviewNotes = async (useAi = false) => {
    if (!lines || processing) return;
    if (editingEntry) return;
    if (
      text === reviewedText &&
      pending.length &&
      (!useAi || pending.some((entry) => entry.manuallyReviewed))
    ) {
      setNotice(
        'Your review is ready below. Add or remove those drafts before preparing them again.'
      );
      return;
    }
    const workbookAtStart = workbook;
    const request = ++processRequest.current;
    setProcessing(true);
    setNotice('');
    setError('');
    setCanConfigureAi(false);
    try {
      const options = {
        advisor,
        createId: services.createId,
        today: services.today || services.defaultDate
      };
      const result = useAi
        ? await parseNotesWithAi(text, workbook, options)
        : { entries: parseNotesText(text, workbook, options), mode: 'local' };
      if (!mounted.current || processRequest.current !== request) return;
      if (latestWorkbook.current !== workbookAtStart) {
        setError('Your workbook changed while reviewing. Review the note again.');
        return;
      }
      const batchId =
        typeof services.createId === 'function'
          ? services.createId('notes_batch')
          : `notes-batch-${Date.now()}-${request}`;
      const added = entries.filter((entry) => entry.transactionId);
      const savedSources = new Set(added.map((entry) => entry.sourceKey).filter(Boolean));
      const candidates = sourceKeys(result.entries).filter(
        (entry) => !savedSources.has(entry.sourceKey)
      );
      const prepared = withNotesBatchDuplicateReview(
        candidates.map((entry, index) => ({
          ...withNotesDuplicateReview(
            workbook,
            resolveNotesEntry(workbook, entry, { keepInferenceIssues: true })
          ),
          id: `${batchId}-${index + 1}`,
          transactionId: ''
        }))
      );
      setDraft((current) => ({
        ...current,
        entries: [...added, ...prepared],
        editingEntry: null,
        reviewedText: text
      }));
      setNotice(
        prepared.length
          ? `${prepared.length} transaction${prepared.length === 1 ? '' : 's'} to review.${result.notice ? ` ${result.notice}` : ''}`
          : savedSources.size && result.entries.length
            ? 'These transactions are already added.'
            : 'No transactions found. Your note is saved as written.'
      );
      setCanConfigureAi(result.canConfigure === true);
    } catch {
      if (mounted.current && processRequest.current === request)
        setError('Could not review this note. Your writing is still here.');
    } finally {
      if (mounted.current && processRequest.current === request) setProcessing(false);
    }
  };
  const commitEntries = (selected) => {
    if (commitLock.current || !selected.length) return false;
    if (typeof onCommandResult !== 'function') {
      setError('The transaction connection is unavailable. Your draft is still here.');
      return false;
    }
    commitLock.current = true;
    try {
      const result = submitNotesBatchCommand(workbook, selected, services);
      if (!result.ok) {
        setError(result.errors?.[0]?.message || 'Could not add these transactions.');
        return false;
      }
      const committed = onCommandResult?.(result);
      if (committed?.ok === false) {
        setError(committed.errors?.[0]?.message || 'Could not save these transactions.');
        return false;
      }
      const saved = new Map(
        selected.map((entry, index) => {
          const transaction = result.transactions[index];
          return [
            entry.id,
            {
              ...entry,
              transactionId: transaction.id,
              transactionFingerprint: transactionFingerprint(transaction),
              issues: []
            }
          ];
        })
      );
      setDraft((current) => ({
        ...current,
        entries: current.entries.map((entry) => saved.get(entry.id) || entry),
        editingEntry: null
      }));
      setError('');
      setNotice(
        selected[0].transactionId
          ? 'Transaction updated.'
          : `${selected.length} transaction${selected.length === 1 ? '' : 's'} added.`
      );
      return true;
    } catch {
      setError('Could not save these transactions. Your draft is still here.');
      return false;
    } finally {
      commitLock.current = false;
    }
  };
  const addReady = () => {
    if (changedSinceReview || editingEntry || processing) return;
    const checked = ready.map((entry) =>
      withNotesDuplicateReview(
        workbook,
        resolveNotesEntry(workbook, entry, { keepInferenceIssues: true })
      )
    );
    if (checked.some((entry) => entry.issues.length)) {
      setDraft((current) => reconcileNotesDraft(workbook, current));
      setError('Some details changed. Check the highlighted rows.');
      return;
    }
    commitEntries(checked);
  };
  const saveEdit = () => {
    if (!editingEntry || changedSinceReview) return;
    const existing = (workbook.transactions || []).find(
      (transaction) => transaction.id === editingEntry.transactionId
    );
    if (editingEntry.transactionId && !existing) {
      setError('This transaction no longer exists.');
      setDraft((current) => ({
        ...current,
        entries: current.entries.filter((entry) => entry.id !== editingEntry.id),
        editingEntry: null
      }));
      return;
    }
    if (
      existing &&
      editingEntry.transactionFingerprint &&
      transactionFingerprint(existing) !== editingEntry.transactionFingerprint
    ) {
      setError(
        'This transaction changed elsewhere. Cancel and reopen Edit to use its latest details.'
      );
      return;
    }
    const resolved = resolveNotesEntry(workbook, editingEntry, { manuallyReviewed: true });
    if (resolved.issues.length) {
      setDraft((current) => ({ ...current, editingEntry: resolved }));
      setError('Fix the highlighted details before continuing.');
      return;
    }
    if (resolved.transactionId) {
      if (commitEntries([resolved])) focusEditButton(resolved.id);
      return;
    }
    setDraft((current) => ({
      ...current,
      entries: current.entries.map((entry) => (entry.id === resolved.id ? resolved : entry)),
      editingEntry: null
    }));
    setNotice('Details confirmed. Ready to add.');
    setError('');
    focusEditButton(resolved.id);
  };
  const clearNotes = () => {
    setUndoDraft(draft);
    setDraft({ text: '', entries: [], editingEntry: null, reviewedText: '' });
    setNotice('Note cleared. Saved transactions stay in the ledger.');
    setError('');
  };

  return (
    <section className="notes-route" data-react-route="notes">
      <header className="notes-page-header">
        <h1>Notes</h1>
        <div className="notes-header-actions">
          {undoDraft ? (
            <button
              className="btn"
              type="button"
              onClick={() => {
                setDraft(undoDraft);
                setUndoDraft(null);
                setNotice('');
              }}
            >
              Undo clear
            </button>
          ) : null}
          <button
            aria-label="Clear the Notes draft and list; saved transactions stay in the ledger"
            className="btn notes-clear-button"
            disabled={processing || (!text && !entries.length)}
            onClick={clearNotes}
            type="button"
          >
            <CavalryIcon name="delete" />
            Clear note
          </button>
        </div>
      </header>
      {storageFailed ? (
        <div className="notes-route-notice is-error" role="alert">
          This note could not be saved on this device. Keep this page open and copy your writing
          somewhere safe.
        </div>
      ) : null}
      {notice || error ? (
        <div
          aria-live={error ? undefined : 'polite'}
          className={`notes-route-notice${error ? ' is-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          <CavalryIcon name={error ? 'error' : 'info'} />
          <PrivateValue as="span">{error || notice}</PrivateValue>
          {!error && canConfigureAi ? (
            <button
              onClick={() =>
                onAction?.({ type: 'route/navigate', payload: { routeId: 'settings' } })
              }
              type="button"
            >
              AI settings
            </button>
          ) : !error && /\b(?:added|updated)\./i.test(notice) ? (
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
              <h2>Your note</h2>
              <p>Write freely. Review transactions when you’re ready.</p>
            </div>
            <span className="notes-save-status">
              {storageFailed ? 'Unsaved' : 'Saved on this device'}
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
                void reviewNotes();
              }
            }}
            placeholder={
              'Sept 10\ncoffee 180 cash\ngroceries — 2,450 debit\n\nCheck the taxi receipt later…'
            }
            spellCheck="true"
            value={text}
          />
          <footer className="notes-panel-footer notes-writing-actions">
            <span>{processing ? 'Reading your note…' : 'Nothing is added until you review.'}</span>
            <div className="notes-button-group">
              <button
                className="btn"
                disabled={!lines || processing || Boolean(editingEntry)}
                onClick={() => void reviewNotes(true)}
                type="button"
              >
                <CavalryIcon name="auto_awesome" />
                Use AI
              </button>
              <button
                className="btn btn-primary notes-process-button"
                disabled={!lines || processing || Boolean(editingEntry)}
                onClick={() => void reviewNotes()}
                type="button"
              >
                {processing ? 'Reviewing…' : 'Review transactions'}
              </button>
            </div>
          </footer>
        </section>
        <section className="notes-panel notes-review-panel">
          <header>
            <div>
              <h2 ref={transactionsHeadingRef} tabIndex={-1}>
                Review
              </h2>
            </div>
            {entries.length ? (
              <PrivateValue
                as="span"
                className={
                  pending.length ? 'notes-review-count needs-review' : 'notes-review-count'
                }
              >
                {pending.length
                  ? `${ready.length} ready · ${pending.length - ready.length} to check`
                  : `${entries.length} added`}
              </PrivateValue>
            ) : null}
          </header>
          {changedSinceReview ? (
            <p className="notes-stale-notice" role="status">
              Your note changed. Review it again before adding.
            </p>
          ) : null}
          <div className="notes-review-list">
            {entries.length ? (
              entries.map((entry, index) => (
                <ReviewEntry
                  key={entry.id}
                  editingEntry={editingEntry}
                  entry={entry}
                  isEditing={editingEntry?.id === entry.id}
                  position={index + 1}
                  disabled={processing || changedSinceReview}
                  onEdit={(selected) => {
                    setError('');
                    setDraft((current) => ({
                      ...current,
                      editingEntry:
                        current.editingEntry?.id === selected.id ? null : { ...selected }
                    }));
                  }}
                  onRemove={(id) =>
                    setDraft((current) => ({
                      ...current,
                      entries: current.entries.filter((entry) => entry.id !== id),
                      editingEntry: current.editingEntry?.id === id ? null : current.editingEntry
                    }))
                  }
                  onEditCancel={() => {
                    const id = editingEntry?.id;
                    setDraft((current) => ({ ...current, editingEntry: null }));
                    setError('');
                    focusEditButton(id);
                  }}
                  onEditChange={(field, value) => {
                    setError('');
                    setDraft((current) => ({
                      ...current,
                      editingEntry: {
                        ...current.editingEntry,
                        [field]: value,
                        ...(field === 'description' ? { autoTransferDescription: false } : {})
                      }
                    }));
                  }}
                  onEditSave={saveEdit}
                  workbook={workbook}
                />
              ))
            ) : (
              <div className="notes-review-empty">
                <span>
                  <CavalryIcon name="receipt_long" />
                </span>
                <strong>Transactions to review will appear here</strong>
                <p>Your original note stays as you wrote it.</p>
              </div>
            )}
          </div>
          {pending.length ? (
            <footer className="notes-panel-footer">
              <PrivateValue as="span">
                {pending.length - ready.length
                  ? 'Check flagged details or remove unwanted rows.'
                  : 'Check amounts, dates, and accounts.'}
              </PrivateValue>
              <PrivateValue
                as="button"
                className="btn btn-primary"
                disabled={
                  !ready.length || processing || Boolean(editingEntry) || changedSinceReview
                }
                onClick={addReady}
                type="button"
              >
                Add {ready.length} transaction{ready.length === 1 ? '' : 's'}
              </PrivateValue>
            </footer>
          ) : null}
        </section>
      </div>
    </section>
  );
}
