export const WORKBOOK_AUTOSAVE_DEBOUNCE_MS = 200;

export function createLatestWorkbookSaveScheduler({
  performSave,
  debounceMs = WORKBOOK_AUTOSAVE_DEBOUNCE_MS,
  scheduleTimer = (callback, delay) => setTimeout(callback, delay),
  cancelTimer = (timer) => clearTimeout(timer)
} = {}) {
  if (typeof performSave !== 'function') {
    throw new TypeError('performSave is required.');
  }

  let activeSave = null;
  let pendingSave = null;
  let debounceTimer = null;

  function clearDebounceTimer() {
    if (debounceTimer === null) return;
    cancelTimer(debounceTimer);
    debounceTimer = null;
  }

  function startPendingSave() {
    if (activeSave || !pendingSave || !pendingSave.ready) return;

    clearDebounceTimer();
    const entry = pendingSave;
    pendingSave = null;
    const promise = Promise.resolve().then(() =>
      entry.perform(entry.workbook, { hasAutomatic: entry.hasAutomatic })
    );
    activeSave = { promise };

    promise.then(
      (result) => {
        entry.resolve(result);
        if (activeSave && activeSave.promise === promise) activeSave = null;
        startPendingSave();
      },
      (error) => {
        entry.reject(error);
        if (activeSave && activeSave.promise === promise) activeSave = null;
        startPendingSave();
      }
    );
  }

  function armDebounceTimer() {
    clearDebounceTimer();
    const timer = scheduleTimer(
      () => {
        if (debounceTimer !== timer) return;
        debounceTimer = null;
        if (pendingSave) pendingSave.ready = true;
        startPendingSave();
      },
      Math.max(0, Number(debounceMs) || 0)
    );
    debounceTimer = timer;
  }

  function enqueue(workbook, { automatic = false, perform } = {}) {
    const customOperation = typeof perform === 'function';
    if (pendingSave) {
      pendingSave.workbook = workbook;
      if (automatic) pendingSave.hasAutomatic = true;
      if (customOperation) {
        pendingSave.perform = perform;
        pendingSave.preserveOperation = true;
      } else if (!pendingSave.preserveOperation) {
        pendingSave.perform = performSave;
      }
      if (!automatic) pendingSave.ready = true;
    } else {
      let resolve;
      let reject;
      const promise = new Promise((next, fail) => {
        resolve = next;
        reject = fail;
      });
      pendingSave = {
        workbook,
        hasAutomatic: automatic,
        ready: !automatic,
        perform: customOperation ? perform : performSave,
        preserveOperation: customOperation,
        promise,
        resolve,
        reject
      };
    }
    const result = pendingSave.promise;

    if (pendingSave.ready) {
      clearDebounceTimer();
      startPendingSave();
    } else {
      armDebounceTimer();
    }
    return result;
  }

  function flush() {
    if (pendingSave) {
      const result = pendingSave.promise;
      pendingSave.ready = true;
      clearDebounceTimer();
      startPendingSave();
      return result;
    }
    return activeSave ? activeSave.promise : Promise.resolve({ ok: true, idle: true });
  }

  return Object.freeze({ enqueue, flush });
}
