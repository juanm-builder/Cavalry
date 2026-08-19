import { describe, expect, it, vi } from 'vitest';

const {
  isEventStream,
  isRetryableStatus,
  isRetryableTransportError,
  readChatCompletionStream,
  readResponsesStream
} = require('../../src/host/advisor-stream-transport.cjs');

function sseResponse(frames, { ok = true, contentType = 'text/event-stream' } = {}) {
  const encoder = new TextEncoder();
  const chunks = frames.map((frame) => encoder.encode(frame));
  let index = 0;
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : '') },
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
        releaseLock: () => {}
      })
    }
  };
}

function dataFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe('advisor stream transport', () => {
  it('detects event-stream responses', () => {
    expect(isEventStream(sseResponse([]))).toBe(true);
    expect(isEventStream(sseResponse([], { contentType: 'application/json' }))).toBe(false);
    expect(isEventStream(null)).toBe(false);
  });

  it('accumulates chat completion text deltas and reports each one', async () => {
    const response = sseResponse([
      dataFrame({ choices: [{ delta: { role: 'assistant', content: 'Your ' } }] }),
      dataFrame({ choices: [{ delta: { content: 'balance ' } }] }),
      dataFrame({ choices: [{ delta: { content: 'is steady.' }, finish_reason: 'stop' }] }),
      dataFrame({ usage: { total_tokens: 42 }, choices: [] }),
      'data: [DONE]\n\n'
    ]);
    const onDelta = vi.fn();

    const collected = await readChatCompletionStream(response, onDelta);

    expect(collected.content).toBe('Your balance is steady.');
    expect(collected.role).toBe('assistant');
    expect(collected.finishReason).toBe('stop');
    expect(collected.usage).toEqual({ total_tokens: 42 });
    expect(onDelta.mock.calls.map(([delta]) => delta)).toEqual(['Your ', 'balance ', 'is steady.']);
  });

  it('assembles tool calls split across delta fragments', async () => {
    const response = sseResponse([
      dataFrame({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'search_transactions', arguments: '{"qu' }
                }
              ]
            }
          }
        ]
      }),
      dataFrame({
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: 'ery":"rent"}' } }] } }
        ]
      }),
      'data: [DONE]\n\n'
    ]);

    const collected = await readChatCompletionStream(response, () => {});

    expect(collected.toolCalls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'search_transactions', arguments: '{"query":"rent"}' }
      }
    ]);
    expect(collected.content).toBe('');
  });

  it('tolerates frames split across chunk boundaries', async () => {
    const response = sseResponse([
      'data: {"choices":[{"delta":{"content":"Par',
      'tial"}}]}\n\ndata: [DONE]\n\n'
    ]);

    const collected = await readChatCompletionStream(response, () => {});

    expect(collected.content).toBe('Partial');
  });

  it('returns the completed response object from a Responses stream', async () => {
    const response = sseResponse([
      dataFrame({ type: 'response.output_text.delta', delta: 'Hello' }),
      dataFrame({ type: 'response.output_text.delta', delta: ' there' }),
      dataFrame({
        type: 'response.completed',
        response: { id: 'resp_1', output: [{ type: 'message', content: 'Hello there' }] }
      })
    ]);
    const onDelta = vi.fn();

    const final = await readResponsesStream(response, onDelta);

    expect(final).toMatchObject({ id: 'resp_1' });
    expect(onDelta.mock.calls.map(([delta]) => delta)).toEqual(['Hello', ' there']);
  });

  it('throws when a Responses stream reports failure', async () => {
    const response = sseResponse([
      dataFrame({ type: 'response.failed', response: { error: { message: 'model overloaded' } } })
    ]);

    await expect(readResponsesStream(response, () => {})).rejects.toThrow('model overloaded');
  });

  it('classifies only transient failures as retryable', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(undefined)).toBe(false);

    expect(isRetryableTransportError(new TypeError('fetch failed'))).toBe(true);
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isRetryableTransportError(abort)).toBe(false);
    expect(isRetryableTransportError(new Error('bad request'))).toBe(false);
  });
});
