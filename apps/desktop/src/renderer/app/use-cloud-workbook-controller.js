import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  readCloudWorkbookAutoSyncPreference,
  readCloudWorkbookSyncState,
  resolveCloudWorkbookSyncStorage,
  writeCloudWorkbookAutoSyncPreference,
  writeCloudWorkbookSyncState
} from './cloud-workbook-sync-state.js';
import { createCloudWorkbookAutoSyncScheduler } from './cloud-workbook-auto-sync.js';
import { createDurableCloudWorkbookSyncStorage } from './durable-cloud-workbook-sync-storage.js';
import { useCloudWorkbookAutomaticSync } from './use-cloud-workbook-automatic-sync.js';
import { useCloudWorkbookAutoSyncStatus } from './use-cloud-workbook-auto-sync-status.js';
import { useCloudWorkbookOperations } from './use-cloud-workbook-operations.js';
import { reconcileCloudWorkbookBranches } from './cloud-workbook-branch-reconciler.js';
import { useCloudWorkbookConflictEffects } from './cloud-workbook-conflict-effects.js';
import {
  EMPTY_CLOUD_STATE,
  asObject,
  asRevision,
  asString,
  buildCloudSettingsModel,
  buildConflictNotice,
  conflictNoticePublicationKey,
  errorDetailsFromResult,
  errorMessageFromResult,
  isRetryableAutomaticSyncFailure,
  normalizeCloudState,
  normalizeConflictNotice,
  stateFromResult
} from './cloud-workbook-model.js';

export {
  buildCloudSettingsModel,
  isRetryableAutomaticSyncFailure,
  normalizeCloudState
} from './cloud-workbook-model.js';

const EMPTY_CLOUD_UI_STATE = Object.freeze({
  pendingOperation: '',
  notice: '',
  error: '',
  errorCode: '',
  errorDetails: '',
  errorRetryable: false,
  errorOperation: '',
  errorWorkbookId: '',
  errorWorkbookName: '',
  errorStateSyncAt: '',
  failedOperation: '',
  failedWorkbookId: '',
  automaticSyncError: false
});

export function useCloudWorkbookController({
  cloud,
  workbook,
  browserCache,
  workbookStorage,
  syncStorage,
  saveStatus,
  localSaveSequence = 0,
  saveWorkbook,
  setWorkbook,
  navigate,
  autoSyncSchedulerOptions
} = {}) {
  const [cloudState, setCloudState] = useState(EMPTY_CLOUD_STATE);
  const [uiState, setUiState] = useState(() => ({ ...EMPTY_CLOUD_UI_STATE }));
  const [localConflictNotice, setLocalConflictNotice] = useState(null);
  const legacySyncStorage = useMemo(
    () => resolveCloudWorkbookSyncStorage(syncStorage),
    [syncStorage]
  );
  const durableSyncStorage = useMemo(
    () =>
      syncStorage
        ? null
        : createDurableCloudWorkbookSyncStorage({
            legacyStorage: legacySyncStorage,
            invoke: async (command, payload) => {
              if (!(cloud && typeof cloud.invoke === 'function')) {
                return {
                  ok: false,
                  code: 'cloud_sync_state_unavailable',
                  error: 'Durable iCloud sync state is unavailable.'
                };
              }
              return cloud.invoke(command, payload || {});
            }
          }),
    [cloud, legacySyncStorage, syncStorage]
  );
  const resolvedSyncStorage = durableSyncStorage?.storage || legacySyncStorage;
  const stateRef = useRef(cloudState);
  const workbookRef = useRef(workbook);
  const saveStatusRef = useRef(saveStatus);
  const pendingOperationRef = useRef('');
  const previousLocalSaveSequenceRef = useRef(Math.max(0, Number(localSaveSequence) || 0));
  const suppressNextAutoSyncRef = useRef(null);
  const initialEnrollmentRef = useRef('');
  const remoteRefreshInFlightRef = useRef(null);
  const remoteIntegrityCheckInFlightRef = useRef(null);
  const handledRemoteDeletionSequenceRef = useRef(0);
  const deferredRemoteRefreshRef = useRef('');
  const conflictNoticePublicationRef = useRef('');
  const conflictReviewInFlightRef = useRef('');
  const resolvedConflictAdoptionRef = useRef('');
  const localConflictNoticeRef = useRef(null);
  const [conflictedWorkbookIds, setConflictedWorkbookIds] = useState(() => new Set());
  const conflictedWorkbookIdsRef = useRef(conflictedWorkbookIds);
  const [autoSyncEpoch, setAutoSyncEpoch] = useState(0);
  const [autoSyncPreferenceEpoch, setAutoSyncPreferenceEpoch] = useState(0);
  const [syncHydrationEpoch, setSyncHydrationEpoch] = useState(0);
  const autoSyncSchedulerRef = useRef(null);
  const cloudUserId = asString(cloudState.user && cloudState.user.id);
  const localWorkbookId = asString(workbook && workbook.id);
  const cloudEnvironment = asString(cloudState.cloudEnvironment);
  const currentSyncScope = useMemo(
    () => ({ userId: cloudUserId, workbookId: localWorkbookId, cloudEnvironment }),
    [cloudEnvironment, cloudUserId, localWorkbookId]
  );
  const syncAnchorHydrated =
    !durableSyncStorage ||
    Boolean(
      cloudUserId && localWorkbookId && durableSyncStorage.status(currentSyncScope) === 'ready'
    );
  const autoSyncEnabled = readCloudWorkbookAutoSyncPreference(
    resolvedSyncStorage,
    cloudUserId,
    localWorkbookId
  );
  const { autoSyncStatus, handleAutoSyncStatus } = useCloudWorkbookAutoSyncStatus({
    autoSyncEnabled,
    emptyCloudUiState: EMPTY_CLOUD_UI_STATE,
    setUiState,
    stateRef,
    workbookRef
  });
  // These counters deliberately trigger reads from the external durable
  // repository without making its mutable maps part of React state.
  void syncHydrationEpoch;
  void autoSyncPreferenceEpoch;
  const uiContextRef = useRef({
    workbookId: localWorkbookId,
    sessionGeneration: Number(cloudState.sessionGeneration) || 0
  });

  useEffect(() => {
    stateRef.current = cloudState;
  }, [cloudState]);
  useEffect(() => {
    workbookRef.current = workbook;
  }, [workbook]);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);
  useEffect(() => {
    localConflictNoticeRef.current = localConflictNotice;
  }, [localConflictNotice]);
  useEffect(() => {
    if (
      localConflictNoticeRef.current &&
      asString(localConflictNoticeRef.current.report?.workbookId) !== localWorkbookId
    ) {
      localConflictNoticeRef.current = null;
      conflictNoticePublicationRef.current = '';
      setLocalConflictNotice(null);
    }
  }, [localWorkbookId]);
  useEffect(() => {
    const nextContext = {
      workbookId: localWorkbookId,
      sessionGeneration: Number(cloudState.sessionGeneration) || 0
    };
    const previousContext = uiContextRef.current;
    uiContextRef.current = nextContext;
    if (
      previousContext.workbookId === nextContext.workbookId &&
      previousContext.sessionGeneration === nextContext.sessionGeneration
    ) {
      return;
    }
    setUiState((current) => ({
      ...EMPTY_CLOUD_UI_STATE,
      pendingOperation: current.pendingOperation
    }));
  }, [cloudState.sessionGeneration, localWorkbookId]);

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
    if (!normalized.error && normalized.lastSyncAt) {
      setUiState((current) => {
        if (
          !current.error ||
          !current.errorRetryable ||
          current.errorStateSyncAt === normalized.lastSyncAt
        ) {
          return current;
        }
        return {
          ...EMPTY_CLOUD_UI_STATE,
          pendingOperation: current.pendingOperation
        };
      });
    }
    return normalized;
  }, []);

  const invoke = useCallback(
    async (command, payload) => {
      if (!(cloud && typeof cloud.invoke === 'function')) {
        return { ok: false, unavailable: true, error: 'iCloud sync is unavailable.' };
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

  const ensureDurableSyncState = useCallback(
    async (userId, workbookId) => {
      if (!durableSyncStorage) return { ok: true, status: 'injected' };
      const scope = {
        userId: asString(userId),
        workbookId: asString(workbookId),
        cloudEnvironment: asString(stateRef.current.cloudEnvironment)
      };
      if (!(scope.userId && scope.workbookId)) {
        return {
          ok: false,
          code: 'cloud_sync_state_scope_invalid',
          error: 'Open a workbook and connect iCloud first.',
          failClosed: true
        };
      }
      const result = await durableSyncStorage.hydrate(scope);
      setSyncHydrationEpoch((current) => current + 1);
      setAutoSyncPreferenceEpoch((current) => current + 1);
      return result;
    },
    [durableSyncStorage]
  );

  const flushDurableSyncState = useCallback(
    async (userId, workbookId) => {
      if (!durableSyncStorage) return { ok: true };
      const result = await durableSyncStorage.flush({
        userId: asString(userId),
        workbookId: asString(workbookId),
        cloudEnvironment: asString(stateRef.current.cloudEnvironment)
      });
      setSyncHydrationEpoch((current) => current + 1);
      return result;
    },
    [durableSyncStorage]
  );

  const isDurableSyncStateReady = useCallback(
    (userId, workbookId) =>
      !durableSyncStorage ||
      durableSyncStorage.status({
        userId,
        workbookId,
        cloudEnvironment: asString(stateRef.current.cloudEnvironment)
      }) === 'ready',
    [durableSyncStorage]
  );

  const refreshState = useCallback(async () => {
    const result = await invoke('getState');
    const nextState = stateFromResult(result) || result;
    if (nextState && typeof nextState === 'object') applyRemoteState(nextState);
    return result;
  }, [applyRemoteState, invoke]);

  const publishConflictReport = useCallback(
    async ({
      workbookId,
      baseRevision,
      remoteRevision,
      review,
      sourceWorkbook,
      baseWorkbook,
      force = false
    }) => {
      const targetId = asString(workbookId);
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
        workbookId: targetId,
        conflictNotice: normalized,
        sourceWorkbook,
        baseWorkbook
      });
      const resultState = stateFromResult(result);
      if (resultState) applyRemoteState(resultState);
      if (!(result && result.ok)) {
        conflictNoticePublicationRef.current = '';
        const unavailableNotice = { ...normalized, resolutionAvailable: false };
        localConflictNoticeRef.current = unavailableNotice;
        setLocalConflictNotice(unavailableNotice);
      } else {
        const userId = asString(stateRef.current.user && stateRef.current.user.id);
        if (userId) {
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
    [applyRemoteState, flushDurableSyncState, invoke, resolvedSyncStorage]
  );

  const clearSharedConflictNotice = useCallback(
    async (workbookId) => {
      const targetId = asString(workbookId);
      conflictNoticePublicationRef.current = '';
      localConflictNoticeRef.current = null;
      setLocalConflictNotice(null);
      if (!targetId) return { ok: false, code: 'invalid_workbook_id' };
      const result = await invoke('clearConflictNotice', { workbookId: targetId });
      const resultState = stateFromResult(result);
      if (resultState) applyRemoteState(resultState);
      return result;
    },
    [applyRemoteState, invoke]
  );

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

  useEffect(() => {
    if (
      !durableSyncStorage ||
      cloudState.status !== 'signed_in' ||
      !cloudUserId ||
      !localWorkbookId
    ) {
      return;
    }
    let active = true;
    void ensureDurableSyncState(cloudUserId, localWorkbookId).then((result) => {
      if (!active || (result && result.ok)) return;
      autoSyncSchedulerRef.current?.cancelPending();
      setUiState((current) => ({
        ...current,
        notice: '',
        error:
          asString(result && result.error) ||
          'Cavalry could not load its local iCloud sync state. Your workbook is safe.',
        errorCode: asString(result && result.code) || 'cloud_sync_state_unavailable',
        errorRetryable: true,
        errorOperation: 'sync-state',
        errorWorkbookId: localWorkbookId
      }));
    });
    return () => {
      active = false;
    };
  }, [
    cloudEnvironment,
    cloudState.status,
    cloudUserId,
    durableSyncStorage,
    ensureDurableSyncState,
    localWorkbookId
  ]);

  const latchWorkbookConflict = useCallback(
    async (userId, workbookId, revision) => {
      const ownerId = asString(userId);
      const targetId = asString(workbookId);
      if (!(ownerId && targetId)) return { ok: false, code: 'cloud_sync_state_scope_invalid' };
      writeCloudWorkbookSyncState(resolvedSyncStorage, ownerId, targetId, {
        revision: asRevision(revision) || null,
        conflict: true
      });
      updateWorkbookConflict(targetId, true);
      return flushDurableSyncState(ownerId, targetId);
    },
    [flushDurableSyncState, resolvedSyncStorage, updateWorkbookConflict]
  );

  const markRemoteWorkbookDeleted = useCallback(
    async (userId, workbookId) => {
      const ownerId = asString(userId);
      const targetId = asString(workbookId);
      if (!(
        ownerId &&
        targetId &&
        ownerId === asString(stateRef.current.user?.id) &&
        targetId === asString(workbookRef.current?.id)
      )) {
        return { ok: false, code: 'cloud_sync_scope_changed' };
      }
      const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, ownerId, targetId);
      if (!syncState.known) {
        // A delete event for an unlinked local workbook is not authority to
        // create a tombstone. Only a previously anchored link can be removed.
        return { ok: false, code: 'cloud_workbook_not_linked' };
      }
      if (syncState.remoteDeleted === true) return { ok: true, alreadyDeleted: true };

      autoSyncSchedulerRef.current?.cancelPending();
      writeCloudWorkbookAutoSyncPreference(resolvedSyncStorage, ownerId, targetId, false);
      writeCloudWorkbookSyncState(resolvedSyncStorage, ownerId, targetId, {
        revision: null,
        conflict: false,
        remoteDeleted: true,
        baseWorkbook: null
      });
      updateWorkbookConflict(targetId, false);
      if (asString(localConflictNoticeRef.current?.report?.workbookId) === targetId) {
        localConflictNoticeRef.current = null;
        setLocalConflictNotice(null);
      }
      setAutoSyncPreferenceEpoch((current) => current + 1);
      const durableResult = await flushDurableSyncState(ownerId, targetId);
      if (!(durableResult && durableResult.ok)) {
        const error =
          asString(durableResult && durableResult.error) ||
          'Cavalry could not save the iCloud removal state. Your Mac copy is safe.';
        setUiState({
          ...EMPTY_CLOUD_UI_STATE,
          error,
          errorCode:
            asString(durableResult && durableResult.code) || 'cloud_sync_state_save_failed',
          errorRetryable: true,
          errorOperation: 'sync-state',
          errorWorkbookId: targetId
        });
        return { ...(durableResult || {}), ok: false, error };
      }
      setUiState({
        ...EMPTY_CLOUD_UI_STATE,
        notice: 'Removed from iCloud. Mac copy is safe.'
      });
      return { ok: true, remoteDeleted: true };
    },
    [flushDurableSyncState, resolvedSyncStorage, updateWorkbookConflict]
  );

  const persistMergedWorkbook = useCallback(
    async (expectedWorkbook, mergedWorkbook) => {
      const workbookId = asString(expectedWorkbook && expectedWorkbook.id);
      if (
        !workbookId ||
        workbookRef.current !== expectedWorkbook ||
        asString(mergedWorkbook && mergedWorkbook.id) !== workbookId
      ) {
        return { ok: false, retry: true, code: 'local_workbook_changed' };
      }

      let appliedWorkbook = mergedWorkbook;
      if (typeof setWorkbook === 'function') {
        appliedWorkbook =
          setWorkbook(mergedWorkbook, {
            source: 'cloud-merge',
            markDirty: true
          }) || mergedWorkbook;
      }
      workbookRef.current = appliedWorkbook;
      suppressNextAutoSyncRef.current = {
        workbookId,
        workbook: appliedWorkbook
      };
      const localSaveResult =
        typeof saveWorkbook === 'function'
          ? await saveWorkbook(appliedWorkbook)
          : browserCache && typeof browserCache.save === 'function'
            ? await browserCache.save(appliedWorkbook)
            : { ok: false };
      if (!(localSaveResult && localSaveResult.ok)) {
        if (suppressNextAutoSyncRef.current?.workbook === appliedWorkbook) {
          suppressNextAutoSyncRef.current = null;
        }
        return {
          ok: false,
          retry: false,
          code: 'local_merge_save_failed',
          error: 'Cavalry combined the changes but could not save the merged workbook locally.'
        };
      }
      return { ok: true, workbook: appliedWorkbook };
    },
    [browserCache, saveWorkbook, setWorkbook]
  );

  const reconcileWorkbookBranches = useCallback(
    ({ userId, workbookId, localWorkbook, syncState }) =>
      reconcileCloudWorkbookBranches({
        userId,
        workbookId,
        localWorkbook,
        syncState,
        invoke,
        applyRemoteState,
        refreshState,
        isRetryableFailure: isRetryableAutomaticSyncFailure,
        getCurrentWorkbook: () => workbookRef.current,
        persistMergedWorkbook,
        latchConflict: (revision) => latchWorkbookConflict(userId, workbookId, revision),
        reportConflict: ({ baseRevision, remoteRevision, review, sourceWorkbook, baseWorkbook }) =>
          publishConflictReport({
            workbookId,
            baseRevision,
            remoteRevision,
            review,
            sourceWorkbook,
            baseWorkbook
          }),
        writeSyncState: async (nextState) => {
          writeCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId, nextState);
          return flushDurableSyncState(userId, workbookId);
        },
        clearConflict: () => updateWorkbookConflict(workbookId, false)
      }),
    [
      applyRemoteState,
      invoke,
      flushDurableSyncState,
      latchWorkbookConflict,
      persistMergedWorkbook,
      publishConflictReport,
      refreshState,
      resolvedSyncStorage,
      updateWorkbookConflict
    ]
  );

  const verifyRemoteWorkbookIntegrity = useCallback(
    ({ userId, workbookId, listedRemote, syncState }) => {
      const ownerId = asString(userId);
      const targetId = asString(workbookId);
      const anchorRevision = asRevision(syncState && syncState.revision);
      const listedRevision = asRevision(listedRemote && listedRemote.revision);
      const checkKey = `${ownerId}:${targetId}:${anchorRevision}:${listedRevision || 'missing'}`;
      if (remoteIntegrityCheckInFlightRef.current?.key === checkKey) {
        return remoteIntegrityCheckInFlightRef.current.promise;
      }

      const operation = (async () => {
        const exact = await invoke('downloadWorkbook', { workbookId: targetId });
        const exactState = stateFromResult(exact);
        if (exactState) applyRemoteState(exactState);

        if (exact && exact.code === 'cloud_workbook_not_found') {
          return markRemoteWorkbookDeleted(ownerId, targetId);
        }
        if (!(exact && exact.ok && exact.workbook)) {
          const error =
            errorMessageFromResult(exact) ||
            'Cavalry could not verify the iCloud copy. Your Mac copy is safe.';
          setUiState({
            ...EMPTY_CLOUD_UI_STATE,
            error,
            errorCode: asString(exact && exact.code) || 'cloud_remote_verification_failed',
            errorDetails: errorDetailsFromResult(exact),
            errorRetryable: true,
            errorOperation: 'refresh',
            errorWorkbookId: targetId,
            failedOperation: 'refresh',
            failedWorkbookId: targetId
          });
          return { ...(exact || {}), ok: false, retry: false, error };
        }
        if (asString(exact.workbook.id) !== targetId) {
          const error = 'The verified iCloud workbook identity did not match.';
          setUiState({
            ...EMPTY_CLOUD_UI_STATE,
            error,
            errorCode: 'cloud_workbook_identity_mismatch',
            errorRetryable: false,
            errorOperation: 'refresh',
            errorWorkbookId: targetId
          });
          return { ok: false, retry: false, code: 'cloud_workbook_identity_mismatch', error };
        }
        const exactRevision = asRevision(asObject(exact.metadata).revision);
        if (!exactRevision) {
          const error = 'Cavalry could not verify the iCloud revision. Your Mac copy is safe.';
          setUiState({
            ...EMPTY_CLOUD_UI_STATE,
            error,
            errorCode: 'cloud_revision_missing',
            errorRetryable: true,
            errorOperation: 'refresh',
            errorWorkbookId: targetId
          });
          return { ok: false, retry: false, code: 'cloud_revision_missing', error };
        }

        if (anchorRevision && exactRevision < anchorRevision) {
          autoSyncSchedulerRef.current?.cancelPending();
          const persistedConflict = await latchWorkbookConflict(ownerId, targetId, anchorRevision);
          if (!(persistedConflict && persistedConflict.ok)) return persistedConflict;
          const error = 'iCloud has an older copy. Your Mac copy is safe.';
          setUiState({
            ...EMPTY_CLOUD_UI_STATE,
            error,
            errorCode: 'cloud_revision_regressed',
            errorDetails: `Mac anchor ${anchorRevision}; iCloud revision ${exactRevision}.`,
            errorRetryable: true,
            errorOperation: 'refresh',
            errorWorkbookId: targetId,
            failedOperation: 'refresh',
            failedWorkbookId: targetId
          });
          return {
            ok: false,
            retry: false,
            conflict: true,
            code: 'cloud_revision_regressed',
            error
          };
        }

        setUiState((current) =>
          ['cloud_revision_regressed', 'cloud_remote_verification_failed'].includes(
            asString(current.errorCode)
          )
            ? { ...EMPTY_CLOUD_UI_STATE, pendingOperation: current.pendingOperation }
            : current
        );
        if (
          exactRevision > anchorRevision &&
          ['saved', 'cache'].includes(asString(saveStatusRef.current)) &&
          !pendingOperationRef.current &&
          !autoSyncSchedulerRef.current?.hasWork()
        ) {
          return reconcileWorkbookBranches({
            userId: ownerId,
            workbookId: targetId,
            localWorkbook: workbookRef.current,
            syncState
          });
        }
        return { ok: true, retry: false, metadata: exact.metadata, workbook: exact.workbook };
      })().finally(() => {
        if (remoteIntegrityCheckInFlightRef.current?.key === checkKey) {
          remoteIntegrityCheckInFlightRef.current = null;
        }
      });
      remoteIntegrityCheckInFlightRef.current = { key: checkKey, promise: operation };
      return operation;
    },
    [
      applyRemoteState,
      invoke,
      latchWorkbookConflict,
      markRemoteWorkbookDeleted,
      reconcileWorkbookBranches
    ]
  );

  const performAutomaticCloudSync = useCloudWorkbookAutomaticSync({
    applyRemoteState,
    conflictedWorkbookIdsRef,
    invoke,
    isSyncStateReady: isDurableSyncStateReady,
    persistSyncState: flushDurableSyncState,
    reconcileWorkbookBranches,
    refreshState,
    resolvedSyncStorage,
    stateRef,
    updateWorkbookConflict
  });
  useEffect(() => {
    const scheduler = createCloudWorkbookAutoSyncScheduler({
      ...(autoSyncSchedulerOptions || {}),
      performSync: performAutomaticCloudSync,
      onStatus: (status) => {
        setAutoSyncEpoch((current) => current + 1);
        handleAutoSyncStatus(status);
      }
    });
    autoSyncSchedulerRef.current = scheduler;
    return () => {
      if (autoSyncSchedulerRef.current === scheduler) autoSyncSchedulerRef.current = null;
      scheduler.stop();
    };
  }, [autoSyncSchedulerOptions, handleAutoSyncStatus, performAutomaticCloudSync]);
  useEffect(() => {
    if (!autoSyncEnabled || !syncAnchorHydrated) autoSyncSchedulerRef.current?.cancelPending();
  }, [autoSyncEnabled, syncAnchorHydrated]);

  // A saved Mac workbook should join the user's private iCloud library without
  // requiring a second, easy-to-miss "Add to iCloud" action. This runs once for
  // each local workbook/account pair. Existing remote identities and durable
  // revision anchors still take the conflict-safe paths below.
  useEffect(() => {
    const currentWorkbook = workbook;
    const workbookId = asString(currentWorkbook && currentWorkbook.id);
    const userId = asString(stateRef.current.user && stateRef.current.user.id);
    const enrollmentKey = userId && workbookId ? `${userId}:${workbookId}` : '';
    if (
      !syncAnchorHydrated ||
      !autoSyncEnabled ||
      stateRef.current.status !== 'signed_in' ||
      !enrollmentKey ||
      asString(saveStatus) !== 'saved' ||
      pendingOperationRef.current ||
      autoSyncSchedulerRef.current?.hasWork()
    ) {
      return;
    }
    const remote = stateRef.current.workbooks.find((item) => item.id === workbookId);
    const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId);
    if (
      remote ||
      syncState.known ||
      syncState.conflict ||
      conflictedWorkbookIdsRef.current.has(workbookId) ||
      initialEnrollmentRef.current === enrollmentKey
    ) {
      return;
    }
    initialEnrollmentRef.current = enrollmentKey;
    autoSyncSchedulerRef.current?.enqueue({
      userId,
      workbookId,
      workbook: currentWorkbook
    });
  }, [
    autoSyncEnabled,
    cloudState.status,
    cloudState.workbooks,
    cloudUserId,
    localWorkbookId,
    resolvedSyncStorage,
    saveStatus,
    syncAnchorHydrated,
    workbook
  ]);

  useEffect(() => {
    const previousSequence = previousLocalSaveSequenceRef.current;
    const nextSequence = Math.max(0, Number(localSaveSequence) || 0);
    previousLocalSaveSequenceRef.current = nextSequence;
    if (nextSequence <= previousSequence) return;

    const currentWorkbook = workbookRef.current;
    const workbookId = asString(currentWorkbook && currentWorkbook.id);
    const userId = asString(stateRef.current.user && stateRef.current.user.id);
    const suppression = suppressNextAutoSyncRef.current;
    if (
      suppression &&
      suppression.workbookId === workbookId &&
      suppression.workbook === currentWorkbook
    ) {
      suppressNextAutoSyncRef.current = null;
      return;
    }
    if (
      !syncAnchorHydrated ||
      !readCloudWorkbookAutoSyncPreference(resolvedSyncStorage, userId, workbookId) ||
      stateRef.current.status !== 'signed_in' ||
      !(userId && workbookId && currentWorkbook)
    ) {
      return;
    }
    const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId);
    if (syncState.remoteDeleted === true) return;
    autoSyncSchedulerRef.current?.enqueue({
      userId,
      workbookId,
      workbook: currentWorkbook
    });
  }, [localSaveSequence, resolvedSyncStorage, syncAnchorHydrated, workbook]);

  const refreshCurrentWorkbookFromCloud = useCallback(
    async (userId, remote) => {
      const workbookId = asString(remote && remote.id);
      const revision = asRevision(remote && remote.revision);
      const refreshKey =
        userId && workbookId && revision ? `${userId}:${workbookId}:${revision}` : '';
      if (
        !refreshKey ||
        remoteRefreshInFlightRef.current ||
        deferredRemoteRefreshRef.current === refreshKey
      ) {
        return;
      }
      const localWorkbook = workbookRef.current;
      const stillCurrent = asString(localWorkbook && localWorkbook.id) === workbookId;
      const stillClean = ['saved', 'cache'].includes(asString(saveStatusRef.current));
      if (
        !stillCurrent ||
        !stillClean ||
        autoSyncSchedulerRef.current?.hasWork() ||
        pendingOperationRef.current
      ) {
        return;
      }
      const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId);
      remoteRefreshInFlightRef.current = { workbookId, revision };
      try {
        const result = await reconcileWorkbookBranches({
          userId,
          workbookId,
          localWorkbook,
          syncState
        });
        if (result?.code === 'cloud_workbook_changed_again') {
          deferredRemoteRefreshRef.current = refreshKey;
        } else if (result?.ok && deferredRemoteRefreshRef.current === refreshKey) {
          deferredRemoteRefreshRef.current = '';
        }
      } finally {
        remoteRefreshInFlightRef.current = null;
      }
    },
    [reconcileWorkbookBranches, resolvedSyncStorage]
  );

  useEffect(() => {
    if (
      !syncAnchorHydrated ||
      cloudState.status !== 'signed_in' ||
      !cloudUserId ||
      !localWorkbookId
    ) {
      return;
    }
    const remote = cloudState.workbooks.find((item) => item.id === localWorkbookId);
    const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, cloudUserId, localWorkbookId);
    const change = asObject(cloudState.workbookChange);
    const changeSequence = Number(change.sequence) || 0;
    const exactRemoteDeletion =
      asString(change.eventType).toUpperCase() === 'DELETE' &&
      asString(change.workbookId) === localWorkbookId &&
      changeSequence > handledRemoteDeletionSequenceRef.current;
    if (exactRemoteDeletion) {
      handledRemoteDeletionSequenceRef.current = changeSequence;
      void markRemoteWorkbookDeleted(cloudUserId, localWorkbookId);
      return;
    }
    if (syncState.remoteDeleted === true) return;
    if (!remote) {
      if (syncState.known && syncState.revision) {
        void verifyRemoteWorkbookIntegrity({
          userId: cloudUserId,
          workbookId: localWorkbookId,
          listedRemote: null,
          syncState
        });
      } else if (syncState.conflict) {
        updateWorkbookConflict(localWorkbookId, true);
      }
      return;
    }
    if (syncState.conflict) {
      updateWorkbookConflict(localWorkbookId, true);
      return;
    }
    if (syncState.revision && remote.revision < syncState.revision) {
      void verifyRemoteWorkbookIntegrity({
        userId: cloudUserId,
        workbookId: localWorkbookId,
        listedRemote: remote,
        syncState
      });
      return;
    }
    if (!autoSyncEnabled) return;
    if (!syncState.known || !syncState.revision) {
      void Promise.resolve().then(() => {
        if (
          asString(stateRef.current.user?.id) === cloudUserId &&
          asString(workbookRef.current?.id) === localWorkbookId
        ) {
          return latchWorkbookConflict(cloudUserId, localWorkbookId, syncState.revision);
        }
        return null;
      });
      return;
    }
    if (!remote.conflict && remote.revision <= syncState.revision) {
      if (
        remote.revision === syncState.revision &&
        cloudState.pendingCount === 0 &&
        !remote.pending &&
        (!syncState.baseWorkbook || syncState.baseRevision !== syncState.revision) &&
        ['saved', 'cache'].includes(asString(saveStatusRef.current)) &&
        !pendingOperationRef.current &&
        !autoSyncSchedulerRef.current?.hasWork()
      ) {
        // Older Cavalry builds stored only the revision. Download and compare
        // the actual server snapshot before establishing a merge base: a file
        // restored or edited outside Cavalry can legitimately differ while it
        // still carries that same revision anchor.
        void refreshCurrentWorkbookFromCloud(cloudUserId, remote);
      }
      return;
    }

    // A realtime echo can arrive before the upload RPC resolves. Defer the
    // decision until the exact CAS result either advances the anchor or latches.
    if (pendingOperationRef.current || autoSyncSchedulerRef.current?.hasWork()) return;
    if (!['saved', 'cache'].includes(asString(saveStatusRef.current))) return;
    void refreshCurrentWorkbookFromCloud(cloudUserId, remote);
  }, [
    autoSyncEnabled,
    autoSyncEpoch,
    cloudState.pendingCount,
    cloudState.status,
    cloudState.workbookChange,
    cloudState.workbooks,
    cloudUserId,
    latchWorkbookConflict,
    localWorkbookId,
    markRemoteWorkbookDeleted,
    refreshCurrentWorkbookFromCloud,
    resolvedSyncStorage,
    syncAnchorHydrated,
    updateWorkbookConflict,
    verifyRemoteWorkbookIntegrity
  ]);

  useCloudWorkbookConflictEffects({
    applyRemoteState,
    autoSyncEnabled,
    syncAnchorHydrated,
    autoSyncSchedulerRef,
    clearSharedConflictNotice,
    cloudState,
    cloudUserId,
    conflictedWorkbookIds,
    conflictNoticePublicationRef,
    conflictReviewInFlightRef,
    invoke,
    localConflictNoticeRef,
    localWorkbookId,
    pendingOperationRef,
    persistMergedWorkbook,
    persistSyncState: flushDurableSyncState,
    publishConflictReport,
    reconcileWorkbookBranches,
    resolvedConflictAdoptionRef,
    resolvedSyncStorage,
    setLocalConflictNotice,
    setUiState,
    updateWorkbookConflict,
    workbookRef
  });

  const execute = useCloudWorkbookOperations({
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
    invoke,
    localConflictNoticeRef,
    navigate,
    pendingOperationRef,
    persistMergedWorkbook,
    publishConflictReport,
    reconcileWorkbookBranches,
    refreshState,
    resolvedSyncStorage,
    saveStatusRef,
    setAutoSyncPreferenceEpoch,
    setLocalConflictNotice,
    setUiState,
    setWorkbook,
    stateRef,
    updateWorkbookConflict,
    verifyRemoteWorkbookIntegrity,
    workbookRef,
    workbookStorage
  });

  const model = useMemo(() => {
    const workbookId = asString(workbook && workbook.id);
    const userId = asString(cloudState.user && cloudState.user.id);
    const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId);
    return buildCloudSettingsModel(cloudState, workbook, {
      ...uiState,
      autoSyncEnabled,
      autoSyncPhase:
        autoSyncStatus.userId === userId && autoSyncStatus.workbookId === workbookId
          ? autoSyncStatus.phase === 'failed' && uiState.automaticSyncError !== true
            ? 'idle'
            : autoSyncStatus.phase
          : 'idle',
      anchorRevision: syncState.revision,
      remoteDeleted: syncState.remoteDeleted === true,
      conflict: conflictedWorkbookIds.has(workbookId),
      conflictNotice: localConflictNotice
    });
  }, [
    autoSyncEnabled,
    autoSyncStatus,
    cloudState,
    conflictedWorkbookIds,
    localConflictNotice,
    resolvedSyncStorage,
    uiState,
    workbook
  ]);
  return { execute, model, refreshState };
}
