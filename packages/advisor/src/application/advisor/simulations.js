import {
  buildAdvisorSemanticSummary,
  calculateAdvisorRunway,
  SPENDING_DEFINITION
} from '../../domain/advisor/financial-semantics.js';

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function simulateAdvisorSpendingReduction({
  workbook,
  transactions = [],
  percent = 10,
  liquidAssets = 0,
  averageMonthlyOutflow = 0
} = {}) {
  const semanticSummary = buildAdvisorSemanticSummary(workbook, transactions);
  const reductionPercent = Math.max(0, Math.min(100, asNumber(percent, 10)));
  const consumption = asNumber(
    semanticSummary.spending_definitions[SPENDING_DEFINITION.CONSUMPTION_ONLY].amount
  );
  const estimatedReduction = Number(((consumption * reductionPercent) / 100).toFixed(2));
  return {
    simulationVersion: 'cavalry.advisor_simulation.v1',
    kind: 'spending_reduction',
    spendingDefinition: SPENDING_DEFINITION.CONSUMPTION_ONLY,
    baselineAmount: consumption,
    reductionPercent,
    estimatedReduction,
    projectedAmount: Number(Math.max(0, consumption - estimatedReduction).toFixed(2)),
    runway: calculateAdvisorRunway({
      liquidAssets,
      averageMonthlyTotalCashOutflow: averageMonthlyOutflow,
      averageMonthlyEssentialExpenses: Math.max(0, consumption - estimatedReduction)
    }),
    sourceRefs: semanticSummary.source_refs || [],
    limitations: ['Simulation is read-only and depends on current semantic classifications.']
  };
}
