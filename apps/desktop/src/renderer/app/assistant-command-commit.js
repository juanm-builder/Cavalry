// Commits an Assistant candidate only after Cavalry's normal persistence boundary accepts it.
// Keeping this orchestration pure makes save failures and ordering independently testable.

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

export async function commitAssistantCommandResultDurably({
  result,
  currentWorkbook,
  saveWorkbook,
  applyCommandResult,
  isSaveEvent = () => false,
  updateCurrentWorkbook = () => {}
} = {}) {
  if (!(result && result.ok)) return result;
  if (typeof applyCommandResult !== 'function') {
    const error = new Error('The Assistant command commit adapter is unavailable.');
    error.code = 'assistant_commit_unavailable';
    throw error;
  }
  const nextWorkbook = result.workbook;
  const workbookChanged = Boolean(nextWorkbook && nextWorkbook !== currentWorkbook);
  let persistence = { status: 'not_required', durable: true };
  if (workbookChanged) {
    if (typeof saveWorkbook !== 'function') {
      const error = new Error('The workbook persistence adapter is unavailable.');
      error.code = 'assistant_persistence_unavailable';
      throw error;
    }
    let saved;
    try {
      saved = await saveWorkbook(nextWorkbook);
    } catch (cause) {
      const error = new Error(
        asText(cause?.message || cause) || 'The workbook could not be saved.'
      );
      error.code = 'assistant_persistence_failed';
      error.cause = cause;
      throw error;
    }
    if (!(saved && saved.ok)) {
      const error = new Error(asText(saved?.error) || 'The workbook change could not be saved.');
      error.code = 'assistant_persistence_failed';
      error.persistence = saved || { ok: false, error: error.message };
      throw error;
    }
    persistence = {
      status: saved.cached === true ? 'cached' : 'saved',
      savedAt: asText(saved.savedAt),
      durable: true
    };
  }

  const committedResult = {
    ...result,
    events: asArray(result.events).filter((event) => !isSaveEvent(event)),
    commitStatus: workbookChanged ? 'committed' : 'not_applicable',
    verificationStatus: 'verified',
    persistence
  };
  let applied;
  try {
    applied = await applyCommandResult(committedResult);
  } catch (cause) {
    if (workbookChanged) {
      // Persistence is already durable at this point. Keep subsequent Assistant reads aligned
      // with the file and report a committed-but-unverified outcome instead of claiming rollback.
      updateCurrentWorkbook(nextWorkbook);
      const detail = asText(cause?.message || cause);
      const error = new Error(
        `The workbook was saved, but Cavalry could not finish reconciling the updated view${
          detail ? `: ${detail}` : '.'
        }`
      );
      error.code = 'assistant_post_commit_reconciliation_failed';
      error.cause = cause;
      error.commitStatus = 'committed';
      error.verificationStatus = 'failed';
      error.persistence = persistence;
      throw error;
    }
    throw cause;
  }
  if (nextWorkbook) updateCurrentWorkbook(nextWorkbook);
  return {
    ...applied,
    commitStatus: committedResult.commitStatus,
    verificationStatus: committedResult.verificationStatus,
    persistence
  };
}
