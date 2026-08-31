import { useCallback } from 'react';

import {
  readCloudWorkbookAutoSyncPreference,
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
  isSyncStateReady,
  persistSyncState,
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
      if (
        typeof isSyncStateReady === 'function' &&
        !isSyncStateReady(currentUserId, currentWorkbookId)
      ) {
        return { ok: false, retry: false, code: 'cloud_sync_state_not_ready' };
      }
      if (
        !readCloudWorkbookAutoSyncPreference(resolvedSyncStorage, currentUserId, currentWorkbookId)
      ) {
        return { ok: false, retry: false, code: 'cloud_auto_sync_disabled' };
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
      if (remote && syncState.revision && remote.revision < syncState.revision) {
        // A lower server revision can be a stale library projection or a
        // recreated record. Never use it as a merge base or report success;
        // the controller performs an exact-record verification first.
        return { ok: false, retry: false, code: 'cloud_revision_regressed' };
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
      if (typeof persistSyncState === 'function') {
        const durableResult = await persistSyncState(currentUserId, currentWorkbookId);
        if (!(durableResult && durableResult.ok)) {
          return {
            ...(durableResult || {}),
            ok: false,
            retry: false,
            remoteCommitted: true
          };
        }
      }
      updateWorkbookConflict(currentWorkbookId, false);
      if (resultState) applyRemoteState(resultState);
      else await refreshState();
      return { ...result, retry: false };
    },
    [
      applyRemoteState,
      conflictedWorkbookIdsRef,
      invoke,
      isSyncStateReady,
      persistSyncState,
      reconcileWorkbookBranches,
      refreshState,
      resolvedSyncStorage,
      stateRef,
      updateWorkbookConflict
    ]
  );
}
