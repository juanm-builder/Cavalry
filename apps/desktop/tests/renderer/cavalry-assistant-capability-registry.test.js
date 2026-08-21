import { describe, expect, it, vi } from 'vitest';

import {
  createCavalryAssistantCapabilityRegistry,
  defineCavalryAssistantCapability
} from '../../src/renderer/features/assistant/cavalry-assistant-capability-registry.js';
import {
  executeCavalryAssistantTool,
  getCavalryAssistantCapabilityManifest,
  getCavalryAssistantToolDefinitions,
  getCavalryAssistantToolMetadata
} from '../../src/renderer/features/assistant/cavalry-assistant-tools.js';

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
    const execute = vi.fn(async (environment) => ({
      ok: true,
      status: 'completed',
      changed: false,
      data: {
        value: environment.arguments.value,
        approved: environment.arguments.approved === true
      }
    }));
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
    expect(registry.getDefinitions()[0].parameters.properties).not.toHaveProperty('approved');
    await expect(
      registry.execute('example_action', { arguments: { value: 'ok' } })
    ).resolves.toMatchObject({ ok: true, data: { value: 'ok' } });
    await expect(
      registry.execute('example_action', {
        arguments: { approved: true, value: 'untrusted' }
      })
    ).resolves.toMatchObject({ ok: true, data: { approved: false } });
    await expect(
      registry.execute('example_action', {
        arguments: { approved: true, value: 'trusted' },
        context: { approvedByUser: true }
      })
    ).resolves.toMatchObject({ ok: true, data: { approved: true } });
    expect(execute).toHaveBeenCalledTimes(3);
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
      createCavalryAssistantCapabilityRegistry([
        {
          id: 'one',
          tools: [
            { definition: definition('first_tool'), actionId: 'shared.action', execute: vi.fn() }
          ]
        },
        {
          id: 'two',
          tools: [
            { definition: definition('second_tool'), actionId: 'shared.action', execute: vi.fn() }
          ]
        }
      ])
    ).toThrow(/actionId.*shared\.action.*more than once/i);
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
    expect(() =>
      defineCavalryAssistantCapability({
        id: 'missing.approval',
        tools: [
          {
            definition: definition('unsafe_confirmation'),
            execute: vi.fn(),
            access: 'write',
            confirmation: { mode: 'always' }
          }
        ]
      })
    ).toThrow(/confirmation without an approval field/i);
    expect(() =>
      defineCavalryAssistantCapability({
        id: 'invalid.compatibility',
        compatibility: { minimumAppVersion: '3.0.0', maximumAppVersion: '2.1.0' },
        tools: [{ definition: definition('future_tool'), execute: vi.fn() }]
      })
    ).toThrow(/minimumAppVersion cannot exceed maximumAppVersion/i);
    expect(() =>
      defineCavalryAssistantCapability({
        id: 'invalid.schema',
        tools: [
          {
            definition: {
              ...definition('broken_schema'),
              parameters: {
                type: 'object',
                properties: {},
                required: ['missing'],
                additionalProperties: false
              }
            },
            execute: vi.fn()
          }
        ]
      })
    ).toThrow(/required references missing property/i);
  });

  it('enforces input and output contracts without erasing a durable commit claim', async () => {
    const execute = vi.fn(async () => ({
      ok: 'not-a-boolean',
      status: 'completed',
      changed: true,
      commitStatus: 'committed',
      verificationStatus: 'verified',
      persistence: { status: 'saved', durable: true, revision: 'revision-2', path: '/private' }
    }));
    const registry = createCavalryAssistantCapabilityRegistry([
      {
        id: 'contract.feature',
        tools: [
          {
            definition: {
              ...definition('contract_action'),
              parameters: {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: ['value'],
                additionalProperties: false
              }
            },
            execute
          }
        ]
      }
    ]);

    await expect(
      registry.execute('contract_action', { arguments: { unexpected: true } })
    ).resolves.toMatchObject({
      ok: false,
      status: 'validation_failed',
      changed: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: 'invalid_tool_arguments' })])
    });
    expect(execute).not.toHaveBeenCalled();

    await expect(
      registry.execute('contract_action', { arguments: { value: 'run' } })
    ).resolves.toMatchObject({
      ok: false,
      status: 'capability_contract_failed',
      changed: true,
      commitStatus: 'committed',
      verificationStatus: 'failed',
      persistence: { status: 'saved', durable: true, revision: 'revision-2' },
      errors: [expect.objectContaining({ code: 'invalid_tool_result' })]
    });
  });

  it('resolves feature-owned schemas dynamically without changing the registry wiring', () => {
    let description = 'Initial application contract';
    const registry = createCavalryAssistantCapabilityRegistry([
      defineCavalryAssistantCapability({
        id: 'dynamic.feature',
        tools: [
          {
            definition: () => ({
              ...definition('dynamic_action'),
              description
            }),
            execute: vi.fn()
          }
        ]
      })
    ]);

    description = 'Updated application contract';

    expect(registry.getDefinitions()[0].description).toBe('Updated application contract');
    expect(registry).not.toHaveProperty('definitions');
    expect(registry).not.toHaveProperty('manifest');
  });

  it('derives lifecycle metadata and removes unavailable or deprecated actions from exposure', async () => {
    let available = true;
    const execute = vi.fn(async () => ({ ok: true, status: 'completed', changed: true }));
    const registry = createCavalryAssistantCapabilityRegistry([
      {
        id: 'accounts.routing',
        version: '2.1.0',
        tools: [
          {
            actionId: 'accounts.routing.assign',
            title: 'Assign an account',
            definition: definition('assign_account'),
            execute,
            access: 'write',
            entityRequirements: [{ type: 'account', role: 'destination' }],
            confirmation: { mode: 'none' },
            availability: () => available,
            atomicity: 'single-workbook-commit',
            idempotency: 'operation-key',
            outputSchema: {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
              required: ['ok']
            }
          },
          {
            definition: definition('retired_action'),
            execute: vi.fn(),
            deprecated: true,
            deprecationMessage: 'Use assign_account instead.'
          }
        ]
      }
    ]);

    expect(registry.getDefinitions()).toHaveLength(1);
    expect(registry.getDefinitions()[0].cavalry).toMatchObject({
      actionId: 'accounts.routing.assign',
      title: 'Assign an account',
      access: 'write',
      entityRequirements: [{ type: 'account', role: 'destination', required: true }],
      confirmation: { mode: 'none' },
      atomicity: 'single-workbook-commit',
      idempotency: 'operation-key',
      version: '2.1.0',
      deprecated: false
    });
    expect(registry.getManifest()[0]).toMatchObject({
      tools: ['assign_account'],
      actions: [
        expect.objectContaining({ name: 'assign_account', available: true }),
        expect.objectContaining({ name: 'retired_action', available: false, deprecated: true })
      ]
    });

    available = false;
    expect(registry.getDefinitions()).toEqual([]);
    expect(registry.getManifest()[0].actions[0]).toMatchObject({ available: false });
    expect(registry.has('assign_account')).toBe(false);
    await expect(registry.execute('assign_account')).rejects.toMatchObject({
      code: 'tool_unavailable'
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('auto-discovers feature-owned refund tools without a central schema or handler edit', async () => {
    const definitions = getCavalryAssistantToolDefinitions();
    const manifest = getCavalryAssistantCapabilityManifest();

    expect(definitions.map((tool) => tool.name).sort()).toEqual(
      manifest.flatMap((capability) => capability.tools).sort()
    );
    expect(definitions.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['create_refund', 'search_refunds'])
    );
    expect(manifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'budgets.planning',
          tools: ['read_budgets', 'set_budget', 'archive_budget']
        }),
        expect.objectContaining({
          id: 'transactions.ledger',
          tools: expect.arrayContaining([
            'create_transaction',
            'update_transaction',
            'replace_transaction',
            'create_refund',
            'search_refunds'
          ])
        })
      ])
    );
    const workspaceCapability = manifest.find((capability) => capability.id === 'cavalry.core');
    expect(workspaceCapability?.tools).toContain('read_workspace_context');
    expect(workspaceCapability?.tools).not.toEqual(
      expect.arrayContaining([
        'create_transaction',
        'update_transaction',
        'set_budget',
        'archive_budget'
      ])
    );
    expect(getCavalryAssistantToolMetadata('create_refund')).toMatchObject({
      capabilityId: 'transactions.ledger',
      approvalFields: ['allowDuplicate', 'allowCurrencyConversion'],
      actionVerb: 'Recorded refund for'
    });
    expect(
      manifest.find((capability) => capability.id === 'transactions.ledger')?.actions[0]
        ?.registrations
    ).toEqual({ executor: true, validator: false, presenter: false });
    const unsupported = await executeCavalryAssistantTool(
      { name: 'feature_not_registered', arguments: {} },
      { getWorkbook: () => ({}) }
    );
    expect(unsupported).toMatchObject({ ok: false, status: 'unsupported_tool' });
  });
});
