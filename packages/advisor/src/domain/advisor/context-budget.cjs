// Shared browser/host estimate; intentionally does not require a provider tokenizer.
'use strict';

const CONTEXT_CHARS_PER_TOKEN = 3;
const CONTEXT_RESERVED_OUTPUT_TOKENS = 1024;

function contextCharBudget(connection = {}, reservedOutputTokens = CONTEXT_RESERVED_OUTPUT_TOKENS) {
  const contextTokens = Number(connection && connection.contextWindowTokens) || 0;
  if (!(Number.isFinite(contextTokens) && contextTokens > 0)) return 0;
  return Math.max(0, Math.floor((contextTokens - reservedOutputTokens) * CONTEXT_CHARS_PER_TOKEN));
}

function serializedLength(value) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? serialized.length : 0;
  } catch (_error) {
    return 0;
  }
}

module.exports = { CONTEXT_RESERVED_OUTPUT_TOKENS, contextCharBudget, serializedLength };
