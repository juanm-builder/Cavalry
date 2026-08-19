import { describe, expect, it, vi } from 'vitest';

import {
  createCavalryAssistantCapabilityRegistry,
  defineCavalryAssistantCapability
} from '../../src/renderer/features/assistant/cavalry-assistant-capability-registry.js';
import {
  CAVALRY_ASSISTANT_TOOLS,
  executeCavalryAssistantTool,
  getCavalryAssistantCapabilityManifest,
  getCavalryAssistantToolDefinitions,
  getCavalryAssistantToolMetadata
} from '../../src/renderer/features/assistant/cavalry-assistant-tools.js';
import { confirmedActionMessage } from '../../src/renderer/features/assistant/cavalry-assistant-confirmations.js';

function definition(name) {
  return {
    type: 'function',
    name,
    description: `${name} description`,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  };
}

describe('Cavalry assistant capability registry', () => {
  it('keeps a feature schema, executor, guidance, and approval policy in one entry', async () => {
    const execute = vi.fn(async (environment) => ({ value: environment.arguments.value }));
    const registry = createCavalryAssistantCapabilityRegistry([
      defineCavalryAssistantCapability({
        id: 'example.feature',
        title: 'Example feature',
        instructions: 'Use the example when it is relevant.',
        tools: [
          {
            definition: {
              ...definition('example_action'),
              parameters: {
                type: 'object',
                properties: { approved: { type: 'boolean' }, value: { type: 'string' } },
                additionalProperties: false
              }
            },
            execute,
            approvalFields: ['approved']
          }
        ]
      })
    ]);

    const exported = registry.getDefinitions();
    exported[0].description = 'mutated by caller';

    expect(registry.getDefinitions()[0]).toMatchObject({
      name: 'example_action',
      description: 'example_action description',
      cavalry: {
        capabilityId: 'example.feature',
        approvalFields: ['approved']
      }
    });
    await expect(
      registry.execute('example_action', { arguments: { value: 'ok' } })
    ).resolves.toEqual({ value: 'ok' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('fails fast for duplicate tool names and schema/handler drift', () => {
    const provider = (id) => ({
      id,
      tools: [{ definition: definition('same_tool'), execute: vi.fn() }]
    });

    expect(() =>
      createCavalryAssistantCapabilityRegistry([provider('one'), provider('two')])
    ).toThrow(/same_tool.*more than once/i);
    expect(() =>
      defineCavalryAssistantCapability({
        id: 'missing.handler',
        tools: [{ definition: definition('no_handler') }]
      })
    ).toThrow(/missing an execute handler/i);
    expect(() =>
      defineCavalryAssistantCapability({
        id: 'invalid.name',
        tools: [{ definition: definition('not a valid function name'), execute: vi.fn() }]
      })
    ).toThrow(/provider-compatible function name/i);
    expect(() =>
      defineCavalryAssistantCapability({
        id: 'undeclared.approval',
        tools: [
          {
            definition: {
              ...definition('unsafe_action'),
              parameters: {
                type: 'object',
                properties: { confirmed: { type: 'boolean' } },
                additionalProperties: false
              }
            },
            execute: vi.fn()
          }
        ]
      })
    ).toThrow(/undeclared host approval fields: confirmed/i);
  });

  it('auto-discovers feature-owned refund tools without a central schema or handler edit', async () => {
    const definitions = getCavalryAssistantToolDefinitions();
    const manifest = getCavalryAssistantCapabilityManifest();

    expect(definitions).toEqual(CAVALRY_ASSISTANT_TOOLS);
    expect(definitions.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['create_refund', 'search_refunds'])
    );
    expect(manifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'transactions.refunds',
          tools: ['create_refund', 'search_refunds']
        })
      ])
    );
    expect(getCavalryAssistantToolMetadata('create_refund')).toMatchObject({
      capabilityId: 'transactions.refunds',
      approvalFields: ['allowDuplicate', 'allowCurrencyConversion'],
      actionVerb: 'Recorded refund for'
    });
    expect(
      confirmedActionMessage('create_refund', {
        data: { transaction: { description: 'Groceries refund' } }
      })
    ).toBe('Recorded refund for “Groceries refund”.');

    const unsupported = await executeCavalryAssistantTool(
      { name: 'feature_not_registered', arguments: {} },
      { getWorkbook: () => ({}) }
    );
    expect(unsupported).toMatchObject({ ok: false, status: 'unsupported_tool' });
  });
});
