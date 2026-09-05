import { useCallback } from 'react';

import { buildTransactionExportIntent } from '../features/import-export/import-export-controller.js';
import { asString } from './finance-application-controller-helpers.js';

// Executes settings storage actions through the session's save-before-open and
// save-before-exit boundaries, while keeping storage feedback in one place.
export function useSettingsWorkbookStorage({
  browserCache,
  handleTransactionIntent,
  navigate,
  openWorkbook,
  openRecentWorkbook,
  refreshRecentWorkbooks,
  reportError,
  saveWorkbook,
  saveWorkbookAs,
  setSettingsViewState,
  setWorkbook,
  workbookRef,
  workbookStorage
}) {
  return useCallback(
    async (payload) => {
      const operation = asString(payload && payload.operation);
      const currentWorkbook = workbookRef.current;
      const fail = (message) => {
        const copy = asString(message || `The ${operation || 'storage'} operation failed.`);
        setSettingsViewState((current) => ({
          ...current,
          error: copy,
          feedbackSection: 'settings-files',
          notice: ''
        }));
        reportError('settings-storage', copy, `settings-storage.${operation || 'unknown'}-failed`);
        return { ok: false, error: copy };
      };
      try {
        let result;
        if (operation === 'recovery-list') {
          return await refreshRecentWorkbooks();
        } else if (operation === 'recovery-open') {
          const opened = await openRecentWorkbook(payload.id);
          return { ...opened, ok: opened?.status === 'loaded' || opened?.status === 'canceled' };
        } else if (operation === 'open') {
          result = await openWorkbook();
          if (result && result.status === 'error') return fail(result.error);
        } else if (operation === 'save') {
          result = await saveWorkbook(currentWorkbook);
        } else if (operation === 'save-as') {
          result = await saveWorkbookAs(
            currentWorkbook,
            `${asString(payload.suggestedName || (currentWorkbook && currentWorkbook.name) || 'cavalry-workbook')}.html`
          );
        } else if (operation === 'reveal') {
          result = await workbookStorage.reveal();
        } else if (operation === 'forget') {
          result = await workbookStorage.forget();
        } else if (operation === 'export-workbook' && currentWorkbook) {
          result = await handleTransactionIntent(
            buildTransactionExportIntent(currentWorkbook, 'workbook-html')
          );
        } else if (operation === 'export-csv' && currentWorkbook) {
          result = await handleTransactionIntent(
            buildTransactionExportIntent(currentWorkbook, 'csv-bundle')
          );
        } else if (operation === 'import-csv') {
          result = await handleTransactionIntent({
            type: 'import/file-requested',
            payload: { kind: 'transactions-csv', accept: '.csv,text/csv' }
          });
          if (result && result.ok) navigate('ledger');
        } else if (operation === 'exit') {
          if (currentWorkbook) {
            const saved = await saveWorkbook(currentWorkbook);
            if (!saved?.ok)
              return fail(saved?.error || 'The workbook must be saved before leaving it.');
          }
          const cleared = await browserCache.clear();
          if (cleared?.ok === false && !cleared.unavailable) return fail(cleared.error);
          const forgotten = await workbookStorage.forget();
          if (forgotten?.ok === false && !forgotten.unavailable) return fail(forgotten.error);
          setWorkbook(null, { source: 'exit', markDirty: false });
          result = { ok: true };
        } else {
          return fail(`The ${operation || 'requested'} operation is unavailable in this runtime.`);
        }
        if (result && result.canceled) return result;
        if (result && (result.ok === false || result.status === 'error')) {
          return fail(result.error);
        }
        setSettingsViewState((current) => ({
          ...current,
          error: '',
          feedbackSection: 'settings-files',
          notice: `${operation || 'Storage'} completed.`
        }));
        return result || { ok: true };
      } catch (error) {
        return fail(error && error.message);
      }
    },
    [
      handleTransactionIntent,
      navigate,
      openWorkbook,
      openRecentWorkbook,
      refreshRecentWorkbooks,
      browserCache,
      workbookStorage,
      reportError,
      saveWorkbook,
      saveWorkbookAs,
      setSettingsViewState,
      setWorkbook,
      workbookRef
    ]
  );
}
