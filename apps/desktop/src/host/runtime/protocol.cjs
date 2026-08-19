'use strict';

const PROTOCOL_PREFIX = 'CAVALRY_IPC_V1:';
const PROTOCOL_VERSION = 1;

function serializeError(error, fallback = 'The desktop host request failed.') {
  const source = error && typeof error === 'object' ? error : {};
  return {
    name: String(source.name || 'Error').slice(0, 120),
    message: String(source.message || error || fallback).slice(0, 4_000),
    code: String(source.code || '').slice(0, 160)
  };
}

function encodeProtocolMessage(message) {
  return `${PROTOCOL_PREFIX}${JSON.stringify(message)}\n`;
}

function decodeProtocolLine(line) {
  const text = String(line || '');
  const prefixIndex = text.indexOf(PROTOCOL_PREFIX);
  if (prefixIndex < 0) return null;
  const payload = text.slice(prefixIndex + PROTOCOL_PREFIX.length).trim();
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

module.exports = {
  PROTOCOL_PREFIX,
  PROTOCOL_VERSION,
  decodeProtocolLine,
  encodeProtocolMessage,
  serializeError
};
