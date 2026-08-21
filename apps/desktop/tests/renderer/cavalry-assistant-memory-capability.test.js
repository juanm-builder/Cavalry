import { describe, expect, it, vi } from 'vitest';

import {
  executeCavalryAssistantTool,
  getCavalryAssistantCapabilityManifest,
  getCavalryAssistantToolDefinitions
} from '../../src/renderer/features/assistant/cavalry-assistant-tools.js';

function memory(overrides = {}) {
  return {
    revision: 'revision-1',
    memoryEnabled: true,
    allowAutomaticMemory: true,
    items: [],
    ...overrides
  };
}

function advisor(handler) {
  return { invoke: vi.fn(handler) };
}

describe('Cavalry Assistant local-memory capability', () => {
  it('is auto-discovered with read/write, approval, version, and no-workbook metadata', () => {
    const manifest = getCavalryAssistantCapabilityManifest({
      question: 'Show my saved memory items'
    }).find((capability) => capability.id === 'memory.local');
    const definitions = getCavalryAssistantToolDefinitions({
      question: 'Remember that my emergency fund comes first'
    });

    expect(manifest).toMatchObject({
      version: '1.0.0',
      compatibility: { minimumAppVersion: '2.1.0' },
      tools: ['list_memory_items']
    });
    expect(manifest.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'list_memory_items',
          access: 'read',
          confirmation: expect.objectContaining({ mode: 'none' }),
          requiresWorkbook: false
        }),
        expect.objectContaining({
          name: 'remember_memory',
          access: 'write',
          confirmation: expect.objectContaining({ mode: 'always', fields: ['confirmed'] }),
          idempotency: 'expected-revision',
          requiresWorkbook: false
        })
      ])
    );
    expect(definitions.map((definition) => definition.name)).toContain('remember_memory');
    expect(definitions.map((definition) => definition.name)).not.toContain('list_memory_items');
    const rememberDefinition = definitions.find(
      (definition) => definition.name === 'remember_memory'
    );
    expect(rememberDefinition.parameters.properties).not.toHaveProperty('confirmed');
    expect(rememberDefinition.parameters.properties).not.toHaveProperty('expectedRevision');
    const rememberManifest = manifest.actions.find((action) => action.name === 'remember_memory');
    expect(rememberManifest.inputSchema.properties).not.toHaveProperty('confirmed');
    expect(rememberManifest.inputSchema.properties).not.toHaveProperty('expectedRevision');
  });

  it('publishes only memory tools supported by the explicit user intent', () => {
    const namesFor = (question) =>
      getCavalryAssistantToolDefinitions({ question }).map((definition) => definition.name);

    expect(namesFor('How much did I spend on travel?')).not.toEqual(
      expect.arrayContaining([
        'list_memory_items',
        'remember_memory',
        'update_memory_item',
        'forget_memory',
        'clear_memory'
      ])
    );
    expect(namesFor('What do you remember about my travel budget?')).toEqual(
      expect.arrayContaining(['list_memory_items'])
    );
    expect(namesFor('Remember that I prefer concise replies')).toEqual(
      expect.arrayContaining(['remember_memory'])
    );
    expect(namesFor('Remember that I prefer concise replies')).not.toContain('list_memory_items');
    expect(namesFor('Keep this in mind')).toContain('remember_memory');
    expect(namesFor('Store this for later')).toContain('remember_memory');
  });

  it('lists safe item records without requiring a workbook', async () => {
    const port = advisor(async (command) => {
      expect(command).toBe('getMemory');
      return {
        ok: true,
        memory: memory({
          path: '/private/user/path/memory.md',
          content: 'legacy text',
          items: [{ id: 'memory_item_1', text: 'Use concise replies', tags: ['style'] }]
        })
      };
    });

    const result = await executeCavalryAssistantTool(
      { name: 'list_memory_items', arguments: {} },
      { advisor: port, question: 'Show my saved memory items' }
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      changed: false,
      commitStatus: 'not_applicable',
      data: {
        memory: {
          revision: 'revision-1',
          items: [{ id: 'memory_item_1', text: 'Use concise replies', tags: ['style'] }]
        }
      }
    });
    expect(result.data.memory).not.toHaveProperty('path');
    expect(result.data.memory).not.toHaveProperty('content');
  });

  it('treats a broad explicit recall question as a bounded memory lookup', async () => {
    const port = advisor(async () => ({
      ok: true,
      memory: memory({
        items: [
          { id: 'memory_item_1', text: 'Use concise replies', tags: ['style'] },
          { id: 'memory_item_2', text: 'The emergency fund comes first', tags: ['priority'] }
        ]
      })
    }));

    const result = await executeCavalryAssistantTool(
      { name: 'list_memory_items', arguments: {} },
      { advisor: port, question: 'What do you remember about me?' }
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        memory: {
          items: [
            { id: 'memory_item_1', text: 'Use concise replies' },
            { id: 'memory_item_2', text: 'The emergency fund comes first' }
          ]
        }
      }
    });
  });

  it('does not read or disclose memory on an unrelated model tool call', async () => {
    const secret = 'PRIVATE MEMORY ITEM';
    const port = advisor(async () => ({
      ok: true,
      memory: memory({ items: [{ id: 'memory_item_secret', text: secret }] })
    }));

    const listResult = await executeCavalryAssistantTool(
      { name: 'list_memory_items', arguments: {} },
      { advisor: port, question: 'How much did I spend this month?' }
    );
    const forgetResult = await executeCavalryAssistantTool(
      { name: 'forget_memory', arguments: { id: 'memory_item_secret' } },
      { advisor: port, question: 'How much did I spend this month?' }
    );

    expect(listResult).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ code: 'tool_unavailable' })]
    });
    expect(forgetResult).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ code: 'tool_unavailable' })]
    });
    expect(port.invoke).not.toHaveBeenCalled();
    expect(JSON.stringify([listResult, forgetResult])).not.toContain(secret);
  });

  it('returns no existing items when memory is disabled', async () => {
    const secret = 'DISABLED PRIVATE MEMORY';
    const port = advisor(async () => ({
      ok: true,
      memory: memory({
        memoryEnabled: false,
        items: [{ id: 'memory_item_disabled', text: secret }]
      })
    }));

    const result = await executeCavalryAssistantTool(
      { name: 'list_memory_items', arguments: {} },
      { advisor: port, question: 'Show my saved memory items' }
    );

    expect(result).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ code: 'memory_disabled' })]
    });
    expect(port.invoke).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('returns only a bounded relevant memory subset for an explicit lookup', async () => {
    const longTravelItems = Array.from({ length: 12 }, (_, index) => ({
      id: `memory_item_travel_${index}`,
      text: `Travel budget ${index} ${'x'.repeat(1_900)}`,
      tags: ['travel', 'budget'],
      scope: 'relevant',
      updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}`
    }));
    const port = advisor(async () => ({
      ok: true,
      memory: memory({
        items: [
          ...longTravelItems,
          { id: 'memory_item_unrelated', text: 'PRIVATE unrelated health detail', tags: ['health'] }
        ]
      })
    }));

    const result = await executeCavalryAssistantTool(
      { name: 'list_memory_items', arguments: {} },
      { advisor: port, question: 'What do you remember about my travel budget?' }
    );
    const items = result.data.memory.items;
    const returnedTextCharacters = items.reduce(
      (total, item) =>
        total +
        [item.id, item.text, ...item.tags, item.scope, item.createdAt, item.updatedAt].reduce(
          (itemTotal, value) => itemTotal + String(value || '').length,
          0
        ),
      0
    );

    expect(result).toMatchObject({
      ok: true,
      data: { memory: { limited: true } }
    });
    expect(items.length).toBeLessThanOrEqual(8);
    expect(returnedTextCharacters).toBeLessThanOrEqual(6_000);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => longTravelItems.some((source) => source.text === item.text))).toBe(
      true
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE unrelated health detail');
  });

  it('binds a reviewed remember proposal to a revision and returns a durable receipt', async () => {
    const port = advisor(async (command, payload) => {
      if (command === 'getMemory') return { ok: true, memory: memory() };
      expect(command).toBe('createMemoryItem');
      expect(payload).toEqual({
        expectedRevision: 'revision-1',
        item: { text: 'My emergency fund comes first', tags: ['priority'] }
      });
      return {
        ok: true,
        memory: memory({
          revision: 'revision-2',
          items: [
            {
              id: 'memory_item_1',
              text: 'My emergency fund comes first',
              tags: ['priority']
            }
          ]
        })
      };
    });

    const proposal = await executeCavalryAssistantTool(
      {
        name: 'remember_memory',
        arguments: { text: 'My emergency fund comes first', tags: ['priority'] }
      },
      { advisor: port, question: 'Remember that my emergency fund comes first' }
    );
    expect(proposal).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      lifecycle: 'awaiting_confirmation',
      confirmation: {
        required: true,
        proposal: {
          arguments: {
            text: 'My emergency fund comes first',
            tags: ['priority'],
            expectedRevision: 'revision-1'
          }
        }
      }
    });

    const committed = await executeCavalryAssistantTool(
      {
        name: 'remember_memory',
        arguments: {
          ...proposal.confirmation.proposal.arguments,
          confirmed: true
        }
      },
      { advisor: port, approvedByUser: true }
    );
    expect(committed).toMatchObject({
      ok: true,
      status: 'completed',
      lifecycle: 'completed',
      changed: true,
      commitStatus: 'committed',
      verificationStatus: 'verified',
      persistence: { status: 'saved', durable: true, revision: 'revision-2' },
      receipt: {
        lifecycle: 'completed',
        entity: { id: 'memory_item_1', label: 'My emergency fund comes first' }
      }
    });
  });

  it('does not propose or write chat memory actions while the user setting is disabled', async () => {
    const port = advisor(async () => ({
      ok: true,
      memory: memory({ allowAutomaticMemory: false })
    }));

    const result = await executeCavalryAssistantTool(
      { name: 'remember_memory', arguments: { text: 'Never silently save this' } },
      { advisor: port, question: 'Remember that I never want silent saves' }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      errors: [expect.objectContaining({ code: 'memory_chat_updates_disabled' })]
    });
    expect(port.invoke).toHaveBeenCalledTimes(1);
    expect(port.invoke).toHaveBeenCalledWith('getMemory', undefined);
  });

  it('does not duplicate an existing memory and preserves tags on a text-only edit', async () => {
    const existing = {
      id: 'memory_item_1',
      text: 'Use concise replies',
      tags: ['style']
    };
    const port = advisor(async (command, payload) => {
      if (command === 'getMemory') {
        return { ok: true, memory: memory({ items: [existing] }) };
      }
      expect(command).toBe('updateMemoryItem');
      expect(payload).toEqual({
        expectedRevision: 'revision-1',
        itemId: 'memory_item_1',
        item: { text: 'Use very concise replies', tags: ['style'] }
      });
      return {
        ok: true,
        memory: memory({
          revision: 'revision-2',
          items: [{ ...existing, text: 'Use very concise replies' }]
        })
      };
    });

    const duplicate = await executeCavalryAssistantTool(
      { name: 'remember_memory', arguments: { text: 'use concise replies' } },
      { advisor: port, question: 'Remember that I prefer concise replies' }
    );
    expect(duplicate).toMatchObject({
      ok: true,
      status: 'unchanged',
      changed: false,
      data: { action: 'already_present', memory: { id: 'memory_item_1' } }
    });

    const proposal = await executeCavalryAssistantTool(
      {
        name: 'update_memory_item',
        arguments: { id: 'memory_item_1', text: 'Use very concise replies' }
      },
      { advisor: port, question: 'Update my remembered preference to very concise replies' }
    );
    expect(proposal.confirmation.proposal.arguments).toEqual({
      id: 'memory_item_1',
      text: 'Use very concise replies',
      tags: ['style'],
      expectedRevision: 'revision-1'
    });

    const committed = await executeCavalryAssistantTool(
      {
        name: 'update_memory_item',
        arguments: { ...proposal.confirmation.proposal.arguments, confirmed: true }
      },
      { advisor: port, approvedByUser: true }
    );
    expect(committed).toMatchObject({
      ok: true,
      changed: true,
      data: { action: 'updated', memory: { tags: ['style'] } }
    });
  });

  it('ignores approval flags unless the application marks the call user-approved', async () => {
    const port = advisor(async (command) => {
      expect(command).toBe('getMemory');
      return { ok: true, memory: memory({ empty: false }) };
    });

    const result = await executeCavalryAssistantTool(
      {
        name: 'clear_memory',
        arguments: { expectedRevision: 'revision-1', confirmed: true }
      },
      { advisor: port, question: 'Clear all my memories' }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      lifecycle: 'awaiting_confirmation'
    });
    expect(port.invoke).toHaveBeenCalledTimes(1);
  });

  it('surfaces external-edit conflicts and leaves the write unconfirmed', async () => {
    const port = advisor(async (command) => {
      if (command === 'getMemory') return { ok: true, memory: memory() };
      return {
        ok: false,
        conflict: true,
        code: 'ADVISOR_MEMORY_REVISION_CONFLICT',
        error: 'memory.md changed outside Cavalry. Reload before saving.',
        memory: memory({ revision: 'revision-2' })
      };
    });

    const result = await executeCavalryAssistantTool(
      {
        name: 'clear_memory',
        arguments: { expectedRevision: 'revision-1', confirmed: true }
      },
      { advisor: port, approvedByUser: true }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'conflict',
      changed: false,
      commitStatus: 'not_committed',
      errors: [expect.objectContaining({ code: 'advisor_memory_revision_conflict' })],
      data: { memory: { revision: 'revision-2' } }
    });
  });
});
