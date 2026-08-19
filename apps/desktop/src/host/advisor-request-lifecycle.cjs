// Owns Advisor request cancellation, timeout propagation, and renderer-safe progress events.

'use strict';

function createAdvisorRequestLifecycle({ fetch: fetchImpl } = {}) {
  const activeRequests = new Map();

  function beginTimedFetch(timeoutMs, externalSignal) {
    const controller = new AbortController();
    const state = { timedOut: false, released: false };
    const timer = setTimeout(() => {
      state.timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abortFromExternal = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else if (typeof externalSignal.addEventListener === 'function') {
        externalSignal.addEventListener('abort', abortFromExternal, { once: true });
      }
    }
    state.signal = controller.signal;
    state.decorate = (error) => {
      if (error && error.name === 'AbortError') {
        if (state.timedOut) {
          error.cavalryTimeout = true;
        } else if (externalSignal && externalSignal.aborted) {
          error.cavalryCancelled = true;
        }
      }
      return error;
    };
    state.release = () => {
      if (state.released) return;
      state.released = true;
      clearTimeout(timer);
      if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
        externalSignal.removeEventListener('abort', abortFromExternal);
      }
    };
    return state;
  }

  async function fetchWithTimeout(url, options, timeoutMs, externalSignal) {
    const state = beginTimedFetch(timeoutMs, externalSignal);
    try {
      return await fetchImpl(url, Object.assign({}, options || {}, { signal: state.signal }));
    } catch (error) {
      throw state.decorate(error);
    } finally {
      state.release();
    }
  }

  // Streaming responses must keep the timeout and cancellation wiring attached until the
  // body is fully consumed; fetchWithTimeout releases both as soon as headers arrive.
  async function fetchStreamedWithTimeout(url, options, timeoutMs, externalSignal) {
    const state = beginTimedFetch(timeoutMs, externalSignal);
    let response;
    try {
      response = await fetchImpl(url, Object.assign({}, options || {}, { signal: state.signal }));
    } catch (error) {
      state.release();
      throw state.decorate(error);
    }
    return {
      response,
      decorate: state.decorate,
      release: state.release
    };
  }

  function sendStatus(event, status) {
    if (event && event.sender && !event.sender.isDestroyed()) {
      event.sender.send(
        'cavalry-advisor:status',
        Object.assign(
          {
            at: new Date().toISOString()
          },
          status || {}
        )
      );
    }
  }

  function normalizeRequestId(value) {
    return String(value || '')
      .replace(/[^A-Za-z0-9_.:-]+/g, '_')
      .slice(0, 120);
  }

  function createRequestState(requestId, event) {
    const id = normalizeRequestId(requestId);
    if (!id) {
      return null;
    }
    const previous = activeRequests.get(id);
    if (previous && previous.controller && !previous.controller.signal.aborted) {
      previous.controller.abort();
    }
    const state = {
      requestId: id,
      controller: new AbortController(),
      cancelled: false,
      event
    };
    activeRequests.set(id, state);
    return state;
  }

  function getRequestSignal(requestState) {
    return requestState && requestState.controller ? requestState.controller.signal : null;
  }

  function assertNotCancelled(requestState) {
    if (requestState && requestState.controller && requestState.controller.signal.aborted) {
      const error = new Error('Cavalry request was cancelled.');
      error.name = 'AbortError';
      error.cavalryCancelled = true;
      throw error;
    }
  }

  function finishRequestState(requestState) {
    if (requestState && activeRequests.get(requestState.requestId) === requestState) {
      activeRequests.delete(requestState.requestId);
    }
  }

  function cancelRequest(requestId, event) {
    const id = normalizeRequestId(requestId);
    const requestState = id ? activeRequests.get(id) : null;
    if (!requestState) {
      return { ok: false, cancelled: false, notFound: true, requestId: id };
    }
    requestState.cancelled = true;
    if (requestState.controller && !requestState.controller.signal.aborted) {
      requestState.controller.abort();
    }
    sendStatus(requestState.event || event, {
      phase: 'cancelled',
      requestId: id,
      message: 'Cavalry request cancelled.',
      progressPercent: 100
    });
    return { ok: true, cancelled: true, requestId: id };
  }

  function isCancellationError(error) {
    return !!(
      error &&
      (error.cavalryCancelled ||
        (error.name === 'AbortError' && /cancel/i.test(String(error.message || ''))))
    );
  }

  function isTimeoutError(error) {
    return !!(
      error &&
      (error.cavalryTimeout || (error.name === 'AbortError' && !isCancellationError(error)))
    );
  }

  return {
    assertNotCancelled,
    cancelRequest,
    createRequestState,
    fetchStreamedWithTimeout,
    fetchWithTimeout,
    finishRequestState,
    getRequestSignal,
    isCancellationError,
    isTimeoutError,
    normalizeRequestId,
    sendStatus
  };
}

module.exports = {
  createAdvisorRequestLifecycle
};
