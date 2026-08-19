// Validates Advisor audio and performs provider transcription without owning IPC registration.

'use strict';

const ADVISOR_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';
const OPENAI_TRANSCRIPTION_SOURCE_ENDPOINT = 'https://api.openai.com/v1/responses';
const ADVISOR_TRANSCRIPTION_MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const ADVISOR_TRANSCRIPTION_PROMPT =
  'Transcribe a personal finance transaction entry with dates, merchants, amounts, accounts, and categories.';

function normalizeAudioBase64(value) {
  const raw = String(value || '').trim();
  const commaIndex = raw.indexOf(',');
  return commaIndex >= 0 && /^data:audio\//i.test(raw.slice(0, commaIndex))
    ? raw.slice(commaIndex + 1)
    : raw;
}

function getAudioBufferFromPayload(payload) {
  const base64 = normalizeAudioBase64(payload && payload.audioBase64);
  if (!base64) {
    throw new Error('No audio was provided for transcription.');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error('The audio recording was empty.');
  }
  if (buffer.length > ADVISOR_TRANSCRIPTION_MAX_AUDIO_BYTES) {
    throw new Error('The audio recording is too large to transcribe.');
  }
  return buffer;
}

function buildAdvisorTranscriptionFormData(payload, model) {
  if (typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw new Error('This runtime does not support audio upload form data.');
  }
  const buffer = getAudioBufferFromPayload(payload || {});
  const mimeType = String((payload && payload.mimeType) || 'audio/webm').trim() || 'audio/webm';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), 'advisor-voice.webm');
  form.append('model', model || ADVISOR_TRANSCRIPTION_MODEL);
  form.append('response_format', 'text');
  const prompt = String((payload && payload.prompt) || ADVISOR_TRANSCRIPTION_PROMPT).trim();
  if (prompt) {
    form.append('prompt', prompt);
  }
  const language = String((payload && payload.language) || '').trim();
  if (language) {
    form.append('language', language);
  }
  return form;
}

function createAdvisorTranscriptionRuntime({
  getTranscriptionEndpoint,
  normalizeSettings,
  requestLifecycle,
  requestTimeoutMs
} = {}) {
  async function callAdvisorTranscription(settings, payload, event, dependencies) {
    const requestState = requestLifecycle.createRequestState(payload && payload.requestId, event);
    const transport =
      dependencies && dependencies.fetchWithTimeout
        ? dependencies.fetchWithTimeout
        : requestLifecycle.fetchWithTimeout;
    try {
      const normalized = normalizeSettings(settings || {});
      if (!normalized.apiKey) {
        throw new Error('Add an OpenAI API key before using Companion voice input.');
      }
      const transcriptionSettings =
        normalized.provider === 'openai'
          ? normalized
          : {
              ...normalized,
              provider: 'openai',
              endpoint: OPENAI_TRANSCRIPTION_SOURCE_ENDPOINT
            };
      const endpoint = getTranscriptionEndpoint(transcriptionSettings);
      requestLifecycle.assertNotCancelled(requestState);
      requestLifecycle.sendStatus(event, {
        phase: 'request',
        requestId: requestState ? requestState.requestId : '',
        message: 'Transcribing voice input.',
        progressPercent: 35
      });
      const response = await transport(
        endpoint,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${normalized.apiKey}`
          },
          body: buildAdvisorTranscriptionFormData(payload || {}, ADVISOR_TRANSCRIPTION_MODEL)
        },
        requestTimeoutMs,
        requestLifecycle.getRequestSignal(requestState)
      );
      requestLifecycle.sendStatus(event, {
        phase: 'response',
        requestId: requestState ? requestState.requestId : '',
        message: 'Voice transcription received.',
        progressPercent: 100
      });
      const responseText = await response.text();
      let parsed = null;
      try {
        parsed = responseText ? JSON.parse(responseText) : null;
      } catch (_error) {
        parsed = null;
      }
      if (!response.ok) {
        const message =
          parsed && parsed.error && parsed.error.message
            ? parsed.error.message
            : responseText || `Voice transcription failed with HTTP ${response.status}.`;
        throw new Error(message);
      }
      const transcript = parsed && parsed.text ? parsed.text : responseText;
      if (!String(transcript || '').trim()) {
        throw new Error('The transcription response did not include text.');
      }
      return String(transcript).trim();
    } finally {
      requestLifecycle.finishRequestState(requestState);
    }
  }

  return {
    callAdvisorTranscription
  };
}

module.exports = {
  ADVISOR_TRANSCRIPTION_MODEL,
  ADVISOR_TRANSCRIPTION_PROMPT,
  buildAdvisorTranscriptionFormData,
  createAdvisorTranscriptionRuntime
};
