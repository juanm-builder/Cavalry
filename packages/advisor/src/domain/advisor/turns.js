import { classifyAdvisorCommandMode } from './command-mode.js';

export function normalizeAdvisorQuestionText(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s?]+/g, ' ')
    .replace(
      /\b(transactinos|transactino|transctions|transction|trasactions|trasaction|tranactions|tranaction|transacions|transacion)\b/g,
      (match) => (/s$/.test(match) ? 'transactions' : 'transaction')
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAdvisorGreetingPrompt(question) {
  const lower = normalizeAdvisorQuestionText(question);
  return /^(hi|hello|hey|hiya|greetings|good morning|good afternoon|good evening|good day|yo|sup)( there)?$/.test(
    lower
  );
}

export function isAdvisorSmallTalkPrompt(question) {
  const lower = normalizeAdvisorQuestionText(question);
  return (
    /^(how are you|how are you doing|how s it going|hows it going|what s up|whats up|thank you|thanks|ty|nice|cool|great|awesome)[?.! ]*$/.test(
      lower
    ) ||
    /\b(i feel|i am|i m|im|i'm|feeling)\s+(sad|down|bad|upset|stressed|anxious|worried|overwhelmed|frustrated|discouraged|scared)\b/.test(
      lower
    )
  );
}

export function isAdvisorFollowUpQuestion(lowerQuestion, previousState) {
  if (!(previousState && (previousState.lastTargetIntent || previousState.lastIntent))) {
    return false;
  }
  const lower = normalizeAdvisorQuestionText(lowerQuestion);
  return (
    /^(yes|yep|yeah|sure|ok|okay|please|do it|go on|continue|more|details|detail|break|breakdown|complete|full|expand|explain|why|what about|that|this|those|them|it|tell me|give me|what do you think|what is your read|your read)\b/.test(
      lower
    ) ||
    /\b(break\s*down|breakdown|complete breakdown|more detail|full detail|explain that|why is that|tell me what you think|what do you think|your read|go deeper)\b/.test(
      lower
    )
  );
}

export function isAdvisorCategorizationReviewPrompt(question) {
  const lower = normalizeAdvisorQuestionText(question);
  const asksForReview =
    /\b(review|recommend|suggest|suggestions|improvements|improve|audit|analyze|analyse|check|look at|how can|tell me)\b/.test(
      lower
    );
  const mentionsCategorization =
    /\b(categorizing|categorize|categorized|category|categories|label|labels|counterparty|counterparties|merchant|merchants|payee|payees|ledger)\b/.test(
      lower
    );
  const explicitlyMutates =
    /\b(apply|post|save|change|edit|rename|merge|archive|deactivate|delete|recategorize|reclassify|clean up|cleanup|fix labels|fix categories|create draft|make draft|queue draft|draft)\b/.test(
      lower
    );
  return !!(asksForReview && mentionsCategorization && !explicitlyMutates);
}

function mentionsTransactions(lower) {
  return /\b(transaction|transactions|purchase|purchases|charge|charges|payment|payments|merchant|merchants)\b/.test(
    lower
  );
}

function mentionsSpending(lower) {
  return /\b(expense|expenses|outflow|outflows|spent|spending|spend|spendings)\b/.test(lower);
}

function mentionsFinancialStanding(lower) {
  return /\b(financial standing|financial health|financial position|current finances|finances|money situation|overall financial|overall finances|how am i doing financially|how are my finances)\b/.test(
    lower
  );
}

function mentionsAccounts(lower) {
  return /\b(account|accounts|balance|balances|asset|assets|liability|liabilities|wallet|wallets|bank|banks|card|cards|cash)\b/.test(
    lower
  );
}

function asksForAnalysis(lower) {
  return /\b(analyze|analyse|analysis|review|audit|check|read|look at|feedback|insight|insights|think|thought|thoughts|opinion|recommend|recommendation|should|tell me what you think|what do you think|honest thoughts|your read)\b/.test(
    lower
  );
}

function asksLatestTransaction(lower) {
  return (
    mentionsTransactions(lower) &&
    (/\b(latest|most recent)\s+(transaction|transactions|purchase|purchases|charge|charges|payment|payments)\b/.test(
      lower
    ) ||
      /\b(show|list|display|give me|what is|what was)\b.{0,32}\b(last|latest|most recent)\b.{0,16}\b(transaction|transactions|purchase|purchases|charge|charges|payment|payments)\b/.test(
        lower
      ) ||
      /\b(last)\s+(transaction|purchase|charge|payment)\b/.test(lower))
  );
}

function asksCapability(lower) {
  return /\b(can you|could you|are you able|is this something you can do|do you have access|can u)\b/.test(
    lower
  );
}

function isAffirmativeFollowUp(lower) {
  return /^(yes|yep|yeah|sure|ok|okay|please|do it|go ahead|proceed|continue|yes please)\b/.test(
    lower
  );
}

function hasAdvisorDateScopeSignal(lower) {
  return (
    /\b(this week|current week|last week|past \d+ days|last \d+ days|past \d+ weeks|last \d+ weeks|past two weeks|last two weeks|fortnight|this month|current month|month of|january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\b/.test(
      lower
    ) ||
    /\b\d{1,2}\s*\/\s*\d{1,2}(?:\s*(?:to|through|until|-)\s*\d{1,2}\s*\/?\s*\d{0,2})?\b/.test(lower)
  );
}

function explicitlyRequestsTransactionList(lower) {
  if (
    asksForAnalysis(lower) &&
    !/\b(show|list|display|export|print|table|download)\b/.test(lower)
  ) {
    return false;
  }
  if (asksLatestTransaction(lower)) {
    return true;
  }
  if (
    /\b(show|list|display|export|print|table|download)\b/.test(lower) &&
    mentionsTransactions(lower)
  ) {
    return true;
  }
  if (
    mentionsTransactions(lower) &&
    /\b(full|complete|all|entire)\b.{0,24}\b(list|history|table|rows)\b/.test(lower)
  ) {
    return true;
  }
  if (
    /\b(give me|send me)\b/.test(lower) &&
    mentionsTransactions(lower) &&
    !asksForAnalysis(lower)
  ) {
    return true;
  }
  return false;
}

export function classifyAdvisorIntent(question, previousState) {
  const lower = normalizeAdvisorQuestionText(question);
  const hasTransactions = mentionsTransactions(lower);
  const hasSpending = mentionsSpending(lower);
  const mentionsNetWorth = /\b(net\s*worth|networth|worth)\b/.test(lower);
  const mentionsImpact =
    /\b(affect|affected|impact|impacted|change|changed|move|moved|hit|hits|driver|drivers|largest|biggest|most)\b/.test(
      lower
    );
  const asksAnalysis = asksForAnalysis(lower);

  if (isAdvisorGreetingPrompt(question)) {
    return 'greeting';
  }
  if (isAdvisorSmallTalkPrompt(question)) {
    return 'small_talk';
  }
  if (previousState && previousState.pendingTaskSpec && isAffirmativeFollowUp(lower)) {
    return 'pending_task_confirmation';
  }
  if (
    hasTransactions &&
    asksCapability(lower) &&
    /\b(read|see|access|look at)\b/.test(lower) &&
    !/\b(analyze|analyse|analysis|review|audit|think|opinion|feedback|insight|insights|tell me|how it is|how is it)\b/.test(
      lower
    ) &&
    !hasAdvisorDateScopeSignal(lower)
  ) {
    return 'transaction_capability';
  }
  const command = classifyAdvisorCommandMode(question, { previousState });
  if (command && command.intent && command.targetIntent) {
    if (command.handler === 'qa' || command.handler === 'local_response') {
      return command.targetIntent;
    }
    if (
      command.handler === 'transaction_draft' ||
      command.handler === 'transaction_metadata_draft'
    ) {
      return 'transaction_command';
    }
    if (command.handler === 'workbook_draft' || command.handler === 'action') {
      return 'workbook_command';
    }
  }
  if (isAdvisorCategorizationReviewPrompt(question)) {
    return 'categorization_review';
  }
  if (explicitlyRequestsTransactionList(lower)) {
    return 'transaction_list';
  }
  if (hasTransactions && asksAnalysis && !mentionsNetWorth) {
    return 'transaction_analysis';
  }
  if (asksAnalysis && mentionsAccounts(lower) && !hasTransactions) {
    return 'account_analysis';
  }
  if (hasSpending && asksAnalysis) {
    return 'spending_analysis';
  }
  if (hasTransactions && mentionsNetWorth && mentionsImpact) {
    return 'net_worth_impact_transactions';
  }
  if (isAdvisorFollowUpQuestion(lower, previousState)) {
    if (/\b(why|explain|because|reason|think|opinion|read)\b/.test(lower)) {
      return 'follow_up_explain';
    }
    return 'follow_up_expand';
  }
  if (hasTransactions && /\b(breakdown|break\s*down|largest|biggest|top)\b/.test(lower)) {
    return 'transaction_analysis';
  }
  if (hasTransactions && /\b(recent|details?)\b/.test(lower)) {
    return 'transaction_list';
  }
  if (/\b(asset|assets)\b/.test(lower) && !mentionsNetWorth) {
    return 'account_analysis';
  }
  if (/\b(account|accounts|balance|balances|wallet|wallets|bank|banks|cash)\b/.test(lower)) {
    return 'account_analysis';
  }
  if (mentionsNetWorth) {
    return 'net_worth';
  }
  if (/\b(liability|liabilities|debt|debts|loan|loans|card|cards)\b/.test(lower)) {
    return 'account_analysis';
  }
  if (/\b(income|inflow|inflows|earned|earnings)\b/.test(lower)) {
    return 'income';
  }
  if (mentionsFinancialStanding(lower)) {
    return 'cashflow_review';
  }
  if (hasSpending) {
    return 'spending_breakdown';
  }
  if (/\b(bill|bills|subscription|subscriptions|recurring|due|overdue)\b/.test(lower)) {
    return 'bill_attention';
  }
  if (/\b(cash|buffer|emergency|liquid)\b/.test(lower)) {
    return 'cashflow_review';
  }
  if (/\b(budget|overspend|over budget|pressure)\b/.test(lower)) {
    return 'budget_attention';
  }
  return 'unknown';
}

export function getAdvisorTargetIntent(intent, previousState) {
  if (intent === 'pending_task_confirmation') {
    return (
      (previousState && previousState.pendingTaskSpec && previousState.pendingTaskSpec.intent) ||
      'unknown'
    );
  }
  if (intent === 'follow_up_expand' || intent === 'follow_up_explain') {
    return (
      (previousState && (previousState.lastTargetIntent || previousState.lastIntent)) || 'unknown'
    );
  }
  return intent;
}

export function getAdvisorResponseStyle(question, intent) {
  const lower = normalizeAdvisorQuestionText(question);
  if (
    intent === 'category_inventory' ||
    /\b(show|list|read|display)\b.*\b(all|full|complete|every)?\b.*\b(category|categories)\b/.test(
      lower
    )
  ) {
    return 'breakdown';
  }
  if (
    intent === 'follow_up_expand' ||
    /\b(break\s*down|breakdown|complete|full|detail|details|rank|which transactions)\b/.test(lower)
  ) {
    return 'breakdown';
  }
  if (intent === 'follow_up_explain' || /\b(why|explain|reason|because)\b/.test(lower)) {
    return 'explanation';
  }
  if (
    intent === 'pending_task_confirmation' ||
    intent === 'transaction_analysis' ||
    intent === 'spending_analysis' ||
    /\b(think|opinion|recommend|should|review|advice|read)\b/.test(lower)
  ) {
    return 'recommendation';
  }
  if (/^how much\b/.test(lower)) {
    return 'direct_answer';
  }
  return 'conversational';
}

export function resolveAdvisorQuestion(question, intent, targetIntent, responseStyle) {
  const rawQuestion = String(question || '').trim();
  const command = classifyAdvisorCommandMode(question);
  const intentProtectsQuestion = [
    'greeting',
    'small_talk',
    'pending_task_confirmation',
    'transaction_capability',
    'follow_up_expand',
    'follow_up_explain'
  ].includes(intent);
  if (
    !intentProtectsQuestion &&
    command &&
    command.intent &&
    command.targetIntent &&
    command.handler !== 'transaction_draft' &&
    command.handler !== 'transaction_metadata_draft' &&
    command.handler !== 'workbook_draft'
  ) {
    if (command.targetIntent === 'explain_metric') {
      return 'Explain the requested metric plainly, using the workbook facts available. Keep it conversational and do not make changes.';
    }
    if (command.targetIntent !== targetIntent) {
      targetIntent = command.targetIntent;
    }
  }
  if (targetIntent === 'greeting') {
    return 'Greet the user briefly and ask what they want to focus on. Do not include financial metrics.';
  }
  if (targetIntent === 'small_talk') {
    return 'Respond naturally to the small-talk message. Do not include financial metrics, risks, bills, budgets, or transaction details unless the user asks for them.';
  }
  if (targetIntent === 'transaction_capability') {
    return 'Confirm that Cavalry can read and analyze transactions. Do not list transaction rows unless the user asks.';
  }
  if (targetIntent === 'transaction_analysis') {
    return 'Analyze the selected-period transactions, summarize patterns and possible cleanup issues, and give practical next steps without dumping every row.';
  }
  if (targetIntent === 'spending_analysis') {
    return 'Analyze selected-period spending, flag possible transfers or non-expense items before conclusions, summarize top categories, and give practical next steps.';
  }
  if (
    (intent === 'follow_up_expand' || intent === 'follow_up_explain') &&
    targetIntent === 'net_worth_impact_transactions'
  ) {
    if (responseStyle === 'explanation') {
      return 'Explain why those transactions affected net worth in the selected period, including what was counted and what was excluded.';
    }
    return 'Give a transaction-level breakdown of the transactions that affected net worth the most in the selected period, then provide a practical interpretation.';
  }
  if (targetIntent === 'net_worth_impact_transactions') {
    return 'Identify the transactions that affected net worth the most in the selected period, explain the counting rules, and separate real impacts from neutral transfers.';
  }
  if (targetIntent === 'categorization_review') {
    return 'Review transaction categorization quality, explain possible improvements, and do not create or apply a cleanup draft unless the user explicitly asks.';
  }
  if (targetIntent === 'category_inventory') {
    return 'Show the full category inventory, including categories with zero selected-period transactions. Keep review comments separate from the roster and do not suggest categories are missing just because selected-period usage is zero.';
  }
  if (targetIntent === 'account_analysis') {
    return 'Review account balances, assets, liabilities, and account-level next steps using the provided account snapshot.';
  }
  if (targetIntent === 'transaction_list') {
    if (asksLatestTransaction(normalizeAdvisorQuestionText(question))) {
      return 'Show the latest transaction in the selected period using the provided transaction list.';
    }
    return 'Show the requested transaction list from the selected period using the provided transaction rows.';
  }
  return rawQuestion || 'Review the current workbook.';
}

export function buildAdvisorTurn(question, context = {}, previousState = null) {
  const profile = context && context.profile ? context.profile : {};
  const commandMode = classifyAdvisorCommandMode(question, { previousState });
  const intent = classifyAdvisorIntent(question, previousState);
  const intentProtectsTarget = [
    'greeting',
    'small_talk',
    'pending_task_confirmation',
    'transaction_capability',
    'follow_up_expand',
    'follow_up_explain'
  ].includes(intent);
  const targetIntent =
    !intentProtectsTarget &&
    commandMode &&
    commandMode.targetIntent &&
    ['qa', 'local_response'].includes(commandMode.handler)
      ? commandMode.targetIntent
      : getAdvisorTargetIntent(intent, previousState);
  const responseStyle = getAdvisorResponseStyle(question, intent);
  const resolvedQuestion = resolveAdvisorQuestion(question, intent, targetIntent, responseStyle);
  return {
    question: String(question || '').trim(),
    intent,
    targetIntent,
    responseStyle,
    resolvedQuestion,
    previousIntent: previousState && previousState.lastIntent ? previousState.lastIntent : '',
    previousTargetIntent:
      previousState && previousState.lastTargetIntent ? previousState.lastTargetIntent : '',
    previousAnswerSummary:
      previousState && previousState.lastAnswerSummary ? previousState.lastAnswerSummary : '',
    commandMode,
    datasetRef:
      'advisor_packet:' +
      targetIntent +
      ':' +
      (profile.rangeStart || '') +
      ':' +
      (profile.rangeEnd || '')
  };
}
