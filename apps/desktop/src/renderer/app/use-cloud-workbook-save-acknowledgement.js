import { useEffect, useRef, useState } from 'react';
import {
  readCloudWorkbookAutoSyncPreference,
  readCloudWorkbookSyncState,
  writeCloudWorkbookSyncState
} from './cloud-workbook-sync-state.js';
import { asString, stateFromResult } from './cloud-workbook-model.js';

export function isCloudWorkbookSyncReady({
  state,
  userId,
  workbookId,
  storage,
  durableStorage,
  accountBoundary
}) {
  const acknowledgement = state.workbookSaveAcknowledgements?.find(
    (entry) => entry.userId === userId && entry.workbookId === workbookId
  );
  const anchor = readCloudWorkbookSyncState(storage, userId, workbookId);
  return (
    !(acknowledgement && acknowledgement.revision > (anchor.revision || 0)) &&
    !(accountBoundary?.userId === userId && accountBoundary?.workbookId === workbookId) &&
    (!durableStorage ||
      durableStorage.status({
        userId,
        workbookId,
        cloudEnvironment: asString(state.cloudEnvironment)
      }) === 'ready')
  );
}

// A receipt acknowledges a particular outbox save, including one completed
// after relaunch. Verify that exact server snapshot before advancing its merge
// base. Merely seeing a newer library revision cannot establish this baseline.
export function useCloudWorkbookSaveAcknowledgement({
  cloudState,
  workbook,
  uiState,
  stateRef,
  workbookRef,
  saveStatusRef,
  resolvedSyncStorage,
  syncAnchorHydrated,
  accountChangePending,
  pendingOperationRef,
  autoSyncSchedulerRef,
  invoke,
  applyRemoteState,
  flushDurableSyncState,
  setUiState,
  emptyState
}) {
  const inFlight = useRef('');
  const failedAttempt = useRef('');
  const mounted = useRef(true);
  const [changedReceipt, setChangedReceipt] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const userId = asString(cloudState.user?.id);
  const workbookId = asString(workbook?.id);
  const acknowledgement = cloudState.workbookSaveAcknowledgements?.find(
    (entry) => entry.userId === userId && entry.workbookId === workbookId
  );
  const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId);
  const key = acknowledgement ? `${cloudState.sessionGeneration}:${acknowledgement.id}` : '';
  const eligible = !!(
    key &&
    cloudState.status === 'signed_in' &&
    !accountChangePending &&
    !syncState.conflict &&
    !syncState.remoteDeleted
  );
  const needsBase =
    eligible && acknowledgement.revision > (syncState.revision || 0) && changedReceipt !== key;

  useEffect(() => {
    if (!eligible || !syncAnchorHydrated || !mounted.current) return;
    if (['refresh', 'retry-sync-state'].includes(uiState.pendingOperation))
      failedAttempt.current = '';
    if (inFlight.current || pendingOperationRef.current) return;
    const scopeCurrent = () =>
      mounted.current &&
      stateRef.current.status === 'signed_in' &&
      stateRef.current.sessionGeneration === cloudState.sessionGeneration &&
      asString(stateRef.current.user?.id) === userId &&
      asString(workbookRef.current?.id) === workbookId;
    const clearFailure = () => {
      if (!scopeCurrent()) return;
      setUiState((current) =>
        current.errorSaveOperationId === acknowledgement.id &&
        (['upload', 'keep-local', 'reconcile'].includes(
          asString(current.errorOperation || current.failedOperation)
        ) ||
          current.errorCode === 'cloud_save_confirmation_failed')
          ? { ...emptyState, pendingOperation: current.pendingOperation }
          : current
      );
    };
    if (failedAttempt.current === key && !uiState.error && !uiState.errorSaveOperationId)
      failedAttempt.current = '';
    if (failedAttempt.current === key) return;
    if (!needsBase) {
      if (syncState.revision >= acknowledgement.revision) clearFailure();
      return;
    }
    if (autoSyncSchedulerRef.current?.getStatus().active) return;
    autoSyncSchedulerRef.current?.cancelPending();
    inFlight.current = key;
    const fail = (result) => {
      failedAttempt.current = key;
      if (!scopeCurrent()) return;
      setUiState((current) =>
        current.pendingOperation ||
        (current.error && current.errorSaveOperationId !== acknowledgement.id)
          ? current
          : {
              ...emptyState,
              pendingOperation: current.pendingOperation,
              error:
                result?.error ||
                'Cavalry could not verify the completed iCloud save. Your Mac copy is safe.',
              errorCode: 'cloud_save_confirmation_failed',
              errorDetails: result?.errorDetails || '',
              errorRetryable: true,
              errorOperation: 'sync-state',
              errorWorkbookId: workbookId,
              failedOperation: 'sync-state',
              failedWorkbookId: workbookId,
              errorSaveOperationId: acknowledgement.id
            }
      );
    };
    void (async () => {
      const result = await invoke('downloadWorkbook', { workbookId, expectedUserId: userId });
      if (!scopeCurrent()) return;
      const remoteState = stateFromResult(result);
      if (remoteState) applyRemoteState(remoteState);
      if (!scopeCurrent()) return;
      if (!result?.ok) return fail(result);
      if (result.metadata?.id !== workbookId || result.workbook?.id !== workbookId) return fail();
      if (result.metadata.revision !== acknowledgement.revision) {
        // Another device changed the record after this save. Keep the existing
        // branch comparison/conflict path; never bless a different snapshot.
        setChangedReceipt(key);
        return;
      }
      const current = readCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId);
      if (current.conflict || current.remoteDeleted || current.revision > acknowledgement.revision)
        return;
      writeCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId, {
        revision: acknowledgement.revision,
        conflict: false,
        remoteDeleted: false,
        baseRevision: acknowledgement.revision,
        baseWorkbook: result.workbook
      });
      const persisted = await flushDurableSyncState(userId, workbookId);
      if (!scopeCurrent()) return;
      if (!persisted?.ok) return fail(persisted);
      failedAttempt.current = '';
      clearFailure();
      const local = workbookRef.current;
      if (
        readCloudWorkbookAutoSyncPreference(resolvedSyncStorage, userId, workbookId) &&
        ['saved', 'cache'].includes(asString(saveStatusRef.current)) &&
        JSON.stringify(local) !== JSON.stringify(result.workbook)
      ) {
        // Local edits made while the upload was queued are still authoritative
        // local work. Send them separately using the newly verified base.
        autoSyncSchedulerRef.current?.enqueue({ userId, workbookId, workbook: local });
      }
    })()
      .catch(fail)
      .finally(() => {
        if (inFlight.current === key) inFlight.current = '';
      });
  }, [
    acknowledgement,
    accountChangePending,
    applyRemoteState,
    autoSyncSchedulerRef,
    cloudState.sessionGeneration,
    eligible,
    emptyState,
    flushDurableSyncState,
    invoke,
    key,
    needsBase,
    pendingOperationRef,
    resolvedSyncStorage,
    saveStatusRef,
    setUiState,
    stateRef,
    syncAnchorHydrated,
    syncState.revision,
    uiState.pendingOperation,
    uiState.errorSaveOperationId,
    uiState.error,
    userId,
    workbookId,
    workbookRef
  ]);
  return needsBase;
}
