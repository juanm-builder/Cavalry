import { defineCavalryAssistantCapability } from '../assistant/cavalry-assistant-capability-registry.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function definition(name, description, properties = {}, required = []) {
  return {
    type: 'function',
    name,
    description,
    strict: false,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false
    }
  };
}

const CONFIRMED_PROPERTY = Object.freeze({
  type: 'boolean',
  description:
    'Host-controlled approval flag. Never set this from model output; Cavalry supplies it only after explicit user confirmation.'
});

const EXPECTED_REVISION_PROPERTY = Object.freeze({
  type: 'string',
  description:
    'Host-controlled memory.md revision captured with the reviewed proposal. Cavalry uses it to reject stale writes.'
});

const MEMORY_LOOKUP_LIMIT = 8;
const MEMORY_LOOKUP_TEXT_LIMIT = 6_000;
const MEMORY_QUERY_STOP_WORDS = new Set([
  'about',
  'all',
  'and',
  'are',
  'can',
  'companion',
  'cavalry',
  'do',
  'edit',
  'erase',
  'for',
  'forget',
  'forgot',
  'from',
  'have',
  'items',
  'know',
  'list',
  'me',
  'memory',
  'memories',
  'my',
  'please',
  'recall',
  'remember',
  'remembered',
  'saved',
  'delete',
  'remove',
  'show',
  'that',
  'the',
  'this',
  'update',
  'what',
  'which',
  'you'
]);

function memoryIntentQuestion(context = {}) {
  return asText(asObject(context).question).toLocaleLowerCase();
}

function hasExplicitMemoryIntent(question) {
  return (
    /\b(?:memory|memories|remember|remembered|forget|forgot|recall|personalization|preferences?)\b/i.test(
      question
    ) ||
    /\bkeep\s+(?:this|that|it)\s+in\s+mind\b/i.test(question) ||
    /\b(?:save|store)\s+(?:this|that|it)\s+for\s+later\b/i.test(question)
  );
}

function hasMemoryLookupIntent(question) {
  if (!hasExplicitMemoryIntent(question)) return false;
  return (
    /\b(?:show|list|review|read|check|search|find)\b.*\b(?:memory|memories|remembered|preferences?)\b/i.test(
      question
    ) ||
    /\b(?:what|which)\b.*\b(?:memory|memories|remember|remembered|preferences?)\b/i.test(
      question
    ) ||
    /\bwhat\s+(?:do|did)\s+you\s+(?:remember|recall|know)\b/i.test(question) ||
    /^(?:please\s+)?recall\b/i.test(question)
  );
}

function hasMemoryActionIntent(toolName, question) {
  if (!hasExplicitMemoryIntent(question)) return false;
  if (toolName === 'list_memory_items') {
    return (
      hasMemoryLookupIntent(question) ||
      hasMemoryActionIntent('update_memory_item', question) ||
      hasMemoryActionIntent('forget_memory', question)
    );
  }
  if (toolName === 'remember_memory') {
    return (
      /^(?:please\s+)?(?:remember|memorize|save|store|add)\b/i.test(question) ||
      /\b(?:can|could|would)\s+you\s+remember\s+(?:that|this|my|i)\b/i.test(question) ||
      /\b(?:save|store|add)\b.*\b(?:memory|preferences?)\b/i.test(question) ||
      /\bkeep\s+(?:this|that|it)\s+in\s+mind\b/i.test(question) ||
      /\b(?:save|store)\s+(?:this|that|it)\s+for\s+later\b/i.test(question)
    );
  }
  if (toolName === 'update_memory_item') {
    return (
      /\b(?:update|change|edit|replace)\b.*\b(?:memory|remembered|preferences?)\b/i.test(
        question
      ) || /\bremember\b.*\binstead\b/i.test(question)
    );
  }
  if (toolName === 'forget_memory') {
    return (
      /^(?:please\s+)?forget\b/i.test(question) ||
      /\b(?:can|could|would)\s+you\s+forget\b/i.test(question) ||
      /\b(?:remove|delete|erase)\b.*\b(?:memory|remembered|preferences?)\b/i.test(question)
    );
  }
  if (toolName === 'clear_memory') {
    return /\b(?:clear|erase|delete|remove|forget)\b.*\b(?:all|every|everything|memory|memories)\b/i.test(
      question
    );
  }
  return false;
}

function memoryToolAvailable(toolName) {
  return (context = {}) =>
    asObject(context).approvedByUser === true ||
    hasMemoryActionIntent(toolName, memoryIntentQuestion(context));
}

function memoryWords(value) {
  return new Set(
    asText(value)
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu)
      ?.filter((word) => !MEMORY_QUERY_STOP_WORDS.has(word)) || []
  );
}

function relevantMemoryItems(memory, question) {
  const queryWords = memoryWords(question);
  const broadLookup = queryWords.size === 0;
  const candidates = asArray(memory.items)
    .map(publicItem)
    .filter((item) => item.id && item.text)
    .map((item, index) => {
      const itemWords = memoryWords(`${item.text} ${item.tags.join(' ')}`);
      let overlap = 0;
      queryWords.forEach((word) => {
        if (!itemWords.has(word)) return;
        overlap += item.tags.some((tag) => memoryWords(tag).has(word)) ? 3 : 1;
      });
      return {
        item,
        index,
        overlap,
        selected: broadLookup || item.scope === 'always' || overlap > 0
      };
    })
    .filter((entry) => entry.selected)
    .sort((left, right) => {
      if (left.item.scope !== right.item.scope) return left.item.scope === 'always' ? -1 : 1;
      if (left.overlap !== right.overlap) return right.overlap - left.overlap;
      const recency = right.item.updatedAt.localeCompare(left.item.updatedAt);
      return recency || left.index - right.index;
    });
  const items = [];
  let textCharacters = 0;
  for (const { item } of candidates) {
    const itemTextCharacters = [
      item.id,
      item.text,
      ...item.tags,
      item.scope,
      item.createdAt,
      item.updatedAt
    ].reduce((total, value) => total + asText(value).length, 0);
    if (
      items.length >= MEMORY_LOOKUP_LIMIT ||
      textCharacters + itemTextCharacters > MEMORY_LOOKUP_TEXT_LIMIT
    ) {
      break;
    }
    items.push(item);
    textCharacters += itemTextCharacters;
  }
  return {
    items,
    limited: items.length < candidates.length
  };
}

function advisor(environment) {
  const port = environment?.context?.advisor;
  return port && typeof port.invoke === 'function' ? port : null;
}

function issue(code, message, field = '') {
  return { code, message, ...(field ? { field } : {}) };
}

function failed(environment, code, message, field = '', options = {}) {
  return {
    ok: false,
    toolName: environment.toolName,
    ...(environment.toolCallId ? { toolCallId: environment.toolCallId } : {}),
    status: options.status || 'failed',
    changed: false,
    data: options.data || null,
    warnings: [],
    errors: [issue(code, message, field)]
  };
}

function publicItem(value) {
  const item = asObject(value);
  return {
    id: asText(item.id),
    text: asText(item.text),
    tags: asArray(item.tags).map(asText).filter(Boolean),
    scope: asText(item.scope) || 'relevant',
    createdAt: asText(item.createdAt),
    updatedAt: asText(item.updatedAt)
  };
}

function publicMemory(value) {
  const memory = asObject(value);
  return {
    revision: asText(memory.revision),
    memoryEnabled: memory.memoryEnabled === true,
    allowAutomaticMemory: memory.allowAutomaticMemory === true,
    empty: memory.empty === true,
    items: asArray(memory.items)
      .map(publicItem)
      .filter((item) => item.id && item.text)
  };
}

async function invoke(environment, command, payload) {
  const port = advisor(environment);
  if (!port) {
    return {
      ok: false,
      error: 'Companion memory is unavailable in this build.',
      code: 'memory_service_unavailable'
    };
  }
  try {
    return asObject(await port.invoke(command, payload));
  } catch (error) {
    return {
      ok: false,
      error: asText(error?.message || error) || 'The memory operation failed.',
      code: asText(error?.code) || 'memory_operation_failed'
    };
  }
}

function invocationFailure(environment, result) {
  const source = asObject(result);
  return failed(
    environment,
    asText(source.code).toLowerCase() || 'memory_operation_failed',
    asText(source.error || source.message) || 'The memory operation failed.',
    '',
    {
      status: source.conflict === true ? 'conflict' : 'failed',
      ...(source.memory ? { data: { memory: publicMemory(source.memory) } } : {})
    }
  );
}

async function loadMemory(environment) {
  const result = await invoke(environment, 'getMemory');
  return result.ok === true
    ? { ok: true, memory: publicMemory(result.memory) }
    : { ok: false, result: invocationFailure(environment, result) };
}

async function authorizeMemoryAccess(environment, options = {}) {
  if (!memoryToolAvailable(environment.toolName)(environment.context)) {
    return {
      ok: false,
      result: failed(
        environment,
        'memory_intent_required',
        'Companion memory is available only when the user explicitly asks to remember, forget, update, or review memory.'
      )
    };
  }
  const loaded = await loadMemory(environment);
  if (!loaded.ok) return loaded;
  if (loaded.memory.memoryEnabled !== true) {
    return {
      ok: false,
      result: failed(
        environment,
        'memory_disabled',
        'Companion memory is disabled. No local memory items were shared.'
      )
    };
  }
  if (options.write === true && loaded.memory.allowAutomaticMemory !== true) {
    return {
      ok: false,
      result: failed(
        environment,
        'memory_chat_updates_disabled',
        'Approved memory updates from chats are disabled. Enable them in Companion personalization first.'
      )
    };
  }
  return loaded;
}

function proposalRequired(environment, action, proposal, memory, label) {
  return {
    ok: false,
    toolName: environment.toolName,
    ...(environment.toolCallId ? { toolCallId: environment.toolCallId } : {}),
    status: 'confirmation_required',
    changed: false,
    data: {
      memory: {
        id: asText(proposal.id) || 'memory.md',
        label: label || asText(proposal.text) || 'Companion memory'
      },
      revision: memory.revision
    },
    warnings: [],
    errors: [
      issue(
        'confirmation_required',
        `Explicit user confirmation is required before Cavalry can ${action}.`,
        'confirmed'
      )
    ],
    confirmation: {
      required: true,
      field: 'confirmed',
      action,
      message: `Confirm that you want Cavalry to ${action}.`,
      proposal: { arguments: { ...proposal, expectedRevision: memory.revision } }
    }
  };
}

async function prepareMemoryWrite(
  environment,
  action,
  proposalValue,
  label,
  validate,
  authorizedMemory = null
) {
  const loaded = authorizedMemory
    ? { ok: true, memory: authorizedMemory }
    : await authorizeMemoryAccess(environment, { write: true });
  if (!loaded.ok) return loaded;
  const proposal =
    typeof proposalValue === 'function'
      ? asObject(proposalValue(loaded.memory))
      : asObject(proposalValue);
  const invalid = typeof validate === 'function' ? validate(loaded.memory, proposal) : null;
  if (invalid) return { ok: false, result: invalid };
  const expectedRevision = asText(environment.arguments.expectedRevision);
  if (environment.arguments.confirmed !== true || !expectedRevision) {
    return {
      ok: false,
      result: proposalRequired(environment, action, proposal, loaded.memory, label)
    };
  }
  return { ok: true, memory: loaded.memory, expectedRevision, proposal };
}

function unchanged(environment, itemValue, action) {
  const item = publicItem(itemValue);
  return {
    ok: true,
    toolName: environment.toolName,
    ...(environment.toolCallId ? { toolCallId: environment.toolCallId } : {}),
    status: 'unchanged',
    changed: false,
    commitStatus: 'not_applicable',
    verificationStatus: 'verified',
    data: { memory: item.id ? { ...item, label: item.text } : null, action },
    warnings: [],
    errors: []
  };
}

function sameTags(left, right) {
  const normalize = (value) => asArray(value).map(asText).filter(Boolean);
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function completed(environment, memoryValue, itemValue, action) {
  const memory = publicMemory(memoryValue);
  const item = publicItem(itemValue);
  const entity = item.id
    ? { ...item, label: item.text }
    : { id: 'memory.md', label: 'Companion memory', type: 'memory' };
  return {
    ok: true,
    toolName: environment.toolName,
    ...(environment.toolCallId ? { toolCallId: environment.toolCallId } : {}),
    status: 'completed',
    changed: true,
    commitStatus: 'committed',
    verificationStatus: 'verified',
    persistence: { status: 'saved', durable: true, revision: memory.revision },
    data: { memory: entity, revision: memory.revision, action },
    warnings: [],
    errors: []
  };
}

async function listMemory(environment) {
  const loaded = await authorizeMemoryAccess(environment);
  if (!loaded.ok) return loaded.result;
  const selection = relevantMemoryItems(loaded.memory, memoryIntentQuestion(environment.context));
  return {
    ok: true,
    toolName: environment.toolName,
    ...(environment.toolCallId ? { toolCallId: environment.toolCallId } : {}),
    status: 'completed',
    changed: false,
    commitStatus: 'not_applicable',
    verificationStatus: 'verified',
    data: {
      memory: {
        revision: loaded.memory.revision,
        memoryEnabled: true,
        empty: loaded.memory.empty === true,
        items: selection.items,
        limited: selection.limited
      }
    },
    warnings: [],
    errors: []
  };
}

async function rememberMemory(environment) {
  const text = asText(environment.arguments.text);
  const tags = asArray(environment.arguments.tags).map(asText).filter(Boolean);
  if (!text) return failed(environment, 'memory_text_required', 'Memory text is required.', 'text');
  if (text.length > 4_000) {
    return failed(
      environment,
      'memory_text_too_long',
      'A memory item must be 4,000 characters or fewer.',
      'text'
    );
  }
  if (tags.length > 12 || tags.some((tag) => tag.length > 48)) {
    return failed(
      environment,
      'memory_tags_invalid',
      'Use at most 12 memory tags, each 48 characters or fewer.',
      'tags'
    );
  }
  const proposal = { text, ...(tags.length ? { tags } : {}) };
  const prepared = await prepareMemoryWrite(
    environment,
    `remember “${text.slice(0, 120)}”`,
    proposal,
    text,
    (memory) => {
      const duplicate = memory.items.find(
        (item) => item.text.toLocaleLowerCase() === text.toLocaleLowerCase()
      );
      return duplicate ? unchanged(environment, duplicate, 'already_present') : null;
    }
  );
  if (!prepared.ok) return prepared.result;
  const result = await invoke(environment, 'createMemoryItem', {
    expectedRevision: prepared.expectedRevision,
    item: { text, tags }
  });
  if (result.ok !== true) return invocationFailure(environment, result);
  const memory = publicMemory(result.memory);
  const item = memory.items.find(
    (candidate) => candidate.text === text && candidate.tags.join('\u0000') === tags.join('\u0000')
  );
  return completed(environment, memory, item, 'created');
}

async function updateMemory(environment) {
  const id = asText(environment.arguments.id);
  const text = asText(environment.arguments.text);
  const hasTags = Array.isArray(environment.arguments.tags);
  const requestedTags = asArray(environment.arguments.tags).map(asText).filter(Boolean);
  if (!id) return failed(environment, 'memory_id_required', 'Memory item ID is required.', 'id');
  if (!text) return failed(environment, 'memory_text_required', 'Memory text is required.', 'text');
  if (text.length > 4_000) {
    return failed(
      environment,
      'memory_text_too_long',
      'A memory item must be 4,000 characters or fewer.',
      'text'
    );
  }
  if (requestedTags.length > 12 || requestedTags.some((tag) => tag.length > 48)) {
    return failed(
      environment,
      'memory_tags_invalid',
      'Use at most 12 memory tags, each 48 characters or fewer.',
      'tags'
    );
  }
  const prepared = await prepareMemoryWrite(
    environment,
    `update memory item ${id}`,
    (memory) => {
      const existing = memory.items.find((item) => item.id === id);
      return { id, text, tags: hasTags ? requestedTags : asArray(existing?.tags) };
    },
    text,
    (memory, proposal) => {
      const existing = memory.items.find((item) => item.id === id);
      if (!existing) {
        return failed(
          environment,
          'memory_item_not_found',
          'That memory item no longer exists. List memory again before retrying.',
          'id'
        );
      }
      return existing.text === text && sameTags(existing.tags, proposal.tags)
        ? unchanged(environment, existing, 'already_current')
        : null;
    }
  );
  if (!prepared.ok) return prepared.result;
  const result = await invoke(environment, 'updateMemoryItem', {
    expectedRevision: prepared.expectedRevision,
    itemId: id,
    item: { text, tags: prepared.proposal.tags }
  });
  if (result.ok !== true) return invocationFailure(environment, result);
  const memory = publicMemory(result.memory);
  return completed(
    environment,
    memory,
    memory.items.find((item) => item.id === id),
    'updated'
  );
}

async function forgetMemory(environment) {
  const id = asText(environment.arguments.id);
  if (!id) return failed(environment, 'memory_id_required', 'Memory item ID is required.', 'id');
  const loaded = await authorizeMemoryAccess(environment, { write: true });
  if (!loaded.ok) return loaded.result;
  const existing = loaded.memory.items.find((item) => item.id === id);
  if (!existing) {
    return failed(
      environment,
      'memory_item_not_found',
      'That memory item no longer exists. List memory again before retrying.',
      'id'
    );
  }
  const prepared = await prepareMemoryWrite(
    environment,
    `forget “${existing.text.slice(0, 120)}”`,
    { id },
    existing.text,
    null,
    loaded.memory
  );
  if (!prepared.ok) return prepared.result;
  const result = await invoke(environment, 'deleteMemoryItem', {
    expectedRevision: prepared.expectedRevision,
    itemId: id
  });
  if (result.ok !== true) return invocationFailure(environment, result);
  return completed(environment, result.memory, existing, 'deleted');
}

async function clearMemory(environment) {
  const prepared = await prepareMemoryWrite(
    environment,
    'clear every Companion memory item',
    {},
    'Companion memory',
    (memory) => (memory.empty === true ? unchanged(environment, null, 'already_empty') : null)
  );
  if (!prepared.ok) return prepared.result;
  const result = await invoke(environment, 'clearMemory', {
    expectedRevision: prepared.expectedRevision,
    memoryEnabled: prepared.memory.memoryEnabled,
    allowAutomaticMemory: prepared.memory.allowAutomaticMemory
  });
  if (result.ok !== true) return invocationFailure(environment, result);
  return completed(environment, result.memory, null, 'cleared');
}

const MEMORY_WRITE_RESULT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    status: { type: 'string' },
    changed: { type: 'boolean' },
    commitStatus: { type: 'string' },
    verificationStatus: { type: 'string' },
    data: { type: ['object', 'null'] },
    receipt: { type: ['object', 'null'] },
    warnings: { type: 'array' },
    errors: { type: 'array' }
  },
  required: ['ok', 'status', 'changed'],
  additionalProperties: true
});

export default defineCavalryAssistantCapability({
  id: 'memory.local',
  title: 'Local Companion memory',
  description:
    'Reads and explicitly updates the user-controlled memory.md document in Cavalry’s local application-data folder.',
  instructions:
    'Use list_memory_items before editing or forgetting an item. Only propose remember, update, forget, or clear actions when the user explicitly asks. Never claim that memory changed until the returned durable receipt says it was committed and verified.',
  version: '1.0.0',
  compatibility: { minimumAppVersion: '2.1.0' },
  inputValidation: 'structure',
  requiresWorkbook: false,
  tools: [
    {
      definition: definition(
        'list_memory_items',
        'List the individual, user-visible items in local Companion memory. This is read-only and does not require an open workbook.'
      ),
      execute: listMemory,
      access: 'read',
      actionId: 'memory.local.list',
      title: 'List memory items',
      confirmation: { mode: 'none' },
      availability: memoryToolAvailable('list_memory_items'),
      outputSchema: MEMORY_WRITE_RESULT_SCHEMA
    },
    {
      definition: definition(
        'remember_memory',
        'Propose adding one lasting, user-visible item to local Companion memory. Cavalry requires explicit approval before writing.',
        {
          text: { type: 'string', minLength: 1, maxLength: 4_000 },
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 48 },
            maxItems: 12
          },
          expectedRevision: EXPECTED_REVISION_PROPERTY,
          confirmed: CONFIRMED_PROPERTY
        },
        ['text']
      ),
      execute: rememberMemory,
      access: 'write',
      actionId: 'memory.local.remember',
      title: 'Remember',
      actionVerb: 'Remembered',
      approvalFields: ['confirmed'],
      hostInputFields: ['expectedRevision'],
      confirmation: { mode: 'always' },
      availability: memoryToolAvailable('remember_memory'),
      atomicity: 'single-file-atomic-replace',
      idempotency: 'expected-revision',
      outputSchema: MEMORY_WRITE_RESULT_SCHEMA
    },
    {
      definition: definition(
        'update_memory_item',
        'Propose changing one existing item in local Companion memory by stable item ID. Cavalry requires explicit approval before writing.',
        {
          id: { type: 'string', minLength: 1, maxLength: 200 },
          text: { type: 'string', minLength: 1, maxLength: 4_000 },
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 48 },
            maxItems: 12
          },
          expectedRevision: EXPECTED_REVISION_PROPERTY,
          confirmed: CONFIRMED_PROPERTY
        },
        ['id', 'text']
      ),
      execute: updateMemory,
      access: 'write',
      actionId: 'memory.local.update',
      title: 'Update memory',
      actionVerb: 'Updated memory',
      approvalFields: ['confirmed'],
      hostInputFields: ['expectedRevision'],
      confirmation: { mode: 'always' },
      availability: memoryToolAvailable('update_memory_item'),
      entityRequirements: [{ type: 'memory_item', role: 'target' }],
      atomicity: 'single-file-atomic-replace',
      idempotency: 'expected-revision',
      outputSchema: MEMORY_WRITE_RESULT_SCHEMA
    },
    {
      definition: definition(
        'forget_memory',
        'Propose deleting one existing item from local Companion memory by stable item ID. Cavalry requires explicit approval before writing.',
        {
          id: { type: 'string', minLength: 1, maxLength: 200 },
          expectedRevision: EXPECTED_REVISION_PROPERTY,
          confirmed: CONFIRMED_PROPERTY
        },
        ['id']
      ),
      execute: forgetMemory,
      access: 'write',
      actionId: 'memory.local.forget',
      title: 'Forget memory',
      actionVerb: 'Forgot',
      approvalFields: ['confirmed'],
      hostInputFields: ['expectedRevision'],
      confirmation: { mode: 'always' },
      availability: memoryToolAvailable('forget_memory'),
      entityRequirements: [{ type: 'memory_item', role: 'target' }],
      atomicity: 'single-file-atomic-replace',
      idempotency: 'expected-revision',
      outputSchema: MEMORY_WRITE_RESULT_SCHEMA
    },
    {
      definition: definition(
        'clear_memory',
        'Propose clearing every item and free-form detail from local Companion memory. Cavalry requires explicit approval before writing.',
        {
          expectedRevision: EXPECTED_REVISION_PROPERTY,
          confirmed: CONFIRMED_PROPERTY
        }
      ),
      execute: clearMemory,
      access: 'write',
      actionId: 'memory.local.clear',
      title: 'Clear memory',
      actionVerb: 'Cleared',
      approvalFields: ['confirmed'],
      hostInputFields: ['expectedRevision'],
      confirmation: { mode: 'always' },
      availability: memoryToolAvailable('clear_memory'),
      atomicity: 'single-file-atomic-replace',
      idempotency: 'expected-revision',
      outputSchema: MEMORY_WRITE_RESULT_SCHEMA
    }
  ]
});
