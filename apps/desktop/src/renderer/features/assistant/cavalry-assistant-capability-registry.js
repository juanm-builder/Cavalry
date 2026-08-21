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

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(asObject(value), key);
}

function capabilityError(message) {
  return new Error(`Invalid Cavalry assistant capability: ${message}`);
}

const RESERVED_HOST_APPROVAL_FIELDS = Object.freeze([
  'confirmed',
  'allowDuplicate',
  'allowCurrencyConversion'
]);

const ACCESS_MODES = new Set(['read', 'write']);
const CONFIRMATION_MODES = new Set(['none', 'conditional', 'always']);
const NORMALIZED_CAPABILITIES = new WeakSet();

const DEFAULT_ACTION_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    status: { type: 'string' },
    changed: { type: 'boolean' },
    data: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
    receipt: { type: ['object', 'null'] },
    warnings: { type: 'array' },
    errors: { type: 'array' }
  },
  required: ['ok', 'status', 'changed'],
  additionalProperties: true
});

function normalizeVersion(value, fallback = '1') {
  const version = asText(value) || fallback;
  if (!/^[0-9]+(?:\.[0-9]+){0,2}(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) {
    throw capabilityError(`version “${version}” is not a supported compatibility identifier.`);
  }
  return version;
}

function normalizeAccess(value, approvalFields, actionVerb) {
  const access = asText(value).toLowerCase();
  if (access && !ACCESS_MODES.has(access)) {
    throw capabilityError(`access must be either “read” or “write”, not “${access}”.`);
  }
  return access || (approvalFields.length || actionVerb ? 'write' : 'read');
}

function normalizeConfirmation(value, approvalFields) {
  const source = typeof value === 'string' ? { mode: value } : asObject(value);
  const fallbackMode = approvalFields.length ? 'conditional' : 'none';
  const mode = asText(source.mode || fallbackMode).toLowerCase();
  if (!CONFIRMATION_MODES.has(mode)) {
    throw capabilityError(`confirmation.mode must be none, conditional, or always, not “${mode}”.`);
  }
  return Object.freeze({
    mode,
    fields: Object.freeze([...approvalFields]),
    description: asText(source.description)
  });
}

function normalizeEntityRequirements(value) {
  return Object.freeze(
    asArray(value).map((requirement) => {
      if (typeof requirement === 'string') {
        const type = asText(requirement);
        if (!type) throw capabilityError('entityRequirements must not contain empty values.');
        return Object.freeze({ type, required: true });
      }
      const source = asObject(requirement);
      const type = asText(source.type || source.entity);
      if (!type) throw capabilityError('entityRequirements entries require a type.');
      return Object.freeze({
        type,
        role: asText(source.role),
        required: source.required !== false,
        ambiguity: asText(source.ambiguity) || 'clarify'
      });
    })
  );
}

function versionParts(value) {
  return asText(value)
    .split(/[+-]/, 1)[0]
    .split('.')
    .map((part) => Number(part) || 0);
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function normalizeCompatibility(value, fallback = {}) {
  const source = { ...asObject(fallback), ...asObject(value) };
  const minimumAppVersion = asText(source.minimumAppVersion);
  const maximumAppVersion = asText(source.maximumAppVersion);
  if (minimumAppVersion) normalizeVersion(minimumAppVersion);
  if (maximumAppVersion) normalizeVersion(maximumAppVersion);
  if (
    minimumAppVersion &&
    maximumAppVersion &&
    compareVersions(minimumAppVersion, maximumAppVersion) > 0
  ) {
    throw capabilityError('compatibility minimumAppVersion cannot exceed maximumAppVersion.');
  }
  return Object.freeze({
    minimumAppVersion,
    maximumAppVersion,
    workbookSchema: asText(source.workbookSchema)
  });
}

function availabilityEvaluator(value) {
  if (typeof value === 'function') return value;
  const available = value !== false;
  return () => available;
}

function safeAvailability(entry, context = {}) {
  if (entry.deprecated) return false;
  try {
    return entry.isAvailable(context) !== false;
  } catch (_error) {
    return false;
  }
}

function validationFailure(name, environment, validation) {
  if (validation == null || validation === true || validation.ok === true) return null;
  const source = asObject(validation);
  const rawErrors = asArray(source.errors).length
    ? asArray(source.errors)
    : [
        {
          code: asText(source.code) || 'invalid_arguments',
          message: asText(source.message) || `The arguments for ${name} are invalid.`
        }
      ];
  return {
    ok: false,
    status: 'validation_failed',
    changed: false,
    toolName: name,
    toolCallId: asText(environment?.toolCallId),
    errors: rawErrors.map((error) => ({
      code: asText(error?.code) || 'invalid_arguments',
      message: asText(error?.message || error) || `The arguments for ${name} are invalid.`,
      ...(asText(error?.field) ? { field: asText(error.field) } : {})
    })),
    warnings: []
  };
}

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

function normalizedHostInputFields(value, approvalFields) {
  const fields = [...approvalFields, ...asArray(value).map(asText).filter(Boolean)];
  const unique = [...new Set(fields)];
  unique.forEach((field) => {
    if (!/^[a-z][a-zA-Z0-9]*(?:\[\])?(?:\.[a-z][a-zA-Z0-9]*(?:\[\])?)*$/.test(field)) {
      throw capabilityError(`host input field “${field}” is not a safe schema path.`);
    }
  });
  return unique;
}

function validatedToolDefinition(value, id, index, expectedName = '') {
  const definition = asObject(value);
  const name = asText(definition.name);
  if (!name) throw capabilityError(`${id}.tools[${index}] is missing definition.name.`);
  if (expectedName && name !== expectedName) {
    throw capabilityError(
      `${id}.${expectedName} returned a dynamic schema for a different tool name (“${name}”).`
    );
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw capabilityError(
      `${id}.${name} must use a provider-compatible function name (1-64 letters, numbers, underscores, or hyphens).`
    );
  }
  if (definition.type !== 'function') {
    throw capabilityError(`${id}.${name} must use a function definition.`);
  }
  validateSchemaShape(definition.parameters, `${id}.${name}.parameters`);
  if (asText(asObject(definition.parameters).type) !== 'object') {
    throw capabilityError(`${id}.${name}.parameters must describe an object.`);
  }
  return definition;
}

function schemaTypeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object')
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

const SCHEMA_TYPES = new Set(['null', 'array', 'object', 'integer', 'number', 'string', 'boolean']);

function validateSchemaShape(schemaValue, label) {
  const schema = asObject(schemaValue);
  if (schemaValue == null || typeof schemaValue !== 'object' || Array.isArray(schemaValue)) {
    throw capabilityError(`${label} must be a JSON schema object.`);
  }
  const types = asArray(schema.type).length
    ? asArray(schema.type).map(asText).filter(Boolean)
    : asText(schema.type)
      ? [asText(schema.type)]
      : [];
  if (types.some((type) => !SCHEMA_TYPES.has(type))) {
    throw capabilityError(`${label} contains an unsupported JSON schema type.`);
  }
  if (new Set(types).size !== types.length) {
    throw capabilityError(`${label} contains duplicate JSON schema types.`);
  }
  const properties = asObject(schema.properties);
  Object.entries(properties).forEach(([field, child]) => {
    validateSchemaShape(child, `${label}.properties.${field}`);
  });
  const required = asArray(schema.required).map(asText).filter(Boolean);
  if (new Set(required).size !== required.length) {
    throw capabilityError(`${label}.required must not contain duplicates.`);
  }
  required.forEach((field) => {
    if (!hasOwn(properties, field)) {
      throw capabilityError(`${label}.required references missing property “${field}”.`);
    }
  });
  if (schema.items) validateSchemaShape(schema.items, `${label}.items`);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    validateSchemaShape(schema.additionalProperties, `${label}.additionalProperties`);
  }
}

function validateSchemaValue(value, schemaValue, path = '$', options = {}) {
  const schema = asObject(schemaValue);
  const errors = [];
  const structureOnly = options.structureOnly === true;
  const declaredTypes = asArray(schema.type).length
    ? asArray(schema.type).map(asText).filter(Boolean)
    : asText(schema.type)
      ? [asText(schema.type)]
      : [];
  if (declaredTypes.length && !declaredTypes.some((type) => schemaTypeMatches(value, type))) {
    errors.push(`${path} must be ${declaredTypes.join(' or ')}`);
    return errors;
  }
  if (
    !structureOnly &&
    asArray(schema.enum).length &&
    !asArray(schema.enum).some((item) => Object.is(item, value))
  ) {
    errors.push(`${path} must be one of the declared values`);
  }
  if (!structureOnly && typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${path} must contain at least ${schema.minLength} characters`);
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      errors.push(`${path} must contain at most ${schema.maxLength} characters`);
    }
    if (asText(schema.pattern)) {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} has an invalid format`);
      } catch (_error) {
        errors.push(`${path} uses an invalid schema pattern`);
      }
    }
  }
  if (!structureOnly && typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}`);
    }
    if (Number.isFinite(schema.maximum) && value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (!structureOnly && Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} items`);
    }
    if (!structureOnly && Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateSchemaValue(item, schema.items, `${path}[${index}]`, options));
      });
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = asObject(schema.properties);
    if (!structureOnly) {
      asArray(schema.required)
        .map(asText)
        .filter(Boolean)
        .forEach((field) => {
          if (!hasOwn(value, field)) errors.push(`${path}.${field} is required`);
        });
    }
    Object.entries(value).forEach(([field, child]) => {
      if (hasOwn(properties, field)) {
        errors.push(...validateSchemaValue(child, properties[field], `${path}.${field}`, options));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${field} is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(
          ...validateSchemaValue(child, schema.additionalProperties, `${path}.${field}`, options)
        );
      }
    });
  }
  return errors;
}

function removeSchemaPath(schemaValue, pathValue) {
  const segments = asText(pathValue).replace(/\[\]/g, '').split('.').filter(Boolean);
  const visit = (schema, index) => {
    if (!schema || index >= segments.length) return;
    const target = schema.type === 'array' ? schema.items : schema;
    const properties = asObject(target?.properties);
    const field = segments[index];
    if (index === segments.length - 1) {
      delete properties[field];
      target.properties = properties;
      target.required = asArray(target.required).filter((item) => asText(item) !== field);
      return;
    }
    visit(properties[field], index + 1);
  };
  visit(schemaValue, 0);
}

function modelFacingDefinition(definitionValue, hostInputFields) {
  const definition = copyPlain(definitionValue);
  const parameters = asObject(definition.parameters);
  definition.parameters = { ...parameters, properties: { ...asObject(parameters.properties) } };
  asArray(hostInputFields).forEach((field) => removeSchemaPath(definition.parameters, field));
  return definition;
}

function schemaContainsPath(schemaValue, pathValue) {
  const segments = asText(pathValue).replace(/\[\]/g, '').split('.').filter(Boolean);
  let schema = schemaValue;
  for (const field of segments) {
    const target = schema?.type === 'array' ? schema.items : schema;
    const properties = asObject(target?.properties);
    if (!hasOwn(properties, field)) return false;
    schema = properties[field];
  }
  return true;
}

function validateHostInputSchema(definition, id, name, hostInputFields) {
  asArray(hostInputFields).forEach((field) => {
    if (!schemaContainsPath(definition.parameters, field)) {
      throw capabilityError(`${id}.${name} host input field “${field}” is absent from its schema.`);
    }
  });
}

function safePersistence(value) {
  const source = asObject(value);
  const projected = {};
  ['status', 'revision', 'savedAt', 'verifiedAt'].forEach((field) => {
    if (asText(source[field])) projected[field] = asText(source[field]);
  });
  if (typeof source.durable === 'boolean') projected.durable = source.durable;
  return Object.keys(projected).length ? projected : null;
}

function contractFailure(name, environment, phase, errors, resultValue = {}) {
  const input = phase === 'input';
  const result = asObject(resultValue);
  const commitStatus = asText(result.commitStatus || result.commit_status).toLowerCase();
  const persistence = safePersistence(result.persistence);
  return {
    ok: false,
    status: input ? 'validation_failed' : 'capability_contract_failed',
    changed: input ? false : result.changed === true,
    toolName: name,
    toolCallId: asText(environment?.toolCallId),
    ...(!input
      ? {
          commitStatus: commitStatus || 'unknown',
          verificationStatus: commitStatus === 'committed' ? 'failed' : 'unknown',
          ...(persistence ? { persistence } : {})
        }
      : {}),
    errors: asArray(errors)
      .slice(0, 12)
      .map((message) => ({
        code: input ? 'invalid_tool_arguments' : 'invalid_tool_result',
        message: `${input ? 'Input' : 'Output'} contract violation: ${asText(message)}`
      })),
    warnings: []
  };
}

function validateApprovalSchema(definition, id, name, approvalFields) {
  const properties = asObject(asObject(definition.parameters).properties);
  const undeclaredHostFields = RESERVED_HOST_APPROVAL_FIELDS.filter(
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
    const types = asArray(asObject(properties[field]).type).length
      ? asArray(asObject(properties[field]).type).map(asText)
      : [asText(asObject(properties[field]).type)];
    if (!types.includes('boolean')) {
      throw capabilityError(`${id}.${name} approval field “${field}” must be boolean.`);
    }
  });
}

export function defineCavalryAssistantCapability(provider) {
  const source = asObject(provider);
  const id = asText(source.id);
  if (!id || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) {
    throw capabilityError('provider id is required and must be a stable lowercase identifier.');
  }
  const providerVersion = normalizeVersion(source.version, '1');
  const providerCompatibility = normalizeCompatibility(source.compatibility);
  const tools = asArray(source.tools).map((entry, index) => {
    const tool = asObject(entry);
    const definitionFactory =
      typeof tool.definition === 'function'
        ? tool.definition
        : typeof tool.getDefinition === 'function'
          ? tool.getDefinition
          : () => tool.definition;
    const definition = validatedToolDefinition(definitionFactory({}), id, index);
    const name = asText(definition.name);
    if (typeof tool.execute !== 'function') {
      throw capabilityError(`${id}.${name} is missing an execute handler.`);
    }
    const approvalFields = normalizedApprovalFields(tool.approvalFields);
    const hostInputFields = normalizedHostInputFields(tool.hostInputFields, approvalFields);
    validateApprovalSchema(definition, id, name, approvalFields);
    validateHostInputSchema(definition, id, name, hostInputFields);
    const getDefinition = (context = {}) => {
      const resolved = validatedToolDefinition(definitionFactory(context), id, index, name);
      validateApprovalSchema(resolved, id, name, approvalFields);
      validateHostInputSchema(resolved, id, name, hostInputFields);
      return copyPlain(resolved);
    };
    const actionVerb = asText(tool.actionVerb);
    const access = normalizeAccess(tool.access || source.access, approvalFields, actionVerb);
    const actionId = asText(tool.actionId) || `${id}.${name}`;
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(actionId)) {
      throw capabilityError(`${id}.${name} has an invalid stable actionId “${actionId}”.`);
    }
    const deprecated = tool.deprecated === true;
    const confirmation = normalizeConfirmation(tool.confirmation, approvalFields);
    if (access === 'read' && confirmation.mode !== 'none') {
      throw capabilityError(`${id}.${name} is read-only but declares confirmation.`);
    }
    if (confirmation.mode === 'none' && approvalFields.length) {
      throw capabilityError(
        `${id}.${name} declares approval fields but confirmation.mode is none.`
      );
    }
    if (confirmation.mode !== 'none' && !approvalFields.length) {
      throw capabilityError(`${id}.${name} declares confirmation without an approval field.`);
    }
    if (access === 'read' && actionVerb) {
      throw capabilityError(`${id}.${name} is read-only but declares an action verb.`);
    }
    const outputSchema = Object.freeze(
      copyPlain(tool.outputSchema || DEFAULT_ACTION_OUTPUT_SCHEMA)
    );
    validateSchemaShape(outputSchema, `${id}.${name}.outputSchema`);
    const outputTypes = asArray(outputSchema.type).length
      ? asArray(outputSchema.type).map(asText)
      : [asText(outputSchema.type)];
    if (!outputTypes.includes('object')) {
      throw capabilityError(`${id}.${name} outputSchema must describe an object result.`);
    }
    const inputValidation = asText(tool.inputValidation || source.inputValidation) || 'schema';
    if (!['schema', 'structure'].includes(inputValidation)) {
      throw capabilityError(`${id}.${name} inputValidation must be schema or structure.`);
    }
    return Object.freeze({
      definition: Object.freeze(copyPlain(definition)),
      getDefinition,
      execute: tool.execute,
      validate: typeof tool.validate === 'function' ? tool.validate : null,
      present: typeof tool.present === 'function' ? tool.present : null,
      approvalFields: Object.freeze(approvalFields),
      hostInputFields: Object.freeze(hostInputFields),
      inputValidation,
      actionVerb,
      actionId,
      title: asText(tool.title) || asText(definition.description).split(/[.!?]/)[0] || name,
      access,
      outputSchema,
      entityRequirements: normalizeEntityRequirements(tool.entityRequirements),
      confirmation,
      requiresWorkbook: Object.prototype.hasOwnProperty.call(tool, 'requiresWorkbook')
        ? tool.requiresWorkbook !== false
        : source.requiresWorkbook !== false,
      atomicity: asText(tool.atomicity) || (access === 'write' ? 'single-workbook-commit' : 'none'),
      idempotency:
        asText(tool.idempotency) || (access === 'write' ? 'tool-call' : 'not-applicable'),
      version: normalizeVersion(tool.version, providerVersion),
      compatibility: normalizeCompatibility(tool.compatibility, providerCompatibility),
      deprecated,
      deprecationMessage: asText(tool.deprecationMessage),
      isAvailable: availabilityEvaluator(tool.availability)
    });
  });
  if (!tools.length) throw capabilityError(`${id} must expose at least one tool.`);
  const normalized = Object.freeze({
    id,
    title: asText(source.title) || id,
    description: asText(source.description),
    instructions: asText(source.instructions),
    version: providerVersion,
    compatibility: providerCompatibility,
    tools: Object.freeze(tools)
  });
  NORMALIZED_CAPABILITIES.add(normalized);
  return normalized;
}

export function createCavalryAssistantCapabilityRegistry(providers) {
  const normalizedProviders = asArray(providers)
    .map((provider) =>
      NORMALIZED_CAPABILITIES.has(provider) ? provider : defineCavalryAssistantCapability(provider)
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const providerIds = new Set();
  const actionIds = new Set();
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
      if (actionIds.has(tool.actionId)) {
        throw capabilityError(`actionId “${tool.actionId}” is registered more than once.`);
      }
      actionIds.add(tool.actionId);
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
  const definitionsFor = (context = {}) =>
    Array.from(entries.values())
      .filter((entry) => safeAvailability(entry, context))
      .map((entry) =>
        Object.freeze({
          ...modelFacingDefinition(entry.getDefinition(context), entry.hostInputFields),
          cavalry: Object.freeze({
            capabilityId: entry.providerId,
            capabilityTitle: entry.capabilityTitle,
            instructions: entry.capabilityInstructions,
            approvalFields: Object.freeze([...entry.approvalFields]),
            inputValidation: entry.inputValidation,
            registrations: Object.freeze({
              executor: true,
              validator: Boolean(entry.validate),
              presenter: Boolean(entry.present)
            }),
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
            deprecated: entry.deprecated
          })
        })
      );
  const manifestFor = (context = {}) =>
    normalizedProviders.map((provider) => {
      const actions = provider.tools.map((tool) => {
        const available = safeAvailability(tool, context);
        const definition = modelFacingDefinition(tool.getDefinition(context), tool.hostInputFields);
        return Object.freeze({
          name: definition.name,
          actionId: tool.actionId,
          title: tool.title,
          description: definition.description,
          access: tool.access,
          inputSchema: definition.parameters,
          outputSchema: tool.outputSchema,
          entityRequirements: tool.entityRequirements,
          confirmation: tool.confirmation,
          inputValidation: tool.inputValidation,
          registrations: Object.freeze({
            executor: true,
            validator: Boolean(tool.validate),
            presenter: Boolean(tool.present)
          }),
          requiresWorkbook: tool.requiresWorkbook,
          atomicity: tool.atomicity,
          idempotency: tool.idempotency,
          version: tool.version,
          compatibility: tool.compatibility,
          available,
          deprecated: tool.deprecated,
          deprecationMessage: tool.deprecationMessage
        });
      });
      return Object.freeze({
        id: provider.id,
        title: provider.title,
        description: provider.description,
        instructions: provider.instructions,
        version: provider.version,
        compatibility: provider.compatibility,
        tools: Object.freeze(
          actions.filter((action) => action.available).map((action) => action.name)
        ),
        actions: Object.freeze(actions)
      });
    });
  return Object.freeze({
    has(name, context = {}) {
      const entry = entries.get(asText(name));
      return Boolean(entry && safeAvailability(entry, context));
    },
    entry(name) {
      return entries.get(asText(name)) || null;
    },
    async execute(name, environment = {}) {
      const entry = entries.get(asText(name));
      if (!entry) throw new Error(`Unknown Cavalry assistant tool: ${asText(name) || 'missing'}`);
      if (!safeAvailability(entry, environment?.context || environment)) {
        const error = new Error(`Cavalry assistant tool “${asText(name)}” is unavailable.`);
        error.code = entry.deprecated ? 'tool_deprecated' : 'tool_unavailable';
        throw error;
      }
      const trustedArguments = { ...asObject(environment.arguments) };
      if (asObject(environment.context).approvedByUser !== true) {
        entry.approvalFields.forEach((field) => {
          if (hasOwn(trustedArguments, field)) trustedArguments[field] = false;
        });
      }
      environment = { ...asObject(environment), arguments: trustedArguments };
      const inputErrors = validateSchemaValue(
        asObject(environment.arguments),
        asObject(entry.getDefinition(environment?.context || environment).parameters),
        '$',
        { structureOnly: entry.inputValidation === 'structure' }
      );
      if (inputErrors.length) {
        return contractFailure(asText(name), environment, 'input', inputErrors);
      }
      if (entry.validate) {
        const invalid = validationFailure(
          asText(name),
          environment,
          await entry.validate(environment.arguments || {}, environment)
        );
        if (invalid) return invalid;
      }
      const result = await entry.execute(environment);
      const presented =
        entry.present && result && typeof result === 'object'
          ? await entry.present(result, environment)
          : null;
      const output =
        presented && typeof presented === 'object'
          ? { ...result, receipt: copyPlain(presented) }
          : result;
      const outputErrors = validateSchemaValue(output, entry.outputSchema);
      return outputErrors.length
        ? contractFailure(asText(name), environment, 'output', outputErrors, output)
        : output;
    },
    getDefinitions(context = {}) {
      return copyPlain(definitionsFor(context));
    },
    getManifest(context = {}) {
      return copyPlain(manifestFor(context));
    }
  });
}
