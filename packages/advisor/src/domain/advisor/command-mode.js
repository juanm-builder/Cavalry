export const ADVISOR_COMMAND_MODE_VERSION = 'cavalry.advisor_command_mode.v1';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function commandDefinition(id, label, options = {}) {
  return Object.freeze(
    Object.assign(
      {
        id,
        label,
        targetIntent: id,
        handler: 'clarify',
        safetyLevel: 'read_only',
        requiresConfirmation: false,
        createsProposal: false,
        icon: 'north_east',
        description: ''
      },
      options
    )
  );
}

export const ADVISOR_COMMAND_DEFINITIONS = Object.freeze([
  commandDefinition('record_transaction', 'Record transaction', {
    targetIntent: 'record_transaction',
    handler: 'transaction_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'receipt_long',
    description: 'Prepare one transaction draft from a natural-language command.'
  }),
  commandDefinition('record_transaction_batch', 'Record transactions', {
    targetIntent: 'record_transaction_batch',
    handler: 'transaction_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'playlist_add',
    description: 'Prepare multiple transaction drafts from typed rows, receipts, or batch wording.'
  }),
  commandDefinition('record_income', 'Record income', {
    targetIntent: 'record_transaction',
    handler: 'transaction_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'payments',
    description: 'Prepare an incoming-money transaction draft.'
  }),
  commandDefinition('record_expense', 'Record expense', {
    targetIntent: 'record_transaction',
    handler: 'transaction_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'shopping_bag',
    description: 'Prepare an expense transaction draft.'
  }),
  commandDefinition('record_transfer', 'Record transfer', {
    targetIntent: 'record_transaction',
    handler: 'transaction_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'sync_alt',
    description: 'Prepare a transfer transaction draft.'
  }),
  commandDefinition('read_transactions', 'Read transactions', {
    targetIntent: 'transaction_list',
    handler: 'qa',
    icon: 'format_list_bulleted',
    description: 'Show transactions from the selected or requested period.'
  }),
  commandDefinition('search_transactions', 'Search transactions', {
    targetIntent: 'transaction_list',
    handler: 'qa',
    icon: 'manage_search',
    description: 'Find transactions by date, amount, merchant, category, or account.'
  }),
  commandDefinition('analyze_transactions', 'Analyze transactions', {
    targetIntent: 'transaction_analysis',
    handler: 'qa',
    icon: 'query_stats',
    description: 'Analyze transaction patterns without dumping every row.'
  }),
  commandDefinition('analyze_spending', 'Analyze spending', {
    targetIntent: 'spending_analysis',
    handler: 'qa',
    icon: 'monitoring',
    description: 'Analyze spending pressure and top categories.'
  }),
  commandDefinition('analyze_budget', 'Analyze budget', {
    targetIntent: 'budget_attention',
    handler: 'local_response',
    icon: 'donut_large',
    description: 'Explain budget use, variance, and pressure.'
  }),
  commandDefinition('analyze_cashflow', 'Analyze cash flow', {
    targetIntent: 'cashflow_review',
    handler: 'local_response',
    icon: 'waterfall_chart',
    description: 'Explain inflows, outflows, net flow, and buffer.'
  }),
  commandDefinition('analyze_financial_standing', 'Analyze financial standing', {
    targetIntent: 'cashflow_review',
    handler: 'local_response',
    icon: 'account_balance',
    description:
      'Explain the current financial standing across cash flow, buffer, budget pressure, and net worth.'
  }),
  commandDefinition('analyze_net_worth', 'Analyze net worth', {
    targetIntent: 'net_worth',
    handler: 'local_response',
    icon: 'account_balance',
    description: 'Explain assets, liabilities, and net worth.'
  }),
  commandDefinition('analyze_income', 'Analyze income', {
    targetIntent: 'income',
    handler: 'local_response',
    icon: 'trending_up',
    description: 'Explain income and inflow trends.'
  }),
  commandDefinition('analyze_subscriptions', 'Analyze subscriptions', {
    targetIntent: 'bill_attention',
    handler: 'local_response',
    icon: 'subscriptions',
    description: 'Review subscriptions, bills, and recurring items.'
  }),
  commandDefinition('update_transaction', 'Update transaction', {
    targetIntent: 'update_transaction',
    handler: 'transaction_metadata_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'edit',
    description: 'Prepare a safe transaction metadata draft.'
  }),
  commandDefinition('delete_transaction', 'Delete transaction', {
    targetIntent: 'delete_transaction',
    handler: 'workbook_draft',
    safetyLevel: 'destructive',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'delete',
    description: 'Prepare a reviewable delete/archive draft for a transaction.'
  }),
  commandDefinition('create_budget', 'Create budget', {
    targetIntent: 'create_budget',
    handler: 'workbook_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'add_chart',
    description: 'Prepare a budget draft for the active month.'
  }),
  commandDefinition('update_budget', 'Update budget', {
    targetIntent: 'update_budget',
    handler: 'workbook_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'edit_note',
    description: 'Prepare a budget amount change draft.'
  }),
  commandDefinition('delete_budget', 'Delete budget', {
    targetIntent: 'delete_budget',
    handler: 'workbook_draft',
    safetyLevel: 'destructive',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'delete',
    description: 'Prepare a budget removal draft.'
  }),
  commandDefinition('create_account', 'Create account', {
    targetIntent: 'create_account',
    handler: 'workbook_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'account_balance_wallet',
    description: 'Prepare an account creation draft.'
  }),
  commandDefinition('update_account', 'Update account', {
    targetIntent: 'update_account',
    handler: 'workbook_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'edit',
    description: 'Prepare an account rename or detail update draft.'
  }),
  commandDefinition('archive_account', 'Archive account', {
    targetIntent: 'archive_account',
    handler: 'workbook_draft',
    safetyLevel: 'destructive',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'archive',
    description: 'Prepare an account archive draft without deleting history.'
  }),
  commandDefinition('delete_account', 'Delete account', {
    targetIntent: 'delete_account',
    handler: 'workbook_draft',
    safetyLevel: 'destructive',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'delete',
    description: 'Prepare an account deletion draft when safe.'
  }),
  commandDefinition('create_category', 'Create category', {
    targetIntent: 'create_category',
    handler: 'workbook_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'category',
    description: 'Prepare a category creation draft.'
  }),
  commandDefinition('update_category', 'Update category', {
    targetIntent: 'update_category',
    handler: 'workbook_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'drive_file_rename_outline',
    description: 'Prepare a category rename or edit draft.'
  }),
  commandDefinition('archive_category', 'Archive category', {
    targetIntent: 'archive_category',
    handler: 'workbook_draft',
    safetyLevel: 'destructive',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'archive',
    description: 'Prepare a category archive draft.'
  }),
  commandDefinition('delete_category', 'Delete category', {
    targetIntent: 'delete_category',
    handler: 'workbook_draft',
    safetyLevel: 'destructive',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'delete',
    description: 'Prepare a hard-delete category draft when safe.'
  }),
  commandDefinition('create_counterparty', 'Create counterparty', {
    targetIntent: 'create_counterparty',
    handler: 'workbook_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'person_add',
    description: 'Prepare a merchant/payee/counterparty creation draft.'
  }),
  commandDefinition('update_counterparty', 'Update counterparty', {
    targetIntent: 'update_counterparty',
    handler: 'workbook_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'badge',
    description: 'Prepare a counterparty rename or kind edit draft.'
  }),
  commandDefinition('archive_counterparty', 'Archive counterparty', {
    targetIntent: 'archive_counterparty',
    handler: 'workbook_draft',
    safetyLevel: 'destructive',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'archive',
    description: 'Prepare a counterparty archive draft.'
  }),
  commandDefinition('create_recurring_item', 'Create recurring item', {
    targetIntent: 'create_recurring_item',
    handler: 'workbook_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'event_repeat',
    description: 'Prepare a recurring bill or subscription draft.'
  }),
  commandDefinition('update_recurring_item', 'Update recurring item', {
    targetIntent: 'update_recurring_item',
    handler: 'workbook_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'edit_calendar',
    description: 'Prepare a recurring bill/subscription edit draft.'
  }),
  commandDefinition('delete_recurring_item', 'Delete recurring item', {
    targetIntent: 'delete_recurring_item',
    handler: 'workbook_draft',
    safetyLevel: 'destructive',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'event_busy',
    description: 'Prepare a recurring item removal draft.'
  }),
  commandDefinition('review_categories', 'Review categories', {
    targetIntent: 'categorization_review',
    handler: 'qa',
    icon: 'rule',
    description: 'Review categories, merchants, and label quality.'
  }),
  commandDefinition('show_categories', 'Show categories', {
    targetIntent: 'category_inventory',
    handler: 'qa',
    icon: 'category',
    description:
      'Read the full category inventory, including categories with no selected-period transactions.'
  }),
  commandDefinition('cleanup_ledger', 'Clean up ledger', {
    targetIntent: 'ledger_cleanup',
    handler: 'workbook_draft',
    safetyLevel: 'creates_proposal',
    requiresConfirmation: true,
    createsProposal: true,
    icon: 'rule',
    description: 'Prepare a ledger cleanup draft.'
  }),
  commandDefinition('compare_cleanup', 'Compare cleanup', {
    targetIntent: 'compare_before_after_categories',
    handler: 'action',
    icon: 'compare_arrows',
    description: 'Compare current category totals against an active cleanup draft.'
  }),
  commandDefinition('simulate_spending_change', 'Simulate spending change', {
    targetIntent: 'simulate_spending_change',
    handler: 'action',
    icon: 'calculate',
    description: 'Run a read-only spending reduction simulation.'
  }),
  commandDefinition('explain_metric', 'Explain metric', {
    targetIntent: 'explain_metric',
    handler: 'local_response',
    icon: 'help',
    description: 'Explain a visible metric such as net flow, budget use, or cash buffer.'
  }),
  commandDefinition('show_accounts', 'Show accounts', {
    targetIntent: 'account_analysis',
    handler: 'qa',
    icon: 'account_balance_wallet',
    description: 'Read account and balance information.'
  }),
  commandDefinition('show_budgets', 'Show budgets', {
    targetIntent: 'budget_attention',
    handler: 'local_response',
    icon: 'list_alt',
    description: 'Read budget information.'
  }),
  commandDefinition('review_bills', 'Review bills', {
    targetIntent: 'bill_attention',
    handler: 'local_response',
    icon: 'event',
    description: 'Read bills, subscriptions, and recurring items.'
  }),
  commandDefinition('clarify', 'Clarify', {
    targetIntent: 'clarify',
    handler: 'clarify',
    icon: 'help',
    description: 'Ask a focused follow-up when a command is missing essential details.'
  })
]);

const COMMANDS_BY_ID = Object.freeze(
  ADVISOR_COMMAND_DEFINITIONS.reduce((map, definition) => {
    map[definition.id] = definition;
    return map;
  }, {})
);

function buildCommand(id, prompt, confidence, reason, extras = {}) {
  if (!id) {
    return Object.assign(
      {
        schema_version: ADVISOR_COMMAND_MODE_VERSION,
        intent: '',
        command: '',
        label: '',
        targetIntent: '',
        handler: '',
        safetyLevel: '',
        requiresConfirmation: false,
        createsProposal: false,
        icon: '',
        confidence: 0,
        reason: reason || '',
        source: 'command_mode',
        prompt: String(prompt || '').trim(),
        source_refs: []
      },
      extras
    );
  }
  const definition = COMMANDS_BY_ID[id] || COMMANDS_BY_ID.clarify;
  return Object.assign(
    {
      schema_version: ADVISOR_COMMAND_MODE_VERSION,
      intent: definition.id,
      command: definition.id,
      label: definition.label,
      targetIntent: definition.targetIntent,
      handler: definition.handler,
      safetyLevel: definition.safetyLevel,
      requiresConfirmation: definition.requiresConfirmation,
      createsProposal: definition.createsProposal,
      icon: definition.icon,
      confidence,
      reason,
      source: 'command_mode',
      prompt: String(prompt || '').trim(),
      source_refs: []
    },
    extras
  );
}

function hasAny(lower, pattern) {
  return pattern.test(lower);
}

function commandVerbPattern() {
  return /\b(add|record|log|post|create|enter|book|save|put|make|open|opened|set|update|edit|change|rename|archive|deactivate|delete|remove|drop|track|review|analyze|analyse|audit|check|read|show|list|find|search|look|recommend|suggest|explain|why|what|which|compare|simulate|forecast|clean|cleanup|fix|categorize|recategorize|transfer|transferred|move|moved|send|sent)\b/;
}

function mentionsTransaction(lower) {
  return /\b(transaction|transactions|expense|expenses|income|transfer|transfers|payment|payments|purchase|purchases|charge|charges|entry|entries|receipt|receipts)\b/.test(
    lower
  );
}

function mentionsAmountOrMoney(lower) {
  return /\b\d+(?:[,.]\d{3})*(?:\.\d+)?\b|\bphp|peso|pesos|usd|dollar|dollars\b/.test(lower);
}

function looksLikeTransactionPaymentCommand(lower) {
  return (
    mentionsAmountOrMoney(lower) &&
    /\b(charged|charge|spent|paid|pay|bought|buy|purchase|purchased|expense|credits?)\b/.test(lower)
  );
}

function looksLikeCategoryReviewCommand(lower) {
  const mentionsCategorization =
    /\b(categorizing|categorize|categorized|category|categories|label|labels|counterparty|counterparties|merchant|merchants|payee|payees|ledger)\b/.test(
      lower
    );
  const mentionsLedgerScope =
    mentionsTransaction(lower) ||
    /\b(spending|spend|expenses?|purchases?|charges?|ledger|counterparties|merchants?|payees?)\b/.test(
      lower
    );
  const asksForReview =
    /\b(review|recommend|recommendation|suggest|suggestion|suggestions|improve|improvements|audit|analyze|analyse|check|look at|tell me|what categories|which categories|should i add|should we add|categories i should add|categories to add)\b/.test(
      lower
    );
  const directlyCreatesCategory =
    /\b(?:add|create|make|new)\s+(?:a\s+|an\s+|the\s+)?(?:category|categories)\s*(?:called|named|for|as|with name)?\b/.test(
      lower
    );
  const directlyMutatesCategory =
    /\b(rename|delete|archive|deactivate|merge|recategorize|reclassify|change|edit|update)\b/.test(
      lower
    );
  return !!(
    mentionsCategorization &&
    mentionsLedgerScope &&
    asksForReview &&
    !directlyCreatesCategory &&
    !directlyMutatesCategory
  );
}

function classifyWriteObjectCommand(prompt, lower) {
  const destructive = /\b(delete|remove|drop|deactivate|archive)\b/.test(lower);
  const edit = /\b(update|edit|change|rename|set|fix)\b/.test(lower);
  const create = /\b(add|create|make|new|track|open|opened)\b/.test(lower);
  if (
    /\baccount|accounts|wallet|bank|card|cash|liability|asset\b/.test(lower) &&
    !mentionsTransaction(lower) &&
    !looksLikeTransactionPaymentCommand(lower)
  ) {
    if (/\bdelete|remove|drop\b/.test(lower))
      return buildCommand('delete_account', prompt, 0.78, 'Account delete command.');
    if (/\barchive|deactivate\b/.test(lower))
      return buildCommand('archive_account', prompt, 0.8, 'Account archive command.');
    if (edit) return buildCommand('update_account', prompt, 0.78, 'Account update command.');
    if (create) return buildCommand('create_account', prompt, 0.82, 'Account create command.');
  }
  if (/\bbudget|budgets|planned|plan\b/.test(lower)) {
    if (destructive) return buildCommand('delete_budget', prompt, 0.72, 'Budget removal command.');
    if (edit || /\bset\b/.test(lower))
      return buildCommand('update_budget', prompt, 0.84, 'Budget update command.');
    if (create) return buildCommand('create_budget', prompt, 0.76, 'Budget create command.');
  }
  if (/\bcategory|categories\b/.test(lower) && !mentionsTransaction(lower)) {
    if (/\bdelete|remove|drop\b/.test(lower))
      return buildCommand('delete_category', prompt, 0.8, 'Category delete command.');
    if (/\barchive|deactivate\b/.test(lower))
      return buildCommand('archive_category', prompt, 0.82, 'Category archive command.');
    if (edit) return buildCommand('update_category', prompt, 0.82, 'Category update command.');
    if (create) return buildCommand('create_category', prompt, 0.82, 'Category create command.');
  }
  if (
    /\bcounterparty|counterparties|merchant|merchants|payee|payees|biller|billers|client|employer\b/.test(
      lower
    ) &&
    !mentionsTransaction(lower)
  ) {
    if (/\barchive|deactivate|delete|remove|drop\b/.test(lower))
      return buildCommand('archive_counterparty', prompt, 0.78, 'Counterparty archive command.');
    if (edit)
      return buildCommand('update_counterparty', prompt, 0.76, 'Counterparty update command.');
    if (create)
      return buildCommand('create_counterparty', prompt, 0.78, 'Counterparty create command.');
  }
  if (/\bsubscription|subscriptions|bill|bills|recurring\b/.test(lower)) {
    if (destructive)
      return buildCommand('delete_recurring_item', prompt, 0.72, 'Recurring item removal command.');
    if (edit)
      return buildCommand('update_recurring_item', prompt, 0.74, 'Recurring item update command.');
    if (create || /\btrack\b/.test(lower))
      return buildCommand('create_recurring_item', prompt, 0.82, 'Recurring item create command.');
  }
  return null;
}

export function getAdvisorCommandDefinition(id) {
  return COMMANDS_BY_ID[String(id || '').trim()] || null;
}

export function getAdvisorCommandDefinitions() {
  return ADVISOR_COMMAND_DEFINITIONS.slice();
}

export function normalizeAdvisorCommandMode(value) {
  const source = value && typeof value === 'object' ? value : {};
  const id = String(source.intent || source.command || '').trim();
  const definition = getAdvisorCommandDefinition(id);
  if (!definition) {
    return buildCommand('', source.prompt || '', 0, '');
  }
  return buildCommand(
    definition.id,
    source.prompt || '',
    Number(source.confidence) || 0,
    source.reason || '',
    {
      source_refs: Array.isArray(source.source_refs)
        ? source.source_refs.map((ref) => String(ref || '').trim()).filter(Boolean)
        : []
    }
  );
}

export function classifyAdvisorCommandMode(prompt, options = {}) {
  const lower = normalizeText(prompt);
  if (!lower) {
    return buildCommand('clarify', prompt, 0, 'Empty prompt.', { needsClarification: true });
  }
  if (!commandVerbPattern().test(lower)) {
    return buildCommand('', prompt, 0, 'No command verb detected.');
  }

  if (
    /\b(compare)\b/.test(lower) &&
    /\b(cleanup|clean up|before|after|category|categories)\b/.test(lower)
  ) {
    return buildCommand('compare_cleanup', prompt, 0.82, 'Cleanup comparison command.');
  }
  if (
    /\b(simulate|simulation|forecast|what if)\b/.test(lower) &&
    /\b(spending|expense|expenses|reduction|reduce|cut|lower)\b/.test(lower)
  ) {
    return buildCommand('simulate_spending_change', prompt, 0.82, 'Spending simulation command.');
  }
  if (
    /\b(cleanup|clean up|fix|organize|standardize|recategorize|reclassify)\b/.test(lower) &&
    /\b(ledger|category|categories|labels?|counterparties|merchants|payees|transactions?)\b/.test(
      lower
    )
  ) {
    return buildCommand('cleanup_ledger', prompt, 0.84, 'Ledger cleanup command.');
  }

  if (looksLikeCategoryReviewCommand(lower)) {
    return buildCommand(
      'review_categories',
      prompt,
      0.88,
      'Category recommendation review command.'
    );
  }

  if (
    /\b(add|record|log|post|enter|book|save|put)\b/.test(lower) &&
    looksLikeTransactionPaymentCommand(lower)
  ) {
    if (/\b(income|salary|received|inflow|earned)\b/.test(lower))
      return buildCommand('record_income', prompt, 0.82, 'Income transaction command.');
    if (/\b(transfer|transferred|move|moved|sent|send)\b/.test(lower))
      return buildCommand('record_transfer', prompt, 0.82, 'Transfer transaction command.');
    return buildCommand(
      /\b(expense|spent|paid|bought|purchase|purchased|charge|charged|credits?)\b/.test(lower)
        ? 'record_expense'
        : 'record_transaction',
      prompt,
      0.88,
      'Transaction payment command.'
    );
  }

  if (
    /\b(explain|why|what is|what does)\b/.test(lower) &&
    /\b(net flow|cash buffer|buffer|budget use|budget used|runway|savings rate|net worth|outflow|inflow|variance|metric|number)\b/.test(
      lower
    )
  ) {
    const metricTarget = /\b(net worth|networth)\b/.test(lower)
      ? 'net_worth'
      : /\b(budget use|budget used|variance)\b/.test(lower)
        ? 'budget_attention'
        : /\b(inflow|income)\b/.test(lower)
          ? 'income'
          : 'cashflow_review';
    return buildCommand('explain_metric', prompt, 0.8, 'Metric explanation command.', {
      targetIntent: metricTarget
    });
  }

  const writeObject = classifyWriteObjectCommand(prompt, lower);
  if (writeObject) {
    return writeObject;
  }

  if (/\b(delete|remove|drop)\b/.test(lower) && mentionsTransaction(lower)) {
    return buildCommand('delete_transaction', prompt, 0.8, 'Transaction delete command.');
  }
  if (
    /\b(update|edit|change|rename|fix|categorize|recategorize|set)\b/.test(lower) &&
    mentionsTransaction(lower)
  ) {
    return buildCommand('update_transaction', prompt, 0.82, 'Transaction update command.');
  }
  if (
    /\b(analyze|analyse|review|audit|insight|thoughts?|opinion|what do you think|tell me what you think|your read|honest thoughts)\b/.test(
      lower
    ) &&
    mentionsTransaction(lower)
  ) {
    return buildCommand('analyze_transactions', prompt, 0.88, 'Transaction analysis command.');
  }
  if (
    /\b(read|show|list|display|find|search|look up|lookup)\b/.test(lower) &&
    mentionsTransaction(lower)
  ) {
    return buildCommand(
      /\b(find|search|look up|lookup)\b/.test(lower) ? 'search_transactions' : 'read_transactions',
      prompt,
      0.86,
      'Transaction read command.'
    );
  }

  if (
    /\b(transfer|transferred|move|moved|send|sent)\b/.test(lower) &&
    /\b(from|to|into|between)\b/.test(lower) &&
    /\b(money|fund|funds|account|accounts|cash|wallet|bank|card|liability|liabilities)\b/.test(
      lower
    )
  ) {
    return buildCommand('record_transfer', prompt, 0.84, 'Transfer transaction command.');
  }

  if (
    /\b(add|record|log|post|create|enter|book|save|put)\b/.test(lower) &&
    (mentionsTransaction(lower) || mentionsAmountOrMoney(lower))
  ) {
    if (/\b(income|salary|received|inflow|earned)\b/.test(lower))
      return buildCommand('record_income', prompt, 0.82, 'Income transaction command.');
    if (/\b(transfer|transferred|move|moved|sent|send)\b/.test(lower))
      return buildCommand('record_transfer', prompt, 0.82, 'Transfer transaction command.');
    if (
      /\b(these|those|multiple|batch|several|\d+\s+(transactions|expenses|payments|purchases|charges|entries))\b/.test(
        lower
      )
    ) {
      return buildCommand('record_transaction_batch', prompt, 0.86, 'Batch transaction command.');
    }
    return buildCommand(
      /\b(expense|spent|paid|bought|purchase|charge)\b/.test(lower)
        ? 'record_expense'
        : 'record_transaction',
      prompt,
      0.84,
      'Transaction record command.'
    );
  }

  if (/\b(analyze|analyse|review|audit|check)\b/.test(lower)) {
    if (
      /\b(financial standing|financial health|financial position|current finances|finances|money situation|how am i doing|overall financial|overall finances)\b/.test(
        lower
      )
    ) {
      return buildCommand(
        'analyze_financial_standing',
        prompt,
        0.8,
        'Financial standing analysis command.'
      );
    }
    if (/\b(spending|expense|expenses|outflow|outflows)\b/.test(lower))
      return buildCommand('analyze_spending', prompt, 0.78, 'Spending analysis command.');
    if (/\b(budget|budgets|planned|plan)\b/.test(lower))
      return buildCommand('analyze_budget', prompt, 0.78, 'Budget analysis command.');
    if (/\b(cash flow|cashflow|net flow|buffer|runway|liquid)\b/.test(lower))
      return buildCommand('analyze_cashflow', prompt, 0.78, 'Cash-flow analysis command.');
    if (/\b(net worth|networth|assets|liabilities)\b/.test(lower))
      return buildCommand('analyze_net_worth', prompt, 0.78, 'Net-worth analysis command.');
    if (/\b(income|inflow|inflows|earned|salary)\b/.test(lower))
      return buildCommand('analyze_income', prompt, 0.76, 'Income analysis command.');
    if (/\b(subscription|subscriptions|bill|bills|recurring)\b/.test(lower))
      return buildCommand('analyze_subscriptions', prompt, 0.78, 'Subscription analysis command.');
  }
  if (
    hasAny(lower, /\b(show|list|read)\b/) &&
    /\b(account|accounts|balances?|assets|liabilities)\b/.test(lower)
  ) {
    return buildCommand('show_accounts', prompt, 0.76, 'Account read command.');
  }
  if (hasAny(lower, /\b(show|list|read|display)\b/) && /\b(category|categories)\b/.test(lower)) {
    return buildCommand('show_categories', prompt, 0.8, 'Category inventory read command.');
  }
  if (hasAny(lower, /\b(show|list|read)\b/) && /\b(budget|budgets|planned|plan)\b/.test(lower)) {
    return buildCommand('show_budgets', prompt, 0.76, 'Budget read command.');
  }
  if (
    hasAny(lower, /\b(show|list|read|review)\b/) &&
    /\b(subscription|subscriptions|bill|bills|recurring)\b/.test(lower)
  ) {
    return buildCommand('review_bills', prompt, 0.76, 'Bills read command.');
  }

  if (options && options.allowClarifyFallback) {
    return buildCommand('clarify', prompt, 0.35, 'Command-like prompt needs clarification.', {
      needsClarification: true
    });
  }
  return buildCommand('', prompt, 0, 'No Advisor command matched.');
}

export function getAdvisorCommandTargetIntent(prompt, fallbackIntent = '', options = {}) {
  const command = classifyAdvisorCommandMode(prompt, options);
  return command && command.targetIntent && command.intent !== 'clarify'
    ? command.targetIntent
    : fallbackIntent;
}
