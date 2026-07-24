import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  return {
    ...state,
    pendingOperation,
    notice: asString(uiState.notice),
    error: asString(uiState.error) || state.error,
    current: {
      workbookId,
      linked: !!remote,
      revision: remote ? remote.revision : 0,
      status: pendingOperation === 'upload' ? 'uploading' : remote ? 'synced' : 'local_only',
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
  saveStatus,
  setWorkbook,
  navigate
} = {}) {
  const [cloudState, setCloudState] = useState(EMPTY_CLOUD_STATE);
  const [uiState, setUiState] = useState({ pendingOperation: '', notice: '', error: '' });
  const stateRef = useRef(cloudState);
  const workbookRef = useRef(workbook);
  const saveStatusRef = useRef(saveStatus);

  useEffect(() => {
    stateRef.current = cloudState;
  }, [cloudState]);
  useEffect(() => {
    workbookRef.current = workbook;
  }, [workbook]);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

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
      setUiState({ pendingOperation: operationName, notice: '', error: '' });
      let result;
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
          if (!(currentWorkbook && asString(currentWorkbook.id))) {
            result = { ok: false, error: 'Open a workbook before adding it to Cavalry Cloud.' };
          } else {
            const remote = stateRef.current.workbooks.find(
              (item) => item.id === asString(currentWorkbook.id)
            );
            result = await invoke('uploadWorkbook', {
              workbook: currentWorkbook,
              expectedRevision: remote ? remote.revision : null
            });
          }
        } else if (operationName === 'open') {
          const workbookId = asString(payload.workbookId);
          const currentWorkbook = workbookRef.current;
          if (!workbookId) {
            result = { ok: false, error: 'Choose a cloud workbook to open.' };
          } else if (currentWorkbook && asString(currentWorkbook.id) === workbookId) {
            result = { ok: false, error: 'That Cloud workbook is already open.' };
          } else if (currentWorkbook && asString(saveStatusRef.current) !== 'saved') {
            result = {
              ok: false,
              error:
                'Save the current workbook to a file before opening a different Cloud workbook.'
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
                error:
                  'Save the current workbook to a file before opening a different Cloud workbook.'
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
          result = workbookId
            ? await invoke('deleteWorkbook', { workbookId })
            : { ok: false, error: 'Choose a cloud workbook to remove.' };
        } else {
          result = { ok: false, error: 'The requested cloud operation is unavailable.' };
        }

        const resultState = stateFromResult(result);
        if (resultState) applyRemoteState(resultState);
        else if (result && result.ok && operationName !== 'sign-in' && operationName !== 'open') {
          await refreshState();
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
      }
    },
    [applyRemoteState, browserCache, invoke, navigate, refreshState, setWorkbook, workbookStorage]
  );

  const model = useMemo(
    () => buildCloudSettingsModel(cloudState, workbook, uiState),
    [cloudState, uiState, workbook]
  );
  const feedbackController = useCloudFeedbackController({ cloud: model, feedback });

  return { execute, feedback: feedbackController, model, refreshState };
}
