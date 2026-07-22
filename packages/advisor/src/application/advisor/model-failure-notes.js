function asString(value) {
  return String(value || '').trim();
}

export const CAVALRY_ADVISOR_MODEL_FAILURE_MESSAGE =
  'I could not produce a verified Advisor answer for this request. Nothing changed in your workbook.';

export function buildAdvisorModelFailureMessage() {
  return CAVALRY_ADVISOR_MODEL_FAILURE_MESSAGE;
}

export function classifyAdvisorModelFailure(reason) {
  const text = asString(reason);
  if (!text) {
    return {
      code: 'no_model_answer',
      label: 'No model answer',
      note: 'The configured model did not return an answer.'
    };
  }

  if (
    /(insufficient[_\s-]?quota|current quota|exceeded.*quota|run out of credits|out of credits|billing|buy more credits|maximum monthly spend|monthly budget|spend limit|check your plan)/i.test(
      text
    )
  ) {
    return {
      code: 'quota_or_billing',
      label: 'Billing/credits',
      note: 'The OpenAI/API request appears blocked by quota, credits, or billing limits.'
    };
  }

  if (
    /(invalid authentication|incorrect api key|invalid api key|api key|authentication|unauthorized|401|member of an organization|organization)/i.test(
      text
    )
  ) {
    return {
      code: 'authentication',
      label: 'API key/auth',
      note: 'The OpenAI/API request appears blocked by API key or organization access.'
    };
  }

  if (
    /(model.*(not found|does not exist|invalid)|unsupported model|model is unsupported|does not have access to model|unknown model|model_not_found|404)/i.test(
      text
    )
  ) {
    return {
      code: 'model_access',
      label: 'Model access',
      note: 'The selected model is unavailable or not enabled for this API key.'
    };
  }

  if (/(rate limit|too many requests|requests too quickly|429)/i.test(text)) {
    return {
      code: 'rate_limit',
      label: 'Rate limit',
      note: 'The OpenAI/API request hit a rate limit.'
    };
  }

  if (
    /(timeout|timed out|did not answer within|network|fetch failed|econn|enotfound|server had an error|overloaded|503|500)/i.test(
      text
    )
  ) {
    return {
      code: 'network_or_timeout',
      label: 'Network/timeout',
      note: 'The configured model did not answer reliably in time.'
    };
  }

  if (
    /(Model answer failed Cavalry validation|grounding checks?|unsupported_number|budget_percent_wording|liquidity|direct_mutation|internal_diagnostic)/i.test(
      text
    )
  ) {
    return {
      code: 'grounding_validation',
      label: 'Grounding check',
      note: 'The model answer did not pass Cavalry grounding checks.'
    };
  }

  if (
    /(valid Cavalry advisor JSON|did not match Cavalry advisor JSON|required cleanup JSON|cleanup JSON|response_format|json_schema|schema|grammar|model response|could not be parsed|invalid_format|return.*JSON|did not include a message)/i.test(
      text
    )
  ) {
    return {
      code: 'response_format',
      label: 'Response format',
      note: "The configured model answered, but it did not match Cavalry's required response format."
    };
  }

  if (
    /(configured model did not return an answer|configured model failed|External advisor models)/i.test(
      text
    )
  ) {
    return {
      code: 'provider_unavailable',
      label: 'Model unavailable',
      note: text
    };
  }

  return {
    code: 'unsafe_or_unknown',
    label: 'Model fallback',
    note: 'The configured model could not be used safely.'
  };
}

export function getPublicAdvisorModelNote(reason) {
  return classifyAdvisorModelFailure(reason).note;
}

export function getAdvisorModelFailureLabel(reasonOrCode) {
  const value = asString(reasonOrCode);
  if (!value) {
    return 'Model fallback';
  }
  const directLabels = {
    no_model_answer: 'No model answer',
    quota_or_billing: 'Billing/credits',
    authentication: 'API key/auth',
    model_access: 'Model access',
    rate_limit: 'Rate limit',
    network_or_timeout: 'Network/timeout',
    grounding_validation: 'Grounding check',
    response_format: 'Response format',
    provider_unavailable: 'Model unavailable',
    unsafe_or_unknown: 'Model fallback'
  };
  if (directLabels[value]) {
    return directLabels[value];
  }
  return classifyAdvisorModelFailure(value).label;
}

export function appendAdvisorFallbackNote(answer, reason, { prefix = 'Advisor note' } = {}) {
  const base = asString(answer);
  const note = getPublicAdvisorModelNote(reason);
  if (!note) {
    return base;
  }
  if (!base) {
    return note;
  }
  if (base.includes(note)) {
    return base;
  }
  return base + '\n\n' + prefix + ': ' + note;
}
