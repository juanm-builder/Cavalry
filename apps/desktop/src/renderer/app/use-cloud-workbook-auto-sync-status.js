import { useCallback, useState } from 'react';

import {
  asObject,
  asString,
  errorDetailsFromResult,
  errorMessageFromResult
} from './cloud-workbook-model.js';

const EMPTY_AUTO_SYNC_STATUS = Object.freeze({
  phase: 'idle',
  userId: '',
  workbookId: ''
});

const PASSIVE_AUTO_SYNC_CODES = new Set([
  'cloud_auto_sync_disabled',
  'cloud_revision_regressed',
  'cloud_sync_cancelled',
  'cloud_sync_disabled',
  'cloud_sync_scope_changed',
  'cloud_sync_state_not_ready',
  'cloud_workbook_missing',
  'not_signed_in',
  'workbook_revision_conflict'
]);

export function isPassiveCloudWorkbookAutoSyncResult(value) {
  const result = asObject(value);
  return (
    result.canceled === true ||
    result.cancelled === true ||
    result.conflict === true ||
    PASSIVE_AUTO_SYNC_CODES.has(asString(result.code))
  );
}

function normalizeStatus(value, phase) {
  const source = asObject(value);
  return {
    phase: asString(phase || source.phase) || 'idle',
    userId: asString(source.userId),
    workbookId: asString(source.workbookId)
  };
}

export function useCloudWorkbookAutoSyncStatus({
  autoSyncEnabled,
  emptyCloudUiState,
  setUiState,
  stateRef,
  workbookRef
}) {
  const [autoSyncStatus, setAutoSyncStatus] = useState(EMPTY_AUTO_SYNC_STATUS);

  const handleAutoSyncStatus = useCallback(
    (value) => {
      const status = normalizeStatus(value);
      const currentUserId = asString(stateRef.current.user?.id);
      const currentWorkbookId = asString(workbookRef.current?.id);
      if (
        !status.userId ||
        !status.workbookId ||
        status.userId !== currentUserId ||
        status.workbookId !== currentWorkbookId
      ) {
        return;
      }

      const result = asObject(value?.result);
      if (status.phase === 'failed' && isPassiveCloudWorkbookAutoSyncResult(result)) {
        setAutoSyncStatus(normalizeStatus(status, 'idle'));
        return;
      }
      if (status.phase === 'failed' && autoSyncEnabled === false) {
        setAutoSyncStatus(normalizeStatus(status, 'idle'));
        return;
      }

      setAutoSyncStatus(status);
      if (status.phase === 'failed') {
        setUiState((current) =>
          current.pendingOperation
            ? current
            : {
                ...emptyCloudUiState,
                automaticSyncError: true,
                error: errorMessageFromResult(result) || 'iCloud autosave could not finish.',
                errorCode: asString(result.code) || 'cloud_upload_failed',
                errorDetails: errorDetailsFromResult(result),
                errorRetryable: true,
                errorOperation: 'upload',
                errorWorkbookId: status.workbookId,
                failedOperation: 'upload',
                failedWorkbookId: status.workbookId,
                errorStateSyncAt: asString(stateRef.current.lastSyncAt)
              }
        );
        return;
      }

      if (result.ok === true) {
        setUiState((current) =>
          current.automaticSyncError === true &&
          asString(current.errorWorkbookId || current.failedWorkbookId) === status.workbookId
            ? { ...emptyCloudUiState, pendingOperation: current.pendingOperation }
            : current
        );
      }
    },
    [autoSyncEnabled, emptyCloudUiState, setUiState, stateRef, workbookRef]
  );

  return { autoSyncStatus, handleAutoSyncStatus };
}
