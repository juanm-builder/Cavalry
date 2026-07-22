// Tests for Advisor turn routing.

import { describe, expect, it } from 'vitest';
import { buildAdvisorTurn, classifyAdvisorIntent } from '@cavalry/advisor/domain/advisor/turns.js';

const context = {
  profile: {
    rangeStart: '2026-04-01',
    rangeEnd: '2026-06-19'
  }
};

describe('advisor turn routing', () => {
  it('routes lightweight greetings without financial analysis', () => {
    expect(classifyAdvisorIntent('hi')).toBe('greeting');
    expect(classifyAdvisorIntent('greetings')).toBe('greeting');
    expect(buildAdvisorTurn('hi', context).resolvedQuestion).toContain('Greet the user briefly');
    expect(buildAdvisorTurn('greetings', context).resolvedQuestion).toContain(
      'Greet the user briefly'
    );
  });

  it('routes small talk without financial analysis', () => {
    const turn = buildAdvisorTurn('how are you?', context);
    expect(turn.intent).toBe('small_talk');
    expect(turn.resolvedQuestion).toContain('Do not include financial metrics');
  });

  it('routes emotional small talk without financial analysis', () => {
    const turn = buildAdvisorTurn('I feel sad', context);
    expect(turn.intent).toBe('small_talk');
    expect(turn.targetIntent).toBe('small_talk');
    expect(turn.resolvedQuestion).toContain('Do not include financial metrics');
  });

  it('routes transaction capability questions without listing rows', () => {
    const prompt = 'I want you to read all my transactions, is this something you can do?';
    const turn = buildAdvisorTurn(prompt, context);
    expect(turn.intent).toBe('transaction_capability');
    expect(turn.targetIntent).toBe('transaction_capability');
    expect(turn.resolvedQuestion).toContain('Do not list transaction rows');
  });

  it('routes transaction analysis separately from raw transaction lists', () => {
    expect(classifyAdvisorIntent('read all my transactions and tell me what you think')).toBe(
      'transaction_analysis'
    );
    expect(
      classifyAdvisorIntent('i want you to read my transactinos and tell me what you think')
    ).toBe('transaction_analysis');
    expect(
      classifyAdvisorIntent(
        'view my transactions for the last 2 weeks and tell me your honest thoughts'
      )
    ).toBe('transaction_analysis');
    expect(classifyAdvisorIntent('whats your analysis on these spendings?')).toBe(
      'spending_analysis'
    );
    expect(classifyAdvisorIntent('can you also analyze my transactions from june 1 - 19')).toBe(
      'transaction_analysis'
    );
    expect(classifyAdvisorIntent('can you analyze all my transactions?')).toBe(
      'transaction_analysis'
    );
    expect(
      buildAdvisorTurn('i want you to read my transactinos and tell me what you think', context)
        .targetIntent
    ).toBe('transaction_analysis');
  });

  it('routes category recommendation questions to categorization review', () => {
    const prompt = 'I want you to check my transactions and tell me what categories i should add';
    const turn = buildAdvisorTurn(prompt, context);

    expect(classifyAdvisorIntent(prompt)).toBe('categorization_review');
    expect(turn.targetIntent).toBe('categorization_review');
    expect(turn.commandMode).toMatchObject({
      intent: 'review_categories',
      handler: 'qa'
    });
    expect(turn.resolvedQuestion).toContain('Review transaction categorization quality');
  });

  it('routes category inventory reads without dropping zero-use categories', () => {
    const prompt = 'can u read all my categories first?';
    const turn = buildAdvisorTurn(prompt, context);

    expect(classifyAdvisorIntent(prompt)).toBe('category_inventory');
    expect(turn.intent).toBe('category_inventory');
    expect(turn.targetIntent).toBe('category_inventory');
    expect(turn.responseStyle).toBe('breakdown');
    expect(turn.commandMode).toMatchObject({
      intent: 'show_categories',
      handler: 'qa'
    });
    expect(turn.resolvedQuestion).toContain('full category inventory');
    expect(turn.resolvedQuestion).toContain('zero selected-period transactions');
  });

  it('routes current financial standing as a financial overview', () => {
    expect(classifyAdvisorIntent('how are my finances?')).toBe('cashflow_review');
    const turn = buildAdvisorTurn('analyze my current financial standing', context);
    expect(turn.intent).toBe('cashflow_review');
    expect(turn.targetIntent).toBe('cashflow_review');
    expect(turn.commandMode).toMatchObject({
      intent: 'analyze_financial_standing'
    });
  });

  it('routes account advice and account lists through account analysis', () => {
    expect(classifyAdvisorIntent('show my accounts')).toBe('account_analysis');
    expect(classifyAdvisorIntent('what advice do you have about my accounts?')).toBe(
      'account_analysis'
    );
    const turn = buildAdvisorTurn('review my cards and balances', context);
    expect(turn.targetIntent).toBe('account_analysis');
    expect(turn.resolvedQuestion).toContain('account balances');
  });

  it('keeps explicit transaction list requests table-first', () => {
    expect(classifyAdvisorIntent('show my transactions')).toBe('transaction_list');
    expect(classifyAdvisorIntent('list my transactions')).toBe('transaction_list');
    expect(classifyAdvisorIntent('export my transactions')).toBe('transaction_list');
    expect(classifyAdvisorIntent('show my latest transaction')).toBe('transaction_list');
    expect(
      buildAdvisorTurn('show my transactions for the last 2 weeks', context).resolvedQuestion
    ).toContain('requested transaction list');
  });

  it('layers command mode over transaction and workbook actions', () => {
    const recordTurn = buildAdvisorTurn('record coffee 150 from cash', context);
    expect(recordTurn.intent).toBe('transaction_command');
    expect(recordTurn.commandMode).toMatchObject({
      handler: 'transaction_draft',
      createsProposal: true
    });

    const readTurn = buildAdvisorTurn('show my transactions', context);
    expect(readTurn.intent).toBe('transaction_list');
    expect(readTurn.commandMode).toMatchObject({
      intent: 'read_transactions',
      targetIntent: 'transaction_list'
    });

    const accountTurn = buildAdvisorTurn('create account Cash Reserve', context);
    expect(accountTurn.intent).toBe('workbook_command');
    expect(accountTurn.commandMode).toMatchObject({
      intent: 'create_account',
      handler: 'workbook_draft'
    });
    const openedAccountTurn = buildAdvisorTurn(
      'i opened a new bank account at bpi amounting to 1000000',
      context
    );
    expect(openedAccountTurn.intent).toBe('workbook_command');
    expect(openedAccountTurn.commandMode).toMatchObject({
      intent: 'create_account',
      handler: 'workbook_draft'
    });
  });

  it('keeps pure access questions as transaction capability', () => {
    expect(classifyAdvisorIntent('can you read my transactions?')).toBe('transaction_capability');
    expect(
      classifyAdvisorIntent('I want you to read all my transactions, is this something you can do?')
    ).toBe('transaction_capability');
    expect(buildAdvisorTurn('can you read my transactions?', context).targetIntent).toBe(
      'transaction_capability'
    );
  });

  it('routes affirmative replies to pending advisor tasks', () => {
    const turn = buildAdvisorTurn('yes', context, {
      lastIntent: 'transaction_capability',
      lastTargetIntent: 'transaction_capability',
      pendingTaskSpec: {
        intent: 'transaction_analysis'
      }
    });

    expect(turn.intent).toBe('pending_task_confirmation');
    expect(turn.targetIntent).toBe('transaction_analysis');
  });

  it('routes month-only follow-ups back to the previous topic', () => {
    const turn = buildAdvisorTurn('what about for the month of june only?', context, {
      lastIntent: 'transaction_analysis',
      lastTargetIntent: 'transaction_analysis'
    });
    expect(turn.intent).toBe('follow_up_expand');
    expect(turn.targetIntent).toBe('transaction_analysis');
  });
});
