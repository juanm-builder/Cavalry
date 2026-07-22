import { buildAdvisorSourceRegistry } from './source-registry.js';

export const ADVISOR_EVIDENCE_WORKSPACE_VERSION = 'cavalry.advisor_evidence.v1';

function asString(value) {
  return String(value || '').trim();
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeStringArray(value, limit = 200) {
  return (Array.isArray(value) ? value : [])
    .map(asString)
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, limit);
}

function normalizeMoneyFactValue(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'amount')) {
    return {
      value: asNumber(value.amount),
      formattedValue: asString(value.display || value.amount_display || value.amount),
      unit: asString(value.currency || '')
    };
  }
  return {
    value,
    formattedValue: asString(value),
    unit: ''
  };
}

function buildFact(id, kind, label, rawValue, sourceRefs = [], extra = {}) {
  const money = normalizeMoneyFactValue(rawValue);
  return Object.assign(
    {
      id,
      kind,
      label,
      value: money.value,
      formattedValue: money.formattedValue,
      unit: money.unit,
      dateScope: extra.dateScope || null,
      sourceRefs: normalizeStringArray(sourceRefs, 80),
      computationId: asString(extra.computationId),
      certainty: extra.certainty || 'verified'
    },
    extra.omitExtra
      ? {}
      : {
          metadata: extra.metadata || {}
        }
  );
}

function collectPacketSourceRefs(packet) {
  const refs = [];
  const push = (value) => {
    const ref = asString(value);
    if (ref && refs.indexOf(ref) < 0) {
      refs.push(ref);
    }
  };
  if (!(packet && typeof packet === 'object')) {
    return refs;
  }
  normalizeStringArray(packet.source_refs).forEach(push);
  const selection = packet.selection || {};
  normalizeStringArray(selection.included_refs).forEach(push);
  normalizeStringArray(selection.included_transaction_ids).forEach((id) =>
    push(id.indexOf('transaction:') === 0 ? id : 'transaction:' + id)
  );
  if (packet.semantic_summary) {
    normalizeStringArray(packet.semantic_summary.source_refs).forEach(push);
    normalizeStringArray(packet.semantic_summary.review_source_refs).forEach(push);
  }
  return refs.slice(0, 160);
}

function getPrimaryPacket(summary = {}) {
  const packets = summary && summary.data_packets ? summary.data_packets : {};
  const preferred = [
    'account_snapshot',
    'category_inventory',
    'transaction_analysis',
    'categorization_review',
    'transaction_list',
    'transaction_net_worth_impact'
  ];
  for (let index = 0; index < preferred.length; index += 1) {
    if (packets[preferred[index]]) {
      return { kind: preferred[index], packet: packets[preferred[index]] };
    }
  }
  const keys = Object.keys(packets);
  return keys.length ? { kind: keys[0], packet: packets[keys[0]] } : { kind: '', packet: null };
}

function getSummaryScope(summary = {}, taskSpec = {}) {
  const scope = summary.scope || {};
  const dateScope = taskSpec.dateScope || {};
  return {
    start: asString(scope.period_start || dateScope.start),
    end: asString(scope.period_end || dateScope.end),
    label: asString(scope.period_label || dateScope.label),
    source: asString(scope.scope_source || dateScope.source),
    type: asString(scope.scope_type || dateScope.type)
  };
}

function addTransactionAnalysisFacts(facts, packet, dateScope) {
  if (!(packet && packet.totals)) {
    return;
  }
  const totals = packet.totals;
  [
    [
      'fact_income',
      'cashflow',
      'Income',
      totals.selected_period_income,
      ['computed.cashflow_period.income']
    ],
    [
      'fact_total_outflow',
      'cashflow',
      'Total cash outflow',
      totals.selected_period_total_outflow,
      ['computed.cashflow_period.total_outflow']
    ],
    [
      'fact_consumption_spending',
      'spending',
      'Consumption spending',
      totals.selected_period_consumption_spending || totals.selected_period_spending,
      ['computed.cashflow_period.consumption_spending']
    ],
    [
      'fact_expenses_only',
      'spending',
      'Expenses only',
      totals.selected_period_expenses_only,
      ['computed.cashflow_period.expenses_only']
    ],
    [
      'fact_debt_payments',
      'debt',
      'Debt payments',
      totals.selected_period_debt_payments,
      ['computed.cashflow_period.debt_payments']
    ],
    [
      'fact_internal_moves',
      'transfer',
      'Transfers or internal moves',
      totals.selected_period_transfers_or_internal_moves,
      ['computed.cashflow_period.transfers_or_internal_moves']
    ],
    [
      'fact_net_cashflow',
      'cashflow',
      'Net cash flow',
      totals.selected_period_net_cashflow,
      ['computed.cashflow_period.net_cashflow']
    ]
  ].forEach(([id, kind, label, value, refs]) => {
    if (value) {
      facts.push(buildFact(id, kind, label, value, refs, { dateScope }));
    }
  });
  if (packet.budget_reliability) {
    facts.push(
      buildFact(
        'fact_budget_percent_of_budget',
        'budget',
        'Percent of budget',
        packet.budget_reliability.percent_of_budget || packet.budget_reliability.percent_used,
        [],
        {
          dateScope,
          metadata: {
            wording: 'of_budget'
          }
        }
      )
    );
    if (
      packet.budget_reliability.percent_over_budget !== null &&
      typeof packet.budget_reliability.percent_over_budget !== 'undefined'
    ) {
      facts.push(
        buildFact(
          'fact_budget_percent_over_budget',
          'budget',
          'Percent over budget',
          packet.budget_reliability.percent_over_budget,
          [],
          {
            dateScope,
            metadata: {
              wording: 'over_budget'
            }
          }
        )
      );
    }
  }
}

function addCategorizationFacts(facts, packet, dateScope) {
  if (!(packet && packet.counts)) {
    return;
  }
  const counts = packet.counts;
  facts.push(
    buildFact(
      'fact_transactions_reviewed',
      'coverage',
      'Transactions reviewed',
      counts.transactions_reviewed,
      collectPacketSourceRefs(packet),
      { dateScope }
    )
  );
  facts.push(
    buildFact(
      'fact_vague_category_rows',
      'classification',
      'Transactions in vague or missing categories',
      counts.transactions_in_vague_or_missing_categories,
      collectPacketSourceRefs(packet),
      { dateScope }
    )
  );
  facts.push(
    buildFact(
      'fact_safe_candidate_changes',
      'proposal',
      'Safe candidate changes',
      counts.safe_candidate_changes,
      collectPacketSourceRefs(packet),
      { dateScope }
    )
  );
  if (packet.category_reliability) {
    facts.push(
      buildFact(
        'fact_category_reliability',
        'classification',
        'Category reliability score',
        packet.category_reliability.score,
        collectPacketSourceRefs(packet),
        {
          dateScope,
          metadata: {
            level: packet.category_reliability.level
          }
        }
      )
    );
  }
}

function addAccountFacts(facts, packet, dateScope) {
  if (!(packet && packet.totals)) {
    return;
  }
  const totals = packet.totals;
  [
    [
      'fact_account_assets',
      'account',
      'Account assets',
      totals.assets,
      ['account_snapshot:assets']
    ],
    [
      'fact_account_liabilities',
      'account',
      'Account liabilities',
      totals.liabilities,
      ['account_snapshot:liabilities']
    ],
    [
      'fact_account_net_worth',
      'account',
      'Account net worth',
      totals.net_worth,
      ['account_snapshot:net_worth']
    ]
  ].forEach(([id, kind, label, value, refs]) => {
    if (value) {
      facts.push(buildFact(id, kind, label, value, refs, { dateScope }));
    }
  });
  (Array.isArray(packet.accounts) ? packet.accounts : []).slice(0, 40).forEach((account) => {
    facts.push(
      buildFact(
        'fact_account_' + asString(account.account_id),
        'account',
        asString(account.name),
        {
          amount: account.balance,
          display: account.balance_display,
          currency: account.balance_currency
        },
        account.source_refs || [account.source_ref],
        {
          dateScope,
          metadata: {
            accountId: asString(account.account_id),
            group: asString(account.group),
            subtype: asString(account.subtype),
            isActive: account.is_active !== false,
            isSystem: account.is_system === true,
            selectableForTransactionDrafts: account.selectable_for_transaction_drafts === true
          }
        }
      )
    );
  });
}

function addCategoryInventoryFacts(facts, packet, dateScope) {
  if (!(packet && packet.counts)) {
    return;
  }
  const counts = packet.counts;
  const refs = collectPacketSourceRefs(packet);
  facts.push(
    buildFact(
      'fact_categories_total',
      'category',
      'Total categories',
      counts.categories_total,
      refs,
      { dateScope }
    )
  );
  facts.push(
    buildFact(
      'fact_categories_active',
      'category',
      'Active categories',
      counts.active_categories,
      refs,
      { dateScope }
    )
  );
  facts.push(
    buildFact(
      'fact_categories_without_selected_transactions',
      'category',
      'Categories with zero selected-period transactions',
      counts.selected_period_categories_without_transactions,
      refs,
      { dateScope }
    )
  );
  (Array.isArray(packet.categories) ? packet.categories : []).slice(0, 120).forEach((category) => {
    facts.push(
      buildFact(
        'fact_category_' + asString(category.category_id),
        'category',
        asString(category.name),
        {
          amount: category.selected_period_amount,
          display: category.selected_period_amount_display,
          currency: category.currency
        },
        category.source_refs || [category.source_ref],
        {
          dateScope,
          metadata: {
            categoryId: asString(category.category_id),
            type: asString(category.type),
            isActive: category.is_active !== false,
            selectedPeriodTransactionCount: asNumber(category.selected_period_transaction_count),
            allTimeTransactionCount: asNumber(category.all_time_transaction_count)
          }
        }
      )
    );
  });
}

function collectToolFacts(toolResults = [], dateScope) {
  const facts = [];
  toolResults.forEach((result) => {
    if (!(result && result.ok && result.data)) {
      return;
    }
    const packet = result.data.packet || null;
    if (packet && packet.packet_version === 'cavalry.transaction_analysis.v1') {
      addTransactionAnalysisFacts(facts, packet, dateScope);
    }
    if (packet && packet.packet_version === 'cavalry.categorization_review.v1') {
      addCategorizationFacts(facts, packet, dateScope);
    }
    if (packet && packet.packet_version === 'cavalry.account_snapshot.v1') {
      addAccountFacts(facts, packet, dateScope);
    }
    if (packet && packet.packet_version === 'cavalry.category_inventory.v1') {
      addCategoryInventoryFacts(facts, packet, dateScope);
    }
    if (result.toolName === 'simulate_spending_change' && result.data) {
      facts.push(
        buildFact(
          'fact_simulated_reduction',
          'simulation',
          'Estimated reduction',
          result.data.estimated_reduction,
          result.sourceRefs,
          {
            dateScope,
            metadata: {
              reduction_percent: result.data.reduction_percent
            }
          }
        )
      );
    }
  });
  return facts;
}

function collectCoverage(summary, toolResults, primaryPacket, dateScope) {
  const coverage = [];
  if (primaryPacket && primaryPacket.selection) {
    coverage.push({
      id: 'coverage_primary_packet',
      dateScope,
      totalEligibleRecords: asNumber(primaryPacket.selection.source_count),
      returnedRecords: asNumber(primaryPacket.selection.included_count),
      selectionPolicy: asString(primaryPacket.selection.policy),
      excludedCounts: {
        omitted: asNumber(primaryPacket.selection.omitted_count)
      }
    });
  }
  (toolResults || []).forEach((result) => {
    if (result && result.coverage) {
      coverage.push(
        Object.assign(
          {
            id: 'coverage_' + asString(result.toolCallId || result.toolName)
          },
          result.coverage
        )
      );
    }
  });
  if (!coverage.length && summary && summary.scope) {
    coverage.push({
      id: 'coverage_summary_scope',
      dateScope,
      totalEligibleRecords: 0,
      returnedRecords: 0,
      selectionPolicy: 'summary_scope',
      excludedCounts: {}
    });
  }
  return coverage;
}

function collectUncertainties(primaryPacket, toolResults) {
  const uncertainties = [];
  const add = (id, text, sourceRefs = []) => {
    if (text && !uncertainties.some((item) => item.text === text)) {
      uncertainties.push({
        id,
        text,
        sourceRefs: normalizeStringArray(sourceRefs, 40)
      });
    }
  };
  if (primaryPacket && Array.isArray(primaryPacket.limitations)) {
    primaryPacket.limitations.forEach((limitation, index) =>
      add(
        'uncertainty_packet_' + String(index + 1),
        asString(limitation),
        collectPacketSourceRefs(primaryPacket)
      )
    );
  }
  if (primaryPacket && primaryPacket.category_reliability) {
    (primaryPacket.category_reliability.blockingIssues || []).forEach((issue, index) =>
      add(
        'uncertainty_category_blocking_' + String(index + 1),
        issue,
        collectPacketSourceRefs(primaryPacket)
      )
    );
    (primaryPacket.category_reliability.warnings || []).forEach((warning, index) =>
      add(
        'uncertainty_category_warning_' + String(index + 1),
        warning,
        collectPacketSourceRefs(primaryPacket)
      )
    );
  }
  (toolResults || []).forEach((result) => {
    (result.limitations || []).forEach((limitation, index) =>
      add(
        'uncertainty_' + asString(result.toolCallId || result.toolName) + '_' + String(index + 1),
        limitation,
        result.sourceRefs
      )
    );
  });
  return uncertainties.slice(0, 30);
}

function collectSourceRegistry(summary, toolResults, primaryPacket) {
  const refs = normalizeStringArray(
    []
      .concat(collectPacketSourceRefs(primaryPacket))
      .concat(
        (toolResults || []).flatMap((result) =>
          result && Array.isArray(result.sourceRefs) ? result.sourceRefs : []
        )
      )
      .concat(summary && Array.isArray(summary.source_refs) ? summary.source_refs : []),
    300
  );
  const registry = {};
  refs.forEach((ref) => {
    registry[ref] = {
      source_ref: ref,
      label: ref,
      kind: ref.split(':')[0] || 'source'
    };
  });
  return registry;
}

export function buildAdvisorEvidenceWorkspace({
  taskSpec,
  summary,
  toolResults,
  actions,
  workbook,
  range,
  asOfDate
} = {}) {
  const primary = getPrimaryPacket(summary || {});
  const dateScope = getSummaryScope(summary || {}, taskSpec || {});
  const facts = [];
  if (primary.packet && primary.kind === 'account_snapshot') {
    addAccountFacts(facts, primary.packet, dateScope);
  }
  if (primary.packet && primary.kind === 'transaction_analysis') {
    addTransactionAnalysisFacts(facts, primary.packet, dateScope);
  }
  if (primary.packet && primary.kind === 'categorization_review') {
    addCategorizationFacts(facts, primary.packet, dateScope);
  }
  if (primary.packet && primary.kind === 'category_inventory') {
    addCategoryInventoryFacts(facts, primary.packet, dateScope);
  }
  collectToolFacts(toolResults, dateScope).forEach((fact) => {
    if (!facts.some((existing) => existing.id === fact.id)) {
      facts.push(fact);
    }
  });
  return {
    workspaceVersion: ADVISOR_EVIDENCE_WORKSPACE_VERSION,
    taskSpecId: asString(
      taskSpec &&
        (taskSpec.id || taskSpec.taskSpecId || taskSpec.specVersion || taskSpec.spec_version)
    ),
    facts,
    comparisons: [],
    classifications:
      primary.packet && primary.packet.semantic_summary
        ? [
            {
              id: 'classification_semantic_summary',
              kind: 'semantic_cashflow',
              summary: primary.packet.semantic_summary,
              sourceRefs: normalizeStringArray(primary.packet.semantic_summary.source_refs, 120)
            }
          ]
        : [],
    uncertainties: collectUncertainties(primary.packet, toolResults),
    sourceRegistry: Object.assign(
      {},
      workbook ? buildAdvisorSourceRegistry(workbook, { range, asOfDate }).sources : {},
      collectSourceRegistry(summary || {}, toolResults || [], primary.packet)
    ),
    coverage: collectCoverage(summary || {}, toolResults || [], primary.packet, dateScope),
    proposedActions: (Array.isArray(actions) ? actions : [])
      .map((action) => ({
        id: asString(action.id),
        label: asString(action.label),
        safetyLevel: asString(action.safety_level || action.safetyLevel || 'read_only'),
        createsProposal: !!(action.creates_proposal || action.createsProposal),
        sourceRefs: normalizeStringArray(action.command && action.command.source_refs)
      }))
      .filter((action) => action.id)
  };
}

export function findAdvisorEvidenceFact(workspace, factId) {
  return (
    (workspace && Array.isArray(workspace.facts) ? workspace.facts : []).find(
      (fact) => fact.id === factId
    ) || null
  );
}
