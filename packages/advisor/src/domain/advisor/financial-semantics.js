import { roundMoney } from '@cavalry/finance-core/domain/money.js';

export const ECONOMIC_FLOW_CLASS = Object.freeze({
  INCOME: 'income',
  CONSUMPTION_EXPENSE: 'consumption_expense',
  DEBT_PRINCIPAL: 'debt_principal',
  DEBT_INTEREST: 'debt_interest',
  FINANCIAL_FEE: 'financial_fee',
  INTERNAL_TRANSFER: 'internal_transfer',
  SAVINGS_CONTRIBUTION: 'savings_contribution',
  SAVINGS_WITHDRAWAL: 'savings_withdrawal',
  INVESTMENT_CONTRIBUTION: 'investment_contribution',
  INVESTMENT_WITHDRAWAL: 'investment_withdrawal',
  REFUND: 'refund',
  REIMBURSEMENT_PAID: 'reimbursement_paid',
  REIMBURSEMENT_RECEIVED: 'reimbursement_received',
  GIFT_GIVEN: 'gift_given',
  LOAN_TO_OTHER: 'loan_to_other',
  LOAN_REPAYMENT_RECEIVED: 'loan_repayment_received',
  OPENING_BALANCE: 'opening_balance',
  UNCERTAIN: 'uncertain'
});

export const EXPENSE_PURPOSE = Object.freeze({
  PERSONAL: 'personal',
  HOUSEHOLD: 'household',
  WORK: 'work',
  BUSINESS: 'business',
  REIMBURSABLE: 'reimbursable',
  FOR_OTHER_PERSON: 'for_other_person',
  UNKNOWN: 'unknown'
});

export const RECURRENCE_CLASS = Object.freeze({
  RECURRING_ACTIVE: 'recurring_active',
  RECURRING_INACTIVE: 'recurring_inactive',
  LIKELY_RECURRING: 'likely_recurring',
  ONE_TIME: 'one_time',
  INSTALLMENT: 'installment',
  UNKNOWN: 'unknown'
});

export const SPENDING_DEFINITION = Object.freeze({
  ALL_CASH_OUTFLOW: 'all_cash_outflow',
  CONSUMPTION_ONLY: 'consumption_only',
  CONSUMPTION_PLUS_INTEREST_FEES: 'consumption_plus_interest_fees',
  ESSENTIAL_CONSUMPTION: 'essential_consumption',
  DISCRETIONARY_CONSUMPTION: 'discretionary_consumption',
  USER_SELECTED: 'user_selected'
});

function asString(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function money(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? roundMoney(Math.abs(numeric)) : 0;
}

function getAccountById(workbook, accountId) {
  return workbook && workbook.accounts
    ? workbook.accounts.find((account) => account.id === accountId) || null
    : null;
}

function getCategoryById(workbook, categoryId) {
  return workbook && workbook.categories
    ? workbook.categories.find((category) => category.id === categoryId) || null
    : null;
}

function getCounterpartyById(workbook, counterpartyId) {
  return workbook && workbook.counterparties
    ? workbook.counterparties.find((counterparty) => counterparty.id === counterpartyId) || null
    : null;
}

function getTransactionAmount(transaction) {
  return money(transaction && (transaction.baseAmount || transaction.amount));
}

function getSemanticSourceRef(transaction) {
  return 'transaction:' + asString((transaction && transaction.id) || 'unknown');
}

function getTransactionSearchText(workbook, transaction) {
  const category = getCategoryById(workbook, transaction && transaction.categoryId);
  const counterparty = getCounterpartyById(workbook, transaction && transaction.counterpartyId);
  return normalizeText(
    [
      transaction && transaction.template,
      transaction && transaction.description,
      transaction && transaction.note,
      category && category.name,
      counterparty && counterparty.name
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function getLinkedAccountGroups(workbook, transaction) {
  return (transaction && Array.isArray(transaction.lines) ? transaction.lines : [])
    .map((line) => getAccountById(workbook, line && line.accountId))
    .filter(Boolean)
    .map((account) => asString(account.group).toLowerCase())
    .filter(Boolean);
}

function classifyEconomicFlow(workbook, transaction) {
  const template = asString(transaction && transaction.template);
  const text = getTransactionSearchText(workbook, transaction);
  const groups = getLinkedAccountGroups(workbook, transaction);
  if (template === 'income_received') {
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.INCOME,
      provenance: 'transaction_template',
      confidence: 0.98
    };
  }
  if (template === 'transfer') {
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.INTERNAL_TRANSFER,
      provenance: 'transaction_template',
      confidence: 0.98
    };
  }
  if (template === 'opening_balance') {
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.OPENING_BALANCE,
      provenance: 'transaction_template',
      confidence: 0.98
    };
  }
  if (template === 'debt_payment' || template === 'liability_payment') {
    if (/\b(interest|finance charge|late fee|fee|penalty)\b/.test(text)) {
      return {
        economicFlow: ECONOMIC_FLOW_CLASS.DEBT_INTEREST,
        provenance: 'text_rule',
        confidence: 0.78
      };
    }
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.DEBT_PRINCIPAL,
      provenance: 'transaction_template',
      confidence: 0.9
    };
  }
  if (/\b(refund|reversal|returned)\b/.test(text)) {
    return { economicFlow: ECONOMIC_FLOW_CLASS.REFUND, provenance: 'text_rule', confidence: 0.72 };
  }
  if (/\b(reimburse|reimbursement)\b/.test(text) && template === 'income_received') {
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.REIMBURSEMENT_RECEIVED,
      provenance: 'text_rule',
      confidence: 0.75
    };
  }
  if (/\b(reimburse|reimbursement)\b/.test(text)) {
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.REIMBURSEMENT_PAID,
      provenance: 'text_rule',
      confidence: 0.72
    };
  }
  if (/\b(bank fee|service fee|atm fee|finance charge|late fee)\b/.test(text)) {
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.FINANCIAL_FEE,
      provenance: 'text_rule',
      confidence: 0.74
    };
  }
  if (/\b(gift|for others|for other|for mom|for dad|for family)\b/.test(text)) {
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.GIFT_GIVEN,
      provenance: 'text_rule',
      confidence: 0.62
    };
  }
  if (groups.includes('income')) {
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.INCOME,
      provenance: 'account_role',
      confidence: 0.84
    };
  }
  if (groups.includes('liability') && groups.includes('asset')) {
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.DEBT_PRINCIPAL,
      provenance: 'account_role',
      confidence: 0.7
    };
  }
  if (groups.includes('asset') && groups.length >= 2 && !groups.includes('expense')) {
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.INTERNAL_TRANSFER,
      provenance: 'account_role',
      confidence: 0.66
    };
  }
  if (template === 'expense_paid' || template === 'expense_charged' || groups.includes('expense')) {
    return {
      economicFlow: ECONOMIC_FLOW_CLASS.CONSUMPTION_EXPENSE,
      provenance: 'transaction_template',
      confidence: 0.86
    };
  }
  return { economicFlow: ECONOMIC_FLOW_CLASS.UNCERTAIN, provenance: 'unknown', confidence: 0.2 };
}

function classifyPurpose(workbook, transaction, economicFlow) {
  const text = getTransactionSearchText(workbook, transaction);
  if (/\b(reimburse|reimbursable|to reimburse|expense report)\b/.test(text)) {
    return EXPENSE_PURPOSE.REIMBURSABLE;
  }
  if (
    /\b(work|business|client|office|company|project|vercel|supabase|github|hosting|domain)\b/.test(
      text
    )
  ) {
    return EXPENSE_PURPOSE.WORK;
  }
  if (/\b(grocery|groceries|rent|utilities|household|family)\b/.test(text)) {
    return EXPENSE_PURPOSE.HOUSEHOLD;
  }
  if (/\b(for others|for other|gift|mom|dad|sibling|friend)\b/.test(text)) {
    return EXPENSE_PURPOSE.FOR_OTHER_PERSON;
  }
  if (economicFlow === ECONOMIC_FLOW_CLASS.CONSUMPTION_EXPENSE) {
    return EXPENSE_PURPOSE.UNKNOWN;
  }
  return EXPENSE_PURPOSE.UNKNOWN;
}

function classifyRecurrence(workbook, transaction) {
  const recurringId = asString(transaction && transaction.recurringItemId);
  if (recurringId) {
    const recurringItem =
      workbook && Array.isArray(workbook.recurringItems)
        ? workbook.recurringItems.find((item) => asString(item && item.id) === recurringId)
        : null;
    return recurringItem && recurringItem.isActive === false
      ? RECURRENCE_CLASS.RECURRING_INACTIVE
      : RECURRENCE_CLASS.RECURRING_ACTIVE;
  }
  const text = getTransactionSearchText(workbook, transaction);
  if (
    /\b(subscription|monthly|annual|annually|recurring|installment|netflix|spotify|icloud|adobe|chatgpt|vercel|supabase)\b/.test(
      text
    )
  ) {
    return /\binstallment\b/.test(text)
      ? RECURRENCE_CLASS.INSTALLMENT
      : RECURRENCE_CLASS.LIKELY_RECURRING;
  }
  if (transaction && transaction.date) {
    return RECURRENCE_CLASS.ONE_TIME;
  }
  return RECURRENCE_CLASS.UNKNOWN;
}

export function classifyAdvisorTransactionSemantics(workbook, transaction) {
  const flow = classifyEconomicFlow(workbook, transaction);
  const purpose = classifyPurpose(workbook, transaction, flow.economicFlow);
  const recurrence = classifyRecurrence(workbook, transaction);
  const confidence = Math.max(0, Math.min(1, Number(flow.confidence || 0)));
  return {
    economicFlow: flow.economicFlow,
    purpose,
    recurrence,
    confidence: Number(confidence.toFixed(2)),
    provenance: flow.provenance,
    evidenceRefs: [getSemanticSourceRef(transaction)],
    needsReview:
      confidence < 0.75 ||
      flow.economicFlow === ECONOMIC_FLOW_CLASS.UNCERTAIN ||
      purpose === EXPENSE_PURPOSE.UNKNOWN ||
      recurrence === RECURRENCE_CLASS.UNKNOWN
  };
}

function addAmount(bucket, key, amount) {
  bucket[key] = roundMoney((Number(bucket[key]) || 0) + amount);
}

export function buildAdvisorSemanticSummary(workbook, transactions = []) {
  const byEconomicFlow = {};
  const byPurpose = {};
  const byRecurrence = {};
  const reviewRefs = [];
  const sourceRefs = [];
  let allCashOutflow = 0;
  let consumptionOnly = 0;
  let consumptionPlusInterestFees = 0;
  transactions.forEach((transaction) => {
    const classification = classifyAdvisorTransactionSemantics(workbook, transaction);
    const amount = getTransactionAmount(transaction);
    const sourceRef = getSemanticSourceRef(transaction);
    if (sourceRefs.indexOf(sourceRef) < 0) {
      sourceRefs.push(sourceRef);
    }
    addAmount(byEconomicFlow, classification.economicFlow, amount);
    addAmount(byPurpose, classification.purpose, amount);
    addAmount(byRecurrence, classification.recurrence, amount);
    if (classification.needsReview && reviewRefs.indexOf(sourceRef) < 0) {
      reviewRefs.push(sourceRef);
    }
    if (
      classification.economicFlow !== ECONOMIC_FLOW_CLASS.INCOME &&
      classification.economicFlow !== ECONOMIC_FLOW_CLASS.OPENING_BALANCE
    ) {
      allCashOutflow = roundMoney(allCashOutflow + amount);
    }
    if (classification.economicFlow === ECONOMIC_FLOW_CLASS.CONSUMPTION_EXPENSE) {
      consumptionOnly = roundMoney(consumptionOnly + amount);
      consumptionPlusInterestFees = roundMoney(consumptionPlusInterestFees + amount);
    }
    if (
      classification.economicFlow === ECONOMIC_FLOW_CLASS.DEBT_INTEREST ||
      classification.economicFlow === ECONOMIC_FLOW_CLASS.FINANCIAL_FEE
    ) {
      consumptionPlusInterestFees = roundMoney(consumptionPlusInterestFees + amount);
    }
  });
  return {
    summary_version: 'cavalry.financial_semantics.summary.v1',
    transaction_count: transactions.length,
    by_economic_flow: byEconomicFlow,
    by_purpose: byPurpose,
    by_recurrence: byRecurrence,
    spending_definitions: {
      [SPENDING_DEFINITION.ALL_CASH_OUTFLOW]: {
        amount: allCashOutflow,
        description: 'All cash outflow except income and opening balances.'
      },
      [SPENDING_DEFINITION.CONSUMPTION_ONLY]: {
        amount: consumptionOnly,
        description:
          'Confirmed consumption expenses; debt principal, transfers, and savings movements are excluded.'
      },
      [SPENDING_DEFINITION.CONSUMPTION_PLUS_INTEREST_FEES]: {
        amount: consumptionPlusInterestFees,
        description: 'Consumption expenses plus debt interest and financial fees.'
      }
    },
    review_needed_count: reviewRefs.length,
    review_source_refs: reviewRefs.slice(0, 80),
    source_refs: sourceRefs.slice(0, 120)
  };
}

export function buildAdvisorCategoryReliabilitySummary({
  transactions = [],
  vagueRows = [],
  duplicateCategoryGroups = [],
  semanticSummary = null
} = {}) {
  const totalTransactions = Math.max(1, transactions.length);
  const vagueRatio = Math.min(1, vagueRows.length / totalTransactions);
  const reviewRatio =
    semanticSummary && Number.isFinite(Number(semanticSummary.review_needed_count))
      ? Math.min(1, Number(semanticSummary.review_needed_count) / totalTransactions)
      : 0;
  const duplicatePenalty = Math.min(25, duplicateCategoryGroups.length * 8);
  const score = Math.max(
    0,
    Math.round(100 - vagueRatio * 35 - reviewRatio * 30 - duplicatePenalty)
  );
  const blockingIssues = [];
  const warnings = [];
  if (vagueRows.length) {
    warnings.push(
      String(vagueRows.length) + ' selected-period transactions use vague or missing categories.'
    );
  }
  if (duplicateCategoryGroups.length) {
    warnings.push(
      String(duplicateCategoryGroups.length) +
        ' duplicate category label groups may make totals harder to trust.'
    );
  }
  if (reviewRatio >= 0.5) {
    blockingIssues.push(
      'Many selected-period transactions need classification review before strong habit recommendations.'
    );
  }
  return {
    score,
    level: score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low',
    blockingIssues,
    warnings
  };
}

export function calculateAdvisorRunway({
  liquidAssets = 0,
  emergencyLiquidAssets = 0,
  averageMonthlyTotalCashOutflow = 0,
  averageMonthlyEssentialExpenses = 0
} = {}) {
  const totalOutflow = Number(averageMonthlyTotalCashOutflow) || 0;
  const essential = Number(averageMonthlyEssentialExpenses) || 0;
  return {
    cash_flow_runway: {
      months:
        totalOutflow > 0 ? Number((Number(liquidAssets || 0) / totalOutflow).toFixed(2)) : null,
      denominator: 'average_monthly_total_cash_outflow'
    },
    emergency_runway: {
      months:
        essential > 0
          ? Number((Number(emergencyLiquidAssets || liquidAssets || 0) / essential).toFixed(2))
          : null,
      denominator: 'average_monthly_essential_expenses',
      estimate: essential <= 0
    }
  };
}

export function calculateAdvisorBudgetPercentages(actual, planned) {
  const actualValue = Number(actual) || 0;
  const plannedValue = Number(planned) || 0;
  if (plannedValue <= 0) {
    return {
      percent_of_budget: null,
      percent_over_budget: actualValue > 0 ? null : 0
    };
  }
  return {
    percent_of_budget: Number(((actualValue / plannedValue) * 100).toFixed(2)),
    percent_over_budget: Number((((actualValue - plannedValue) / plannedValue) * 100).toFixed(2))
  };
}
