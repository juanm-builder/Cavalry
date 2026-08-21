import { describe, expect, it, vi } from 'vitest';

import { commitAssistantCommandResultDurably } from '../../src/renderer/app/assistant-command-commit.js';

describe('Assistant durable command commit', () => {
  it('persists the complete candidate before exposing it and removes redundant save effects', async () => {
    const order = [];
    const original = { id: 'workbook', transactions: [{ id: 'old' }] };
    const candidate = { id: 'workbook', transactions: [{ id: 'replacement' }] };
    const saveWorkbook = vi.fn(async (workbook) => {
      order.push(`save:${workbook.transactions[0].id}`);
      return { ok: true, savedAt: '2026-08-21T06:00:00.000Z' };
    });
    const applyCommandResult = vi.fn(async (result) => {
      order.push(`apply:${result.workbook.transactions[0].id}`);
      return result;
    });
    const updateCurrentWorkbook = vi.fn((workbook) => {
      order.push(`current:${workbook.transactions[0].id}`);
    });

    const committed = await commitAssistantCommandResultDurably({
      result: {
        ok: true,
        workbook: candidate,
        events: [{ type: 'schedule-save' }, { type: 'transaction.replaced' }]
      },
      currentWorkbook: original,
      saveWorkbook,
      applyCommandResult,
      isSaveEvent: (event) => event.type === 'schedule-save',
      updateCurrentWorkbook
    });

    expect(order).toEqual(['save:replacement', 'apply:replacement', 'current:replacement']);
    expect(applyCommandResult.mock.calls[0][0].events).toEqual([{ type: 'transaction.replaced' }]);
    expect(committed).toMatchObject({
      ok: true,
      commitStatus: 'committed',
      verificationStatus: 'verified',
      persistence: { status: 'saved', durable: true }
    });
  });

  it('leaves the original state untouched when persistence rejects the candidate', async () => {
    const original = { id: 'workbook', transactions: [{ id: 'old' }] };
    const candidate = { id: 'workbook', transactions: [{ id: 'replacement' }] };
    const applyCommandResult = vi.fn();
    const updateCurrentWorkbook = vi.fn();

    await expect(
      commitAssistantCommandResultDurably({
        result: { ok: true, workbook: candidate, events: [] },
        currentWorkbook: original,
        saveWorkbook: vi.fn(async () => ({ ok: false, error: 'Disk is unavailable.' })),
        applyCommandResult,
        updateCurrentWorkbook
      })
    ).rejects.toMatchObject({
      code: 'assistant_persistence_failed',
      message: 'Disk is unavailable.'
    });

    expect(original.transactions).toEqual([{ id: 'old' }]);
    expect(applyCommandResult).not.toHaveBeenCalled();
    expect(updateCurrentWorkbook).not.toHaveBeenCalled();
  });

  it('does not schedule persistence when an action returns the current workbook unchanged', async () => {
    const workbook = { id: 'workbook' };
    const saveWorkbook = vi.fn();
    const applyCommandResult = vi.fn(async (result) => result);

    const committed = await commitAssistantCommandResultDurably({
      result: { ok: true, workbook, events: [] },
      currentWorkbook: workbook,
      saveWorkbook,
      applyCommandResult
    });

    expect(saveWorkbook).not.toHaveBeenCalled();
    expect(committed).toMatchObject({
      commitStatus: 'not_applicable',
      persistence: { status: 'not_required', durable: true }
    });
  });

  it('reports a saved candidate as committed when post-save view reconciliation fails', async () => {
    const original = { id: 'workbook', transactions: [{ id: 'old' }] };
    const candidate = { id: 'workbook', transactions: [{ id: 'saved' }] };
    const updateCurrentWorkbook = vi.fn();

    await expect(
      commitAssistantCommandResultDurably({
        result: { ok: true, workbook: candidate, events: [] },
        currentWorkbook: original,
        saveWorkbook: vi.fn(async () => ({
          ok: true,
          savedAt: '2026-08-21T06:00:00.000Z'
        })),
        applyCommandResult: vi.fn(() => {
          throw new Error('Renderer event failed.');
        }),
        updateCurrentWorkbook
      })
    ).rejects.toMatchObject({
      code: 'assistant_post_commit_reconciliation_failed',
      commitStatus: 'committed',
      verificationStatus: 'failed',
      persistence: { status: 'saved', durable: true }
    });

    expect(updateCurrentWorkbook).toHaveBeenCalledWith(candidate);
    expect(original.transactions).toEqual([{ id: 'old' }]);
  });
});
