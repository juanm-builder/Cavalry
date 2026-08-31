import {
  describeWorkbookConflicts,
  mergeWorkbookSnapshots,
  reconcileWorkbookSnapshots
} from '@cavalry/finance-core';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

function stateFromResult(result) {
  const source = asObject(result);
  return source.state && typeof source.state === 'object' ? source.state : null;
}

export async function reconcileReviewedCloudWorkbookConflict({
  currentWorkbook,
  userId,
  notice,
  payload,
  invoke,
  applyRemoteState,
  persistMergedWorkbook,
  publishConflictReport
}) {
  const workbookId = asString(currentWorkbook && currentWorkbook.id);
  const choices = Array.isArray(payload && payload.choices) ? payload.choices : [];
  const fail = (error, code) => ({ result: { ok: false, ...(code ? { code } : {}), error } });
  if (!workbookId) return fail('Open a workbook before resolving this conflict.');
  if (!userId) return fail('Sign in to iCloud in System Settings first.');
  if (
    !notice ||
    asString(notice.id) !== asString(payload && payload.conflictNoticeId) ||
    asString(notice.report && notice.report.workbookId) !== workbookId ||
    notice.resolutionAvailable !== true
  ) {
    return fail(
      'This conflict review changed. Open the latest review and choose again.',
      'stale_resolution'
    );
  }
  const conflictPackage = await invoke('downloadConflictPackage', {
    workbookId,
    conflictNoticeId: notice.id
  });
  const packageState = stateFromResult(conflictPackage);
  if (packageState) applyRemoteState(packageState);
  if (!(conflictPackage && conflictPackage.ok && conflictPackage.sourceWorkbook)) {
    return { result: conflictPackage };
  }
  if (
    asString(conflictPackage.conflictNoticeId) !== asString(notice.id) ||
    asString(conflictPackage.sourceWorkbook.id) !== workbookId ||
    (conflictPackage.baseWorkbook && asString(conflictPackage.baseWorkbook.id) !== workbookId)
  ) {
    return fail(
      'The conflict review changed. Sync and open the latest review.',
      'stale_resolution'
    );
  }

  const download = await invoke('downloadWorkbook', { workbookId });
  const downloadState = stateFromResult(download);
  if (downloadState) applyRemoteState(downloadState);
  if (!(download && download.ok && download.workbook)) return { result: download };
  const remoteRevision = asRevision(asObject(download.metadata).revision);
  const sourceWorkbook = conflictPackage.sourceWorkbook;
  const mergeBase = conflictPackage.baseWorkbook || null;
  const sourceLabel = asString(notice.sourceDevice) === 'iPhone' ? 'This iPhone' : 'This Mac';
  let reconciled = reconcileWorkbookSnapshots({
    base: mergeBase,
    local: sourceWorkbook,
    remote: download.workbook,
    choices
  });
  if (!remoteRevision) {
    return fail('Cavalry could not verify the latest iCloud revision. Sync and try again.');
  }
  if (remoteRevision !== asRevision(notice.remoteRevision)) {
    const latestMerge = mergeWorkbookSnapshots({
      base: mergeBase,
      local: sourceWorkbook,
      remote: download.workbook
    });
    if (!latestMerge.ok) {
      await publishConflictReport({
        workbookId,
        baseRevision: notice.baseRevision,
        remoteRevision,
        force: true,
        sourceWorkbook,
        baseWorkbook: mergeBase,
        review: describeWorkbookConflicts({
          base: mergeBase,
          local: sourceWorkbook,
          remote: download.workbook,
          conflicts: latestMerge.conflicts,
          localLabel: sourceLabel,
          remoteLabel: 'iCloud copy'
        })
      });
      return fail(
        'The iCloud copy changed while you were reviewing it. Cavalry refreshed the choices.',
        'stale_resolution'
      );
    }
    // If the latest server copy now combines without ambiguity, there is no
    // decision left to ask. Commit that safe merge instead of inventing a
    // whole-workbook fallback choice.
    reconciled = { ...latestMerge, resolvedPaths: [] };
  }
  if (!reconciled.ok) {
    const latestMerge = mergeWorkbookSnapshots({
      base: mergeBase,
      local: sourceWorkbook,
      remote: download.workbook
    });
    if (latestMerge.ok) {
      // The submitted choices can become stale even at the same numeric
      // revision (for example after a delayed conflict-package refresh). If
      // the actual branches now combine safely, there is no new decision.
      reconciled = { ...latestMerge, resolvedPaths: [] };
    } else {
      await publishConflictReport({
        workbookId,
        baseRevision: notice.baseRevision,
        remoteRevision,
        force: true,
        sourceWorkbook,
        baseWorkbook: mergeBase,
        review: describeWorkbookConflicts({
          base: mergeBase,
          local: sourceWorkbook,
          remote: download.workbook,
          conflicts: latestMerge.conflicts,
          localLabel: sourceLabel,
          remoteLabel: 'iCloud copy'
        })
      });
      return fail(
        'The choices no longer match this conflict. Review the refreshed changes.',
        reconciled.code || 'invalid_resolution'
      );
    }
  }
  const persisted = await persistMergedWorkbook(currentWorkbook, reconciled.workbook);
  if (!persisted.ok) return { result: persisted };
  const uploadSyncContext = {
    userId,
    workbookId,
    revision: remoteRevision,
    workbook: persisted.workbook
  };
  let result = await invoke('uploadWorkbook', {
    workbook: persisted.workbook,
    expectedRevision: remoteRevision,
    conflictResolution: 'keep_local'
  });
  if (result && result.ok) {
    result = { ...result, workbook: persisted.workbook, reconciled: true };
  }
  return { result, uploadSyncContext };
}

/**
 * Downloads the server winner, combines independent local/remote changes, and
 * retries one guarded replacement. All platform and React state mutations are
 * injected so the merge protocol stays deterministic and directly testable.
 */
export async function reconcileCloudWorkbookBranches({
  userId,
  workbookId,
  localWorkbook,
  syncState,
  invoke,
  applyRemoteState,
  refreshState,
  isRetryableFailure,
  getCurrentWorkbook,
  persistMergedWorkbook,
  latchConflict,
  reportConflict,
  writeSyncState,
  clearConflict
}) {
  let localBranch = localWorkbook;
  let localGuard = localWorkbook;
  let mergeBase =
    syncState.baseWorkbook &&
    syncState.baseRevision &&
    (!syncState.revision || syncState.baseRevision <= syncState.revision)
      ? syncState.baseWorkbook
      : null;
  let latestRemoteRevision = asRevision(syncState.revision);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentWorkbook = getCurrentWorkbook();
    if (
      currentWorkbook !== localGuard ||
      asString(currentWorkbook && currentWorkbook.id) !== workbookId
    ) {
      return { ok: false, retry: true, code: 'local_workbook_changed' };
    }

    const download = await invoke('downloadWorkbook', { workbookId });
    const downloadState = stateFromResult(download);
    if (downloadState) applyRemoteState(downloadState);
    if (!(download && download.ok && download.workbook)) {
      return {
        ...(download || {}),
        ok: false,
        retry: isRetryableFailure(download)
      };
    }
    if (asString(download.workbook.id) !== workbookId) {
      const persistedConflict = await latchConflict(latestRemoteRevision);
      if (persistedConflict && persistedConflict.ok === false) {
        return { ...persistedConflict, ok: false, retry: false, conflict: true };
      }
      return {
        ok: false,
        retry: false,
        conflict: true,
        code: 'cloud_workbook_identity_mismatch'
      };
    }
    if (getCurrentWorkbook() !== localGuard) {
      return { ok: false, retry: true, code: 'local_workbook_changed' };
    }

    const remoteWorkbook = download.workbook;
    const remoteRevision = asRevision(asObject(download.metadata).revision);
    if (!remoteRevision) {
      return { ok: false, retry: true, code: 'cloud_revision_missing' };
    }
    latestRemoteRevision = remoteRevision;
    const merged = mergeWorkbookSnapshots({
      base: mergeBase,
      local: localBranch,
      remote: remoteWorkbook,
      conflictPolicy: 'prefer_local'
    });
    if (!merged.ok) {
      if (typeof reportConflict === 'function') {
        const review = describeWorkbookConflicts({
          base: mergeBase,
          local: localBranch,
          remote: remoteWorkbook,
          conflicts: merged.conflicts,
          localLabel: 'This Mac',
          remoteLabel: 'iCloud copy'
        });
        try {
          await reportConflict({
            baseRevision: asRevision(syncState.baseRevision) || null,
            remoteRevision,
            sourceWorkbook: localBranch,
            baseWorkbook: mergeBase,
            review
          });
        } catch (_error) {
          // The local branch must still be latched even if sharing the compact
          // review is temporarily unavailable.
        }
      }
      const persistedConflict = await latchConflict(remoteRevision);
      if (persistedConflict && persistedConflict.ok === false) {
        return { ...persistedConflict, ok: false, retry: false, conflict: true };
      }
      return {
        ok: false,
        retry: false,
        conflict: true,
        code: 'workbook_revision_conflict',
        error:
          'The same workbook item changed differently on both devices. Choose which copy to keep.'
      };
    }

    if (merged.needsLocalSave) {
      const persisted = await persistMergedWorkbook(localGuard, merged.workbook);
      if (!persisted.ok) return persisted;
      localGuard = persisted.workbook;
      localBranch = persisted.workbook;
    } else {
      localBranch = merged.workbook;
    }

    if (!merged.needsUpload) {
      const persistedSyncState = await writeSyncState({
        revision: remoteRevision,
        conflict: false,
        baseRevision: remoteRevision,
        baseWorkbook: remoteWorkbook
      });
      if (persistedSyncState && persistedSyncState.ok === false) return persistedSyncState;
      clearConflict();
      if (!downloadState) await refreshState();
      return {
        ok: true,
        retry: false,
        metadata: { ...asObject(download.metadata), revision: remoteRevision },
        workbook: localBranch,
        merged: true
      };
    }

    const upload = await invoke('uploadWorkbook', {
      workbook: localBranch,
      expectedRevision: remoteRevision,
      conflictResolution: 'keep_local'
    });
    const uploadState = stateFromResult(upload);
    if (uploadState) applyRemoteState(uploadState);
    if (upload && (upload.conflict === true || upload.code === 'workbook_revision_conflict')) {
      mergeBase = remoteWorkbook;
      continue;
    }
    if (!(upload && upload.ok)) {
      return {
        ...(upload || {}),
        ok: false,
        retry: isRetryableFailure(upload)
      };
    }

    const metadata = asObject(upload.metadata);
    const uploadedRevision = asRevision(metadata.revision);
    if ((asString(metadata.id) && asString(metadata.id) !== workbookId) || !uploadedRevision) {
      return {
        ok: false,
        retry: !uploadedRevision,
        code: asString(metadata.id) ? 'cloud_workbook_identity_mismatch' : 'cloud_revision_missing'
      };
    }
    const persistedSyncState = await writeSyncState({
      revision: uploadedRevision,
      conflict: false,
      baseRevision: upload.pending === true ? remoteRevision : uploadedRevision,
      baseWorkbook: upload.pending === true ? remoteWorkbook : localBranch
    });
    if (persistedSyncState && persistedSyncState.ok === false) return persistedSyncState;
    clearConflict();
    if (!uploadState) await refreshState();
    return { ...upload, retry: false, workbook: localBranch, merged: true };
  }

  return {
    ok: false,
    retry: true,
    retryable: true,
    code: 'cloud_workbook_changed_again',
    error: 'iCloud kept changing. Try again.'
  };
}
