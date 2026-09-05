import { DEFAULT_ROUTE_ID, getRouteById } from './routes.js';

export const HYDRATION_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  EMPTY: 'empty',
  ERROR: 'error'
});

export const SAVE_STATUS = Object.freeze({
  IDLE: 'idle',
  DIRTY: 'dirty',
  SAVING: 'saving',
  SAVED: 'saved',
  CACHE: 'cache',
  ERROR: 'error'
});

export function createWorkbookSessionState(options = {}) {
  const workbook = options.initialWorkbook || null;
  const hydrationStatus =
    options.hydrationStatus ||
    (options.autoHydrate ? HYDRATION_STATUS.IDLE : HYDRATION_STATUS.READY);
  return {
    workbook,
    hydration: {
      status: hydrationStatus,
      source: workbook ? 'initial' : '',
      error: ''
    },
    save: {
      status: options.initialSaveStatus || SAVE_STATUS.IDLE,
      lastSavedAt: '',
      error: '',
      localSaveSequence: 0
    },
    routeId: getRouteById(options.initialRouteId || DEFAULT_ROUTE_ID).id,
    overlays: [],
    warnings: [],
    errors: []
  };
}

function replaceOverlay(overlays, overlay) {
  const next = overlays.filter((item) => item.id !== overlay.id);
  return next.concat(overlay);
}

function appendError(errors, error) {
  const nextError = error || {
    code: 'application.failed',
    message: 'The requested action could not be completed.'
  };
  const code = String(nextError.code || '');
  const message = String(nextError.message || nextError);
  const withoutDuplicate = errors.filter(
    (item) => String(item?.code || '') !== code || String(item?.message || item) !== message
  );
  return withoutDuplicate.concat(nextError).slice(-8);
}

export function workbookSessionReducer(state, action) {
  switch (action.type) {
    case 'hydration/started':
      return {
        ...state,
        hydration: { status: HYDRATION_STATUS.LOADING, source: '', error: '' },
        errors: []
      };
    case 'hydration/succeeded':
      return {
        ...state,
        workbook: action.workbook,
        hydration: { status: HYDRATION_STATUS.READY, source: action.source || '', error: '' },
        save: {
          ...state.save,
          status: action.source === 'cache' ? SAVE_STATUS.CACHE : SAVE_STATUS.SAVED,
          lastSavedAt: action.lastSavedAt || state.save.lastSavedAt,
          error: ''
        },
        warnings: Array.isArray(action.warnings) ? action.warnings : []
      };
    case 'hydration/empty':
      return {
        ...state,
        workbook: null,
        hydration: { status: HYDRATION_STATUS.EMPTY, source: action.source || '', error: '' },
        save: { ...state.save, status: SAVE_STATUS.IDLE, error: '' }
      };
    case 'hydration/failed': {
      const error = action.error || {
        code: 'workbook.load_failed',
        message: 'Workbook could not be loaded.'
      };
      return {
        ...state,
        workbook: null,
        hydration: {
          status: HYDRATION_STATUS.ERROR,
          source: action.source || '',
          error: error.message || String(error)
        },
        errors: appendError(state.errors, error)
      };
    }
    case 'workbook/replaced':
      return {
        ...state,
        workbook: action.workbook || null,
        hydration: {
          status: action.workbook ? HYDRATION_STATUS.READY : HYDRATION_STATUS.EMPTY,
          source: action.source || 'command',
          error: ''
        },
        save: {
          ...state.save,
          status:
            action.saveStatus ||
            (action.markDirty === false ? state.save.status : SAVE_STATUS.DIRTY),
          error: ''
        }
      };
    case 'route/navigated':
      return { ...state, routeId: getRouteById(action.routeId).id };
    case 'overlay/opened':
      return {
        ...state,
        overlays: replaceOverlay(state.overlays, {
          id: action.overlay.id,
          type: action.overlay.type || 'modal',
          model: action.overlay.model || null
        })
      };
    case 'overlay/closed':
      return {
        ...state,
        overlays: action.id
          ? state.overlays.filter((overlay) => overlay.id !== action.id)
          : state.overlays.slice(0, -1)
      };
    case 'save/started':
      return { ...state, save: { ...state.save, status: SAVE_STATUS.SAVING, error: '' } };
    case 'save/succeeded':
      return {
        ...state,
        save: {
          ...state.save,
          status: SAVE_STATUS.SAVED,
          lastSavedAt: action.savedAt || state.save.lastSavedAt,
          error: '',
          localSaveSequence: Math.max(0, Number(state.save.localSaveSequence) || 0) + 1
        }
      };
    case 'save/cancelled':
      return {
        ...state,
        save: {
          ...state.save,
          status: action.status || (state.workbook ? SAVE_STATUS.DIRTY : SAVE_STATUS.IDLE)
        }
      };
    case 'save/cached':
      return {
        ...state,
        save: {
          ...state.save,
          status: SAVE_STATUS.CACHE,
          lastSavedAt: action.savedAt || state.save.lastSavedAt,
          error: ''
        }
      };
    case 'save/failed': {
      const error = action.error || {
        code: 'workbook.save_failed',
        message: 'Workbook could not be saved.'
      };
      return {
        ...state,
        save: { ...state.save, status: SAVE_STATUS.ERROR, error: error.message || String(error) },
        errors: appendError(state.errors, error)
      };
    }
    case 'error/reported':
      return { ...state, errors: appendError(state.errors, action.error) };
    case 'warning/dismissed':
      return {
        ...state,
        warnings:
          typeof action.index === 'number'
            ? state.warnings.filter((_warning, index) => index !== action.index)
            : []
      };
    case 'error/dismissed':
      return {
        ...state,
        errors:
          typeof action.index === 'number'
            ? state.errors.filter((_error, index) => index !== action.index)
            : []
      };
    default:
      return state;
  }
}

export async function hydrateWorkbookFromPorts(ports) {
  const nativeResult = await ports.workbookStorage.load();
  const cacheResult = await ports.browserCache.load();
  if (cacheResult?.source === 'recovery') {
    if (cacheResult.cleared) return cacheResult;
    if (cacheResult.status === 'error') return cacheResult;
    if (cacheResult.status === 'loaded') {
      if (
        nativeResult?.status !== 'loaded' ||
        JSON.stringify(nativeResult.workbook) !== JSON.stringify(cacheResult.workbook)
      ) {
        // File mtimes change when a file is copied or restored. They cannot prove
        // that an external export is newer than the app's acknowledged save.
        const forgotten = await ports.workbookStorage.forget();
        if (forgotten?.ok === false && !forgotten.unavailable)
          return {
            status: 'error',
            source: 'recovery',
            error: forgotten.error || 'The old file link could not be disconnected safely.'
          };
        return {
          ...cacheResult,
          warnings: [
            ...(cacheResult.warnings || []),
            ...(nativeResult?.status === 'loaded'
              ? [
                  {
                    code: 'workbook.external_copy_preserved',
                    message:
                      'Your saved Mac workbook was opened. The linked file contains a different copy and has been kept unchanged. Use Open Workbook File to open that copy.'
                  }
                ]
              : [])
          ]
        };
      }
      return cacheResult;
    }
  }
  if (nativeResult && nativeResult.status === 'loaded') {
    await ports.browserCache.save(nativeResult.workbook);
    return nativeResult;
  }
  if (nativeResult && nativeResult.status === 'error') return nativeResult;
  if (cacheResult && cacheResult.status === 'loaded') {
    const promoted = await ports.browserCache.save(cacheResult.workbook);
    return {
      ...cacheResult,
      ...(promoted?.durable ? { source: 'recovery', file: { savedAt: promoted.savedAt } } : {}),
      warnings: [
        ...(Array.isArray(cacheResult.warnings) ? cacheResult.warnings : []),
        ...(nativeResult && nativeResult.status === 'missing' && nativeResult.error
          ? [{ code: 'workbook.native_missing', message: nativeResult.error }]
          : [])
      ]
    };
  }
  if (cacheResult && cacheResult.status === 'error') return cacheResult;
  return { status: 'empty', source: 'none' };
}
