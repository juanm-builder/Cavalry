import { resolveNotesEntry } from './notes-parser.js';
import { withNotesDuplicateReview } from './notes-duplicate-review.js';

const asArray = (value) => (Array.isArray(value) ? value : []);
const asString = (value) => String(value == null ? '' : value);
const draftKey = (id) => `cavalry.notes.draft.${id || 'workbook'}`;

export function readNotesDraft(workbook) {
  try {
    const saved = window.localStorage.getItem(draftKey(workbook.id));
    const draft = saved
      ? JSON.parse(saved)
      : {
          text: window.localStorage.getItem(`cavalry.notes.${workbook.id || 'workbook'}`) || '',
          entries: JSON.parse(
            window.localStorage.getItem(`cavalry.notes.entries.${workbook.id || 'workbook'}`) ||
              '[]'
          )
        };
    return reconcileNotesDraft(workbook, {
      text: asString(draft.text),
      entries: draft.entries,
      reviewedText: asString(draft.reviewedText),
      editingEntry: draft.editingEntry
    });
  } catch {
    return { text: '', entries: [], editingEntry: null, reviewedText: '', loadFailed: true };
  }
}

export function writeNotesDraft(workbookId, draft) {
  try {
    window.localStorage.setItem(draftKey(workbookId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

// Repeated lines within a note remain separate; preparing the same source twice does not.
export function sourceKeys(entries) {
  const occurrences = new Map();
  return entries.map((entry) => {
    const source = JSON.stringify([
      asString(entry.date || entry.sourceContext?.date),
      asString(entry.sourceText).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    ]);
    const occurrence = (occurrences.get(source) || 0) + 1;
    occurrences.set(source, occurrence);
    return { ...entry, sourceKey: `${source}:${occurrence}` };
  });
}

export function transactionFingerprint(transaction) {
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
    return (
      candidate?.direction === direction &&
      (template === 'transfer'
        ? ['asset', 'liability'].includes(account?.group)
        : account?.group === group)
    );
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
    autoTransferDescription:
      priorEntry.autoTransferDescription === true &&
      asString(transaction.description) === asString(priorEntry.description),
    categoryId: asString(transaction.categoryId),
    primaryAccountId: transactionPrimaryAccountId(workbook, transaction),
    secondaryAccountId:
      transaction.template === 'transfer'
        ? asString(asArray(transaction.lines).find((line) => line.direction === 'debit')?.accountId)
        : '',
    template: asString(transaction.template),
    counterpartyId: asString(transaction.counterpartyId),
    transactionNote: asString(transaction.note),
    transactionId: asString(transaction.id),
    transactionFingerprint: transactionFingerprint(transaction),
    issues: []
  };
  return { ...resolveNotesEntry(workbook, entry), issues: [] };
}

export function reconcileEntries(workbook, entries) {
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
      const resolved = resolveNotesEntry(workbook, entry, { keepInferenceIssues: true });
      return withNotesDuplicateReview(workbook, { ...resolved, transactionId: '' });
    })
    .filter(Boolean);
}

export function reconcileNotesDraft(workbook, draft) {
  const entries = reconcileEntries(workbook, draft.entries);
  const editingEntry =
    draft.editingEntry && entries.some((entry) => entry.id === draft.editingEntry.id)
      ? draft.editingEntry
      : null;
  return { ...draft, entries, editingEntry };
}
