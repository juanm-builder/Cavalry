import { describe, expect, it, vi } from 'vitest';

import {
  getCavalryAssistantConversationActivityStorageKey,
  getCavalryAssistantConversationStorageKey,
  hasCavalryAssistantConversationActivity,
  loadCavalryAssistantConversationState,
  saveCavalryAssistantConversationState,
  selectCavalryAssistantConversation,
  startNewCavalryAssistantConversation,
  updateActiveCavalryAssistantConversation
} from '../../src/renderer/features/assistant/cavalry-assistant-conversations.js';

function createMemoryStorage() {
  const entries = new Map();
  return {
    getItem: vi.fn((key) => entries.get(key) || null),
    setItem: vi.fn((key, value) => entries.set(key, value)),
    entries
  };
}

describe('Cavalry assistant conversations', () => {
  it('stores titled conversations separately for each workbook and restores the active chat', () => {
    const storage = createMemoryStorage();
    const workbook = { id: 'workbook-one', name: 'One' };
    let state = loadCavalryAssistantConversationState(workbook, { storage });

    state = updateActiveCavalryAssistantConversation(
      state,
      [
        {
          id: 'message-1',
          role: 'user',
          text: 'Review my unusually large transactions from this month',
          createdAt: '2026-07-12T01:00:00.000Z'
        },
        {
          id: 'message-2',
          role: 'assistant',
          text: 'I found three.',
          createdAt: '2026-07-12T01:00:01.000Z'
        }
      ],
      { createId: () => 'conversation-one', now: () => '2026-07-12T01:00:01.000Z' }
    );
    expect(saveCavalryAssistantConversationState(state, { storage })).toEqual({
      ok: true,
      degraded: false
    });

    const restored = loadCavalryAssistantConversationState(workbook, { storage });
    expect(restored.activeConversationId).toBe('conversation-one');
    expect(restored.conversations[0]).toMatchObject({
      id: 'conversation-one',
      title: 'Review my unusually large transactions from thi…'
    });
    expect(restored.conversations[0].messages.map((message) => message.text)).toEqual([
      'Review my unusually large transactions from this month',
      'I found three.'
    ]);
    expect(storage.entries.get(getCavalryAssistantConversationActivityStorageKey(workbook))).toBe(
      '1'
    );
    expect(hasCavalryAssistantConversationActivity(workbook, { storage })).toBe(true);

    const otherWorkbook = loadCavalryAssistantConversationState(
      { id: 'workbook-two', name: 'Two' },
      { storage }
    );
    expect(otherWorkbook.conversations).toEqual([]);
    expect(getCavalryAssistantConversationStorageKey(workbook)).not.toBe(
      getCavalryAssistantConversationStorageKey({ id: 'workbook-two' })
    );
  });

  it('starts a blank chat without deleting history and can select an earlier conversation', () => {
    const initial = {
      scopeKey: 'test',
      activeConversationId: 'conversation-one',
      conversations: [{ id: 'conversation-one', messages: [{ role: 'user', text: 'Hello' }] }]
    };
    const blank = startNewCavalryAssistantConversation(initial);
    expect(blank.activeConversationId).toBe('');
    expect(blank.conversations).toEqual(initial.conversations);
    expect(selectCavalryAssistantConversation(blank, 'conversation-one').activeConversationId).toBe(
      'conversation-one'
    );
  });

  it('imports persisted Advisor threads when no drawer history exists yet', () => {
    const storage = createMemoryStorage();
    const state = loadCavalryAssistantConversationState(
      {
        id: 'legacy-workbook',
        settings: { activeAdvisorThreadId: 'thread-1' },
        advisorThreads: [
          {
            id: 'thread-1',
            title: 'Earlier workbook review',
            messages: [
              {
                id: 'legacy-message',
                role: 'user',
                text: 'Check my budget',
                createdAt: '2026-07-01T01:00:00.000Z'
              }
            ]
          }
        ]
      },
      { storage }
    );

    expect(state.activeConversationId).toBe('thread-1');
    expect(state.conversations[0].title).toBe('Earlier workbook review');
  });

  it('adds workbook Advisor threads to existing local chats without replacing the active chat', () => {
    const storage = createMemoryStorage();
    const workbook = { id: 'combined-workbook' };
    let localState = loadCavalryAssistantConversationState(workbook, { storage });
    localState = updateActiveCavalryAssistantConversation(
      localState,
      [{ id: 'local-message', role: 'user', text: 'Current drawer chat' }],
      { createId: () => 'local-conversation', now: () => '2026-07-12T02:00:00.000Z' }
    );
    saveCavalryAssistantConversationState(localState, { storage });

    const combined = loadCavalryAssistantConversationState(
      {
        ...workbook,
        settings: { activeAdvisorThreadId: 'legacy-thread' },
        advisorThreads: [
          {
            id: 'legacy-thread',
            title: 'Legacy workbook chat',
            messages: [{ id: 'legacy-message', role: 'user', text: 'Earlier chat' }]
          }
        ]
      },
      { storage }
    );

    expect(combined.activeConversationId).toBe('local-conversation');
    expect(combined.conversations.map((conversation) => conversation.id)).toEqual([
      'local-conversation',
      'legacy-thread'
    ]);
  });

  it('never persists embedded image bytes and retries with tighter limits on quota failure', () => {
    const entries = new Map();
    const storage = {
      getItem: (key) => entries.get(key) || null,
      setItem: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('Quota exceeded');
        })
        .mockImplementation((key, value) => entries.set(key, value))
    };
    const state = {
      scopeKey: 'image-history',
      activeConversationId: 'conversation',
      conversations: [
        {
          id: 'conversation',
          messages: [
            {
              id: 'message',
              role: 'user',
              text: 'Review this',
              attachments: [{ id: 'image', dataUrl: 'data:image/png;base64,AAAA' }]
            }
          ]
        }
      ]
    };

    expect(saveCavalryAssistantConversationState(state, { storage })).toEqual({
      ok: true,
      degraded: true
    });
    expect(
      JSON.parse(entries.get('image-history')).conversations[0].messages[0].attachments[0]
    ).toMatchObject({ dataUrl: '', storageUnavailable: true });
  });

  it('bounds stored conversation and message history while retaining the active chat', () => {
    const storage = createMemoryStorage();
    const conversations = Array.from({ length: 30 }, (_unused, conversationIndex) => ({
      id: `conversation-${conversationIndex}`,
      updatedAt: `2026-07-${String(conversationIndex + 1).padStart(2, '0')}T00:00:00.000Z`,
      messages: Array.from({ length: 170 }, (_message, messageIndex) => ({
        id: `message-${conversationIndex}-${messageIndex}`,
        role: messageIndex % 2 === 0 ? 'user' : 'assistant',
        text: `Message ${messageIndex}`,
        attachments:
          messageIndex === 169 ? [{ id: 'image', dataUrl: 'data:image/png;base64,AAAA' }] : []
      }))
    }));
    const state = {
      scopeKey: 'bounded-history',
      activeConversationId: 'conversation-0',
      conversations
    };

    expect(saveCavalryAssistantConversationState(state, { storage })).toEqual({
      ok: true,
      degraded: true
    });
    const serialized = JSON.parse(storage.entries.get(state.scopeKey));
    expect(serialized.conversations).toHaveLength(24);
    expect(
      serialized.conversations.some((conversation) => conversation.id === 'conversation-0')
    ).toBe(true);
    expect(
      serialized.conversations.every((conversation) => conversation.messages.length <= 160)
    ).toBe(true);
    expect(JSON.stringify(serialized)).not.toContain('data:image/');
  });

  it('persists normalized record references with assistant messages', () => {
    const storage = createMemoryStorage();
    const workbook = { id: 'reference-workbook' };
    let state = loadCavalryAssistantConversationState(workbook, { storage });
    state = updateActiveCavalryAssistantConversation(
      state,
      [
        {
          id: 'assistant-reference-message',
          role: 'assistant',
          text: 'Cash has a balance of ₱5,000.',
          references: [
            {
              id: 'account:cash',
              token: 'Cash',
              aliases: ['Cash account', 'Cash'],
              label: 'Cash',
              kind: 'account',
              source_refs: ['account:cash'],
              detail: { balance: 5000, currency: 'PHP' }
            }
          ]
        }
      ],
      { createId: () => 'reference-conversation', now: () => '2026-07-14T01:00:00.000Z' }
    );

    saveCavalryAssistantConversationState(state, { storage });
    const restored = loadCavalryAssistantConversationState(workbook, { storage });

    expect(restored.conversations[0].messages[0].references).toEqual([
      {
        id: 'account:cash',
        token: 'Cash',
        aliases: ['Cash account', 'Cash'],
        label: 'Cash',
        kind: 'account',
        source_refs: ['account:cash'],
        detail: { balance: 5000, currency: 'PHP' }
      }
    ]);
  });

  it('drops malformed record references before writing or restoring conversation state', () => {
    const storage = createMemoryStorage();
    const state = {
      scopeKey: 'malformed-reference-history',
      activeConversationId: 'conversation',
      conversations: [
        {
          id: 'conversation',
          messages: [
            {
              id: 'message',
              role: 'assistant',
              text: 'Review Cash.',
              references: [
                {
                  token: 'Cash',
                  kind: 'account',
                  source_refs: ['account:cash'],
                  aliases: ['Cash']
                },
                { token: '', kind: 'account', source_refs: ['account:cash'] },
                { token: 'Fake', kind: 'unknown', source_refs: ['unknown:fake'] },
                { token: 'Wrong prefix', kind: 'account', source_refs: ['transaction:one'] },
                null
              ]
            }
          ]
        }
      ]
    };

    saveCavalryAssistantConversationState(state, { storage });
    const serialized = JSON.parse(storage.entries.get(state.scopeKey));

    expect(serialized.conversations[0].messages[0].references).toHaveLength(1);
    expect(serialized.conversations[0].messages[0].references[0]).toMatchObject({
      token: 'Cash',
      kind: 'account',
      source_refs: ['account:cash']
    });
  });
});
