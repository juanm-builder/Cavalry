import { useCallback } from 'react';
import { asString } from './cloud-workbook-model.js';

export function useCloudWorkbookMergePersistence({
  stateRef,
  workbookRef,
  suppressNextAutoSyncRef,
  setWorkbook,
  saveWorkbook,
  browserCache
}) {
  return useCallback(
    async (
      expectedWorkbook,
      mergedWorkbook,
      expectedUserId = asString(stateRef.current.user?.id)
    ) => {
      if (expectedUserId !== asString(stateRef.current.user?.id))
        return { ok: false, code: 'cloud_sync_scope_changed' };
      const workbookId = asString(expectedWorkbook && expectedWorkbook.id);
      if (
        !workbookId ||
        workbookRef.current !== expectedWorkbook ||
        asString(mergedWorkbook && mergedWorkbook.id) !== workbookId
      ) {
        return { ok: false, retry: true, code: 'local_workbook_changed' };
      }

      let appliedWorkbook = mergedWorkbook;
      if (typeof setWorkbook === 'function') {
        appliedWorkbook =
          setWorkbook(mergedWorkbook, {
            source: 'cloud-merge',
            markDirty: true
          }) || mergedWorkbook;
      }
      workbookRef.current = appliedWorkbook;
      suppressNextAutoSyncRef.current = {
        workbookId,
        workbook: appliedWorkbook
      };
      const localSaveResult =
        typeof saveWorkbook === 'function'
          ? await saveWorkbook(appliedWorkbook)
          : browserCache && typeof browserCache.save === 'function'
            ? await browserCache.save(appliedWorkbook)
            : { ok: false };
      if (!(localSaveResult && localSaveResult.ok)) {
        if (suppressNextAutoSyncRef.current?.workbook === appliedWorkbook) {
          suppressNextAutoSyncRef.current = null;
        }
        return {
          ok: false,
          retry: false,
          code: 'local_merge_save_failed',
          error: 'Cavalry combined the changes but could not save the merged workbook locally.'
        };
      }
      return { ok: true, workbook: appliedWorkbook };
    },
    [browserCache, saveWorkbook, setWorkbook, stateRef, suppressNextAutoSyncRef, workbookRef]
  );
}
