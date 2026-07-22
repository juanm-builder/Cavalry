function asString(value) {
  return String(value == null ? '' : value).trim();
}

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function canAccessWorkbook(caller, workbookId) {
  const allowed = Array.isArray(caller && caller.allowed_workbook_ids)
    ? caller.allowed_workbook_ids.map(asString).filter(Boolean)
    : [];
  return !allowed.length || allowed.includes(asString(workbookId));
}

export function createLiveCompanionWorkbookStore({
  getWorkbook,
  saveWorkbook,
  cloneOnRead = false
} = {}) {
  if (typeof getWorkbook !== 'function') {
    throw new Error('createLiveCompanionWorkbookStore requires getWorkbook.');
  }
  const readWorkbook = () => {
    const workbook = getWorkbook();
    return workbook && typeof workbook === 'object' ? workbook : null;
  };
  const maybeClone = (workbook) => (cloneOnRead ? clonePlain(workbook) : workbook);
  return {
    listWorkbooks(caller) {
      const workbook = readWorkbook();
      if (!workbook || !asString(workbook.id) || !canAccessWorkbook(caller, workbook.id)) {
        return [];
      }
      return [maybeClone(workbook)];
    },
    getWorkbook(workbookId) {
      const workbook = readWorkbook();
      if (!workbook || asString(workbook.id) !== asString(workbookId)) {
        return null;
      }
      return maybeClone(workbook);
    },
    saveWorkbook(workbook) {
      if (typeof saveWorkbook === 'function') {
        return saveWorkbook(workbook);
      }
      return workbook;
    }
  };
}
