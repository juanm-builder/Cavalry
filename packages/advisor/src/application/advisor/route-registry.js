export const ADVISOR_QA_ROUTES = Object.freeze({
  greeting: Object.freeze({
    route: 'qa',
    intent: 'greeting',
    packetKinds: [],
    dataNeeds: [],
    toolNames: [],
    actionIds: [],
    selectionPolicy: 'no_workbook_data',
    maximumRows: 0,
    modelAllowed: true
  }),
  small_talk: Object.freeze({
    route: 'qa',
    intent: 'small_talk',
    packetKinds: [],
    dataNeeds: [],
    toolNames: [],
    actionIds: [],
    selectionPolicy: 'no_workbook_data',
    maximumRows: 0,
    modelAllowed: true
  }),
  transaction_capability: Object.freeze({
    route: 'qa',
    intent: 'transaction_capability',
    packetKinds: [],
    dataNeeds: [],
    toolNames: [],
    actionIds: [],
    selectionPolicy: 'no_workbook_data',
    maximumRows: 0,
    modelAllowed: true
  }),
  spending_analysis: Object.freeze({
    route: 'qa',
    intent: 'spending_analysis',
    packetKinds: ['transaction_analysis'],
    dataNeeds: [
      'scoped_cashflow_split',
      'top_spending_categories',
      'over_budget_categories',
      'recurring_or_subscription_signals',
      'vague_category_rows',
      'transfer_like_candidates',
      'largest_real_expense_rows'
    ],
    toolNames: [
      'summarize_spending',
      'classify_cash_movements',
      'detect_recurring_transactions',
      'simulate_spending_change'
    ],
    actionIds: [
      'show_supporting_transactions',
      'review_category_assignments',
      'simulate_spending_reduction'
    ],
    selectionPolicy: 'ranked_analysis_slices',
    maximumRows: 12,
    modelAllowed: true
  }),
  transaction_list: Object.freeze({
    route: 'qa',
    intent: 'transaction_list',
    packetKinds: ['transaction_list'],
    dataNeeds: ['scoped_transaction_rows'],
    toolNames: ['list_transactions'],
    actionIds: ['show_full_transaction_list', 'show_next_page'],
    selectionPolicy: 'requested_transaction_rows',
    maximumRows: 20,
    modelAllowed: true
  }),
  net_worth_impact_transactions: Object.freeze({
    route: 'qa',
    intent: 'net_worth_impact_transactions',
    packetKinds: ['transaction_net_worth_impact'],
    dataNeeds: ['scoped_financial_summary', 'transaction_net_worth_impact_rows'],
    toolNames: ['get_supporting_transactions', 'classify_cash_movements'],
    actionIds: ['show_largest_impacts', 'show_excluded_neutral_transactions'],
    selectionPolicy: 'ranked_net_worth_impact_rows',
    maximumRows: 30,
    modelAllowed: true
  }),
  account_analysis: Object.freeze({
    route: 'qa',
    intent: 'account_analysis',
    packetKinds: ['account_snapshot'],
    dataNeeds: ['account_balances', 'account_roster', 'asset_liability_split'],
    toolNames: ['summarize_accounts'],
    actionIds: [],
    selectionPolicy: 'active_asset_liability_accounts_plus_archived_nonzero',
    maximumRows: 40,
    modelAllowed: true
  }),
  category_inventory: Object.freeze({
    route: 'qa',
    intent: 'category_inventory',
    packetKinds: ['category_inventory'],
    dataNeeds: ['category_roster', 'category_usage_counts'],
    toolNames: ['list_categories'],
    actionIds: ['review_category_assignments'],
    selectionPolicy: 'full_category_inventory',
    maximumRows: 120,
    modelAllowed: true
  }),
  categorization_review: Object.freeze({
    route: 'qa',
    intent: 'categorization_review',
    packetKinds: ['categorization_review'],
    dataNeeds: ['category_quality_signals', 'cleanup_candidates'],
    toolNames: [
      'review_categorization',
      'list_categories',
      'list_transactions',
      'detect_recurring_transactions',
      'prepare_category_drafts'
    ],
    actionIds: [
      'prepare_category_cleanup_draft',
      'compare_before_after_categories',
      'review_category_assignments'
    ],
    selectionPolicy: 'categorization_review_slices',
    maximumRows: 12,
    modelAllowed: true
  })
});

export const ADVISOR_BRAIN_ROUTES = Object.freeze({
  advisor_brain: Object.freeze({
    route: 'brain',
    intent: 'advisor_brain',
    packetKinds: ['advisor_brain_context'],
    dataNeeds: ['workbook_map', 'targeted_context_on_demand', 'reviewable_ai_drafts'],
    toolNames: [
      'get_workbook_health',
      'review_categorization',
      'list_categories',
      'prepare_category_drafts',
      'prepare_ledger_cleanup_draft'
    ],
    actionIds: ['open_draft_review'],
    selectionPolicy: 'context_on_demand',
    maximumRows: 12,
    modelAllowed: true,
    responseMode: 'json_schema',
    mutating: false,
    reviewRequired: true
  })
});

export function getAdvisorQaRoute(intent) {
  return ADVISOR_QA_ROUTES[String(intent || '')] || null;
}

export function isAdvisorQaRoute(intent) {
  return !!getAdvisorQaRoute(intent);
}

export function getAdvisorBrainRoute(intent) {
  return ADVISOR_BRAIN_ROUTES[String(intent || '')] || null;
}

export function isAdvisorBrainRoute(intent) {
  return !!getAdvisorBrainRoute(intent);
}
