// Owns workbook hydration, immutable identity, save state, routes, overlays, warnings, and errors.

import React, {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react';

import { createNullRendererPorts } from '../platform/ports.js';
import {
  createWorkbookSessionState,
  hydrateWorkbookFromPorts,
  workbookSessionReducer
} from './workbook-session-reducer.js';
import { createLatestWorkbookSaveScheduler } from './workbook-save-scheduler.js';

const WorkbookContext = createContext(null);

function createSaveStatusTracker(initialStatus) {
  let status = initialStatus;
  return Object.freeze({
    get: () => status,
    set: (nextStatus) => {
      status = nextStatus;
    }
  });
}

export function WorkbookProvider({
  initialWorkbook = null,
  initialSaveStatus = 'idle',
  initialRouteId,
  ports,
  autoHydrate = false,
  children
}) {
  const resolvedPorts = useMemo(() => createNullRendererPorts(ports), [ports]);
  const [state, dispatch] = useReducer(
    workbookSessionReducer,
    { initialWorkbook, initialSaveStatus, initialRouteId, autoHydrate },
    createWorkbookSessionState
  );
  const currentWorkbookRef = useRef(state.workbook);
  const saveStatusTracker = useMemo(
    () => createSaveStatusTracker(initialSaveStatus),
    [initialSaveStatus]
  );
  const [recentWorkbooks, setRecentWorkbooks] = useState({
    status: 'loading',
    items: [],
    error: '',
    openingId: ''
  });

  useEffect(() => {
    currentWorkbookRef.current = state.workbook;
  }, [state.workbook]);

  useEffect(() => {
    saveStatusTracker.set(state.save.status);
  }, [saveStatusTracker, state.save.status]);

  const applyHydrationResult = useCallback((result) => {
    if (result && result.status === 'loaded') {
      dispatch({
        type: 'hydration/succeeded',
        workbook: result.workbook,
        source: result.source,
        warnings: result.warnings,
        lastSavedAt: result.file && result.file.savedAt
      });
      return;
    }
    if (result && result.status === 'error') {
      dispatch({
        type: 'hydration/failed',
        source: result.source,
        error: {
          code: 'workbook.load_failed',
          message: result.error || 'Workbook could not be loaded.'
        }
      });
      return;
    }
    dispatch({ type: 'hydration/empty', source: result && result.source });
  }, []);

  useEffect(() => {
    if (!autoHydrate) return undefined;
    let cancelled = false;
    dispatch({ type: 'hydration/started' });
    hydrateWorkbookFromPorts(resolvedPorts)
      .then((result) => {
        if (cancelled) return;
        applyHydrationResult(result);
      })
      .catch((error) => {
        if (!cancelled) {
          dispatch({
            type: 'hydration/failed',
            error: {
              code: 'workbook.load_failed',
              message: error && error.message ? error.message : String(error)
            }
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyHydrationResult, autoHydrate, resolvedPorts]);

  // The startup error screen needs to re-run hydration itself; opening a file picker is a different
  // action and cannot recover a workbook that failed to load on its own.
  const retryHydration = useCallback(async () => {
    dispatch({ type: 'hydration/started' });
    try {
      applyHydrationResult(await hydrateWorkbookFromPorts(resolvedPorts));
    } catch (error) {
      dispatch({
        type: 'hydration/failed',
        error: {
          code: 'workbook.load_failed',
          message: error && error.message ? error.message : String(error)
        }
      });
    }
  }, [applyHydrationResult, resolvedPorts]);

  const setWorkbook = useCallback(
    (workbook, options = {}) => {
      const nextWorkbook =
        workbook === state.workbook && workbook
          ? typeof structuredClone === 'function'
            ? structuredClone(workbook)
            : JSON.parse(JSON.stringify(workbook))
          : workbook;
      dispatch({ type: 'workbook/replaced', workbook: nextWorkbook, ...options });
      return nextWorkbook;
    },
    [state.workbook]
  );
  const setSaveStatus = useCallback((status, error = '') => {
    if (status === 'saving') dispatch({ type: 'save/started' });
    else if (status === 'saved') dispatch({ type: 'save/succeeded' });
    else if (status === 'cache') dispatch({ type: 'save/cached' });
    else if (status === 'error') dispatch({ type: 'save/failed', error: { message: error } });
  }, []);

  const refreshRecentWorkbooks = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) {
        setRecentWorkbooks((current) => ({ ...current, status: 'loading', error: '' }));
      }
      try {
        const result = await resolvedPorts.workbookStorage.listRecent();
        const items = Array.isArray(result && result.workbooks) ? result.workbooks : [];
        setRecentWorkbooks((current) => ({
          ...current,
          status: 'ready',
          items,
          error:
            result && result.ok === false && !result.unavailable
              ? result.error || ''
              : quiet
                ? current.error
                : ''
        }));
        return result;
      } catch (error) {
        const message =
          error && error.message ? error.message : 'Recent workbooks could not be loaded.';
        setRecentWorkbooks((current) => ({
          ...current,
          status: 'ready',
          items: [],
          error: message
        }));
        return { ok: false, workbooks: [], error: message };
      }
    },
    [resolvedPorts]
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refreshRecentWorkbooks({ quiet: true });
    });
    return () => {
      cancelled = true;
    };
  }, [refreshRecentWorkbooks]);

  const performWorkbookSave = useCallback(
    async (workbook) => {
      if (!workbook) return { ok: false, error: 'Workbook is required.' };
      saveStatusTracker.set('saving');
      dispatch({ type: 'save/started' });
      const savedAt = resolvedPorts.clock.now();
      try {
        const [cacheAttempt, storageAttempt] = await Promise.allSettled([
          resolvedPorts.browserCache.save(workbook),
          resolvedPorts.workbookStorage.save(workbook)
        ]);
        const cacheResult =
          cacheAttempt.status === 'fulfilled'
            ? cacheAttempt.value
            : { ok: false, error: cacheAttempt.reason?.message || String(cacheAttempt.reason) };
        const storageResult =
          storageAttempt.status === 'fulfilled'
            ? storageAttempt.value
            : { ok: false, error: storageAttempt.reason?.message || String(storageAttempt.reason) };
        if (storageResult && storageResult.ok) {
          saveStatusTracker.set('saved');
          dispatch({ type: 'save/succeeded', savedAt: storageResult.savedAt || savedAt });
          void refreshRecentWorkbooks({ quiet: true });
        } else if (cacheResult && cacheResult.ok) {
          saveStatusTracker.set('cache');
          dispatch({ type: 'save/cached', savedAt });
        } else {
          throw new Error(
            storageResult && storageResult.error
              ? storageResult.error
              : cacheResult && cacheResult.error
                ? cacheResult.error
                : 'Workbook could not be saved.'
          );
        }
        resolvedPorts.companion.publish({ workbook }).catch(() => {});
        return storageResult && storageResult.ok
          ? storageResult
          : { ok: true, cached: true, savedAt };
      } catch (error) {
        saveStatusTracker.set('error');
        dispatch({
          type: 'save/failed',
          error: {
            code: 'workbook.save_failed',
            message: error && error.message ? error.message : String(error)
          }
        });
        return { ok: false, error: error && error.message ? error.message : String(error) };
      }
    },
    [refreshRecentWorkbooks, resolvedPorts, saveStatusTracker]
  );
  const performWorkbookSaveAs = useCallback(
    async (workbook, suggestedName) => {
      const previousSaveStatus = saveStatusTracker.get();
      saveStatusTracker.set('saving');
      dispatch({ type: 'save/started' });
      try {
        const result = await resolvedPorts.workbookStorage.saveAs(workbook, suggestedName);
        if (result && result.ok) {
          await resolvedPorts.browserCache.save(workbook).catch(() => {});
          void refreshRecentWorkbooks({ quiet: true });
          saveStatusTracker.set('saved');
          dispatch({
            type: 'save/succeeded',
            savedAt: result.savedAt || resolvedPorts.clock.now()
          });
        } else if (result && result.canceled) {
          saveStatusTracker.set(previousSaveStatus);
          dispatch({ type: 'save/cancelled', status: previousSaveStatus });
        } else {
          throw new Error(result && result.error ? result.error : 'Workbook could not be saved.');
        }
        return result;
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        saveStatusTracker.set('error');
        dispatch({ type: 'save/failed', error: { code: 'workbook.save_failed', message } });
        return { ok: false, error: message };
      }
    },
    [refreshRecentWorkbooks, resolvedPorts, saveStatusTracker]
  );
  const saveScheduler = useMemo(
    () => createLatestWorkbookSaveScheduler({ performSave: performWorkbookSave }),
    [performWorkbookSave]
  );
  const saveWorkbook = useCallback(
    (workbook = currentWorkbookRef.current) => {
      if (!workbook) return Promise.resolve({ ok: false, error: 'Workbook is required.' });
      return saveScheduler.enqueue(workbook);
    },
    [saveScheduler]
  );
  const scheduleWorkbookSave = useCallback(
    (workbook = currentWorkbookRef.current) => {
      if (!workbook) return Promise.resolve({ ok: false, error: 'Workbook is required.' });
      return saveScheduler.enqueue(workbook, { automatic: true });
    },
    [saveScheduler]
  );
  const saveWorkbookAs = useCallback(
    (
      workbook = state.workbook,
      suggestedName = workbook && workbook.name ? `${workbook.name}.html` : 'cavalry-workbook.html'
    ) => {
      if (!workbook) return Promise.resolve({ ok: false, error: 'Workbook is required.' });
      return saveScheduler.enqueue(workbook, {
        perform: async (latestWorkbook, { hasAutomatic }) => {
          const result = await performWorkbookSaveAs(latestWorkbook, suggestedName);
          if (hasAutomatic && (!result || result.ok === false)) {
            await performWorkbookSave(latestWorkbook);
          }
          return result;
        }
      });
    },
    [performWorkbookSave, performWorkbookSaveAs, saveScheduler, state.workbook]
  );

  useEffect(() => {
    const flushPendingSave = () => {
      void saveScheduler.flush().catch(() => {});
    };
    const flushWhenHidden = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        flushPendingSave();
      }
    };
    const browserWindow = typeof window === 'undefined' ? null : window;
    const browserDocument = typeof document === 'undefined' ? null : document;
    browserWindow?.addEventListener('pagehide', flushPendingSave);
    browserWindow?.addEventListener('beforeunload', flushPendingSave);
    browserDocument?.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      browserWindow?.removeEventListener('pagehide', flushPendingSave);
      browserWindow?.removeEventListener('beforeunload', flushPendingSave);
      browserDocument?.removeEventListener('visibilitychange', flushWhenHidden);
      flushPendingSave();
    };
  }, [saveScheduler]);

  const applyOpenedWorkbook = useCallback(
    (result) => {
      applyHydrationResult(result);
      resolvedPorts.browserCache.save(result.workbook).catch(() => {});
      resolvedPorts.companion
        .publish({ workbook: result.workbook, reason: 'workbook_opened' })
        .catch(() => {});
    },
    [applyHydrationResult, resolvedPorts]
  );

  const openWorkbook = useCallback(async () => {
    const result = await resolvedPorts.workbookStorage.open();
    if (result && result.status === 'canceled') return result;
    if (result && result.status === 'loaded') {
      applyOpenedWorkbook(result);
      void refreshRecentWorkbooks({ quiet: true });
      return result;
    }
    // Every remaining status is a failure the person needs to see. Falling through silently leaves
    // the startup error screen unchanged, which reads as a button that does nothing.
    const message =
      (result && result.error) ||
      (result && result.status === 'unavailable'
        ? 'The Cavalry desktop host is unavailable, so the file picker could not open.'
        : result && result.status === 'missing'
          ? 'That workbook file could not be found.'
          : 'The selected workbook could not be opened.');
    if (currentWorkbookRef.current) {
      dispatch({
        type: 'error/reported',
        error: { code: 'workbook.open_failed', message }
      });
    } else {
      applyHydrationResult({ status: 'error', source: 'native', error: message });
    }
    return result;
  }, [applyHydrationResult, applyOpenedWorkbook, refreshRecentWorkbooks, resolvedPorts]);

  const openRecentWorkbook = useCallback(
    async (id) => {
      const recentId = String(id || '');
      if (!recentId || recentWorkbooks.openingId) {
        return { status: 'error', error: 'Choose a recent workbook to open.' };
      }
      setRecentWorkbooks((current) => ({ ...current, openingId: recentId, error: '' }));
      try {
        const result = await resolvedPorts.workbookStorage.openRecent(recentId);
        if (result && result.status === 'loaded') {
          applyOpenedWorkbook(result);
        } else if (result && !['canceled', 'unavailable'].includes(result.status)) {
          setRecentWorkbooks((current) => ({
            ...current,
            error: result.error || 'The recent workbook could not be opened.'
          }));
        }
        await refreshRecentWorkbooks({ quiet: true });
        return result;
      } catch (error) {
        const message =
          error && error.message ? error.message : 'The recent workbook could not be opened.';
        setRecentWorkbooks((current) => ({ ...current, error: message }));
        await refreshRecentWorkbooks({ quiet: true });
        return { status: 'error', error: message };
      } finally {
        setRecentWorkbooks((current) => ({ ...current, openingId: '' }));
      }
    },
    [applyOpenedWorkbook, recentWorkbooks.openingId, refreshRecentWorkbooks, resolvedPorts]
  );

  useEffect(
    () =>
      resolvedPorts.workbookStorage.subscribe((command) => {
        const type = typeof command === 'string' ? command : command && command.type;
        if (type === 'open-workbook') openWorkbook();
        else if (type === 'save-workbook') saveWorkbook();
        else if (type === 'save-workbook-as') saveWorkbookAs();
        else if (type === 'open-settings')
          dispatch({ type: 'route/navigated', routeId: 'settings' });
        else if (type === 'new-transaction') {
          dispatch({ type: 'route/navigated', routeId: 'ledger' });
          dispatch({
            type: 'overlay/opened',
            overlay: { id: 'transaction-composer', type: 'transaction-composer', model: {} }
          });
        } else if (type === 'open-draft-group') {
          dispatch({ type: 'route/navigated', routeId: 'dashboard' });
          dispatch({
            type: 'overlay/opened',
            overlay: {
              id: 'draft-group-selection',
              type: 'draft-group-selection',
              model: { draftGroupId: command.draftGroupId || '' }
            }
          });
        } else if (type === 'open-checkpoint') {
          dispatch({ type: 'route/navigated', routeId: 'dashboard' });
          dispatch({
            type: 'overlay/opened',
            overlay: {
              id: 'checkpoint-selection',
              type: 'checkpoint-selection',
              model: { checkpointId: command.checkpointId || '' }
            }
          });
        }
      }),
    [openWorkbook, resolvedPorts, saveWorkbook, saveWorkbookAs]
  );

  useEffect(
    () =>
      resolvedPorts.companion.subscribe((payload) => {
        if (payload && payload.workbook && typeof payload.workbook === 'object') {
          dispatch({
            type: 'workbook/replaced',
            workbook: payload.workbook,
            source: 'companion',
            markDirty: false
          });
          resolvedPorts.browserCache.save(payload.workbook).catch(() => {});
        }
      }),
    [resolvedPorts]
  );
  const value = useMemo(
    () => ({
      state,
      workbook: state.workbook,
      setWorkbook,
      saveStatus: state.save.status,
      setSaveStatus,
      saveWorkbook,
      scheduleWorkbookSave,
      saveWorkbookAs,
      openWorkbook,
      openRecentWorkbook,
      recentWorkbooks,
      refreshRecentWorkbooks,
      retryHydration,
      dispatch,
      ports: resolvedPorts,
      navigate: (routeId) => dispatch({ type: 'route/navigated', routeId }),
      openOverlay: (overlay) => dispatch({ type: 'overlay/opened', overlay }),
      closeOverlay: (id) => dispatch({ type: 'overlay/closed', id })
    }),
    [
      openRecentWorkbook,
      openWorkbook,
      recentWorkbooks,
      refreshRecentWorkbooks,
      resolvedPorts,
      retryHydration,
      saveWorkbook,
      scheduleWorkbookSave,
      saveWorkbookAs,
      setSaveStatus,
      setWorkbook,
      state
    ]
  );

  return <WorkbookContext.Provider value={value}>{children}</WorkbookContext.Provider>;
}

export function useWorkbookSession() {
  const context = useContext(WorkbookContext);
  if (!context) {
    throw new Error('useWorkbookSession must be used inside WorkbookProvider.');
  }
  return context;
}
