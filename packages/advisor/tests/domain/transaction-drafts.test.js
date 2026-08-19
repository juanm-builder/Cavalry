// Tests for Advisor transaction drafts.

import { describe, expect, it } from 'vitest';
import {
  applyTransactionAiDraftMutation,
  ADVISOR_FINANCE_INTENT_KINDS,
  advisorPromptReferencesAttachedImage,
  advisorPromptRequestsTransactionHistory,
  advisorTransactionFieldLabel,
  ADVISOR_TRANSACTION_INTAKE_SCHEMA_VERSION_V2,
  buildAdvisorTransactionIntakePreflightHints,
  buildAdvisorExplicitTransferIntentResults,
  buildValidatedAdvisorTransactionDraft,
  classifyAdvisorFinanceIntent,
  coerceAdvisorTransactionTemplate,
  extractAdvisorAmountMentions,
  getAiDraftTransactionPrompt,
  getAdvisorTransactionTemplateConfig,
  inferAdvisorCategoryNameFromPrompt,
  inferAdvisorTransactionTemplateFromText,
  isAdvisorTransactionDraftReviewDecisionUsable,
  looksLikeAdvisorTransactionPrompt,
  normalizeAdvisorRelayTransactionIntentResults,
  normalizeAdvisorTransactionDraftFields,
  normalizeAdvisorTransactionDraftReviewDecision,
  normalizeAdvisorTransactionFieldEvidence,
  normalizeAdvisorTransactionIntakeInterpretation,
  normalizeAdvisorTransactionTemplate,
  parseAdvisorAmountFromText,
  parseAdvisorDateFromText,
  parseAdvisorTransactionListRows,
  promptStartsNewAdvisorTransactionDrafts,
  shouldPreferTextTransactionIntakeWithImages,
  shouldUseAdvisorMixedTransactionImageIntake,
  shouldUseAdvisorRulesTransactionIntentResults,
  validateAdvisorTransactionFieldEvidence,
  validateAdvisorTransactionIntent
} from '@cavalry/advisor/domain/advisor/transaction-drafts.js';

const workbook = {
  currency: 'PHP',
  settings: { usdToBaseRate: 0 },
  accounts: [
    { id: 'cash', name: 'Cash', group: 'asset', subtype: 'cash', isActive: true },
    { id: 'gcash', name: 'GCash', group: 'asset', subtype: 'wallet', isActive: true },
    { id: 'card', name: 'Credit Card', group: 'liability', subtype: 'credit card', isActive: true },
    { id: 'savings', name: 'Savings', group: 'asset', subtype: 'savings', isActive: true }
  ],
  categories: [
    { id: 'transport', name: 'Transport', type: 'expense', isActive: true },
    { id: 'food', name: 'Food', type: 'expense', isActive: true },
    { id: 'salary', name: 'Salary', type: 'income', isActive: true },
    { id: 'debt', name: 'Credit Card Payment', type: 'debt', isActive: true }
  ],
  counterparties: [
    { id: 'lalamove', name: 'Lalamove', kind: 'merchant', isActive: true },
    { id: 'employer', name: 'Employer', kind: 'employer', isActive: true }
  ]
};

describe('advisor transaction drafts', () => {
  it('normalizes transaction templates and fields outside the renderer', () => {
    expect(normalizeAdvisorTransactionTemplate('charged')).toBe('expense_charged');
    expect(normalizeAdvisorTransactionTemplate('opening balance')).toBe('opening_balance');
    expect(
      normalizeAdvisorTransactionDraftFields({
        template: 'expense paid',
        date: 'June 18, 2026',
        amount: '150.129',
        currency: 'php',
        primaryAccountName: ' Cash '
      })
    ).toMatchObject({
      template: 'expense_paid',
      date: '2026-06-18',
      amount: 150.13,
      currency: 'PHP',
      primaryAccountName: 'Cash'
    });
    expect(
      normalizeAdvisorTransactionDraftFields({
        amount: '15k'
      }).amount
    ).toBe(15000);
    expect(
      normalizeAdvisorTransactionDraftFields({
        amount: '\u20b11.5k'
      }).amount
    ).toBe(1500);
  });

  it('normalizes canonical merchant-refund template aliases', () => {
    expect(normalizeAdvisorTransactionTemplate('refund')).toBe('merchant_refund');
    expect(normalizeAdvisorTransactionTemplate('merchant refund')).toBe('merchant_refund');
    expect(normalizeAdvisorTransactionTemplate('chargeback')).toBe('merchant_refund');
    expect(normalizeAdvisorTransactionTemplate('reversal')).toBe('merchant_refund');
  });

  it.each([
    'I received a refund of PHP 500 from Nike',
    'Record a PHP 500 chargeback to my credit card',
    'Record a PHP 500 charge reversal on my card',
    'The merchant returned PHP 500 to my Cash account for the purchase'
  ])('classifies merchant-refund wording before income or purchase: %s', (prompt) => {
    expect(classifyAdvisorFinanceIntent(prompt)).toMatchObject({
      kind: ADVISOR_FINANCE_INTENT_KINDS.REFUND,
      template: 'merchant_refund',
      amount: 500
    });
    expect(inferAdvisorTransactionTemplateFromText(prompt)).toBe('merchant_refund');
  });

  it.each([
    ['Reverse the transfer from Cash to Savings', 'transfer'],
    ['Record the reversal of a transfer from Cash to Savings', 'transfer'],
    ['Reverse the card payment from Cash', 'debt_payment'],
    ['The money was returned to Cash after a failed bank transfer', 'transfer'],
    ['The transfer was returned to my Cash account', 'transfer']
  ])('does not reinterpret non-merchant reversals as refunds: %s', (prompt, template) => {
    expect(classifyAdvisorFinanceIntent(prompt)).not.toMatchObject({
      kind: ADVISOR_FINANCE_INTENT_KINDS.REFUND
    });
    expect(inferAdvisorTransactionTemplateFromText(prompt)).toBe(template);
  });

  it('coerces a model-proposed income draft to a merchant refund when the prompt says refund', () => {
    expect(
      coerceAdvisorTransactionTemplate(
        workbook,
        'income_received',
        {
          primaryAccountName: 'Cash'
        },
        'I received a PHP 500 refund from Lalamove to Cash',
        ''
      )
    ).toBe('merchant_refund');
    expect(getAdvisorTransactionTemplateConfig('merchant_refund')).toMatchObject({
      categoryTypes: ['expense'],
      primaryGroups: ['asset', 'liability'],
      primaryLabel: 'Refunded To'
    });
  });

  it('parses prompt amount/date signals used by transaction intake', () => {
    expect(parseAdvisorAmountFromText('Paid \u20b1150 for transport')).toBe(150);
    expect(parseAdvisorAmountFromText('Also, I received 15k from Bloom as allowance.')).toBe(15000);
    expect(parseAdvisorAmountFromText('15k')).toBe(15000);
    expect(parseAdvisorAmountFromText('received 1.5k from Bloom')).toBe(1500);
    expect(extractAdvisorAmountMentions('1. Draft heading\nPaid 150 pesos today')).toHaveLength(1);
    expect(
      extractAdvisorAmountMentions('received 15k from Bloom').map((mention) => mention.amount)
    ).toEqual([15000]);
    expect(parseAdvisorAmountFromText('Jun 23 - Phohoa food - 919 - RCBC Credit Card')).toBe(919);
    expect(parseAdvisorAmountFromText('Jun 24 - Vercel - 20$ - RCBC CREDIT CARD')).toBe(20);
    expect(parseAdvisorAmountFromText('Vercel - $20 - RCBC Credit Card')).toBe(20);
    expect(parseAdvisorAmountFromText('Vercel - 20 USD - RCBC Credit Card')).toBe(20);
    expect(parseAdvisorAmountFromText('Phohoa food - PHP 919 - RCBC Credit Card')).toBe(919);
    expect(parseAdvisorAmountFromText('Phohoa food - \u20b1919 - RCBC Credit Card')).toBe(919);
    expect(parseAdvisorAmountFromText('Jun 23')).toBe(0);
    expect(parseAdvisorAmountFromText('bought 3 coffees')).toBe(0);
    expect(parseAdvisorAmountFromText('Ate dinner at Wolfgang 48999 charged to credit card')).toBe(
      48999
    );
    expect(
      extractAdvisorAmountMentions('Jun 23 - Phohoa food - 919 - RCBC Credit Card').map(
        (mention) => mention.amount
      )
    ).toEqual([919]);
    expect(extractAdvisorAmountMentions('bought 3 coffees')).toHaveLength(0);
    expect(parseAdvisorDateFromText('yesterday', { currentDate: '2026-06-18' })).toBe('2026-06-17');
    expect(
      looksLikeAdvisorTransactionPrompt(
        'Please add a transaction for 150 pesos transport from Cash'
      )
    ).toBe(true);
    expect(looksLikeAdvisorTransactionPrompt('can you read all my transactions?')).toBe(false);
    expect(looksLikeAdvisorTransactionPrompt('can you analyze my spending')).toBe(false);
    expect(looksLikeAdvisorTransactionPrompt('analyze my current financial standing')).toBe(false);
    expect(
      looksLikeAdvisorTransactionPrompt(
        'I want you to check my transactions and tell me what categories i should add'
      )
    ).toBe(false);
    expect(
      promptStartsNewAdvisorTransactionDrafts(
        'I want you to check my transactions and tell me what categories i should add'
      )
    ).toBe(false);
    expect(advisorPromptRequestsTransactionHistory('same as last time at Store')).toBe(true);
    expect(advisorPromptRequestsTransactionHistory('transferred 9000 from Cash to Savings')).toBe(
      false
    );
  });

  it('parses a month-day prepaid-plan correction without mistaking the day for the amount', () => {
    const prompt =
      'On June 10, I had a transaction for 102 Pesos on GCash. I used the 102 pesos to buy a 7-day prepaid plan.';
    const prepaidWorkbook = {
      ...workbook,
      categories: [
        ...workbook.categories,
        { id: 'phone-load', name: 'Phone Load', type: 'expense', isActive: true }
      ]
    };
    const fields = {
      date: parseAdvisorDateFromText(prompt, { currentDate: '2026-06-18' }),
      amount: parseAdvisorAmountFromText(prompt),
      categoryName: inferAdvisorCategoryNameFromPrompt(prepaidWorkbook, prompt, 'expense_paid'),
      primaryAccountName: 'GCash'
    };
    const validation = validateAdvisorTransactionIntent(
      prepaidWorkbook,
      {
        template: inferAdvisorTransactionTemplateFromText(prompt),
        fields
      },
      prompt,
      null,
      {
        currentDate: '2026-06-18'
      }
    );

    expect(fields).toEqual({
      date: '2026-06-10',
      amount: 102,
      categoryName: 'Phone Load',
      primaryAccountName: 'GCash'
    });
    expect(validation).toMatchObject({
      ok: true,
      template: 'expense_paid',
      fields: {
        date: '2026-06-10',
        amount: 102,
        categoryId: 'phone-load',
        primaryAccountId: 'gcash'
      }
    });
  });

  it('routes credit-card bill payments as debt payments with parsed amount and defaulted date', () => {
    const paymentWorkbook = {
      currency: 'PHP',
      settings: { usdToBaseRate: 56 },
      accounts: [
        {
          id: 'expense_account',
          name: 'Expense Account',
          group: 'asset',
          subtype: 'checking',
          isActive: true
        },
        {
          id: 'rcbc_card',
          name: 'RCBC Credit Card',
          group: 'liability',
          subtype: 'credit card',
          isActive: true
        }
      ],
      categories: [{ id: 'cc_payment', name: 'Credit Card Payment', type: 'debt', isActive: true }],
      counterparties: []
    };
    const prompt =
      'i paid for my credit card bill using my expense account. the amount is my entire expense account which is 19807.51';

    expect(parseAdvisorAmountFromText(prompt)).toBe(19807.51);
    expect(classifyAdvisorFinanceIntent(prompt, { currentDate: '2026-07-03' })).toMatchObject({
      kind: 'liability_payment',
      template: 'debt_payment',
      amount: 19807.51
    });

    const validation = validateAdvisorTransactionIntent(
      paymentWorkbook,
      {
        template: 'expense_charged',
        fields: {
          description: 'my credit card bill',
          amount: 19807.51,
          primaryAccountName: 'Credit card'
        },
        confidence: 0.55,
        reason: 'Model proposed a card charge.'
      },
      prompt,
      null,
      {
        currentDate: '2026-07-03',
        defaultDateForUndated: true
      }
    );

    expect(validation.ok).toBe(true);
    expect(validation.template).toBe('debt_payment');
    expect(validation.dateDefaulted).toBe(true);
    expect(validation.fields).toMatchObject({
      date: '2026-07-03',
      amount: 19807.51,
      primaryAccountId: 'expense_account',
      primaryAccountName: 'Expense Account',
      secondaryAccountId: 'rcbc_card',
      secondaryAccountName: 'RCBC Credit Card',
      categoryId: 'cc_payment',
      categoryName: 'Credit Card Payment'
    });
    expect(validation.missingFields).toEqual([]);
  });

  it('parses a messy mixed batch without turning account openings into transactions', () => {
    const prompt =
      "Hello, can you please add the following transactions? Earlier this morning, I went out and bought me some coffee priced at 7,000 pesos. It was charged through my credit card. I also opened a bank account named BDO savings account and I deposited 1,000,000 pesos there. I also received 50,000 pesos from my father. And yeah, that's all.";
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-07-03',
      defaultDateForUndatedRows: true
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].fields).toMatchObject({
      template: 'expense_charged',
      date: '2026-07-03',
      amount: 7000,
      currency: 'PHP',
      description: 'coffee',
      primaryAccountName: 'credit card'
    });
    expect(rows[0].sourceText).not.toContain('opened a bank account');
    expect(rows[1].fields).toMatchObject({
      template: 'income_received',
      date: '2026-07-03',
      amount: 50000,
      currency: 'PHP',
      description: 'income from Father',
      counterpartyName: 'Father',
      counterpartyKind: 'family'
    });
    expect(JSON.stringify(rows)).not.toContain('opening_balance');
    expect(JSON.stringify(rows)).not.toContain('BDO savings account');
  });

  it('does not keep a friends income category for family income', () => {
    const familyWorkbook = {
      ...workbook,
      accounts: [
        ...workbook.accounts,
        {
          id: 'expense_account',
          name: 'Expense Account',
          group: 'asset',
          subtype: 'checking',
          isActive: true
        }
      ],
      categories: [
        ...workbook.categories,
        { id: 'payment_from_friends', name: 'Payment from Friends', type: 'income', isActive: true }
      ]
    };

    const validation = validateAdvisorTransactionIntent(
      familyWorkbook,
      {
        template: 'income_received',
        fields: {
          date: '2026-07-03',
          amount: 50000,
          categoryName: 'Payment from Friends',
          primaryAccountName: 'Expense Account',
          counterpartyName: 'Father',
          counterpartyKind: 'family'
        }
      },
      'I received 50,000 pesos from my father.',
      null,
      {
        currentDate: '2026-07-03'
      }
    );

    expect(validation.ok).toBe(false);
    expect(validation.fields.categoryName).toBe('Family Support');
    expect(validation.fields.categoryId).toBe('');
    expect(validation.missingFields).toContain('categoryId');
  });

  it('keeps explicit charged-to-card purchases as expense_charged', () => {
    const chargeWorkbook = {
      ...workbook,
      settings: { usdToBaseRate: 56 },
      categories: [
        ...workbook.categories,
        { id: 'subscriptions', name: 'Subscriptions', type: 'expense', isActive: true }
      ],
      counterparties: [
        ...workbook.counterparties,
        { id: 'openai', name: 'OpenAI', kind: 'merchant', isActive: true }
      ]
    };
    const prompt = '15 USD charged to my credit card for OpenAI API';
    const validation = validateAdvisorTransactionIntent(
      chargeWorkbook,
      {
        template: 'expense_charged',
        fields: {
          amount: 15,
          currency: 'USD',
          description: 'OpenAI API',
          primaryAccountName: 'Credit Card',
          categoryName: 'Subscriptions',
          counterpartyName: 'OpenAI'
        }
      },
      prompt,
      null,
      {
        currentDate: '2026-07-03',
        defaultDateForUndated: true
      }
    );

    expect(classifyAdvisorFinanceIntent(prompt).template).toBe('expense_charged');
    expect(validation.ok).toBe(true);
    expect(validation.template).toBe('expense_charged');
    expect(validation.fields.primaryAccountId).toBe('card');
    expect(validation.fields.date).toBe('2026-07-03');
  });

  it('asks for the target card when card payment language is ambiguous across multiple cards', () => {
    const ambiguousWorkbook = {
      currency: 'PHP',
      settings: { usdToBaseRate: 56 },
      accounts: [
        { id: 'gcash', name: 'GCash', group: 'asset', subtype: 'wallet', isActive: true },
        {
          id: 'rcbc_card',
          name: 'RCBC Credit Card',
          group: 'liability',
          subtype: 'credit card',
          isActive: true
        },
        {
          id: 'bpi_card',
          name: 'BPI Credit Card',
          group: 'liability',
          subtype: 'credit card',
          isActive: true
        }
      ],
      categories: [{ id: 'cc_payment', name: 'Credit Card Payment', type: 'debt', isActive: true }],
      counterparties: []
    };
    const validation = validateAdvisorTransactionIntent(
      ambiguousWorkbook,
      {
        template: 'expense_charged',
        fields: {
          amount: 500,
          primaryAccountName: 'GCash'
        }
      },
      'paid my card from GCash 500',
      null,
      {
        currentDate: '2026-07-03',
        defaultDateForUndated: true
      }
    );

    expect(validation.template).toBe('debt_payment');
    expect(validation.fields.primaryAccountId).toBe('gcash');
    expect(validation.missingFields).toContain('secondaryAccountId');
    expect(validation.missingFields).not.toContain('date');
  });

  it.each([
    {
      prompt: 'hey can u log this, i payed off my cc from expense acct, amount 19,807.51 thanks',
      template: 'debt_payment',
      amount: 19807.51,
      primaryAccountId: 'expense_account',
      secondaryAccountId: 'rcbc_card',
      categoryId: 'cc_payment'
    },
    {
      prompt: 'ok sooo paid my creditcard bill. from exp acct. bill amount is 19807.51',
      template: 'debt_payment',
      amount: 19807.51,
      primaryAccountId: 'expense_account',
      secondaryAccountId: 'rcbc_card',
      categoryId: 'cc_payment'
    },
    {
      prompt: 'quick one: settled the credut card statment balnce using my expense acct - 19807.51',
      template: 'debt_payment',
      amount: 19807.51,
      primaryAccountId: 'expense_account',
      secondaryAccountId: 'rcbc_card',
      categoryId: 'cc_payment'
    },
    {
      prompt: 'rcbc cc min due paid from Expense acct for 1500 pls',
      template: 'debt_payment',
      amount: 1500,
      primaryAccountId: 'expense_account',
      secondaryAccountId: 'rcbc_card',
      categoryId: 'cc_payment'
    },
    {
      prompt: '15 USD charged on my rcbc cc for openai api pls',
      template: 'expense_charged',
      amount: 15,
      primaryAccountId: 'rcbc_card',
      secondaryAccountId: '',
      categoryId: 'subscriptions'
    }
  ])(
    'understands messy human finance wording: $prompt',
    ({ prompt, template, amount, primaryAccountId, secondaryAccountId, categoryId }) => {
      const messyWorkbook = {
        currency: 'PHP',
        settings: { usdToBaseRate: 56 },
        accounts: [
          {
            id: 'expense_account',
            name: 'Expense Account',
            group: 'asset',
            subtype: 'checking',
            isActive: true
          },
          {
            id: 'rcbc_card',
            name: 'RCBC Credit Card',
            group: 'liability',
            subtype: 'credit card',
            isActive: true
          }
        ],
        categories: [
          { id: 'cc_payment', name: 'Credit Card Payment', type: 'debt', isActive: true },
          { id: 'subscriptions', name: 'Subscriptions', type: 'expense', isActive: true }
        ],
        counterparties: [{ id: 'openai', name: 'OpenAI', kind: 'merchant', isActive: true }]
      };
      const semantic = classifyAdvisorFinanceIntent(prompt, {
        currentDate: '2026-07-03',
        defaultDateForUndated: true
      });
      const validation = validateAdvisorTransactionIntent(
        messyWorkbook,
        {
          template: template === 'expense_charged' ? 'expense_charged' : 'expense_paid',
          fields: {
            amount,
            currency: /usd/i.test(prompt) ? 'USD' : 'PHP',
            primaryAccountName: template === 'expense_charged' ? 'RCBC cc' : 'Expense acct'
          }
        },
        prompt,
        null,
        {
          currentDate: '2026-07-03',
          defaultDateForUndated: true
        }
      );

      expect(semantic.template).toBe(template);
      expect(validation.ok).toBe(true);
      expect(validation.template).toBe(template);
      expect(validation.fields.amount).toBe(amount);
      expect(validation.fields.date).toBe('2026-07-03');
      expect(validation.fields.primaryAccountId).toBe(primaryAccountId);
      expect(validation.fields.secondaryAccountId).toBe(secondaryAccountId);
      expect(validation.fields.categoryId).toBe(categoryId);
    }
  );

  it('classifies conversational non-create transaction commands separately from new drafts', () => {
    expect(
      classifyAdvisorFinanceIntent('actually revise that draft, the date should be yesterday').kind
    ).toBe('revise');
    expect(classifyAdvisorFinanceIntent('delete that transaction pls, i made a mistake').kind).toBe(
      'delete'
    );
    expect(classifyAdvisorFinanceIntent('can you create a category called Card Fees').kind).toBe(
      'entity_create'
    );
  });

  it('parses batch transaction list rows without mixing fields across rows', () => {
    const batchWorkbook = {
      ...workbook,
      settings: { usdToBaseRate: 56 },
      accounts: [
        ...workbook.accounts,
        {
          id: 'rcbc_card',
          name: 'RCBC Credit Card',
          group: 'liability',
          subtype: 'credit card',
          isActive: true
        }
      ],
      categories: [
        ...workbook.categories,
        { id: 'subscriptions', name: 'Subscriptions', type: 'expense', isActive: true }
      ],
      counterparties: [
        ...workbook.counterparties,
        { id: 'vercel', name: 'Vercel', kind: 'merchant', isActive: true }
      ]
    };
    const prompt = [
      'post these transactions:',
      '',
      'Jun 23 - Phohoa food - 919 - RCBC Credit Card',
      'Jun 24 - Vercel - 20$ - RCBC CREDIT CARD'
    ].join('\n');
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-06-24'
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sourceText)).toEqual([
      'Jun 23 - Phohoa food - 919 - RCBC Credit Card',
      'Jun 24 - Vercel - 20$ - RCBC CREDIT CARD'
    ]);
    expect(rows[0].fields).toMatchObject({
      template: 'expense_charged',
      date: '2026-06-23',
      amount: 919,
      description: 'Phohoa food',
      primaryAccountName: 'RCBC Credit Card',
      counterpartyName: 'Phohoa'
    });
    expect(rows[1].fields).toMatchObject({
      template: 'expense_charged',
      date: '2026-06-24',
      amount: 20,
      currency: 'USD',
      description: 'Vercel',
      primaryAccountName: 'RCBC CREDIT CARD',
      counterpartyName: 'Vercel'
    });

    const validations = rows.map((row) =>
      validateAdvisorTransactionIntent(
        batchWorkbook,
        {
          template: row.fields.template,
          confidence: 0.72,
          reason: 'Rules-based draft from a transaction list row.',
          fields: row.fields
        },
        row.prompt,
        null,
        {
          currentDate: '2026-06-24'
        }
      )
    );

    expect(validations.every((validation) => validation.ok)).toBe(true);
    expect(validations.map((validation) => validation.fields.amount)).toEqual([919, 20]);
    expect(validations.map((validation) => validation.fields.date)).toEqual([
      '2026-06-23',
      '2026-06-24'
    ]);
    expect(validations.map((validation) => validation.fields.primaryAccountId)).toEqual([
      'rcbc_card',
      'rcbc_card'
    ]);
    expect(validations[0].fields.categoryName).toBe('Food');
    expect(validations[0].fields.counterpartyName).toBe('Phohoa');
    expect(validations[1].fields.categoryName).toBe('Subscriptions');
    expect(validations[1].fields.counterpartyName).toBe('Vercel');
  });

  it('keeps cash and card refunds as refunds in batch transaction rows', () => {
    const rows = parseAdvisorTransactionListRows(
      [
        'post these transactions:',
        '',
        'Aug 14 - Nike refund - 500 - Cash',
        'Aug 15 - Nike refund - 500 - Credit Card'
      ].join('\n'),
      { currentDate: '2026-08-16' }
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.fields.template)).toEqual(['merchant_refund', 'merchant_refund']);
    expect(rows.map((row) => row.fields.primaryAccountName)).toEqual(['Cash', 'Credit Card']);
    expect(rows.map((row) => row.prompt)).toEqual([
      expect.stringContaining('refund of 500 pesos for Nike refund to Cash'),
      expect.stringContaining('refund of 500 pesos for Nike refund to Credit Card')
    ]);
  });

  it('cleans amount-first transaction rows into useful display descriptions', () => {
    const prompt = [
      'add these transactions',
      '',
      '85 pesos toll fee - Cash',
      '229 pesos toll fee - Cash',
      '314 pesos toll fee - Cash',
      '',
      '405 pesos Grab - Gcash',
      '228 pesos Load - Gcash',
      '284.75 pese Grab - Credit Card'
    ].join('\n');
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-06-25',
      defaultDateForUndatedRows: true
    });

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.sourceText)).toEqual([
      '85 pesos toll fee - Cash',
      '229 pesos toll fee - Cash',
      '314 pesos toll fee - Cash',
      '405 pesos Grab - Gcash',
      '228 pesos Load - Gcash',
      '284.75 pese Grab - Credit Card'
    ]);
    expect(rows.map((row) => row.fields.description)).toEqual([
      'toll fee',
      'toll fee',
      'toll fee',
      'Grab',
      'Load',
      'Grab'
    ]);
    expect(rows.map((row) => row.fields.amount)).toEqual([85, 229, 314, 405, 228, 284.75]);
    expect(rows.map((row) => row.fields.primaryAccountName)).toEqual([
      'Cash',
      'Cash',
      'Cash',
      'Gcash',
      'Gcash',
      'Credit Card'
    ]);
    expect(rows.map((row) => row.fields.counterpartyName)).toEqual([
      '',
      '',
      '',
      'Grab',
      '',
      'Grab'
    ]);

    const validation = validateAdvisorTransactionIntent(
      workbook,
      {
        template: 'expense_paid',
        fields: {
          date: '2026-06-25',
          description: '85 pesos toll fee - Cash',
          amount: 85,
          categoryName: 'Transport',
          primaryAccountName: 'Cash'
        }
      },
      '85 pesos toll fee - Cash',
      null,
      {
        currentDate: '2026-06-25'
      }
    );

    expect(validation.fields.description).toBe('toll fee');
  });

  it('keeps account-opening speech out of transaction rows while preserving nearby purchases', () => {
    const mixedWorkbook = {
      ...workbook,
      accounts: [
        ...workbook.accounts,
        {
          id: 'rcbc_card',
          name: 'Credit Card',
          group: 'liability',
          subtype: 'credit_card',
          isActive: true
        }
      ],
      categories: [
        ...workbook.categories,
        { id: 'shopping', name: 'Shopping', type: 'expense', isActive: true }
      ],
      counterparties: [
        ...workbook.counterparties,
        { id: 'starbucks', name: 'Starbucks', kind: 'merchant', isActive: true }
      ]
    };
    const prompt =
      'Hi, please add these transactions for today. At breakfast, I bought some coffee in Starbucks for 800 pesos, charged to my credit card. I paid cash for it. And then at lunch, I bought AirPods Max for 36,000 pesos, charged to my credit card. Also, please add a new account. I opened a bank account in BDO amounting to 20,000 pesos. Thank you.';
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-07-01',
      defaultDateForUndatedRows: true
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sourceText).join(' ')).not.toMatch(/\bBDO\b|20,000/);
    expect(rows[0].fields).toMatchObject({
      date: '2026-07-01',
      amount: 800,
      description: 'coffee',
      counterpartyName: 'Starbucks'
    });
    expect(rows[1].fields).toMatchObject({
      date: '2026-07-01',
      amount: 36000,
      description: 'AirPods Max',
      counterpartyName: 'AirPods Max'
    });

    const airPodsValidation = validateAdvisorTransactionIntent(
      mixedWorkbook,
      {
        template: rows[1].fields.template,
        confidence: 0.72,
        reason: 'Rules-based draft from a transaction list row.',
        fields: rows[1].fields
      },
      rows[1].prompt,
      null,
      {
        currentDate: '2026-07-01'
      }
    );
    expect(airPodsValidation.fields.categoryName).toBe('Shopping');
  });

  it('propagates shared card-charge wording across spoken purchase batches', () => {
    const sharedChargeWorkbook = {
      ...workbook,
      categories: [
        ...workbook.categories,
        { id: 'shopping', name: 'Shopping', type: 'expense', isActive: true }
      ]
    };
    const prompt =
      'Hi, please add the following transactions. Today, I purchased 10,000 pesos worth of coffee at Harlan & Holden. I also ate at Wolfgang for 100,000 pesos. I bought some shoes for my dad at Hermes amounting to 50,000 pesos. Everything was charged through my credit card.';
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-07-01',
      defaultDateForUndatedRows: true
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.fields.amount)).toEqual([10000, 100000, 50000]);
    expect(rows.map((row) => row.fields.template)).toEqual([
      'expense_charged',
      'expense_charged',
      'expense_charged'
    ]);
    expect(rows.map((row) => row.fields.primaryAccountName.toLowerCase())).toEqual([
      'credit card',
      'credit card',
      'credit card'
    ]);
    expect(rows.map((row) => row.fields.counterpartyName)).toEqual([
      'Harlan & Holden',
      'Wolfgang',
      'Hermes'
    ]);

    const validations = rows.map((row) =>
      validateAdvisorTransactionIntent(
        sharedChargeWorkbook,
        {
          template: row.fields.template,
          confidence: 0.72,
          reason: 'Rules-based draft from spoken transaction prose.',
          fields: row.fields
        },
        [row.prompt, row.sourceText].join(' '),
        null,
        {
          currentDate: '2026-07-01'
        }
      )
    );

    expect(validations.map((validation) => validation.ok)).toEqual([true, true, true]);
    expect(validations.map((validation) => validation.fields.primaryAccountId)).toEqual([
      'card',
      'card',
      'card'
    ]);
    expect(validations.map((validation) => validation.fields.categoryName)).toEqual([
      'Food',
      'Food',
      'Shopping'
    ]);
    expect(validations.map((validation) => validation.fields.counterpartyName)).toEqual([
      'Harlan & Holden',
      'Wolfgang',
      'Hermes'
    ]);
  });

  it('handles mixed income, card purchase, and unnamed account-opening prose', () => {
    const mixedWorkbook = {
      ...workbook,
      settings: { usdToBaseRate: 56 },
      accounts: [
        { id: 'cash', name: 'Cash', group: 'asset', subtype: 'cash', isActive: true },
        {
          id: 'rcbc_card',
          name: 'RCBC Credit Card',
          group: 'liability',
          subtype: 'credit card',
          isActive: true
        }
      ],
      categories: [
        { id: 'allowance', name: 'Allowance', type: 'income', isActive: true },
        { id: 'shopping', name: 'Shopping', type: 'expense', isActive: true }
      ],
      counterparties: []
    };
    const prompt =
      'Hi, can you please add the following transactions? Today I received money for 20,000 pesos. It was an allowance given to me by my mother. Also, I spent 50,000 pesos buying a new laptop charged through my credit card. Also, I opened a new bank account and I deposited 1,000,000 pesos there. Thank you.';
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-07-03',
      defaultDateForUndatedRows: true
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].fields).toMatchObject({
      template: 'income_received',
      date: '2026-07-03',
      amount: 20000,
      description: 'allowance',
      counterpartyName: 'Mother',
      counterpartyKind: 'family'
    });
    expect(rows[1].fields).toMatchObject({
      template: 'expense_charged',
      date: '2026-07-03',
      amount: 50000,
      description: 'new laptop',
      primaryAccountName: 'credit card'
    });

    const validations = rows.map((row) =>
      validateAdvisorTransactionIntent(
        mixedWorkbook,
        {
          template: row.fields.template,
          confidence: 0.72,
          reason: 'Rules-based draft from mixed spoken prose.',
          fields: row.fields
        },
        row.prompt,
        null,
        {
          currentDate: '2026-07-03',
          defaultDateForUndated: true
        }
      )
    );

    expect(validations[0].ok).toBe(false);
    expect(validations[0].missingFields).toEqual(['primaryAccountId']);
    expect(validations[0].fields).toMatchObject({
      categoryId: 'allowance',
      categoryName: 'Allowance',
      counterpartyName: 'Mother',
      counterpartyKind: 'family'
    });
    expect(validations[1].ok).toBe(true);
    expect(validations[1].missingFields).toEqual([]);
    expect(validations[1].fields).toMatchObject({
      categoryId: 'shopping',
      categoryName: 'Shopping',
      primaryAccountId: 'rcbc_card',
      primaryAccountName: 'RCBC Credit Card',
      secondaryAccountId: '',
      secondaryAccountName: '',
      description: 'new laptop'
    });
  });

  it('tolerates typo-heavy mixed finance commands without inventing missing accounts', () => {
    const mixedWorkbook = {
      ...workbook,
      settings: { usdToBaseRate: 56 },
      accounts: [
        {
          id: 'rcbc_card',
          name: 'RCBC Credit Card',
          group: 'liability',
          subtype: 'credit card',
          isActive: true
        }
      ],
      categories: [
        { id: 'allowance', name: 'Allowance', type: 'income', isActive: true },
        { id: 'shopping', name: 'Shopping', type: 'expense', isActive: true }
      ],
      counterparties: []
    };
    const prompts = [
      'hey pls add this, today i recieved 20,000 pesos allowance from my mom. then bought a laptop for 50,000 charged thru my credit card. also opened new bank account and deposited 1,000,000 there',
      'can u add these: got 20k allowance by my mother today. laptop was 50k, charged on my credit card. opened a new bank acct, put 1,000,000 pesos there too.'
    ];

    prompts.forEach((prompt) => {
      const rows = parseAdvisorTransactionListRows(prompt, {
        currentDate: '2026-07-03',
        defaultDateForUndatedRows: true
      });
      const validations = rows.map((row) =>
        validateAdvisorTransactionIntent(
          mixedWorkbook,
          {
            template: row.fields.template,
            confidence: 0.72,
            reason: 'Rules-based draft from imperfect human wording.',
            fields: row.fields
          },
          row.prompt,
          null,
          {
            currentDate: '2026-07-03',
            defaultDateForUndated: true
          }
        )
      );

      expect(rows).toHaveLength(2);
      expect(validations.map((validation) => validation.template)).toEqual([
        'income_received',
        'expense_charged'
      ]);
      expect(validations[0].missingFields).toEqual(['primaryAccountId']);
      expect(validations[0].fields).toMatchObject({
        amount: 20000,
        categoryName: 'Allowance',
        counterpartyKind: 'family'
      });
      expect(validations[1].ok).toBe(true);
      expect(validations[1].fields).toMatchObject({
        amount: 50000,
        categoryName: 'Shopping',
        primaryAccountId: 'rcbc_card',
        primaryAccountName: 'RCBC Credit Card',
        description: 'laptop',
        counterpartyName: 'laptop'
      });
    });
  });

  it('handles compact allowance income shorthand without treating the amount as invalid', () => {
    const allowanceWorkbook = {
      ...workbook,
      categories: [
        ...workbook.categories,
        { id: 'allowance', name: 'Allowance', type: 'income', isActive: true }
      ]
    };
    const prompt = 'Also, I received 15k from Bloom as allowance.';
    const validation = validateAdvisorTransactionIntent(
      allowanceWorkbook,
      {
        template: 'income_received',
        fields: {
          date: '2026-06-25',
          description: prompt,
          amount: '15k',
          primaryAccountName: 'Cash'
        }
      },
      prompt,
      null,
      {
        currentDate: '2026-06-25'
      }
    );

    expect(validation.ok).toBe(true);
    expect(validation.fields).toMatchObject({
      template: 'income_received',
      amount: 15000,
      description: 'allowance',
      categoryId: 'allowance',
      categoryName: 'Allowance',
      primaryAccountId: 'cash',
      counterpartyName: 'Bloom'
    });
    expect(validation.missingFields).not.toContain('amount');
  });

  it('keeps a 15-row pasted transaction batch instead of truncating at eight', () => {
    const prompt = [
      'Add these:',
      '',
      '1. 245 pesos coffee at Starbucks - GCash',
      '2. 1.2k groceries at S&R - Credit Card',
      '3. 85 pesos parking fee - Cash',
      '4. Received 15k from Bloom as allowance - Cash',
      '5. 799 pesos Netflix subscription - RCBC Credit Card',
      '6. 350 pesos Grab ride - GCash',
      '7. 2,450 pesos dinner at Wildflour - Credit Card',
      '8. 500 pesos phone load - GCash',
      '9. Transferred 5k from Cash to Savings',
      '10. 1,850 pesos Meralco bill - BPI Bank',
      '11. 320 pesos coffe at starbuks - Gcash',
      '12. 1.5k groceris at S&R - Credit Card',
      '13. Recieved 10k from Bloom as alowance - Cash',
      '14. 450 pesos Grab rid - GCash',
      '15. 899 pesos Netflx subscripton - RCBC Credit Card'
    ].join('\n');
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-06-26',
      defaultDateForUndatedRows: true
    });

    expect(rows).toHaveLength(15);
    expect(rows.map((row) => row.fields.amount)).toEqual([
      245, 1200, 85, 15000, 799, 350, 2450, 500, 5000, 1850, 320, 1500, 10000, 450, 899
    ]);
    expect(rows[3].fields).toMatchObject({
      template: 'income_received',
      description: 'allowance',
      counterpartyName: 'Bloom'
    });
    expect(rows[12].fields).toMatchObject({
      template: 'income_received',
      description: 'allowance',
      counterpartyName: 'Bloom'
    });
    expect(rows[14].sourceText).toBe('899 pesos Netflx subscripton - RCBC Credit Card');
  });

  it('routes mixed typed rows and plural image attachments as combined intake', () => {
    const prompt = [
      'add these 6 transactions, 3 text, 3 images . All should be dated June 1,2026',
      '',
      '1. Pho Hoa - 3200 - Credit Card',
      '2. Paid for my sisters dog food - Credit Card - 10,000',
      '3. Ate lunch at Wildflour - 2999 - Credit Card'
    ].join('\n');
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-06-25',
      defaultDateForUndatedRows: true
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.fields.date)).toEqual(['2026-06-01', '2026-06-01', '2026-06-01']);
    expect(advisorPromptReferencesAttachedImage(prompt)).toBe(true);
    expect(shouldUseAdvisorMixedTransactionImageIntake(prompt, rows, 3)).toBe(true);
    expect(shouldPreferTextTransactionIntakeWithImages(prompt, rows, 3)).toBe(false);
  });

  it('routes all-these typed rows with attachments as mixed intake and parses every typed row', () => {
    const prompt = [
      'add all these transactions. All should be dated June 1,2026',
      '',
      'Pho Hoa - 3200 - Credit Card',
      'Paid for my sisters dog food - Credit Card - 10,000',
      'Ate lunch at Wildflour - 2999 - Credit Card',
      'Had a haircut for 500 charged to credit card',
      'Ate dinner at wolfgang 48999 charged to credit card'
    ].join('\n');
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-06-25',
      defaultDateForUndatedRows: true
    });

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.fields.amount)).toEqual([3200, 10000, 2999, 500, 48999]);
    expect(rows.map((row) => row.fields.date)).toEqual([
      '2026-06-01',
      '2026-06-01',
      '2026-06-01',
      '2026-06-01',
      '2026-06-01'
    ]);
    expect(rows.map((row) => row.fields.template)).toEqual([
      'expense_charged',
      'expense_charged',
      'expense_charged',
      'expense_charged',
      'expense_charged'
    ]);
    expect(rows.map((row) => row.fields.primaryAccountName.toLowerCase())).toEqual([
      'credit card',
      'credit card',
      'credit card',
      'credit card',
      'credit card'
    ]);
    expect(rows[2].fields.counterpartyName).toBe('Wildflour');
    expect(rows[4].fields.counterpartyName).toBe('wolfgang');
    expect(shouldUseAdvisorMixedTransactionImageIntake(prompt, rows, 3)).toBe(true);
    expect(shouldPreferTextTransactionIntakeWithImages(prompt, rows, 3)).toBe(false);
  });

  it('keeps typed rows as source of truth when attachments are only supporting evidence', () => {
    const prompt = [
      'add these 3 transactions with receipts attached',
      '1. Pho Hoa - 3200 - Credit Card',
      '2. Wildflour - 2999 - Credit Card',
      '3. Coffee - 250 - Cash'
    ].join('\n');
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-06-25',
      defaultDateForUndatedRows: true
    });

    expect(rows).toHaveLength(3);
    expect(advisorPromptReferencesAttachedImage(prompt)).toBe(true);
    expect(shouldUseAdvisorMixedTransactionImageIntake(prompt, rows, 3)).toBe(false);
    expect(shouldPreferTextTransactionIntakeWithImages(prompt, rows, 3)).toBe(true);
  });

  it('ignores typoed transaction-list headers and filler rows', () => {
    const prompt = [
      'post thse transactions:',
      'add these',
      '',
      'Jun 23 - Phohoa food - 919 - RCBC Credit Card',
      'Jun 24 - Vercel - 20$ - RCBC CREDIT CARD'
    ].join('\n');
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-06-24'
    });

    expect(rows.map((row) => row.sourceText)).toEqual([
      'Jun 23 - Phohoa food - 919 - RCBC Credit Card',
      'Jun 24 - Vercel - 20$ - RCBC CREDIT CARD'
    ]);
    expect(rows.map((row) => row.fields.amount)).toEqual([919, 20]);
  });

  it('treats messy also-add prompts as new transaction batches, not pending-draft edits', () => {
    const prompt = [
      'Also add thesetransactions for todya:',
      '',
      'I used 500 cash to pay for toll fee',
      '',
      'I spent 15000 to buy medicine for my lola'
    ].join('\n');
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-06-25'
    });

    expect(
      promptStartsNewAdvisorTransactionDrafts(prompt, {
        currentDate: '2026-06-25'
      })
    ).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.fields.amount)).toEqual([500, 15000]);
    expect(rows.map((row) => row.fields.date)).toEqual(['2026-06-25', '2026-06-25']);
    expect(rows[0].fields.description).toContain('toll fee');
    expect(rows[1].fields.description).toContain('medicine');
  });

  it('splits spoken prose into separate transaction drafts without mixing fields', () => {
    const intakeWorkbook = {
      ...workbook,
      accounts: [
        ...workbook.accounts,
        {
          id: 'rcbc_card',
          name: 'RCBC Credit Card',
          group: 'liability',
          subtype: 'credit card',
          isActive: true
        }
      ],
      categories: [
        ...workbook.categories,
        { id: 'shopping', name: 'Shopping', type: 'expense', isActive: true }
      ]
    };
    const prompt =
      "Hi, can you please add multiple transactions? Today, I spent 300 pesos on Starbucks coffee. I paid using my cash. And then I also went to the department store because I bought some soap for my siblings. It was paid using my credit card. And then I went to Uncle Moe's to eat food. I was charged 900 pesos on my credit card for it. Can you please add all these transactions? Thank you.";
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-07-01',
      defaultDateForUndatedRows: true
    });

    expect(
      promptStartsNewAdvisorTransactionDrafts(prompt, {
        currentDate: '2026-07-01'
      })
    ).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.fields.amount)).toEqual([300, 900]);
    expect(rows.map((row) => row.fields.date)).toEqual(['2026-07-01', '2026-07-01']);
    expect(rows.map((row) => row.fields.counterpartyName)).toEqual(['Starbucks', "Uncle Moe's"]);
    expect(rows.map((row) => row.fields.primaryAccountName.toLowerCase())).toEqual([
      'cash',
      'credit card'
    ]);
    expect(rows.map((row) => row.sourceText).join(' ')).not.toMatch(/\bsoap\b/i);

    const validations = rows.map((row) =>
      validateAdvisorTransactionIntent(
        intakeWorkbook,
        {
          template: row.fields.template,
          confidence: 0.72,
          reason: 'Rules-based draft from spoken transaction prose.',
          fields: row.fields
        },
        row.prompt,
        null,
        {
          currentDate: '2026-07-01'
        }
      )
    );

    expect(validations.map((validation) => validation.ok)).toEqual([true, true]);
    expect(validations.map((validation) => validation.template)).toEqual([
      'expense_paid',
      'expense_charged'
    ]);
    expect(validations.map((validation) => validation.fields.primaryAccountId)).toEqual([
      'cash',
      'card'
    ]);
    expect(validations.map((validation) => validation.fields.categoryName)).toEqual([
      'Food',
      'Food'
    ]);
    expect(validations.map((validation) => validation.fields.counterpartyName)).toEqual([
      'Starbucks',
      "Uncle Moe's"
    ]);
  });

  it('normalizes model-first v2 intake with field evidence and needs-info items', () => {
    const intakeWorkbook = {
      ...workbook,
      accounts: [
        ...workbook.accounts,
        {
          id: 'rcbc_card',
          name: 'RCBC Credit Card',
          group: 'liability',
          subtype: 'credit card',
          isActive: true
        }
      ],
      categories: [
        ...workbook.categories,
        { id: 'shopping', name: 'Shopping', type: 'expense', isActive: true }
      ]
    };
    const parsed = {
      schema_version: ADVISOR_TRANSACTION_INTAKE_SCHEMA_VERSION_V2,
      route: 'new_transaction_batch',
      usePendingDraft: false,
      intent: 'transaction_drafts',
      reason: 'User described three attempted transactions.',
      confidence: 0.89,
      questions: [],
      transactions: [
        {
          status: 'ready',
          template: 'expense_paid',
          confidence: 0.93,
          reason: 'Coffee purchase paid with cash.',
          sourceText: 'Today, I spent 300 pesos on Starbucks coffee. I paid using my cash.',
          fields: {
            date: '2026-07-01',
            description: 'Starbucks coffee',
            amount: 300,
            currency: 'PHP',
            categoryName: 'Food',
            primaryAccountName: 'Cash',
            counterpartyName: 'Starbucks'
          },
          fieldEvidence: {
            date: 'Today',
            amount: '300 pesos',
            category: 'coffee',
            primaryAccount: 'my cash',
            counterparty: 'Starbucks',
            description: 'Starbucks coffee'
          },
          missingFields: []
        },
        {
          status: 'needs_info',
          template: 'expense_charged',
          confidence: 0.72,
          reason: 'Soap purchase was charged to card, but no amount was provided.',
          sourceText:
            'I also went to the department store because I bought some soap for my siblings. It was paid using my credit card.',
          fields: {
            date: '2026-07-01',
            description: 'soap',
            amount: 0,
            currency: 'PHP',
            categoryName: 'Shopping',
            primaryAccountName: 'Credit Card',
            counterpartyName: 'department store'
          },
          fieldEvidence: {
            date: 'Today',
            category: 'soap',
            primaryAccount: 'my credit card',
            counterparty: 'department store',
            description: 'soap'
          },
          missingFields: ['amount']
        },
        {
          status: 'ready',
          template: 'expense_charged',
          confidence: 0.91,
          reason: 'Restaurant charge on credit card.',
          sourceText:
            "I went to Uncle Moe's to eat food. I was charged 900 pesos on my credit card for it.",
          fields: {
            date: '2026-07-01',
            description: 'food',
            amount: 900,
            currency: 'PHP',
            categoryName: 'Food',
            primaryAccountName: 'Credit Card',
            counterpartyName: "Uncle Moe's"
          },
          fieldEvidence: {
            date: 'Today',
            amount: '900 pesos',
            category: 'food',
            primaryAccount: 'my credit card',
            counterparty: "Uncle Moe's",
            description: 'eat food'
          },
          missingFields: []
        }
      ]
    };
    const interpretation = normalizeAdvisorTransactionIntakeInterpretation(parsed, 'full prompt', {
      source: 'model'
    });

    expect(interpretation.schema_version).toBe(ADVISOR_TRANSACTION_INTAKE_SCHEMA_VERSION_V2);
    expect(interpretation.transactions).toHaveLength(3);
    expect(interpretation.transactions[1].intent.missingFields).toEqual(['amount']);
    expect(interpretation.transactions[1].intent.fieldEvidence.primaryAccount).toBe(
      'my credit card'
    );
    expect(
      normalizeAdvisorTransactionFieldEvidence({
        amountText: '900 pesos',
        charged_to: 'my credit card'
      })
    ).toMatchObject({
      amount: '900 pesos',
      primaryAccount: 'my credit card'
    });

    const validations = interpretation.transactions.map((item) =>
      validateAdvisorTransactionIntent(intakeWorkbook, item.intent, item.sourceText, null, {
        currentDate: '2026-07-01'
      })
    );
    expect(validations.map((validation) => validation.ok)).toEqual([true, false, true]);
    expect(validations[1].missingFields).toContain('amount');
    expect(validations[1].invalidReasons).toEqual([]);
    expect(validations[1].fields.amount).toBe(0);
    expect(validations[1].fields.primaryAccountId).toBe('card');
    expect(validations[1].fields.categoryName).toBe('Shopping');
  });

  it('does not borrow adjacent paragraph amounts when v2 marks amount missing', () => {
    const fullPrompt =
      "I spent 300 pesos on Starbucks. I bought soap using my credit card. I was charged 900 pesos at Uncle Moe's.";
    const validation = validateAdvisorTransactionIntent(
      {
        ...workbook,
        categories: [
          ...workbook.categories,
          { id: 'shopping', name: 'Shopping', type: 'expense', isActive: true }
        ]
      },
      {
        template: 'expense_charged',
        confidence: 0.7,
        reason: 'Soap purchase is missing amount.',
        missingFields: ['amount'],
        fieldEvidence: {
          description: 'soap',
          primaryAccount: 'my credit card',
          category: 'soap'
        },
        fields: {
          date: '2026-07-01',
          description: 'soap',
          amount: 0,
          currency: 'PHP',
          categoryName: 'Shopping',
          primaryAccountName: 'Credit Card'
        }
      },
      fullPrompt,
      null,
      {
        currentDate: '2026-07-01'
      }
    );

    expect(validation.fields.amount).toBe(0);
    expect(validation.missingFields).toContain('amount');
    expect(validation.invalidReasons).toEqual([]);
  });

  it('validates unsupported field evidence and builds speech preflight hints', () => {
    const prompt =
      "Today, I spent 300 pesos on Starbucks coffee. I paid using my cash. I also bought soap using my credit card. I was charged 900 pesos at Uncle Moe's.";
    const evidence = validateAdvisorTransactionFieldEvidence(
      {
        fields: {
          amount: 900,
          description: 'soap'
        },
        fieldEvidence: {
          description: 'soap'
        }
      },
      'I also bought soap using my credit card.'
    );
    expect(evidence.ok).toBe(false);
    expect(evidence.invalidReasons.join(' ')).toContain('Amount evidence');

    const hints = buildAdvisorTransactionIntakePreflightHints(workbook, prompt, {
      currentDate: '2026-07-01',
      defaultDateForUndatedRows: true
    });
    expect(hints.amountMentions.map((mention) => mention.amount)).toEqual([300, 900]);
    expect(hints.dateMentions).toContainEqual({ text: 'Today', date: '2026-07-01' });
    expect(hints.paymentWords.map((word) => word.toLowerCase())).toEqual(
      expect.arrayContaining(['cash', 'credit card'])
    );
    expect(
      hints.sentenceGroups.some(
        (group) => /\bsoap\b/i.test(group.text) && group.amountMentions.length === 0
      )
    ).toBe(true);
  });

  it('keeps mixed spoken purchases and transfers segmented when transfer wording appears late', () => {
    const intakeWorkbook = {
      ...workbook,
      accounts: [
        ...workbook.accounts,
        { id: 'freedom', name: 'Freedom Fund', group: 'asset', subtype: 'savings', isActive: true }
      ],
      categories: [
        ...workbook.categories,
        { id: 'shopping', name: 'Shopping', type: 'expense', isActive: true }
      ],
      counterparties: [
        ...workbook.counterparties,
        { id: 'wolfgang', name: 'Wolfgang', kind: 'merchant', isActive: true }
      ]
    };
    const prompt =
      'Hi. Can you please add these following transactions? At morning, I had a cup of coffee worth 220 pesos. It was charged to my credit card. Then this late afternoon, I ate lunch with some friends at Wolfgang. I spent 50,000 pesos charged to my credit card again. I also bought airpods for 16,000 pesos charged to my freedom fund. And I transferred 2,000 pesos. from freedom fund to my cash';
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-07-01',
      defaultDateForUndatedRows: true
    });
    const transferResults = buildAdvisorExplicitTransferIntentResults(intakeWorkbook, prompt, {
      currentDate: '2026-07-01',
      defaultDateForUndatedRows: true
    });

    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.fields.amount)).toEqual([220, 50000, 16000, 2000]);
    expect(rows.map((row) => row.fields.date)).toEqual([
      '2026-07-01',
      '2026-07-01',
      '2026-07-01',
      '2026-07-01'
    ]);
    expect(rows[0].fields.description).toBe('coffee');
    expect(rows[1].fields.counterpartyName).toBe('Wolfgang');
    expect(rows[2].fields.template).toBe('expense_paid');
    expect(rows[2].fields.primaryAccountName.toLowerCase()).toBe('freedom fund');
    expect(transferResults).toHaveLength(1);
    expect(transferResults[0].intent.fields.amount).toBe(2000);
    expect(transferResults[0].intent.fields.primaryAccountName).toBe('Freedom Fund');
    expect(transferResults[0].intent.fields.secondaryAccountName).toBe('Cash');

    const validations = rows.slice(0, 3).map((row) =>
      validateAdvisorTransactionIntent(
        intakeWorkbook,
        {
          template: row.fields.template,
          confidence: 0.72,
          reason: 'Rules-based draft from spoken transaction prose.',
          fields: row.fields
        },
        [row.prompt, row.sourceText].join(' '),
        null,
        {
          currentDate: '2026-07-01'
        }
      )
    );
    validations.push(
      validateAdvisorTransactionIntent(
        intakeWorkbook,
        transferResults[0].intent,
        transferResults[0].prompt,
        null,
        {
          currentDate: '2026-07-01'
        }
      )
    );

    expect(validations.map((validation) => validation.ok)).toEqual([true, true, true, true]);
    expect(validations.map((validation) => validation.template)).toEqual([
      'expense_charged',
      'expense_charged',
      'expense_paid',
      'transfer'
    ]);
    expect(validations.map((validation) => validation.fields.primaryAccountId)).toEqual([
      'card',
      'card',
      'freedom',
      'freedom'
    ]);
    expect(validations[3].fields.secondaryAccountId).toBe('cash');
    expect(validations.map((validation) => validation.invalidReasons)).toEqual([[], [], [], []]);
  });

  it('handles undated typed lists with card and cash accounts proactively', () => {
    const intakeWorkbook = {
      ...workbook,
      accounts: [
        ...workbook.accounts,
        {
          id: 'rcbc_card',
          name: 'RCBC Credit Card',
          group: 'liability',
          subtype: 'credit card',
          isActive: true
        }
      ],
      categories: [
        ...workbook.categories,
        { id: 'shopping', name: 'Shopping', type: 'expense', isActive: true }
      ]
    };
    const prompt = [
      'Hi! Please add these transactions:',
      '',
      'Laptop Purchase - 140,000 - RCBC Credit Card',
      'Parking - 200 - Cash',
      'Image i attached'
    ].join('\n');
    const rows = parseAdvisorTransactionListRows(prompt, {
      currentDate: '2026-06-25',
      defaultDateForUndatedRows: true
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].fields).toMatchObject({
      template: 'expense_charged',
      date: '2026-06-25',
      amount: 140000,
      primaryAccountName: 'RCBC Credit Card'
    });
    expect(rows[1].fields).toMatchObject({
      template: 'expense_paid',
      date: '2026-06-25',
      amount: 200,
      primaryAccountName: 'Cash'
    });

    const validations = rows.map((row) =>
      validateAdvisorTransactionIntent(
        intakeWorkbook,
        {
          template: row.fields.template,
          confidence: 0.72,
          reason: 'Rules-based draft from a transaction list row.',
          fields: row.fields
        },
        row.prompt,
        null,
        {
          currentDate: '2026-06-25'
        }
      )
    );

    expect(validations.map((validation) => validation.ok)).toEqual([true, true]);
    expect(validations.map((validation) => validation.template)).toEqual([
      'expense_charged',
      'expense_paid'
    ]);
    expect(validations.map((validation) => validation.fields.date)).toEqual([
      '2026-06-25',
      '2026-06-25'
    ]);
    expect(validations.map((validation) => validation.fields.primaryAccountId)).toEqual([
      'rcbc_card',
      'cash'
    ]);
    expect(validations.map((validation) => validation.fields.categoryName)).toEqual([
      'Shopping',
      'Transport'
    ]);
  });

  it('proposes a best-fit category name when the workbook does not have it yet', () => {
    const intakeWorkbook = {
      ...workbook,
      accounts: [
        ...workbook.accounts,
        { id: 'freedom', name: 'Freedom Fund', group: 'asset', subtype: 'savings', isActive: true }
      ],
      categories: workbook.categories.filter((category) => category.name !== 'Shopping')
    };
    const prompt =
      'I bought a bag from Hermes amounting to 50,000 pesos, charged to my freedom fund.';
    const validation = validateAdvisorTransactionIntent(
      intakeWorkbook,
      {
        template: 'expense_paid',
        confidence: 0.9,
        reason: 'Model supplied an existing but weak category.',
        fields: {
          date: '2026-07-01',
          amount: 50000,
          currency: 'PHP',
          categoryName: 'Food',
          primaryAccountName: 'Freedom Fund',
          counterpartyName: 'Hermes'
        }
      },
      prompt,
      null,
      {
        currentDate: '2026-07-01'
      }
    );

    expect(validation.ok).toBe(false);
    expect(validation.missingFields).toEqual(['categoryId']);
    expect(validation.fields.categoryName).toBe('Shopping');
    expect(validation.fields.primaryAccountId).toBe('freedom');
  });

  it('does not let optional model missing fields block complete income drafts', () => {
    const intakeWorkbook = {
      ...workbook,
      accounts: [
        ...workbook.accounts,
        { id: 'freedom', name: 'Freedom Fund', group: 'asset', subtype: 'savings', isActive: true }
      ],
      categories: [
        ...workbook.categories,
        { id: 'allowance', name: 'Allowance', type: 'income', isActive: true }
      ]
    };
    const validation = validateAdvisorTransactionIntent(
      intakeWorkbook,
      {
        template: 'income_received',
        confidence: 0.95,
        missingFields: [
          'secondary account name',
          'counterparty',
          'counterparty name',
          'counterparty kind'
        ],
        fields: {
          date: '2026-07-01',
          amount: 1000000,
          currency: 'PHP',
          categoryName: 'Allowance',
          primaryAccountName: 'Freedom Fund'
        }
      },
      'I received an amount of 1 million pesos to my freedom fund.',
      null,
      {
        currentDate: '2026-07-01'
      }
    );

    expect(validation.ok).toBe(true);
    expect(validation.missingFields).toEqual([]);
    expect(validation.fields.primaryAccountId).toBe('freedom');
    expect(validation.fields.categoryId).toBe('allowance');
  });

  it('normalizes model-first intake route decisions separately from pending drafts', () => {
    const interpretation = normalizeAdvisorTransactionIntakeInterpretation(
      {
        route: 'new_transaction_batch',
        usePendingDraft: false,
        intent: 'transaction_drafts',
        reason: 'User said also add these and listed two purchases.',
        confidence: 0.91,
        questions: [],
        transactions: [
          {
            template: 'expense_charged',
            confidence: 0.9,
            reason: 'Ballpen purchase charged to card.',
            sourceAttachmentId: 'image-one',
            sourceText: '1000 pesos bought ballpen uising rcbc credit card',
            fields: {
              date: '2026-06-25',
              description: 'ballpen',
              amount: 1000,
              currency: 'PHP',
              primaryAccountName: 'RCBC Credit Card',
              categoryName: 'Office Supplies'
            },
            extraction: {
              imageEvidence: 'TOTAL PHP 1,000.00',
              sourceAttachmentId: 'image-one',
              usedUserText: true,
              usedImageText: true,
              uncertainFields: ['categoryId']
            },
            missing_fields: []
          },
          {
            template: 'expense_charged',
            confidence: 0.87,
            reason: 'Laptop purchase charged to card.',
            sourceText: '19990 for Lapotop charged to my credit card',
            fields: {
              date: '2026-06-25',
              description: 'Lapotop',
              amount: 19990,
              currency: 'PHP',
              primaryAccountName: 'Credit Card'
            },
            missing_fields: ['categoryId']
          }
        ]
      },
      'Also add these...',
      {
        source: 'model'
      }
    );

    expect(interpretation).toMatchObject({
      route: 'new_transaction_batch',
      usePendingDraft: false,
      source: 'model',
      reason: 'User said also add these and listed two purchases.'
    });
    expect(interpretation.transactions).toHaveLength(2);
    expect(interpretation.transactions.map((item) => item.intent.fields.amount)).toEqual([
      1000, 19990
    ]);
    expect(interpretation.transactions[1].intent.fields.description).toBe('Lapotop');
    expect(interpretation.transactions[0].sourceAttachmentId).toBe('image-one');
    expect(interpretation.transactions[0].intent.sourceAttachmentId).toBe('image-one');
    expect(interpretation.transactions[0].intent.extraction).toMatchObject({
      imageEvidence: 'TOTAL PHP 1,000.00',
      sourceAttachmentId: 'image-one',
      usedUserText: true,
      usedImageText: true,
      uncertainFields: ['categoryId']
    });
  });

  it('normalizes compact model draft review decisions', () => {
    expect(
      normalizeAdvisorTransactionDraftReviewDecision(
        {
          candidateId: 'draft-1',
          decision: 'approve',
          confidence: 0.93,
          reason: 'Matches the user message.',
          evidenceRefs: ['advisor-message:one']
        },
        'draft-1'
      )
    ).toMatchObject({
      candidateId: 'draft-1',
      decision: 'approve',
      confidence: 0.93,
      reason: 'Matches the user message.',
      evidenceRefs: ['advisor-message:one']
    });
    expect(
      normalizeAdvisorTransactionDraftReviewDecision(
        {
          decision: 'nope',
          blocking_issues: ['Amount came from another row.']
        },
        'draft-2'
      )
    ).toMatchObject({
      candidateId: 'draft-2',
      decision: 'block',
      blockingIssues: ['Amount came from another row.']
    });
    expect(
      normalizeAdvisorTransactionDraftReviewDecision(
        {
          decision: 'go_signal',
          confidence: 0.88,
          reason:
            'Candidate is faithful to the user message, contains only the Wolfgang transaction, and passed deterministic validation.',
          blockingIssues: []
        },
        'draft-3'
      )
    ).toMatchObject({
      candidateId: 'draft-3',
      decision: 'approve',
      confidence: 0.88
    });
    expect(
      normalizeAdvisorTransactionDraftReviewDecision(
        {
          verdict: 'pass',
          reason: 'No blocking issues.'
        },
        'draft-4'
      )
    ).toMatchObject({
      candidateId: 'draft-4',
      decision: 'approve'
    });
    expect(
      normalizeAdvisorTransactionDraftReviewDecision(
        {
          decision: 'approved_with_notes'
        },
        'draft-approval-notes'
      )
    ).toMatchObject({
      candidateId: 'draft-approval-notes',
      decision: 'approve'
    });
    expect(
      normalizeAdvisorTransactionDraftReviewDecision(
        {
          decision: 'not_approved'
        },
        'draft-not-approved'
      )
    ).toMatchObject({
      candidateId: 'draft-not-approved',
      decision: 'block'
    });
    expect(
      normalizeAdvisorTransactionDraftReviewDecision(
        {
          reason: 'Candidate is faithful to the user message and passed deterministic validation.'
        },
        'draft-5'
      )
    ).toMatchObject({
      candidateId: 'draft-5',
      decision: 'approve'
    });
    expect(
      isAdvisorTransactionDraftReviewDecisionUsable(
        {},
        normalizeAdvisorTransactionDraftReviewDecision({}, 'draft-empty')
      )
    ).toBe(false);
    expect(
      isAdvisorTransactionDraftReviewDecisionUsable(
        {
          decision: 'block'
        },
        normalizeAdvisorTransactionDraftReviewDecision({ decision: 'block' }, 'draft-empty-block')
      )
    ).toBe(false);
    expect(
      isAdvisorTransactionDraftReviewDecisionUsable(
        {
          decision: 'block',
          blockingIssues: ['Amount came from another row.']
        },
        normalizeAdvisorTransactionDraftReviewDecision(
          {
            decision: 'block',
            blockingIssues: ['Amount came from another row.']
          },
          'draft-block'
        )
      )
    ).toBe(true);
  });

  it('validates and coerces paid expense drafts from prompt context', () => {
    const validation = validateAdvisorTransactionIntent(
      workbook,
      {
        template: 'expense_charged',
        fields: {
          amount: 150,
          categoryName: 'Transport',
          primaryAccountName: 'Cash'
        },
        confidence: 0.8,
        reason: 'User gave the transaction details.'
      },
      'I charged to Cash for Lalamove transport today for 150 pesos.',
      null,
      {
        currentDate: '2026-06-18'
      }
    );

    expect(validation.ok).toBe(true);
    expect(validation.template).toBe('expense_paid');
    expect(validation.fields).toMatchObject({
      date: '2026-06-18',
      amount: 150,
      categoryId: 'transport',
      primaryAccountId: 'cash',
      counterpartyId: 'lalamove',
      counterpartyName: 'Lalamove'
    });
  });

  it('keeps transfer and currency blockers in domain validation', () => {
    const transfer = validateAdvisorTransactionIntent(workbook, {
      template: 'transfer',
      fields: {
        date: '2026-06-18',
        amount: 500,
        primaryAccountId: 'cash',
        secondaryAccountId: 'cash'
      }
    });
    expect(transfer.ok).toBe(false);
    expect(transfer.missingFields).toContain('secondaryAccountId');

    const usd = validateAdvisorTransactionIntent(workbook, {
      template: 'expense_paid',
      fields: {
        date: '2026-06-18',
        amount: 12,
        currency: 'USD',
        categoryId: 'food',
        primaryAccountId: 'cash'
      }
    });
    expect(usd.ok).toBe(false);
    expect(usd.invalidReasons[0]).toMatch(/USD to PHP rate/);
  });

  it('extracts explicit multi-account transfer drafts without model inference', () => {
    const transferWorkbook = {
      ...workbook,
      accounts: [
        ...workbook.accounts,
        {
          id: 'freedom_fund',
          name: 'Freedom Fund',
          group: 'asset',
          subtype: 'savings',
          isActive: true
        }
      ]
    };
    const prompt =
      'create a transaction I transferred 9000 of my cash to my freedom fund, and i transferred 37000 of my gcash to my freedom fund';
    const results = buildAdvisorExplicitTransferIntentResults(transferWorkbook, prompt, {
      currentDate: '2026-06-21'
    });

    expect(results).toHaveLength(2);
    expect(
      shouldUseAdvisorRulesTransactionIntentResults(transferWorkbook, results, prompt, null, {
        currentDate: '2026-06-21'
      })
    ).toBe(true);
    expect(
      shouldUseAdvisorRulesTransactionIntentResults(
        transferWorkbook,
        [
          {
            prompt: 'create a transaction',
            intent: { template: '', fields: {} }
          }
        ],
        'create a transaction',
        null,
        {
          currentDate: '2026-06-21'
        }
      )
    ).toBe(false);
    expect(results.map((result) => result.intent.template)).toEqual(['transfer', 'transfer']);
    expect(results.map((result) => result.intent.fields.amount)).toEqual([9000, 37000]);
    expect(results.map((result) => result.intent.fields.primaryAccountName)).toEqual([
      'Cash',
      'GCash'
    ]);
    expect(results.map((result) => result.intent.fields.secondaryAccountName)).toEqual([
      'Freedom Fund',
      'Freedom Fund'
    ]);

    const validations = results.map((result) =>
      validateAdvisorTransactionIntent(transferWorkbook, result.intent, result.prompt, null, {
        currentDate: '2026-06-21'
      })
    );
    expect(validations.map((validation) => validation.template)).toEqual(['transfer', 'transfer']);
    expect(validations.map((validation) => validation.fields.amount)).toEqual([9000, 37000]);
    expect(validations.map((validation) => validation.fields.primaryAccountId)).toEqual([
      'cash',
      'gcash'
    ]);
    expect(validations.map((validation) => validation.fields.secondaryAccountId)).toEqual([
      'freedom_fund',
      'freedom_fund'
    ]);
    expect(validations.map((validation) => validation.missingFields)).toEqual([['date'], ['date']]);
  });

  it('resolves transfer amounts from explicit liability balance references', () => {
    const referenceWorkbook = {
      ...workbook,
      accounts: [
        ...workbook.accounts,
        {
          id: 'freedom_fund',
          name: 'Freedom Fund',
          group: 'asset',
          subtype: 'savings',
          isActive: true
        },
        {
          id: 'expense_account',
          name: 'Expense Account',
          group: 'asset',
          subtype: 'checking',
          isActive: true
        },
        {
          id: 'rcbc_card',
          name: 'RCBC Credit Card',
          group: 'liability',
          subtype: 'credit_card',
          isActive: true
        },
        {
          id: 'food_expense',
          name: 'Food Expense',
          group: 'expense',
          subtype: 'expense',
          isActive: true
        }
      ],
      transactions: [
        {
          id: 'txn-card-balance',
          date: '2026-07-01',
          template: 'expense_charged',
          description: 'Current card liability',
          amount: 19807.51,
          lines: [
            {
              id: 'line-food',
              accountId: 'food_expense',
              direction: 'debit',
              amount: 19807.51,
              baseAmount: 19807.51
            },
            {
              id: 'line-card',
              accountId: 'rcbc_card',
              direction: 'credit',
              amount: 19807.51,
              baseAmount: 19807.51
            }
          ]
        }
      ]
    };
    const prompt =
      'move money from my freedom fund to my expense account to match my liabilities today';
    const results = buildAdvisorExplicitTransferIntentResults(referenceWorkbook, prompt, {
      currentDate: '2026-07-01'
    });

    expect(results).toHaveLength(1);
    expect(results[0].intent).toMatchObject({
      template: 'transfer',
      allowUnsupportedAmount: true,
      evidenceSource: 'account_balance_reference',
      fields: {
        date: '2026-07-01',
        amount: 19807.51,
        primaryAccountName: 'Freedom Fund',
        secondaryAccountName: 'Expense Account'
      }
    });
    expect(results[0].intent.sourceRefs).toEqual(['account:rcbc_card']);
    expect(
      shouldUseAdvisorRulesTransactionIntentResults(referenceWorkbook, results, prompt, null, {
        currentDate: '2026-07-01'
      })
    ).toBe(true);

    const validation = validateAdvisorTransactionIntent(
      referenceWorkbook,
      results[0].intent,
      results[0].prompt,
      null,
      {
        currentDate: '2026-07-01'
      }
    );
    expect(validation.ok).toBe(true);
    expect(validation.fields.amount).toBe(19807.51);
    expect(validation.fields.primaryAccountId).toBe('freedom_fund');
    expect(validation.fields.secondaryAccountId).toBe('expense_account');
    expect(validation.allowUnsupportedAmount).toBe(true);
    expect(validation.evidenceSource).toBe('account_balance_reference');
  });

  it('does not allow advisor drafts to post into system fallback accounts', () => {
    const systemWorkbook = {
      ...workbook,
      accounts: [
        {
          id: 'unassigned_cash',
          name: 'Unassigned Cash',
          group: 'asset',
          subtype: 'cash',
          isSystem: true,
          isActive: true
        },
        ...workbook.accounts
      ]
    };

    const destinationValidation = validateAdvisorTransactionIntent(
      systemWorkbook,
      {
        template: 'transfer',
        fields: {
          date: '2026-06-21',
          amount: 37000,
          primaryAccountName: 'GCash',
          secondaryAccountName: 'Unassigned Cash'
        }
      },
      'I sent 37000 from GCash to Unassigned Cash.',
      null,
      {
        currentDate: '2026-06-21'
      }
    );

    expect(destinationValidation.ok).toBe(false);
    expect(destinationValidation.missingFields).toContain('secondaryAccountId');

    const sourceValidation = validateAdvisorTransactionIntent(
      systemWorkbook,
      {
        template: 'transfer',
        fields: {
          date: '2026-06-21',
          amount: 37000,
          primaryAccountName: 'Unassigned Cash',
          secondaryAccountName: 'Savings'
        }
      },
      'I moved 37000 from Unassigned Cash to Savings.',
      null,
      {
        currentDate: '2026-06-21'
      }
    );

    expect(sourceValidation.ok).toBe(false);
    expect(sourceValidation.missingFields).toContain('primaryAccountId');
  });

  it('normalizes person-mediated fee-avoidance flows into net internal transfers', () => {
    const relayWorkbook = {
      ...workbook,
      accounts: [
        {
          id: 'unassigned_cash',
          name: 'Unassigned Cash',
          group: 'asset',
          subtype: 'cash',
          isSystem: true,
          isActive: true
        },
        ...workbook.accounts,
        {
          id: 'freedom_fund',
          name: 'Freedom Fund',
          group: 'asset',
          subtype: 'savings',
          isActive: true
        }
      ],
      categories: [
        ...workbook.categories,
        { id: 'payment_from_friends', name: 'Payment from Friends', type: 'income', isActive: true }
      ]
    };
    const prompt = [
      'i also did something to avoid transaction fees. 2 transactions.',
      'I sent 37000 to my sister on GCash, I also gave 9000 Cash to my Sister.',
      'She then Bank Transferred to my freedom Fund 46000'
    ].join('\n\n');
    const normalized = normalizeAdvisorRelayTransactionIntentResults(
      relayWorkbook,
      [
        {
          prompt: 'I sent 37000 to my sister on GCash',
          intent: {
            template: 'transfer',
            fields: {
              date: '2026-06-21',
              amount: 37000,
              primaryAccountName: 'GCash',
              secondaryAccountName: 'Unassigned Cash'
            }
          }
        },
        {
          prompt: 'I also gave 9000 Cash to my Sister',
          intent: {
            template: 'transfer',
            fields: {
              date: '2026-06-21',
              amount: 9000,
              primaryAccountName: 'Cash',
              secondaryAccountName: 'Unassigned Cash'
            }
          }
        },
        {
          prompt: 'She then Bank Transferred to my freedom Fund 46000',
          intent: {
            template: 'income_received',
            fields: {
              date: '2026-06-21',
              amount: 46000,
              categoryName: 'Payment from Friends',
              primaryAccountName: 'Freedom Fund',
              counterpartyName: 'Unassigned Cash'
            }
          }
        }
      ],
      prompt
    );

    expect(normalized).toHaveLength(2);
    expect(normalized.map((result) => result.intent.template)).toEqual(['transfer', 'transfer']);
    expect(normalized.map((result) => result.intent.fields.amount)).toEqual([37000, 9000]);
    expect(normalized.map((result) => result.intent.fields.primaryAccountName)).toEqual([
      'GCash',
      'Cash'
    ]);
    expect(normalized.map((result) => result.intent.fields.secondaryAccountName)).toEqual([
      'Freedom Fund',
      'Freedom Fund'
    ]);
    expect(JSON.stringify(normalized)).not.toContain('income_received');
    expect(JSON.stringify(normalized)).not.toContain('Unassigned Cash');

    const validations = normalized.map((result) =>
      validateAdvisorTransactionIntent(relayWorkbook, result.intent, result.prompt, null, {
        currentDate: '2026-06-21'
      })
    );
    expect(validations.every((validation) => validation.ok)).toBe(true);
    expect(validations.map((validation) => validation.fields.secondaryAccountId)).toEqual([
      'freedom_fund',
      'freedom_fund'
    ]);
  });

  it('shares template labels and coercion rules with UI callers', () => {
    expect(getAdvisorTransactionTemplateConfig('income_received').primaryLabel).toBe(
      'Received Into'
    );
    expect(advisorTransactionFieldLabel('primaryAccountId', 'expense_charged')).toBe(
      'credit card or loan account'
    );
    expect(
      coerceAdvisorTransactionTemplate(
        workbook,
        'expense_paid',
        {
          primaryAccountName: 'Credit Card'
        },
        'I got charged on my card for food',
        ''
      )
    ).toBe('expense_charged');
  });

  it('validates drafts with simulated category creation', () => {
    const draft = {
      id: 'draft-new-category',
      confidence: 0.9,
      reason: 'User supplied a new category.',
      proposed: {
        template: 'expense_paid',
        createCategoryName: 'Tolls',
        fields: {
          date: '2026-06-18',
          amount: 150,
          primaryAccountId: 'cash'
        }
      },
      source: { prompt: 'I paid 150 cash for tolls today' }
    };
    const validation = buildValidatedAdvisorTransactionDraft(
      workbook,
      draft,
      {
        currentDate: '2026-06-18'
      },
      {
        ensureAdvisorDraftCategory: (targetWorkbook, name, type) => {
          const category = {
            id: 'tolls',
            name,
            type: type === 'income_received' ? 'income' : 'expense',
            isActive: true
          };
          targetWorkbook.categories.push(category);
          return { category, created: true };
        }
      }
    );

    expect(getAiDraftTransactionPrompt(draft)).toBe('I paid 150 cash for tolls today');
    expect(validation.ok).toBe(true);
    expect(validation.fields.categoryId).toBe('tolls');
  });

  it('allows image evidence amounts without guessing missing category or account', () => {
    const readyDraft = {
      id: 'draft-image-ready',
      confidence: 0.82,
      reason: 'Visible receipt details.',
      proposed: {
        template: 'expense_paid',
        evidenceSource: 'image',
        allowUnsupportedAmount: true,
        fields: {
          date: '2026-06-18',
          description: 'Receipt',
          amount: 165,
          currency: 'PHP',
          categoryId: 'food',
          primaryAccountId: 'cash',
          counterpartyName: 'Starbucks'
        }
      },
      source: { prompt: 'Create transaction draft from this image.' }
    };
    expect(
      buildValidatedAdvisorTransactionDraft(workbook, readyDraft, {
        currentDate: '2026-06-19'
      }).ok
    ).toBe(true);

    const missingDraft = {
      id: 'draft-image-missing',
      confidence: 0.7,
      proposed: {
        template: 'expense_paid',
        evidenceSource: 'image',
        allowUnsupportedAmount: true,
        fields: {
          date: '',
          description: 'Receipt',
          amount: 165,
          currency: 'PHP'
        }
      },
      source: { prompt: 'Create transaction draft from this image.' }
    };
    const validation = buildValidatedAdvisorTransactionDraft(workbook, missingDraft, {
      currentDate: '2026-06-19',
      allowNeedsFix: true
    });

    expect(validation.ok).toBe(false);
    expect(validation.missingFields).toEqual(
      expect.arrayContaining(['date', 'categoryId', 'primaryAccountId'])
    );
    expect(validation.fields.amount).toBe(165);
  });

  it('applies transaction drafts through supplied posting services', () => {
    const targetWorkbook = JSON.parse(
      JSON.stringify({
        ...workbook,
        categories: workbook.categories.filter((category) => category.id !== 'transport'),
        transactions: []
      })
    );
    const draft = {
      id: 'draft-apply',
      operation: 'create',
      confidence: 0.9,
      proposed: {
        template: 'expense_paid',
        createCategoryName: 'Transport',
        fields: {
          date: '2026-06-18',
          amount: 150,
          primaryAccountId: 'cash'
        }
      },
      source: { prompt: 'I paid 150 cash for transport today' }
    };
    const result = applyTransactionAiDraftMutation(
      targetWorkbook,
      draft,
      {
        ensureAdvisorDraftCategory: (sourceWorkbook, name, type) => {
          const category = {
            id: 'transport',
            name,
            type: type === 'income_received' ? 'income' : 'expense',
            isActive: true
          };
          sourceWorkbook.categories.push(category);
          return { category, created: true };
        },
        createLedgerTransactionFromValidation: (sourceWorkbook, validation, sourceOptions) => {
          sourceWorkbook.transactions.push({
            id: 'txn-posted',
            template: validation.template,
            categoryId: validation.fields.categoryId,
            amount: validation.fields.amount,
            reference: sourceOptions.reference
          });
          return 'txn-posted';
        }
      },
      { currentDate: '2026-06-18' }
    );

    expect(result).toBe('txn-posted');
    expect(targetWorkbook.transactions[0]).toMatchObject({
      categoryId: 'transport',
      reference: 'advisor:draft:draft-apply'
    });
  });

  it('does not repost duplicate transaction drafts', () => {
    const targetWorkbook = {
      ...workbook,
      transactions: [{ id: 'txn-existing', reference: 'advisor:draft:draft-existing' }]
    };
    let posted = false;
    const result = applyTransactionAiDraftMutation(
      targetWorkbook,
      {
        id: 'draft-existing',
        operation: 'create',
        proposed: { template: 'expense_paid', fields: {} }
      },
      {
        createLedgerTransactionFromValidation: () => {
          posted = true;
          return 'txn-new';
        }
      }
    );

    expect(result).toBe('txn-existing');
    expect(posted).toBe(false);
  });

  it('applies recurring-link edit drafts without posting a transaction', () => {
    const targetWorkbook = {
      ...workbook,
      recurringItems: [{ id: 'recurring-load' }],
      transactions: [{ id: 'txn-one' }, { id: 'txn-two' }]
    };
    const result = applyTransactionAiDraftMutation(
      targetWorkbook,
      {
        id: 'draft-recurring',
        operation: 'edit',
        proposed: {
          recurringItemId: 'recurring-load',
          transactionIds: ['txn-one', 'txn-two']
        }
      },
      {}
    );

    expect(result).toBe('txn-one,txn-two');
    expect(targetWorkbook.transactions.map((transaction) => transaction.recurringItemId)).toEqual([
      'recurring-load',
      'recurring-load'
    ]);
  });

  it('applies reviewed transaction edit and delete drafts', () => {
    const targetWorkbook = {
      ...workbook,
      transactions: [
        { id: 'txn-one', template: 'expense_paid', amount: 150, reference: '', source: 'manual' },
        { id: 'txn-two', template: 'expense_paid', amount: 75, reference: '', source: 'manual' }
      ]
    };

    const editResult = applyTransactionAiDraftMutation(
      targetWorkbook,
      {
        id: 'draft-edit',
        operation: 'edit',
        objectType: 'transaction',
        targetId: 'txn-one',
        proposed: {
          fields: {
            date: '2026-06-18',
            template: 'expense_paid',
            amount: 200,
            currency: 'PHP',
            categoryId: 'food',
            primaryAccountId: 'cash'
          }
        }
      },
      {
        buildLedgerTransactionFromDraftFields: (_sourceWorkbook, fields, existingTransaction) => ({
          ...existingTransaction,
          amount: fields.amount,
          categoryId: fields.categoryId
        })
      }
    );

    expect(editResult).toBe('txn-one');
    expect(targetWorkbook.transactions[0]).toMatchObject({
      id: 'txn-one',
      amount: 200,
      categoryId: 'food'
    });

    const deleteResult = applyTransactionAiDraftMutation(
      targetWorkbook,
      {
        id: 'draft-delete',
        operation: 'delete',
        objectType: 'transaction',
        targetId: 'txn-two',
        proposed: { transactionId: 'txn-two' }
      },
      {}
    );

    expect(deleteResult).toBe('txn-two');
    expect(targetWorkbook.transactions.map((transaction) => transaction.id)).toEqual(['txn-one']);
  });
});
