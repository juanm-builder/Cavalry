import { useEffect } from 'react';
import {
  describeWorkbookConflicts,
  mergeWorkbookSnapshots,
  shouldRefreshWorkbookConflictReview
} from '@cavalry/finance-core';

import {
  readCloudWorkbookSyncState,
  writeCloudWorkbookSyncState
} from './cloud-workbook-sync-state.js';
import { asObject, asRevision, asString, stateFromResult } from './cloud-workbook-model.js';

/**
 * Owns the two passive conflict-recovery protocols: upgrading reviews written
 * by older builds and adopting a resolution completed on another device.
 * Keeping these effects together makes their shared in-flight guards explicit
 * without expanding the main workbook controller.
 */
export function useCloudWorkbookConflictEffects({
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
  persistSyncState,
  publishConflictReport,
  reconcileWorkbookBranches,
  resolvedConflictAdoptionRef,
  resolvedSyncStorage,
  setLocalConflictNotice,
  setUiState,
  updateWorkbookConflict,
  workbookRef
}) {
  useEffect(() => {
    if (
      !syncAnchorHydrated ||
      !autoSyncEnabled ||
      cloudState.status !== 'signed_in' ||
      !cloudUserId ||
      !localWorkbookId ||
      !conflictedWorkbookIds.has(localWorkbookId) ||
      pendingOperationRef.current ||
      autoSyncSchedulerRef.current?.hasWork()
    ) {
      return;
    }
    const remote = cloudState.workbooks.find((item) => item.id === localWorkbookId);
    const remoteNotice = remote?.conflictNotice || null;
    const localNotice =
      asString(localConflictNoticeRef.current?.report?.workbookId) === localWorkbookId
        ? localConflictNoticeRef.current
        : null;
    const remoteReviewReady =
      remoteNotice?.resolutionAvailable === true &&
      !shouldRefreshWorkbookConflictReview(remoteNotice.report);
    const localReviewReady =
      localNotice?.resolutionAvailable === true &&
      !shouldRefreshWorkbookConflictReview(localNotice.report);
    if (!remote || remoteReviewReady || localReviewReady) return;
    const legacyNotice = remoteNotice || localNotice;
    if (
      legacyNotice?.resolutionAvailable === true &&
      asString(legacyNotice.sourceDevice) !== 'Mac'
    ) {
      return;
    }
    const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, cloudUserId, localWorkbookId);
    if (syncState.revision && remote.revision < syncState.revision) {
      // A recreated/rolled-back record is not a legacy content conflict. Keep
      // the durable anchor latched until the user explicitly chooses a copy.
      return;
    }
    const reviewKey = `${cloudUserId}:${localWorkbookId}:${syncState.baseRevision || 'none'}:${remote.revision}:decision-policy-v2`;
    if (conflictReviewInFlightRef.current === reviewKey) return;
    conflictReviewInFlightRef.current = reviewKey;
    const localWorkbook = workbookRef.current;
    let active = true;
    void invoke('downloadWorkbook', { workbookId: localWorkbookId })
      .then(async (download) => {
        if (
          !active ||
          !(download && download.ok && download.workbook) ||
          workbookRef.current !== localWorkbook ||
          asString(download.workbook.id) !== localWorkbookId
        ) {
          return;
        }
        const mergeBase = syncState.baseWorkbook || null;
        const merged = mergeWorkbookSnapshots({
          base: mergeBase,
          local: localWorkbook,
          remote: download.workbook
        });
        if (merged.ok) {
          const result = await reconcileWorkbookBranches({
            userId: cloudUserId,
            workbookId: localWorkbookId,
            localWorkbook,
            syncState
          });
          if (result?.ok) await clearSharedConflictNotice(localWorkbookId);
          return;
        }
        const review = describeWorkbookConflicts({
          base: mergeBase,
          local: localWorkbook,
          remote: download.workbook,
          conflicts: merged.conflicts,
          localLabel: 'This Mac',
          remoteLabel: 'iCloud copy'
        });
        await publishConflictReport({
          workbookId: localWorkbookId,
          baseRevision: syncState.baseRevision,
          remoteRevision: asRevision(asObject(download.metadata).revision) || remote.revision,
          sourceWorkbook: localWorkbook,
          baseWorkbook: mergeBase,
          review,
          force: true
        });
      })
      .finally(() => {
        if (conflictReviewInFlightRef.current === reviewKey) {
          conflictReviewInFlightRef.current = '';
        }
      });
    return () => {
      active = false;
    };
  }, [
    autoSyncEnabled,
    syncAnchorHydrated,
    autoSyncSchedulerRef,
    clearSharedConflictNotice,
    cloudState.status,
    cloudState.workbooks,
    cloudUserId,
    conflictedWorkbookIds,
    conflictReviewInFlightRef,
    invoke,
    localConflictNoticeRef,
    localWorkbookId,
    pendingOperationRef,
    publishConflictReport,
    reconcileWorkbookBranches,
    resolvedSyncStorage,
    workbookRef
  ]);

  useEffect(() => {
    if (
      !syncAnchorHydrated ||
      !autoSyncEnabled ||
      cloudState.status !== 'signed_in' ||
      !cloudUserId ||
      !localWorkbookId ||
      !conflictedWorkbookIds.has(localWorkbookId) ||
      pendingOperationRef.current ||
      autoSyncSchedulerRef.current?.hasWork()
    ) {
      return;
    }
    const remote = cloudState.workbooks.find((item) => item.id === localWorkbookId);
    const syncState = readCloudWorkbookSyncState(resolvedSyncStorage, cloudUserId, localWorkbookId);
    if (
      !remote ||
      (syncState.revision && remote.revision < syncState.revision) ||
      remote.conflictNotice ||
      !syncState.conflictNoticeId ||
      !syncState.conflictRemoteRevision ||
      remote.revision <= syncState.conflictRemoteRevision
    ) {
      return;
    }
    const adoptionKey = `${cloudUserId}:${localWorkbookId}:${remote.revision}`;
    if (resolvedConflictAdoptionRef.current === adoptionKey) return;
    resolvedConflictAdoptionRef.current = adoptionKey;
    const expectedWorkbook = workbookRef.current;
    let active = true;
    void invoke('downloadWorkbook', { workbookId: localWorkbookId })
      .then(async (download) => {
        const downloadState = stateFromResult(download);
        if (downloadState) applyRemoteState(downloadState);
        const revision = asRevision(asObject(download && download.metadata).revision);
        if (
          !active ||
          !(download && download.ok && download.workbook) ||
          workbookRef.current !== expectedWorkbook ||
          asString(download.workbook.id) !== localWorkbookId ||
          revision < remote.revision
        ) {
          return;
        }
        const persisted = await persistMergedWorkbook(expectedWorkbook, download.workbook);
        if (!(persisted && persisted.ok)) return;
        writeCloudWorkbookSyncState(resolvedSyncStorage, cloudUserId, localWorkbookId, {
          revision,
          conflict: false,
          baseRevision: revision,
          baseWorkbook: persisted.workbook
        });
        if (typeof persistSyncState === 'function') {
          const durableResult = await persistSyncState(cloudUserId, localWorkbookId);
          if (!(durableResult && durableResult.ok)) return;
        }
        updateWorkbookConflict(localWorkbookId, false);
        conflictNoticePublicationRef.current = '';
        localConflictNoticeRef.current = null;
        setLocalConflictNotice(null);
        setUiState({
          pendingOperation: '',
          notice: 'The resolution from your other device was applied.',
          error: ''
        });
      })
      .finally(() => {
        if (resolvedConflictAdoptionRef.current === adoptionKey) {
          resolvedConflictAdoptionRef.current = '';
        }
      });
    return () => {
      active = false;
    };
  }, [
    applyRemoteState,
    autoSyncEnabled,
    syncAnchorHydrated,
    autoSyncSchedulerRef,
    cloudState.status,
    cloudState.workbooks,
    cloudUserId,
    conflictedWorkbookIds,
    conflictNoticePublicationRef,
    invoke,
    localConflictNoticeRef,
    localWorkbookId,
    pendingOperationRef,
    persistMergedWorkbook,
    persistSyncState,
    resolvedConflictAdoptionRef,
    resolvedSyncStorage,
    setLocalConflictNotice,
    setUiState,
    updateWorkbookConflict,
    workbookRef
  ]);
}
