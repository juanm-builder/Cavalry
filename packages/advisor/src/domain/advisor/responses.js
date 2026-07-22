import { normalizeAdvisorReference } from './references.js';

export const CAVALRY_ADVISOR_DISCLAIMER = '';
export const CAVALRY_ADVISOR_GREETING_RESPONSE =
  "Hi, I'm here. What would you like to look at today?";
export const CAVALRY_ADVISOR_TRANSACTION_CAPABILITY_RESPONSE =
  "Yes, I can read and analyze your transactions. I won't list rows unless you ask me to.";
export const CAVALRY_ADVISOR_SMALL_TALK_RESPONSE =
  "I'm here with you. What would you like to do next?";
export const CAVALRY_ADVISOR_EMOTIONAL_SUPPORT_RESPONSE =
  "I'm sorry you're feeling that. I'm here with you. We can take this one step at a time.";

export function advisorAnswerReference(token, sourceRefs) {
  return normalizeAdvisorReference({
    token,
    source_refs: Array.isArray(sourceRefs) ? sourceRefs : [sourceRefs]
  });
}

export function advisorAnswerReferences(items) {
  return (items || [])
    .map((item) => advisorAnswerReference(item.token, item.source_refs || item.sourceRef))
    .filter((reference) => reference.token && reference.source_refs.length);
}

export function buildAdvisorGreetingResponse() {
  return {
    text: CAVALRY_ADVISOR_GREETING_RESPONSE,
    references: []
  };
}

export function buildTransactionCapabilityAdvisorResponse() {
  return {
    text: CAVALRY_ADVISOR_TRANSACTION_CAPABILITY_RESPONSE,
    references: []
  };
}

function isEmotionalSmallTalkPrompt(question) {
  const lower = String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\b(i feel|i am|i m|im|i'm|feeling)\s+(sad|down|bad|upset|stressed|anxious|worried|overwhelmed|frustrated|discouraged|scared)\b/.test(
    lower
  );
}

export function buildAdvisorSmallTalkResponse(question = '') {
  return {
    text: isEmotionalSmallTalkPrompt(question)
      ? CAVALRY_ADVISOR_EMOTIONAL_SUPPORT_RESPONSE
      : CAVALRY_ADVISOR_SMALL_TALK_RESPONSE,
    references: []
  };
}

export function buildAccountSnapshotAdvisorResponse(packet, context = {}, options = {}) {
  const accounts = Array.isArray(packet && packet.accounts) ? packet.accounts : [];
  const totals = packet && packet.totals ? packet.totals : {};
  const asOfLabel = getAdvisorResponseAsOfLabel(context);
  const amountDisplay = (item) => {
    if (!item) return '';
    if (item.display || item.amount_display || item.balance_display) {
      return String(item.display || item.amount_display || item.balance_display);
    }
    if (typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'amount')) {
      return formatAdvisorMoney(Number(item.amount || 0), context, options);
    }
    return String(item || '');
  };
  const assets = amountDisplay(totals.assets);
  const liabilities = amountDisplay(totals.liabilities);
  const netWorth = amountDisplay(totals.net_worth);
  const topAssets = accounts
    .filter((account) => account.group === 'asset')
    .slice()
    .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
    .slice(0, 5);
  const topLiabilities = accounts
    .filter((account) => account.group === 'liability')
    .slice()
    .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
    .slice(0, 5);
  const references = advisorAnswerReferences(
    [
      { token: assets, sourceRef: 'account_snapshot:assets' },
      { token: liabilities, sourceRef: 'account_snapshot:liabilities' },
      { token: netWorth, sourceRef: 'account_snapshot:net_worth' }
    ].filter((item) => item.token)
  );
  const lines = ['I can see your Cavalry account balances as of ' + asOfLabel + '.', ''];
  if (assets || liabilities || netWorth) {
    lines.push('Account snapshot:');
    if (assets) lines.push('- Assets: **' + assets + '**');
    if (liabilities) lines.push('- Liabilities: **' + liabilities + '**');
    if (netWorth) lines.push('- Net worth: **' + netWorth + '**');
    lines.push('');
  }
  if (topAssets.length) {
    lines.push('Largest asset accounts:');
    topAssets.forEach((account) => {
      const display = account.balance_display || amountDisplay(account);
      references.push(
        advisorAnswerReference(account.name, account.source_refs || account.source_ref)
      );
      references.push(advisorAnswerReference(display, account.source_refs || account.source_ref));
      lines.push(
        '- **' +
          account.name +
          '**: **' +
          display +
          '**' +
          (account.is_active === false ? ' (archived)' : '')
      );
    });
    lines.push('');
  }
  if (topLiabilities.length) {
    lines.push('Largest liability accounts:');
    topLiabilities.forEach((account) => {
      const display = account.balance_display || amountDisplay(account);
      references.push(
        advisorAnswerReference(account.name, account.source_refs || account.source_ref)
      );
      references.push(advisorAnswerReference(display, account.source_refs || account.source_ref));
      lines.push(
        '- **' +
          account.name +
          '**: **' +
          display +
          '**' +
          (account.is_active === false ? ' (archived)' : '')
      );
    });
    lines.push('');
  }
  lines.push(
    topLiabilities.length
      ? 'Best next step: review the liability balances first, then protect the liquid accounts you rely on for near-term spending.'
      : 'Best next step: compare the largest asset balances against your near-term cash needs before changing budgets.'
  );
  pushAdvisorResponseDisclaimer(lines, options);
  return {
    text: lines.join('\n'),
    references
  };
}

function getAdvisorResponseDisclaimer(options) {
  return String(
    options && options.disclaimer ? options.disclaimer : CAVALRY_ADVISOR_DISCLAIMER
  ).trim();
}

function pushAdvisorResponseDisclaimer(lines, options) {
  const disclaimer = getAdvisorResponseDisclaimer(options);
  if (disclaimer) {
    lines.push('');
    lines.push(disclaimer);
  }
}

function getAdvisorResponseRangeLabel(context, fallback) {
  const profile = context && context.profile ? context.profile : {};
  return profile.rangeLabel || fallback || 'the selected range';
}

function getAdvisorResponseStyle(options) {
  return String(options && options.responseStyle ? options.responseStyle : '');
}

function escapeMarkdownTableCell(value) {
  return String(value || '').replace(/\|/g, '/');
}

function advisorResponseSourceId(prefix, rawValue) {
  return (
    String(prefix || 'source') +
    ':' +
    String(rawValue || 'unknown')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
  );
}

function defaultFormatDeltaMoney(value, context) {
  const profile = context && context.profile ? context.profile : {};
  const currency = profile.currency || 'PHP';
  const amount = Number(value) || 0;
  const formatted = currency + ' ' + Math.abs(amount).toFixed(2);
  if (amount > 0) return '+' + formatted;
  if (amount < 0) return '-' + formatted;
  return currency + ' 0.00';
}

function formatAdvisorDeltaMoney(value, context, options) {
  return typeof options.formatDeltaMoney === 'function'
    ? options.formatDeltaMoney(value, context)
    : defaultFormatDeltaMoney(value, context);
}

function defaultFormatMoney(value, context) {
  const profile = context && context.profile ? context.profile : {};
  const currency = profile.currency || 'PHP';
  return currency + ' ' + (Number(value) || 0).toFixed(2);
}

function formatAdvisorMoney(value, context, options) {
  return typeof options.formatMoney === 'function'
    ? options.formatMoney(value, context)
    : defaultFormatMoney(value, context);
}

function defaultFormatAdvisorMonths(value) {
  const amount = Number(value) || 0;
  return amount.toFixed(1) + ' months';
}

function formatAdvisorMonthsValue(value, options) {
  return typeof options.formatAdvisorMonths === 'function'
    ? options.formatAdvisorMonths(value)
    : defaultFormatAdvisorMonths(value);
}

function defaultFormatAdvisorPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0%';
  }
  return String(Math.round(numeric)) + '%';
}

function formatAdvisorPercentValue(value, options) {
  return typeof options.formatAdvisorPercent === 'function'
    ? options.formatAdvisorPercent(value)
    : defaultFormatAdvisorPercent(value);
}

function defaultTitleCaseLabel(value, fallback) {
  const source = String(value || fallback || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!source) {
    return '';
  }
  return source
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function titleCaseAdvisorLabel(value, fallback, options) {
  return typeof options.titleCaseLabel === 'function'
    ? options.titleCaseLabel(value, fallback)
    : defaultTitleCaseLabel(value, fallback);
}

function getAdvisorResponseAsOfLabel(context) {
  const profile = context && context.profile ? context.profile : {};
  return profile.asOfLabel || 'the selected date';
}

function getAdvisorPrivacyLabel(context) {
  const profile = context && context.profile ? context.profile : {};
  return profile.privacy || '';
}

export function formatAdvisorImpactTransactionLine(row, index) {
  return (
    String(index + 1) +
    '. ' +
    row.date_label +
    ' - **' +
    row.description +
    '** - ' +
    row.category +
    ' - **' +
    row.net_worth_impact_display +
    '** (' +
    String(row.impact_type || '').replace(/_/g, ' ') +
    ')'
  );
}

export function formatAdvisorTransactionListLine(row, index) {
  if (String((row && row.template) || '') === 'transfer') {
    return (
      String(index + 1) +
      '. ' +
      row.date +
      ' - **' +
      row.description +
      '** - Transfer - ' +
      row.account_label +
      ' - **' +
      row.amount_display +
      '**'
    );
  }
  return (
    String(index + 1) +
    '. ' +
    row.date +
    ' - **' +
    row.description +
    '** - ' +
    row.category_name +
    ' - ' +
    row.account_label +
    ' - **' +
    row.amount_display +
    '**'
  );
}

export function buildBasicFinancialAdvisorResponse(question, context = {}, options = {}) {
  const mode = String(options.mode || 'all');
  const lower = String(question || '').toLowerCase();
  const snapshot = context.snapshot || {};
  const budget = context.budget || {};
  const ledger = context.ledger || {};
  const rangeLabel = getAdvisorResponseRangeLabel(context);
  const asOfLabel = getAdvisorResponseAsOfLabel(context);
  const money = (value) => formatAdvisorMoney(value, context, options);
  const months = (value) => formatAdvisorMonthsValue(value, options);
  if (
    mode !== 'financial' &&
    /^\s*(hi|hello|hey|good morning|good afternoon|good evening|yo|sup)[!.?\s]*$/i.test(
      String(question || '')
    )
  ) {
    return buildAdvisorGreetingResponse();
  }
  if (mode === 'greeting') {
    return null;
  }
  if (/\b(asset|assets)\b/.test(lower) && !/\bnet worth\b/.test(lower)) {
    const assets = money(snapshot.assets);
    const liquidAssets = money(snapshot.liquidAssets);
    const emergencyMonths = months(snapshot.emergencyMonths);
    return {
      text:
        'Your total assets are **' +
        assets +
        '** as of ' +
        asOfLabel +
        '.\n\nI also see **' +
        liquidAssets +
        '** in estimated liquid assets. That is about **' +
        emergencyMonths +
        '** of average monthly outflows.',
      references: advisorAnswerReferences([
        { token: assets, sourceRef: 'computed.totals.assets' },
        { token: liquidAssets, sourceRef: 'computed.liquidity.liquid_assets' },
        { token: emergencyMonths, sourceRef: 'computed.liquidity.emergency_fund_months' }
      ])
    };
  }
  if (/\b(net worth|worth)\b/.test(lower)) {
    const netWorth = money(snapshot.netWorth);
    const assets = money(snapshot.assets);
    const liabilities = money(snapshot.liabilities);
    return {
      text:
        'Your net worth is **' +
        netWorth +
        '** as of ' +
        asOfLabel +
        '.\n\nThat comes from **' +
        assets +
        '** in assets minus **' +
        liabilities +
        '** in liabilities.',
      references: advisorAnswerReferences([
        { token: netWorth, sourceRef: 'computed.totals.net_worth' },
        { token: assets, sourceRef: 'computed.totals.assets' },
        { token: liabilities, sourceRef: 'computed.totals.liabilities' }
      ])
    };
  }
  if (/\b(liability|liabilities|debt|debts|loan|loans|card|cards)\b/.test(lower)) {
    const liabilities = money(snapshot.liabilities);
    const lines = ['Your total liabilities are **' + liabilities + '** as of ' + asOfLabel + '.'];
    if (ledger.topLiabilities && ledger.topLiabilities.length) {
      lines.push('');
      lines.push('Largest liability balances:');
      ledger.topLiabilities.slice(0, 4).forEach((row) => {
        lines.push('- ' + row.account.name + ': ' + money(row.balance));
      });
    }
    return {
      text: lines.join('\n'),
      references: advisorAnswerReferences([
        { token: liabilities, sourceRef: 'computed.totals.liabilities' }
      ])
    };
  }
  if (/\b(income|inflow|inflows|earned|earnings)\b/.test(lower)) {
    const income = money(snapshot.income);
    const outflow = money(snapshot.outflow);
    const net = money(snapshot.net);
    return {
      text:
        'Your total inflows for ' +
        rangeLabel +
        ' are **' +
        income +
        '**.\n\nFor the same range, outflows are **' +
        outflow +
        '**, so net flow is **' +
        net +
        '**.',
      references: advisorAnswerReferences([
        { token: income, sourceRef: 'computed.cashflow_period.income' },
        { token: outflow, sourceRef: 'computed.cashflow_period.spending' },
        { token: net, sourceRef: 'computed.cashflow_period.net_cashflow' }
      ])
    };
  }
  if (
    /\b(expense|expenses|outflow|outflows|spent|spending)\b/.test(lower) &&
    !/budget|overspend|over budget/.test(lower)
  ) {
    const outflow = money(snapshot.outflow);
    const references = advisorAnswerReferences([
      { token: outflow, sourceRef: 'computed.cashflow_period.spending' }
    ]);
    const lines = ['Your total outflows for ' + rangeLabel + ' are **' + outflow + '**.'];
    if (budget.topSpendRows && budget.topSpendRows.length) {
      lines.push('');
      lines.push('Top expense categories:');
      budget.topSpendRows.slice(0, 5).forEach((row) => {
        const categoryRef = advisorResponseSourceId('category_spend', row.category.id);
        const total = money(row.total);
        references.push(advisorAnswerReference(row.category.name, categoryRef));
        references.push(advisorAnswerReference(total, categoryRef));
        lines.push('- **' + row.category.name + '**: **' + total + '**');
      });
    }
    return {
      text: lines.join('\n'),
      references
    };
  }
  if (/\b(cash|buffer|emergency|liquid)\b/.test(lower)) {
    const liquidAssets = money(snapshot.liquidAssets);
    const averageMonthlyOutflow = money(snapshot.averageMonthlyOutflow);
    const emergencyMonths = months(snapshot.emergencyMonths);
    return {
      text:
        'I estimate **' +
        liquidAssets +
        '** in liquid assets.\n\nBased on average monthly outflows of **' +
        averageMonthlyOutflow +
        '**, that covers about **' +
        emergencyMonths +
        '**.',
      references: advisorAnswerReferences([
        { token: liquidAssets, sourceRef: 'computed.liquidity.liquid_assets' },
        { token: averageMonthlyOutflow, sourceRef: 'computed.liquidity.average_monthly_outflow' },
        { token: emergencyMonths, sourceRef: 'computed.liquidity.emergency_fund_months' }
      ])
    };
  }
  return null;
}

export function buildFallbackFinancialAdvisorResponse(
  question,
  context = {},
  priorities = [],
  options = {}
) {
  const lower = String(question || '').toLowerCase();
  const snapshot = context.snapshot || {};
  const budget = context.budget || {};
  const ledger = context.ledger || {};
  const health = context.health || {};
  const rangeLabel = getAdvisorResponseRangeLabel(context);
  const asOfLabel = getAdvisorResponseAsOfLabel(context);
  const money = (value) => formatAdvisorMoney(value, context, options);
  const months = (value) => formatAdvisorMonthsValue(value, options);
  const percent = (value) => formatAdvisorPercentValue(value, options);
  const deltaMoney = (value) => formatAdvisorDeltaMoney(value, context, options);
  const lines = ['Here is what I see:', ''];
  const references = advisorAnswerReferences([
    { token: money(snapshot.net), sourceRef: 'computed.cashflow_period.net_cashflow' },
    { token: money(snapshot.liquidAssets), sourceRef: 'computed.liquidity.liquid_assets' },
    {
      token: months(snapshot.emergencyMonths),
      sourceRef: 'computed.liquidity.emergency_fund_months'
    },
    { token: money(snapshot.liabilities), sourceRef: 'computed.totals.liabilities' },
    { token: money(snapshot.assets), sourceRef: 'computed.totals.assets' }
  ]);
  (priorities || []).forEach((item, index) => {
    lines.push(String(index + 1) + '. ' + item.title + ': ' + item.detail);
  });
  lines.push('');
  if (/budget|overspend|over budget|pressure|spend/.test(lower)) {
    lines.push(
      'Budget readout: outflows are at ' +
        percent(budget.budgetUsedPercent) +
        ' of planned outflow, with a variance of ' +
        deltaMoney(budget.variance) +
        '.'
    );
    if (budget.overspentRows && budget.overspentRows.length) {
      lines.push('Largest over-budget categories:');
      budget.overspentRows.slice(0, 3).forEach((row) => {
        const budgetRef = advisorResponseSourceId('budget', row.category.id);
        const remaining = money(Math.abs(row.remaining));
        references.push(advisorAnswerReference(row.category.name, budgetRef));
        references.push(advisorAnswerReference(remaining, budgetRef));
        lines.push(
          '- **' +
            row.category.name +
            '**: over by **' +
            remaining +
            '** (' +
            String(row.percent) +
            '% used).'
        );
      });
    } else if (budget.watchRows && budget.watchRows.length) {
      lines.push('Watch these categories before they cross plan:');
      budget.watchRows.slice(0, 3).forEach((row) => {
        references.push(
          advisorAnswerReference(
            row.category.name,
            advisorResponseSourceId('budget', row.category.id)
          )
        );
        lines.push('- **' + row.category.name + '**: ' + String(row.percent) + '% used.');
      });
    } else {
      lines.push('No category is currently above plan in the selected range.');
    }
  } else if (/cash|buffer|emergency|liquid/.test(lower)) {
    const averageMonthlyOutflow = money(snapshot.averageMonthlyOutflow);
    references.push(
      advisorAnswerReference(averageMonthlyOutflow, 'computed.liquidity.average_monthly_outflow')
    );
    lines.push(
      'Cash buffer readout: liquid assets are **' +
        money(snapshot.liquidAssets) +
        '**, while average monthly outflow is **' +
        averageMonthlyOutflow +
        '**.'
    );
    lines.push(
      'That gives an estimated buffer of **' +
        months(snapshot.emergencyMonths) +
        '**. A practical next target is 3 months before increasing optional spending.'
    );
  } else if (/bill|subscription|recurring/.test(lower)) {
    lines.push(
      'Bills and subscriptions readout: Cavalry sees ' +
        String(ledger.recurringCount || 0) +
        ' recurring items totaling ' +
        money(ledger.recurringTotal) +
        '.'
    );
    if (Number(ledger.overdueCount || 0) > 0) {
      lines.push(
        'Start with the ' +
          String(ledger.overdueCount) +
          ' overdue item' +
          (ledger.overdueCount === 1 ? '' : 's') +
          ', then review recurring items that are no longer essential.'
      );
    } else {
      lines.push(
        'No overdue recurring item is visible, so the useful review is cancellation, downgrade, or annual-plan checks.'
      );
    }
  } else if (/debt|liabil|card|loan/.test(lower)) {
    lines.push(
      'Liability readout: total liabilities are **' +
        money(snapshot.liabilities) +
        '** against assets of **' +
        money(snapshot.assets) +
        '**.'
    );
    if (ledger.topLiabilities && ledger.topLiabilities.length) {
      lines.push('Largest liability balances:');
      ledger.topLiabilities.slice(0, 3).forEach((row) => {
        lines.push('- ' + row.account.name + ': ' + money(row.balance) + '.');
      });
    }
    lines.push(
      'Prioritize high-interest balances first, while keeping the cash buffer from falling below your minimum comfort line.'
    );
  } else if (/health|error|warning|valid|clean/.test(lower)) {
    const errors = health.errors || [];
    const warnings = health.warnings || [];
    const notices = health.notices || [];
    lines.push(
      'Data health readout: ' +
        String(errors.length) +
        ' errors, ' +
        String(warnings.length) +
        ' warnings, and ' +
        String(notices.length) +
        ' notices.'
    );
    errors
      .concat(warnings)
      .slice(0, 4)
      .forEach((issue) => {
        lines.push(
          '- ' +
            titleCaseAdvisorLabel(issue.severity, '', options) +
            ': ' +
            issue.message +
            (issue.detail ? ' (' + issue.detail + ')' : '')
        );
      });
    if (!health.totalIssues) {
      lines.push('No validation issues are visible.');
    }
  } else {
    lines.push(
      'What stands out: net flow is **' +
        money(snapshot.net) +
        '**, budget use is ' +
        percent(budget.budgetUsedPercent) +
        ', and the estimated cash buffer is **' +
        months(snapshot.emergencyMonths) +
        '**.'
    );
    if (budget.topSpendRows && budget.topSpendRows.length) {
      lines.push(
        'Top expense pressure: ' +
          budget.topSpendRows
            .slice(0, 3)
            .map((row) => {
              const categoryRef = advisorResponseSourceId('category_spend', row.category.id);
              const total = money(row.total);
              references.push(advisorAnswerReference(row.category.name, categoryRef));
              references.push(advisorAnswerReference(total, categoryRef));
              return '**' + row.category.name + '** at **' + total + '**';
            })
            .join(', ') +
          '.'
      );
    }
  }
  lines.push('');
  lines.push(
    'Context used: ' +
      rangeLabel +
      ', balances as of ' +
      asOfLabel +
      ', privacy ' +
      getAdvisorPrivacyLabel(context) +
      '.'
  );
  return {
    text: lines.join('\n'),
    references
  };
}

export function buildTransactionImpactAdvisorResponse(packet, context = {}, options = {}) {
  const negativeRows =
    packet && packet.top_negative_impact_transactions
      ? packet.top_negative_impact_transactions
      : [];
  const positiveRows =
    packet && packet.top_positive_impact_transactions
      ? packet.top_positive_impact_transactions
      : [];
  const neutralRows =
    packet && packet.excluded_neutral_transactions ? packet.excluded_neutral_transactions : [];
  const categoryRows =
    packet && packet.category_impact_summary ? packet.category_impact_summary : [];
  const total =
    packet && packet.totals && packet.totals.estimated_transaction_net_worth_impact
      ? packet.totals.estimated_transaction_net_worth_impact
      : {};
  const netImpact = Number(total.amount || 0) || 0;
  const rangeLabel = getAdvisorResponseRangeLabel(context);
  const responseStyle = getAdvisorResponseStyle(options);
  const disclaimer = getAdvisorResponseDisclaimer(options);
  const lines = [];
  const references = [
    advisorAnswerReference(
      formatAdvisorDeltaMoney(netImpact, context, options),
      'computed.transaction_impact.estimated_net_worth_impact'
    ),
    advisorAnswerReference(
      formatAdvisorDeltaMoney(
        context && context.snapshot ? context.snapshot.net : 0,
        context,
        options
      ),
      'computed.cashflow_period.net_cashflow'
    )
  ];
  if (!negativeRows.length && !positiveRows.length) {
    return {
      text:
        'I do not see selected-period transactions that clearly changed net worth.\n\nI am excluding transfers, opening balances, savings moves, and principal-only debt payments because those usually move value between accounts rather than changing total net worth.\n\nContext used: ' +
        rangeLabel +
        '.' +
        (disclaimer ? ' ' + disclaimer : ''),
      references: []
    };
  }
  lines.push('Here is the transaction-level net-worth breakdown for ' + rangeLabel + '.');
  lines.push('');
  lines.push(
    'I am counting income as positive and expenses as negative. I am excluding transfers, savings moves, opening balances, and principal-only debt payments unless they look like interest or fees.'
  );
  lines.push('');
  lines.push(
    'Estimated transaction net-worth impact: **' +
      formatAdvisorDeltaMoney(netImpact, context, options) +
      '**.'
  );
  lines.push(
    'Selected-period net flow: **' +
      formatAdvisorDeltaMoney(
        context && context.snapshot ? context.snapshot.net : 0,
        context,
        options
      ) +
      '**.'
  );
  if (categoryRows.length) {
    lines.push('');
    lines.push('Biggest categories by impact:');
    categoryRows.slice(0, responseStyle === 'breakdown' ? 8 : 4).forEach((row, index) => {
      const categoryRef = advisorResponseSourceId('category_spend', row.category_id);
      references.push(advisorAnswerReference(row.name, categoryRef));
      references.push(advisorAnswerReference(row.total_impact_display, categoryRef));
      lines.push(
        String(index + 1) +
          '. **' +
          row.name +
          '**: **' +
          row.total_impact_display +
          '** across ' +
          String(row.transaction_count) +
          ' transaction' +
          (row.transaction_count === 1 ? '' : 's') +
          '.'
      );
    });
  }
  if (negativeRows.length) {
    lines.push('');
    lines.push('Largest net-worth reducers:');
    negativeRows.slice(0, responseStyle === 'breakdown' ? 15 : 6).forEach((row, index) => {
      references.push(advisorAnswerReference(row.description, row.source_ref));
      references.push(advisorAnswerReference(row.net_worth_impact_display, row.source_ref));
      lines.push(formatAdvisorImpactTransactionLine(row, index));
    });
  }
  if (positiveRows.length) {
    lines.push('');
    lines.push('Largest net-worth increasers:');
    positiveRows.slice(0, responseStyle === 'breakdown' ? 10 : 4).forEach((row, index) => {
      references.push(advisorAnswerReference(row.description, row.source_ref));
      references.push(advisorAnswerReference(row.net_worth_impact_display, row.source_ref));
      lines.push(formatAdvisorImpactTransactionLine(row, index));
    });
  }
  if (responseStyle === 'breakdown' && neutralRows.length) {
    lines.push('');
    lines.push('Neutral or excluded movements I would not count as net-worth changes:');
    neutralRows.slice(0, 10).forEach((row, index) => {
      lines.push(
        String(index + 1) +
          '. ' +
          row.date_label +
          ' - ' +
          row.description +
          ' - ' +
          row.amount_display +
          ' (' +
          String(row.impact_type || '').replace(/_/g, ' ') +
          ').'
      );
    });
  }
  lines.push('');
  if (categoryRows.length) {
    const topReducers = categoryRows
      .filter((row) => Number(row.total_impact) < 0)
      .slice(0, 3)
      .map((row) => row.name);
    if (topReducers.length) {
      lines.push(
        'My read: the pressure is concentrated in ' +
          topReducers.join(', ') +
          '. I would start there before treating this as a broad workbook problem.'
      );
    } else {
      lines.push(
        'My read: the visible pressure is not concentrated in one clear expense category, so the transaction list is more useful than a category summary here.'
      );
    }
  } else {
    lines.push(
      'My read: the transaction list is the best evidence here because category-level impact is thin.'
    );
  }
  lines.push('');
  lines.push(
    'Context used: ' +
      rangeLabel +
      ', balances as of ' +
      getAdvisorResponseAsOfLabel(context) +
      '.' +
      (disclaimer ? ' ' + disclaimer : '')
  );
  return {
    text: lines.join('\n'),
    references
  };
}

export function buildCategorizationReviewAdvisorResponse(packet, context = {}, options = {}) {
  const counts = packet && packet.counts ? packet.counts : {};
  const suggestions = packet && packet.candidate_improvements ? packet.candidate_improvements : [];
  const sampleTransactions =
    packet && packet.sample_transactions_needing_review
      ? packet.sample_transactions_needing_review
      : [];
  const responseStyle = getAdvisorResponseStyle(options);
  const references = [];
  const lines = [];
  const periodLabel =
    packet && packet.period && packet.period.label
      ? packet.period.label
      : getAdvisorResponseRangeLabel(context);
  lines.push(
    'I reviewed the categorization signals for ' +
      periodLabel +
      '. Nothing has changed in the workbook yet.'
  );
  lines.push('');
  lines.push('What I would look at first:');
  lines.push(
    '1. Transactions in vague or missing categories: **' +
      String(counts.transactions_in_vague_or_missing_categories || 0) +
      '** out of **' +
      String(counts.transactions_reviewed || 0) +
      '** reviewed.'
  );
  lines.push('2. Vague category labels: **' + String(counts.vague_categories || 0) + '**.');
  lines.push(
    '3. Duplicate label groups: **' +
      String(counts.duplicate_category_label_groups || 0) +
      '** category groups and **' +
      String(counts.duplicate_counterparty_label_groups || 0) +
      '** counterparty groups.'
  );
  if (suggestions.length) {
    lines.push('');
    lines.push('Safe candidate improvements I can see:');
    suggestions.slice(0, responseStyle === 'breakdown' ? 10 : 5).forEach((item, index) => {
      (item.source_refs || []).forEach((ref) => {
        references.push(advisorAnswerReference(item.detail || item.title, ref));
      });
      lines.push(String(index + 1) + '. **' + item.title + '**: ' + item.detail + '.');
    });
  } else if (sampleTransactions.length) {
    lines.push('');
    lines.push('Examples I would manually review:');
    sampleTransactions.slice(0, responseStyle === 'breakdown' ? 8 : 4).forEach((item, index) => {
      (item.source_refs || []).forEach((ref) => {
        references.push(advisorAnswerReference(item.description, ref));
      });
      lines.push(
        String(index + 1) +
          '. ' +
          item.date +
          ' - ' +
          item.description +
          ' - ' +
          item.currency +
          ' ' +
          item.amount +
          ' currently in ' +
          item.current_category +
          '.'
      );
    });
  } else {
    lines.push('');
    lines.push(
      'I do not see a high-confidence categorization cleanup from the current rules. That usually means the labels are already specific, or the transaction descriptions do not give enough evidence to rename safely.'
    );
  }
  lines.push('');
  lines.push(
    'My recommendation: treat this as a review first. Ask me to create a cleanup draft when you want an editable proposal to approve before anything is applied.'
  );
  pushAdvisorResponseDisclaimer(lines, options);
  return {
    text: lines.join('\n'),
    references
  };
}

export function buildCategoryInventoryAdvisorResponse(packet, context = {}, options = {}) {
  const categories = Array.isArray(packet && packet.categories) ? packet.categories : [];
  const counts = packet && packet.counts ? packet.counts : {};
  const periodLabel =
    packet && packet.period && packet.period.label
      ? packet.period.label
      : getAdvisorResponseRangeLabel(context);
  const references = [];
  const lines = [];
  if (!categories.length) {
    return {
      text: 'I do not see any categories in this workbook yet.',
      references
    };
  }
  lines.push('I found the full category inventory for ' + periodLabel + '.');
  lines.push('');
  lines.push(
    'Category counts: **' +
      String(counts.categories_total || categories.length) +
      '** total, **' +
      String(counts.active_categories || 0) +
      '** active, **' +
      String(counts.archived_categories || 0) +
      '** archived, and **' +
      String(counts.selected_period_categories_without_transactions || 0) +
      '** with zero selected-period transactions.'
  );
  lines.push(
    'Zero selected-period usage means no rows used that category in this date range; it does not mean the category is missing.'
  );
  lines.push('');
  lines.push('Categories:');
  categories.slice(0, 120).forEach((category) => {
    const count = Number(category.selected_period_transaction_count || 0) || 0;
    const amount = String(category.selected_period_amount_display || '').trim();
    const status = category.is_active === false ? 'archived' : 'active';
    const detail = [category.type || 'category', status].filter(Boolean).join(', ');
    references.push(
      advisorAnswerReference(category.name, category.source_refs || category.source_ref)
    );
    if (amount) {
      references.push(advisorAnswerReference(amount, category.source_refs || category.source_ref));
    }
    lines.push(
      '- **' +
        category.name +
        '** (' +
        detail +
        '): ' +
        String(count) +
        ' selected-period transaction' +
        (count === 1 ? '' : 's') +
        (amount ? ', **' + amount + '**' : '') +
        '.'
    );
  });
  if (categories.length > 120) {
    lines.push(
      '- ' + String(categories.length - 120) + ' more categories are included in the source packet.'
    );
  }
  pushAdvisorResponseDisclaimer(lines, options);
  return {
    text: lines.join('\n'),
    references
  };
}

export function buildTransactionAnalysisAdvisorResponse(packet, context = {}, options = {}) {
  const period =
    packet && packet.period && packet.period.label
      ? packet.period.label
      : getAdvisorResponseRangeLabel(context);
  const totals = packet && packet.totals ? packet.totals : {};
  const categories = packet && packet.top_spending_categories ? packet.top_spending_categories : [];
  const overBudget = packet && packet.over_budget_categories ? packet.over_budget_categories : [];
  const recurring =
    packet && packet.recurring_or_subscription_rows ? packet.recurring_or_subscription_rows : [];
  const vague = packet && packet.vague_category_rows ? packet.vague_category_rows : [];
  const transferLike = packet && packet.transfer_like_rows ? packet.transfer_like_rows : [];
  const largestExpenses =
    packet && packet.largest_real_expense_rows ? packet.largest_real_expense_rows : [];
  const reliability = packet && packet.budget_reliability ? packet.budget_reliability : {};
  const references = [];
  const lines = ['A few things stand out from ' + period + '.', ''];

  if (transferLike.length) {
    lines.push(
      'First, I would clean up possible transfers or non-expense movements before treating every row as spending. I found **' +
        String(transferLike.length) +
        '** candidate item' +
        (transferLike.length === 1 ? '' : 's') +
        ' that may be money moving between accounts rather than new spending.'
    );
    transferLike.slice(0, 3).forEach((row) => {
      references.push(advisorAnswerReference(row.description, row.source_ref));
      references.push(advisorAnswerReference(row.amount_display, row.source_ref));
    });
  } else {
    lines.push(
      'I do not see obvious transfer-like rows in this packet, so the category totals are a reasonable starting point.'
    );
  }

  const totalOutflow =
    totals.selected_period_total_outflow && totals.selected_period_total_outflow.display
      ? totals.selected_period_total_outflow.display
      : totals.selected_period_spending && totals.selected_period_spending.display
        ? totals.selected_period_spending.display
        : '';
  const expensesOnly =
    totals.selected_period_expenses_only && totals.selected_period_expenses_only.display
      ? totals.selected_period_expenses_only.display
      : '';
  const debtPayments =
    totals.selected_period_debt_payments && totals.selected_period_debt_payments.display
      ? totals.selected_period_debt_payments.display
      : '';
  const internalMoves =
    totals.selected_period_transfers_or_internal_moves &&
    totals.selected_period_transfers_or_internal_moves.display
      ? totals.selected_period_transfers_or_internal_moves.display
      : '';
  const netFlow =
    totals.selected_period_net_cashflow && totals.selected_period_net_cashflow.display
      ? totals.selected_period_net_cashflow.display
      : '';
  if (totalOutflow || netFlow) {
    lines.push('');
    lines.push(
      'At the summary level, total outflow is ' +
        (totalOutflow ? '**' + totalOutflow + '**' : 'available in Cavalry') +
        (netFlow ? ', with net cash flow of **' + netFlow + '**.' : '.')
    );
    if (expensesOnly || debtPayments || internalMoves) {
      lines.push(
        'Cavalry separates that into expenses only' +
          (expensesOnly ? ' (**' + expensesOnly + '**)' : '') +
          ', debt payments' +
          (debtPayments ? ' (**' + debtPayments + '**)' : '') +
          ', and savings/internal moves' +
          (internalMoves ? ' (**' + internalMoves + '**)' : '') +
          '.'
      );
    }
    if (totals.selected_period_total_outflow && totals.selected_period_total_outflow.source_refs) {
      references.push(
        advisorAnswerReference(totalOutflow, totals.selected_period_total_outflow.source_refs)
      );
    } else if (totals.selected_period_spending && totals.selected_period_spending.source_refs) {
      references.push(
        advisorAnswerReference(totalOutflow, totals.selected_period_spending.source_refs)
      );
    }
    if (totals.selected_period_expenses_only && totals.selected_period_expenses_only.source_refs) {
      references.push(
        advisorAnswerReference(expensesOnly, totals.selected_period_expenses_only.source_refs)
      );
    }
    if (totals.selected_period_debt_payments && totals.selected_period_debt_payments.source_refs) {
      references.push(
        advisorAnswerReference(debtPayments, totals.selected_period_debt_payments.source_refs)
      );
    }
    if (
      totals.selected_period_transfers_or_internal_moves &&
      totals.selected_period_transfers_or_internal_moves.source_refs
    ) {
      references.push(
        advisorAnswerReference(
          internalMoves,
          totals.selected_period_transfers_or_internal_moves.source_refs
        )
      );
    }
    if (totals.selected_period_net_cashflow && totals.selected_period_net_cashflow.source_refs) {
      references.push(
        advisorAnswerReference(netFlow, totals.selected_period_net_cashflow.source_refs)
      );
    }
  }

  if (categories.length) {
    lines.push('');
    lines.push('Top spending categories:');
    categories.slice(0, 5).forEach((row, index) => {
      references.push(advisorAnswerReference(row.name, row.source_refs || []));
      references.push(advisorAnswerReference(row.amount_display, row.source_refs || []));
      lines.push(String(index + 1) + '. **' + row.name + '**: **' + row.amount_display + '**.');
    });
  }

  if (reliability.status === 'extreme_or_mismatched' || reliability.status === 'missing_plan') {
    lines.push('');
    lines.push(
      'I would be careful with the budget percentage here. The budget plan may be incomplete or mismatched to the selected range, so I would verify category limits before calling this true overspending.'
    );
  } else if (overBudget.length) {
    lines.push('');
    lines.push('Budget items worth reviewing:');
    overBudget.slice(0, 4).forEach((row, index) => {
      references.push(advisorAnswerReference(row.name, row.source_refs || []));
      references.push(advisorAnswerReference(row.over_by_display, row.source_refs || []));
      lines.push(
        String(index + 1) +
          '. **' +
          row.name +
          '** is over plan by **' +
          row.over_by_display +
          '**.'
      );
    });
  }

  if (recurring.length) {
    lines.push('');
    lines.push('Recurring or subscription-looking charges deserve a separate pass:');
    recurring.slice(0, 4).forEach((row, index) => {
      references.push(advisorAnswerReference(row.description, row.source_ref));
      references.push(advisorAnswerReference(row.amount_display, row.source_ref));
      lines.push(
        String(index + 1) +
          '. ' +
          row.date +
          ' - **' +
          row.description +
          '** - **' +
          row.amount_display +
          '**.'
      );
    });
  }

  if (vague.length) {
    lines.push('');
    lines.push(
      'Some categories are too broad to be very useful. I would split these before making budget decisions:'
    );
    vague.slice(0, 4).forEach((row, index) => {
      references.push(advisorAnswerReference(row.category_name, row.source_refs || row.source_ref));
      references.push(advisorAnswerReference(row.amount_display, row.source_ref));
      lines.push(
        String(index + 1) +
          '. **' +
          row.category_name +
          '**: ' +
          row.description +
          ' (' +
          row.amount_display +
          ').'
      );
    });
  }

  if (largestExpenses.length) {
    lines.push('');
    lines.push('Largest real expense rows to inspect first:');
    largestExpenses.slice(0, 5).forEach((row, index) => {
      references.push(advisorAnswerReference(row.description, row.source_ref));
      references.push(advisorAnswerReference(row.amount_display, row.source_ref));
      lines.push(
        String(index + 1) +
          '. ' +
          row.date +
          ' - **' +
          row.description +
          '** - ' +
          row.category_name +
          ' - **' +
          row.amount_display +
          '**.'
      );
    });
  }

  lines.push('');
  lines.push(
    'My recommendation: clean up transfers and vague categories first, then review subscriptions, then inspect the largest food or discretionary rows by merchant or frequency.'
  );
  pushAdvisorResponseDisclaimer(lines, options);
  return {
    text: lines.join('\n'),
    references
  };
}

export function buildTransactionListAdvisorResponse(packet, context = {}, options = {}) {
  const rows = packet && packet.transactions ? packet.transactions : [];
  const rangeLabel = getAdvisorResponseRangeLabel(context);
  if (!rows.length) {
    return {
      text: 'I do not see transactions in the selected range: ' + rangeLabel + '.',
      references: []
    };
  }
  const references = [];
  const lines = [];
  if (packet.mode === 'last') {
    const row = rows[0];
    references.push(advisorAnswerReference(row.description, row.source_ref));
    references.push(advisorAnswerReference(row.amount_display, row.source_ref));
    lines.push('Your latest transaction in ' + rangeLabel + ' is:');
    lines.push('');
    lines.push(formatAdvisorTransactionListLine(row, 0));
    if (row.note) {
      lines.push('');
      lines.push('Note: ' + row.note);
    }
  } else {
    lines.push(
      (packet.mode === 'full'
        ? 'Here is the full selected-range transaction list'
        : 'Here are your recent transactions') +
        ' for ' +
        rangeLabel +
        '.'
    );
    lines.push('');
    lines.push('| Date | Description | Category | Account | Amount |');
    lines.push('|---|---|---|---|---:|');
    rows.forEach((row) => {
      references.push(advisorAnswerReference(row.description, row.source_ref));
      references.push(advisorAnswerReference(row.amount_display, row.source_ref));
      lines.push(
        '| ' +
          row.date +
          ' | **' +
          escapeMarkdownTableCell(row.description) +
          '** | ' +
          escapeMarkdownTableCell(row.category_name) +
          ' | ' +
          escapeMarkdownTableCell(row.account_label) +
          ' | **' +
          row.amount_display +
          '** |'
      );
    });
    if (
      packet.counts &&
      packet.counts.included_transactions < packet.counts.selected_period_transactions
    ) {
      lines.push('');
      lines.push(
        'Showing ' +
          String(packet.counts.included_transactions) +
          ' of ' +
          String(packet.counts.selected_period_transactions) +
          ' selected-period transactions. Ask for the full list to include every row.'
      );
    }
  }
  const disclaimer = getAdvisorResponseDisclaimer(options);
  lines.push('');
  lines.push('Context used: ' + rangeLabel + '.' + (disclaimer ? ' ' + disclaimer : ''));
  return {
    text: lines.join('\n'),
    references
  };
}
