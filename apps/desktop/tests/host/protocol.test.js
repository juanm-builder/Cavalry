import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PROTOCOL_PREFIX,
  PROTOCOL_VERSION,
  decodeProtocolLine,
  encodeProtocolMessage,
  serializeError
} = require('../../src/host/runtime/protocol.cjs');

describe('Tauri host sidecar protocol', () => {
  it('encodes one versioned JSON message per line', () => {
    const encoded = encodeProtocolMessage({ version: PROTOCOL_VERSION, type: 'ready' });
    expect(encoded.startsWith(PROTOCOL_PREFIX)).toBe(true);
    expect(encoded.endsWith('\n')).toBe(true);
    expect(decodeProtocolLine(encoded)).toEqual({ version: 1, type: 'ready' });
  });

  it('ignores ordinary host logs and malformed protocol data', () => {
    expect(decodeProtocolLine('host started')).toBeNull();
    expect(decodeProtocolLine(`${PROTOCOL_PREFIX}{not-json}`)).toBeNull();
    expect(decodeProtocolLine(`${PROTOCOL_PREFIX}[]`)).toBeNull();
  });

  it('extracts a bounded serializable error without leaking arbitrary properties', () => {
    const error = Object.assign(new Error('request failed'), {
      code: 'CAVALRY_TEST',
      secret: 'do-not-copy'
    });
    expect(serializeError(error)).toEqual({
      name: 'Error',
      message: 'request failed',
      code: 'CAVALRY_TEST'
    });
  });
});
