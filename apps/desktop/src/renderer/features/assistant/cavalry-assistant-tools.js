import { createCavalryAssistantCapabilityRegistry } from './cavalry-assistant-capability-registry.js';
import { asObject, asText } from './cavalry-assistant-tool-definitions.js';
import { failure, toolCallParts } from './cavalry-assistant-tool-support.js';
import { normalizeCavalryAssistantActionResult } from './cavalry-assistant-action-results.js';

const FEATURE_CAPABILITY_MODULES = import.meta.glob('../*/cavalry-assistant-capability.js', {
  eager: true
});

const FEATURE_CAPABILITY_PROVIDERS = Object.entries(FEATURE_CAPABILITY_MODULES).map(
  ([source, module]) => {
    const provider = asObject(module).default;
    if (!provider) {
      throw new Error(`Cavalry assistant capability module “${source}” has no default export.`);
    }
    return provider;
  }
);

const CAVALRY_ASSISTANT_CAPABILITY_REGISTRY = createCavalryAssistantCapabilityRegistry(
  FEATURE_CAPABILITY_PROVIDERS
);

export function getCavalryAssistantToolDefinitions(context = {}) {
  return CAVALRY_ASSISTANT_CAPABILITY_REGISTRY.getDefinitions(context);
}

export function getCavalryAssistantCapabilityManifest(context = {}) {
  return CAVALRY_ASSISTANT_CAPABILITY_REGISTRY.getManifest(context);
}

export function getCavalryAssistantToolMetadata(name, context = {}) {
  const entry = CAVALRY_ASSISTANT_CAPABILITY_REGISTRY.entry(name);
  if (!entry) return null;
  return {
    capabilityId: entry.providerId,
    capabilityTitle: entry.capabilityTitle,
    instructions: entry.capabilityInstructions,
    approvalFields: [...entry.approvalFields],
    inputValidation: entry.inputValidation,
    registrations: {
      executor: true,
      validator: Boolean(entry.validate),
      presenter: Boolean(entry.present)
    },
    actionVerb: entry.actionVerb,
    actionId: entry.actionId,
    title: entry.title,
    access: entry.access,
    outputSchema: entry.outputSchema,
    entityRequirements: entry.entityRequirements,
    confirmation: entry.confirmation,
    requiresWorkbook: entry.requiresWorkbook,
    atomicity: entry.atomicity,
    idempotency: entry.idempotency,
    version: entry.version,
    compatibility: entry.compatibility,
    available: CAVALRY_ASSISTANT_CAPABILITY_REGISTRY.has(name, context),
    deprecated: entry.deprecated
  };
}

export async function executeCavalryAssistantTool(toolCall, context = {}) {
  const parsed = toolCallParts(toolCall);
  const entry = CAVALRY_ASSISTANT_CAPABILITY_REGISTRY.entry(parsed.name);
  const metadata = entry
    ? { ...getCavalryAssistantToolMetadata(parsed.name, context), toolName: parsed.name }
    : { toolName: parsed.name, access: 'write' };
  const finish = (result) => normalizeCavalryAssistantActionResult(result, metadata);
  const environment = {
    toolName: parsed.name,
    toolCallId: parsed.toolCallId,
    arguments: parsed.arguments,
    context: asObject(context),
    services: asObject(context.services),
    workbook: null
  };
  if (!parsed.name || !entry) {
    return finish(
      failure(
        environment,
        'unsupported_tool',
        'unsupported_tool',
        `Cavalry assistant tool “${parsed.name || 'missing'}” is not available.`
      )
    );
  }
  if (!CAVALRY_ASSISTANT_CAPABILITY_REGISTRY.has(parsed.name, context)) {
    return finish(
      failure(
        environment,
        entry.deprecated ? 'tool_deprecated' : 'tool_unavailable',
        entry.deprecated ? 'tool_deprecated' : 'tool_unavailable',
        entry.deprecationMessage || `Cavalry assistant tool “${parsed.name}” is unavailable.`
      )
    );
  }
  if (parsed.parseError) {
    return finish(
      failure(environment, 'invalid_arguments', 'invalid_tool_arguments', parsed.parseError)
    );
  }
  if (entry.requiresWorkbook) {
    if (typeof context.getWorkbook !== 'function') {
      return finish(
        failure(
          environment,
          'context_error',
          'workbook_reader_unavailable',
          'The assistant workbook reader is unavailable.'
        )
      );
    }
    try {
      environment.workbook = await context.getWorkbook();
    } catch (error) {
      return finish(
        failure(
          environment,
          'context_error',
          'workbook_read_failed',
          asText(error && error.message) || 'The current workbook could not be read.'
        )
      );
    }
    if (!environment.workbook || typeof environment.workbook !== 'object') {
      return finish(
        failure(
          environment,
          'workbook_required',
          'workbook_required',
          'Open a workbook before using Cavalry assistant tools.'
        )
      );
    }
  }
  try {
    return finish(await CAVALRY_ASSISTANT_CAPABILITY_REGISTRY.execute(parsed.name, environment));
  } catch (error) {
    return finish(
      failure(
        environment,
        'tool_failed',
        asText(error && error.code) || 'tool_failed',
        asText(error && error.message) || 'The assistant tool could not be completed.'
      )
    );
  }
}
