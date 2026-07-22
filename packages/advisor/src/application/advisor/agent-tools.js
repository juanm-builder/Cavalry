import {
  classifyAdvisorFinanceIntent,
  normalizeAdvisorTransactionDraftFields,
  normalizeAdvisorTransactionTemplate,
  validateAdvisorTransactionIntent
} from '../../domain/advisor/transaction-drafts.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function parseToolArguments(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_error) {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function schemaObject(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

export const ADVISOR_AGENT_TOOL_SCHEMAS = Object.freeze([
  {
    type: 'function',
    name: 'classify_finance_intent',
    description: 'Classify the user finance command before a draft is prepared.',
    parameters: schemaObject(
      {
        prompt: { type: 'string', description: 'The user finance command.' }
      },
      ['prompt']
    ),
    strict: true
  },
  {
    type: 'function',
    name: 'lookup_accounts',
    description: 'Look up active asset or liability accounts in the workbook.',
    parameters: schemaObject(
      {
        query: { type: 'string' },
        group: { type: 'string', enum: ['', 'asset', 'liability'] }
      },
      ['query', 'group']
    ),
    strict: true
  },
  {
    type: 'function',
    name: 'lookup_categories',
    description: 'Look up active categories in the workbook.',
    parameters: schemaObject(
      {
        query: { type: 'string' },
        type: { type: 'string', enum: ['', 'expense', 'income', 'debt'] }
      },
      ['query', 'type']
    ),
    strict: true
  },
  {
    type: 'function',
    name: 'lookup_counterparties',
    description: 'Look up active counterparties in the workbook.',
    parameters: schemaObject(
      {
        query: { type: 'string' },
        kind: { type: 'string' }
      },
      ['query', 'kind']
    ),
    strict: true
  },
  {
    type: 'function',
    name: 'prepare_transaction_draft',
    description:
      'Prepare a validated transaction draft candidate. This never mutates the workbook.',
    parameters: schemaObject(
      {
        prompt: { type: 'string' },
        template: { type: 'string' },
        fields: { type: 'object', additionalProperties: true },
        confidence: { type: 'number' },
        reason: { type: 'string' }
      },
      ['prompt', 'template', 'fields', 'confidence', 'reason']
    ),
    strict: true
  },
  {
    type: 'function',
    name: 'revise_draft',
    description:
      'Validate a proposed revision to a pending draft candidate. This never mutates the workbook.',
    parameters: schemaObject(
      {
        prompt: { type: 'string' },
        template: { type: 'string' },
        fields: { type: 'object', additionalProperties: true },
        reason: { type: 'string' }
      },
      ['prompt', 'template', 'fields', 'reason']
    ),
    strict: true
  },
  {
    type: 'function',
    name: 'explain_draft',
    description: 'Explain the money direction and missing fields for a draft candidate.',
    parameters: schemaObject(
      {
        template: { type: 'string' },
        fields: { type: 'object', additionalProperties: true },
        missingFields: { type: 'array', items: { type: 'string' } }
      },
      ['template', 'fields', 'missingFields']
    ),
    strict: true
  }
]);

function filterByQuery(items, query, predicate) {
  const key = asString(query).toLowerCase();
  return (items || [])
    .filter((item) => {
      if (!(item && item.isActive !== false)) {
        return false;
      }
      if (typeof predicate === 'function' && !predicate(item)) {
        return false;
      }
      if (!key) {
        return true;
      }
      return [item.name, item.subtype, item.type, item.kind].some((value) =>
        asString(value).toLowerCase().includes(key)
      );
    })
    .slice(0, 20)
    .map((item) => ({
      id: asString(item.id),
      name: asString(item.name),
      group: asString(item.group),
      type: asString(item.type),
      subtype: asString(item.subtype),
      kind: asString(item.kind)
    }));
}

function buildDraftExplanation(template, fields, missingFields) {
  const normalizedTemplate = normalizeAdvisorTransactionTemplate(template);
  const source = normalizeAdvisorTransactionDraftFields(fields);
  if (normalizedTemplate === 'debt_payment' || normalizedTemplate === 'liability_payment') {
    return (
      (source.description || 'Credit card payment') +
      (source.primaryAccountName ? ' from ' + source.primaryAccountName : '') +
      (source.secondaryAccountName ? ' to ' + source.secondaryAccountName : '') +
      (missingFields && missingFields.length ? '. Missing: ' + missingFields.join(', ') + '.' : '.')
    );
  }
  if (normalizedTemplate === 'expense_charged') {
    return (
      (source.description || 'Expense') +
      (source.primaryAccountName ? ' charged to ' + source.primaryAccountName : '') +
      (missingFields && missingFields.length ? '. Missing: ' + missingFields.join(', ') + '.' : '.')
    );
  }
  return (
    (source.description || 'Transaction draft') +
    (missingFields && missingFields.length ? '. Missing: ' + missingFields.join(', ') + '.' : '.')
  );
}

export function runAdvisorAgentTool(name, args = {}, context = {}) {
  const toolName = asString(name);
  const toolArgs = parseToolArguments(args);
  const workbook = context.workbook || {};
  const currentDate = asString(toolArgs.currentDate || context.currentDate);
  const prompt = asString(toolArgs.prompt || context.prompt);
  if (toolName === 'classify_finance_intent') {
    return {
      ok: true,
      result: classifyAdvisorFinanceIntent(prompt, {
        currentDate,
        defaultDateForUndated: true
      })
    };
  }
  if (toolName === 'lookup_accounts') {
    const group = asString(toolArgs.group);
    return {
      ok: true,
      accounts: filterByQuery(
        workbook.accounts,
        toolArgs.query,
        (account) => !group || account.group === group
      )
    };
  }
  if (toolName === 'lookup_categories') {
    const type = asString(toolArgs.type);
    return {
      ok: true,
      categories: filterByQuery(
        workbook.categories,
        toolArgs.query,
        (category) => !type || category.type === type
      )
    };
  }
  if (toolName === 'lookup_counterparties') {
    const kind = asString(toolArgs.kind);
    return {
      ok: true,
      counterparties: filterByQuery(
        workbook.counterparties,
        toolArgs.query,
        (counterparty) => !kind || counterparty.kind === kind
      )
    };
  }
  if (toolName === 'prepare_transaction_draft' || toolName === 'revise_draft') {
    const fields = normalizeAdvisorTransactionDraftFields(toolArgs.fields || {});
    const validation = validateAdvisorTransactionIntent(
      workbook,
      {
        template: normalizeAdvisorTransactionTemplate(toolArgs.template || fields.template),
        fields,
        confidence: Number(toolArgs.confidence) || 0.7,
        reason: asString(toolArgs.reason)
      },
      prompt,
      context.pendingAction || null,
      {
        currentDate,
        defaultDateForUndated: true
      }
    );
    return {
      ok: true,
      directMutation: false,
      mutation: 'draft_candidate_only',
      draftCandidate: {
        type: 'transaction_draft',
        status: validation.ok ? 'draft' : 'needs_info',
        template: validation.template,
        fields: validation.fields,
        missingFields: validation.missingFields,
        invalidReasons: validation.invalidReasons,
        confidence: validation.confidence,
        reason: validation.reason,
        semanticDecision: validation.semanticDecision,
        dateDefaulted: validation.dateDefaulted
      }
    };
  }
  if (toolName === 'explain_draft') {
    const missingFields = Array.isArray(toolArgs.missingFields)
      ? toolArgs.missingFields.map(asString).filter(Boolean)
      : [];
    return {
      ok: true,
      explanation: buildDraftExplanation(toolArgs.template, toolArgs.fields, missingFields)
    };
  }
  return {
    ok: false,
    error: 'Unsupported advisor agent tool: ' + toolName,
    directMutation: false
  };
}

function extractAdvisorAgentToolCalls(response) {
  const calls = [];
  const output = Array.isArray(response && response.output) ? response.output : [];
  output.forEach((item) => {
    if (item && item.type === 'function_call') {
      calls.push({
        id: asString(item.call_id || item.id),
        name: asString(item.name),
        arguments: item.arguments
      });
    }
  });
  const messageCalls =
    response &&
    response.choices &&
    response.choices[0] &&
    response.choices[0].message &&
    response.choices[0].message.tool_calls;
  if (Array.isArray(messageCalls)) {
    messageCalls.forEach((item) => {
      calls.push({
        id: asString(item.id),
        name: asString(item.function && item.function.name),
        arguments: item.function && item.function.arguments
      });
    });
  }
  if (Array.isArray(response && response.tool_calls)) {
    response.tool_calls.forEach((item) => {
      calls.push({
        id: asString(item.id || item.call_id),
        name: asString(item.name || (item.function && item.function.name)),
        arguments: item.arguments || (item.function && item.function.arguments)
      });
    });
  }
  return calls.filter((call) => call.name);
}

function getAgentInputText(input) {
  if (typeof input === 'string') {
    return input;
  }
  if (Array.isArray(input)) {
    return input
      .map((item) => asString(item && (item.content || item.text || item.message)))
      .filter(Boolean)
      .join('\n');
  }
  return asString(input && (input.prompt || input.content || input.text));
}

export async function runAdvisorAgentToolLoop(options = {}) {
  const client = options.modelClient || options.client || {};
  if (typeof client.createResponse !== 'function') {
    throw new Error('Advisor agent tool loop requires a createResponse client.');
  }
  const workbook = options.workbook || {};
  const initialTransactions = JSON.stringify(workbook.transactions || []);
  const prompt = asString(options.prompt || getAgentInputText(options.input));
  const currentDate = asString(options.currentDate);
  const maxToolCalls = Math.max(1, Math.min(16, Number(options.maxToolCalls) || 8));
  const toolCalls = [];
  const preparedDrafts = [];
  let response = await client.createResponse({
    model: options.model,
    input: options.input || prompt,
    tools: ADVISOR_AGENT_TOOL_SCHEMAS
  });
  for (let index = 0; index < maxToolCalls; index += 1) {
    const calls = extractAdvisorAgentToolCalls(response);
    if (!calls.length) {
      break;
    }
    const outputs = calls.map((call) => {
      const result = runAdvisorAgentTool(call.name, call.arguments, {
        workbook,
        prompt,
        currentDate,
        pendingAction: options.pendingAction || null
      });
      toolCalls.push({
        id: call.id,
        name: call.name,
        arguments: parseToolArguments(call.arguments),
        result: clonePlain(result)
      });
      if (result && result.draftCandidate) {
        preparedDrafts.push(clonePlain(result.draftCandidate));
      }
      return {
        type: 'function_call_output',
        call_id: call.id || 'call_' + String(index),
        output: JSON.stringify(result)
      };
    });
    response = await client.createResponse({
      model: options.model,
      input: outputs,
      previous_response_id: response && response.id,
      tools: ADVISOR_AGENT_TOOL_SCHEMAS
    });
  }
  return {
    ok: true,
    response: clonePlain(response),
    toolCalls,
    preparedDrafts,
    directWorkbookMutation: initialTransactions !== JSON.stringify(workbook.transactions || [])
  };
}
