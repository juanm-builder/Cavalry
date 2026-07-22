import { describe, expect, it } from 'vitest';

import {
  buildWorkbookSaveStatus,
  buildWorkbookSessionUpdate,
  getWorkbookChangeEffects,
  scheduleWorkbookSaveCommand,
  shouldAutosaveWorkbookChange,
  shouldPublishWorkbookChange
} from '@cavalry/finance-core/application/workbook/workbook-session-command-service.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeWorkbook(overrides = {}) {
  return Object.assign(
    {
      id: 'wb_session',
      updatedAt: '2026-07-01T09:00:00.000Z',
      settings: {
        lastSavedAt: '2026-07-01T10:00:00.000Z',
        fileAutosave: {
          lastSavedAt: '2026-07-01T08:00:00.000Z'
        }
      }
    },
    overrides
  );
}

describe('workbook session command service', () => {
  it('builds a normal workbook replacement update without mutating inputs', () => {
    const previousState = { currentAppDate: '2026-06-30', linkedAccountFeedback: { old: true } };
    const workbook = makeWorkbook();
    const beforeState = clone(previousState);
    const beforeWorkbook = clone(workbook);
    const update = buildWorkbookSessionUpdate(previousState, workbook, {
      currentAppDate: '2026-07-01'
    });

    expect(update).toEqual({
      workbook,
      lastSavedAt: '2026-07-01T10:00:00.000Z',
      currentAppDate: '2026-07-01',
      showLanding: false,
      linkedAccountFeedback: {},
      effects: {
        shouldScheduleSave: true,
        shouldPublish: true
      }
    });
    expect(previousState).toEqual(beforeState);
    expect(workbook).toEqual(beforeWorkbook);
  });

  it('suppresses save on initial load unless reconciliation changed the workbook', () => {
    expect(shouldAutosaveWorkbookChange({ skipSave: true })).toBe(false);
    expect(shouldAutosaveWorkbookChange({ skipSave: true, didReconcileInterest: true })).toBe(true);
    expect(
      getWorkbookChangeEffects({
        skipSave: true,
        suppressCompanionPublish: true
      })
    ).toEqual({
      shouldScheduleSave: false,
      shouldPublish: false
    });
  });

  it('can suppress companion publish independently from save scheduling', () => {
    expect(shouldPublishWorkbookChange({ suppressCompanionPublish: true })).toBe(false);
    expect(
      buildWorkbookSessionUpdate({}, makeWorkbook(), {
        suppressCompanionPublish: true
      }).effects
    ).toEqual({
      shouldScheduleSave: true,
      shouldPublish: false
    });
  });

  it('falls back through file autosave and updated timestamps', () => {
    expect(
      buildWorkbookSaveStatus(
        makeWorkbook({
          settings: {
            fileAutosave: {
              lastSavedAt: '2026-07-01T08:00:00.000Z'
            }
          }
        })
      ).lastSavedAt
    ).toBe('2026-07-01T08:00:00.000Z');
    expect(
      buildWorkbookSaveStatus(
        makeWorkbook({
          settings: {}
        })
      ).lastSavedAt
    ).toBe('2026-07-01T09:00:00.000Z');
    expect(buildWorkbookSaveStatus(null)).toEqual({
      lastSavedAt: '',
      updatedAt: '',
      fileAutosaveLastSavedAt: ''
    });
  });

  it('returns scheduled-save events with a new stamped workbook', () => {
    const workbook = makeWorkbook({ settings: {} });
    const result = scheduleWorkbookSaveCommand(workbook, {
      now: '2026-07-09T12:30:00.000Z',
      publishReason: 'unit_test',
      autosaveReason: 'manual',
      delayMs: 10
    });

    expect(result.ok).toBe(true);
    expect(result.savedAt).toBe('2026-07-09T12:30:00.000Z');
    expect(result.workbook).not.toBe(workbook);
    expect(workbook.updatedAt).toBe('2026-07-01T09:00:00.000Z');
    expect(result.workbook.updatedAt).toBe('2026-07-09T12:30:00.000Z');
    expect(result.workbook.settings.lastSavedAt).toBe('2026-07-09T12:30:00.000Z');
    expect(result.events).toEqual([
      {
        type: 'set-last-saved-at',
        savedAt: '2026-07-09T12:30:00.000Z'
      },
      {
        type: 'set-save-status',
        status: 'saving'
      },
      {
        type: 'queue-companion-workbook-publish',
        reason: 'unit_test'
      },
      { type: 'render' },
      {
        type: 'schedule-workbook-persistence',
        delayMs: 10,
        autosaveReason: 'manual'
      }
    ]);
  });

  it('handles missing options defensively', () => {
    expect(getWorkbookChangeEffects()).toEqual({
      shouldScheduleSave: true,
      shouldPublish: true
    });
    expect(buildWorkbookSessionUpdate(null, null)).toMatchObject({
      workbook: null,
      lastSavedAt: '',
      currentAppDate: '',
      showLanding: false,
      linkedAccountFeedback: {}
    });
    expect(scheduleWorkbookSaveCommand(null).ok).toBe(false);
  });
});
