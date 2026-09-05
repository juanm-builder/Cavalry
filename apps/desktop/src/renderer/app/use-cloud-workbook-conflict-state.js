import { useCallback } from 'react';

import {
  readCloudWorkbookSyncState,
  writeCloudWorkbookSyncState
} from './cloud-workbook-sync-state.js';
import {
  asRevision,
  asString,
  buildConflictNotice,
  conflictNoticePublicationKey,
  normalizeConflictNotice,
  stateFromResult
} from './cloud-workbook-model.js';

// Keeps conflict anchors and notices scoped to the account that created them.
export function useCloudWorkbookConflictState({
  applyRemoteState,
  conflictNoticePublicationRef,
  flushDurableSyncState,
  invoke,
  localConflictNoticeRef,
  resolvedSyncStorage,
  setLocalConflictNotice,
  stateRef,
  updateWorkbookConflict
}) {
  const publishConflictReport = useCallback(
    async ({
      workbookId,
      expectedUserId = asString(stateRef.current.user?.id),
      baseRevision,
      remoteRevision,
      review,
      sourceWorkbook,
      baseWorkbook,
      force = false
    }) => {
      const targetId = asString(workbookId);
      if (expectedUserId !== asString(stateRef.current.user?.id))
        return { ok: false, code: 'cloud_sync_scope_changed' };
      const publicationKey = conflictNoticePublicationKey(targetId, baseRevision, remoteRevision);
      if (
        !force &&
        conflictNoticePublicationRef.current === publicationKey &&
        localConflictNoticeRef.current?.resolutionAvailable === true
      ) {
        return { ok: true, notice: localConflictNoticeRef.current };
      }
      const notice = buildConflictNotice({ review, baseRevision, remoteRevision });
      const normalized = normalizeConflictNotice(notice, targetId);
      if (!normalized) return { ok: false, code: 'invalid_conflict_notice' };
      conflictNoticePublicationRef.current = publicationKey;
      localConflictNoticeRef.current = normalized;
      setLocalConflictNotice(normalized);
      const result = await invoke('publishConflictNotice', {
        expectedUserId,
        workbookId: targetId,
        conflictNotice: normalized,
        sourceWorkbook,
        baseWorkbook
      });
      if (expectedUserId !== asString(stateRef.current.user?.id))
        return { ok: false, code: 'cloud_sync_scope_changed' };
      const resultState = stateFromResult(result);
      if (resultState) applyRemoteState(resultState);
      if (expectedUserId !== asString(stateRef.current.user?.id))
        return { ok: false, code: 'cloud_sync_scope_changed' };
      if (!(result && result.ok)) {
        conflictNoticePublicationRef.current = '';
        const unavailableNotice = { ...normalized, resolutionAvailable: false };
        localConflictNoticeRef.current = unavailableNotice;
        setLocalConflictNotice(unavailableNotice);
      } else {
        const userId = expectedUserId;
        if (userId && userId === asString(stateRef.current.user?.id)) {
          const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, userId, targetId);
          writeCloudWorkbookSyncState(resolvedSyncStorage, userId, targetId, {
            revision: syncState.revision,
            conflict: true,
            conflictNoticeId: normalized.id,
            conflictRemoteRevision: normalized.remoteRevision
          });
          const durableResult = await flushDurableSyncState(userId, targetId);
          if (!(durableResult && durableResult.ok)) return durableResult;
        }
      }
      return result;
    },
    [
      applyRemoteState,
      conflictNoticePublicationRef,
      flushDurableSyncState,
      invoke,
      localConflictNoticeRef,
      resolvedSyncStorage,
      setLocalConflictNotice,
      stateRef
    ]
  );

  const clearSharedConflictNotice = useCallback(
    async (workbookId, expectedUserId = asString(stateRef.current.user?.id)) => {
      const targetId = asString(workbookId);
      if (expectedUserId !== asString(stateRef.current.user?.id))
        return { ok: false, code: 'cloud_sync_scope_changed' };
      conflictNoticePublicationRef.current = '';
      localConflictNoticeRef.current = null;
      setLocalConflictNotice(null);
      if (!targetId) return { ok: false, code: 'invalid_workbook_id' };
      const result = await invoke('clearConflictNotice', { workbookId: targetId, expectedUserId });
      if (expectedUserId !== asString(stateRef.current.user?.id))
        return { ok: false, code: 'cloud_sync_scope_changed' };
      const resultState = stateFromResult(result);
      if (resultState) applyRemoteState(resultState);
      if (expectedUserId !== asString(stateRef.current.user?.id))
        return { ok: false, code: 'cloud_sync_scope_changed' };
      return result;
    },
    [
      applyRemoteState,
      conflictNoticePublicationRef,
      invoke,
      localConflictNoticeRef,
      setLocalConflictNotice,
      stateRef
    ]
  );

  const latchWorkbookConflict = useCallback(
    async (userId, workbookId, revision) => {
      const ownerId = asString(userId);
      const targetId = asString(workbookId);
      if (!(ownerId && targetId)) return { ok: false, code: 'cloud_sync_state_scope_invalid' };
      if (ownerId !== asString(stateRef.current.user?.id))
        return { ok: false, code: 'cloud_sync_scope_changed' };
      writeCloudWorkbookSyncState(resolvedSyncStorage, ownerId, targetId, {
        revision: asRevision(revision) || null,
        conflict: true
      });
      updateWorkbookConflict(targetId, true);
      return flushDurableSyncState(ownerId, targetId);
    },
    [flushDurableSyncState, resolvedSyncStorage, stateRef, updateWorkbookConflict]
  );

  return { publishConflictReport, clearSharedConflictNotice, latchWorkbookConflict };
}
