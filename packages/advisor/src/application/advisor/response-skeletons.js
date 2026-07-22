export const ADVISOR_RESPONSE_V2_VERSION = 'cavalry.advisor_response.v2';

function asString(value) {
  return String(value || '').trim();
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeStringArray(value, limit = 80) {
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
    'categorization_review',
    'transaction_list',
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

function formatAmount(item) {
  if (!item) {
    return '';
  }
  if (typeof item === 'object') {
    return asString(
      item.display || item.amount_display || item.formattedValue || item.amount || item.value
    );
  }
  return asString(item);
}

function buildClaim(id, text, kind, sourceRefs = [], support = 'computed', confidence = 1) {
  return {
    id,
    text: asString(text),
    kind,
    sourceRefs: normalizeStringArray(sourceRefs),
    support,
    confidence
  };
}

function buildSection(id, kind, heading, markdown, claimIds = []) {
  return {
    id,
    kind,
    heading: asString(heading),
    markdown: asString(markdown),
    claimIds: normalizeStringArray(claimIds)
  };
}

function buildScopeText(summary = {}, primaryPacket = null) {
  const scope = summary.scope || {};
  const period = primaryPacket && primaryPacket.period ? primaryPacket.period : {};
  const label = asString(scope.period_label || period.label || 'the selected period');
  const start = asString(scope.period_start || period.start);
  const end = asString(scope.period_end || period.end);
  const selection = primaryPacket && primaryPacket.selection ? primaryPacket.selection : {};
  const count = asNumber(
    selection.source_count ||
      (primaryPacket &&
        primaryPacket.counts &&
        (primaryPacket.counts.selected_period_transactions ||
          primaryPacket.counts.transactions_reviewed))
  );
  const omitted = asNumber(selection.omitted_count);
  const coverage =
    count > 0
      ? 'I checked ' +
        String(count) +
        ' eligible records for ' +
        label +
        (start && end ? ' (' + start + ' to ' + end + ')' : '') +
        '.'
      : 'I used the workbook data available for ' + label + '.';
  return omitted > 0
    ? coverage +
        ' The displayed evidence is a ranked slice, with ' +
        String(omitted) +
        ' additional records available.'
    : coverage;
}

function buildSpendingResponse({ summary, evidenceWorkspace, actions, repeatedQuestion } = {}) {
  const packet =
    summary && summary.data_packets && summary.data_packets.transaction_analysis
      ? summary.data_packets.transaction_analysis
      : getPrimaryPacket(summary);
  const totals = packet && packet.totals ? packet.totals : {};
  const claims = [];
  const sections = [];
  const consumption = formatAmount(
    totals.selected_period_consumption_spending || totals.selected_period_spending
  );
  const totalOutflow = formatAmount(totals.selected_period_total_outflow);
  const debt = formatAmount(totals.selected_period_debt_payments);
  const transfers = formatAmount(totals.selected_period_transfers_or_internal_moves);
  const categoryReliability =
    packet && packet.category_reliability ? packet.category_reliability : null;
  const directAnswer =
    repeatedQuestion && repeatedQuestion.repeated
      ? 'My previous answer did not move the task forward enough, so here is the more practical version using the spending definitions I can verify.'
      : 'The useful read is consumption spending first, then debt and transfers separately.';

  claims.push(
    buildClaim(
      'claim_consumption_spending',
      consumption
        ? 'Consumption spending was ' + consumption + '.'
        : 'Consumption spending was calculated from eligible transactions.',
      'numeric',
      ['computed.cashflow_period.consumption_spending']
    )
  );
  claims.push(
    buildClaim(
      'claim_total_outflow',
      totalOutflow
        ? 'Total cash outflow was ' + totalOutflow + '.'
        : 'Total cash outflow was calculated separately.',
      'numeric',
      ['computed.cashflow_period.total_outflow']
    )
  );
  if (debt) {
    claims.push(
      buildClaim(
        'claim_debt_separate',
        'Debt payments were ' + debt + ' and are not treated as consumption spending.',
        'classification',
        ['computed.cashflow_period.debt_payments']
      )
    );
  }
  if (transfers) {
    claims.push(
      buildClaim(
        'claim_transfers_separate',
        'Transfers or internal moves were ' +
          transfers +
          ' and are not treated as consumption spending.',
        'classification',
        ['computed.cashflow_period.transfers_or_internal_moves']
      )
    );
  }

  sections.push(
    buildSection('scope', 'scope', 'What I checked', buildScopeText(summary, packet), [])
  );
  sections.push(
    buildSection(
      'finding_spending_split',
      'finding',
      'What stands out',
      [
        consumption ? 'Consumption spending: ' + consumption + '.' : '',
        totalOutflow ? 'Total cash outflow: ' + totalOutflow + '.' : '',
        debt ? 'Debt payments: ' + debt + ', separated from habit/lifestyle spending.' : '',
        transfers
          ? 'Transfers/internal moves: ' + transfers + ', separated from spending advice.'
          : ''
      ]
        .filter(Boolean)
        .join('\n'),
      claims.map((claim) => claim.id)
    )
  );
  if (categoryReliability && categoryReliability.level !== 'high') {
    sections.push(
      buildSection(
        'uncertainty_category_reliability',
        'uncertainty',
        'What is uncertain',
        'Category reliability is ' +
          String(categoryReliability.level || 'unknown') +
          '. Strong recommendations should wait on the review items before treating categories as habit signals.',
        []
      )
    );
  }
  sections.push(
    buildSection(
      'recommendation_next_step',
      'recommendation',
      'Best next step',
      'Start with the reviewable categories and a 10% reduction simulation on confirmed consumption spending, not total outflow.',
      []
    )
  );

  return {
    responseVersion: ADVISOR_RESPONSE_V2_VERSION,
    naturalStyle: true,
    directAnswer,
    sections,
    claims,
    actions: Array.isArray(actions) ? actions : [],
    drafts: [],
    limitations: (evidenceWorkspace && Array.isArray(evidenceWorkspace.uncertainties)
      ? evidenceWorkspace.uncertainties
      : []
    )
      .map((item) => item.text)
      .filter(Boolean)
      .slice(0, 6),
    disclaimerPolicy: 'thread_once'
  };
}

function buildCategorizationResponse({ summary, evidenceWorkspace, actions } = {}) {
  const packet =
    summary && summary.data_packets && summary.data_packets.categorization_review
      ? summary.data_packets.categorization_review
      : getPrimaryPacket(summary);
  const counts = packet && packet.counts ? packet.counts : {};
  const reliability = packet && packet.category_reliability ? packet.category_reliability : null;
  const candidateCount = asNumber(counts.safe_candidate_changes);
  const reviewed = asNumber(counts.transactions_reviewed);
  const vague = asNumber(counts.transactions_in_vague_or_missing_categories);
  const claims = [
    buildClaim(
      'claim_transactions_reviewed',
      'Reviewed ' + String(reviewed) + ' transactions for category quality.',
      'numeric',
      packet ? normalizeStringArray(packet.selection && packet.selection.included_refs) : []
    ),
    buildClaim(
      'claim_vague_categories',
      String(vague) + ' transactions are in vague or missing categories.',
      'classification',
      packet ? normalizeStringArray(packet.selection && packet.selection.included_refs) : []
    )
  ];
  if (candidateCount > 0) {
    claims.push(
      buildClaim(
        'claim_candidate_changes',
        String(candidateCount) + ' safe candidate cleanup changes are available for review.',
        'recommendation',
        packet ? normalizeStringArray(packet.selection && packet.selection.included_refs) : []
      )
    );
  }
  const sections = [
    buildSection('scope', 'scope', 'What I checked', buildScopeText(summary, packet), []),
    buildSection(
      'finding_category_reliability',
      'finding',
      'What stands out',
      [
        reliability
          ? 'Category reliability: ' +
            String(reliability.level) +
            ' (' +
            String(reliability.score) +
            '/100).'
          : '',
        vague
          ? String(vague) +
            ' transactions need category review because their category is vague or missing.'
          : '',
        candidateCount
          ? String(candidateCount) +
            ' safe cleanup candidates can become reviewable proposals. Nothing has changed yet.'
          : 'I did not find safe cleanup candidates that should be prepared automatically.'
      ]
        .filter(Boolean)
        .join('\n'),
      claims.map((claim) => claim.id)
    )
  ];
  if (reliability && Array.isArray(reliability.warnings) && reliability.warnings.length) {
    sections.push(
      buildSection(
        'uncertainty_category_warnings',
        'uncertainty',
        'What is uncertain',
        reliability.warnings.slice(0, 3).join('\n'),
        []
      )
    );
  }
  sections.push(
    buildSection(
      'recommendation_cleanup',
      'recommendation',
      'Best next step',
      candidateCount > 0
        ? 'Prepare a cleanup draft group, review the proposed category changes, then compare category totals before applying anything.'
        : 'Review the vague or missing categories first, then prepare cleanup drafts once the ambiguous rows are classified.',
      []
    )
  );
  return {
    responseVersion: ADVISOR_RESPONSE_V2_VERSION,
    naturalStyle: true,
    directAnswer:
      candidateCount > 0
        ? 'I found category cleanup work that can be turned into reviewable proposals. Nothing has changed yet.'
        : 'I reviewed category quality and found items to inspect before strong cleanup proposals.',
    sections,
    claims,
    actions: Array.isArray(actions) ? actions : [],
    drafts: [],
    limitations: (evidenceWorkspace && Array.isArray(evidenceWorkspace.uncertainties)
      ? evidenceWorkspace.uncertainties
      : []
    )
      .map((item) => item.text)
      .filter(Boolean)
      .slice(0, 6),
    disclaimerPolicy: 'thread_once'
  };
}

function buildAccountResponse({ summary, evidenceWorkspace, actions } = {}) {
  const packet =
    summary && summary.data_packets && summary.data_packets.account_snapshot
      ? summary.data_packets.account_snapshot
      : getPrimaryPacket(summary);
  const totals = packet && packet.totals ? packet.totals : {};
  const accounts = Array.isArray(packet && packet.accounts) ? packet.accounts : [];
  const assets = formatAmount(totals.assets);
  const liabilities = formatAmount(totals.liabilities);
  const netWorth = formatAmount(totals.net_worth);
  const topAssets = accounts
    .filter((account) => account.group === 'asset')
    .slice()
    .sort((a, b) => asNumber(b.balance) - asNumber(a.balance))
    .slice(0, 4);
  const topLiabilities = accounts
    .filter((account) => account.group === 'liability')
    .slice()
    .sort((a, b) => asNumber(b.balance) - asNumber(a.balance))
    .slice(0, 4);
  const claims = [
    buildClaim(
      'claim_account_assets',
      assets
        ? 'Account assets were ' + assets + '.'
        : 'Account assets were calculated from account balances.',
      'numeric',
      ['account_snapshot:assets']
    ),
    buildClaim(
      'claim_account_liabilities',
      liabilities
        ? 'Account liabilities were ' + liabilities + '.'
        : 'Account liabilities were calculated from account balances.',
      'numeric',
      ['account_snapshot:liabilities']
    ),
    buildClaim(
      'claim_account_net_worth',
      netWorth
        ? 'Account net worth was ' + netWorth + '.'
        : 'Account net worth was calculated from account balances.',
      'numeric',
      ['account_snapshot:net_worth']
    )
  ];
  const sections = [
    buildSection('scope', 'scope', 'What I checked', buildScopeText(summary, packet), []),
    buildSection(
      'finding_account_snapshot',
      'finding',
      'What stands out',
      [
        assets ? 'Assets: ' + assets + '.' : '',
        liabilities ? 'Liabilities: ' + liabilities + '.' : '',
        netWorth ? 'Net worth from active account balances: ' + netWorth + '.' : '',
        topAssets.length
          ? 'Largest asset accounts: ' +
            topAssets.map((account) => account.name + ' ' + account.balance_display).join('; ') +
            '.'
          : '',
        topLiabilities.length
          ? 'Largest liability accounts: ' +
            topLiabilities
              .map((account) => account.name + ' ' + account.balance_display)
              .join('; ') +
            '.'
          : ''
      ]
        .filter(Boolean)
        .join('\n'),
      claims.map((claim) => claim.id)
    ),
    buildSection(
      'recommendation_account_next_step',
      'recommendation',
      'Best next step',
      topLiabilities.length
        ? 'Review the liability balances first, then protect the most liquid asset accounts needed for near-term spending.'
        : 'Review whether the largest asset balances match your short-term cash needs before making budget changes.',
      []
    )
  ];
  return {
    responseVersion: ADVISOR_RESPONSE_V2_VERSION,
    naturalStyle: true,
    directAnswer: 'I can see your Cavalry account snapshot and balances for this review.',
    sections,
    claims,
    actions: Array.isArray(actions) ? actions : [],
    drafts: [],
    limitations: (evidenceWorkspace && Array.isArray(evidenceWorkspace.uncertainties)
      ? evidenceWorkspace.uncertainties
      : []
    )
      .map((item) => item.text)
      .filter(Boolean)
      .slice(0, 6),
    disclaimerPolicy: 'thread_once'
  };
}

function buildCategoryInventoryResponse({ summary, evidenceWorkspace, actions } = {}) {
  const packet =
    summary && summary.data_packets && summary.data_packets.category_inventory
      ? summary.data_packets.category_inventory
      : getPrimaryPacket(summary);
  const counts = packet && packet.counts ? packet.counts : {};
  const categories = Array.isArray(packet && packet.categories) ? packet.categories : [];
  const shownCategories = categories.slice(0, 120);
  const total = asNumber(counts.categories_total || categories.length);
  const active = asNumber(counts.active_categories);
  const archived = asNumber(counts.archived_categories);
  const zeroUse = asNumber(counts.selected_period_categories_without_transactions);
  const claims = [
    buildClaim(
      'claim_categories_total',
      'The workbook has ' + String(total) + ' categories.',
      'numeric',
      packet ? normalizeStringArray(packet.source_refs) : []
    ),
    buildClaim(
      'claim_categories_active',
      String(active) + ' categories are active and ' + String(archived) + ' are archived.',
      'classification',
      packet ? normalizeStringArray(packet.source_refs) : []
    ),
    buildClaim(
      'claim_categories_zero_use',
      String(zeroUse) + ' categories have zero selected-period transactions.',
      'classification',
      packet ? normalizeStringArray(packet.source_refs) : []
    )
  ];
  shownCategories.forEach((category) => {
    claims.push(
      buildClaim(
        'claim_category_' + asString(category.category_id),
        asString(category.name) + ' is a ' + asString(category.type || 'category') + ' category.',
        'category',
        category.source_refs || [category.source_ref]
      )
    );
  });
  const categoryLines = shownCategories.map((category) => {
    const status = category.is_active === false ? 'archived' : 'active';
    const type = asString(category.type || 'uncategorized');
    const count = asNumber(category.selected_period_transaction_count);
    const amount = asString(category.selected_period_amount_display);
    return (
      '- **' +
      asString(category.name) +
      '** (' +
      type +
      ', ' +
      status +
      '): ' +
      String(count) +
      ' selected-period transaction' +
      (count === 1 ? '' : 's') +
      (amount ? ', ' + amount : '') +
      '.'
    );
  });
  if (categories.length > shownCategories.length) {
    categoryLines.push(
      '- ' +
        String(categories.length - shownCategories.length) +
        ' more categories are in the packet.'
    );
  }
  return {
    responseVersion: ADVISOR_RESPONSE_V2_VERSION,
    naturalStyle: true,
    directAnswer:
      'I can read the full category inventory. I found ' +
      String(total) +
      ' categories; zero selected-period usage means no rows used that category in this date range, not that the category is missing.',
    sections: [
      buildSection('scope', 'scope', 'What I checked', buildScopeText(summary, packet), []),
      buildSection(
        'finding_category_counts',
        'finding',
        'What stands out',
        String(active) +
          ' active, ' +
          String(archived) +
          ' archived, and ' +
          String(zeroUse) +
          ' with zero selected-period transactions.',
        ['claim_categories_total', 'claim_categories_active', 'claim_categories_zero_use']
      ),
      buildSection(
        'category_inventory',
        'finding',
        'Category inventory',
        categoryLines.join('\n'),
        claims.map((claim) => claim.id)
      )
    ],
    claims,
    actions: Array.isArray(actions) ? actions : [],
    drafts: [],
    limitations: (evidenceWorkspace && Array.isArray(evidenceWorkspace.uncertainties)
      ? evidenceWorkspace.uncertainties
      : []
    )
      .map((item) => item.text)
      .filter(Boolean)
      .slice(0, 6),
    disclaimerPolicy: 'thread_once'
  };
}

function buildGenericResponse({ summary, actions, evidenceWorkspace } = {}) {
  const packet = getPrimaryPacket(summary);
  return {
    responseVersion: ADVISOR_RESPONSE_V2_VERSION,
    naturalStyle: true,
    directAnswer: 'I checked the available Cavalry data for this request.',
    sections: [
      buildSection('scope', 'scope', 'What I checked', buildScopeText(summary, packet), []),
      buildSection(
        'recommendation_next_step',
        'recommendation',
        'Best next step',
        'Use the supporting transactions and available actions to continue the review.',
        []
      )
    ],
    claims: [],
    actions: Array.isArray(actions) ? actions : [],
    drafts: [],
    limitations: (evidenceWorkspace && Array.isArray(evidenceWorkspace.uncertainties)
      ? evidenceWorkspace.uncertainties
      : []
    )
      .map((item) => item.text)
      .filter(Boolean)
      .slice(0, 6),
    disclaimerPolicy: 'thread_once'
  };
}

export function buildAdvisorResponseSkeleton({
  turn,
  summary,
  evidenceWorkspace,
  actions,
  repeatedQuestion
} = {}) {
  const targetIntent = asString(turn && (turn.targetIntent || turn.intent));
  if (targetIntent === 'spending_analysis' || targetIntent === 'transaction_analysis') {
    return buildSpendingResponse({ summary, evidenceWorkspace, actions, repeatedQuestion });
  }
  if (targetIntent === 'categorization_review') {
    return buildCategorizationResponse({ summary, evidenceWorkspace, actions });
  }
  if (targetIntent === 'account_analysis') {
    return buildAccountResponse({ summary, evidenceWorkspace, actions });
  }
  if (targetIntent === 'category_inventory') {
    return buildCategoryInventoryResponse({ summary, evidenceWorkspace, actions });
  }
  return buildGenericResponse({ summary, evidenceWorkspace, actions });
}

export function renderAdvisorResponseMarkdown(response = {}) {
  const direct = asString(response.directAnswer);
  const sections = (Array.isArray(response.sections) ? response.sections : [])
    .map((section) => {
      const originalHeading = asString(section.heading);
      const kind = asString(section.kind);
      const naturalStyle = response.naturalStyle !== false;
      const heading =
        naturalStyle && ['scope', 'finding', 'recommendation'].includes(kind)
          ? ''
          : originalHeading;
      const markdown = asString(section.markdown);
      if (!(heading || markdown)) {
        return '';
      }
      return (heading ? '**' + heading + '**\n' : '') + markdown;
    })
    .filter(Boolean);
  return [direct].concat(sections).filter(Boolean).join('\n\n');
}

export function buildAdvisorResponseReferences(response = {}) {
  const refs = [];
  (Array.isArray(response.claims) ? response.claims : []).forEach((claim) => {
    const sourceRefs = normalizeStringArray(claim.sourceRefs || claim.source_refs, 20);
    if (claim.text && sourceRefs.length) {
      refs.push({
        token: claim.text.slice(0, 80),
        source_refs: sourceRefs
      });
    }
  });
  return refs.slice(0, 20);
}
