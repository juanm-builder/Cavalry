import { useCallback, useEffect, useMemo, useState } from 'react';

const KNOWN_UPDATE_STATUSES = new Set([
  'disabled',
  'idle',
  'checking',
  'up-to-date',
  'available',
  'downloading',
  'ready',
  'error'
]);

export const DISABLED_AUTO_UPDATE_STATE = Object.freeze({
  enabled: false,
  status: 'disabled',
  version: '',
  percent: 0,
  kind: '',
  sequence: null
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeStatus(value) {
  const raw = asString(value).toLowerCase();
  if (KNOWN_UPDATE_STATUSES.has(raw)) return raw;
  if (['up_to_date', 'not-available', 'update-not-available'].includes(raw)) return 'up-to-date';
  return 'disabled';
}

function normalizePercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function normalizeSequence(value) {
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}

export function normalizeAutoUpdateState(value) {
  const source = asObject(value);
  const error = asObject(source.error);
  const status = normalizeStatus(source.status);
  return {
    enabled: status !== 'disabled' && source.enabled !== false,
    status,
    version: asString(source.availableVersion ?? source.version).slice(0, 64),
    percent: normalizePercent(
      source.percent ?? source.downloadPercent ?? asObject(source.progress).percent
    ),
    kind: asString(source.kind || source.errorKind || error.kind).toLowerCase(),
    sequence: normalizeSequence(source.sequence)
  };
}

function statePayload(value) {
  const source = asObject(value);
  if (source.state && typeof source.state === 'object') return source.state;
  return typeof source.status === 'string' ? source : null;
}

export function useAutoUpdate(updates) {
  const [state, setState] = useState(DISABLED_AUTO_UPDATE_STATE);

  const applyRemoteState = useCallback((value) => {
    const payload = statePayload(value);
    if (!payload) return false;
    const nextState = normalizeAutoUpdateState(payload);
    setState((currentState) => {
      if (
        nextState.sequence !== null &&
        currentState.sequence !== null &&
        nextState.sequence < currentState.sequence
      ) {
        return currentState;
      }
      return nextState;
    });
    return true;
  }, []);

  useEffect(() => {
    let active = true;
    let eventObserved = false;

    if (!(updates && typeof updates.invoke === 'function')) return undefined;

    let dispose = () => {};
    if (typeof updates.subscribe === 'function') {
      try {
        const subscription = updates.subscribe((payload) => {
          if (!active) return;
          eventObserved = true;
          applyRemoteState(payload);
        });
        if (typeof subscription === 'function') dispose = subscription;
      } catch (_error) {
        // A missing update event stream leaves the initial snapshot as the safe fallback.
      }
    }

    Promise.resolve(updates.invoke('getState'))
      .then((result) => {
        if (!active) return;
        const payload = statePayload(result);
        const hasSequence = normalizeSequence(asObject(payload).sequence) !== null;
        if (!eventObserved || hasSequence) applyRemoteState(result);
      })
      .catch(() => {
        // Development builds and offline checks intentionally remain visually silent.
      });

    return () => {
      active = false;
      dispose();
    };
  }, [applyRemoteState, updates]);

  const execute = useCallback(
    async (command) => {
      if (!(updates && typeof updates.invoke === 'function')) {
        return { ok: false, unavailable: true };
      }
      try {
        const result = (await updates.invoke(command)) || { ok: true };
        applyRemoteState(result);
        return result;
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : 'The update request failed.'
        };
      }
    },
    [applyRemoteState, updates]
  );

  return useMemo(
    () => ({
      state,
      checkForUpdates: () => execute('checkForUpdates'),
      downloadUpdate: () => execute('downloadUpdate'),
      restartAndInstall: () => execute('restartAndInstall')
    }),
    [execute, state]
  );
}
