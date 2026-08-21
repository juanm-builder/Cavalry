import { describe, expect, it, vi } from 'vitest';

const {
  isEventStream,
  isRetryableStatus,
  isRetryableTransportError,
  openAiUnreachableError,
  readChatCompletionStream,
  readResponsesStream,
  responseErrorMessage
} = require('../../src/host/advisor-stream-transport.cjs');

function sseResponse(frames, { ok = true, contentType = 'text/event-stream' } = {}) {
  const encoder = new TextEncoder();
  const chunks = frames.map((frame) => (typeof frame === 'string' ? encoder.encode(frame) : frame));
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

  it('buffers a terminal chat completion before publishing public text', async () => {
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
    expect(onDelta).toHaveBeenCalledOnce();
    expect(onDelta).toHaveBeenCalledWith('Your balance is steady.', {
      final: true,
      reset: true
    });
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

    const onDelta = vi.fn();
    const collected = await readChatCompletionStream(response, onDelta);

    expect(collected.toolCalls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'search_transactions', arguments: '{"query":"rent"}' }
      }
    ]);
    expect(collected.content).toBe('');
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('discards a chat tool-call preamble instead of exposing it as final text', async () => {
    const response = sseResponse([
      dataFrame({ choices: [{ delta: { content: 'I will update that now.' } }] }),
      dataFrame({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'update_transaction', arguments: '{}' }
                }
              ]
            }
          }
        ]
      }),
      'data: [DONE]\n\n'
    ]);
    const onDelta = vi.fn();

    const collected = await readChatCompletionStream(response, onDelta);

    expect(collected.content).toBe('I will update that now.');
    expect(collected.toolCalls).toHaveLength(1);
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('tolerates frames split across chunk boundaries', async () => {
    const response = sseResponse([
      'data: {"choices":[{"delta":{"content":"Par',
      'tial"}}]}\n\ndata: [DONE]\n\n'
    ]);

    const collected = await readChatCompletionStream(response, () => {});

    expect(collected.content).toBe('Partial');
  });

  it('parses byte-split CRLF, LF, CR, and unterminated final frames', async () => {
    const encoder = new TextEncoder();
    const frame = (content, boundary) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}${boundary}`;
    const wire = [
      frame('A', '\r\n\r\n'),
      frame('é', '\n\n'),
      frame('中', '\r\r'),
      `data: ${JSON.stringify({
        choices: [{ delta: { content: '!', role: 'assistant' }, finish_reason: 'stop' }]
      })}`
    ].join('');
    const encoded = encoder.encode(wire);
    const response = sseResponse(
      Array.from({ length: encoded.length }, (_unused, index) => encoded.slice(index, index + 1))
    );

    const collected = await readChatCompletionStream(response, () => {});

    expect(collected).toMatchObject({
      content: 'Aé中!',
      role: 'assistant',
      finishReason: 'stop'
    });
  });

  it('rejects a truncated Chat stream before publishing partial text', async () => {
    const response = sseResponse([
      dataFrame({ choices: [{ delta: { role: 'assistant', content: 'Partial answer' } }] })
    ]);
    const onDelta = vi.fn();

    await expect(readChatCompletionStream(response, onDelta)).rejects.toThrow('before completing');
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('does not publish Chat output stopped by an output limit or content filter', async () => {
    for (const finishReason of ['length', 'content_filter']) {
      const response = sseResponse([
        dataFrame({
          choices: [{ delta: { content: 'Incomplete answer' }, finish_reason: finishReason }]
        }),
        'data: [DONE]\n\n'
      ]);
      const onDelta = vi.fn();

      await expect(readChatCompletionStream(response, onDelta)).rejects.toThrow(
        'before completing'
      );
      expect(onDelta).not.toHaveBeenCalled();
    }
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
    expect(onDelta.mock.calls).toEqual([
      ['Hello', { final: false, reset: true }],
      [' there', { final: false, reset: false }]
    ]);
  });

  it('does not publish Responses text from an invocation that also calls a tool', async () => {
    const response = sseResponse([
      dataFrame({ type: 'response.output_text.delta', delta: 'Checking that now.' }),
      dataFrame({
        type: 'response.completed',
        response: { id: 'resp_tool', output: [{ type: 'function_call', name: 'inspect' }] }
      })
    ]);
    const onDelta = vi.fn();

    await readResponsesStream(response, onDelta);

    expect(onDelta.mock.calls).toEqual([
      ['Checking that now.', { final: false, reset: true }],
      ['', { final: true, reset: true }]
    ]);
  });

  it('throws when a Responses stream reports failure', async () => {
    const response = sseResponse([
      dataFrame({ type: 'response.failed', response: { error: { message: 'model overloaded' } } })
    ]);

    const onDelta = vi.fn();
    await expect(readResponsesStream(response, onDelta)).rejects.toThrow('model overloaded');
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('clears live Responses text when the stream fails after publishing a delta', async () => {
    const response = sseResponse([
      dataFrame({ type: 'response.output_text.delta', delta: 'Partial answer' }),
      dataFrame({ type: 'response.failed', response: { error: { message: 'model overloaded' } } })
    ]);
    const onDelta = vi.fn();

    await expect(readResponsesStream(response, onDelta)).rejects.toThrow('model overloaded');
    expect(onDelta.mock.calls).toEqual([
      ['Partial answer', { final: false, reset: true }],
      ['', { final: true, reset: true }]
    ]);
  });

  it('clears live Responses text when the stream is incomplete or ends without a final event', async () => {
    const incompleteDelta = dataFrame({
      type: 'response.output_text.delta',
      delta: 'An unfinished answer'
    });
    const cases = [
      sseResponse([
        incompleteDelta,
        dataFrame({
          type: 'response.incomplete',
          response: { incomplete_details: { reason: 'max_output_tokens' } }
        })
      ]),
      sseResponse([incompleteDelta])
    ];

    for (const response of cases) {
      const onDelta = vi.fn();
      await expect(readResponsesStream(response, onDelta)).rejects.toThrow(/before completing/);
      expect(onDelta.mock.calls).toEqual([
        ['An unfinished answer', { final: false, reset: true }],
        ['', { final: true, reset: true }]
      ]);
    }
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

  it('never exposes an unparsed provider body or transport cause as user-facing error text', () => {
    const fakeSecret = ['sk', 'private-provider-token'].join('-');
    const rawBody = '<html><body>PRIVATE_GATEWAY_BODY</body></html>\nstack at /private/path';
    const publicMessage = responseErrorMessage(rawBody, null, 502);
    expect(publicMessage).toBe(
      'The model provider is temporarily unavailable. Try again in a moment.'
    );
    expect(publicMessage).not.toMatch(/PRIVATE_GATEWAY_BODY|private\/path|stack/i);

    const parsedMessage = responseErrorMessage(
      '',
      {
        error: {
          message: `Bad request for api_key=${fakeSecret}\n at /private/stack.js:1`
        }
      },
      400
    );
    expect(parsedMessage).toContain('Bad request');
    expect(parsedMessage).toContain('[redacted]');
    expect(parsedMessage).not.toContain(fakeSecret);
    expect(parsedMessage).not.toMatch(/private\/stack/);

    expect(openAiUnreachableError(new Error('connect failed at /private/socket')).message).toBe(
      'Could not reach the OpenAI API. Check your internet connection and try again.'
    );
  });
});
