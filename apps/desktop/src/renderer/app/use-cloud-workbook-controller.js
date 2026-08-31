import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  readCloudWorkbookSyncState,
  resolveCloudWorkbookSyncStorage,
  writeCloudWorkbookSyncState
} from './cloud-workbook-sync-state.js';
import { createCloudWorkbookAutoSyncScheduler } from './cloud-workbook-auto-sync.js';
import {
  reconcileCloudWorkbookBranches,
  reconcileReviewedCloudWorkbookConflict
} from './cloud-workbook-branch-reconciler.js';
import { useCloudWorkbookConflictEffects } from './cloud-workbook-conflict-effects.js';
import {
  EMPTY_CLOUD_STATE,
  asObject,
  asRevision,
  asString,
  buildCloudSettingsModel,
  buildConflictNotice,
  conflictNoticePublicationKey,
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
  const [uiState, setUiState] = useState({ pendingOperation: '', notice: '', error: '' });
  const [localConflictNotice, setLocalConflictNotice] = useState(null);
  const resolvedSyncStorage = useMemo(
    () => resolveCloudWorkbookSyncStorage(syncStorage),
    [syncStorage]
  );
  const stateRef = useRef(cloudState);
  const workbookRef = useRef(workbook);
  const saveStatusRef = useRef(saveStatus);
  const pendingOperationRef = useRef('');
  const previousLocalSaveSequenceRef = useRef(Math.max(0, Number(localSaveSequence) || 0));
  const suppressNextAutoSyncRef = useRef(null);
  const initialEnrollmentRef = useRef('');
  const remoteRefreshInFlightRef = useRef(null);
  const conflictNoticePublicationRef = useRef('');
  const conflictReviewInFlightRef = useRef('');
  const resolvedConflictAdoptionRef = useRef('');
  const localConflictNoticeRef = useRef(null);
  const [conflictedWorkbookIds, setConflictedWorkbookIds] = useState(() => new Set());
  const conflictedWorkbookIdsRef = useRef(conflictedWorkbookIds);
  const [autoSyncEpoch, setAutoSyncEpoch] = useState(0);
  const autoSyncSchedulerRef = useRef(null);
  const cloudUserId = asString(cloudState.user && cloudState.user.id);
  const localWorkbookId = asString(workbook && workbook.id);

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
        }
      }
      return result;
    },
    [applyRemoteState, invoke, resolvedSyncStorage]
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

  const latchWorkbookConflict = useCallback(
    (userId, workbookId, revision) => {
      const ownerId = asString(userId);
      const targetId = asString(workbookId);
      if (!(ownerId && targetId)) return;
      writeCloudWorkbookSyncState(resolvedSyncStorage, ownerId, targetId, {
        revision: asRevision(revision) || null,
        conflict: true
      });
      updateWorkbookConflict(targetId, true);
    },
    [resolvedSyncStorage, updateWorkbookConflict]
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
        writeSyncState: (nextState) =>
          writeCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId, nextState),
        clearConflict: () => updateWorkbookConflict(workbookId, false)
      }),
    [
      applyRemoteState,
      invoke,
      latchWorkbookConflict,
      persistMergedWorkbook,
      publishConflictReport,
      refreshState,
      resolvedSyncStorage,
      updateWorkbookConflict
    ]
  );

  const performAutomaticCloudSync = useCallback(
    async (entry) => {
      const currentState = stateRef.current;
      const currentUserId = asString(currentState.user && currentState.user.id);
      const currentWorkbookId = asString(entry && entry.workbookId);
      if (
        currentState.status !== 'signed_in' ||
        !currentUserId ||
        currentUserId !== asString(entry && entry.userId) ||
        !currentWorkbookId
      ) {
        return { ok: false, retry: false, code: 'not_signed_in' };
      }

      const syncState = readCloudWorkbookSyncState(
        resolvedSyncStorage,
        currentUserId,
        currentWorkbookId
      );
      if (syncState.remoteDeleted === true) {
        return { ok: false, retry: false, code: 'cloud_sync_disabled' };
      }
      if (syncState.conflict || conflictedWorkbookIdsRef.current.has(currentWorkbookId)) {
        return { ok: false, retry: false, conflict: true, code: 'workbook_revision_conflict' };
      }
      const remote = currentState.workbooks.find((item) => item.id === currentWorkbookId);
      if (!remote && syncState.known && syncState.revision) {
        return { ok: false, retry: false, code: 'cloud_workbook_missing' };
      }
      if (
        remote &&
        (remote.conflict ||
          !syncState.known ||
          !syncState.revision ||
          remote.revision !== syncState.revision)
      ) {
        return reconcileWorkbookBranches({
          userId: currentUserId,
          workbookId: currentWorkbookId,
          localWorkbook: entry.workbook,
          syncState
        });
      }

      if (!Object.prototype.hasOwnProperty.call(entry, 'expectedRevision')) {
        entry.expectedRevision = syncState.known ? syncState.revision : null;
      }
      const result = await invoke('uploadWorkbook', {
        workbook: entry.workbook,
        expectedRevision: entry.expectedRevision
      });
      const resultState = stateFromResult(result);

      if (result && (result.conflict === true || result.code === 'workbook_revision_conflict')) {
        if (resultState) applyRemoteState(resultState);
        return reconcileWorkbookBranches({
          userId: currentUserId,
          workbookId: currentWorkbookId,
          localWorkbook: entry.workbook,
          syncState
        });
      }
      if (!(result && result.ok)) {
        return { ...(result || {}), retry: isRetryableAutomaticSyncFailure(result) };
      }

      const metadata = asObject(result.metadata);
      const metadataId = asString(metadata.id);
      if (metadataId && metadataId !== currentWorkbookId) {
        return {
          ok: false,
          retry: false,
          code: 'cloud_workbook_identity_mismatch'
        };
      }
      const resultRemote = (
        resultState ? normalizeCloudState(resultState) : currentState
      ).workbooks.find((item) => item.id === currentWorkbookId);
      const revision = asRevision(metadata.revision || (resultRemote && resultRemote.revision));
      if (!revision) {
        return { ok: false, retry: true, code: 'cloud_revision_missing' };
      }

      writeCloudWorkbookSyncState(resolvedSyncStorage, currentUserId, currentWorkbookId, {
        revision,
        conflict: false,
        remoteDeleted: false,
        ...(result.pending === true
          ? {}
          : {
              baseRevision: revision,
              baseWorkbook: entry.workbook
            })
      });
      updateWorkbookConflict(currentWorkbookId, false);
      if (resultState) applyRemoteState(resultState);
      else await refreshState();
      return { ...result, retry: false };
    },
    [
      applyRemoteState,
      invoke,
      reconcileWorkbookBranches,
      refreshState,
      resolvedSyncStorage,
      updateWorkbookConflict
    ]
  );
  useEffect(() => {
    const scheduler = createCloudWorkbookAutoSyncScheduler({
      ...(autoSyncSchedulerOptions || {}),
      performSync: performAutomaticCloudSync,
      onStatus: () => setAutoSyncEpoch((current) => current + 1)
    });
    autoSyncSchedulerRef.current = scheduler;
    return () => {
      if (autoSyncSchedulerRef.current === scheduler) autoSyncSchedulerRef.current = null;
      scheduler.stop();
    };
  }, [autoSyncSchedulerOptions, performAutomaticCloudSync]);

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
    cloudState.status,
    cloudState.workbooks,
    cloudUserId,
    localWorkbookId,
    resolvedSyncStorage,
    saveStatus,
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
    if (stateRef.current.status !== 'signed_in' || !(userId && workbookId && currentWorkbook)) {
      return;
    }
    const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId);
    if (syncState.remoteDeleted === true) return;
    autoSyncSchedulerRef.current?.enqueue({
      userId,
      workbookId,
      workbook: currentWorkbook
    });
  }, [localSaveSequence, resolvedSyncStorage, workbook]);

  const refreshCurrentWorkbookFromCloud = useCallback(
    async (userId, remote) => {
      const workbookId = asString(remote && remote.id);
      const revision = asRevision(remote && remote.revision);
      if (!(userId && workbookId && revision) || remoteRefreshInFlightRef.current) return;
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
        await reconcileWorkbookBranches({
          userId,
          workbookId,
          localWorkbook,
          syncState
        });
      } finally {
        remoteRefreshInFlightRef.current = null;
      }
    },
    [reconcileWorkbookBranches, resolvedSyncStorage]
  );

  useEffect(() => {
    if (cloudState.status !== 'signed_in' || !cloudUserId || !localWorkbookId) return;
    const remote = cloudState.workbooks.find((item) => item.id === localWorkbookId);
    const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, cloudUserId, localWorkbookId);
    if (!remote) {
      if (syncState.conflict) {
        updateWorkbookConflict(localWorkbookId, true);
      }
      return;
    }
    if (syncState.conflict) {
      updateWorkbookConflict(localWorkbookId, true);
      return;
    }
    if (!syncState.known || !syncState.revision) {
      latchWorkbookConflict(cloudUserId, localWorkbookId, syncState.revision);
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
    autoSyncEpoch,
    cloudState.pendingCount,
    cloudState.status,
    cloudState.workbookChange,
    cloudState.workbooks,
    cloudUserId,
    latchWorkbookConflict,
    localWorkbookId,
    refreshCurrentWorkbookFromCloud,
    resolvedSyncStorage,
    updateWorkbookConflict
  ]);

  useCloudWorkbookConflictEffects({
    applyRemoteState,
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
    publishConflictReport,
    reconcileWorkbookBranches,
    resolvedConflictAdoptionRef,
    resolvedSyncStorage,
    setLocalConflictNotice,
    setUiState,
    updateWorkbookConflict,
    workbookRef
  });

  const execute = useCallback(
    async (operation, payload = {}) => {
      const operationName = asString(operation);
      if (pendingOperationRef.current) {
        return {
          ok: false,
          code: 'cloud_operation_in_progress',
          error: 'Another iCloud operation is already in progress.'
        };
      }
      pendingOperationRef.current = operationName || 'unknown';
      setUiState({ pendingOperation: operationName, notice: '', error: '' });
      let result;
      let uploadSyncContext = null;
      let openSyncContext = null;
      let deleteSyncContext = null;
      try {
        if (operationName === 'refresh') {
          result = await invoke('listWorkbooks');
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
              workbook: currentWorkbook
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
                expectedRevision: syncState.known ? syncState.revision : null
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
            persistMergedWorkbook,
            publishConflictReport
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
          }
          result = {
            ...result,
            error: remoteStillExists
              ? 'The iCloud version changed. Choose which version to keep before syncing again.'
              : 'The previous iCloud version was deleted. Your Mac workbook is safe. Choose Add Mac Version to iCloud to recreate it.'
          };
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
          }
          updateWorkbookConflict(currentWorkbookId, false);
          if (['keep-local', 'reconcile'].includes(operationName)) {
            await clearSharedConflictNotice(currentWorkbookId);
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
            await clearSharedConflictNotice(workbookId);
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
          updateWorkbookConflict(workbookId, false);
          if (asString(localConflictNoticeRef.current?.report?.workbookId) === workbookId) {
            localConflictNoticeRef.current = null;
            setLocalConflictNotice(null);
          }
        }

        if (!(result && result.ok)) {
          const error = errorMessageFromResult(result) || 'The cloud request failed.';
          setUiState({ pendingOperation: '', notice: '', error });
          return { ...(result || {}), ok: false, error };
        }

        const notices = {
          refresh: 'iCloud workbooks refreshed.',
          upload: result.pending
            ? 'Workbook saved locally and queued for iCloud.'
            : 'Workbook saved to iCloud.',
          'keep-local': result.pending
            ? 'Mac copy kept and queued for iCloud.'
            : 'Mac copy kept in iCloud.',
          reconcile: result.pending
            ? 'Resolution saved and queued for iCloud.'
            : 'Changes reconciled and synced.',
          open: 'iCloud workbook opened.',
          delete: result.pending
            ? 'Workbook removal queued for iCloud.'
            : 'Workbook removed from iCloud.'
        };
        setUiState({ pendingOperation: '', notice: notices[operationName] || '', error: '' });
        return result;
      } catch (error) {
        const message = error && error.message ? error.message : 'The iCloud request failed.';
        setUiState({ pendingOperation: '', notice: '', error: message });
        return { ok: false, error: message };
      } finally {
        pendingOperationRef.current = '';
      }
    },
    [
      applyRemoteState,
      browserCache,
      clearSharedConflictNotice,
      invoke,
      navigate,
      persistMergedWorkbook,
      publishConflictReport,
      reconcileWorkbookBranches,
      refreshState,
      resolvedSyncStorage,
      setWorkbook,
      updateWorkbookConflict,
      workbookStorage
    ]
  );

  const model = useMemo(() => {
    const workbookId = asString(workbook && workbook.id);
    const userId = asString(cloudState.user && cloudState.user.id);
    const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, userId, workbookId);
    return buildCloudSettingsModel(cloudState, workbook, {
      ...uiState,
      remoteDeleted: syncState.remoteDeleted === true,
      conflict: conflictedWorkbookIds.has(workbookId),
      conflictNotice: localConflictNotice
    });
  }, [
    cloudState,
    conflictedWorkbookIds,
    localConflictNotice,
    resolvedSyncStorage,
    uiState,
    workbook
  ]);
  return { execute, model, refreshState };
}
