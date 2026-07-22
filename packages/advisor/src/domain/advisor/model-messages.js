import { buildAdvisorTransactionImageIntentPacket } from './packets.js';

export function getAdvisorRecentHistoryMessages(history) {
  return (history || [])
    .filter(
      (message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        String(message.text || '').trim() &&
        !/^Starting local advisor|^Local model|^Sending|^Waiting|^Thinking/i.test(
          String(message.text || '')
        )
    )
    .slice(-8)
    .map((message) => {
      const text = String(message.text || '')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        role: message.role === 'user' ? 'user' : 'assistant',
        content: text.length > 1800 ? text.slice(0, 1800) + '...' : text
      };
    });
}

export function buildAdvisorTransactionImageIntentMessages(
  workbook,
  prompt,
  attachments,
  options = {}
) {
  const packet = buildAdvisorTransactionImageIntentPacket(workbook, prompt, attachments, options);
  const imageParts = (attachments || [])
    .filter(
      (attachment) => attachment && String(attachment.dataUrl || attachment.data_url || '').trim()
    )
    .slice(0, 3)
    .map((attachment) => ({
      type: 'image_url',
      image_url: {
        url: String(attachment.dataUrl || attachment.data_url || '')
      }
    }));
  return [
    {
      role: 'system',
      content: [
        'You are Cavalry Transaction Image Intake.',
        'Read receipt and payment screenshots and return safe transaction draft JSON for user review.',
        'Never claim anything was posted.',
        'Extract visible facts for amount, date, account, merchant, and notes.',
        'For every transaction, include sourceAttachmentId for the one image that supports it and never mix evidence between images.',
        'If the user asks for grand total, just the total, or total only, extract the grand total only.',
        'For receipts, prefer final payable labels like Bill Amount, Amount Due, Grand Total, Total Due, Total, Amount Paid, or matching tender/payment lines; avoid Total Sales when a subtotal, service charge, or tender line shows a different paid amount.',
        'When a single receipt image is provided, return at most one transaction unless the user explicitly asks for line items.',
        'Use user-provided text for account and date when the image only supplies amount, merchant, or receipt evidence.',
        'Return needs_info only when amount, date, or account cannot be determined from the user text plus visible image.',
        'Do not extract line items unless the user explicitly asks for line items.',
        'You may infer or propose a category from visible merchant or item text, but never guess missing amount, date, or account.',
        'Return only JSON.'
      ].join(' ')
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: JSON.stringify(packet, null, 2)
        }
      ].concat(imageParts)
    }
  ];
}

export function getAdvisorModelBehaviorContract() {
  return [
    'You are Cavalry Advisor, a private local financial explainer inside the Cavalry desktop app.',
    'Cavalry calculates; you explain from the provided advisor packet only.',
    'Answer the user actual intent, not a generic dashboard summary.',
    'Use task_spec as the contract for intent, date scope, output mode, data needs, and whether a table is allowed.',
    'Use answer_plan only as non-binding guidance for scope and table permissions; do not copy its section names or treat it as a script.',
    'For greetings, do not show financial metrics; greet briefly and ask what the user wants to focus on.',
    'For small talk, answer naturally and briefly without mentioning finances, risks, bills, budgets, transactions, or disclaimers unless the user asks.',
    'For transaction capability questions, confirm that Cavalry can read and analyze transactions, then offer analysis without listing rows.',
    'When the user says to create, add, open, or track an account, interpret that as a Cavalry workbook account draft unless they explicitly ask how to open a real external bank account.',
    'For transaction or spending analysis requests, answer in a natural conversational shape that fits the user message; use raw transaction rows only when the user explicitly asks to show, list, export, or table transactions.',
    'When data_packets.transaction_analysis is present, base the answer on that packet and do not open with a generic Overall Cash Flow dashboard unless the user specifically asked for cash flow.',
    'When data_packets.account_snapshot is present, use it for account, asset, liability, wallet, bank, card, and balance questions; do not say you lack account access, and do not list total assets, total liabilities, or net worth unless the user asks for balances, a financial overview, or analysis.',
    'For analysis requests, split expenses_only, debt_payments, transfers_or_internal_moves, total_outflow, and net_cash_flow exactly as the packet defines them.',
    'When semantic_summary or spending_definition is present, use the selected spending definition. Do not call debt principal, internal transfers, savings moves, reimbursements, or opening balances consumption spending.',
    'For transaction_analysis or spending_analysis, vary the wording and structure instead of repeating a fixed report template; include cleanup, category, subscription, or next-step details only when the facts make them useful.',
    'For spending analysis, flag transfers, allowance entries, savings moves, and other possible non-expense items before judging overspending.',
    'Do not recommend cancelling subscriptions or recurring services unless recurrence and purpose are supported by the packet; otherwise ask or present it as a review item.',
    'If the user asks for a specific month or period, use the packet scope dates exactly and do not label a period as one month while using a wider date range.',
    'Do not call liquidity or the cash buffer healthy, strong, or comfortable when emergency_fund_months is below 3; say it is usable but below a typical 3-6 month buffer.',
    'Use calm review language. Avoid words like critical, extreme, emergency, panic, disaster, severe, and alarmist emoji.',
    'If a budget percentage is marked unreliable or extreme, do not lead with that percentage; explain that the plan may be incomplete or mismatched for the selected range.',
    'Use percent_of_budget for phrases like "951% of budget" and percent_over_budget for phrases like "851% over budget"; never swap them.',
    'Do not add boilerplate disclaimers; keep risk, tax, legal, and investment boundaries implicit unless directly relevant.',
    'Never invent accounts, balances, transactions, budgets, bills, categories, dates, or source data.',
    'Do not expose private reasoning or chain-of-thought. Explain conclusions from visible facts.',
    'Use review language for risks. Do not give tax, legal, or investment advice.'
  ];
}

function shouldUseLightweightAdvisorPacket(summary) {
  const targetIntent = String(
    (summary && (summary.target_intent || summary.targetIntent || summary.intent)) || ''
  );
  return ['greeting', 'small_talk', 'transaction_capability'].indexOf(targetIntent) >= 0;
}

function getLightweightResolvedQuestion(targetIntent) {
  if (targetIntent === 'greeting') {
    return 'Greet the user briefly and naturally.';
  }
  if (targetIntent === 'small_talk') {
    return 'Respond naturally and briefly to the small-talk message.';
  }
  if (targetIntent === 'transaction_capability') {
    return 'Confirm that Cavalry can analyze transactions when asked, without listing rows in this turn.';
  }
  return 'Respond naturally and briefly.';
}

function buildLightweightTaskSpec(source, targetIntent) {
  const taskSpec = source && (source.task_spec || source.taskSpec);
  if (!(taskSpec && typeof taskSpec === 'object')) {
    return {
      intent: targetIntent,
      outputMode: 'conversational',
      dataNeeds: []
    };
  }
  const clean = {
    spec_version: taskSpec.spec_version || taskSpec.specVersion || '',
    intent: targetIntent || taskSpec.intent || '',
    raw_intent: taskSpec.raw_intent || taskSpec.rawIntent || taskSpec.intent || '',
    outputMode: 'conversational',
    dataNeeds: [],
    followUpOf: taskSpec.followUpOf || taskSpec.follow_up_of || '',
    originalQuestion:
      taskSpec.originalQuestion || taskSpec.original_question || source.question || ''
  };
  if (taskSpec.dateScope && typeof taskSpec.dateScope === 'object') {
    clean.dateScope = {
      type: asString(taskSpec.dateScope.type),
      start: asString(taskSpec.dateScope.start),
      end: asString(taskSpec.dateScope.end),
      label: asString(taskSpec.dateScope.label),
      source: asString(taskSpec.dateScope.source)
    };
  }
  return clean;
}

function getLightweightCapabilities(targetIntent) {
  if (targetIntent === 'transaction_capability') {
    return [
      'Can confirm transaction analysis capability.',
      'Must not list rows or inspect workbook data for this turn.'
    ];
  }
  return ['Can answer conversationally.', 'No workbook analysis is needed for this turn.'];
}

function buildLightweightAdvisorPacket(summary) {
  const source = summary || {};
  const targetIntent = String(source.target_intent || source.targetIntent || source.intent || '');
  const conversationContext =
    source.conversation_context && typeof source.conversation_context === 'object'
      ? source.conversation_context
      : {};
  return {
    schema_version: source.schema_version || 'cavalry.advisor_packet.v2',
    generated_at: source.generated_at || '',
    question: source.question || '',
    resolved_question: getLightweightResolvedQuestion(targetIntent),
    intent: source.intent || '',
    target_intent: targetIntent,
    response_style: source.response_style || source.responseStyle || 'conversational',
    task_spec: buildLightweightTaskSpec(source, targetIntent),
    conversation_context: {
      previous_intent: asString(
        conversationContext.previous_intent || conversationContext.previousIntent
      ),
      previous_target_intent: asString(
        conversationContext.previous_target_intent || conversationContext.previousTargetIntent
      )
    },
    scope: {
      app: 'Cavalry desktop chat',
      data_policy: 'No workbook metrics are included for this conversational turn.'
    },
    capabilities: getLightweightCapabilities(targetIntent),
    data_packets: {},
    unknowns: []
  };
}

function asString(value) {
  return String(value || '').trim();
}

function normalizeStringArray(value, limit = 60) {
  return (Array.isArray(value) ? value : [])
    .map(asString)
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, limit);
}

function getPrimaryPacket(summary = {}) {
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
      return {
        kind: preferred[index],
        packet: packets[preferred[index]]
      };
    }
  }
  const keys = Object.keys(packets);
  return keys.length ? { kind: keys[0], packet: packets[keys[0]] } : { kind: '', packet: null };
}

function compactRows(rows, limit) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, limit)
    .map((row) => (row && typeof row === 'object' ? row : {}));
}

function compactPacket(packet) {
  if (!(packet && typeof packet === 'object')) {
    return null;
  }
  const result = {};
  [
    'packet_version',
    'question_type',
    'mode',
    'period',
    'selection',
    'counts',
    'totals',
    'budget_reliability',
    'spending_definition',
    'semantic_summary',
    'category_reliability',
    'limitations',
    'as_of',
    'currency'
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(packet, key)) {
      result[key] = packet[key];
    }
  });
  [
    ['top_spending_categories', 8],
    ['over_budget_categories', 8],
    ['recurring_or_subscription_rows', 8],
    ['vague_category_rows', 8],
    ['transfer_like_rows', 8],
    ['largest_real_expense_rows', 12],
    ['category_impact_summary', 8],
    ['top_negative_impact_transactions', 12],
    ['top_positive_impact_transactions', 8],
    ['excluded_neutral_transactions', 8],
    ['transactions', 20],
    ['candidate_improvements', 10],
    ['sample_transactions_needing_review', 10],
    ['accounts', 40],
    ['categories', 120]
  ].forEach(([key, limit]) => {
    if (Array.isArray(packet[key])) {
      result[key] = compactRows(packet[key], limit);
    }
  });
  return result;
}

function compactEvidenceFact(fact) {
  return {
    id: asString(fact && fact.id),
    kind: asString(fact && fact.kind),
    label: asString(fact && fact.label),
    value:
      fact && Object.prototype.hasOwnProperty.call(fact, 'formattedValue') && fact.formattedValue
        ? fact.formattedValue
        : fact && fact.value,
    sourceRefs: normalizeStringArray(fact && fact.sourceRefs, 12),
    certainty: asString(fact && fact.certainty)
  };
}

function buildAdvisorFactPacket(summary = {}, options = {}) {
  const workspace = options.evidenceWorkspace || options.evidence_workspace || {};
  const primary = getPrimaryPacket(summary);
  return {
    schema_version: 'cavalry.advisor_facts.v1',
    question: asString(summary.question),
    resolved_question: asString(summary.resolved_question || summary.resolvedQuestion),
    intent: asString(summary.intent),
    target_intent: asString(summary.target_intent || summary.targetIntent),
    response_style: asString(summary.response_style || summary.responseStyle),
    scope: summary.scope || {},
    facts: (Array.isArray(workspace.facts) ? workspace.facts : [])
      .map(compactEvidenceFact)
      .filter((fact) => fact.label || fact.id)
      .slice(0, 36),
    coverage:
      Array.isArray(workspace.coverage) && workspace.coverage.length
        ? workspace.coverage.slice(0, 8)
        : primary.packet && primary.packet.selection
          ? [
              {
                selectionPolicy: primary.packet.selection.policy || '',
                totalEligibleRecords: primary.packet.selection.source_count || 0,
                returnedRecords: primary.packet.selection.included_count || 0,
                omittedRecords: primary.packet.selection.omitted_count || 0
              }
            ]
          : [],
    uncertainties: (Array.isArray(workspace.uncertainties) ? workspace.uncertainties : [])
      .map((item) => ({
        text: asString(item && item.text),
        sourceRefs: normalizeStringArray(item && item.sourceRefs, 8)
      }))
      .filter((item) => item.text)
      .slice(0, 12),
    selected_packet_kind: primary.kind,
    selected_packet: compactPacket(primary.packet)
  };
}

export function buildAdvisorModelMessages(question, financialSummary, options = {}) {
  const rawSummary = financialSummary || {};
  const summary = shouldUseLightweightAdvisorPacket(rawSummary)
    ? buildLightweightAdvisorPacket(rawSummary)
    : rawSummary;
  const history = getAdvisorRecentHistoryMessages(options.history || []);
  const contract = getAdvisorModelBehaviorContract();
  const factPacket = buildAdvisorFactPacket(summary, options);
  if (options.proseMode) {
    const messages = [
      {
        role: 'system',
        content: contract
          .concat([
            'Return concise natural Markdown, not JSON.',
            'Use the resolved_question, intent, response_style, and conversation_context fields to handle follow-up questions.',
            'Use task_spec.dateScope instead of the app-wide visible range when they differ.',
            'Do not show answer_plan section ids; choose headings only when they help the user read the answer.',
            'Avoid recurring report headers like Quick read, Scope used, Important observations, What this means, What that means for the transfer, Practical take, and Next best actions unless the user explicitly asks for a report or checklist.',
            'Prefer one or two direct paragraphs plus short bullets only when bullets genuinely make the answer easier to scan.',
            'If data_packets.transaction_analysis is present, use it for transaction and spending analysis instead of generic budget risks.',
            'If data_packets.account_snapshot is present, answer from the listed accounts and balances, but do not include total assets, total liabilities, or net worth unless the user asks for balances, a financial overview, or analysis.',
            'If data_packets.category_inventory is present, use its categories array as the full category roster; include categories with zero selected-period transactions and say zero usage is different from a missing category.',
            'If data_packets.transaction_list is present, you have the requested transaction rows; do not say you lack access to the transaction list.',
            'If data_packets.categorization_review is present, give a review first; do not create or imply a cleanup draft unless the user explicitly asks.',
            'When you use a table, use a standard Markdown pipe table with a header row and divider row.',
            'Bold important numbers, categories, accounts, and bills that are directly supported by source refs.',
            'If the user asks what you think, give a practical interpretation based on the facts and label it as interpretation.',
            'Before finalizing, silently check: every money amount appears in the packet or fact list, every date range matches scope, no internal words like schema/validation/model/retry appear, no direct workbook mutation is claimed, and no table is used when task_spec.answerPlan.tableAllowed is false.'
          ])
          .join(' ')
      }
    ];
    history.forEach((message) => {
      messages.push(message);
    });
    messages.push({
      role: 'user',
      content: [
        'Cavalry facts:',
        JSON.stringify(factPacket, null, 2),
        '',
        'Cavalry source packet:',
        JSON.stringify(summary, null, 2),
        '',
        'Answer this resolved question: ' + String(summary.resolved_question || ''),
        'Original user message: ' + String(question || '').trim()
      ].join('\n')
    });
    return messages;
  }

  const messages = [
    {
      role: 'system',
      content: contract
        .concat([
          'Return JSON that matches the requested Cavalry advisor schema.',
          'Use task_spec.dateScope instead of the app-wide visible range when they differ.',
          'Use answer_plan as context only; do not expose section ids in answer_markdown.',
          'Write answer_markdown naturally and avoid recurring report headers like Quick read, Scope used, Important observations, Practical take, and Next best actions unless the user asks for a report.',
          'When answer_markdown includes a table, use a standard Markdown pipe table with a header row and divider row.',
          'When answering with a number, include it in reference_tokens and bold the matching token in answer_markdown.',
          'Use source refs from the provided summary only.',
          'If data_packets.transaction_analysis is present, use it for transaction and spending analysis instead of generic budget risks.',
          'If data_packets.account_snapshot is present, answer from the listed accounts and balances, but do not include total assets, total liabilities, or net worth unless the user asks for balances, a financial overview, or analysis.',
          'If data_packets.category_inventory is present, use its categories array as the full category roster; include categories with zero selected-period transactions and say zero usage is different from a missing category.',
          'If data_packets.transaction_list is present, use those transaction rows and do not say you lack transaction-list access.',
          'If the requested number is missing, say what is missing.',
          'Distinguish facts, observations, and suggestions.',
          'Never claim that a bill was paid, a transaction cleared, or an account is current unless the summary says so.',
          'Before finalizing, silently check: every money amount appears in the packet, every date range matches scope, no internal words like schema/validation/model/retry appear, no direct workbook mutation is claimed, and no table is used when task_spec.answerPlan.tableAllowed is false.'
        ])
        .join(' ')
    }
  ];
  history.forEach((message) => {
    messages.push(message);
  });
  messages.push({
    role: 'user',
    content: JSON.stringify(summary, null, 2)
  });
  return messages;
}
