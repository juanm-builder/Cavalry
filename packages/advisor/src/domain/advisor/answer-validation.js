function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function moneyNumberKey(value) {
  const cleaned = String(value || '').replace(/[^\d.-]+/g, '');
  if (!cleaned) {
    return '';
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) {
    return '';
  }
  return Math.abs(numeric).toFixed(2);
}

function collectAllowedMoneyKeys(value, allowed) {
  if (value === null || value === undefined) {
    return allowed;
  }
  if (typeof value === 'number') {
    const key = moneyNumberKey(value);
    if (key) allowed[key] = true;
    return allowed;
  }
  if (typeof value === 'string') {
    const moneyMatches = value.match(/(?:\u20b1|PHP\s*)?-?\d[\d,]*(?:\.\d+)?/gi) || [];
    moneyMatches.forEach((match) => {
      const key = moneyNumberKey(match);
      if (key) allowed[key] = true;
    });
    return allowed;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectAllowedMoneyKeys(item, allowed));
    return allowed;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      collectAllowedMoneyKeys(value[key], allowed);
    });
  }
  return allowed;
}

function extractAnswerMoneyKeys(text) {
  return (String(text || '').match(/(?:\u20b1|PHP\s*)-?\s?\d[\d,]*(?:\.\d+)?/gi) || [])
    .map((match) => moneyNumberKey(match))
    .filter(Boolean);
}

function containsMarkdownTable(text) {
  const lines = String(text || '').split(/\r?\n/);
  return lines.some(
    (line, index) =>
      /\|/.test(line) &&
      index + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  );
}

function getTaskSpec(summary, taskSpec) {
  return taskSpec || (summary && (summary.task_spec || summary.taskSpec)) || {};
}

function getTaskDateScope(summary, taskSpec) {
  const spec = getTaskSpec(summary, taskSpec);
  return (
    spec.dateScope ||
    (summary &&
      summary.scope && {
        start: summary.scope.period_start,
        end: summary.scope.period_end,
        label: summary.scope.period_label || '',
        source: summary.scope.scope_source || 'summary'
      }) ||
    {}
  );
}

function addIssue(issues, code, message) {
  issues.push({ code, message });
}

function validateDateScope(text, summary, taskSpec, issues) {
  const scope = getTaskDateScope(summary, taskSpec);
  const normalized = normalizeText(text);
  if (!(scope && scope.start && scope.end)) {
    return;
  }
  const scopeSource = String(scope.source || '');
  const scopeType = String(scope.type || '');
  const isScopedPrompt = scopeSource === 'prompt' || (scopeType && scopeType !== 'visible_range');
  if (!isScopedPrompt) {
    return;
  }
  if (
    scope.start !== '2026-04-01' &&
    /\bApril\s+1(?:,?\s+2026)?\s*(?:to|-|through)\s+June\s+19(?:,?\s+2026)?\b/i.test(normalized)
  ) {
    addIssue(
      issues,
      'wrong_date_range',
      'Answer used the broad April 1 to June 19 range instead of the task date scope.'
    );
  }
  if (scope.start !== '2026-04-01' && /\bfrom\s+April\s+1\b/i.test(normalized)) {
    addIssue(
      issues,
      'wrong_date_range',
      'Answer opened with a broad April start even though the task requested a narrower scope.'
    );
  }
  if (
    /\bselected range\b|\bvisible range\b|\bfull selected range\b/i.test(normalized) &&
    scopeSource === 'prompt'
  ) {
    addIssue(
      issues,
      'generic_scope_language',
      'Answer used generic selected-range language for a specifically scoped request.'
    );
  }
}

function validateSupportedNumbers(text, summary, issues) {
  const allowed = collectAllowedMoneyKeys(summary || {}, {});
  const answerMoney = extractAnswerMoneyKeys(text);
  const unsupported = answerMoney.filter((key) => key && !allowed[key]);
  const uniqueUnsupported = Array.from(new Set(unsupported));
  if (uniqueUnsupported.length) {
    addIssue(
      issues,
      'unsupported_number',
      'Answer cited money amounts not present in the advisor packet: ' +
        uniqueUnsupported.slice(0, 4).join(', ') +
        '.'
    );
  }
}

function validateTableLeakage(text, taskSpec, issues) {
  const spec = getTaskSpec(null, taskSpec);
  const tableAllowed =
    !!(spec.answerPlan && spec.answerPlan.tableAllowed) || spec.outputMode === 'table';
  if (!tableAllowed && containsMarkdownTable(text)) {
    addIssue(
      issues,
      'table_leakage',
      'Answer included a transaction-style Markdown table even though this task asked for analysis.'
    );
  }
}

function validateSmallTalkDisclaimer(text, summary, taskSpec, issues) {
  const spec = getTaskSpec(summary, taskSpec);
  const intent = String(
    spec.intent || (summary && (summary.target_intent || summary.intent)) || ''
  );
  if (['greeting', 'small_talk', 'transaction_capability'].indexOf(intent) < 0) {
    return;
  }
  if (
    /(not|isn't|is not).{0,50}(tax|legal|investment|financial) advice/i.test(text) ||
    /educational summary/i.test(text)
  ) {
    addIssue(
      issues,
      'unneeded_disclaimer',
      'Answer added a financial disclaimer to a conversational turn.'
    );
  }
}

function validateRepeatedDisclaimer(text, issues) {
  const segments = String(text || '')
    .split(/\n{2,}|\r?\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const disclaimerSegments = segments.filter(
    (segment) =>
      /educational summary/i.test(segment) ||
      /(not|isn't|is not).{0,100}(financial|tax|legal|investment).{0,100}advice/i.test(segment) ||
      /(financial|tax|legal|investment).{0,100}advice/i.test(segment)
  );
  if (disclaimerSegments.length > 1) {
    addIssue(issues, 'repeated_disclaimer', 'Answer repeated the educational disclaimer.');
  }
}

function validateMetricConfusion(text, summary, issues) {
  const normalized = normalizeText(text);
  const net =
    summary &&
    summary.computed &&
    summary.computed.cashflow_period &&
    summary.computed.cashflow_period.net_cashflow
      ? moneyNumberKey(summary.computed.cashflow_period.net_cashflow.amount)
      : '';
  if (net) {
    const netPattern = new RegExp(
      '(?:\\u20b1|PHP\\s*)-?\\s?' + net.replace('.', '\\.').replace(/\B(?=(\d{3})+(?!\d))/g, ',?'),
      'i'
    );
    if (
      netPattern.test(normalized) &&
      /(?:total\s+spending\s+figure|spending\s+figure|of\s+your\s+spending|of\s+total\s+spending).{0,90}(?:transfer|internal|non-expense|debt)/i.test(
        normalized
      )
    ) {
      addIssue(
        issues,
        'metric_confusion',
        'Answer appears to describe net cash flow as spending or non-expense spending.'
      );
    }
  }
  if (/net cash flow.{0,40}(?:spending|expenses only|expense total)/i.test(normalized)) {
    addIssue(
      issues,
      'metric_confusion',
      'Answer mixed net cash flow with spending or expense totals.'
    );
  }
}

function validateLiquidityFraming(text, summary, issues) {
  const months =
    summary &&
    summary.computed &&
    summary.computed.liquidity &&
    summary.computed.liquidity.emergency_fund_months
      ? Number(summary.computed.liquidity.emergency_fund_months.value)
      : NaN;
  if (!(Number.isFinite(months) && months > 0 && months < 3)) {
    return;
  }
  const normalized = normalizeText(text);
  if (
    /(liquid|liquidity|cash buffer|emergency fund|buffer).{0,120}\b(healthy|strong|comfortable|solid|excellent|good)\b/i.test(
      normalized
    ) ||
    /\b(healthy|strong|comfortable|solid|excellent|good)\b.{0,120}(liquid|liquidity|cash buffer|emergency fund|buffer)/i.test(
      normalized
    )
  ) {
    addIssue(
      issues,
      'liquidity_overstatement',
      'Answer called a below-3-month cash buffer healthy or strong.'
    );
  }
}

function getPrimaryAdvisorPacket(summary) {
  const packets = summary && summary.data_packets ? summary.data_packets : {};
  const preferred = [
    'account_snapshot',
    'category_inventory',
    'transaction_analysis',
    'transaction_list',
    'categorization_review',
    'transaction_net_worth_impact'
  ];
  for (let index = 0; index < preferred.length; index += 1) {
    if (packets[preferred[index]]) {
      return packets[preferred[index]];
    }
  }
  const keys = Object.keys(packets);
  return keys.length ? packets[keys[0]] : null;
}

function getPacketMoneyAmount(packet, path) {
  const parts = String(path || '').split('.');
  let current = packet;
  for (let index = 0; index < parts.length; index += 1) {
    current = current && current[parts[index]];
  }
  return current &&
    typeof current === 'object' &&
    Object.prototype.hasOwnProperty.call(current, 'amount')
    ? moneyNumberKey(current.amount)
    : moneyNumberKey(current);
}

function moneyPatternForKey(key) {
  const normalized = String(key || '');
  if (!normalized) {
    return null;
  }
  const parts = normalized.split('.');
  const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',?');
  const decimal = parts[1] ? '\\.' + parts[1] : '(?:\\.00)?';
  return new RegExp('(?:\\u20b1|PHP\\s*)-?\\s?' + whole + decimal, 'i');
}

function validateFinancialSemanticLanguage(text, summary, issues) {
  const normalized = normalizeText(text);
  const analysisPacket =
    summary && summary.data_packets && summary.data_packets.transaction_analysis;
  if (!analysisPacket) {
    return;
  }
  const debtKey = getPacketMoneyAmount(analysisPacket, 'totals.selected_period_debt_payments');
  const totalOutflowKey = getPacketMoneyAmount(
    analysisPacket,
    'totals.selected_period_total_outflow'
  );
  const consumptionKey = getPacketMoneyAmount(
    analysisPacket,
    'totals.selected_period_consumption_spending'
  );
  const debtPattern = moneyPatternForKey(debtKey);
  const totalOutflowPattern = moneyPatternForKey(totalOutflowKey);
  if (
    debtPattern &&
    debtPattern.test(normalized) &&
    /\b(lifestyle|habit|habits|consumption|discretionary|spending)\b.{0,80}\b(debt|principal|loan|card payment|liability payment)\b|\b(debt|principal|loan|card payment|liability payment)\b.{0,80}\b(lifestyle|habit|habits|consumption|discretionary|spending)\b/i.test(
      normalized
    )
  ) {
    addIssue(
      issues,
      'debt_principal_as_spending',
      'Answer appears to treat debt principal as consumption spending.'
    );
  }
  if (
    totalOutflowPattern &&
    totalOutflowKey !== consumptionKey &&
    totalOutflowPattern.test(normalized) &&
    /\b(reduce|cut|cancel|habit|habits|lifestyle|discretionary|consumption)\b/i.test(normalized) &&
    !/\b(total outflow|cash outflow|includes debt|includes transfers|not all spending|not all lifestyle)\b/i.test(
      normalized
    )
  ) {
    addIssue(
      issues,
      'outflow_as_spending',
      'Answer used total outflow for spending advice without qualifying debt, transfers, or non-consumption rows.'
    );
  }
}

function validateRecurringAdvice(text, summary, issues) {
  const normalized = normalizeText(text);
  if (
    !/\b(cancel|drop|remove|cut|unsubscribe|pause)\b.{0,80}\b(subscription|recurring|monthly|annual)\b|\b(subscription|recurring|monthly|annual)\b.{0,80}\b(cancel|drop|remove|cut|unsubscribe|pause)\b/i.test(
      normalized
    )
  ) {
    return;
  }
  const analysisPacket =
    summary && summary.data_packets && summary.data_packets.transaction_analysis;
  const recurringCount = Number(
    (analysisPacket &&
      analysisPacket.counts &&
      analysisPacket.counts.recurring_or_subscription_rows) ||
      0
  );
  const rows =
    analysisPacket && Array.isArray(analysisPacket.recurring_or_subscription_rows)
      ? analysisPacket.recurring_or_subscription_rows
      : [];
  const confirmedRows = rows.filter(
    (row) =>
      row &&
      row.semantic_classification &&
      /^recurring_/.test(String(row.semantic_classification.recurrence || ''))
  );
  if (recurringCount <= 0 || confirmedRows.length <= 0) {
    addIssue(
      issues,
      'unsupported_recurring_recommendation',
      'Answer recommended subscription or recurring-item cuts without confirmed recurring evidence.'
    );
  }
}

function validateCoverageClaims(text, summary, issues) {
  const packet = getPrimaryAdvisorPacket(summary);
  const selection = packet && packet.selection ? packet.selection : null;
  if (!(selection && Number(selection.omitted_count || 0) > 0)) {
    return;
  }
  if (
    /\b(reviewed|checked|looked at|analyzed)\b.{0,40}\b(all|every|complete|entire)\b/i.test(text)
  ) {
    addIssue(
      issues,
      'unsupported_complete_coverage',
      'Answer claimed complete review even though the packet omitted some eligible records.'
    );
  }
}

function validateBudgetPercentWording(text, summary, issues) {
  const analysisPacket =
    summary && summary.data_packets && summary.data_packets.transaction_analysis;
  const reliability =
    analysisPacket && analysisPacket.budget_reliability ? analysisPacket.budget_reliability : null;
  if (!reliability) {
    return;
  }
  const percentOf = Number(reliability.percent_of_budget || reliability.percent_used);
  const percentOver = Number(reliability.percent_over_budget);
  if (!(Number.isFinite(percentOf) && Number.isFinite(percentOver))) {
    return;
  }
  const roundedOf = Math.round(percentOf);
  const roundedOver = Math.round(percentOver);
  if (
    roundedOf !== roundedOver &&
    new RegExp('\\b' + String(roundedOf) + '%\\s+over\\s+budget\\b', 'i').test(text)
  ) {
    addIssue(
      issues,
      'budget_percent_wording',
      'Answer used percent-of-budget as percent-over-budget.'
    );
  }
}

function validateInternalDiagnostics(text, issues) {
  if (
    /\b(Model note|grounding checks?|schema parsing|response_format|provider failure|validation failed|retrying|Cavalry validation|configured model did not return)\b/i.test(
      text
    )
  ) {
    addIssue(
      issues,
      'internal_diagnostic_leak',
      'Answer exposed internal model, schema, retry, or validation diagnostics.'
    );
  }
}

function validateDirectMutationClaims(text, issues) {
  if (
    /\b(I|I've|I have)\s+(created|updated|changed|deleted|removed|renamed|applied|fixed)\b.{0,80}\b(transaction|transactions|category|categories|counterparty|budget|recurring|workbook|ledger)\b/i.test(
      text
    ) &&
    !/\b(draft|proposal|reviewable|nothing has changed|before confirmation)\b/i.test(text)
  ) {
    addIssue(
      issues,
      'direct_mutation_claim',
      'Answer claimed a workbook mutation happened without making it clear it is only a reviewable draft.'
    );
  }
}

export function validateAdvisorAnswer({ text, summary, taskSpec } = {}) {
  const answer = String(text || '');
  const issues = [];
  if (!normalizeText(answer)) {
    addIssue(issues, 'empty_answer', 'Answer was empty.');
  }
  const spec = getTaskSpec(summary, taskSpec);
  validateDateScope(answer, summary, spec, issues);
  validateSupportedNumbers(answer, summary, issues);
  validateTableLeakage(answer, spec, issues);
  validateSmallTalkDisclaimer(answer, summary, spec, issues);
  validateRepeatedDisclaimer(answer, issues);
  validateMetricConfusion(answer, summary, issues);
  validateLiquidityFraming(answer, summary, issues);
  validateFinancialSemanticLanguage(answer, summary, issues);
  validateRecurringAdvice(answer, summary, issues);
  validateCoverageClaims(answer, summary, issues);
  validateBudgetPercentWording(answer, summary, issues);
  validateInternalDiagnostics(answer, issues);
  validateDirectMutationClaims(answer, issues);
  const uniqueIssues = [];
  const seen = {};
  issues.forEach((issue) => {
    const key = issue.code + ':' + issue.message;
    if (!seen[key]) {
      seen[key] = true;
      uniqueIssues.push(issue);
    }
  });
  return {
    ok: uniqueIssues.length === 0,
    issues: uniqueIssues,
    retryInstruction: buildAdvisorRetryInstruction(uniqueIssues, summary, spec)
  };
}

export function buildAdvisorRetryInstruction(issues, summary, taskSpec) {
  const problemList = (issues || [])
    .map((issue) => '- ' + issue.code + ': ' + issue.message)
    .join('\n');
  const scope = getTaskDateScope(summary, taskSpec);
  const plan = taskSpec && taskSpec.answerPlan ? taskSpec.answerPlan : {};
  return [
    'Revise the answer before showing it to the user.',
    problemList || '- validation_failed: The answer did not pass Cavalry validation.',
    '',
    'Use only the provided advisor packet. Do not introduce new numbers, dates, accounts, categories, or transactions.',
    scope && scope.start && scope.end
      ? 'Use this exact scope: ' +
        String(scope.label || '') +
        ' (' +
        scope.start +
        ' to ' +
        scope.end +
        ').'
      : '',
    plan.sections && plan.sections.length
      ? 'Follow these answer sections in spirit, without necessarily naming every section: ' +
        plan.sections.join(', ') +
        '.'
      : '',
    plan.tableAllowed === false ? 'Do not include a transaction table.' : '',
    'Return only the corrected final answer.'
  ]
    .filter(Boolean)
    .join('\n');
}
