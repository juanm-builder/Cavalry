import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  CommandExecutorProvider,
  useCommandExecutor
} from '../../src/renderer/app/CommandExecutor.jsx';
import { useWorkbookSession, WorkbookProvider } from '../../src/renderer/app/WorkbookProvider.jsx';

const ORIGINAL_TIMESTAMP = '2026-07-09T02:13:00.000Z';
const COMMIT_TIMESTAMP = '2026-08-30T12:00:00.000Z';

function CommitProbe({ events }) {
  const { executeCommandResult } = useCommandExecutor();
  const { workbook } = useWorkbookSession();

  return (
    <>
      <button
        onClick={() =>
          executeCommandResult({
            ok: true,
            workbook: { ...workbook, name: 'Updated Plan' },
            events
          })
        }
        type="button"
      >
        Commit workbook
      </button>
      <output data-testid="workbook-updated-at">{workbook.updatedAt}</output>
    </>
  );
}

function renderExecutor(events) {
  const workbookStorageSave = vi.fn(async () => ({
    ok: true,
    savedAt: COMMIT_TIMESTAMP
  }));
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
        <CommitProbe events={events} />
      </CommandExecutorProvider>
    </WorkbookProvider>
  );
  return { browserCacheSave, workbookStorageSave };
}

describe('CommandExecutor scheduled saves', () => {
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
  });
});
