import {
  runClassifyCashMovementsTool,
  runDetectRecurringTransactionsTool,
  runGetSupportingTransactionsTool,
  runGetWorkbookHealthTool,
  runListCategoriesTool,
  runListTransactionsTool,
  runPrepareCategoryDraftsTool,
  runPrepareLedgerCleanupDraftTool,
  runReviewCategorizationTool,
  runSimulateSpendingChangeTool,
  runSummarizeAccountsTool,
  runSummarizeSpendingTool
} from './financial-tools.js';

export const ADVISOR_TOOL_RESULT_VERSION = 'cavalry.advisor_tool_result.v1';

function asString(value) {
  return String(value || '').trim();
}

function asInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : fallback;
}

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : []).map((item) => asString(item)).filter(Boolean);
}

function buildToolDefinition(name, description, run, options = {}) {
  return Object.freeze({
    name,
    description,
    authorization: options.authorization || 'read_only',
    supportedRoutes: Object.freeze(normalizeStringArray(options.supportedRoutes)),
    maxResultSize: asInteger(options.maxResultSize, 50),
    run
  });
}

export const ADVISOR_TOOL_REGISTRY = Object.freeze({
  summarize_spending: buildToolDefinition(
    'summarize_spending',
    'Summarize selected-period spending using explicit spending definitions and semantic cash-flow classes.',
    runSummarizeSpendingTool,
    { supportedRoutes: ['spending_analysis', 'transaction_analysis'], maxResultSize: 12 }
  ),
  list_transactions: buildToolDefinition(
    'list_transactions',
    'Return selected-period transaction rows with source refs and semantic classifications.',
    runListTransactionsTool,
    {
      supportedRoutes: ['transaction_list', 'spending_analysis', 'categorization_review'],
      maxResultSize: 50
    }
  ),
  classify_cash_movements: buildToolDefinition(
    'classify_cash_movements',
    'Classify selected-period transactions into income, consumption, debt principal, transfer, and uncertain classes.',
    runClassifyCashMovementsTool,
    {
      supportedRoutes: [
        'spending_analysis',
        'transaction_analysis',
        'net_worth_impact_transactions'
      ],
      maxResultSize: 50
    }
  ),
  get_supporting_transactions: buildToolDefinition(
    'get_supporting_transactions',
    'Return supporting transaction rows for the current evidence or route.',
    runGetSupportingTransactionsTool,
    {
      supportedRoutes: [
        'spending_analysis',
        'net_worth_impact_transactions',
        'categorization_review'
      ],
      maxResultSize: 50
    }
  ),
  summarize_accounts: buildToolDefinition(
    'summarize_accounts',
    'Return account balances and selectable account metadata for account advice.',
    runSummarizeAccountsTool,
    { supportedRoutes: ['account_analysis'], maxResultSize: 40 }
  ),
  list_categories: buildToolDefinition(
    'list_categories',
    'Return the full workbook category inventory, including zero-use and archived categories, with selected-period usage counts.',
    runListCategoriesTool,
    {
      supportedRoutes: ['category_inventory', 'categorization_review', 'advisor_brain'],
      maxResultSize: 120
    }
  ),
  detect_recurring_transactions: buildToolDefinition(
    'detect_recurring_transactions',
    'Find recurring or likely recurring transaction signals for review.',
    runDetectRecurringTransactionsTool,
    { supportedRoutes: ['spending_analysis', 'categorization_review'], maxResultSize: 50 }
  ),
  review_categorization: buildToolDefinition(
    'review_categorization',
    'Review category reliability, vague categories, duplicate labels, and safe cleanup candidates.',
    runReviewCategorizationTool,
    { supportedRoutes: ['categorization_review', 'advisor_brain'], maxResultSize: 50 }
  ),
  get_workbook_health: buildToolDefinition(
    'get_workbook_health',
    'Return workbook validation and object-count health context.',
    runGetWorkbookHealthTool,
    { supportedRoutes: ['advisor_brain', 'categorization_review'], maxResultSize: 1 }
  ),
  prepare_category_drafts: buildToolDefinition(
    'prepare_category_drafts',
    'Prepare review-only category cleanup proposal data without mutating the workbook.',
    runPrepareCategoryDraftsTool,
    {
      authorization: 'creates_proposal',
      supportedRoutes: ['categorization_review', 'advisor_brain'],
      maxResultSize: 50
    }
  ),
  prepare_ledger_cleanup_draft: buildToolDefinition(
    'prepare_ledger_cleanup_draft',
    'Prepare review-only ledger cleanup proposal data without mutating the workbook.',
    runPrepareLedgerCleanupDraftTool,
    {
      authorization: 'creates_proposal',
      supportedRoutes: ['advisor_brain', 'categorization_review'],
      maxResultSize: 50
    }
  ),
  simulate_spending_change: buildToolDefinition(
    'simulate_spending_change',
    'Run a read-only consumption-spending reduction simulation.',
    runSimulateSpendingChangeTool,
    { supportedRoutes: ['spending_analysis'], maxResultSize: 1 }
  )
});

export function getAdvisorToolDefinition(name) {
  return ADVISOR_TOOL_REGISTRY[asString(name)] || null;
}

export function listAdvisorToolDefinitions(routeIntent) {
  const route = asString(routeIntent);
  return Object.keys(ADVISOR_TOOL_REGISTRY)
    .map((key) => ADVISOR_TOOL_REGISTRY[key])
    .filter((tool) => !route || tool.supportedRoutes.indexOf(route) >= 0);
}

function normalizeToolResultEnvelope({ toolCallId, toolName, result }) {
  const output = result && typeof result === 'object' ? result : {};
  return {
    toolResultVersion: ADVISOR_TOOL_RESULT_VERSION,
    toolCallId: asString(toolCallId),
    toolName: asString(toolName),
    ok: true,
    data: output.data || null,
    coverage: output.coverage || {
      totalEligibleRecords: 0,
      returnedRecords: 0,
      selectionPolicy: 'unknown',
      excludedCounts: {}
    },
    sourceRefs: normalizeStringArray(output.sourceRefs),
    limitations: normalizeStringArray(output.limitations)
  };
}

export function buildAdvisorToolError({
  toolCallId,
  toolName,
  code,
  userSafeMessage,
  retryable = false
}) {
  return {
    toolResultVersion: ADVISOR_TOOL_RESULT_VERSION,
    toolCallId: asString(toolCallId),
    toolName: asString(toolName),
    ok: false,
    error: {
      code: asString(code || 'tool_failed'),
      userSafeMessage: asString(userSafeMessage),
      retryable: !!retryable
    },
    coverage: {
      totalEligibleRecords: 0,
      returnedRecords: 0,
      selectionPolicy: 'none',
      excludedCounts: {}
    },
    sourceRefs: [],
    limitations: []
  };
}

export function runAdvisorToolCall(toolCall = {}, environment = {}) {
  const toolName = asString(toolCall.tool || toolCall.name || toolCall.toolName);
  const tool = getAdvisorToolDefinition(toolName);
  const toolCallId = asString(toolCall.id || toolCall.toolCallId) || 'tool_' + toolName;
  if (!tool) {
    return buildAdvisorToolError({
      toolCallId,
      toolName,
      code: 'unsupported_tool',
      userSafeMessage: 'That advisor tool is not available.',
      retryable: false
    });
  }
  try {
    const result = tool.run(
      Object.assign({}, environment, {
        arguments: toolCall.arguments || toolCall.args || {}
      })
    );
    return normalizeToolResultEnvelope({ toolCallId, toolName, result });
  } catch (error) {
    return buildAdvisorToolError({
      toolCallId,
      toolName,
      code: 'tool_exception',
      userSafeMessage: 'I could not gather that advisor evidence.',
      retryable: false
    });
  }
}
