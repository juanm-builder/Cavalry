import { useCallback } from 'react';

import {
  readCloudWorkbookSyncState,
  writeCloudWorkbookAutoSyncPreference,
  writeCloudWorkbookSyncState
} from './cloud-workbook-sync-state.js';
import { reconcileReviewedCloudWorkbookConflict } from './cloud-workbook-branch-reconciler.js';
import {
  asObject,
  asRevision,
  asString,
  errorDetailsFromResult,
  errorMessageFromResult,
  normalizeCloudState,
  normalizeConflictNotice,
  stateFromResult
} from './cloud-workbook-model.js';

export function useCloudWorkbookOperations({
  applyRemoteState,
  autoSyncSchedulerRef,
  browserCache,
  clearSharedConflictNotice,
  conflictedWorkbookIdsRef,
  durableSyncStorage,
  emptyCloudUiState: EMPTY_CLOUD_UI_STATE,
  ensureDurableSyncState,
  flushDurableSyncState,
  initialEnrollmentRef,
  invoke: invokeRaw,
  localConflictNoticeRef,
  navigate,
  pendingOperationRef,
  persistMergedWorkbook,
  publishConflictReport,
  reconcileWorkbookBranches,
  refreshState,
  resolvedSyncStorage,
  saveStatusRef,
  saveWorkbook,
  setAutoSyncPreferenceEpoch,
  setLocalConflictNotice,
  setUiState,
  setWorkbook,
  stateRef,
  updateWorkbookConflict,
  verifyRemoteWorkbookIntegrity,
  workbookRef,
  workbookStorage
}) {
  return useCallback(
    async (operation, payload = {}) => {
      const operationName = asString(operation);
      const operationUserId = asString(stateRef.current.user?.id);
      const invoke = (command, request = {}) =>
        invokeRaw(command, { ...request, expectedUserId: operationUserId });
      const operationWorkbookId = [
        'refresh',
        'connect',
        'disconnect',
        'select-account',
        'sign-out'
      ].includes(operationName)
        ? ''
        : asString(payload.workbookId || payload.id || workbookRef.current?.id);
      const operationWorkbookName =
        asString(
          stateRef.current.workbooks.find((item) => item.id === operationWorkbookId)?.name
        ) ||
        (operationWorkbookId === asString(workbookRef.current?.id)
          ? asString(workbookRef.current?.name)
          : '');
      if (operationName === 'cancel-sign-in') return invoke('cancelAccountSignIn');
      if (pendingOperationRef.current) {
        return {
          ok: false,
          code: 'cloud_operation_in_progress',
          error: 'Another iCloud operation is already in progress.'
        };
      }
      if (operationName === 'set-auto-sync') {
        const currentWorkbook = workbookRef.current;
        const workbookId = asString(currentWorkbook && currentWorkbook.id);
        const userId = asString(stateRef.current.user && stateRef.current.user.id);
        if (!(userId && workbookId)) {
          return {
            ok: false,
            code: 'cloud_auto_sync_unavailable',
            error: 'Open a workbook and connect iCloud first.'
          };
        }
        const hydrated = await ensureDurableSyncState(userId, workbookId);
        if (!(hydrated && hydrated.ok)) {
          const error =
            asString(hydrated && hydrated.error) ||
            'Cavalry could not load its local iCloud sync state. Your workbook is safe.';
          setUiState({
            ...EMPTY_CLOUD_UI_STATE,
            error,
            errorCode: asString(hydrated && hydrated.code) || 'cloud_sync_state_unavailable',
            errorRetryable: true,
            errorOperation: 'sync-state',
            errorWorkbookId: workbookId
          });
          return { ...(hydrated || {}), ok: false, error };
        }
        const enabled = Object.prototype.hasOwnProperty.call(payload, 'enabled')
          ? payload.enabled !== false
          : payload.checked !== false;
        autoSyncSchedulerRef.current?.cancelPending();
        if (enabled) {
          const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId);
          if (syncState.remoteDeleted === true) {
            setUiState({
              ...EMPTY_CLOUD_UI_STATE,
              error: 'Add this workbook to iCloud before turning autosave on.',
              errorCode: 'cloud_workbook_relink_required',
              errorRetryable: false,
              errorOperation: 'upload',
              errorWorkbookId: workbookId
            });
            return {
              ok: false,
              code: 'cloud_workbook_relink_required',
              error: 'Add this workbook to iCloud before turning autosave on.'
            };
          }
        }
        writeCloudWorkbookAutoSyncPreference(resolvedSyncStorage, userId, workbookId, enabled);
        const durableResult = await flushDurableSyncState(userId, workbookId);
        if (!(durableResult && durableResult.ok)) {
          const error =
            asString(durableResult && durableResult.error) ||
            'Cavalry could not save its local iCloud autosave setting.';
          setUiState({
            ...EMPTY_CLOUD_UI_STATE,
            error,
            errorCode:
              asString(durableResult && durableResult.code) || 'cloud_sync_state_save_failed',
            errorRetryable: true,
            errorOperation: 'sync-state',
            errorWorkbookId: workbookId
          });
          return { ...(durableResult || {}), ok: false, error };
        }
        if (enabled) {
          initialEnrollmentRef.current = '';
          if (
            stateRef.current.status === 'signed_in' &&
            ['saved', 'cache'].includes(asString(saveStatusRef.current))
          ) {
            autoSyncSchedulerRef.current?.enqueue({
              userId,
              workbookId,
              workbook: currentWorkbook
            });
          }
        }
        setAutoSyncPreferenceEpoch((current) => current + 1);
        setUiState({
          ...EMPTY_CLOUD_UI_STATE,
          notice: enabled ? 'iCloud autosave is on.' : 'iCloud autosave is off.'
        });
        return { ok: true, enabled };
      }
      if (!['refresh', 'retry-sync-state'].includes(operationName) && durableSyncStorage) {
        const userId = asString(stateRef.current.user && stateRef.current.user.id);
        if (userId && operationWorkbookId) {
          const hydrated = await ensureDurableSyncState(userId, operationWorkbookId);
          if (!(hydrated && hydrated.ok)) {
            const error =
              asString(hydrated && hydrated.error) ||
              'Cavalry could not load its local iCloud sync state. Your workbook is safe.';
            setUiState({
              ...EMPTY_CLOUD_UI_STATE,
              error,
              errorCode: asString(hydrated && hydrated.code) || 'cloud_sync_state_unavailable',
              errorRetryable: true,
              errorOperation: 'sync-state',
              errorWorkbookId: operationWorkbookId,
              errorWorkbookName: operationWorkbookName,
              failedOperation: operationName,
              failedWorkbookId: operationWorkbookId
            });
            return { ...(hydrated || {}), ok: false, error };
          }
        }
      }
      pendingOperationRef.current = operationName || 'unknown';
      setUiState({
        ...EMPTY_CLOUD_UI_STATE,
        pendingOperation: operationName,
        errorOperation: operationName,
        errorWorkbookId: operationWorkbookId,
        errorWorkbookName: operationWorkbookName
      });
      let result;
      let uploadSyncContext = null;
      let openSyncContext = null;
      let deleteSyncContext = null;
      try {
        if (['select-account', 'sign-out'].includes(operationName)) {
          autoSyncSchedulerRef.current?.cancelPending();
          const currentWorkbook = workbookRef.current;
          if (currentWorkbook) {
            const saved =
              typeof saveWorkbook === 'function' ? await saveWorkbook(currentWorkbook) : null;
            if (!saved?.ok)
              throw new Error(
                saved?.error || 'Save this workbook on your Mac before changing accounts.'
              );
          }
          result =
            operationName === 'select-account'
              ? await invoke('selectAccount', { source: asString(payload.source) })
              : await invoke('signOut');
        } else if (operationName === 'refresh') {
          result = await invoke('listWorkbooks');
        } else if (operationName === 'connect' || operationName === 'disconnect') {
          autoSyncSchedulerRef.current?.cancelPending();
          result = await invoke('setConnection', { enabled: operationName === 'connect' });
        } else if (operationName === 'retry-sync-state') {
          const userId = asString(stateRef.current.user?.id);
          const workbookId = asString(workbookRef.current?.id);
          if (!(userId && workbookId)) {
            result = {
              ok: false,
              code: 'cloud_sync_state_scope_invalid',
              error: 'Open a workbook and connect iCloud first.'
            };
          } else {
            result = await ensureDurableSyncState(userId, workbookId);
            if (result && result.ok) result = await flushDurableSyncState(userId, workbookId);
            if (
              result &&
              result.ok &&
              (asString(stateRef.current.user?.id) !== userId ||
                asString(workbookRef.current?.id) !== workbookId)
            ) {
              result = {
                ok: false,
                code: 'cloud_sync_scope_changed',
                error: 'The open iCloud workbook changed while Cavalry was recovering sync.'
              };
            }
          }
        } else if (operationName === 'upload') {
          const currentWorkbook = workbookRef.current;
          const currentWorkbookId = asString(currentWorkbook && currentWorkbook.id);
          const userId = asString(stateRef.current.user && stateRef.current.user.id);
          if (!currentWorkbookId) {
            result = { ok: false, error: 'Open a workbook before adding it to iCloud.' };
          } else if (!userId) {
            result = { ok: false, error: 'Sign in to iCloud in System Settings first.' };
          } else {
            const remote = stateRef.current.workbooks.find((item) => item.id === currentWorkbookId);
            const syncState = readCloudWorkbookSyncState(
              resolvedSyncStorage,
              userId,
              currentWorkbookId
            );
            uploadSyncContext = {
              userId,
              workbookId: currentWorkbookId,
              revision: syncState.revision,
              workbook: currentWorkbook,
              remoteDeleted: syncState.remoteDeleted === true
            };
            if (conflictedWorkbookIdsRef.current.has(currentWorkbookId) || syncState.conflict) {
              writeCloudWorkbookSyncState(resolvedSyncStorage, userId, currentWorkbookId, {
                revision: syncState.revision,
                conflict: true
              });
              updateWorkbookConflict(currentWorkbookId, true);
              result = {
                ok: false,
                code: 'workbook_revision_conflict',
                conflict: true,
                error:
                  'The iCloud copy changed. Save this local workbook, then review the iCloud copy before uploading again.'
              };
            } else if (syncState.revision && (!remote || remote.revision < syncState.revision)) {
              const verified = await verifyRemoteWorkbookIntegrity({
                userId,
                workbookId: currentWorkbookId,
                listedRemote: remote,
                syncState
              });
              if (verified?.remoteDeleted === true) {
                result = {
                  ok: false,
                  code: 'cloud_workbook_relink_required',
                  error:
                    'This workbook was removed from iCloud. Your Mac copy is safe. Choose Add to iCloud to relink it.'
                };
              } else if (!(verified && verified.ok)) {
                result = verified;
              } else {
                result = await reconcileWorkbookBranches({
                  userId,
                  workbookId: currentWorkbookId,
                  localWorkbook: currentWorkbook,
                  syncState
                });
              }
            } else if (
              remote &&
              (remote.conflict ||
                !syncState.known ||
                !syncState.revision ||
                remote.revision !== syncState.revision)
            ) {
              result = await reconcileWorkbookBranches({
                userId,
                workbookId: currentWorkbookId,
                localWorkbook: currentWorkbook,
                syncState
              });
            } else {
              result = await invoke('uploadWorkbook', {
                workbook: currentWorkbook,
                expectedRevision:
                  syncState.remoteDeleted === true
                    ? null
                    : syncState.known
                      ? syncState.revision
                      : null,
                ...(syncState.remoteDeleted === true ? { conflictResolution: 'keep_local' } : {})
              });
              const metadataId = asString(asObject(result && result.metadata).id);
              if (result && result.ok && metadataId && metadataId !== currentWorkbookId) {
                result = {
                  ok: false,
                  code: 'cloud_workbook_identity_mismatch',
                  error: 'The saved iCloud workbook identity did not match.'
                };
              }
              if (
                result &&
                (result.conflict === true || result.code === 'workbook_revision_conflict') &&
                (stateFromResult(result)
                  ? normalizeCloudState(stateFromResult(result)).workbooks
                  : stateRef.current.workbooks
                ).some((item) => item.id === currentWorkbookId)
              ) {
                result = await reconcileWorkbookBranches({
                  userId,
                  workbookId: currentWorkbookId,
                  localWorkbook: currentWorkbook,
                  syncState
                });
              }
            }
          }
        } else if (operationName === 'keep-local') {
          const currentWorkbook = workbookRef.current;
          const currentWorkbookId = asString(currentWorkbook && currentWorkbook.id);
          const userId = asString(stateRef.current.user && stateRef.current.user.id);
          const saveBeforeReplaceMessage =
            'Save this Mac copy to its workbook file before replacing the iCloud copy.';
          if (!currentWorkbookId) {
            result = { ok: false, error: 'Open a workbook before resolving this conflict.' };
          } else if (!userId) {
            result = { ok: false, error: 'Sign in to iCloud in System Settings first.' };
          } else if (asString(saveStatusRef.current) !== 'saved') {
            result = { ok: false, error: saveBeforeReplaceMessage };
          } else {
            const backingFile =
              workbookStorage && typeof workbookStorage.load === 'function'
                ? await workbookStorage.load()
                : null;
            if (!(
              backingFile &&
              backingFile.status === 'loaded' &&
              asString(backingFile.workbook && backingFile.workbook.id) === currentWorkbookId
            )) {
              result = { ok: false, error: saveBeforeReplaceMessage };
            } else {
              const listed = await invoke('listWorkbooks');
              const listedState = stateFromResult(listed);
              if (listedState) applyRemoteState(listedState);
              if (!(listed && listed.ok)) {
                result = listed;
              } else {
                const reviewedRemote = stateRef.current.workbooks.find(
                  (item) => item.id === currentWorkbookId
                );
                uploadSyncContext = {
                  userId,
                  workbookId: currentWorkbookId,
                  revision: reviewedRemote ? reviewedRemote.revision : null,
                  workbook: currentWorkbook
                };
                result = await invoke('uploadWorkbook', {
                  workbook: currentWorkbook,
                  expectedRevision: reviewedRemote ? reviewedRemote.revision : null,
                  conflictResolution: 'keep_local'
                });
                const metadataId = asString(asObject(result && result.metadata).id);
                if (result && result.ok && metadataId && metadataId !== currentWorkbookId) {
                  result = {
                    ok: false,
                    code: 'cloud_workbook_identity_mismatch',
                    error: 'The saved iCloud workbook identity did not match.'
                  };
                }
              }
            }
          }
        } else if (operationName === 'reconcile') {
          const currentWorkbook = workbookRef.current;
          const currentWorkbookId = asString(currentWorkbook && currentWorkbook.id);
          const userId = asString(stateRef.current.user && stateRef.current.user.id);
          const sharedConflictNotice = stateRef.current.workbooks.find(
            (item) => item.id === currentWorkbookId
          )?.conflictNotice;
          const reconciliation = await reconcileReviewedCloudWorkbookConflict({
            currentWorkbook,
            userId,
            notice:
              normalizeConflictNotice(localConflictNoticeRef.current, currentWorkbookId) ||
              sharedConflictNotice ||
              null,
            payload,
            invoke,
            applyRemoteState,
            persistMergedWorkbook: (expected, merged) =>
              persistMergedWorkbook(expected, merged, operationUserId),
            publishConflictReport: (report) =>
              publishConflictReport({ ...report, expectedUserId: operationUserId })
          });
          result = reconciliation.result;
          uploadSyncContext = reconciliation.uploadSyncContext || null;
        } else if (operationName === 'open') {
          const workbookId = asString(payload.workbookId);
          const currentWorkbook = workbookRef.current;
          openSyncContext = {
            userId: asString(stateRef.current.user && stateRef.current.user.id),
            workbookId,
            resolvingConflict: conflictedWorkbookIdsRef.current.has(workbookId)
          };
          const resolvingConflict = openSyncContext.resolvingConflict;
          const saveBeforeOpenMessage = resolvingConflict
            ? 'Save this local workbook to a file before opening the newer iCloud copy.'
            : 'Save the current workbook to a file before opening a different iCloud workbook.';
          if (!workbookId) {
            result = { ok: false, error: 'Choose an iCloud workbook to open.' };
          } else if (
            currentWorkbook &&
            asString(currentWorkbook.id) === workbookId &&
            !resolvingConflict
          ) {
            result = { ok: false, error: 'That iCloud workbook is already open.' };
          } else if (currentWorkbook && asString(saveStatusRef.current) !== 'saved') {
            result = {
              ok: false,
              error: saveBeforeOpenMessage
            };
          } else {
            let backingFile = null;
            if (currentWorkbook && workbookStorage && typeof workbookStorage.load === 'function') {
              backingFile = await workbookStorage.load();
            }
            if (backingFile?.status !== 'loaded' && typeof browserCache?.load === 'function') {
              const localCopy = await browserCache.load();
              if (localCopy?.source === 'recovery') backingFile = localCopy;
            }
            if (
              currentWorkbook &&
              !(
                backingFile &&
                backingFile.status === 'loaded' &&
                asString(backingFile.workbook && backingFile.workbook.id) ===
                  asString(currentWorkbook.id)
              )
            ) {
              result = {
                ok: false,
                error: saveBeforeOpenMessage
              };
            } else {
              result = await invoke('downloadWorkbook', { workbookId });
            }
          }
          if (result && result.ok && result.workbook) {
            let openedSaveStatus = 'cache';
            if (asString(result.workbook.id) !== workbookId) {
              result = { ok: false, error: 'The downloaded workbook identity did not match.' };
            } else {
              const cacheResult =
                browserCache && typeof browserCache.save === 'function'
                  ? await browserCache.save(result.workbook)
                  : { ok: false, unavailable: true };
              if (cacheResult?.ok && cacheResult.durable) openedSaveStatus = 'saved';
              if (cacheResult && cacheResult.ok === false && !cacheResult.unavailable) {
                result = {
                  ok: false,
                  error: 'Cavalry could not cache the iCloud workbook safely.'
                };
              }
            }
            if (result && result.ok && result.workbook) {
              const forgetResult =
                workbookStorage && typeof workbookStorage.forget === 'function'
                  ? await workbookStorage.forget()
                  : { ok: true };
              if (forgetResult && forgetResult.ok === false && !forgetResult.unavailable) {
                result = {
                  ok: false,
                  error: 'Cavalry could not disconnect the current file before opening iCloud.'
                };
              } else {
                if (typeof setWorkbook === 'function') {
                  setWorkbook(result.workbook, {
                    source: 'cloud',
                    markDirty: false,
                    saveStatus: openedSaveStatus
                  });
                }
                if (typeof navigate === 'function') navigate('dashboard');
              }
            }
          }
        } else if (operationName === 'delete') {
          const workbookId = asString(payload.workbookId);
          deleteSyncContext = {
            userId: asString(stateRef.current.user && stateRef.current.user.id),
            workbookId
          };
          result = workbookId
            ? await invoke('deleteWorkbook', { workbookId })
            : { ok: false, error: 'Choose an iCloud workbook to remove.' };
        } else {
          result = { ok: false, error: 'The requested cloud operation is unavailable.' };
        }

        const resultState = stateFromResult(result);
        let nextCloudState = null;
        if (resultState) nextCloudState = applyRemoteState(resultState);
        else if (result && result.ok && operationName !== 'open') {
          await refreshState();
          nextCloudState = stateRef.current;
        }

        if (
          ['upload', 'keep-local', 'reconcile'].includes(operationName) &&
          result &&
          (result.conflict === true || result.code === 'workbook_revision_conflict')
        ) {
          const currentWorkbookId = asString(
            (uploadSyncContext && uploadSyncContext.workbookId) ||
              (workbookRef.current && workbookRef.current.id)
          );
          const remoteStillExists = (nextCloudState || stateRef.current).workbooks.some(
            (item) => item.id === currentWorkbookId
          );
          updateWorkbookConflict(currentWorkbookId, true);
          if (uploadSyncContext) {
            writeCloudWorkbookSyncState(
              resolvedSyncStorage,
              uploadSyncContext.userId,
              uploadSyncContext.workbookId,
              {
                revision: remoteStillExists ? uploadSyncContext.revision : null,
                conflict: true
              }
            );
            const durableResult = await flushDurableSyncState(
              uploadSyncContext.userId,
              uploadSyncContext.workbookId
            );
            if (!(durableResult && durableResult.ok)) {
              result = {
                ...(durableResult || {}),
                ok: false,
                error:
                  asString(durableResult && durableResult.error) ||
                  'Cavalry could not save its local iCloud conflict state.'
              };
            }
          }
          if (
            result &&
            (result.conflict === true || result.code === 'workbook_revision_conflict')
          ) {
            result = {
              ...result,
              error: remoteStillExists
                ? 'The iCloud version changed. Choose which version to keep before syncing again.'
                : 'The iCloud copy was deleted. Your Mac copy is safe. Choose Add to iCloud to relink it.'
            };
          }
        } else if (
          ['upload', 'keep-local', 'reconcile'].includes(operationName) &&
          result &&
          result.ok
        ) {
          const currentWorkbookId = asString(uploadSyncContext && uploadSyncContext.workbookId);
          const userId = asString(uploadSyncContext && uploadSyncContext.userId);
          const remote = (nextCloudState || stateRef.current).workbooks.find(
            (item) => item.id === currentWorkbookId
          );
          const revision = asRevision(
            asObject(result.metadata).revision || (remote && remote.revision)
          );
          if (userId && currentWorkbookId && revision) {
            writeCloudWorkbookSyncState(resolvedSyncStorage, userId, currentWorkbookId, {
              revision,
              conflict: false,
              remoteDeleted: false,
              ...(result.pending === true
                ? {}
                : {
                    baseRevision: revision,
                    baseWorkbook: result.workbook || uploadSyncContext.workbook
                  })
            });
            if (uploadSyncContext.remoteDeleted === true) {
              writeCloudWorkbookAutoSyncPreference(
                resolvedSyncStorage,
                userId,
                currentWorkbookId,
                true
              );
              setAutoSyncPreferenceEpoch((current) => current + 1);
            }
          }
          updateWorkbookConflict(currentWorkbookId, false);
          if (['keep-local', 'reconcile'].includes(operationName)) {
            await clearSharedConflictNotice(currentWorkbookId, operationUserId);
          }
        } else if (operationName === 'open' && result && result.ok) {
          const workbookId = asString(openSyncContext && openSyncContext.workbookId);
          const userId = asString(openSyncContext && openSyncContext.userId);
          const remote = (nextCloudState || stateRef.current).workbooks.find(
            (item) => item.id === workbookId
          );
          const revision = asRevision(
            asObject(result.metadata).revision || (remote && remote.revision)
          );
          if (userId && workbookId && revision) {
            writeCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId, {
              revision,
              conflict: false,
              remoteDeleted: false,
              baseRevision: revision,
              baseWorkbook: result.workbook
            });
          }
          updateWorkbookConflict(workbookId, false);
          if (openSyncContext?.resolvingConflict) {
            await clearSharedConflictNotice(workbookId, operationUserId);
          }
        } else if (operationName === 'delete' && result && result.ok) {
          const workbookId = asString(deleteSyncContext && deleteSyncContext.workbookId);
          const userId = asString(deleteSyncContext && deleteSyncContext.userId);
          writeCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId, {
            revision: null,
            conflict: false,
            remoteDeleted: true,
            baseWorkbook: null
          });
          if (workbookId === asString(workbookRef.current?.id)) {
            writeCloudWorkbookAutoSyncPreference(resolvedSyncStorage, userId, workbookId, false);
            autoSyncSchedulerRef.current?.cancelPending();
            setAutoSyncPreferenceEpoch((current) => current + 1);
          }
          updateWorkbookConflict(workbookId, false);
          if (asString(localConflictNoticeRef.current?.report?.workbookId) === workbookId) {
            localConflictNoticeRef.current = null;
            setLocalConflictNotice(null);
          }
        }

        if (result && result.ok && !['refresh', 'retry-sync-state'].includes(operationName)) {
          const durableUserId = asString(
            uploadSyncContext?.userId ||
              openSyncContext?.userId ||
              deleteSyncContext?.userId ||
              stateRef.current.user?.id
          );
          const durableWorkbookId = asString(
            uploadSyncContext?.workbookId ||
              openSyncContext?.workbookId ||
              deleteSyncContext?.workbookId ||
              operationWorkbookId
          );
          if (durableUserId && durableWorkbookId) {
            const durableResult = await flushDurableSyncState(durableUserId, durableWorkbookId);
            if (!(durableResult && durableResult.ok)) {
              result = {
                ...(durableResult || {}),
                ok: false,
                remoteCommitted: true,
                error:
                  asString(durableResult && durableResult.error) ||
                  'The iCloud change completed, but Cavalry could not save its local sync state.'
              };
            }
          }
        }

        if (!(result && result.ok)) {
          const error = errorMessageFromResult(result) || 'The cloud request failed.';
          const failedOperation =
            operationName === 'retry-sync-state' ? 'sync-state' : operationName;
          setUiState({
            ...EMPTY_CLOUD_UI_STATE,
            pendingOperation: '',
            error,
            errorCode: asString(result && result.code),
            errorDetails: errorDetailsFromResult(result),
            errorRetryable: result && result.retryable === true,
            errorOperation: asString(result && result.errorOperation) || failedOperation,
            errorWorkbookId: asString(result && result.errorWorkbookId) || operationWorkbookId,
            errorWorkbookName: operationWorkbookName,
            errorStateSyncAt: asString(stateRef.current.lastSyncAt),
            failedOperation,
            failedWorkbookId: operationWorkbookId
          });
          return { ...(result || {}), ok: false, error };
        }

        const notices = {
          refresh: 'iCloud workbooks refreshed.',
          connect: 'iCloud syncing resumed.',
          disconnect: 'iCloud syncing paused.',
          'select-account': 'Account connected. Local copies have been kept.',
          'sign-out': 'Signed out of Cavalry’s iCloud connection. Saved copies have been kept.',
          upload: result.pending
            ? 'Workbook saved locally and queued for iCloud.'
            : 'Workbook saved to iCloud.',
          'keep-local': result.pending
            ? 'Mac copy kept and queued for iCloud.'
            : 'Mac copy kept in iCloud.',
          reconcile: result.pending
            ? 'Resolution saved and queued for iCloud.'
            : 'Changes reconciled and synced.',
          'retry-sync-state': 'iCloud sync recovered.',
          open: 'iCloud workbook opened.',
          delete: result.pending
            ? 'Workbook removal queued for iCloud.'
            : 'Workbook removed from iCloud.'
        };
        setUiState({
          ...EMPTY_CLOUD_UI_STATE,
          pendingOperation: '',
          notice: notices[operationName] || '',
          errorOperation: '',
          errorWorkbookId: ''
        });
        return result;
      } catch (error) {
        const message = error && error.message ? error.message : 'The iCloud request failed.';
        setUiState({
          ...EMPTY_CLOUD_UI_STATE,
          pendingOperation: '',
          error: message,
          errorCode: 'cloud_request_failed',
          errorRetryable: true,
          errorOperation: operationName,
          errorWorkbookId: operationWorkbookId,
          errorWorkbookName: operationWorkbookName,
          errorStateSyncAt: asString(stateRef.current.lastSyncAt),
          failedOperation: operationName,
          failedWorkbookId: operationWorkbookId
        });
        return { ok: false, error: message };
      } finally {
        pendingOperationRef.current = '';
      }
    },
    [
      EMPTY_CLOUD_UI_STATE,
      applyRemoteState,
      autoSyncSchedulerRef,
      browserCache,
      clearSharedConflictNotice,
      conflictedWorkbookIdsRef,
      durableSyncStorage,
      ensureDurableSyncState,
      flushDurableSyncState,
      initialEnrollmentRef,
      invokeRaw,
      localConflictNoticeRef,
      navigate,
      pendingOperationRef,
      persistMergedWorkbook,
      publishConflictReport,
      reconcileWorkbookBranches,
      refreshState,
      resolvedSyncStorage,
      saveStatusRef,
      saveWorkbook,
      setAutoSyncPreferenceEpoch,
      setLocalConflictNotice,
      setUiState,
      setWorkbook,
      stateRef,
      updateWorkbookConflict,
      verifyRemoteWorkbookIntegrity,
      workbookRef,
      workbookStorage
    ]
  );
}
