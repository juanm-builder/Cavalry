export const CLOUD_WORKBOOK_AUTO_SYNC_DEBOUNCE_MS = 800;
export const CLOUD_WORKBOOK_AUTO_SYNC_RETRY_MS = 5_000;

function isSameTarget(left, right) {
  return !!(left && right && left.userId === right.userId && left.workbookId === right.workbookId);
}

function hasExpectedRevision(entry) {
  return Object.prototype.hasOwnProperty.call(entry || {}, 'expectedRevision');
}

function carryExpectedRevision(source, target) {
  if (
    !isSameTarget(source, target) ||
    !hasExpectedRevision(source) ||
    hasExpectedRevision(target)
  ) {
    return target;
  }
  return { ...target, expectedRevision: source.expectedRevision };
}

export function createCloudWorkbookAutoSyncScheduler({
  performSync,
  debounceMs = CLOUD_WORKBOOK_AUTO_SYNC_DEBOUNCE_MS,
  retryMs = CLOUD_WORKBOOK_AUTO_SYNC_RETRY_MS,
  scheduleTimer = (callback, delay) => setTimeout(callback, delay),
  cancelTimer = (timer) => clearTimeout(timer),
  onStatus = () => {}
} = {}) {
  if (typeof performSync !== 'function') {
    throw new TypeError('performSync is required.');
  }

  let activeEntry = null;
  let pendingEntry = null;
  let scheduledTimer = null;
  let scheduledPhase = '';
  let stopped = false;

  function getStatus(completion = null) {
    const target = activeEntry || pendingEntry || completion?.entry || null;
    const phase = activeEntry
      ? 'syncing'
      : pendingEntry || scheduledTimer !== null
        ? scheduledPhase === 'retrying'
          ? 'retrying'
          : 'waiting'
        : completion?.result && completion.result.ok === false
          ? 'failed'
          : 'idle';
    return {
      active: !!activeEntry,
      pending: !!pendingEntry,
      scheduled: scheduledTimer !== null,
      phase,
      userId: target?.userId || '',
      workbookId: target?.workbookId || '',
      ...(completion ? { result: completion.result } : {})
    };
  }

  function publishStatus(completion = null) {
    onStatus(getStatus(completion));
  }

  function clearScheduledTimer() {
    if (scheduledTimer === null) return;
    cancelTimer(scheduledTimer);
    scheduledTimer = null;
    scheduledPhase = '';
  }

  function schedule(delay, phase = 'waiting') {
    if (stopped || !pendingEntry) return;
    clearScheduledTimer();
    scheduledPhase = phase;
    const timer = scheduleTimer(
      () => {
        if (scheduledTimer !== timer) return;
        scheduledTimer = null;
        scheduledPhase = '';
        void startPendingSync();
      },
      Math.max(0, Number(delay) || 0)
    );
    scheduledTimer = timer;
    publishStatus();
  }

  async function startPendingSync() {
    if (stopped || activeEntry || !pendingEntry) return;
    clearScheduledTimer();
    const entry = pendingEntry;
    pendingEntry = null;
    activeEntry = entry;
    publishStatus();

    let result;
    try {
      result = (await performSync(entry)) || { ok: false, retry: true };
    } catch (_error) {
      result = { ok: false, retry: true };
    }

    if (activeEntry === entry) activeEntry = null;
    if (stopped) {
      return result;
    }

    const conflict = result.conflict === true || result.code === 'workbook_revision_conflict';
    if (!result.ok && result.retry !== false && !conflict) {
      if (pendingEntry) {
        pendingEntry = carryExpectedRevision(entry, pendingEntry);
      } else {
        pendingEntry = entry;
      }
      schedule(retryMs, 'retrying');
    } else if (pendingEntry) {
      schedule(debounceMs, 'waiting');
    } else {
      publishStatus({ entry, result });
    }
    return result;
  }

  function enqueue(entry) {
    if (stopped || !(entry && entry.userId && entry.workbookId && entry.workbook)) {
      return false;
    }
    const nextEntry = carryExpectedRevision(pendingEntry, { ...entry });
    pendingEntry = nextEntry;
    schedule(debounceMs, 'waiting');
    return true;
  }

  function cancelPending() {
    const canceledEntry = pendingEntry;
    pendingEntry = null;
    clearScheduledTimer();
    publishStatus(
      canceledEntry
        ? {
            entry: canceledEntry,
            result: { ok: false, code: 'cloud_sync_cancelled', canceled: true }
          }
        : null
    );
  }

  function stop() {
    stopped = true;
    pendingEntry = null;
    clearScheduledTimer();
  }

  return Object.freeze({
    cancelPending,
    enqueue,
    getStatus,
    hasWork: () => !!(activeEntry || pendingEntry || scheduledTimer !== null),
    stop
  });
}
