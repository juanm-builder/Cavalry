// Parses Server-Sent Event streams from chat-completions and Responses endpoints so the
// renderer can show text as the model writes it instead of waiting for the whole answer.

'use strict';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function isEventStream(response) {
  const headers = response && response.headers;
  const contentType =
    headers && typeof headers.get === 'function' ? String(headers.get('content-type') || '') : '';
  return /text\/event-stream/i.test(contentType);
}

function isRetryableStatus(status) {
  return RETRYABLE_STATUS.has(Number(status));
}

function isRetryableTransportError(error) {
  if (!error || error.name === 'AbortError') return false;
  if (error instanceof TypeError) return true;
  return Boolean(error.cause);
}

async function* readEventStream(response) {
  const body = response && response.body;
  if (!body || typeof body.getReader !== 'function') return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += typeof value === 'string' ? value : decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (data && data !== '[DONE]') {
          try {
            yield JSON.parse(data);
          } catch (_error) {
            // Ignore keep-alive comments and malformed frames.
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    if (typeof reader.releaseLock === 'function') reader.releaseLock();
  }
}

function mergeToolCallDeltas(toolCallsByIndex, deltaToolCalls) {
  (Array.isArray(deltaToolCalls) ? deltaToolCalls : []).forEach((fragment, position) => {
    if (!fragment || typeof fragment !== 'object') return;
    const index = Number.isFinite(Number(fragment.index)) ? Number(fragment.index) : position;
    const current = toolCallsByIndex.get(index) || {
      id: '',
      type: 'function',
      function: { name: '', arguments: '' }
    };
    if (fragment.id) current.id = String(fragment.id);
    if (fragment.type) current.type = String(fragment.type);
    const fragmentFunction = fragment.function || {};
    if (fragmentFunction.name) current.function.name = String(fragmentFunction.name);
    if (typeof fragmentFunction.arguments === 'string') {
      current.function.arguments += fragmentFunction.arguments;
    }
    toolCallsByIndex.set(index, current);
  });
}

// Consumes a chat-completions SSE stream into the same shape the non-streaming path returns.
async function readChatCompletionStream(response, onDelta) {
  const toolCallsByIndex = new Map();
  let content = '';
  let role = 'assistant';
  let usage = null;
  let finishReason = '';
  for await (const chunk of readEventStream(response)) {
    if (chunk.usage) usage = chunk.usage;
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
    if (!choice) continue;
    if (choice.finish_reason) finishReason = String(choice.finish_reason);
    const delta = choice.delta || choice.message || {};
    if (delta.role) role = String(delta.role);
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      if (typeof onDelta === 'function') onDelta(delta.content);
    }
    if (delta.tool_calls) mergeToolCallDeltas(toolCallsByIndex, delta.tool_calls);
  }
  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, call]) => call);
  return { content, role, toolCalls, usage, finishReason };
}

// Consumes a Responses API SSE stream and returns the final response object.
async function readResponsesStream(response, onDelta) {
  let finalResponse = null;
  let text = '';
  for await (const chunk of readEventStream(response)) {
    const type = String(chunk.type || '');
    if (type === 'response.output_text.delta' && typeof chunk.delta === 'string' && chunk.delta) {
      text += chunk.delta;
      if (typeof onDelta === 'function') onDelta(chunk.delta);
      continue;
    }
    if (type === 'response.completed' || type === 'response.incomplete') {
      finalResponse = chunk.response || finalResponse;
      continue;
    }
    if (type === 'response.failed' || type === 'error') {
      const message =
        (chunk.response && chunk.response.error && chunk.response.error.message) ||
        (chunk.error && chunk.error.message) ||
        chunk.message ||
        'The model stream failed.';
      throw new Error(String(message));
    }
    if (chunk.response && !finalResponse && type === 'response.created') {
      finalResponse = null;
    }
  }
  if (!finalResponse && text) {
    finalResponse = { output_text: text, output: [] };
  }
  return finalResponse || {};
}

function parseJsonSafe(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch (_error) {
    return null;
  }
}

function responseErrorMessage(responseText, parsedBody, status) {
  return parsedBody && parsedBody.error && parsedBody.error.message
    ? parsedBody.error.message
    : responseText || `Model request failed with HTTP ${status}.`;
}

function isOpenAIChatCompletionsEndpoint(endpoint) {
  try {
    const parsed = new URL(String(endpoint || ''));
    return (
      /(^|\.)openai\.com$/i.test(parsed.hostname) &&
      /\/v1\/chat\/completions\/?$/i.test(parsed.pathname)
    );
  } catch (_error) {
    return false;
  }
}

// OpenAI's chat-completions endpoint renamed the field; every other endpoint still wants max_tokens.
function applyOutputTokenLimit(body, settings, payload, endpoint) {
  const explicit = Number(payload && payload.max_completion_tokens);
  const legacy = Number(payload && payload.max_tokens);
  const limit =
    Number.isFinite(explicit) && explicit > 0
      ? Math.round(explicit)
      : Number.isFinite(legacy) && legacy > 0
        ? Math.round(legacy)
        : 0;
  if (!limit) return body;
  if (settings.provider === 'openai' && isOpenAIChatCompletionsEndpoint(endpoint)) {
    body.max_completion_tokens = limit;
  } else {
    body.max_tokens = limit;
  }
  return body;
}

function buildChatRequestBody({ endpoint, model, payload, settings, wantsStream }) {
  const body = {
    model,
    messages: payload.messages || [],
    temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.1
  };
  if (wantsStream) {
    body.stream = true;
    if (settings.provider === 'openai') body.stream_options = { include_usage: true };
  }
  if (typeof payload.top_p === 'number') body.top_p = payload.top_p;
  applyOutputTokenLimit(body, settings, payload, endpoint);
  if (payload.response_format) body.response_format = payload.response_format;
  if (Array.isArray(payload.tools)) body.tools = payload.tools;
  ['tool_choice', 'parallel_tool_calls'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) body[key] = payload[key];
  });
  return body;
}

// A timeout is reported as a timeout; a user cancellation stays a cancellation. Neither is
// allowed to claim that some other calculation stood in for the model.
function createRequestFailureRethrower(requestState) {
  return function rethrowRequestFailure(error) {
    if (error && error.name === 'AbortError') {
      if (
        error.cavalryCancelled ||
        (requestState && requestState.controller && requestState.controller.signal.aborted)
      ) {
        throw error;
      }
      throw new Error(
        'The model did not answer within 5 minutes. Try again, or check the model connection in Settings.'
      );
    }
    throw error;
  };
}

function openAiUnreachableError(error) {
  const reason = String((error && (error.cause?.message || error.message)) || '').trim();
  return new Error(
    `Could not reach the OpenAI API. Check your internet connection and try again${reason ? ` (${reason}).` : '.'}`
  );
}

// Shapes both the streamed and buffered chat results into the one contract the renderer reads.
function finalizeChatResult(responseMessage, usage, payload) {
  const content = responseMessage ? responseMessage.content : '';
  const answer = content == null ? '' : String(content);
  const toolCalls = Array.isArray(responseMessage && responseMessage.tool_calls)
    ? responseMessage.tool_calls
    : [];
  const returnMessage = payload && payload.returnMessage === true;
  if (!answer && !(returnMessage && toolCalls.length)) {
    throw new Error('The model response did not include a message.');
  }
  if (returnMessage) {
    return {
      text: answer,
      message: {
        role: String((responseMessage && responseMessage.role) || 'assistant'),
        content,
        tool_calls: toolCalls
      },
      usage: usage || null
    };
  }
  return answer;
}

// Retries only cover failures before any bytes reached the user: a transient 429/5xx or a
// network blip. Never an abort, and never once a stream has started emitting.
function createRetryingPost({ delay, retryDelaysMs }) {
  return async function postWithRetry(send) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await send();
        if (
          attempt < retryDelaysMs.length &&
          !(response && response.ok) &&
          isRetryableStatus(response && response.status)
        ) {
          await delay(retryDelaysMs[attempt]);
          continue;
        }
        return response;
      } catch (error) {
        if (attempt < retryDelaysMs.length && isRetryableTransportError(error)) {
          await delay(retryDelaysMs[attempt]);
          continue;
        }
        throw error;
      }
    }
  };
}

// Binds the SSE readers to one controller's request lifecycle so the runtime controller only
// has to decide whether a turn wants streaming, not how streaming works.
function createAdvisorStreamRunners({ fetchStreamedWithTimeout, sendStatus, timeoutMs }) {
  function emitDelta(event, requestState, delta) {
    sendStatus(event, {
      phase: 'stream',
      requestId: requestState ? requestState.requestId : '',
      delta
    });
  }

  // Returns { handled: false } when the endpoint declined to stream, so the caller can retry
  // the same turn buffered. Nothing has reached the user at that point.
  async function streamChatCompletion({
    body,
    endpoint,
    event,
    requestInit,
    requestSignal,
    requestState,
    rethrowRequestFailure
  }) {
    let streamed = null;
    try {
      streamed = await fetchStreamedWithTimeout(
        endpoint,
        requestInit(body),
        timeoutMs,
        requestSignal
      );
    } catch (error) {
      rethrowRequestFailure(error);
    }
    const response = streamed.response;
    if (!response.ok || !isEventStream(response)) {
      streamed.release();
      return { handled: false };
    }
    let emitted = false;
    try {
      const collected = await readChatCompletionStream(response, (delta) => {
        emitted = true;
        emitDelta(event, requestState, delta);
      });
      return {
        handled: true,
        message: {
          role: collected.role,
          content: collected.content,
          tool_calls: collected.toolCalls
        },
        usage: collected.usage
      };
    } catch (error) {
      if (!emitted && !(error && error.name === 'AbortError')) return { handled: false };
      rethrowRequestFailure(streamed.decorate(error));
      throw error;
    } finally {
      streamed.release();
    }
  }

  async function streamAgentTurn({
    endpoint,
    event,
    requestInit,
    requestSignal,
    requestState,
    unreachable
  }) {
    let streamed = null;
    try {
      streamed = await fetchStreamedWithTimeout(endpoint, requestInit(), timeoutMs, requestSignal);
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      throw unreachable(error);
    }
    const response = streamed.response;
    if (!response.ok || !isEventStream(response)) {
      streamed.release();
      return { handled: false };
    }
    let emitted = false;
    try {
      const finalResponse = await readResponsesStream(response, (delta) => {
        emitted = true;
        emitDelta(event, requestState, delta);
      });
      return { handled: true, response: finalResponse };
    } catch (error) {
      if (!emitted && !(error && error.name === 'AbortError')) return { handled: false };
      throw streamed.decorate(error);
    } finally {
      streamed.release();
    }
  }

  return { streamAgentTurn, streamChatCompletion };
}

module.exports = {
  applyOutputTokenLimit,
  buildChatRequestBody,
  createAdvisorStreamRunners,
  createRequestFailureRethrower,
  createRetryingPost,
  openAiUnreachableError,
  finalizeChatResult,
  isEventStream,
  isOpenAIChatCompletionsEndpoint,
  parseJsonSafe,
  responseErrorMessage,
  isRetryableStatus,
  isRetryableTransportError,
  readChatCompletionStream,
  readEventStream,
  readResponsesStream
};
