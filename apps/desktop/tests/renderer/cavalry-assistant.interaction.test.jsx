import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CavalryAssistant } from '../../src/renderer/features/assistant/CavalryAssistant.jsx';
import { serializeConversationMarkdown } from '../../src/renderer/features/assistant/CavalryAssistantPresentation.jsx';
import { getCavalryAssistantConversationStorageKey } from '../../src/renderer/features/assistant/cavalry-assistant-conversations.js';
import { normalizeCavalryAssistantActionResult } from '../../src/renderer/features/assistant/cavalry-assistant-action-results.js';
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

function completedActionResult({
  actionVerb = 'Saved',
  id = 'workbook-change',
  label = 'Workbook change',
  amount = null,
  currency = ''
} = {}) {
  const persistence = { status: 'saved', durable: true, revision: 'revision-after-write' };
  return {
    ok: true,
    status: 'completed',
    lifecycle: 'completed',
    changed: true,
    commitStatus: 'committed',
    verificationStatus: 'verified',
    persistence,
    data: {},
    receipt: {
      kind: 'action_receipt',
      actionVerb,
      lifecycle: 'completed',
      changed: true,
      commitStatus: 'committed',
      verificationStatus: 'verified',
      persistence,
      entity: { id, type: 'record', label },
      amount,
      currency,
      accounts: [],
      items: [],
      warnings: [],
      errors: []
    }
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
  it('edits, reveals, and clears transparent local memory inside Assistant settings', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    const advisor = {
      subscribe: () => () => {},
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getMemory') {
          return {
            ok: true,
            memory: {
              content: 'I prefer concise explanations.',
              items: [],
              revision: 'revision-1',
              memoryEnabled: true,
              allowAutomaticMemory: false,
              path: '/test-fixtures/Cavalry/memory.md',
              fileName: 'memory.md'
            }
          };
        }
        if (command === 'refreshMemory') {
          return {
            ok: true,
            memory: {
              content: 'I prefer concise explanations.',
              items: [],
              revision: 'revision-1',
              memoryEnabled: true,
              allowAutomaticMemory: false,
              path: '/test-fixtures/Cavalry/memory.md',
              fileName: 'memory.md'
            }
          };
        }
        if (command === 'saveMemory') {
          return {
            ok: true,
            message: 'Companion memory saved locally.',
            memory: {
              content: payload.content,
              items: [],
              revision: 'revision-2',
              memoryEnabled: payload.memoryEnabled,
              allowAutomaticMemory: payload.allowAutomaticMemory,
              path: '/test-fixtures/Cavalry/memory.md',
              fileName: 'memory.md'
            }
          };
        }
        if (command === 'clearMemory') {
          return {
            ok: true,
            message: 'Companion memory cleared.',
            memory: {
              content: '',
              items: [],
              revision: 'revision-3',
              memoryEnabled: payload.memoryEnabled,
              allowAutomaticMemory: payload.allowAutomaticMemory,
              path: '/test-fixtures/Cavalry/memory.md',
              fileName: 'memory.md'
            }
          };
        }
        if (command === 'openMemoryFile') return { ok: true, message: 'Opened memory.md.' };
        if (command === 'openMemoryFolder') {
          return { ok: true, message: 'Opened the memory.md folder.' };
        }
        return { ok: false, error: `Unexpected command ${command}` };
      })
    };
    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={vi.fn()}
        onOpenSettings={onOpenSettings}
        settings={{ provider: 'local' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Assistant settings' }));

    expect(await screen.findByRole('heading', { name: 'Personalization' })).not.toBeNull();
    const memoryField = screen.getByRole('textbox', {
      name: 'What should Cavalry know about you?'
    });
    expect(memoryField.value).toBe('I prefer concise explanations.');
    expect(screen.getByText('memory.md')).not.toBeNull();
    expect(
      screen.getByRole('switch', { name: 'Enable local memory' }).getAttribute('aria-checked')
    ).toBe('true');

    await user.clear(memoryField);
    await user.type(memoryField, 'My emergency fund is my top priority.');
    await user.click(
      screen.getByRole('switch', { name: 'Allow approved memory updates from chats' })
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(advisor.invoke).toHaveBeenCalledWith('saveMemory', {
        content: 'My emergency fund is my top priority.',
        memoryEnabled: true,
        allowAutomaticMemory: true,
        expectedRevision: 'revision-1'
      })
    );
    expect(await screen.findByText('Companion memory saved locally.')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open file' }));
    expect(advisor.invoke).toHaveBeenCalledWith('openMemoryFile');
    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(advisor.invoke).toHaveBeenCalledWith('openMemoryFolder');

    await user.click(screen.getByRole('button', { name: 'Clear memory' }));
    expect(screen.getByText('Clear every remembered detail?')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Confirm clear' }));
    await waitFor(() =>
      expect(advisor.invoke).toHaveBeenCalledWith('clearMemory', {
        memoryEnabled: true,
        allowAutomaticMemory: true,
        expectedRevision: 'revision-2'
      })
    );
    expect(memoryField.value).toBe('');

    await user.click(screen.getByRole('button', { name: /Model and connection settings/ }));
    expect(onOpenSettings).toHaveBeenCalledWith('settings-advisor');
  });

  it('auto-refreshes clean memory drafts and preserves dirty drafts after an external edit', async () => {
    const user = userEvent.setup();
    let diskMemory = {
      content: 'Initial memory.',
      items: [],
      revision: 'revision-1',
      memoryEnabled: true,
      allowAutomaticMemory: false,
      path: '/test-fixtures/Cavalry/memory.md',
      fileName: 'memory.md'
    };
    const advisor = {
      subscribe: () => () => {},
      invoke: vi.fn(async (command) => {
        if (command === 'getMemory' || command === 'refreshMemory') {
          return { ok: true, memory: diskMemory };
        }
        return { ok: false, error: `Unexpected command ${command}` };
      })
    };

    render(
      <AssistantHarness advisor={advisor} executeTool={vi.fn()} settings={{ provider: 'local' }} />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Assistant settings' }));
    let memoryField = await screen.findByRole('textbox', {
      name: 'What should Cavalry know about you?'
    });
    expect(memoryField.value).toBe('Initial memory.');

    diskMemory = { ...diskMemory, content: 'Edited outside Cavalry.', revision: 'revision-2' };
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(memoryField.value).toBe('Edited outside Cavalry.'));
    expect(screen.getByText('memory.md was refreshed after an external edit.')).not.toBeNull();

    await user.clear(memoryField);
    await user.type(memoryField, 'My unsaved local draft.');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(
      await screen.findByText(
        'You have unsaved memory edits. Load the latest file only if you want to discard them.'
      )
    ).not.toBeNull();
    memoryField = screen.getByRole('textbox', {
      name: 'What should Cavalry know about you?'
    });
    expect(memoryField.value).toBe('My unsaved local draft.');
    await user.click(screen.getByRole('button', { name: 'Load latest' }));
    await waitFor(() => expect(memoryField.value).toBe('Edited outside Cavalry.'));

    await user.clear(memoryField);
    await user.type(memoryField, 'My unsaved local draft.');
    diskMemory = { ...diskMemory, content: 'A newer external edit.', revision: 'revision-3' };
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(
      await screen.findByText(
        'memory.md changed outside Cavalry. Your draft is untouched; reload before saving or updating an item.'
      )
    ).not.toBeNull();
    expect(memoryField.value).toBe('My unsaved local draft.');

    await user.click(screen.getByRole('button', { name: 'Load latest' }));
    await waitFor(() => expect(memoryField.value).toBe('A newer external edit.'));
    expect(screen.getByText('Loaded the latest memory.md revision from disk.')).not.toBeNull();
  });

  it('binds every structured memory item mutation to the currently displayed revision', async () => {
    const user = userEvent.setup();
    let memory = {
      content: '',
      items: [],
      revision: 'revision-1',
      memoryEnabled: true,
      allowAutomaticMemory: true,
      path: '/test-fixtures/Cavalry/memory.md',
      fileName: 'memory.md'
    };
    const advisor = {
      subscribe: () => () => {},
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getMemory' || command === 'refreshMemory') {
          return { ok: true, memory };
        }
        if (command === 'createMemoryItem') {
          memory = {
            ...memory,
            revision: 'revision-2',
            items: [
              {
                id: 'memory-item-1',
                text: payload.item.text,
                tags: [],
                scope: 'relevant'
              }
            ]
          };
          return { ok: true, memory, message: 'Memory item added.' };
        }
        if (command === 'updateMemoryItem') {
          memory = {
            ...memory,
            revision: 'revision-3',
            items: [{ ...memory.items[0], text: payload.item.text }]
          };
          return { ok: true, memory, message: 'Memory item updated.' };
        }
        if (command === 'deleteMemoryItem') {
          memory = { ...memory, revision: 'revision-4', items: [] };
          return { ok: true, memory, message: 'Memory item deleted.' };
        }
        return { ok: false, error: `Unexpected command ${command}` };
      })
    };

    render(
      <AssistantHarness advisor={advisor} executeTool={vi.fn()} settings={{ provider: 'local' }} />
    );
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Assistant settings' }));
    await screen.findByRole('heading', { name: 'Personalization' });

    await user.type(screen.getByRole('textbox', { name: 'New memory item' }), 'Keep it concise.');
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() =>
      expect(advisor.invoke).toHaveBeenCalledWith('createMemoryItem', {
        item: { text: 'Keep it concise.' },
        expectedRevision: 'revision-1'
      })
    );

    const itemField = await screen.findByRole('textbox', { name: 'Memory item memory-item-1' });
    await user.clear(itemField);
    await user.type(itemField, 'Keep every answer concise.');
    const itemCard = itemField.closest('.cavalry-assistant-memory-item');
    await user.click(within(itemCard).getByRole('button', { name: 'Update' }));
    await waitFor(() =>
      expect(advisor.invoke).toHaveBeenCalledWith('updateMemoryItem', {
        itemId: 'memory-item-1',
        item: { text: 'Keep every answer concise.', tags: [], scope: 'relevant' },
        expectedRevision: 'revision-2'
      })
    );

    await user.click(within(itemCard).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(advisor.invoke).toHaveBeenCalledWith('deleteMemoryItem', {
        itemId: 'memory-item-1',
        expectedRevision: 'revision-3'
      })
    );
    expect(await screen.findByText('No structured memory items yet.')).not.toBeNull();
  });

  it('preserves unsaved settings and item drafts across independent memory saves', async () => {
    const user = userEvent.setup();
    let memory = {
      content: 'Original free-form memory.',
      items: [
        {
          id: 'memory-item-1',
          text: 'Original item text.',
          tags: [],
          scope: 'relevant'
        }
      ],
      revision: 'revision-1',
      memoryEnabled: true,
      allowAutomaticMemory: true,
      path: '/test-fixtures/Cavalry/memory.md',
      fileName: 'memory.md'
    };
    const advisor = {
      subscribe: () => () => {},
      invoke: vi.fn(async (command, payload) => {
        if (command === 'getMemory' || command === 'refreshMemory') {
          return { ok: true, memory };
        }
        if (command === 'createMemoryItem') {
          memory = {
            ...memory,
            revision: 'revision-2',
            items: memory.items.concat({
              id: 'memory-item-2',
              text: payload.item.text,
              tags: [],
              scope: 'relevant'
            })
          };
          return { ok: true, memory, message: 'Memory item added.' };
        }
        if (command === 'saveMemory') {
          memory = {
            ...memory,
            content: payload.content,
            memoryEnabled: payload.memoryEnabled,
            allowAutomaticMemory: payload.allowAutomaticMemory,
            revision: 'revision-3'
          };
          return { ok: true, memory, message: 'Companion memory saved locally.' };
        }
        return { ok: false, error: `Unexpected command ${command}` };
      })
    };

    render(
      <AssistantHarness advisor={advisor} executeTool={vi.fn()} settings={{ provider: 'local' }} />
    );
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Assistant settings' }));
    const settingsField = await screen.findByRole('textbox', {
      name: 'What should Cavalry know about you?'
    });

    await user.clear(settingsField);
    await user.type(settingsField, 'Unsaved free-form draft.');
    await user.type(screen.getByRole('textbox', { name: 'New memory item' }), 'New item.');
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() =>
      expect(advisor.invoke).toHaveBeenCalledWith('createMemoryItem', {
        item: { text: 'New item.' },
        expectedRevision: 'revision-1'
      })
    );
    expect(settingsField.value).toBe('Unsaved free-form draft.');

    const itemField = screen.getByRole('textbox', { name: 'Memory item memory-item-1' });
    await user.clear(itemField);
    await user.type(itemField, 'Unsaved structured item edit.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(advisor.invoke).toHaveBeenCalledWith('saveMemory', {
        content: 'Unsaved free-form draft.',
        memoryEnabled: true,
        allowAutomaticMemory: true,
        expectedRevision: 'revision-2'
      })
    );
    expect(itemField.value).toBe('Unsaved structured item edit.');
  });

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
    const requestId = advisor.invoke.mock.calls[0][1].requestId;

    act(() => {
      publishStatus({
        phase: 'stream',
        requestId,
        reset: true,
        final: true,
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

  it('keeps Responses deltas in one transient message and clears tool-call text without persistence', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    let publishStatus = () => {};
    let finishRequest = () => {};
    const advisor = {
      subscribe(listener) {
        publishStatus = listener;
        return () => {};
      },
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
        conversationStorage={storage}
        executeTool={vi.fn()}
        settings={{ provider: 'openai', model: 'gpt-test', hasApiKey: true }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Check this');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(advisor.invoke).toHaveBeenCalled());
    const requestId = advisor.invoke.mock.calls[0][1].requestId;

    act(() => {
      publishStatus({
        phase: 'stream',
        requestId,
        segment: 1,
        reset: true,
        final: false,
        delta: 'Checking'
      });
      publishStatus({
        phase: 'stream',
        requestId,
        segment: 1,
        reset: false,
        final: false,
        delta: ' the records'
      });
    });
    expect(await screen.findByText('Checking the records')).not.toBeNull();
    expect(document.querySelectorAll('.cavalry-assistant-streaming')).toHaveLength(1);

    act(() => {
      publishStatus({
        phase: 'stream',
        requestId,
        segment: 1,
        reset: true,
        final: true,
        delta: ''
      });
    });
    expect(screen.queryByText('Checking the records')).toBeNull();
    expect(document.querySelector('.cavalry-assistant-streaming')).toBeNull();

    const storageKey = getCavalryAssistantConversationStorageKey({
      id: 'workbook-1',
      name: 'The Plan'
    });
    await waitFor(() => expect(storage.entries.has(storageKey)).toBe(true));
    expect(storage.entries.get(storageKey)).not.toContain('Checking the records');

    await act(async () => {
      finishRequest({ ok: false, cancelled: true, error: 'Request cancelled.' });
    });
    expect(await screen.findByText('Stopped. No completed change was confirmed.')).not.toBeNull();
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
      .mockResolvedValueOnce(
        completedActionResult({ actionVerb: 'Deleted', id: 'rent', label: 'Rent' })
      );

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

  it('reports a confirmed idempotent memory race as already current', async () => {
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
                id: 'remember_race',
                type: 'function',
                function: {
                  name: 'remember_memory',
                  arguments: '{"text":"Use concise replies"}'
                }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'Please confirm this memory.',
          message: {
            role: 'assistant',
            content: 'Please confirm this memory.',
            tool_calls: []
          }
        })
    };
    const noOpResult = normalizeCavalryAssistantActionResult(
      {
        ok: true,
        status: 'unchanged',
        changed: false,
        commitStatus: 'not_applicable',
        verificationStatus: 'verified',
        data: {
          action: 'already_present',
          memory: { id: 'memory_item_1', label: 'Use concise replies' }
        }
      },
      {
        actionId: 'memory.local.remember',
        toolName: 'remember_memory',
        title: 'Remember memory',
        actionVerb: 'Remembered',
        access: 'write'
      }
    );
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
          action: 'remember “Use concise replies”',
          message: 'Confirm that you want Cavalry to remember “Use concise replies”.',
          proposal: {
            arguments: {
              text: 'Use concise replies',
              expectedRevision: 'revision-1'
            }
          }
        }
      })
      .mockResolvedValueOnce(noOpResult);

    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={executeTool}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Message Cavalry' }),
      'Remember that I prefer concise replies'
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText(
        'No change was needed for “Use concise replies”. It was already current.'
      )
    ).not.toBeNull();
    const receipt = screen.getByRole('region', { name: 'Action result' });
    expect(within(receipt).getByText('No change needed')).not.toBeNull();
    expect(within(receipt).queryByText(/saved|failed/i)).toBeNull();
    expect(screen.queryByText(/could not verify that the confirmed change/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(executeTool.mock.calls[1][1]).toEqual({
      text: 'Use concise replies',
      expectedRevision: 'revision-1',
      confirmed: true
    });
    expect(executeTool.mock.calls[1][2]).toMatchObject({ approvedByUser: true });
  });

  it('persists reload-safe confirmation copy and a deliberate card cancellation final', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
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
                id: 'delete_rent_reload',
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
    const executeTool = vi.fn(async () => ({
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
    }));

    const firstView = render(
      <AssistantHarness
        advisor={advisor}
        conversationStorage={storage}
        executeTool={executeTool}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Delete Rent');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('button', { name: 'Confirm' })).not.toBeNull();
    expect(
      await screen.findByText(/If you leave or reload this chat, ask Cavalry to prepare it again/i)
    ).not.toBeNull();
    const storageKey = getCavalryAssistantConversationStorageKey({
      id: 'workbook-1',
      name: 'The Plan'
    });
    await waitFor(() =>
      expect(storage.entries.get(storageKey)).toContain('ask Cavalry to prepare it again')
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Cancelled. No changes were made.')).not.toBeNull();
    await waitFor(() =>
      expect(storage.entries.get(storageKey)).toContain('Cancelled. No changes were made.')
    );
    firstView.unmount();

    render(
      <AssistantHarness
        advisor={advisor}
        conversationStorage={storage}
        executeTool={executeTool}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    expect(await screen.findByText('Cancelled. No changes were made.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
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
      .mockResolvedValueOnce(
        completedActionResult({
          actionVerb: 'Recorded',
          id: 'cash-transaction',
          label: 'Cash transaction',
          amount: 20,
          currency: 'PHP'
        })
      );

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

    expect(await screen.findByText(/Recorded “Cash transaction”/)).not.toBeNull();
    expect(executeTool.mock.calls[1][1]).toEqual({
      amount: 20,
      currency: 'PHP',
      allowDuplicate: false,
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
      .mockResolvedValueOnce(
        completedActionResult({
          actionVerb: 'Recorded',
          id: 'cash-transaction',
          label: 'Cash transaction',
          amount: 20,
          currency: 'PHP'
        })
      );

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

    expect((await screen.findAllByText(conversionMessage)).length).toBe(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(executeTool.mock.calls[1][1]).toEqual({
      amount: 20,
      currency: 'PHP',
      allowDuplicate: true,
      allowCurrencyConversion: false
    });
    expect(executeTool.mock.calls[1][2]).toMatchObject({ approvedByUser: true });

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/Recorded “Cash transaction”/)).not.toBeNull();
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
    const executeTool = vi.fn(async () =>
      completedActionResult({ actionVerb: 'Recorded', id: 'coffee', label: 'Coffee' })
    );

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

    expect(await screen.findByText(/Recorded “Coffee”/)).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('The model disconnected.');
  });

  it('presents duplicate remember_memory as already current instead of saved or failed', async () => {
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
                id: 'remember_duplicate',
                type: 'function',
                function: {
                  name: 'remember_memory',
                  arguments: '{"text":"Use concise replies"}'
                }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'I saved a new memory.',
          message: {
            role: 'assistant',
            content: 'I saved a new memory.',
            tool_calls: []
          }
        })
    };
    const executeTool = vi.fn(async () =>
      normalizeCavalryAssistantActionResult(
        {
          ok: true,
          status: 'unchanged',
          changed: false,
          commitStatus: 'not_applicable',
          verificationStatus: 'verified',
          data: {
            action: 'already_present',
            memory: { id: 'memory_item_1', label: 'Use concise replies' }
          }
        },
        {
          actionId: 'memory.local.remember',
          toolName: 'remember_memory',
          title: 'Remember memory',
          actionVerb: 'Remembered',
          access: 'write'
        }
      )
    );

    render(
      <AssistantHarness
        advisor={advisor}
        executeTool={executeTool}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Message Cavalry' }),
      'Remember that I prefer concise replies'
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(
      await screen.findByText(
        'No change was needed for “Use concise replies”. It was already current.'
      )
    ).not.toBeNull();
    const receipt = screen.getByRole('region', { name: 'Action result' });
    expect(within(receipt).getByText('No change needed')).not.toBeNull();
    expect(within(receipt).queryByText(/saved|failed/i)).toBeNull();
    expect(screen.queryByText('I saved a new memory.')).toBeNull();
    expect(screen.queryByText(/could not confirm that this action completed/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never lets model prose claim success for an unverified durable receipt', async () => {
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
                id: 'unsafe_commit',
                type: 'function',
                function: { name: 'create_transaction', arguments: '{"amount":120}' }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'Done. The transaction was definitely saved.',
          message: {
            role: 'assistant',
            content: 'Done. The transaction was definitely saved.',
            tool_calls: []
          }
        })
    };
    const executeTool = vi.fn(async () => {
      const result = completedActionResult({
        actionVerb: 'Recorded',
        id: 'coffee',
        label: 'Coffee'
      });
      result.persistence = { status: 'unknown', durable: false };
      result.receipt.persistence = { status: 'unknown', durable: false };
      return result;
    });

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

    expect(await screen.findByText(/without a verified durable receipt/i)).not.toBeNull();
    expect(screen.queryByText('Done. The transaction was definitely saved.')).toBeNull();
  });

  it('persists a deterministic failed-write result instead of later model success prose', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
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
                id: 'failed_write',
                type: 'function',
                function: { name: 'create_transaction', arguments: '{"amount":120}' }
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          text: 'Done. The transaction was saved successfully.',
          message: {
            role: 'assistant',
            content: 'Done. The transaction was saved successfully.',
            tool_calls: []
          }
        })
    };
    const executeTool = vi.fn(async () => ({
      ok: false,
      status: 'failed',
      lifecycle: 'failed',
      changed: false,
      commitStatus: 'not_committed',
      verificationStatus: 'not_attempted',
      errors: [
        {
          code: 'transaction_rejected',
          message: 'The transaction was rejected by the application.'
        }
      ],
      receipt: {
        kind: 'action_receipt',
        access: 'write',
        toolName: 'create_transaction',
        title: 'Record transaction',
        lifecycle: 'failed',
        changed: false,
        commitStatus: 'not_committed',
        verificationStatus: 'not_attempted',
        persistence: { status: 'unconfirmed', durable: false },
        entity: { id: '', type: 'transaction', label: 'Transaction' },
        warnings: [],
        errors: [
          {
            code: 'transaction_rejected',
            message: 'The transaction was rejected by the application.'
          }
        ]
      }
    }));

    render(
      <AssistantHarness
        advisor={advisor}
        conversationStorage={storage}
        executeTool={executeTool}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Add coffee');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(
      await screen.findByText('The transaction was rejected by the application.')
    ).not.toBeNull();
    expect(screen.queryByText('Done. The transaction was saved successfully.')).toBeNull();
    const storageKey = getCavalryAssistantConversationStorageKey({
      id: 'workbook-1',
      name: 'The Plan'
    });
    await waitFor(() =>
      expect(storage.entries.get(storageKey)).toContain(
        'The transaction was rejected by the application.'
      )
    );
    expect(storage.entries.get(storageKey)).not.toContain(
      'Done. The transaction was saved successfully.'
    );
  });

  it('quarantines unexpected provider exception bodies from terminal chat history', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const advisor = {
      subscribe: () => () => {},
      invoke: vi.fn(async () => ({
        ok: false,
        error: '<html><body>PRIVATE_PROVIDER_BODY</body></html>\n at /private/provider-stack.js:1'
      }))
    };

    render(
      <AssistantHarness
        advisor={advisor}
        conversationStorage={storage}
        executeTool={vi.fn()}
        settings={{ provider: 'custom', model: 'Qwen' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Ask Cavalry' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Cavalry' }), 'Review my plan');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(
      (await screen.findAllByText('Cavalry could not complete that request.')).length
    ).toBeGreaterThan(0);
    const storageKey = getCavalryAssistantConversationStorageKey({
      id: 'workbook-1',
      name: 'The Plan'
    });
    await waitFor(() => expect(storage.entries.has(storageKey)).toBe(true));
    expect(storage.entries.get(storageKey)).not.toMatch(
      /PRIVATE_PROVIDER_BODY|provider-stack|<html>/
    );
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
          element.textContent.startsWith('Recorded “Team lunch”')
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
