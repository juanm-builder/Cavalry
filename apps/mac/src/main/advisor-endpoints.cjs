// Keeps pure provider URL derivation separate from IPC, fetch, and process lifecycle code.

'use strict';

const advisorSettingsDomain = require('@cavalry/advisor/domain/advisor/settings.cjs');

const CAVALRY_LOCAL_ADVISOR_ENDPOINT = advisorSettingsDomain.CAVALRY_LOCAL_ADVISOR_ENDPOINT;
const CAVALRY_LOCAL_ADVISOR_MODEL = advisorSettingsDomain.CAVALRY_LOCAL_ADVISOR_MODEL;
const OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT =
  advisorSettingsDomain.OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT ||
  advisorSettingsDomain.OPENAI_ADVISOR_ENDPOINT;
const OPENAI_ADVISOR_RESPONSES_ENDPOINT =
  advisorSettingsDomain.OPENAI_ADVISOR_RESPONSES_ENDPOINT || 'https://api.openai.com/v1/responses';

function getAdvisorEndpoint(settings = {}) {
  if (settings.provider === 'openai') {
    return (
      settings.endpoint ||
      (settings.apiMode === 'responses'
        ? OPENAI_ADVISOR_RESPONSES_ENDPOINT
        : OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT)
    );
  }
  return settings.endpoint || CAVALRY_LOCAL_ADVISOR_ENDPOINT;
}

function getAdvisorChatCompletionsEndpoint(settings = {}) {
  if (settings.provider !== 'openai') {
    return getAdvisorEndpoint(settings);
  }
  const endpoint = settings.endpoint || OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT;
  if (endpoint === OPENAI_ADVISOR_RESPONSES_ENDPOINT) {
    return OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT;
  }
  try {
    const parsed = new URL(endpoint);
    const pathName = parsed.pathname.replace(/\/+$/g, '');
    if (/\/responses$/i.test(pathName)) {
      parsed.pathname = pathName.replace(/\/responses$/i, '/chat/completions');
      parsed.search = '';
      return parsed.toString();
    }
  } catch (_error) {
    return endpoint;
  }
  return endpoint;
}

function getAdvisorResponsesEndpoint(settings = {}) {
  const endpoint =
    settings && settings.endpoint ? settings.endpoint : OPENAI_ADVISOR_RESPONSES_ENDPOINT;
  if (endpoint === OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT) {
    return OPENAI_ADVISOR_RESPONSES_ENDPOINT;
  }
  try {
    const parsed = new URL(endpoint);
    const pathName = parsed.pathname.replace(/\/+$/g, '');
    if (/\/chat\/completions$/i.test(pathName)) {
      parsed.pathname = pathName.replace(/\/chat\/completions$/i, '/responses');
      parsed.search = '';
      return parsed.toString();
    }
  } catch (_error) {
    return endpoint;
  }
  return endpoint;
}

function getAdvisorTranscriptionEndpoint(settings = {}) {
  const endpoint = getAdvisorEndpoint(settings);
  if (!endpoint) {
    throw new Error('No advisor endpoint is configured.');
  }
  const parsed = new URL(endpoint);
  const pathName = parsed.pathname.replace(/\/+$/g, '');
  if (/\/chat\/completions$/i.test(pathName)) {
    parsed.pathname = pathName.replace(/\/chat\/completions$/i, '/audio/transcriptions');
  } else if (/\/v1$/i.test(pathName)) {
    parsed.pathname = pathName + '/audio/transcriptions';
  } else if (
    settings &&
    settings.provider === 'openai' &&
    /(^|\.)openai\.com$/i.test(parsed.hostname)
  ) {
    parsed.pathname = '/v1/audio/transcriptions';
  } else {
    throw new Error('Could not derive an audio transcription endpoint from the Advisor endpoint.');
  }
  parsed.search = '';
  return parsed.toString();
}

module.exports = {
  CAVALRY_LOCAL_ADVISOR_ENDPOINT,
  CAVALRY_LOCAL_ADVISOR_MODEL,
  OPENAI_ADVISOR_CHAT_COMPLETIONS_ENDPOINT,
  OPENAI_ADVISOR_RESPONSES_ENDPOINT,
  getAdvisorChatCompletionsEndpoint,
  getAdvisorEndpoint,
  getAdvisorResponsesEndpoint,
  getAdvisorTranscriptionEndpoint
};
