import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createAdvisorProvider } from '@cavalry/advisor/application/ai/advisor-provider-interface.js';
import { AdvisorRoute } from '../../src/renderer/features/advisor/AdvisorRoute.jsx';

function makeWorkbook() {
  return {
    id: 'advisor-interaction-workbook',
    version: 2,
    name: 'Advisor Interactions',
    year: 2026,
    currency: 'PHP',
    settings: { activeAdvisorThreadId: 'thread-1' },
    accounts: [{ id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true }],
    categories: [],
    transactions: [],
    sheets: [],
    recurringItems: [],
    advisorThreads: [
      {
        id: 'thread-1',
        title: 'First thread',
        createdAt: '2026-07-01T08:00:00.000Z',
        updatedAt: '2026-07-01T08:00:00.000Z',
        messages: [
          { id: 'first-message', role: 'assistant', text: 'First answer', createdAt: '08:00' }
        ]
      },
      {
        id: 'thread-2',
        title: 'Second thread',
        createdAt: '2026-07-01T07:00:00.000Z',
        updatedAt: '2026-07-01T07:00:00.000Z',
        messages: [
          { id: 'second-message', role: 'assistant', text: 'Second answer', createdAt: '07:00' }
        ]
      }
    ]
  };
}

function makeServices(provider) {
  let index = 0;
  return {
    provider,
    settings: { enabled: true, provider: 'local_rules', allowDraftCreation: false },
    createId: (prefix) => `${prefix}_${++index}`,
    now: () => '2026-07-01T09:00:00.000Z',
    today: () => '2026-07-01'
  };
}

function AdvisorHarness({ initialWorkbook, model, services, onResult, onIntent }) {
  const [workbook, setWorkbook] = useState(initialWorkbook);
  function handleResult(result) {
    onResult(result);
    if (result.ok) setWorkbook(result.workbook);
  }
  return (
    <>
      <output aria-label="Advisor workbook state">{JSON.stringify(workbook.advisorThreads)}</output>
      <AdvisorRoute
        model={model}
        onCommandResult={handleResult}
        onIntent={onIntent}
        services={services}
        workbook={workbook}
      />
    </>
  );
}

describe('advisor chat interactions', () => {
  it('submits chat, stores a new workbook identity, and navigates threads', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const provider = createAdvisorProvider({
      id: 'test',
      run: async () => ({ ok: true, status: 'answered', message: 'A grounded answer.' })
    });
    const onResult = vi.fn();
    render(
      <AdvisorHarness
        initialWorkbook={workbook}
        onIntent={vi.fn()}
        onResult={onResult}
        services={makeServices(provider)}
      />
    );

    await user.click(screen.getByRole('button', { name: /Second thread/ }));
    expect(screen.getByText('Second answer')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /First thread/ }));

    const composer = screen.getByRole('textbox', { name: 'Ask Advisor' });
    await user.type(composer, 'What changed?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('A grounded answer.')).not.toBeNull();
    const result = onResult.mock.calls[0][0];
    expect(result.workbook).not.toBe(workbook);
    expect(
      result.workbook.advisorThreads.find((thread) => thread.id === 'thread-1').messages
    ).toHaveLength(3);
    expect(workbook.advisorThreads[0].messages).toHaveLength(1);
  });

  it('cancels an in-flight request and ignores its eventual response', async () => {
    const user = userEvent.setup();
    let resolveProvider;
    const provider = createAdvisorProvider({
      id: 'slow',
      run: () =>
        new Promise((resolve) => {
          resolveProvider = resolve;
        })
    });
    const onResult = vi.fn();
    const onIntent = vi.fn();
    render(
      <AdvisorHarness
        initialWorkbook={makeWorkbook()}
        onIntent={onIntent}
        onResult={onResult}
        services={makeServices(provider)}
      />
    );

    await user.type(screen.getByRole('textbox', { name: 'Ask Advisor' }), 'Slow question');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await user.click(await screen.findByRole('button', { name: 'Stop thinking' }));
    resolveProvider({ ok: true, status: 'answered', message: 'Too late' });

    expect(screen.queryByText('Too late')).toBeNull();
    expect(onResult).not.toHaveBeenCalled();
    expect(onIntent).toHaveBeenCalledWith({
      type: 'advisor/request-cancel',
      payload: { threadId: 'thread-1' }
    });
  });

  it('falls back safely after model failure', async () => {
    const user = userEvent.setup();
    const provider = createAdvisorProvider({
      id: 'offline',
      run: async () => {
        throw new Error('Offline');
      }
    });
    const onResult = vi.fn();
    render(
      <AdvisorHarness
        initialWorkbook={makeWorkbook()}
        onIntent={vi.fn()}
        onResult={onResult}
        services={makeServices(provider)}
      />
    );

    await user.type(screen.getByRole('textbox', { name: 'Ask Advisor' }), 'Show a summary');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    const messageList = document.querySelector('.advisor-message-list');
    expect(messageList).not.toBeNull();
    expect(await within(messageList).findByText(/Income:/)).not.toBeNull();
    expect(onResult.mock.calls[0][0].warnings[0].code).toBe('advisor.provider_fallback');
  });

  it('renders sources and attachments while emitting adapter intents', async () => {
    const user = userEvent.setup();
    const onIntent = vi.fn();
    const model = {
      threadOpen: true,
      sourceOpen: true,
      sources: [
        { id: 'transaction:txn-1', label: 'Coffee', detail: 'PHP 250', kind: 'transaction' }
      ],
      attachments: [
        { id: 'attachment-1', name: 'statement.pdf', kind: 'document', mimeType: 'application/pdf' }
      ],
      voice: { status: 'idle', availability: { available: true } }
    };
    render(
      <AdvisorHarness
        initialWorkbook={makeWorkbook()}
        model={model}
        onIntent={onIntent}
        onResult={vi.fn()}
        services={makeServices()}
      />
    );

    expect(screen.getByText('statement.pdf')).not.toBeNull();
    expect(screen.getByText('Coffee')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove statement.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Add attachment' }));
    await user.click(screen.getByRole('button', { name: 'Dictate to Advisor' }));

    expect(onIntent).toHaveBeenCalledWith({
      type: 'advisor/attachment-remove',
      payload: { attachmentId: 'attachment-1' }
    });
    expect(onIntent).toHaveBeenCalledWith({
      type: 'advisor/attachments-pick',
      payload: expect.objectContaining({ remaining: 6 })
    });
    expect(onIntent).toHaveBeenCalledWith({
      type: 'advisor/voice-toggle',
      payload: { status: 'idle' }
    });
  });
});
