import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CavalryAssistant } from '../../src/renderer/features/assistant/CavalryAssistant.jsx';
import { serializeConversationMarkdown } from '../../src/renderer/features/assistant/CavalryAssistantPresentation.jsx';
import { getCavalryAssistantConversationStorageKey } from '../../src/renderer/features/assistant/cavalry-assistant-conversations.js';
import { AppShell } from '../../src/renderer/app/AppShell.jsx';
import { createNullRendererPorts } from '../../src/renderer/platform/ports.js';
import { makeMinimalWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

function AssistantHarness({
  advisor,
  conversationStorage,
  downloads,
  executeTool,
  feedback,
  onOpenSettings,
  onOpenReference,
  settings,
  activeRouteId = 'ledger'
}) {
  const [open, setOpen] = useState(false);
  const sequenceRef = useRef(0);
  const fallbackStorageRef = useRef(null);
  if (!fallbackStorageRef.current) fallbackStorageRef.current = createMemoryStorage();
  return (
    <CavalryAssistant
      activeRouteId={activeRouteId}
      advisor={advisor}
      conversationStorage={conversationStorage || fallbackStorageRef.current}
      createId={(prefix) => `${prefix}_${++sequenceRef.current}`}
      downloads={downloads}
      executeTool={executeTool}
      feedback={feedback}
      isOpen={open}
      onClose={() => setOpen(false)}
      onOpen={() => setOpen(true)}
      onOpenReference={onOpenReference}
      onOpenSettings={onOpenSettings || vi.fn()}
      settings={settings}
      today={() => '2026-07-10'}
      workbook={{ id: 'workbook-1', name: 'The Plan' }}
    />
  );
}

// This jsdom has no PointerEvent; a MouseEvent with the pointer type keeps
// clientX/button intact where fireEvent's generic Event fallback drops them.
function firePointer(element, type, props) {
  fireEvent(element, new MouseEvent(type, { bubbles: true, cancelable: true, ...props }));
}

function createMemoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) || null,
    setItem: (key, value) => entries.set(key, value),
    entries
  };
}

it('exports claim citations as compact source footnotes', () => {
  const markdown = serializeConversationMarkdown({
    title: 'Recurring review',
    messages: [
      {
        role: 'assistant',
        text: 'Vercel looks monthly. [source](#cavalry-source-1)',
        references: [
          {
            anchor: '#cavalry-source-1',
            label: 'Vercel evidence',
            source_refs: [
              'transaction:vercel-apr',
              'transaction:vercel-may',
              'transaction:vercel-jun',
              'transaction:vercel-jul',
              'transaction:vercel-aug'
            ]
          }
        ]
      }
    ]
  });

  expect(markdown).toContain('Vercel looks monthly. [^source-1-1]');
  expect(markdown).toContain(
    '[^source-1-1]: Vercel evidence — transaction:vercel-apr, transaction:vercel-may, transaction:vercel-jun, transaction:vercel-jul, plus 1 more'
  );
  expect(markdown).not.toContain('#cavalry-source-1');
});

describe('Cavalry assistant', () => {
  it('defers loading workbook conversation history until the assistant opens', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const workbook = { id: 'workbook-1', name: 'The Plan' };
    const conversationKey = getCavalryAssistantConversationStorageKey(workbook);
    storage.setItem(
      conversationKey,
      JSON.stringify({
        activeConversationId: 'saved-chat',
        conversations: [
          {
            id: 'saved-chat',
            title: 'Saved chat',
            messages: [{ id: 'saved-message', role: 'assistant', text: 'Loaded on demand.' }]
          }
        ]
      })
    );
    storage.getItem = vi.fn(storage.getItem);

    render(
      <AssistantHarness
        advisor={{ invoke: vi.fn(), subscribe: () => () => {} }}
        conversationStorage={storage}
        executeTool={vi.fn()}
        settings={{ provider: 'local' }}
      />
    );

    expect(storage.getItem).not.toHaveBeenCalledWith(conversationKey);
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    expect(await screen.findByText('Loaded on demand.')).not.toBeNull();
    expect(storage.getItem).toHaveBeenCalledWith(conversationKey);
  });

  it('opens from the persistent launcher with current-page context and no legacy Advisor UI', async () => {
    const user = userEvent.setup();
    render(
      <AssistantHarness
        advisor={{ invoke: vi.fn(), subscribe: () => () => {} }}
        executeTool={vi.fn()}
        settings={{ provider: 'local' }}
      />
    );

    const launcher = screen.getByRole('button', { name: 'Ask Cavalry' });
    expect(launcher.querySelector('.cavalry-assistant-mark')?.tagName).toBe('SPAN');
    await user.click(launcher);

    const dialog = screen.getByRole('dialog', { name: 'Cavalry assistant' });
    expect(dialog).not.toBeNull();
    expect(
      dialog.querySelector('.cavalry-assistant-header-mark.cavalry-assistant-mark')
    ).not.toBeNull();
    expect(
      dialog.querySelector('.cavalry-assistant-empty-mark.cavalry-assistant-mark')
    ).not.toBeNull();
    expect(screen.getByText('Working with Transactions')).not.toBeNull();
    expect(screen.getByText('The Plan')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'What do you want to do?' })).not.toBeNull();
    expect(screen.queryByText('AI Drafts')).toBeNull();
    expect(screen.queryByText('Sources')).toBeNull();
  });

  it('keeps streamed replies in the assistant message content column', async () => {
    const user = userEvent.setup();
    let publishStatus = () => {};
    let finishRequest = () => {};
    const advisor = {
      subscribe: vi.fn((listener) => {
        publishStatus = listener;
        return () => {};
      }),
      invoke: vi.fn(
        () =>
          new Promise((resolve) => {
            finishRequest = resolve;
          })
      )
    };

    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={vi.fn()}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Review August');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(advisor.invoke).toHaveBeenCalled());

    act(() => {
      publishStatus({
        phase: 'stream',
        delta: "You're right — August has had several unusual transactions."
      });
    });

    const streamedText = await screen.findByText(/You're right — August/);
    const streamingMessage = streamedText.closest('.cavalry-assistant-streaming');
    expect(streamingMessage?.children[0].classList).toContain('cavalry-assistant-message-avatar');
    expect(streamingMessage?.children[1].classList).toContain('cavalry-assistant-message-content');
    expect(streamedText.closest('.cavalry-assistant-message-content')).not.toBeNull();

    await act(async () => {
      finishRequest({
        ok: true,
        text: 'August review complete.',
        message: {
          role: 'assistant',
          content: 'August review complete.',
          tool_calls: []
        }
      });
    });
    expect(await screen.findByText('August review complete.')).not.toBeNull();
  });

  it('submits a route-scoped Cloud report from the assistant overflow without invoking a model', async () => {
    const user = userEvent.setup();
    const advisor = { invoke: vi.fn(), subscribe: () => () => {} };
    const submit = vi.fn(async (payload) => ({
      ok: true,
      report: { id: 'report-1', status: 'received', ...payload }
    }));
    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={vi.fn()}
        feedback={{
          model: {
            configured: true,
            signedIn: true,
            status: 'signed_in',
            pendingOperation: ''
          },
          submit
        }}
        settings={{ provider: 'local' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Report a problem' }));
    expect(screen.getByRole('heading', { name: 'Report a problem' })).not.toBeNull();
    expect(screen.getByText(/Reporting from Transactions/)).not.toBeNull();

    await user.type(
      screen.getByRole('textbox', { name: 'Description' }),
      'The transaction filter stopped responding.'
    );
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    expect(await screen.findByRole('heading', { name: 'Report sent' })).not.toBeNull();
    expect(submit).toHaveBeenCalledWith({
      clientRequestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
      kind: 'bug',
      description: 'The transaction filter stopped responding.',
      source: 'assistant',
      context: { routeId: 'ledger' }
    });
    expect(advisor.invoke).not.toHaveBeenCalled();
  });

  it('honestly gates assistant reports when the user is signed out', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    const submit = vi.fn();
    render(
      <AssistantHarness
        advisor={{ invoke: vi.fn(), subscribe: () => () => {} }}
        executeTool={vi.fn()}
        feedback={{
          model: {
            configured: true,
            signedIn: false,
            status: 'signed_out',
            pendingOperation: ''
          },
          submit
        }}
        onOpenSettings={onOpenSettings}
        settings={{ provider: 'local' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Report a problem' }));
    expect(screen.getByText('Sign in to send feedback')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Send report' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open Account settings' }));
    expect(onOpenSettings).toHaveBeenCalledWith('settings-account');
    expect(submit).not.toHaveBeenCalled();
  });

  it('groups a legacy same-label claim into one inline source with exact child records', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const onOpenReference = vi.fn();
    const workbook = { id: 'workbook-1', name: 'The Plan' };
    storage.setItem(
      getCavalryAssistantConversationStorageKey(workbook),
      JSON.stringify({
        activeConversationId: 'duplicate-review',
        conversations: [
          {
            id: 'duplicate-review',
            title: 'Duplicate review',
            messages: [
              {
                id: 'duplicate-message',
                role: 'assistant',
                text: 'I found two **Coffee** transactions.',
                activities: [
                  { message: 'Search complete.', toolName: 'search_transactions' },
                  { message: 'Model response received.' }
                ],
                references: [
                  {
                    id: 'transaction:txn-one',
                    token: 'Coffee',
                    aliases: ['Coffee', '₱2,000'],
                    label: 'Coffee',
                    kind: 'transaction',
                    source_refs: ['transaction:txn-one'],
                    detail: { date: '2026-07-11', amount: 2000, currency: 'PHP' }
                  },
                  {
                    id: 'transaction:txn-one',
                    token: '₱2,000',
                    aliases: ['Coffee'],
                    label: 'Coffee',
                    kind: 'transaction',
                    source_refs: ['transaction:txn-one'],
                    detail: { date: '2026-07-11', amount: 2000, currency: 'PHP' }
                  },
                  {
                    id: 'transaction:txn-two',
                    token: 'Coffee',
                    aliases: ['Coffee', '₱2,000'],
                    label: 'Coffee',
                    kind: 'transaction',
                    source_refs: ['transaction:txn-two'],
                    detail: { date: '2026-07-11', amount: 2000, currency: 'PHP' }
                  }
                ]
              }
            ]
          }
        ]
      })
    );

    render(
      <AssistantHarness
        advisor={{ invoke: vi.fn(), subscribe: () => () => {} }}
        conversationStorage={storage}
        executeTool={vi.fn()}
        onOpenReference={onOpenReference}
        settings={{ provider: 'local' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));

    const proseMention = screen.getByText(
      (_content, element) =>
        element?.tagName === 'STRONG' &&
        element.parentElement?.tagName === 'P' &&
        element.textContent === 'Coffee'
    );
    expect(proseMention.querySelector('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /Open Transaction: Coffee/ })).toBeNull();
    expect(screen.queryByText('Search complete.')).toBeNull();
    expect(screen.queryByText('Model response received.')).toBeNull();
    expect(screen.queryByText('search_transactions')).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Open 2 sources: Coffee, 2 transactions on Jul 11' })
    );
    const toggle = screen.getByRole('button', { name: 'See references (1)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const sourceList = screen.getByRole('list', { name: 'Sources for Coffee' });
    const sourceButtons = within(sourceList).getAllByRole('button');
    expect(sourceButtons).toHaveLength(2);
    await user.click(sourceButtons[1]);

    expect(onOpenReference).toHaveBeenCalledTimes(1);
    expect(onOpenReference.mock.calls[0][0]).toEqual({
      id: 'transaction:txn-two',
      token: 'Coffee',
      label: 'Coffee',
      kind: 'transaction',
      source_refs: ['transaction:txn-two'],
      detail: { date: '2026-07-11', amount: 2000, currency: 'PHP' }
    });
  });

  it('opens one claim-level source into its exact supporting transaction set', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const onOpenReference = vi.fn();
    const workbook = { id: 'workbook-1', name: 'The Plan' };
    storage.setItem(
      getCavalryAssistantConversationStorageKey(workbook),
      JSON.stringify({
        activeConversationId: 'recurring-review',
        conversations: [
          {
            id: 'recurring-review',
            title: 'Recurring review',
            messages: [
              {
                id: 'vercel-message',
                role: 'assistant',
                text: [
                  'Vercel looks monthly. [source](#cavalry-source-1)',
                  'The estimate uses the same records. [source](#cavalry-source-2)'
                ].join(' '),
                references: [
                  {
                    id: 'cavalry-citation-1',
                    anchor: '#cavalry-source-1',
                    token: 'source',
                    label: 'Vercel evidence',
                    kind: 'transaction',
                    source_refs: ['transaction:vercel-apr', 'transaction:vercel-may'],
                    detail: {
                      records: [
                        {
                          source_ref: 'transaction:vercel-apr',
                          label: 'Vercel',
                          kind: 'transaction',
                          detail: { date: '2026-04-08', amount: 1276, currency: 'PHP' }
                        },
                        {
                          source_ref: 'transaction:vercel-may',
                          label: 'Vercel',
                          kind: 'transaction',
                          detail: { date: '2026-05-08', amount: 1276, currency: 'PHP' }
                        }
                      ]
                    }
                  },
                  {
                    id: 'cavalry-citation-2',
                    anchor: '#cavalry-source-2',
                    token: 'source',
                    label: 'Vercel monthly estimate',
                    kind: 'transaction',
                    source_refs: ['transaction:vercel-apr', 'transaction:vercel-may'],
                    detail: {
                      records: [
                        {
                          source_ref: 'transaction:vercel-apr',
                          label: 'Vercel',
                          kind: 'transaction',
                          detail: { date: '2026-04-08', amount: 1276, currency: 'PHP' }
                        },
                        {
                          source_ref: 'transaction:vercel-may',
                          label: 'Vercel',
                          kind: 'transaction',
                          detail: { date: '2026-05-08', amount: 1276, currency: 'PHP' }
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        ]
      })
    );

    render(
      <AssistantHarness
        advisor={{ invoke: vi.fn(), subscribe: () => () => {} }}
        conversationStorage={storage}
        executeTool={vi.fn()}
        onOpenReference={onOpenReference}
        settings={{ provider: 'local' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    expect(screen.getAllByRole('button', { name: /Open 2 sources: Vercel/ })).toHaveLength(2);
    await user.click(
      screen.getByRole('button', {
        name: 'Open 2 sources: Vercel monthly estimate, Apr 8 to May 8'
      })
    );

    expect(
      screen.getByRole('button', { name: 'See references (1)' }).getAttribute('aria-expanded')
    ).toBe('true');
    const sourceList = screen.getByRole('list', { name: 'Sources for Vercel evidence' });
    const sourceButtons = within(sourceList).getAllByRole('button');
    expect(sourceButtons).toHaveLength(2);
    await user.click(sourceButtons[1]);
    expect(onOpenReference).toHaveBeenCalledWith(
      expect.objectContaining({ source_refs: ['transaction:vercel-may'] })
    );
  });

  it('runs a local-model tool call, shows the verified result, and keeps one request id', async () => {
    const user = userEvent.setup();
    const advisor = {
      subscribe: () => () => {},
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: '',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_search',
                type: 'function',
                function: {
                  name: 'search_transactions',
                  arguments: '{"query":"largest"}'
                }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'Your largest transaction is Rent at ₱25,000.',
          message: {
            role: 'assistant',
            content: 'Your largest transaction is Rent at ₱25,000.',
            tool_calls: []
          }
        })
    };
    const executeTool = vi.fn(async () => ({
      ok: true,
      status: 'completed',
      data: { transactions: [{ description: 'Rent', amount: 25000 }] },
      errors: [],
      warnings: []
    }));
    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={executeTool}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Find the largest');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Your largest transaction is Rent at ₱25,000.')).not.toBeNull();
    expect(screen.queryByText('Search Transactions completed')).toBeNull();
    expect(executeTool).toHaveBeenCalledWith(
      'search_transactions',
      { query: 'largest' },
      expect.objectContaining({ callId: 'call_search', activeRouteId: 'ledger' })
    );
    expect(advisor.invoke).toHaveBeenCalledTimes(2);
    const firstRequestId = advisor.invoke.mock.calls[0][1].requestId;
    expect(firstRequestId).toBeTruthy();
    expect(advisor.invoke.mock.calls[1][1].requestId).toBe(firstRequestId);
    expect(advisor.invoke.mock.calls[0][1]).toMatchObject({
      returnMessage: true,
      tool_choice: 'auto'
    });
  });

  it('accepts 40 selected images and sends all of them to the Responses API', async () => {
    const user = userEvent.setup();
    const advisor = {
      subscribe: () => () => {},
      invoke: vi.fn(async () => ({
        ok: true,
        response: {
          id: 'image_response',
          output_text: 'I reviewed all 40 images.',
          output: []
        }
      }))
    };
    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={vi.fn()}
        settings={{ provider: 'openai', apiMode: 'responses', hasApiKey: true }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    const files = Array.from(
      { length: 40 },
      (_, index) => new File([`image-${index}`], `receipt-${index + 1}.png`, { type: 'image/png' })
    );
    await user.upload(screen.getByLabelText('Choose images'), files);

    expect(await screen.findByText(/40\/50 attached/)).not.toBeNull();
    expect(screen.getByLabelText('Images ready to send').children).toHaveLength(40);
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('I reviewed all 40 images.')).not.toBeNull();
    const input = advisor.invoke.mock.calls[0][1].input;
    const imageParts = input.at(-1).content.filter((part) => part.type === 'input_image');
    expect(imageParts).toHaveLength(40);
    expect(imageParts[0].image_url).toContain('data:image/png;base64,');
  });

  it('accepts a 40-image drag-and-drop batch', async () => {
    const user = userEvent.setup();
    render(
      <AssistantHarness
        advisor={{ subscribe: () => () => {}, invoke: vi.fn() }}
        executeTool={vi.fn()}
        settings={{ provider: 'openai', apiMode: 'responses', hasApiKey: true }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    const panel = screen.getByRole('dialog', { name: 'Cavalry assistant' });
    const files = Array.from(
      { length: 40 },
      (_, index) => new File([`drop-${index}`], `drop-${index + 1}.jpg`, { type: 'image/jpeg' })
    );
    fireEvent.dragEnter(panel, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop images to attach them')).not.toBeNull();
    fireEvent.drop(panel, { dataTransfer: { types: ['Files'], files } });

    expect(await screen.findByText(/40\/50 attached/)).not.toBeNull();
    expect(screen.getByLabelText('Images ready to send').children).toHaveLength(40);
  });

  it('pauses for clarification and continues when a quick answer is selected', async () => {
    const user = userEvent.setup();
    const advisor = {
      subscribe: () => () => {},
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'clarify_account',
                type: 'function',
                function: {
                  name: 'request_clarification',
                  arguments: JSON.stringify({
                    question: 'Which account should I use?',
                    options: [
                      { id: 'cash', label: 'Cash', description: 'Pay from cash on hand.' },
                      { id: 'bank', label: 'Main Bank' }
                    ]
                  })
                }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'Thanks—I’ll use Cash.',
          message: { role: 'assistant', content: 'Thanks—I’ll use Cash.', tool_calls: [] }
        })
    };
    const executeTool = vi.fn();
    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={executeTool}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Add this expense');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Which account should I use?')).not.toBeNull();
    const options = screen.getByRole('group', { name: "Answer Cavalry's question" });
    await user.click(options.querySelector('button'));

    expect(await screen.findByText('Thanks—I’ll use Cash.')).not.toBeNull();
    expect(executeTool).not.toHaveBeenCalled();
    const continuedMessages = advisor.invoke.mock.calls[1][1].messages;
    expect(continuedMessages.map((message) => message.content)).toEqual(
      expect.arrayContaining(['Add this expense', 'Which account should I use?', 'Cash'])
    );
  });

  it('lists saved workbook chats, starts a new chat, and resumes history after remounting', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const advisor = {
      subscribe: () => () => {},
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: 'Your savings rate is 42%.',
          message: {
            role: 'assistant',
            content: 'Your savings rate is 42%.',
            tool_calls: []
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'Your largest bill is Rent.',
          message: {
            role: 'assistant',
            content: 'Your largest bill is Rent.',
            tool_calls: []
          }
        })
    };
    const rendered = render(
      <AssistantHarness
        advisor={advisor}
        conversationStorage={storage}
        executeTool={vi.fn()}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Message Cavalry' }),
      'Review savings rate'
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Your savings rate is 42%.')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.getByRole('heading', { name: 'What do you want to do?' })).not.toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Find largest bill');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Your largest bill is Rent.')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Chat history' }));
    expect(screen.getByRole('heading', { name: 'Chat history' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Resume Review savings rate' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Resume Find largest bill' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Resume Review savings rate' }));
    expect(screen.getByText('Your savings rate is 42%.')).not.toBeNull();
    expect(screen.queryByText('Your largest bill is Rent.')).toBeNull();

    await waitFor(() => expect(storage.entries.size).toBe(2));
    rendered.unmount();
    render(
      <AssistantHarness
        advisor={{ subscribe: () => () => {}, invoke: vi.fn() }}
        conversationStorage={storage}
        executeTool={vi.fn()}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));

    expect(screen.getByText('Your savings rate is 42%.')).not.toBeNull();
    expect(screen.queryByText('Your largest bill is Rent.')).toBeNull();
  });

  it('exports the active chat as markdown from the header menu', async () => {
    const user = userEvent.setup();
    const downloads = { save: vi.fn().mockResolvedValue({ ok: true }) };
    const advisor = {
      subscribe: () => () => {},
      invoke: vi.fn().mockResolvedValue({
        ok: true,
        text: 'Your savings rate is 42%.',
        message: {
          role: 'assistant',
          content: 'Your savings rate is 42%.',
          tool_calls: []
        }
      })
    };
    render(
      <AssistantHarness
        advisor={advisor}
        downloads={downloads}
        executeTool={vi.fn()}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menuitem', { name: 'Export chat' })).toHaveProperty('disabled', true);
    await user.keyboard('{Escape}');

    await user.type(
      screen.getByRole('textbox', { name: 'Message Cavalry' }),
      'Review savings rate'
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Your savings rate is 42%.')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export chat' }));

    await waitFor(() => expect(downloads.save).toHaveBeenCalledTimes(1));
    const payload = downloads.save.mock.calls[0][0];
    expect(payload.suggestedName).toBe('review-savings-rate.md');
    expect(payload.mimeType).toContain('text/markdown');
    expect(payload.contents).toContain('# Review savings rate');
    expect(payload.contents).toContain('## You');
    expect(payload.contents).toContain('## Cavalry');
    expect(payload.contents).toContain('Your savings rate is 42%.');
  });

  it('requires a renderer-owned confirmation before a destructive action', async () => {
    const user = userEvent.setup();
    const advisor = {
      subscribe: () => () => {},
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'delete_rent',
                type: 'function',
                function: {
                  name: 'delete_transaction',
                  arguments: '{"transaction":"Rent","confirmed":true}'
                }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'Please confirm before I delete Rent.',
          message: {
            role: 'assistant',
            content: 'Please confirm before I delete Rent.',
            tool_calls: []
          }
        })
    };
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 'confirmation_required',
        changed: false,
        errors: [{ code: 'confirmation_required', message: 'Confirmation is required.' }],
        confirmation: {
          required: true,
          field: 'confirmed',
          action: 'delete Rent',
          message: 'Confirm that you want Cavalry to permanently delete Rent.'
        }
      })
      .mockResolvedValueOnce({ ok: true, status: 'completed', changed: true, data: {} });

    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={executeTool}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Delete Rent');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('button', { name: 'Confirm' })).not.toBeNull();
    expect(executeTool.mock.calls[0][1]).toEqual({ transaction: 'Rent', confirmed: false });

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Deleted “Rent”.')).not.toBeNull();
    expect(executeTool.mock.calls[1][1]).toEqual({ transaction: 'Rent', confirmed: true });
    expect(executeTool.mock.calls[1][2]).toMatchObject({ approvedByUser: true });
  });

  it('requires renderer-owned approval before a currency-converting transaction', async () => {
    const user = userEvent.setup();
    const advisor = {
      subscribe: () => () => {},
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'convert_found_cash',
                type: 'function',
                function: {
                  name: 'create_transaction',
                  arguments: '{"amount":20,"currency":"PHP","allowCurrencyConversion":true}'
                }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'Cash is configured in USD. Please confirm the PHP to USD conversion.',
          message: {
            role: 'assistant',
            content: 'Cash is configured in USD. Please confirm the PHP to USD conversion.',
            tool_calls: []
          }
        })
    };
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 'confirmation_required',
        changed: false,
        errors: [
          {
            code: 'account_currency_conversion_confirmation_required',
            message: 'Cash is configured in USD, so PHP 20.00 would be converted before posting.'
          }
        ],
        confirmation: {
          required: true,
          field: 'allowCurrencyConversion',
          action: 'post this transaction with the disclosed currency conversion',
          message:
            'Cash is configured in USD, so PHP 20.00 would be converted before posting. Confirm the conversion to continue.'
        }
      })
      .mockResolvedValueOnce({ ok: true, status: 'completed', changed: true, data: {} });

    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={executeTool}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Add PHP 20 to Cash');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('button', { name: 'Confirm' })).not.toBeNull();
    expect(executeTool.mock.calls[0][1]).toEqual({
      amount: 20,
      currency: 'PHP',
      allowDuplicate: false,
      allowCurrencyConversion: false
    });

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Done—the change was saved.')).not.toBeNull();
    expect(executeTool.mock.calls[1][1]).toEqual({
      amount: 20,
      currency: 'PHP',
      allowCurrencyConversion: true
    });
    expect(executeTool.mock.calls[1][2]).toMatchObject({ approvedByUser: true });
  });

  it('preserves an approved duplicate warning while requesting currency conversion approval', async () => {
    const user = userEvent.setup();
    const duplicateMessage =
      'This transaction looks like an existing entry. Confirm the duplicate.';
    const conversionMessage =
      'Cash is configured in USD, so PHP 20.00 would be converted before posting. Confirm the conversion to continue.';
    const advisor = {
      subscribe: () => () => {},
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'duplicate_conversion_found_cash',
                type: 'function',
                function: {
                  name: 'create_transaction',
                  arguments:
                    '{"amount":20,"currency":"PHP","allowDuplicate":true,"allowCurrencyConversion":true}'
                }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'This may be a duplicate. Please confirm before adding it.',
          message: {
            role: 'assistant',
            content: 'This may be a duplicate. Please confirm before adding it.',
            tool_calls: []
          }
        })
    };
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 'confirmation_required',
        changed: false,
        errors: [
          {
            code: 'possible_duplicate_transaction',
            message: duplicateMessage
          }
        ],
        confirmation: {
          required: true,
          field: 'allowDuplicate',
          action: 'post this possible duplicate transaction',
          message: duplicateMessage
        }
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 'confirmation_required',
        changed: false,
        errors: [
          {
            code: 'account_currency_conversion_confirmation_required',
            message: conversionMessage
          }
        ],
        confirmation: {
          required: true,
          field: 'allowCurrencyConversion',
          action: 'post this transaction with the disclosed currency conversion',
          message: conversionMessage
        }
      })
      .mockResolvedValueOnce({ ok: true, status: 'completed', changed: true, data: {} });

    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={executeTool}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Add PHP 20 to Cash');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText(duplicateMessage)).not.toBeNull();
    expect(executeTool.mock.calls[0][1]).toEqual({
      amount: 20,
      currency: 'PHP',
      allowDuplicate: false,
      allowCurrencyConversion: false
    });

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(conversionMessage)).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(executeTool.mock.calls[1][1]).toEqual({
      amount: 20,
      currency: 'PHP',
      allowDuplicate: true
    });
    expect(executeTool.mock.calls[1][2]).toMatchObject({ approvedByUser: true });

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Done—the change was saved.')).not.toBeNull();
    expect(executeTool.mock.calls[2][1]).toEqual({
      amount: 20,
      currency: 'PHP',
      allowDuplicate: true,
      allowCurrencyConversion: true
    });
    expect(executeTool.mock.calls[2][2]).toMatchObject({ approvedByUser: true });
  });

  it('surfaces a committed mutation when final model narration fails', async () => {
    const user = userEvent.setup();
    const advisor = {
      subscribe: () => () => {},
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'create_coffee',
                type: 'function',
                function: { name: 'create_transaction', arguments: '{"amount":120}' }
              }
            ]
          }
        })
        .mockResolvedValueOnce({ ok: false, error: 'The model disconnected.' })
    };
    const executeTool = vi.fn(async () => ({
      ok: true,
      status: 'completed',
      changed: true,
      data: { transactionId: 'coffee' }
    }));

    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={executeTool}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Add coffee');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText(/A workbook change was completed and saved/)).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('The model disconnected.');
  });

  it('commits model actions through the application command pipeline and saves fresh state', async () => {
    const user = userEvent.setup();
    const workbook = makeMinimalWorkbook();
    workbook.name = 'Assistant Integration';
    workbook.settings = {
      ...workbook.settings,
      advisor: { provider: 'custom', model: 'Qwen' }
    };
    const save = vi.fn(async () => ({ ok: true, savedAt: '2026-07-10T12:00:00.000Z' }));
    let chatTurn = 0;
    const advisorInvoke = vi.fn(async (command) => {
      if (command === 'getSettings') {
        return { ok: true, settings: { provider: 'custom', model: 'Qwen' } };
      }
      if (command === 'getServerStatus') return { ok: true, status: { running: true } };
      if (command === 'getMicrophoneStatus') return { ok: true, status: 'granted' };
      if (command !== 'chat') return { ok: true };
      chatTurn += 1;
      if (chatTurn === 1) {
        return {
          ok: true,
          text: '',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'create_lunch',
                type: 'function',
                function: {
                  name: 'create_transaction',
                  arguments: JSON.stringify({
                    template: 'expense_paid',
                    amount: 325,
                    currency: 'PHP',
                    date: '2026-07-10',
                    description: 'Team lunch',
                    category: 'Food',
                    primaryAccount: 'Cash'
                  })
                }
              }
            ]
          }
        };
      }
      return {
        ok: true,
        text: 'I added Team lunch for ₱325.',
        message: {
          role: 'assistant',
          content: 'I added Team lunch for ₱325.',
          tool_calls: []
        }
      };
    });
    let sequence = 0;
    const ports = createNullRendererPorts({
      advisor: { invoke: advisorInvoke },
      workbookStorage: { save },
      browserCache: { save: vi.fn(async () => ({ ok: true })) },
      clock: {
        now: () => '2026-07-10T12:00:00.000Z',
        today: () => '2026-07-10'
      },
      ids: {
        create(prefix = 'id') {
          sequence += 1;
          return `${prefix}_integration_${sequence}`;
        }
      }
    });
    render(<AppShell initialWorkbook={workbook} ports={ports} routeId="dashboard" />);

    await user.click(screen.getAllByRole('button', { name: 'Ask Cavalry' })[0]);
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Add team lunch');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(
      await screen.findByText(
        (_content, element) =>
          element?.classList?.contains('cavalry-assistant-markdown') &&
          element.textContent.startsWith('I added Team lunch for ₱325.')
      )
    ).not.toBeNull();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(
      save.mock.calls.some(([savedWorkbook]) =>
        savedWorkbook.transactions.some((transaction) => transaction.description === 'Team lunch')
      )
    ).toBe(true);
    expect(document.querySelector('[data-react-route="transactions"]')).not.toBeNull();
    expect((await screen.findAllByText('Team lunch')).length).toBeGreaterThan(0);
  });

  it('widens leftward from the resize handle and persists the chosen width', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    render(
      <AssistantHarness
        advisor={{ invoke: vi.fn(), subscribe: () => () => {} }}
        conversationStorage={storage}
        executeTool={vi.fn()}
        settings={{ provider: 'local' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));

    const dialog = screen.getByRole('dialog', { name: 'Cavalry assistant' });
    const handle = screen.getByRole('separator', { name: 'Resize the assistant panel' });
    expect(dialog.style.getPropertyValue('--cavalry-assistant-panel-width')).toBe('430px');
    expect(handle.getAttribute('aria-valuenow')).toBe('430');

    firePointer(handle, 'pointerdown', { button: 0, clientX: 800 });
    firePointer(handle, 'pointermove', { clientX: 640 });
    expect(dialog.style.getPropertyValue('--cavalry-assistant-panel-width')).toBe('590px');
    firePointer(handle, 'pointerup', { clientX: 640 });

    expect(dialog.style.getPropertyValue('--cavalry-assistant-panel-width')).toBe('590px');
    expect(handle.getAttribute('aria-valuenow')).toBe('590');
    expect(storage.getItem('cavalry.assistant.panel-width')).toBe('590');
  });

  it('never narrows below the default width and resets on double-click', async () => {
    const user = userEvent.setup();
    render(
      <AssistantHarness
        advisor={{ invoke: vi.fn(), subscribe: () => () => {} }}
        executeTool={vi.fn()}
        settings={{ provider: 'local' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));

    const dialog = screen.getByRole('dialog', { name: 'Cavalry assistant' });
    const handle = screen.getByRole('separator', { name: 'Resize the assistant panel' });

    firePointer(handle, 'pointerdown', { button: 0, clientX: 600 });
    firePointer(handle, 'pointermove', { clientX: 900 });
    firePointer(handle, 'pointerup', { clientX: 900 });
    expect(dialog.style.getPropertyValue('--cavalry-assistant-panel-width')).toBe('430px');

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(dialog.style.getPropertyValue('--cavalry-assistant-panel-width')).toBe('478px');

    fireEvent.dblClick(handle);
    expect(dialog.style.getPropertyValue('--cavalry-assistant-panel-width')).toBe('430px');
  });

  it('supports keyboard resizing within the clamped range', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    storage.setItem('cavalry.assistant.panel-width', '5000');
    render(
      <AssistantHarness
        advisor={{ invoke: vi.fn(), subscribe: () => () => {} }}
        conversationStorage={storage}
        executeTool={vi.fn()}
        settings={{ provider: 'local' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));

    const dialog = screen.getByRole('dialog', { name: 'Cavalry assistant' });
    const handle = screen.getByRole('separator', { name: 'Resize the assistant panel' });
    const max = Math.max(430, Math.min(1100, window.innerWidth - 240));
    expect(dialog.style.getPropertyValue('--cavalry-assistant-panel-width')).toBe(`${max}px`);

    fireEvent.keyDown(handle, { key: 'Home' });
    expect(dialog.style.getPropertyValue('--cavalry-assistant-panel-width')).toBe('430px');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(dialog.style.getPropertyValue('--cavalry-assistant-panel-width')).toBe('430px');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(dialog.style.getPropertyValue('--cavalry-assistant-panel-width')).toBe(`${max}px`);
  });
});
