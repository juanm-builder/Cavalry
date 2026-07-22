import { normalizeAdvisorAttachments } from './image-attachments.js';

export const ADVISOR_COMPOSER_DRAFTS_STORAGE_KEY = 'advisorComposerDrafts:v1';
export const ADVISOR_COMPOSER_DRAFTS_VERSION = 1;
export const ADVISOR_NEW_CHAT_DRAFT_KEY = 'new';

function asString(value) {
  return String(value || '').trim();
}

function normalizeAttachments(value) {
  return normalizeAdvisorAttachments(value, { allowInvalid: true }).attachments;
}

export function getAdvisorComposerWorkbookKey(workbook) {
  return asString(workbook && workbook.id);
}

export function getAdvisorComposerDraftKey(threadId) {
  const id = asString(threadId);
  return id ? 'thread:' + id : ADVISOR_NEW_CHAT_DRAFT_KEY;
}

export function normalizeAdvisorComposerDraftRecord(value) {
  if (!(value && typeof value === 'object')) {
    return null;
  }
  const text = String(value.text || '');
  const attachments = normalizeAttachments(value.attachments);
  if (!text.trim() && !attachments.length) {
    return null;
  }
  return {
    text,
    attachments,
    updatedAt: asString(value.updatedAt || value.updated_at)
  };
}

export function normalizeAdvisorComposerDraftStore(value) {
  const source = value && typeof value === 'object' ? value : {};
  const sourceWorkbooks =
    source.workbooks && typeof source.workbooks === 'object' ? source.workbooks : {};
  const workbooks = {};
  Object.keys(sourceWorkbooks).forEach((workbookId) => {
    const cleanWorkbookId = asString(workbookId);
    const drafts =
      sourceWorkbooks[workbookId] && typeof sourceWorkbooks[workbookId] === 'object'
        ? sourceWorkbooks[workbookId]
        : {};
    const nextDrafts = {};
    Object.keys(drafts).forEach((draftKey) => {
      const cleanDraftKey = asString(draftKey);
      const record = normalizeAdvisorComposerDraftRecord(drafts[draftKey]);
      if (cleanWorkbookId && cleanDraftKey && record) {
        nextDrafts[cleanDraftKey] = record;
      }
    });
    if (Object.keys(nextDrafts).length) {
      workbooks[cleanWorkbookId] = nextDrafts;
    }
  });
  return {
    version: ADVISOR_COMPOSER_DRAFTS_VERSION,
    workbooks
  };
}

export function getAdvisorComposerDraftRecord(store, workbookId, draftKey) {
  const normalized = normalizeAdvisorComposerDraftStore(store);
  const workbookDrafts = normalized.workbooks[asString(workbookId)] || {};
  return (
    normalizeAdvisorComposerDraftRecord(workbookDrafts[asString(draftKey)]) || {
      text: '',
      attachments: [],
      updatedAt: ''
    }
  );
}

export function hasAdvisorComposerDraftRecord(store, workbookId, draftKey) {
  const record = getAdvisorComposerDraftRecord(store, workbookId, draftKey);
  return !!(record.text.trim() || record.attachments.length);
}

export function setAdvisorComposerDraftRecord(store, options = {}) {
  const workbookId = asString(options.workbookId);
  const draftKey = asString(options.draftKey);
  if (!(workbookId && draftKey)) {
    return normalizeAdvisorComposerDraftStore(store);
  }
  const next = normalizeAdvisorComposerDraftStore(store);
  const record = normalizeAdvisorComposerDraftRecord({
    text: options.text,
    attachments: options.attachments,
    updatedAt: options.updatedAt
  });
  if (!record) {
    return clearAdvisorComposerDraftRecord(next, workbookId, draftKey);
  }
  next.workbooks[workbookId] = next.workbooks[workbookId] || {};
  next.workbooks[workbookId][draftKey] = record;
  return next;
}

export function clearAdvisorComposerDraftRecord(store, workbookId, draftKey) {
  const next = normalizeAdvisorComposerDraftStore(store);
  const cleanWorkbookId = asString(workbookId);
  const cleanDraftKey = asString(draftKey);
  if (next.workbooks[cleanWorkbookId]) {
    delete next.workbooks[cleanWorkbookId][cleanDraftKey];
    if (!Object.keys(next.workbooks[cleanWorkbookId]).length) {
      delete next.workbooks[cleanWorkbookId];
    }
  }
  return next;
}
