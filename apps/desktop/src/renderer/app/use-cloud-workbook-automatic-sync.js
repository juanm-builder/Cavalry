import { useCallback } from 'react';

import {
  readCloudWorkbookSyncState,
  writeCloudWorkbookSyncState
} from './cloud-workbook-sync-state.js';
import {
  asObject,
  asRevision,
  asString,
  isRetryableAutomaticSyncFailure,
  normalizeCloudState,
  stateFromResult
} from './cloud-workbook-model.js';

export function useCloudWorkbookAutomaticSync({
  applyRemoteState,
  conflictedWorkbookIdsRef,
  invoke,
  reconcileWorkbookBranches,
  refreshState,
  resolvedSyncStorage,
  stateRef,
  updateWorkbookConflict
}) {
  return useCallback(
    async (entry) => {
      const currentState = stateRef.current;
      const currentUserId = asString(currentState.user && currentState.user.id);
      const currentWorkbookId = asString(entry && entry.workbookId);
      if (
        currentState.status !== 'signed_in' ||
        !currentUserId ||
        currentUserId !== asString(entry && entry.userId) ||
        !currentWorkbookId
      ) {
        return { ok: false, retry: false, code: 'not_signed_in' };
      }

      const syncState = readCloudWorkbookSyncState(
        resolvedSyncStorage,
        currentUserId,
        currentWorkbookId
      );
      if (syncState.remoteDeleted === true) {
        return { ok: false, retry: false, code: 'cloud_sync_disabled' };
      }
      if (syncState.conflict || conflictedWorkbookIdsRef.current.has(currentWorkbookId)) {
        return { ok: false, retry: false, conflict: true, code: 'workbook_revision_conflict' };
      }
      const remote = currentState.workbooks.find((item) => item.id === currentWorkbookId);
      if (!remote && syncState.known && syncState.revision) {
        return { ok: false, retry: false, code: 'cloud_workbook_missing' };
      }
      if (
        remote &&
        (remote.conflict ||
          !syncState.known ||
          !syncState.revision ||
          remote.revision !== syncState.revision)
      ) {
        return reconcileWorkbookBranches({
          userId: currentUserId,
          workbookId: currentWorkbookId,
          localWorkbook: entry.workbook,
          syncState
        });
      }

      if (!Object.prototype.hasOwnProperty.call(entry, 'expectedRevision')) {
        entry.expectedRevision = syncState.known ? syncState.revision : null;
      }
      const result = await invoke('uploadWorkbook', {
        workbook: entry.workbook,
        expectedRevision: entry.expectedRevision
      });
      const resultState = stateFromResult(result);

      if (result && (result.conflict === true || result.code === 'workbook_revision_conflict')) {
        if (resultState) applyRemoteState(resultState);
        return reconcileWorkbookBranches({
          userId: currentUserId,
          workbookId: currentWorkbookId,
          localWorkbook: entry.workbook,
          syncState
        });
      }
      if (!(result && result.ok)) {
        return { ...(result || {}), retry: isRetryableAutomaticSyncFailure(result) };
      }

      const metadata = asObject(result.metadata);
      const metadataId = asString(metadata.id);
      if (metadataId && metadataId !== currentWorkbookId) {
        return {
          ok: false,
          retry: false,
          code: 'cloud_workbook_identity_mismatch'
        };
      }
      const resultRemote = (
        resultState ? normalizeCloudState(resultState) : currentState
      ).workbooks.find((item) => item.id === currentWorkbookId);
      const revision = asRevision(metadata.revision || (resultRemote && resultRemote.revision));
      if (!revision) {
        return { ok: false, retry: true, code: 'cloud_revision_missing' };
      }

      writeCloudWorkbookSyncState(resolvedSyncStorage, currentUserId, currentWorkbookId, {
        revision,
        conflict: false,
        remoteDeleted: false,
        ...(result.pending === true
          ? {}
          : {
              baseRevision: revision,
              baseWorkbook: entry.workbook
            })
      });
      updateWorkbookConflict(currentWorkbookId, false);
      if (resultState) applyRemoteState(resultState);
      else await refreshState();
      return { ...result, retry: false };
    },
    [
      applyRemoteState,
      conflictedWorkbookIdsRef,
      invoke,
      reconcileWorkbookBranches,
      refreshState,
      resolvedSyncStorage,
      stateRef,
      updateWorkbookConflict
    ]
  );
}
