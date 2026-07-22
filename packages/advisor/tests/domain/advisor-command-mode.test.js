// Tests for Advisor command-mode classification.

import { describe, expect, it } from 'vitest';
import {
  classifyAdvisorCommandMode,
  getAdvisorCommandDefinition,
  getAdvisorCommandDefinitions
} from '@cavalry/advisor/domain/advisor/command-mode.js';

describe('advisor command mode', () => {
  it('exposes a robust command catalog', () => {
    const ids = getAdvisorCommandDefinitions().map((definition) => definition.id);

    expect(ids.length).toBeGreaterThanOrEqual(30);
    [
      'record_transaction',
      'record_transaction_batch',
      'read_transactions',
      'analyze_transactions',
      'update_transaction',
      'delete_transaction',
      'create_budget',
      'update_budget',
      'create_account',
      'update_account',
      'show_categories',
      'explain_metric',
      'clarify'
    ].forEach((id) => {
      expect(getAdvisorCommandDefinition(id)).toMatchObject({ id });
      expect(ids).toContain(id);
    });
  });

  it('classifies transaction write, read, analyze, update, and delete commands', () => {
    expect(classifyAdvisorCommandMode('record coffee 150 from cash')).toMatchObject({
      handler: 'transaction_draft',
      createsProposal: true
    });
    expect(
      classifyAdvisorCommandMode('record these 3 transactions from the receipt')
    ).toMatchObject({
      intent: 'record_transaction_batch',
      handler: 'transaction_draft'
    });
    expect(
      classifyAdvisorCommandMode(
        'move money from my freedom fund to my expense account to match my liabilities'
      )
    ).toMatchObject({
      intent: 'record_transfer',
      handler: 'transaction_draft'
    });
    expect(classifyAdvisorCommandMode('show my transactions for June')).toMatchObject({
      intent: 'read_transactions',
      targetIntent: 'transaction_list',
      handler: 'qa'
    });
    expect(
      classifyAdvisorCommandMode('read all my transactions and tell me what you think')
    ).toMatchObject({
      intent: 'analyze_transactions',
      targetIntent: 'transaction_analysis'
    });
    expect(
      classifyAdvisorCommandMode('update the Food transaction category to Groceries')
    ).toMatchObject({
      intent: 'update_transaction',
      handler: 'transaction_metadata_draft'
    });
    expect(classifyAdvisorCommandMode('delete the transaction for 150 food')).toMatchObject({
      intent: 'delete_transaction',
      safetyLevel: 'destructive'
    });
  });

  it('routes category recommendation requests as read-only categorization review', () => {
    expect(
      classifyAdvisorCommandMode(
        'I want you to check my transactions and tell me what categories i should add'
      )
    ).toMatchObject({
      intent: 'review_categories',
      targetIntent: 'categorization_review',
      handler: 'qa',
      createsProposal: false
    });
    expect(
      classifyAdvisorCommandMode('what categories should I add based on my spending?')
    ).toMatchObject({
      intent: 'review_categories',
      targetIntent: 'categorization_review',
      handler: 'qa'
    });
    expect(classifyAdvisorCommandMode('add category Parking')).toMatchObject({
      intent: 'create_category',
      handler: 'workbook_draft'
    });
  });

  it('routes category inventory reads separately from categorization review', () => {
    expect(classifyAdvisorCommandMode('can u read all my categories first?')).toMatchObject({
      intent: 'show_categories',
      targetIntent: 'category_inventory',
      handler: 'qa',
      createsProposal: false
    });
    expect(classifyAdvisorCommandMode('show my full category list')).toMatchObject({
      intent: 'show_categories',
      targetIntent: 'category_inventory'
    });
  });

  it('classifies current financial standing analysis', () => {
    expect(classifyAdvisorCommandMode('analyze my current financial standing')).toMatchObject({
      intent: 'analyze_financial_standing',
      targetIntent: 'cashflow_review',
      handler: 'local_response'
    });
  });

  it('routes account reads to shared account analysis', () => {
    expect(classifyAdvisorCommandMode('show my accounts and balances')).toMatchObject({
      intent: 'show_accounts',
      targetIntent: 'account_analysis',
      handler: 'qa'
    });
  });

  it('classifies workbook draft commands for budgets and accounts', () => {
    expect(classifyAdvisorCommandMode('set Food budget to 5000')).toMatchObject({
      intent: 'update_budget',
      handler: 'workbook_draft',
      createsProposal: true
    });
    expect(classifyAdvisorCommandMode('create account Cash Reserve')).toMatchObject({
      intent: 'create_account',
      handler: 'workbook_draft'
    });
    expect(
      classifyAdvisorCommandMode('i opened a new bank account at bpi amounting to 1000000')
    ).toMatchObject({
      intent: 'create_account',
      handler: 'workbook_draft'
    });
    expect(
      classifyAdvisorCommandMode('open a BPI bank account with opening balance of 1000000')
    ).toMatchObject({
      intent: 'create_account',
      handler: 'workbook_draft'
    });
    expect(classifyAdvisorCommandMode('rename account Cash to Wallet')).toMatchObject({
      intent: 'update_account',
      handler: 'workbook_draft'
    });
  });

  it('keeps metric explanations and small talk separate', () => {
    expect(classifyAdvisorCommandMode('what is net flow?')).toMatchObject({
      intent: 'explain_metric',
      targetIntent: 'cashflow_review',
      handler: 'local_response'
    });
    expect(classifyAdvisorCommandMode('how are you?')).toMatchObject({
      intent: '',
      handler: ''
    });
  });
});
