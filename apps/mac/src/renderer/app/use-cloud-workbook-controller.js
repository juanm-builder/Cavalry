import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  readCloudWorkbookSyncState,
  removeCloudWorkbookSyncState,
  resolveCloudWorkbookSyncStorage,
  writeCloudWorkbookSyncState
} from './cloud-workbook-sync-state.js';
import { useCloudFeedbackController } from './use-cloud-feedback-controller.js';

const CLOUD_STATUSES = new Set([
  'unconfigured',
  'initializing',
  'unavailable',
  'signed_out',
  'signing_in',
  'signed_in',
  'error'
]);

const EMPTY_CLOUD_STATE = Object.freeze({
  configured: false,
  status: 'unconfigured',
  user: null,
  workbooks: [],
  sessionGeneration: 0,
  sessionPersistence: false
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asRevision(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function normalizeCloudUser(value) {
  const source = asObject(value);
  const id = asString(source.id);
  if (!id) return null;
  return {
    id,
    email: asString(source.email),
    name: asString(source.name),
    avatarUrl: asString(source.avatarUrl),
    provider: asString(source.provider || 'google')
  };
}

function normalizeCloudWorkbook(value) {
  const source = asObject(value);
  const id = asString(source.id || source.localWorkbookId || source.local_workbook_id);
  if (!id) return null;
  return {
    id,
    name: asString(source.name) || 'Untitled workbook',
    year: Number(source.year) || 0,
    currency: asString(source.currency).toUpperCase(),
    revision: asRevision(source.revision || source.latestRevision || source.latest_revision),
    updatedAt: asString(source.updatedAt || source.updated_at)
  };
}

export function normalizeCloudState(value) {
  const source = asObject(value);
  const configured = source.configured === true;
  const status = CLOUD_STATUSES.has(source.status)
    ? source.status
    : configured
      ? 'signed_out'
      : 'unconfigured';
  return {
    configured,
    status,
    user: normalizeCloudUser(source.user),
    sessionGeneration: Math.max(0, Number(source.sessionGeneration) || 0),
    workbooks: (Array.isArray(source.workbooks) ? source.workbooks : [])
      .map(normalizeCloudWorkbook)
      .filter(Boolean),
    sessionPersistence:
      source.sessionPersistence === true || source.sessionPersistence === 'secure',
    error: asString(asObject(source.error).message || source.error)
  };
}

function stateFromResult(result) {
  const source = asObject(result);
  return source.state && typeof source.state === 'object' ? source.state : null;
}

function errorMessageFromResult(result) {
  const source = asObject(result);
  const state = asObject(source.state);
  return asString(
    (typeof source.error === 'string' ? source.error : asObject(source.error).message) ||
      asObject(state.error).message
  );
}

export function buildCloudSettingsModel(cloudState, workbook, uiState = {}) {
  const state = normalizeCloudState(cloudState);
  const workbookId = asString(workbook && workbook.id);
  const remote = state.workbooks.find((item) => item.id === workbookId) || null;
  const pendingOperation = asString(uiState.pendingOperation);
  const conflict = uiState.conflict === true;
  return {
    ...state,
    pendingOperation,
    notice: asString(uiState.notice),
    error: asString(uiState.error) || state.error,
    current: {
      workbookId,
      linked: !!remote,
      conflict,
      revision: remote ? remote.revision : 0,
      status:
        pendingOperation === 'upload'
          ? 'uploading'
          : conflict
            ? 'conflict'
            : remote
              ? 'synced'
              : 'local_only',
      lastSyncedAt: remote ? remote.updatedAt : ''
    }
  };
}

export function useCloudWorkbookController({
  cloud,
  feedback,
  workbook,
  browserCache,
  workbookStorage,
  syncStorage,
  saveStatus,
  setWorkbook,
  navigate
} = {}) {
  const [cloudState, setCloudState] = useState(EMPTY_CLOUD_STATE);
  const [uiState, setUiState] = useState({ pendingOperation: '', notice: '', error: '' });
  const resolvedSyncStorage = useMemo(
    () => resolveCloudWorkbookSyncStorage(syncStorage),
    [syncStorage]
  );
  const stateRef = useRef(cloudState);
  const workbookRef = useRef(workbook);
  const saveStatusRef = useRef(saveStatus);
  const pendingOperationRef = useRef('');
  const [conflictedWorkbookIds, setConflictedWorkbookIds] = useState(() => new Set());
  const conflictedWorkbookIdsRef = useRef(conflictedWorkbookIds);

  useEffect(() => {
    stateRef.current = cloudState;
  }, [cloudState]);
  useEffect(() => {
    workbookRef.current = workbook;
  }, [workbook]);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  const updateWorkbookConflict = useCallback((workbookId, conflicted) => {
    const id = asString(workbookId);
    if (!id) return;
    const conflicts = conflictedWorkbookIdsRef.current;
    const changed = conflicted ? !conflicts.has(id) : conflicts.has(id);
    if (!changed) return;
    const nextConflicts = new Set(conflicts);
    if (conflicted) nextConflicts.add(id);
    else nextConflicts.delete(id);
    conflictedWorkbookIdsRef.current = nextConflicts;
    setConflictedWorkbookIds(nextConflicts);
  }, []);

  const cloudUserId = asString(cloudState.user && cloudState.user.id);
  const localWorkbookId = asString(workbook && workbook.id);

  useEffect(() => {
    if (cloudState.status !== 'signed_in' || !cloudUserId || !localWorkbookId) return;
    const remote = cloudState.workbooks.find((item) => item.id === localWorkbookId);
    const remoteExists = !!remote;
    const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, cloudUserId, localWorkbookId);
    if (
      remoteExists &&
      (!syncState.known ||
        !syncState.revision ||
        syncState.conflict ||
        remote.revision !== syncState.revision)
    ) {
      if (!syncState.conflict) {
        writeCloudWorkbookSyncState(resolvedSyncStorage, cloudUserId, localWorkbookId, {
          revision: syncState.revision,
          conflict: true
        });
      }
      updateWorkbookConflict(localWorkbookId, true);
    } else if (!remoteExists && syncState.conflict) {
      removeCloudWorkbookSyncState(resolvedSyncStorage, cloudUserId, localWorkbookId);
      updateWorkbookConflict(localWorkbookId, false);
    }
  }, [
    cloudState.status,
    cloudState.workbooks,
    cloudUserId,
    localWorkbookId,
    resolvedSyncStorage,
    updateWorkbookConflict
  ]);

  useEffect(() => {
    const remoteIds = new Set(cloudState.workbooks.map((item) => item.id));
    const conflicts = conflictedWorkbookIdsRef.current;
    const nextConflicts = new Set([...conflicts].filter((id) => remoteIds.has(id)));
    if (nextConflicts.size === conflicts.size) return;
    conflictedWorkbookIdsRef.current = nextConflicts;
    setConflictedWorkbookIds(nextConflicts);
  }, [cloudState.workbooks]);

  const applyRemoteState = useCallback((value) => {
    const normalized = normalizeCloudState(value);
    stateRef.current = normalized;
    setCloudState(normalized);
    return normalized;
  }, []);

  const invoke = useCallback(
    async (command, payload) => {
      if (!(cloud && typeof cloud.invoke === 'function')) {
        return { ok: false, unavailable: true, error: 'Cavalry Cloud is unavailable.' };
      }
      try {
        return (await cloud.invoke(command, payload || {})) || { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : 'The cloud request failed.'
        };
      }
    },
    [cloud]
  );

  const refreshState = useCallback(async () => {
    const result = await invoke('getState');
    const nextState = stateFromResult(result) || result;
    if (nextState && typeof nextState === 'object') applyRemoteState(nextState);
    return result;
  }, [applyRemoteState, invoke]);

  useEffect(() => {
    let active = true;
    invoke('getState').then((result) => {
      if (!active) return;
      const nextState = stateFromResult(result) || result;
      if (nextState && typeof nextState === 'object') applyRemoteState(nextState);
    });
    const dispose =
      cloud && typeof cloud.subscribe === 'function'
        ? cloud.subscribe((payload) => {
            if (!active) return;
            applyRemoteState(stateFromResult(payload) || payload);
          })
        : () => {};
    return () => {
      active = false;
      if (typeof dispose === 'function') dispose();
    };
  }, [applyRemoteState, cloud, invoke]);

  const execute = useCallback(
    async (operation, payload = {}) => {
      const operationName = asString(operation);
      if (pendingOperationRef.current) {
        return {
          ok: false,
          code: 'cloud_operation_in_progress',
          error: 'Another Cavalry Cloud operation is already in progress.'
        };
      }
      pendingOperationRef.current = operationName || 'unknown';
      setUiState({ pendingOperation: operationName, notice: '', error: '' });
      let result;
      let uploadSyncContext = null;
      let openSyncContext = null;
      let deleteSyncContext = null;
      try {
        if (operationName === 'sign-in') {
          result = await invoke('signInWithGoogle');
        } else if (operationName === 'sign-out') {
          result = await invoke('signOut');
        } else if (operationName === 'profile-update') {
          const name = asString(payload.name);
          if (!name) {
            result = { ok: false, error: 'Enter a profile name.' };
          } else if (Array.from(name).length > 80) {
            result = { ok: false, error: 'Profile names can be at most 80 characters.' };
          } else {
            result = await invoke('updateProfile', { name });
          }
        } else if (operationName === 'refresh') {
          result = await invoke('listWorkbooks');
        } else if (operationName === 'upload') {
          const currentWorkbook = workbookRef.current;
          const currentWorkbookId = asString(currentWorkbook && currentWorkbook.id);
          const userId = asString(stateRef.current.user && stateRef.current.user.id);
          if (!currentWorkbookId) {
            result = { ok: false, error: 'Open a workbook before adding it to Cavalry Cloud.' };
          } else if (!userId) {
            result = { ok: false, error: 'Sign in to Cavalry Cloud first.' };
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
              revision: syncState.revision
            };
            if (
              conflictedWorkbookIdsRef.current.has(currentWorkbookId) ||
              (remote &&
                (!syncState.known ||
                  !syncState.revision ||
                  syncState.conflict ||
                  remote.revision !== syncState.revision))
            ) {
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
                  'The Cloud copy changed. Save this local workbook, then open the Cloud copy before uploading again.'
              };
            } else {
              result = await invoke('uploadWorkbook', {
                workbook: currentWorkbook,
                expectedRevision: syncState.known ? syncState.revision : null
              });
              const metadataId = asString(asObject(result && result.metadata).id);
              if (result && result.ok && metadataId && metadataId !== currentWorkbookId) {
                result = {
                  ok: false,
                  code: 'cloud_workbook_identity_mismatch',
                  error: 'The saved Cloud workbook identity did not match.'
                };
              }
            }
          }
        } else if (operationName === 'open') {
          const workbookId = asString(payload.workbookId);
          const currentWorkbook = workbookRef.current;
          openSyncContext = {
            userId: asString(stateRef.current.user && stateRef.current.user.id),
            workbookId
          };
          const resolvingConflict = conflictedWorkbookIdsRef.current.has(workbookId);
          const saveBeforeOpenMessage = resolvingConflict
            ? 'Save this local workbook to a file before opening the newer Cloud copy.'
            : 'Save the current workbook to a file before opening a different Cloud workbook.';
          if (!workbookId) {
            result = { ok: false, error: 'Choose a cloud workbook to open.' };
          } else if (
            currentWorkbook &&
            asString(currentWorkbook.id) === workbookId &&
            !resolvingConflict
          ) {
            result = { ok: false, error: 'That Cloud workbook is already open.' };
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
            if (asString(result.workbook.id) !== workbookId) {
              result = { ok: false, error: 'The downloaded workbook identity did not match.' };
            } else {
              const cacheResult =
                browserCache && typeof browserCache.save === 'function'
                  ? await browserCache.save(result.workbook)
                  : { ok: false, unavailable: true };
              if (cacheResult && cacheResult.ok === false && !cacheResult.unavailable) {
                result = {
                  ok: false,
                  error: 'Cavalry could not cache the Cloud workbook safely.'
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
                  error: 'Cavalry could not disconnect the current file before opening Cloud.'
                };
              } else {
                if (typeof setWorkbook === 'function') {
                  setWorkbook(result.workbook, {
                    source: 'cloud',
                    markDirty: false,
                    saveStatus: 'cache'
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
            : { ok: false, error: 'Choose a cloud workbook to remove.' };
        } else {
          result = { ok: false, error: 'The requested cloud operation is unavailable.' };
        }

        const resultState = stateFromResult(result);
        let nextCloudState = null;
        if (resultState) nextCloudState = applyRemoteState(resultState);
        else if (result && result.ok && operationName !== 'sign-in' && operationName !== 'open') {
          await refreshState();
          nextCloudState = stateRef.current;
        }

        if (
          operationName === 'upload' &&
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
          updateWorkbookConflict(currentWorkbookId, remoteStillExists);
          if (uploadSyncContext && remoteStillExists) {
            writeCloudWorkbookSyncState(
              resolvedSyncStorage,
              uploadSyncContext.userId,
              uploadSyncContext.workbookId,
              {
                revision: uploadSyncContext.revision,
                conflict: true
              }
            );
          } else if (uploadSyncContext) {
            removeCloudWorkbookSyncState(
              resolvedSyncStorage,
              uploadSyncContext.userId,
              uploadSyncContext.workbookId
            );
          }
          result = {
            ...result,
            error: remoteStillExists
              ? 'The Cloud copy changed. Save this local workbook, then open the Cloud copy before uploading again.'
              : 'The previous Cloud copy no longer exists. Review this workbook, then choose Add to Cloud again.'
          };
        } else if (operationName === 'upload' && result && result.ok) {
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
              conflict: false
            });
          }
          updateWorkbookConflict(currentWorkbookId, false);
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
              conflict: false
            });
          }
          updateWorkbookConflict(workbookId, false);
        } else if (operationName === 'delete' && result && result.ok) {
          const workbookId = asString(deleteSyncContext && deleteSyncContext.workbookId);
          const userId = asString(deleteSyncContext && deleteSyncContext.userId);
          removeCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId);
          updateWorkbookConflict(workbookId, false);
        }

        if (!(result && result.ok)) {
          const error = errorMessageFromResult(result) || 'The cloud request failed.';
          setUiState({ pendingOperation: '', notice: '', error });
          return { ...(result || {}), ok: false, error };
        }

        const notices = {
          'sign-in': 'Finish signing in with Google in your browser.',
          'sign-out': 'Signed out of Cavalry Cloud on this device.',
          'profile-update': 'Profile name updated.',
          refresh: 'Cloud workbooks refreshed.',
          upload: 'Workbook saved to Cavalry Cloud.',
          open: 'Cloud workbook opened.',
          delete: 'Workbook removed from Cavalry Cloud.'
        };
        setUiState({ pendingOperation: '', notice: notices[operationName] || '', error: '' });
        return result;
      } catch (error) {
        const message = error && error.message ? error.message : 'The cloud request failed.';
        setUiState({ pendingOperation: '', notice: '', error: message });
        return { ok: false, error: message };
      } finally {
        pendingOperationRef.current = '';
      }
    },
    [
      applyRemoteState,
      browserCache,
      invoke,
      navigate,
      refreshState,
      resolvedSyncStorage,
      setWorkbook,
      updateWorkbookConflict,
      workbookStorage
    ]
  );

  const model = useMemo(() => {
    const workbookId = asString(workbook && workbook.id);
    return buildCloudSettingsModel(cloudState, workbook, {
      ...uiState,
      conflict: conflictedWorkbookIds.has(workbookId)
    });
  }, [cloudState, conflictedWorkbookIds, uiState, workbook]);
  const feedbackController = useCloudFeedbackController({ cloud: model, feedback });

  return { execute, feedback: feedbackController, model, refreshState };
}
