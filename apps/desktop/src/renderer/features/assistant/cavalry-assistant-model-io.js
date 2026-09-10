// Tool-schema normalization and context budgeting: the mechanical shaping a turn needs before
// it can be sent to either an OpenAI-compatible or a local llama.cpp endpoint.

import contextBudget from '@cavalry/advisor/domain/advisor/context-budget.cjs';

export const CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME = 'request_clarification';

const { contextCharBudget, serializedLength } = contextBudget;
const TRUNCATED_TOOL_OUTPUT_CHARS = 1200;
const OMITTED_HISTORY_NOTE =
  'Some earlier conversation messages were omitted to fit the model context. Use the available messages and supplied memory; do not assume missing details were never shared or invent what was said.';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function copyPlain(value) {
  if (typeof value === 'undefined') return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return null;
  }
}

const CLARIFICATION_TOOL = Object.freeze({
  type: 'function',
  name: CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME,
  description:
    'Pause the task and ask the user one focused follow-up question only when essential information is missing or a meaningful choice belongs to the user. Do not ask for a transaction date when the user omitted it; Cavalry uses the current date.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'The single focused question the user needs to answer before work can continue.'
      },
      options: {
        type: 'array',
        description: 'Optional quick-answer choices.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            description: { type: 'string' }
          },
          required: ['label'],
          additionalProperties: false
        }
      },
      allowFreeText: {
        type: 'boolean',
        description: 'Whether the user may provide an answer other than the listed choices.'
      }
    },
    required: ['question'],
    additionalProperties: false
  }
});

function defaultParameters() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: true
  };
}

export function normalizeResponseTools(tools) {
  return asArray(tools)
    .map((tool) => {
      const source = asObject(tool);
      const functionSource = asObject(source.function);
      const name = asString(source.name || functionSource.name);
      if (!name) return null;
      const normalized = {
        type: 'function',
        name,
        description: asString(source.description || functionSource.description),
        parameters:
          copyPlain(
            source.parameters ||
              source.inputSchema ||
              source.input_schema ||
              functionSource.parameters ||
              defaultParameters()
          ) || defaultParameters()
      };
      const strict =
        typeof source.strict === 'boolean'
          ? source.strict
          : typeof functionSource.strict === 'boolean'
            ? functionSource.strict
            : undefined;
      if (typeof strict === 'boolean') normalized.strict = strict;
      return normalized;
    })
    .filter(Boolean);
}

export function toChatCompletionTools(responseTools) {
  return responseTools.map((tool) => {
    const definition = {
      name: tool.name,
      description: tool.description,
      parameters: copyPlain(tool.parameters) || defaultParameters()
    };
    if (typeof tool.strict === 'boolean') definition.strict = tool.strict;
    return { type: 'function', function: definition };
  });
}

export function withClarificationTool(tools) {
  return tools
    .filter((tool) => asString(tool && tool.name) !== CAVALRY_ASSISTANT_CLARIFICATION_TOOL_NAME)
    .concat(copyPlain(CLARIFICATION_TOOL) || CLARIFICATION_TOOL);
}

export function chatTemperature(connection) {
  return asObject(connection).provider === 'custom' ? 0.3 : 0.6;
}

function totalMessageChars(messages) {
  return messages.reduce((total, message) => total + serializedLength(message), 0);
}

export function fitChatHistoryToContext(messages, historyCount, connection, tools = []) {
  const budget = contextCharBudget(connection);
  if (!budget) return messages;
  const toolChars = serializedLength(tools);
  let remainingHistory = Math.min(Math.max(0, historyCount), Math.max(0, messages.length - 2));
  let omittedHistory = false;
  while (
    remainingHistory > 0 &&
    totalMessageChars(messages) + toolChars + (omittedHistory ? OMITTED_HISTORY_NOTE.length : 0) >
      budget
  ) {
    // Remove whole exchanges: an assistant answer without the user's question can look like
    // an established fact or an instruction to a small model.
    let count = 1;
    while (count < remainingHistory && messages[1 + count]?.role !== 'user') count += 1;
    messages.splice(1, count);
    remainingHistory -= count;
    omittedHistory = true;
  }
  if (omittedHistory && messages[0]?.role === 'system') {
    messages[0] = {
      ...messages[0],
      content: `${messages[0].content}\n\n${OMITTED_HISTORY_NOTE}`
    };
  }
  return messages;
}

export function truncateOlderToolOutputs(messages, connection, tools = []) {
  const budget = contextCharBudget(connection);
  const toolChars = serializedLength(tools);
  if (!budget || totalMessageChars(messages) + toolChars <= budget) return;
  for (let index = 0; index < messages.length - 1; index += 1) {
    const message = messages[index];
    if (!(message && message.role === 'tool' && typeof message.content === 'string')) continue;
    if (message.content.length <= TRUNCATED_TOOL_OUTPUT_CHARS) continue;
    message.content = `${message.content.slice(0, TRUNCATED_TOOL_OUTPUT_CHARS)}…[Cavalry truncated this older tool output to fit the model context. Call the tool again if you need the full data.]`;
    if (totalMessageChars(messages) + toolChars <= budget) return;
  }
}

function toolOutputCharCap(connection) {
  if (asObject(connection).provider !== 'custom') return 240000;
  const budget = contextCharBudget(connection);
  return budget ? Math.max(TRUNCATED_TOOL_OUTPUT_CHARS, Math.floor(budget / 3)) : 60000;
}

export function boundedToolOutput(output, connection) {
  const text = typeof output === 'string' ? output : String(output ?? '');
  const cap = toolOutputCharCap(connection);
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}…[Cavalry truncated this tool output to fit the model context. Narrow the query or paginate for the rest.]`;
}
