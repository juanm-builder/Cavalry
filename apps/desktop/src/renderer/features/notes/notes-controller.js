import { submitManualTransactionCommand, validateLedgerInvariants } from '@cavalry/finance-core';

import { notesEntryToTransactionInput, validateNotesEntry } from './notes-parser.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function commandError(workbook, code, message, extra = {}) {
  return {
    ok: false,
    workbook,
    events: [],
    warnings: [],
    errors: [{ code, message, ...extra }]
  };
}

export function submitNotesBatchCommand(workbook, entries, services = {}) {
  const batch = asArray(entries);
  if (!batch.length) {
    return commandError(workbook, 'notes.empty_batch', 'Process at least one transaction first.');
  }

  const invalidEntry = batch.find((entry) => validateNotesEntry(workbook, entry).length);
  if (invalidEntry) {
    return commandError(
      workbook,
      'notes.unresolved_entry',
      `Line ${invalidEntry.lineNumber || 1} is missing required transaction details.`,
      { lineNumber: invalidEntry.lineNumber || 1 }
    );
  }

  let nextWorkbook = workbook;
  const transactions = [];
  const refreshEvents = [];
  for (const entry of batch) {
    const result = submitManualTransactionCommand(
      nextWorkbook,
      notesEntryToTransactionInput(entry),
      services
    );
    const changed = result.ok && result.workbook && result.workbook !== nextWorkbook;
    if (!result.ok || !changed) {
      const warning = asArray(result.warnings)[0];
      const error = asArray(result.errors)[0];
      return commandError(
        workbook,
        error?.code || warning?.code || 'notes.transaction_not_saved',
        error?.message || warning?.message || `Line ${entry.lineNumber || 1} could not be saved.`,
        { lineNumber: entry.lineNumber || 1 }
      );
    }
    nextWorkbook = result.workbook;
    if (result.transaction) transactions.push(result.transaction);
    refreshEvents.push(
      ...asArray(result.events).filter(
        (event) => event && event.type === 'refresh-generated-daily-interest'
      )
    );
  }
  const existingInvariantKeys = new Set(
    asArray(validateLedgerInvariants(workbook).errors).map(
      (item) => `${item.code}:${item.detail || ''}:${item.message || ''}`
    )
  );
  const introducedInvariant = asArray(validateLedgerInvariants(nextWorkbook).errors).find(
    (item) => !existingInvariantKeys.has(`${item.code}:${item.detail || ''}:${item.message || ''}`)
  );
  if (introducedInvariant) {
    return commandError(
      workbook,
      introducedInvariant.code || 'notes.ledger_invariant_failed',
      introducedInvariant.message || 'The batch would leave the ledger in an invalid state.'
    );
  }

  return {
    ok: true,
    workbook: nextWorkbook,
    events: [...refreshEvents, { type: 'schedule-save' }, { type: 'render' }],
    warnings: [],
    errors: [],
    transactions,
    count: transactions.length
  };
}
