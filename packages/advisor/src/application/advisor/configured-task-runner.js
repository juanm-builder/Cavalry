export const ADVISOR_TASK_EVENT_TYPES = Object.freeze({
  REQUESTING_MODEL: 'requesting_model',
  PARSING: 'parsing',
  VALIDATING: 'validating',
  REPAIRING: 'repairing',
  RETRYING: 'retrying'
});

function callIfFunction(fn, ...args) {
  return typeof fn === 'function' ? fn(...args) : undefined;
}

function normalizeModelError(result, fallback) {
  if (result && result.error) {
    return String(result.error);
  }
  return fallback || 'The configured model did not return an answer.';
}

function buildInvalidFormatRetryMessage(error) {
  return [
    'Revise the answer before showing it to the user.',
    '- invalid_format: ' +
      String(error && error.message ? error.message : 'The model response could not be parsed.'),
    'Use only the provided advisor packet and return the required format.'
  ].join('\n');
}

function appendRetryMessages(messages, modelText, retryInstruction) {
  return (messages || []).concat([
    {
      role: 'assistant',
      content: String(modelText || '').slice(0, 2400)
    },
    {
      role: 'user',
      content: String(retryInstruction || '')
    }
  ]);
}

function getValidationIssueCodes(validation) {
  return (validation && Array.isArray(validation.issues) ? validation.issues : [])
    .map((issue) => String(issue && issue.code ? issue.code : '').trim())
    .filter(Boolean);
}

function getValidationErrorMessage(validation) {
  const codes = getValidationIssueCodes(validation);
  return (
    'Model answer failed Cavalry validation: ' +
    (codes.length ? codes.join(', ') : 'invalid_answer')
  );
}

function sanitizeModelOutputExcerpt(text, limit = 420) {
  const cleaned = String(text || '')
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/\s+/g, ' '))
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > limit ? cleaned.slice(0, limit - 1) + '…' : cleaned;
}

function isCancellationError(error) {
  return !!(
    error &&
    (error.cancelled ||
      error.name === 'AbortError' ||
      /cancelled|canceled/i.test(String(error.message || '')))
  );
}

export async function runConfiguredAdvisorTask(config = {}) {
  const {
    requestId = '',
    traceId = '',
    messages = [],
    modelClient,
    responseFormat = null,
    generationOptions = {},
    formatResult,
    validateResult,
    repairResult,
    onEvent
  } = config;

  if (!(modelClient && typeof modelClient.chat === 'function')) {
    const failure = 'External advisor models are available in Cavalry desktop.';
    return {
      ok: false,
      error: failure,
      attempts: 0,
      modelDiagnostics: {
        schemaVersion: 'cavalry.advisor_model_diagnostics.v1',
        attempts: [],
        retryAttempted: false,
        finalFailureReason: failure,
        finalValidationIssueCodes: []
      }
    };
  }

  const emit = (type, metadata = {}) => {
    callIfFunction(onEvent, {
      requestId,
      traceId,
      type,
      metadata
    });
  };

  let attemptMessages = messages;
  let lastError = '';
  let lastValidationIssueCodes = [];
  const modelDiagnostics = {
    schemaVersion: 'cavalry.advisor_model_diagnostics.v1',
    attempts: [],
    retryAttempted: false,
    finalFailureReason: '',
    finalValidationIssueCodes: []
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retrying = attempt > 0;
    const attemptDiagnostic = {
      attempt: attempt + 1,
      retrying,
      responseMode: responseFormat ? 'json_schema' : 'prose',
      modelAttempted: true,
      transportSucceeded: false,
      parseSucceeded: false,
      validationSucceeded: false,
      validationIssueCodes: [],
      retryInstruction: '',
      failureReason: '',
      modelOutputExcerpt: ''
    };
    modelDiagnostics.attempts.push(attemptDiagnostic);
    const payload = {
      requestId,
      traceId,
      messages: attemptMessages,
      temperature: retrying
        ? (generationOptions.retryTemperature ?? 0.05)
        : (generationOptions.temperature ?? 0.1),
      top_p: generationOptions.topP ?? generationOptions.top_p ?? 0.9,
      max_tokens: generationOptions.maxTokens ?? generationOptions.max_tokens ?? 1200
    };
    if (responseFormat) {
      payload.response_format = responseFormat;
    }

    emit(ADVISOR_TASK_EVENT_TYPES.REQUESTING_MODEL, {
      attempt: attempt + 1,
      retrying,
      responseMode: responseFormat ? 'json_schema' : 'prose'
    });

    let result = null;
    try {
      result = await modelClient.chat(payload);
    } catch (error) {
      if (isCancellationError(error)) {
        attemptDiagnostic.failureReason = 'Advisor request was cancelled.';
        modelDiagnostics.finalFailureReason = attemptDiagnostic.failureReason;
        modelDiagnostics.finalValidationIssueCodes = lastValidationIssueCodes;
        return {
          ok: false,
          cancelled: true,
          error: 'Advisor request was cancelled.',
          validationIssueCodes: lastValidationIssueCodes,
          attempts: attempt + 1,
          modelDiagnostics
        };
      }
      throw error;
    }
    if (result && result.cancelled) {
      attemptDiagnostic.failureReason = normalizeModelError(
        result,
        'Advisor request was cancelled.'
      );
      modelDiagnostics.finalFailureReason = attemptDiagnostic.failureReason;
      modelDiagnostics.finalValidationIssueCodes = lastValidationIssueCodes;
      return {
        ok: false,
        cancelled: true,
        error: normalizeModelError(result, 'Advisor request was cancelled.'),
        validationIssueCodes: lastValidationIssueCodes,
        attempts: attempt + 1,
        modelDiagnostics
      };
    }
    if (!(result && result.ok && result.text)) {
      attemptDiagnostic.failureReason = normalizeModelError(result);
      modelDiagnostics.finalFailureReason = attemptDiagnostic.failureReason;
      modelDiagnostics.finalValidationIssueCodes = lastValidationIssueCodes;
      return {
        ok: false,
        error: normalizeModelError(result),
        validationIssueCodes: lastValidationIssueCodes,
        attempts: attempt + 1,
        modelDiagnostics
      };
    }
    attemptDiagnostic.transportSucceeded = true;
    attemptDiagnostic.modelOutputExcerpt = sanitizeModelOutputExcerpt(result.text);

    let formatted = null;
    emit(ADVISOR_TASK_EVENT_TYPES.PARSING, { attempt: attempt + 1 });
    try {
      formatted = formatResult(result);
      attemptDiagnostic.parseSucceeded = true;
    } catch (error) {
      lastError = String(
        error && error.message ? error.message : 'The model response could not be parsed.'
      );
      attemptDiagnostic.failureReason = lastError;
      if (attempt < 1) {
        modelDiagnostics.retryAttempted = true;
        emit(ADVISOR_TASK_EVENT_TYPES.RETRYING, {
          attempt: attempt + 1,
          reason: 'invalid_format'
        });
        attemptDiagnostic.retryInstruction = buildInvalidFormatRetryMessage(error);
        attemptMessages = appendRetryMessages(
          payload.messages,
          result.text,
          attemptDiagnostic.retryInstruction
        );
        continue;
      }
      modelDiagnostics.finalFailureReason = lastError;
      modelDiagnostics.finalValidationIssueCodes = lastValidationIssueCodes;
      return {
        ok: false,
        error: lastError,
        validationIssueCodes: lastValidationIssueCodes,
        attempts: attempt + 1,
        modelDiagnostics
      };
    }

    emit(ADVISOR_TASK_EVENT_TYPES.VALIDATING, { attempt: attempt + 1 });
    const validation = validateResult(formatted, result);
    if (validation && validation.ok) {
      attemptDiagnostic.validationSucceeded = true;
      return {
        ok: true,
        text: formatted.text,
        references: Array.isArray(formatted.references) ? formatted.references : [],
        attempts: attempt + 1,
        validationIssueCodes: [],
        rawText: result.text,
        modelDiagnostics
      };
    }

    lastValidationIssueCodes = getValidationIssueCodes(validation);
    lastError = getValidationErrorMessage(validation);
    attemptDiagnostic.validationIssueCodes = lastValidationIssueCodes;
    attemptDiagnostic.retryInstruction =
      validation && validation.retryInstruction ? validation.retryInstruction : '';
    attemptDiagnostic.failureReason = lastError;
    if (attempt < 1) {
      modelDiagnostics.retryAttempted = true;
      emit(ADVISOR_TASK_EVENT_TYPES.RETRYING, {
        attempt: attempt + 1,
        reason: 'validation_failed',
        issueCodes: getValidationIssueCodes(validation)
      });
      attemptMessages = appendRetryMessages(
        payload.messages,
        result.text,
        validation && validation.retryInstruction ? validation.retryInstruction : lastError
      );
      continue;
    }

    emit(ADVISOR_TASK_EVENT_TYPES.REPAIRING, {
      attempt: attempt + 1,
      reason: 'validation_failed',
      issueCodes: lastValidationIssueCodes
    });
    const repaired = callIfFunction(repairResult, {
      formatted,
      validation,
      modelResult: result,
      attempt: attempt + 1
    });
    if (repaired && repaired.ok && repaired.text) {
      attemptDiagnostic.validationSucceeded = true;
      return {
        ok: true,
        text: String(repaired.text || ''),
        references: Array.isArray(repaired.references) ? repaired.references : [],
        attempts: attempt + 1,
        repaired: true,
        repairPlan: repaired.repairPlan || null,
        validationIssueCodes: lastValidationIssueCodes,
        rawText: result.text,
        modelDiagnostics
      };
    }

    modelDiagnostics.finalFailureReason = lastError;
    modelDiagnostics.finalValidationIssueCodes = lastValidationIssueCodes;
    return {
      ok: false,
      error: lastError,
      validationIssueCodes: lastValidationIssueCodes,
      attempts: attempt + 1,
      modelDiagnostics
    };
  }

  modelDiagnostics.finalFailureReason =
    lastError || 'The configured model did not return a valid answer.';
  modelDiagnostics.finalValidationIssueCodes = lastValidationIssueCodes;
  return {
    ok: false,
    error: lastError || 'The configured model did not return a valid answer.',
    validationIssueCodes: lastValidationIssueCodes,
    attempts: 2,
    modelDiagnostics
  };
}
