// Tests for Advisor answer validation.

import { describe, expect, it } from 'vitest';
import { validateAdvisorAnswer } from '@cavalry/advisor/domain/advisor/answer-validation.js';

const weeklyTaskSpec = {
  intent: 'spending_analysis',
  outputMode: 'analysis',
  dateScope: {
    type: 'current_week',
    start: '2026-06-15',
    end: '2026-06-19',
    label: 'June 15 - 19, 2026',
    source: 'prompt'
  },
  answerPlan: {
    tableAllowed: false,
    sections: [
      'quick_read',
      'scope_used',
      'important_observations',
      'cleanup_or_data_quality_notes',
      'next_best_actions'
    ]
  }
};

const summary = {
  task_spec: weeklyTaskSpec,
  scope: {
    period_start: '2026-06-15',
    period_end: '2026-06-19',
    period_label: 'June 15 - 19, 2026',
    currency: 'PHP'
  },
  computed: {
    cashflow_period: {
      total_outflow: { amount: '1000.00', currency: 'PHP' },
      expenses_only: { amount: '600.00', currency: 'PHP' },
      debt_payments: { amount: '250.00', currency: 'PHP' },
      transfers_or_internal_moves: { amount: '150.00', currency: 'PHP' },
      net_cashflow: { amount: '-400.00', currency: 'PHP' }
    },
    liquidity: {
      emergency_fund_months: { value: '1.1' }
    }
  },
  data_packets: {
    transaction_analysis: {
      totals: {
        selected_period_total_outflow: { amount: '1000.00', amount_display: 'PHP 1,000.00' },
        selected_period_spending: { amount: '600.00', amount_display: 'PHP 600.00' },
        selected_period_expenses_only: { amount: '600.00', amount_display: 'PHP 600.00' },
        selected_period_debt_payments: { amount: '250.00', amount_display: 'PHP 250.00' },
        selected_period_transfers_or_internal_moves: {
          amount: '150.00',
          amount_display: 'PHP 150.00'
        },
        selected_period_net_cashflow: { amount: '-400.00', amount_display: '-PHP 400.00' }
      },
      selection: {
        source_count: 20,
        included_count: 12,
        omitted_count: 8
      },
      counts: {
        recurring_or_subscription_rows: 0
      },
      recurring_or_subscription_rows: [],
      budget_reliability: {
        percent_of_budget: '951.00',
        percent_over_budget: '851.00'
      }
    }
  }
};

function issueCodes(result) {
  return result.issues.map((issue) => issue.code);
}

describe('advisor answer validation', () => {
  it('accepts a scoped analysis answer with supported numbers', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: [
        'A few things stand out for June 15 - 19, 2026.',
        '',
        'Expenses only were PHP 600.00, debt payments were PHP 250.00, and internal moves were PHP 150.00.',
        'Net cash flow was -PHP 400.00.'
      ].join('\n')
    });

    expect(result.ok).toBe(true);
  });

  it('flags wrong broad date ranges for scoped prompts', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'Based on April 1 to June 19, your spending was PHP 1,000.00.'
    });

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('wrong_date_range');
  });

  it('flags unsupported money amounts', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'For June 15 - 19, 2026, expenses were PHP 999.00.'
    });

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('unsupported_number');
  });

  it('does not treat one normal educational disclaimer as repeated', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'For June 15 - 19, 2026, expenses were PHP 600.00.\n\nContext used: June 15 - 19, 2026. This is an educational summary based on your Cavalry data, not financial, tax, legal, or investment advice.'
    });

    expect(issueCodes(result)).not.toContain('repeated_disclaimer');
  });

  it('still flags disclaimer text repeated in separate blocks', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'For June 15 - 19, 2026, expenses were PHP 600.00.\n\nThis is an educational summary, not financial advice.\n\nThis is an educational summary, not financial advice.'
    });

    expect(issueCodes(result)).toContain('repeated_disclaimer');
  });

  it('flags table leakage on analysis tasks', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: [
        'For June 15 - 19, 2026:',
        '',
        '| Date | Amount |',
        '| --- | ---: |',
        '| 2026-06-19 | PHP 600.00 |'
      ].join('\n')
    });

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('table_leakage');
  });

  it('flags disclaimers on small talk', () => {
    const result = validateAdvisorAnswer({
      summary: {
        task_spec: {
          intent: 'small_talk',
          outputMode: 'conversational',
          answerPlan: { tableAllowed: false }
        }
      },
      text: 'I am doing well. This is an educational summary, not financial advice.'
    });

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('unneeded_disclaimer');
  });

  it('flags net cash flow described as spending', () => {
    const confusedSummary = {
      ...summary,
      computed: {
        cashflow_period: {
          net_cashflow: { amount: '-86559.50', currency: 'PHP' }
        }
      }
    };
    const result = validateAdvisorAnswer({
      summary: confusedSummary,
      taskSpec: weeklyTaskSpec,
      text: 'PHP 86,559.50 of your total spending figure represents money moving between accounts or paying down debt.'
    });

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('metric_confusion');
  });

  it('does not flag consumption spending when total outflow is the same supported amount', () => {
    const equalTotalsSummary = {
      ...summary,
      data_packets: {
        transaction_analysis: {
          ...summary.data_packets.transaction_analysis,
          totals: {
            selected_period_total_outflow: { amount: '600.00', amount_display: 'PHP 600.00' },
            selected_period_consumption_spending: { amount: '600.00', amount_display: 'PHP 600.00' }
          }
        }
      }
    };
    const result = validateAdvisorAnswer({
      summary: equalTotalsSummary,
      taskSpec: weeklyTaskSpec,
      text: 'Consumption spending was PHP 600.00. Nothing changed in your workbook.'
    });

    expect(issueCodes(result)).not.toContain('outflow_as_spending');
  });

  it('flags overly positive liquidity framing below three months', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'For June 15 - 19, 2026, your liquidity remains healthy because your cash buffer covers 1.1 months.'
    });

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('liquidity_overstatement');
  });

  it('flags debt principal treated as consumption spending', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'For June 15 - 19, 2026, PHP 250.00 of your spending habits came from debt principal payments.'
    });

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('debt_principal_as_spending');
  });

  it('flags total outflow used for lifestyle advice without qualification', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'Cutting your spending habits starts with reducing the PHP 1,000.00 total.'
    });

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('outflow_as_spending');
  });

  it('flags unsupported recurring cancellation advice', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'For June 15 - 19, 2026, expenses were PHP 600.00. You should cancel recurring subscriptions first.'
    });

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('unsupported_recurring_recommendation');
  });

  it('flags complete-coverage claims when packet rows were omitted', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'I reviewed all transactions for June 15 - 19, 2026 and expenses were PHP 600.00.'
    });

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('unsupported_complete_coverage');
  });

  it('flags budget percent wording when percent of budget is called percent over budget', () => {
    const result = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'For June 15 - 19, 2026, the category was 951% over budget.'
    });

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('budget_percent_wording');
  });

  it('flags internal diagnostics and direct mutation claims', () => {
    const diagnostic = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'Expenses were PHP 600.00.\n\nModel note: The answer failed grounding checks.'
    });
    const mutation = validateAdvisorAnswer({
      summary,
      taskSpec: weeklyTaskSpec,
      text: 'I updated your categories for June 15 - 19, 2026.'
    });

    expect(issueCodes(diagnostic)).toContain('internal_diagnostic_leak');
    expect(issueCodes(mutation)).toContain('direct_mutation_claim');
  });
});
