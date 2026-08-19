// Feature-facing contract for Cavalry's in-app AI capabilities. A feature owns its
// schemas and executors together; the assistant only composes and validates them.

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function copyPlain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function capabilityError(message) {
  return new Error(`Invalid Cavalry assistant capability: ${message}`);
}

const LEGACY_HOST_APPROVAL_FIELDS = Object.freeze([
  'confirmed',
  'allowDuplicate',
  'allowCurrencyConversion'
]);

function normalizedApprovalFields(value) {
  const fields = asArray(value).map(asText).filter(Boolean);
  if (new Set(fields).size !== fields.length) {
    throw capabilityError('approvalFields must not contain duplicates.');
  }
  fields.forEach((field) => {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(field)) {
      throw capabilityError(`approval field “${field}” is not a safe argument name.`);
    }
  });
  return fields;
}

export function defineCavalryAssistantCapability(provider) {
  const source = asObject(provider);
  const id = asText(source.id);
  if (!id || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) {
    throw capabilityError('provider id is required and must be a stable lowercase identifier.');
  }
  const tools = asArray(source.tools).map((entry, index) => {
    const tool = asObject(entry);
    const definition = asObject(tool.definition);
    const name = asText(definition.name);
    if (!name) throw capabilityError(`${id}.tools[${index}] is missing definition.name.`);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      throw capabilityError(
        `${id}.${name} must use a provider-compatible function name (1-64 letters, numbers, underscores, or hyphens).`
      );
    }
    if (definition.type !== 'function') {
      throw capabilityError(`${id}.${name} must use a function definition.`);
    }
    if (typeof tool.execute !== 'function') {
      throw capabilityError(`${id}.${name} is missing an execute handler.`);
    }
    const approvalFields = normalizedApprovalFields(tool.approvalFields);
    const properties = asObject(asObject(definition.parameters).properties);
    const undeclaredHostFields = LEGACY_HOST_APPROVAL_FIELDS.filter(
      (field) =>
        Object.prototype.hasOwnProperty.call(properties, field) && !approvalFields.includes(field)
    );
    if (undeclaredHostFields.length) {
      throw capabilityError(
        `${id}.${name} schema has undeclared host approval fields: ${undeclaredHostFields.join(', ')}.`
      );
    }
    approvalFields.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(properties, field)) {
        throw capabilityError(`${id}.${name} approval field “${field}” is absent from its schema.`);
      }
    });
    return Object.freeze({
      definition: Object.freeze(copyPlain(definition)),
      execute: tool.execute,
      approvalFields: Object.freeze(approvalFields),
      actionVerb: asText(tool.actionVerb)
    });
  });
  if (!tools.length) throw capabilityError(`${id} must expose at least one tool.`);
  return Object.freeze({
    id,
    title: asText(source.title) || id,
    description: asText(source.description),
    instructions: asText(source.instructions),
    tools: Object.freeze(tools)
  });
}

export function createCavalryAssistantCapabilityRegistry(providers) {
  const normalizedProviders = asArray(providers)
    .map(defineCavalryAssistantCapability)
    .sort((left, right) => left.id.localeCompare(right.id));
  const providerIds = new Set();
  const entries = new Map();
  normalizedProviders.forEach((provider) => {
    if (providerIds.has(provider.id)) {
      throw capabilityError(`provider id “${provider.id}” is registered more than once.`);
    }
    providerIds.add(provider.id);
    provider.tools.forEach((tool) => {
      const name = tool.definition.name;
      if (entries.has(name)) {
        throw capabilityError(`tool name “${name}” is registered more than once.`);
      }
      entries.set(
        name,
        Object.freeze({
          ...tool,
          providerId: provider.id,
          capabilityTitle: provider.title,
          capabilityInstructions: provider.instructions
        })
      );
    });
  });
  const definitions = Object.freeze(
    Array.from(entries.values()).map((entry) =>
      Object.freeze({
        ...copyPlain(entry.definition),
        cavalry: Object.freeze({
          capabilityId: entry.providerId,
          capabilityTitle: entry.capabilityTitle,
          instructions: entry.capabilityInstructions,
          approvalFields: Object.freeze([...entry.approvalFields]),
          actionVerb: entry.actionVerb
        })
      })
    )
  );
  const manifest = Object.freeze(
    normalizedProviders.map((provider) =>
      Object.freeze({
        id: provider.id,
        title: provider.title,
        description: provider.description,
        instructions: provider.instructions,
        tools: Object.freeze(provider.tools.map((tool) => tool.definition.name))
      })
    )
  );
  return Object.freeze({
    definitions,
    manifest,
    has(name) {
      return entries.has(asText(name));
    },
    entry(name) {
      return entries.get(asText(name)) || null;
    },
    execute(name, environment) {
      const entry = entries.get(asText(name));
      if (!entry) throw new Error(`Unknown Cavalry assistant tool: ${asText(name) || 'missing'}`);
      return entry.execute(environment);
    },
    getDefinitions() {
      return copyPlain(definitions);
    },
    getManifest() {
      return copyPlain(manifest);
    }
  });
}

export function capabilityProviderFromLegacyTools({
  id,
  title,
  description,
  definitions,
  handlers
}) {
  const definitionsValue = asArray(definitions);
  const handlersValue = asObject(handlers);
  const definitionNames = new Set(definitionsValue.map((definition) => asText(definition?.name)));
  const orphanHandlers = Object.keys(handlersValue).filter((name) => !definitionNames.has(name));
  if (orphanHandlers.length) {
    throw capabilityError(`${id} has handlers without schemas: ${orphanHandlers.join(', ')}.`);
  }
  return defineCavalryAssistantCapability({
    id,
    title,
    description,
    tools: definitionsValue.map((definition) => ({
      definition,
      execute: handlersValue[asText(definition?.name)],
      approvalFields: ['confirmed', 'allowDuplicate', 'allowCurrencyConversion'].filter((field) =>
        Object.prototype.hasOwnProperty.call(
          asObject(asObject(definition?.parameters).properties),
          field
        )
      )
    }))
  });
}
