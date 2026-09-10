import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  CommandExecutorProvider,
  useCommandExecutor
} from '../../src/renderer/app/CommandExecutor.jsx';
import { useWorkbookSession, WorkbookProvider } from '../../src/renderer/app/WorkbookProvider.jsx';
import { commitAssistantCommandResultDurably } from '../../src/renderer/app/assistant-command-commit.js';

const ORIGINAL_TIMESTAMP = '2026-07-09T02:13:00.000Z';
const COMMIT_TIMESTAMP = '2026-08-30T12:00:00.000Z';

function CommitProbe({ events, alreadyPersisted }) {
  const { executeCommandResult } = useCommandExecutor();
  const { workbook, saveStatus, saveWorkbook } = useWorkbookSession();

  return (
    <>
      <button
        onClick={() => {
          const result = {
            ok: true,
            workbook: { ...workbook, name: 'Updated Plan' },
            events
          };
          if (alreadyPersisted) {
            void commitAssistantCommandResultDurably({
              result,
              currentWorkbook: workbook,
              saveWorkbook,
              now: () => COMMIT_TIMESTAMP,
              isSaveEvent: (event) => event.type === 'schedule-save',
              applyCommandResult: (committed) =>
                executeCommandResult(committed, { markDirty: false })
            });
          } else executeCommandResult(result);
        }}
        type="button"
      >
        Commit workbook
      </button>
      <output data-testid="workbook-updated-at">{workbook.updatedAt}</output>
      <output data-testid="save-status">{saveStatus}</output>
      <output data-testid="workbook-name">{workbook.name}</output>
    </>
  );
}

function renderExecutor(events, alreadyPersisted = false, cacheOnly = false) {
  const workbookStorageSave = vi.fn(async () =>
    cacheOnly
      ? { ok: false, error: 'Native storage is temporarily unavailable.' }
      : { ok: true, savedAt: COMMIT_TIMESTAMP }
  );
  const browserCacheSave = vi.fn(async () => ({ ok: true }));
  render(
    <WorkbookProvider
      initialSaveStatus="saved"
      initialWorkbook={{
        id: 'workbook-plan',
        name: 'Original Plan',
        updatedAt: ORIGINAL_TIMESTAMP,
        settings: { lastSavedAt: ORIGINAL_TIMESTAMP }
      }}
      ports={{
        browserCache: { save: browserCacheSave },
        clock: { now: () => COMMIT_TIMESTAMP },
        workbookStorage: { save: workbookStorageSave }
      }}
    >
      <CommandExecutorProvider>
        <CommitProbe events={events} alreadyPersisted={alreadyPersisted} />
      </CommandExecutorProvider>
    </WorkbookProvider>
  );
  return { browserCacheSave, workbookStorageSave };
}

describe('CommandExecutor scheduled saves', () => {
  it.each(['saved', 'cache'])(
    'keeps the %s status when applying an already persisted advisor change',
    async (status) => {
      const user = userEvent.setup();
      const { browserCacheSave, workbookStorageSave } = renderExecutor(
        [{ type: 'schedule-save' }],
        true,
        status === 'cache'
      );

      await user.click(screen.getByRole('button', { name: 'Commit workbook' }));

      await waitFor(() =>
        expect(screen.getByTestId('workbook-name').textContent).toBe('Updated Plan')
      );
      expect(screen.getByTestId('save-status').textContent).toBe(status);
      expect(workbookStorageSave).toHaveBeenCalledTimes(1);
      expect(browserCacheSave).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('workbook-updated-at').textContent).toBe(COMMIT_TIMESTAMP);
      expect(workbookStorageSave.mock.calls[0][0].updatedAt).toBe(COMMIT_TIMESTAMP);
    }
  );

  it('stamps the committed workbook before local persistence and later cloud sync observe it', async () => {
    const user = userEvent.setup();
    const { browserCacheSave, workbookStorageSave } = renderExecutor([{ type: 'schedule-save' }]);

    await user.click(screen.getByRole('button', { name: 'Commit workbook' }));

    expect(screen.getByTestId('workbook-updated-at').textContent).toBe(COMMIT_TIMESTAMP);
    await waitFor(() => expect(workbookStorageSave).toHaveBeenCalledTimes(1));
    expect(browserCacheSave).toHaveBeenCalledTimes(1);
    expect(workbookStorageSave.mock.calls[0][0]).toMatchObject({
      name: 'Updated Plan',
      updatedAt: COMMIT_TIMESTAMP,
      settings: { lastSavedAt: COMMIT_TIMESTAMP }
    });
    expect(browserCacheSave.mock.calls[0][0].updatedAt).toBe(COMMIT_TIMESTAMP);
  });

  it('does not change the source timestamp when a command does not schedule persistence', async () => {
    const user = userEvent.setup();
    const { browserCacheSave, workbookStorageSave } = renderExecutor([]);

    await user.click(screen.getByRole('button', { name: 'Commit workbook' }));

    expect(screen.getByTestId('workbook-updated-at').textContent).toBe(ORIGINAL_TIMESTAMP);
    expect(workbookStorageSave).not.toHaveBeenCalled();
    expect(browserCacheSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-status').textContent).toBe('dirty');
  });
});
