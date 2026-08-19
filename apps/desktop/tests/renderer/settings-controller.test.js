import { describe, expect, it, vi } from 'vitest';

import {
  SETTINGS_ACTIONS,
  createSettingsController
} from '../../src/renderer/features/settings/settings-controller.js';
import { buildSettingsRouteModel } from '../../src/renderer/features/settings/settings-route-model.js';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

function makeWorkbook() {
  const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
  workbook.counterparties = [
    { id: 'merchant-one', name: 'Merchant One', kind: 'merchant', note: '', isActive: true },
    { id: 'archived', name: 'Archived', kind: 'other', note: '', isActive: false }
  ];
  return workbook;
}

describe('settings feature model', () => {
  it('derives serializable settings, counterparties, and runtime status', () => {
    const workbook = makeWorkbook();
    const original = cloneFixture(workbook);
    const model = buildSettingsRouteModel(
      workbook,
      {},
      {
        saveStatusLabel: 'Saved',
        fileAutosave: { status: 'Linked', detail: 'Cavalry.html', fileName: 'Cavalry.html' },
        canSaveFileNow: true,
        canRevealFile: true,
        canChooseAutosaveFile: true,
        visibleRangeLabel: 'June 2026',
        advisorSettings: { provider: 'custom', model: 'qwen', contextWindowTokens: 4096 },
        advisorProviderLabel: 'Local Model',
        contextWindowTokenOptions: [4096, 8192],
        cloud: {
          configured: true,
          status: 'signed_in',
          user: { id: 'user-1', email: 'alex@example.com' },
          workbooks: [{ id: workbook.id, name: workbook.name, revision: 2 }]
        },
        error: 'Previous save failed.',
        feedbackSection: 'settings-files'
      }
    );

    expect(model.summaryItems.map((item) => item.id)).toEqual([
      'workbook',
      'save',
      'advisor',
      'health'
    ]);
    expect(model.counterparties).toEqual([
      { id: 'merchant-one', name: 'Merchant One', kindLabel: 'Merchant', note: '' }
    ]);
    expect(model.workbook.name).toBe(workbook.name);
    expect(model.files).toMatchObject({
      canSaveFileNow: true,
      canRevealFile: true,
      canClearFile: true
    });
    expect(model.feedback.error).toBe('Previous save failed.');
    expect(model.feedback.section).toBe('settings-files');
    expect(model.cloud).toMatchObject({
      configured: true,
      status: 'signed_in',
      user: { id: 'user-1', email: 'alex@example.com' }
    });
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
    expect(workbook).toEqual(original);
  });
});

describe('settings controller', () => {
  it('updates rates and counterparties immutably', () => {
    const workbook = makeWorkbook();
    const original = cloneFixture(workbook);
    const controller = createSettingsController({ createId: () => 'counterparty-new' });

    const rate = controller.handleAction(workbook, {
      type: SETTINGS_ACTIONS.updateRate,
      payload: { usdRate: '58.75' }
    });
    expect(rate.ok).toBe(true);
    expect(rate.workbook).not.toBe(workbook);
    expect(rate.workbook.settings.usdToBaseRate).toBe(58.75);
    expect(rate.events).toContainEqual({ type: 'schedule-save' });

    const added = controller.handleAction(workbook, {
      type: SETTINGS_ACTIONS.addCounterparty,
      payload: { name: 'Globe', kind: 'biller', note: 'Internet' }
    });
    expect(added.ok).toBe(true);
    expect(added.workbook).not.toBe(workbook);
    expect(added.workbook.counterparties.at(-1)).toEqual({
      id: 'counterparty-new',
      name: 'Globe',
      kind: 'biller',
      note: 'Internet',
      isActive: true
    });

    const archived = controller.handleAction(workbook, {
      type: SETTINGS_ACTIONS.archiveCounterparty,
      payload: { counterpartyId: 'merchant-one' }
    });
    expect(archived.ok).toBe(true);
    expect(archived.workbook).not.toBe(workbook);
    expect(archived.workbook.counterparties[0].isActive).toBe(false);
    expect(workbook).toEqual(original);
  });

  it('renames the workbook immutably and skips no-op renames', () => {
    const workbook = makeWorkbook();
    const original = cloneFixture(workbook);
    const controller = createSettingsController();

    const renamed = controller.handleAction(workbook, {
      type: 'rename-workbook',
      payload: { name: 'Household Plan' }
    });
    expect(renamed.ok).toBe(true);
    expect(renamed.workbook).not.toBe(workbook);
    expect(renamed.workbook.name).toBe('Household Plan');
    expect(renamed.events).toContainEqual({ type: 'schedule-save' });
    expect(workbook).toEqual(original);

    const unchanged = controller.handleAction(renamed.workbook, {
      type: SETTINGS_ACTIONS.renameWorkbook,
      payload: { name: '  Household Plan  ' }
    });
    expect(unchanged.ok).toBe(true);
    expect(unchanged.workbook).toBe(renamed.workbook);
    expect(unchanged.events).toEqual([]);

    const invalid = controller.handleAction(workbook, {
      type: 'rename-workbook',
      payload: { name: '   ' }
    });
    expect(invalid).toMatchObject({
      ok: false,
      workbook,
      errors: [{ code: 'settings.workbook.name-required' }]
    });
  });

  it('emits injected file, Advisor, server, and microphone intents', () => {
    const workbook = makeWorkbook();
    const storageIntent = vi.fn((operation, payload) => ({
      type: 'test/storage',
      payload: { operation, ...payload }
    }));
    const advisorIntent = vi.fn((operation, payload) => ({
      type: 'test/advisor',
      payload: { operation, ...payload }
    }));
    const cloudIntent = vi.fn((operation, payload) => ({
      type: 'test/cloud',
      payload: { operation, ...payload }
    }));
    const controller = createSettingsController({ storageIntent, advisorIntent, cloudIntent });

    const storageActions = [
      ['open-workbook-file', 'open'],
      ['run-file-autosave', 'save'],
      ['choose-autosave-file', 'save-as'],
      ['reveal-workbook-file', 'reveal'],
      ['clear-autosave-file', 'forget']
    ];
    storageActions.forEach(([type, operation]) => {
      const result = controller.handleAction(workbook, { type, payload: {} });
      expect(result.ok).toBe(true);
      expect(result.workbook).toBe(workbook);
      expect(result.events[0]).toMatchObject({ type: 'test/storage', payload: { operation } });
    });

    expect(
      controller.handleAction(workbook, {
        type: 'set-advisor-provider',
        payload: { value: 'openai' }
      }).events[0]
    ).toMatchObject({
      type: 'test/advisor',
      payload: { operation: 'provider-change', provider: 'openai' }
    });
    expect(
      controller.handleAction(workbook, {
        type: 'toggle-advisor-server',
        payload: { provider: 'custom', model: 'qwen', contextWindowTokens: '4096' }
      }).events[0]
    ).toMatchObject({
      type: 'test/advisor',
      payload: {
        operation: 'server-toggle',
        provider: 'custom',
        model: 'qwen',
        contextWindowTokens: 4096
      }
    });
    expect(
      controller.handleAction(workbook, {
        type: 'clear-mmproj',
        payload: { provider: 'custom', mmprojPath: '/models/old-mmproj.gguf' }
      }).events[0]
    ).toMatchObject({
      type: 'test/advisor',
      payload: { operation: 'vision-projector-clear' }
    });
    expect(
      controller.handleAction(workbook, {
        type: 'request-advisor-microphone-access'
      }).events[0]
    ).toMatchObject({ type: 'test/advisor', payload: { operation: 'microphone-request' } });
    expect(
      controller.handleAction(workbook, {
        type: 'save-advisor-settings',
        payload: { provider: 'openai', apiKey: '********', model: 'gpt-test' }
      }).events[0].payload
    ).not.toHaveProperty('apiKey');

    const cloudActions = [
      ['sign-in-with-google', 'sign-in'],
      ['sign-in-with-apple', 'sign-in-apple'],
      ['link-apple-cloud', 'link-apple'],
      ['sign-out-cloud', 'sign-out'],
      ['refresh-cloud-workbooks', 'refresh'],
      ['upload-current-workbook', 'upload'],
      ['open-cloud-workbook', 'open'],
      ['delete-cloud-workbook', 'delete']
    ];
    cloudActions.forEach(([type, operation]) => {
      const result = controller.handleAction(workbook, {
        type,
        payload: { workbookId: 'cloud-workbook' }
      });
      expect(result.events[0]).toMatchObject({
        type: 'test/cloud',
        payload: { operation, workbookId: 'cloud-workbook' }
      });
    });
    expect(
      controller.handleAction(workbook, {
        type: 'update-cloud-profile',
        payload: { name: '  Cavalry Name  ', userId: 'ignored' }
      }).events[0]
    ).toMatchObject({
      type: 'test/cloud',
      payload: { operation: 'profile-update', name: 'Cavalry Name' }
    });
  });

  it('returns structured validation and persistence failures without replacing the workbook', () => {
    const workbook = makeWorkbook();
    const controller = createSettingsController();

    const invalidRate = controller.handleAction(workbook, {
      type: SETTINGS_ACTIONS.updateRate,
      payload: { usdRate: '0' }
    });
    expect(invalidRate).toMatchObject({
      ok: false,
      workbook,
      events: [],
      errors: [{ code: 'settings.rate.invalid' }]
    });

    const failure = controller.handleAction(workbook, {
      type: SETTINGS_ACTIONS.persistenceFailed,
      payload: { operation: 'save', code: 'disk-full', message: 'The disk is full.' }
    });
    expect(failure).toEqual({
      ok: false,
      workbook,
      events: [],
      warnings: [],
      errors: [{ code: 'disk-full', message: 'The disk is full.' }]
    });

    const defaultIntent = controller.handleAction(workbook, { type: 'run-file-autosave' });
    expect(defaultIntent.events[0]).toMatchObject({
      type: 'storage/save-requested',
      failureAction: { type: SETTINGS_ACTIONS.persistenceFailed, payload: { operation: 'save' } }
    });
  });
});
