import { useCallback } from 'react';
import { asString, isCloudWorkbookSyncError, normalizeCloudState } from './cloud-workbook-model.js';

export function clearCloudErrorAfterRefresh({
  current,
  previousState,
  normalized,
  workbookId,
  emptyState
}) {
  if (normalized.error || !normalized.lastSyncAt || !current.error) return current;
  const failedWorkbookId = asString(current.errorWorkbookId || current.failedWorkbookId);
  const previous = previousState.workbooks.find((item) => item.id === failedWorkbookId);
  const confirmed = normalized.workbooks.find((item) => item.id === failedWorkbookId);
  const nativeSaveAcknowledged =
    ['upload', 'keep-local', 'reconcile'].includes(
      asString(current.errorOperation || current.failedOperation)
    ) &&
    asString(previousState.user?.id) === asString(normalized.user?.id) &&
    previous?.pending === true &&
    confirmed?.pending === false &&
    confirmed.inCloud === true &&
    confirmed.revision > 0 &&
    confirmed.revision >= previous.revision;
  if (
    !nativeSaveAcknowledged &&
    (!current.errorRetryable ||
      isCloudWorkbookSyncError(current, workbookId) ||
      current.errorStateSyncAt === normalized.lastSyncAt)
  )
    return current;
  return { ...emptyState, pendingOperation: current.pendingOperation };
}

export function useCloudWorkbookRemoteState({
  stateRef,
  lastAccountRef,
  autoSyncSchedulerRef,
  workbookRef,
  accountBoundaryRef,
  setAccountBoundary,
  setCloudState,
  setUiState,
  emptyState
}) {
  return useCallback(
    (value) => {
      const previousState = stateRef.current;
      const normalized = normalizeCloudState(value);
      const nextAccount = asString(normalized.user?.id);
      const previousAccount = lastAccountRef.current;
      if (nextAccount && previousAccount && nextAccount !== previousAccount) {
        autoSyncSchedulerRef.current?.cancelPending();
        const currentWorkbookId = asString(workbookRef.current?.id);
        accountBoundaryRef.current = currentWorkbookId
          ? {
              userId: nextAccount,
              workbookId: currentWorkbookId
            }
          : null;
        setAccountBoundary(accountBoundaryRef.current);
      }
      if (nextAccount) lastAccountRef.current = nextAccount;
      stateRef.current = normalized;
      setCloudState(normalized);
      setUiState((current) =>
        clearCloudErrorAfterRefresh({
          current,
          previousState,
          normalized,
          workbookId: workbookRef.current?.id,
          emptyState
        })
      );
      return normalized;
    },
    [
      accountBoundaryRef,
      autoSyncSchedulerRef,
      emptyState,
      lastAccountRef,
      setAccountBoundary,
      setCloudState,
      setUiState,
      stateRef,
      workbookRef
    ]
  );
}
