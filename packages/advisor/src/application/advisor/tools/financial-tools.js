import {
  buildAdvisorAccountSnapshotPacket,
  buildAdvisorCategorizationReviewPacket,
  buildAdvisorCategoryInventoryPacket,
  buildAdvisorTransactionAnalysisPacket,
  buildAdvisorTransactionListPacket
} from '../../../domain/advisor/packets.js';
import {
  buildAdvisorSemanticSummary,
  calculateAdvisorRunway,
  SPENDING_DEFINITION
} from '../../../domain/advisor/financial-semantics.js';

function asString(value) {
  return String(value || '').trim();
}

function normalizeDateScope(value = {}) {
  return {
    start: asString(value.start || value.period_start),
    end: asString(value.end || value.period_end),
    label: asString(value.label || value.period_label || 'Selected period'),
    source: asString(value.source || 'tool_arguments')
  };
}

function buildContextFromArguments(context = {}, args = {}) {
  const scope = normalizeDateScope(args.date_scope || args.dateScope || context.dateScope || {});
  const previousProfile = context.profile || {};
  return Object.assign({}, context, {
    profile: Object.assign({}, previousProfile, {
      rangeStart: scope.start || previousProfile.rangeStart || '',
      rangeEnd: scope.end || previousProfile.rangeEnd || '',
      rangeLabel: scope.label || previousProfile.rangeLabel || 'Selected period'
    })
  });
}

function getFilteredTransactions(workbook, context, services = {}) {
  const profile = context && context.profile ? context.profile : {};
  const range = {
    start: profile.rangeStart || '',
    end: profile.rangeEnd || ''
  };
  if (typeof services.getFilteredTransactions === 'function') {
    return services.getFilteredTransactions(workbook, range);
  }
  return (workbook && Array.isArray(workbook.transactions) ? workbook.transactions : []).filter(
    (transaction) => {
      const date = asString(transaction && transaction.date);
      return (!range.start || date >= range.start) && (!range.end || date <= range.end);
    }
  );
}

function buildCoverage(context, packet, transactions) {
  const profile = context && context.profile ? context.profile : {};
  const selection = packet && packet.selection ? packet.selection : {};
  return {
    dateScope: {
      start: asString(profile.rangeStart),
      end: asString(profile.rangeEnd),
      label: asString(profile.rangeLabel)
    },
    totalEligibleRecords: Number(selection.source_count || transactions.length || 0),
    returnedRecords: Number(selection.included_count || transactions.length || 0),
    selectionPolicy: asString(selection.policy || 'deterministic_tool'),
    excludedCounts: {
      omitted: Number(selection.omitted_count || 0)
    }
  };
}

export function runSummarizeSpendingTool({
  workbook,
  context,
  arguments: args = {},
  services = {}
}) {
  const scopedContext = buildContextFromArguments(context, args);
  const packet = buildAdvisorTransactionAnalysisPacket(
    workbook,
    scopedContext,
    {
      questionType: 'spending_analysis'
    },
    services
  );
  const transactions = getFilteredTransactions(workbook, scopedContext, services);
  return {
    data: {
      packet,
      spending_definition: args.expense_definition || SPENDING_DEFINITION.CONSUMPTION_ONLY,
      totals: packet.totals,
      semantic_summary: packet.semantic_summary,
      category_reliability: packet.category_reliability
    },
    coverage: buildCoverage(scopedContext, packet, transactions),
    sourceRefs:
      packet.semantic_summary && packet.semantic_summary.source_refs
        ? packet.semantic_summary.source_refs
        : [],
    limitations: packet.limitations || []
  };
}

export function runSummarizeAccountsTool({
  workbook,
  context,
  arguments: args = {},
  services = {}
}) {
  const profile = context && context.profile ? context.profile : {};
  const packet = buildAdvisorAccountSnapshotPacket(workbook || {}, {
    asOfDate: args.as_of_date || args.asOfDate || profile.asOfDate || profile.rangeEnd,
    formatBalance:
      typeof services.formatAccountBalance === 'function'
        ? (amount, account) => services.formatAccountBalance(workbook, account, amount)
        : null
  });
  return {
    data: {
      packet,
      totals: packet.totals,
      accounts: packet.accounts
    },
    coverage: {
      dateScope: {
        start: packet.as_of,
        end: packet.as_of,
        label: packet.as_of ? 'Balances as of ' + packet.as_of : 'Current account balances'
      },
      totalEligibleRecords: Number((packet.selection && packet.selection.source_count) || 0),
      returnedRecords: Number((packet.selection && packet.selection.included_count) || 0),
      selectionPolicy: (packet.selection && packet.selection.policy) || 'account_snapshot',
      excludedCounts: {
        omitted: Number((packet.selection && packet.selection.omitted_count) || 0)
      }
    },
    sourceRefs:
      packet.selection && packet.selection.included_refs ? packet.selection.included_refs : [],
    limitations: packet.limitations || []
  };
}

export function runListCategoriesTool({ workbook, context, arguments: args = {}, services = {} }) {
  const scopedContext = buildContextFromArguments(context, args);
  const packet = buildAdvisorCategoryInventoryPacket(workbook || {}, scopedContext, args, services);
  return {
    data: {
      packet,
      counts: packet.counts,
      categories: packet.categories
    },
    coverage: buildCoverage(scopedContext, packet, packet.categories || []),
    sourceRefs: packet.source_refs || [],
    limitations: packet.limitations || []
  };
}

export function runListTransactionsTool({
  workbook,
  context,
  arguments: args = {},
  services = {}
}) {
  const scopedContext = buildContextFromArguments(context, args);
  const question = args.mode === 'full' ? 'show full transaction list' : 'show recent transactions';
  const packet = buildAdvisorTransactionListPacket(
    workbook,
    scopedContext,
    {
      question,
      responseStyle: args.mode === 'full' ? 'breakdown' : ''
    },
    services
  );
  const transactions = getFilteredTransactions(workbook, scopedContext, services);
  return {
    data: {
      packet,
      transactions: packet.transactions
    },
    coverage: buildCoverage(scopedContext, packet, transactions),
    sourceRefs: packet.source_refs || [],
    limitations: packet.limitations || []
  };
}

export function runGetSupportingTransactionsTool(environment) {
  return runListTransactionsTool(
    Object.assign({}, environment, {
      arguments: Object.assign(
        {},
        environment && environment.arguments ? environment.arguments : {},
        {
          mode: 'recent'
        }
      )
    })
  );
}

export function runReviewCategorizationTool({
  workbook,
  context,
  arguments: args = {},
  services = {}
}) {
  const scopedContext = buildContextFromArguments(context, args);
  const packet = buildAdvisorCategorizationReviewPacket(
    workbook,
    scopedContext,
    args.prompt || 'review categories',
    services
  );
  return {
    data: {
      packet,
      category_reliability: packet.category_reliability,
      candidate_cleanup: packet.candidate_cleanup,
      candidate_improvements: packet.candidate_improvements
    },
    coverage: {
      dateScope: packet.period,
      totalEligibleRecords: Number((packet.selection && packet.selection.source_count) || 0),
      returnedRecords: Number((packet.selection && packet.selection.included_count) || 0),
      selectionPolicy:
        (packet.selection && packet.selection.policy) || 'categorization_review_slices',
      excludedCounts: {
        omitted: Number((packet.selection && packet.selection.omitted_count) || 0)
      }
    },
    sourceRefs:
      packet.selection && packet.selection.included_refs ? packet.selection.included_refs : [],
    limitations: packet.limitations || []
  };
}

export function runGetWorkbookHealthTool({
  workbook,
  context,
  arguments: args = {},
  services = {}
}) {
  const health = context && context.health ? context.health : {};
  const issueCount =
    Number(health.totalIssues || health.total_issues || 0) ||
    Number((health.errors || []).length || 0) + Number((health.warnings || []).length || 0);
  return {
    data: {
      health_version: 'cavalry.workbook_health_tool.v1',
      issue_count: issueCount,
      errors: Array.isArray(health.errors) ? health.errors.slice(0, 20) : [],
      warnings: Array.isArray(health.warnings) ? health.warnings.slice(0, 20) : [],
      notices: Array.isArray(health.notices) ? health.notices.slice(0, 20) : [],
      workbook_counts: {
        accounts: Array.isArray(workbook && workbook.accounts) ? workbook.accounts.length : 0,
        categories: Array.isArray(workbook && workbook.categories) ? workbook.categories.length : 0,
        counterparties: Array.isArray(workbook && workbook.counterparties)
          ? workbook.counterparties.length
          : 0,
        transactions: Array.isArray(workbook && workbook.transactions)
          ? workbook.transactions.length
          : 0
      }
    },
    coverage: {
      dateScope: normalizeDateScope(args.date_scope || args.dateScope || {}),
      totalEligibleRecords: 1,
      returnedRecords: 1,
      selectionPolicy: 'workbook_health_summary',
      excludedCounts: {}
    },
    sourceRefs: workbook && workbook.id ? ['workbook:' + workbook.id] : [],
    limitations: []
  };
}

export function runClassifyCashMovementsTool({
  workbook,
  context,
  arguments: args = {},
  services = {}
}) {
  const scopedContext = buildContextFromArguments(context, args);
  const transactions = getFilteredTransactions(workbook, scopedContext, services);
  const summary = buildAdvisorSemanticSummary(workbook, transactions);
  return {
    data: summary,
    coverage: {
      dateScope: {
        start: scopedContext.profile.rangeStart,
        end: scopedContext.profile.rangeEnd,
        label: scopedContext.profile.rangeLabel
      },
      totalEligibleRecords: transactions.length,
      returnedRecords: transactions.length,
      selectionPolicy: 'full_scope_semantic_classification',
      excludedCounts: {}
    },
    sourceRefs: summary.source_refs || [],
    limitations: []
  };
}

export function runDetectRecurringTransactionsTool({
  workbook,
  context,
  arguments: args = {},
  services = {}
}) {
  const scopedContext = buildContextFromArguments(context, args);
  const transactions = getFilteredTransactions(workbook, scopedContext, services);
  const summary = buildAdvisorSemanticSummary(workbook, transactions);
  const recurringRefs = transactions
    .filter((transaction) => {
      const ref = 'transaction:' + asString(transaction && transaction.id);
      return (
        summary.review_source_refs.indexOf(ref) >= 0 ||
        asString(transaction && transaction.recurringItemId)
      );
    })
    .map((transaction) => 'transaction:' + asString(transaction && transaction.id));
  return {
    data: {
      recurring_source_refs: recurringRefs,
      semantic_summary: summary
    },
    coverage: {
      dateScope: {
        start: scopedContext.profile.rangeStart,
        end: scopedContext.profile.rangeEnd,
        label: scopedContext.profile.rangeLabel
      },
      totalEligibleRecords: transactions.length,
      returnedRecords: recurringRefs.length,
      selectionPolicy: 'recurring_or_likely_recurring_refs',
      excludedCounts: {
        not_recurring: Math.max(0, transactions.length - recurringRefs.length)
      }
    },
    sourceRefs: recurringRefs,
    limitations: [
      'Likely recurring entries are signals for review, not confirmed subscription cancellations.'
    ]
  };
}

export function runSimulateSpendingChangeTool({
  workbook,
  context,
  arguments: args = {},
  services = {}
}) {
  const scopedContext = buildContextFromArguments(context, args);
  const transactions = getFilteredTransactions(workbook, scopedContext, services);
  const summary = buildAdvisorSemanticSummary(workbook, transactions);
  const percent = Math.max(
    0,
    Math.min(100, Number(args.percent || args.reduction_percent || 10) || 10)
  );
  const consumption = Number(
    summary.spending_definitions[SPENDING_DEFINITION.CONSUMPTION_ONLY].amount || 0
  );
  const monthlySavings = Number(((consumption * percent) / 100).toFixed(2));
  return {
    data: {
      simulation_version: 'cavalry.advisor_simulation.v1',
      kind: 'spending_reduction',
      spending_definition: SPENDING_DEFINITION.CONSUMPTION_ONLY,
      reduction_percent: percent,
      baseline_amount: consumption,
      estimated_reduction: monthlySavings,
      runway: calculateAdvisorRunway({
        liquidAssets: context && context.snapshot ? context.snapshot.liquidAssets : 0,
        averageMonthlyTotalCashOutflow:
          context && context.snapshot ? context.snapshot.averageMonthlyOutflow : 0,
        averageMonthlyEssentialExpenses: consumption
      })
    },
    coverage: {
      dateScope: {
        start: scopedContext.profile.rangeStart,
        end: scopedContext.profile.rangeEnd,
        label: scopedContext.profile.rangeLabel
      },
      totalEligibleRecords: transactions.length,
      returnedRecords: transactions.length,
      selectionPolicy: 'consumption_spending_simulation',
      excludedCounts: {}
    },
    sourceRefs: summary.source_refs || [],
    limitations: ['This is a read-only simulation; it does not change budgets or transactions.']
  };
}

export function runPrepareCategoryDraftsTool({
  workbook,
  context,
  arguments: args = {},
  services = {}
}) {
  const review = runReviewCategorizationTool({ workbook, context, arguments: args, services });
  const packet = review.data && review.data.packet ? review.data.packet : {};
  const candidateCount = Number((packet.counts && packet.counts.safe_candidate_changes) || 0);
  return {
    data: {
      proposal_tool_version: 'cavalry.advisor_proposal_tool.v1',
      proposal_kind: 'category_cleanup',
      creates_mutation: false,
      review_required: true,
      candidate_count: candidateCount,
      candidate_cleanup: packet.candidate_cleanup || {},
      candidate_improvements: packet.candidate_improvements || [],
      draft_group_preview: {
        title: 'Category cleanup proposals',
        summary: candidateCount
          ? 'Prepare reviewable category cleanup drafts from the safe candidate changes.'
          : 'No safe category cleanup drafts are ready without more classification review.',
        impactPreview: {
          affectedTransactions: Number(
            (packet.counts && packet.counts.transactions_in_vague_or_missing_categories) || 0
          ),
          categoriesCreated: 0,
          categoriesRenamed: candidateCount,
          categoriesArchived: 0
        }
      }
    },
    coverage: review.coverage,
    sourceRefs: review.sourceRefs,
    limitations: ['This proposal tool does not mutate the workbook; it only prepares review data.']
  };
}

export function runPrepareLedgerCleanupDraftTool(environment) {
  return runPrepareCategoryDraftsTool(environment);
}
