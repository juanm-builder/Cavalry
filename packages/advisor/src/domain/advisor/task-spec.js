import { normalizeAdvisorQuestionText } from './turns.js';

const ADVISOR_TASK_SPEC_VERSION = 'cavalry.advisor_task.v1';
export const ADVISOR_TASK_SPEC_V2_VERSION = 'cavalry.advisor_task.v2';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatDateKey(date) {
  return [String(date.getFullYear()), pad2(date.getMonth() + 1), pad2(date.getDate())].join('-');
}

function addDays(dateKey, days) {
  const date = parseDateKey(dateKey);
  if (!date) {
    return dateKey || '';
  }
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function getMonthRange(year, monthIndex) {
  const start = new Date(Number(year), Number(monthIndex), 1);
  const end = new Date(Number(year), Number(monthIndex) + 1, 0);
  return {
    start: formatDateKey(start),
    end: formatDateKey(end)
  };
}

function getDateKeyFromParts(year, monthIndex, day) {
  const date = new Date(Number(year), Number(monthIndex), Number(day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(monthIndex) ||
    date.getDate() !== Number(day)
  ) {
    return '';
  }
  return formatDateKey(date);
}

function getMondayOfWeek(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) {
    return dateKey || '';
  }
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return formatDateKey(date);
}

function clampEndToAsOf(range, asOfDate) {
  if (!(range && range.start && range.end && asOfDate)) {
    return range;
  }
  if (range.start <= asOfDate && range.end > asOfDate) {
    return Object.assign({}, range, { end: asOfDate });
  }
  return range;
}

function formatDateLabel(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) {
    return String(dateKey || '');
  }
  return (
    MONTH_NAMES[date.getMonth()] + ' ' + String(date.getDate()) + ', ' + String(date.getFullYear())
  );
}

function formatDateScopeLabel(startKey, endKey) {
  if (!(startKey && endKey)) {
    return 'Selected period';
  }
  if (startKey === endKey) {
    return formatDateLabel(startKey);
  }
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!(start && end)) {
    return startKey + ' - ' + endKey;
  }
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return (
      MONTH_NAMES[start.getMonth()] +
      ' ' +
      String(start.getDate()) +
      ' - ' +
      String(end.getDate()) +
      ', ' +
      String(end.getFullYear())
    );
  }
  if (start.getFullYear() === end.getFullYear()) {
    return (
      MONTH_NAMES[start.getMonth()] +
      ' ' +
      String(start.getDate()) +
      ' - ' +
      MONTH_NAMES[end.getMonth()] +
      ' ' +
      String(end.getDate()) +
      ', ' +
      String(end.getFullYear())
    );
  }
  return formatDateLabel(startKey) + ' - ' + formatDateLabel(endKey);
}

function normalizeDateScope(scope, fallbackRange) {
  const fallback = fallbackRange || {};
  const start = scope && scope.start ? String(scope.start) : String(fallback.start || '');
  const end = scope && scope.end ? String(scope.end) : String(fallback.end || start || '');
  return {
    type: scope && scope.type ? String(scope.type) : 'visible_range',
    start,
    end,
    label: scope && scope.label ? String(scope.label) : formatDateScopeLabel(start, end),
    source: scope && scope.source ? String(scope.source) : 'visible_range',
    assumptions: Array.isArray(scope && scope.assumptions) ? scope.assumptions.slice() : [],
    requiresClarification: !!(scope && scope.requiresClarification)
  };
}

function hasFollowUpDateReuseSignal(lower) {
  return /^(yes|yep|yeah|sure|ok|okay|please|continue|go on|more|details|detail|expand|explain|why|that|this|those|them|it|tell me|what about)\b/.test(
    lower
  );
}

function getExplicitYear(lower, fallbackYear) {
  const match = lower.match(/\b(19\d{2}|20\d{2})\b/);
  return Number(match && match[1]) || Number(fallbackYear) || new Date().getFullYear();
}

function normalizeYear(value, fallbackYear) {
  const raw = String(value || '').trim();
  if (!raw) {
    return Number(fallbackYear) || new Date().getFullYear();
  }
  if (/^\d{2}$/.test(raw)) {
    return 2000 + Number(raw);
  }
  return Number(raw) || Number(fallbackYear) || new Date().getFullYear();
}

function getMonthTokenPattern() {
  return MONTH_NAMES.map(
    (monthName) => monthName.toLowerCase() + '|' + monthName.toLowerCase().slice(0, 3)
  ).join('|');
}

function getMonthIndexFromToken(value) {
  const token = String(value || '')
    .toLowerCase()
    .slice(0, 3);
  return MONTH_NAMES.findIndex((monthName) => monthName.toLowerCase().slice(0, 3) === token);
}

function buildExplicitDateRangeScope(question, options) {
  const raw = String(question || '').toLowerCase();
  const workbookYear = Number(options && options.workbookYear) || new Date().getFullYear();
  const asOf = String((options && options.asOfDate) || '');
  const monthPattern = getMonthTokenPattern();
  const namedRange = new RegExp(
    '\\b(?:from\\s+)?(' +
      monthPattern +
      ')\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to|through|until)\\s*(?:(' +
      monthPattern +
      ')\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{2,4}))?\\b',
    'i'
  );
  const namedMatch = raw.match(namedRange);
  if (namedMatch) {
    const startMonth = getMonthIndexFromToken(namedMatch[1]);
    const endMonth = namedMatch[3] ? getMonthIndexFromToken(namedMatch[3]) : startMonth;
    const year = normalizeYear(namedMatch[5], workbookYear);
    const start = getDateKeyFromParts(year, startMonth, Number(namedMatch[2]));
    const end = getDateKeyFromParts(year, endMonth, Number(namedMatch[4]));
    if (start && end && start <= end) {
      const clamped = clampEndToAsOf({ start, end }, asOf);
      return normalizeDateScope(
        {
          type: 'explicit_range',
          start: clamped.start,
          end: clamped.end,
          label: formatDateScopeLabel(clamped.start, clamped.end),
          source: 'prompt'
        },
        options && options.visibleRange
      );
    }
  }

  const numericRange =
    /\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\s*(?:-|–|—|to|through|until)\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b/i;
  const numericMatch = raw.match(numericRange);
  if (numericMatch) {
    const startMonth = Number(numericMatch[1]) - 1;
    const startDay = Number(numericMatch[2]);
    const endMonth = numericMatch[4] ? Number(numericMatch[4]) - 1 : startMonth;
    const endDay = Number(numericMatch[5]);
    const year = normalizeYear(numericMatch[6] || numericMatch[3], workbookYear);
    const start = getDateKeyFromParts(year, startMonth, startDay);
    const end = getDateKeyFromParts(year, endMonth, endDay);
    if (start && end && start <= end) {
      const clamped = clampEndToAsOf({ start, end }, asOf);
      return normalizeDateScope(
        {
          type: 'explicit_range',
          start: clamped.start,
          end: clamped.end,
          label: formatDateScopeLabel(clamped.start, clamped.end),
          source: 'prompt'
        },
        options && options.visibleRange
      );
    }
  }
  return null;
}

function findMonthScope(lower) {
  let match = null;
  MONTH_NAMES.forEach((monthName, index) => {
    if (match) {
      return;
    }
    const monthKey = monthName.toLowerCase();
    const shortKey = monthKey.slice(0, 3);
    const monthPattern = new RegExp('\\b(' + monthKey + '|' + shortKey + ')\\b');
    if (!monthPattern.test(lower)) {
      return;
    }
    const hasSignal =
      /\b(this month|current month|month only|for the month|month of)\b/.test(lower) ||
      new RegExp(
        '\\b(for|in|during|of|about)\\s+(the\\s+month\\s+of\\s+)?(' +
          monthKey +
          '|' +
          shortKey +
          ')\\b'
      ).test(lower) ||
      new RegExp('\\b(' + monthKey + '|' + shortKey + ')\\s+only\\b').test(lower) ||
      /\bwhat about\b/.test(lower);
    if (hasSignal) {
      match = { index, name: monthName };
    }
  });
  return match;
}

export function resolveAdvisorDateScope(question, options = {}) {
  const lower = normalizeAdvisorQuestionText(question);
  const selectedAsOfDate =
    options.selectedAsOfDate || options.asOfDate || formatDateKey(new Date());
  const asOf = parseDateKey(selectedAsOfDate) ? selectedAsOfDate : formatDateKey(new Date());
  const selectedDate = parseDateKey(asOf) || new Date();
  const visibleRange = options.visibleRange || {};
  const workbookYear = Number(options.workbookYear) || selectedDate.getFullYear();
  const previousDateScope = options.previousDateScope || null;
  const explicitRange = buildExplicitDateRangeScope(question, {
    workbookYear,
    asOfDate: asOf,
    visibleRange
  });
  if (explicitRange) {
    return explicitRange;
  }

  const rollingMatch =
    lower.match(/\b(last|past)\s+(\d{1,3}|two)\s+(day|days|week|weeks)\b/) ||
    (/\bfortnight\b/.test(lower) ? ['fortnight', 'last', '2', 'weeks'] : null);
  if (rollingMatch) {
    const rawCount = rollingMatch[2] === 'two' ? 2 : Number(rollingMatch[2]);
    const unit = String(rollingMatch[3] || 'days');
    const dayCount = Math.max(1, Math.min(365, rawCount * (/week/.test(unit) ? 7 : 1)));
    const start = addDays(asOf, -(dayCount - 1));
    return normalizeDateScope(
      {
        type: 'rolling_' + String(dayCount) + '_days',
        start,
        end: asOf,
        label: formatDateScopeLabel(start, asOf),
        source: 'prompt',
        assumptions: [
          'Interpreted as the last ' +
            String(dayCount) +
            ' calendar days ending on the selected as-of date.'
        ]
      },
      visibleRange
    );
  }

  if (/\blast week\b/.test(lower)) {
    const currentMonday = getMondayOfWeek(asOf);
    const start = addDays(currentMonday, -7);
    const end = addDays(currentMonday, -1);
    return normalizeDateScope(
      {
        type: 'last_week',
        start,
        end,
        label: formatDateScopeLabel(start, end),
        source: 'prompt',
        assumptions: ['Interpreted as Monday through Sunday before the selected as-of week.']
      },
      visibleRange
    );
  }

  if (/\b(this week|current week|for the week|spending for the week|weekly)\b/.test(lower)) {
    const start = getMondayOfWeek(asOf);
    return normalizeDateScope(
      {
        type: 'current_week',
        start,
        end: asOf,
        label: formatDateScopeLabel(start, asOf),
        source: 'prompt',
        assumptions: ['Interpreted current week as Monday through the selected as-of date.']
      },
      visibleRange
    );
  }

  const currentMonthSignal = /\b(this month|current month)\b/.test(lower);
  const monthScope = currentMonthSignal
    ? { index: selectedDate.getMonth(), name: MONTH_NAMES[selectedDate.getMonth()] }
    : findMonthScope(lower);
  if (monthScope) {
    const year = getExplicitYear(lower, workbookYear);
    const monthRange = clampEndToAsOf(getMonthRange(year, monthScope.index), asOf);
    return normalizeDateScope(
      {
        type: currentMonthSignal ? 'current_month' : 'month',
        start: monthRange.start,
        end: monthRange.end,
        label: monthScope.name + ' ' + String(year),
        source: 'prompt',
        assumptions: currentMonthSignal
          ? ['Interpreted this month as month-to-date through the selected as-of date.']
          : []
      },
      visibleRange
    );
  }

  if (previousDateScope && hasFollowUpDateReuseSignal(lower)) {
    return normalizeDateScope(
      Object.assign({}, previousDateScope, {
        source: previousDateScope.source || 'conversation'
      }),
      visibleRange
    );
  }

  return normalizeDateScope(
    {
      type: 'visible_range',
      start: visibleRange.start || '',
      end: visibleRange.end || '',
      label: visibleRange.label || formatDateScopeLabel(visibleRange.start, visibleRange.end),
      source: 'visible_range'
    },
    visibleRange
  );
}

export function getAdvisorTaskOutputMode(intent) {
  const targetIntent = String(intent || '');
  if (targetIntent === 'transaction_list') {
    return 'table';
  }
  if (
    targetIntent === 'greeting' ||
    targetIntent === 'small_talk' ||
    targetIntent === 'transaction_capability'
  ) {
    return 'conversational';
  }
  if (
    targetIntent === 'transaction_analysis' ||
    targetIntent === 'spending_analysis' ||
    targetIntent === 'categorization_review' ||
    targetIntent === 'category_inventory' ||
    targetIntent === 'net_worth_impact_transactions' ||
    targetIntent === 'account_analysis'
  ) {
    return 'analysis';
  }
  return 'financial_answer';
}

export function getAdvisorTaskDataNeeds(intent) {
  const targetIntent = String(intent || '');
  if (
    targetIntent === 'greeting' ||
    targetIntent === 'small_talk' ||
    targetIntent === 'transaction_capability'
  ) {
    return [];
  }
  if (targetIntent === 'transaction_list') {
    return ['scoped_transaction_rows'];
  }
  if (targetIntent === 'transaction_analysis' || targetIntent === 'spending_analysis') {
    return [
      'scoped_cashflow_split',
      'top_spending_categories',
      'over_budget_categories',
      'recurring_or_subscription_signals',
      'vague_category_rows',
      'transfer_like_candidates',
      'largest_real_expense_rows'
    ];
  }
  if (targetIntent === 'categorization_review') {
    return ['category_quality_signals', 'cleanup_candidates'];
  }
  if (targetIntent === 'category_inventory') {
    return ['category_roster', 'category_usage_counts'];
  }
  if (targetIntent === 'account_analysis') {
    return ['account_balances', 'account_roster', 'asset_liability_split'];
  }
  return ['scoped_financial_summary'];
}

export function buildAdvisorAnswerPlan(taskSpec) {
  const outputMode =
    taskSpec && taskSpec.outputMode
      ? taskSpec.outputMode
      : getAdvisorTaskOutputMode(taskSpec && taskSpec.intent);
  const targetIntent = String((taskSpec && taskSpec.intent) || '');
  if (targetIntent === 'greeting') {
    return {
      plan_version: 'cavalry.advisor_answer_plan.v1',
      sections: ['brief_greeting', 'open_focus_question'],
      tableAllowed: false,
      disclaimerRequired: false
    };
  }
  if (targetIntent === 'small_talk') {
    return {
      plan_version: 'cavalry.advisor_answer_plan.v1',
      sections: ['brief_reply', 'gentle_invitation'],
      tableAllowed: false,
      disclaimerRequired: false
    };
  }
  if (targetIntent === 'transaction_capability') {
    return {
      plan_version: 'cavalry.advisor_answer_plan.v1',
      sections: ['capability_confirmation', 'analysis_offer'],
      tableAllowed: false,
      disclaimerRequired: false
    };
  }
  if (outputMode === 'table') {
    return {
      plan_version: 'cavalry.advisor_answer_plan.v1',
      sections: ['scope_used', 'requested_rows', 'short_summary'],
      tableAllowed: true,
      disclaimerRequired: true
    };
  }
  if (outputMode === 'analysis') {
    return {
      plan_version: 'cavalry.advisor_answer_plan.v1',
      sections: [
        'quick_read',
        'scope_used',
        'important_observations',
        'cleanup_or_data_quality_notes',
        'next_best_actions'
      ],
      tableAllowed: false,
      disclaimerRequired: true
    };
  }
  return {
    plan_version: 'cavalry.advisor_answer_plan.v1',
    sections: ['direct_answer', 'supporting_facts', 'next_best_actions'],
    tableAllowed: false,
    disclaimerRequired: true
  };
}

export function buildAdvisorTaskSpec({
  question,
  turn,
  previousState,
  dateScope,
  visibleRange
} = {}) {
  const safeTurn = turn || {};
  const targetIntent = safeTurn.targetIntent || safeTurn.intent || 'unknown';
  const normalizedDateScope = normalizeDateScope(dateScope, visibleRange);
  const spec = {
    spec_version: ADVISOR_TASK_SPEC_VERSION,
    intent: targetIntent,
    raw_intent: safeTurn.intent || targetIntent,
    dateScope: normalizedDateScope,
    outputMode: getAdvisorTaskOutputMode(targetIntent),
    dataNeeds: getAdvisorTaskDataNeeds(targetIntent),
    followUpOf:
      safeTurn.previousTargetIntent || (previousState && previousState.lastTargetIntent) || '',
    assumptions: normalizedDateScope.assumptions.slice(),
    requiresClarification: normalizedDateScope.requiresClarification,
    originalQuestion: String(question || safeTurn.question || '').trim()
  };
  spec.answerPlan = buildAdvisorAnswerPlan(spec);
  return spec;
}

export function advisorTaskAllowsTables(taskSpec) {
  return !!(taskSpec && taskSpec.answerPlan && taskSpec.answerPlan.tableAllowed);
}

function normalizeOutputPreference(question) {
  const lower = normalizeAdvisorQuestionText(question);
  if (/\b(short|brief|quick|concise|summary)\b/.test(lower)) {
    return 'concise';
  }
  if (/\b(detailed|deep|thorough|comprehensive|full)\b/.test(lower)) {
    return 'detailed';
  }
  return 'balanced';
}

function buildAdvisorAssumption(text, importance = 'minor') {
  return {
    text: String(text || '').trim(),
    importance
  };
}

function buildAdvisorSubtask(id, kind, expectedArtifact, overrides = {}) {
  return Object.assign(
    {
      id,
      kind,
      status: 'pending',
      dependsOn: [],
      requiredData: [],
      requiredCapabilities: [],
      expectedArtifact
    },
    overrides
  );
}

function getCompoundCategorySubtasks(question, targetIntent) {
  const lower = normalizeAdvisorQuestionText(question);
  const wantsImprove =
    /\b(improve|cleanup|clean up|better|rename|recategorize|reclassify|fix|organize|labels?)\b/.test(
      lower
    );
  if (targetIntent !== 'categorization_review' && !(wantsImprove && /\bcategor/i.test(lower))) {
    return null;
  }
  const subtasks = [
    buildAdvisorSubtask('review_transactions', 'review_transactions', 'evidence_set', {
      status: 'ready',
      requiredData: ['scoped_transaction_rows']
    }),
    buildAdvisorSubtask('review_categorization', 'review_categorization', 'evidence_set', {
      dependsOn: ['review_transactions'],
      requiredData: ['category_quality_signals', 'cleanup_candidates']
    })
  ];
  if (wantsImprove) {
    subtasks.push(
      buildAdvisorSubtask('propose_taxonomy', 'propose_taxonomy', 'comparison', {
        dependsOn: ['review_categorization'],
        requiredData: ['category_reliability', 'semantic_classifications']
      }),
      buildAdvisorSubtask('prepare_category_drafts', 'prepare_category_drafts', 'drafts', {
        dependsOn: ['propose_taxonomy'],
        requiredData: ['candidate_cleanup'],
        requiredCapabilities: ['reviewable_drafts']
      })
    );
  }
  return subtasks;
}

function getSpendingAnalysisSubtasks(question, targetIntent) {
  if (targetIntent !== 'spending_analysis' && targetIntent !== 'transaction_analysis') {
    return null;
  }
  const lower = normalizeAdvisorQuestionText(question);
  const subtasks = [
    buildAdvisorSubtask('classify_cash_movements', 'review_transactions', 'evidence_set', {
      status: 'ready',
      requiredData: ['semantic_cashflow_split']
    }),
    buildAdvisorSubtask('analyze_spending', 'analyze_spending', 'answer', {
      dependsOn: ['classify_cash_movements'],
      requiredData: [
        'consumption_spending',
        'debt_payments',
        'internal_transfers',
        'category_reliability'
      ]
    })
  ];
  if (/\b(reduce|cut|save|improve|habit|habits|10%|ten percent|simulate)\b/.test(lower)) {
    subtasks.push(
      buildAdvisorSubtask('simulate_spending_change', 'simulate_change', 'simulation', {
        dependsOn: ['analyze_spending'],
        requiredData: ['discretionary_consumption_candidates']
      })
    );
  }
  return subtasks;
}

function buildDefaultV2Subtasks(targetIntent) {
  if (targetIntent === 'transaction_list') {
    return [
      buildAdvisorSubtask('list_transactions', 'review_transactions', 'evidence_set', {
        status: 'ready',
        requiredData: ['scoped_transaction_rows']
      })
    ];
  }
  if (targetIntent === 'advisor_brain') {
    return [
      buildAdvisorSubtask('workbook_brain_operation', 'workbook_brain_operation', 'drafts', {
        status: 'ready',
        requiredData: ['workbook_map', 'targeted_context_on_demand'],
        requiredCapabilities: ['reviewable_drafts']
      })
    ];
  }
  return [
    buildAdvisorSubtask('answer_question', 'answer_question', 'answer', {
      status: 'ready',
      requiredData: getAdvisorTaskDataNeeds(targetIntent)
    })
  ];
}

function buildAdvisorCompletionCriteria(targetIntent, subtasks) {
  const kinds = subtasks.map((subtask) => subtask.kind);
  if (kinds.indexOf('prepare_category_drafts') >= 0) {
    return [
      'All eligible transactions in the selected scope are covered or exclusions are stated.',
      'Ambiguous categories and mixed-purpose categories are identified.',
      'A proposed taxonomy or cleanup direction is shown.',
      'Reviewable drafts are created or one blocking classification question is asked.'
    ];
  }
  if (targetIntent === 'spending_analysis' || targetIntent === 'transaction_analysis') {
    return [
      'Debt principal and internal transfers are separated from consumption spending.',
      'Category reliability and uncertain classifications are stated when material.',
      'At least one next step or simulation action is available.'
    ];
  }
  return ['The user request is answered using the selected workbook scope.'];
}

function buildAdvisorSafetyConstraints(targetIntent) {
  const constraints = [
    'Use Cavalry-calculated facts and source refs for workbook-specific claims.',
    'Do not claim workbook data changed unless a deterministic confirmed mutation succeeded.',
    'Create reviewable drafts for proposed workbook changes.'
  ];
  if (targetIntent === 'spending_analysis' || targetIntent === 'transaction_analysis') {
    constraints.push(
      'Do not describe debt principal, transfers, or savings movements as consumption spending.'
    );
  }
  return constraints;
}

function buildAdvisorClarificationPolicy(question, subtasks) {
  const lower = normalizeAdvisorQuestionText(question);
  const requiresDrafts = subtasks.some((subtask) => /draft/.test(subtask.kind));
  if (
    requiresDrafts &&
    /\b(work|business|reimbursable|software|subscription|subscriptions|for others)\b/.test(lower)
  ) {
    return {
      level: 'material_non_blocking',
      question:
        'Which ambiguous software, work, reimbursable, or for-others expenses should be treated differently before applying category changes?',
      proceedWithAssumptions: true
    };
  }
  return {
    level: 'minor',
    question: '',
    proceedWithAssumptions: true
  };
}

export function buildAdvisorTaskSpecV2({
  question,
  turn,
  previousState,
  dateScope,
  visibleRange
} = {}) {
  const v1 = buildAdvisorTaskSpec({ question, turn, previousState, dateScope, visibleRange });
  const rawQuestion = String(question || (turn && turn.question) || '').trim();
  const targetIntent = v1.intent || 'unknown';
  const categorySubtasks = getCompoundCategorySubtasks(rawQuestion, targetIntent);
  const spendingSubtasks = getSpendingAnalysisSubtasks(rawQuestion, targetIntent);
  const subtasks = categorySubtasks || spendingSubtasks || buildDefaultV2Subtasks(targetIntent);
  const assumptions = v1.assumptions.map((assumption) =>
    buildAdvisorAssumption(assumption, 'minor')
  );
  if (targetIntent === 'spending_analysis' || targetIntent === 'transaction_analysis') {
    assumptions.push(
      buildAdvisorAssumption(
        'Spending advice uses consumption spending by default, excluding debt principal and internal transfers.',
        'material'
      )
    );
  }
  return {
    specVersion: ADVISOR_TASK_SPEC_V2_VERSION,
    spec_version: ADVISOR_TASK_SPEC_V2_VERSION,
    objective: rawQuestion || targetIntent,
    userGoal: rawQuestion,
    rawQuestion,
    normalizedQuestion: normalizeAdvisorQuestionText(rawQuestion),
    dateScope: v1.dateScope,
    outputPreference: normalizeOutputPreference(rawQuestion),
    subtasks,
    assumptions,
    clarification: buildAdvisorClarificationPolicy(rawQuestion, subtasks),
    completionCriteria: buildAdvisorCompletionCriteria(targetIntent, subtasks),
    safetyConstraints: buildAdvisorSafetyConstraints(targetIntent),
    legacyTaskSpec: v1
  };
}
