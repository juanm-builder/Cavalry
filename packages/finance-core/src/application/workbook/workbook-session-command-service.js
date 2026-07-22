// Keeps workbook session/save decisions pure while the renderer applies storage, bridge, and render effects.

import { cloneWorkbook, commandError, commandOk } from '../types/command-result.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function getTimestamp(options = {}) {
  if (typeof options.now === 'function') {
    return asString(options.now());
  }
  if (options.now) {
    return asString(options.now);
  }
  return new Date().toISOString();
}

export function buildWorkbookSaveStatus(workbook, _options = {}) {
  const settings =
    workbook && workbook.settings && typeof workbook.settings === 'object' ? workbook.settings : {};
  const fileAutosave =
    settings.fileAutosave && typeof settings.fileAutosave === 'object' ? settings.fileAutosave : {};
  return {
    lastSavedAt: asString(
      settings.lastSavedAt || fileAutosave.lastSavedAt || (workbook && workbook.updatedAt)
    ),
    updatedAt: asString(workbook && workbook.updatedAt),
    fileAutosaveLastSavedAt: asString(fileAutosave.lastSavedAt)
  };
}

export function shouldAutosaveWorkbookChange(options = {}) {
  return options.skipSave !== true || options.didReconcileInterest === true;
}

export function shouldPublishWorkbookChange(options = {}) {
  return options.suppressCompanionPublish !== true;
}

export function getWorkbookChangeEffects(options = {}) {
  return {
    shouldScheduleSave: shouldAutosaveWorkbookChange(options),
    shouldPublish: shouldPublishWorkbookChange(options)
  };
}

export function buildWorkbookSessionUpdate(previousState, nextWorkbook, options = {}) {
  const saveStatus = buildWorkbookSaveStatus(nextWorkbook);
  return {
    workbook: nextWorkbook || null,
    lastSavedAt: saveStatus.lastSavedAt,
    currentAppDate:
      asString(options.currentAppDate) || asString(previousState && previousState.currentAppDate),
    showLanding: false,
    linkedAccountFeedback: {},
    effects: getWorkbookChangeEffects(options)
  };
}

export function scheduleWorkbookSaveCommand(workbook, options = {}) {
  if (!workbook) {
    return commandError(workbook, {
      code: 'workbook.missing',
      message: 'Workbook is required before scheduling a save.'
    });
  }
  const nextWorkbook = cloneWorkbook(workbook);
  const savedAt = getTimestamp(options);
  nextWorkbook.updatedAt = savedAt;
  nextWorkbook.settings =
    nextWorkbook.settings && typeof nextWorkbook.settings === 'object' ? nextWorkbook.settings : {};
  nextWorkbook.settings.lastSavedAt = savedAt;
  return commandOk(nextWorkbook, {
    savedAt,
    events: [
      {
        type: 'set-last-saved-at',
        savedAt
      },
      {
        type: 'set-save-status',
        status: 'saving'
      },
      {
        type: 'queue-companion-workbook-publish',
        reason: asString(options.publishReason) || 'scheduled_save'
      },
      { type: 'render' },
      {
        type: 'schedule-workbook-persistence',
        delayMs: Number(options.delayMs) >= 0 ? Number(options.delayMs) : 280,
        autosaveReason: asString(options.autosaveReason) || 'auto'
      }
    ]
  });
}
