// Tests for Advisor task specifications.

import { describe, expect, it } from 'vitest';
import {
  buildAdvisorTaskSpec,
  buildAdvisorTaskSpecV2,
  resolveAdvisorDateScope
} from '@cavalry/advisor/domain/advisor/task-spec.js';
import { buildAdvisorTurn } from '@cavalry/advisor/domain/advisor/turns.js';

const visibleRange = {
  start: '2026-04-01',
  end: '2026-06-19',
  label: 'April 1 - June 19, 2026'
};

function resolve(prompt, previousDateScope) {
  return resolveAdvisorDateScope(prompt, {
    selectedAsOfDate: '2026-06-19',
    workbookYear: 2026,
    visibleRange,
    previousDateScope
  });
}

describe('advisor task spec', () => {
  it('resolves current week spending to Monday through selected as-of date', () => {
    const scope = resolve('Id like you to analyze my current spending for the week');

    expect(scope).toMatchObject({
      type: 'current_week',
      start: '2026-06-15',
      end: '2026-06-19',
      source: 'prompt'
    });
    expect(scope.label).toBe('June 15 - 19, 2026');
  });

  it('resolves June-only follow-up to June month-to-date', () => {
    const priorScope = resolve('analyze my current spending for the week');
    const scope = resolve('what about June only?', priorScope);

    expect(scope).toMatchObject({
      type: 'month',
      start: '2026-06-01',
      end: '2026-06-19',
      label: 'June 2026',
      source: 'prompt'
    });
  });

  it('resolves rolling multi-week transaction prompts', () => {
    const scope = resolve(
      'view my transactions for the last 2 weeks and tell me your honest thoughts'
    );

    expect(scope).toMatchObject({
      type: 'rolling_14_days',
      start: '2026-06-06',
      end: '2026-06-19',
      label: 'June 6 - 19, 2026',
      source: 'prompt'
    });
    expect(scope.assumptions[0]).toContain('last 14 calendar days');
  });

  it('resolves rolling day counts beyond the old 7-day special case', () => {
    expect(resolve('analyze transactions from the past 14 days')).toMatchObject({
      type: 'rolling_14_days',
      start: '2026-06-06',
      end: '2026-06-19'
    });
  });

  it('resolves compact named date ranges instead of falling back to the visible range', () => {
    expect(resolve('can you also analyze my transactions from june 1 - 19')).toMatchObject({
      type: 'explicit_range',
      start: '2026-06-01',
      end: '2026-06-19',
      label: 'June 1 - 19, 2026',
      source: 'prompt'
    });
    expect(resolve('june 1-19')).toMatchObject({
      type: 'explicit_range',
      start: '2026-06-01',
      end: '2026-06-19'
    });
  });

  it('resolves compact numeric date ranges', () => {
    expect(resolve('analyze 6/1-6/19')).toMatchObject({
      type: 'explicit_range',
      start: '2026-06-01',
      end: '2026-06-19',
      label: 'June 1 - 19, 2026'
    });
  });

  it('keeps prior scope for scope-free follow-up questions', () => {
    const priorScope = resolve('analyze my current spending for the week');
    const scope = resolve('why is that?', priorScope);

    expect(scope).toMatchObject({
      type: 'current_week',
      start: '2026-06-15',
      end: '2026-06-19'
    });
  });

  it('builds analysis task specs with table-free answer plans', () => {
    const context = { profile: { rangeStart: '2026-06-15', rangeEnd: '2026-06-19' } };
    const turn = buildAdvisorTurn('analyze my transactions and tell me what you think', context);
    const taskSpec = buildAdvisorTaskSpec({
      question: turn.question,
      turn,
      dateScope: resolve('analyze my current spending for the week'),
      visibleRange
    });

    expect(taskSpec.intent).toBe('transaction_analysis');
    expect(taskSpec.outputMode).toBe('analysis');
    expect(taskSpec.dataNeeds).toContain('scoped_cashflow_split');
    expect(taskSpec.answerPlan.tableAllowed).toBe(false);
    expect(taskSpec.answerPlan.sections).toEqual([
      'quick_read',
      'scope_used',
      'important_observations',
      'cleanup_or_data_quality_notes',
      'next_best_actions'
    ]);
  });

  it('allows tables only for explicit transaction list tasks', () => {
    const context = { profile: { rangeStart: '2026-04-01', rangeEnd: '2026-06-19' } };
    const turn = buildAdvisorTurn('show all transactions', context);
    const taskSpec = buildAdvisorTaskSpec({
      question: turn.question,
      turn,
      dateScope: resolve('show all transactions'),
      visibleRange
    });

    expect(taskSpec.intent).toBe('transaction_list');
    expect(taskSpec.outputMode).toBe('table');
    expect(taskSpec.answerPlan.tableAllowed).toBe(true);
  });

  it('keeps small talk lightweight', () => {
    const context = { profile: { rangeStart: '2026-04-01', rangeEnd: '2026-06-19' } };
    const turn = buildAdvisorTurn('how are you?', context);
    const taskSpec = buildAdvisorTaskSpec({
      question: turn.question,
      turn,
      dateScope: resolve('how are you?'),
      visibleRange
    });

    expect(taskSpec.intent).toBe('small_talk');
    expect(taskSpec.outputMode).toBe('conversational');
    expect(taskSpec.dataNeeds).toEqual([]);
    expect(taskSpec.answerPlan.disclaimerRequired).toBe(false);
  });

  it('builds TaskSpec v2 compound subtasks for category improvement', () => {
    const context = { profile: { rangeStart: '2026-04-01', rangeEnd: '2026-06-19' } };
    const turn = buildAdvisorTurn(
      'Review all my transactions and improve my categories. I want better labels.',
      context
    );
    const taskSpec = buildAdvisorTaskSpecV2({
      question: turn.question,
      turn: Object.assign({}, turn, { targetIntent: 'categorization_review' }),
      dateScope: resolve(
        'Review all my transactions and improve my categories. I want better labels.'
      ),
      visibleRange
    });

    expect(taskSpec.specVersion).toBe('cavalry.advisor_task.v2');
    expect(taskSpec.subtasks.map((subtask) => subtask.kind)).toEqual([
      'review_transactions',
      'review_categorization',
      'propose_taxonomy',
      'prepare_category_drafts'
    ]);
    expect(taskSpec.completionCriteria.join(' ')).toContain('Reviewable drafts');
    expect(taskSpec.safetyConstraints.join(' ')).toContain('reviewable drafts');
  });

  it('builds TaskSpec v2 spending analysis with semantic assumptions and simulation subtask', () => {
    const context = { profile: { rangeStart: '2026-04-01', rangeEnd: '2026-06-19' } };
    const turn = buildAdvisorTurn('How can I improve my spending habits by 10%?', context);
    const taskSpec = buildAdvisorTaskSpecV2({
      question: turn.question,
      turn: Object.assign({}, turn, { targetIntent: 'spending_analysis' }),
      dateScope: resolve('How can I improve my spending habits by 10%?'),
      visibleRange
    });

    expect(taskSpec.subtasks.map((subtask) => subtask.kind)).toEqual([
      'review_transactions',
      'analyze_spending',
      'simulate_change'
    ]);
    expect(taskSpec.assumptions.map((assumption) => assumption.text).join(' ')).toContain(
      'excluding debt principal'
    );
    expect(taskSpec.safetyConstraints.join(' ')).toContain('debt principal');
  });
});
