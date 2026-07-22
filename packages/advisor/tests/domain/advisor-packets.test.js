// Tests for Advisor packet builders.

import { describe, expect, it } from 'vitest';
import {
  advisorPacketSourceRef,
  buildAdvisorAccountSnapshotPacket,
  buildAdvisorBrainContextPacket,
  buildAdvisorCategorizationReviewPacket,
  buildAdvisorCategoryInventoryPacket,
  buildAdvisorNetWorthImpactPacket,
  buildAdvisorFullWorkbookPacket,
  buildAdvisorTransactionAnalysisPacket,
  buildAdvisorTransactionImageIntentPacket,
  buildAdvisorTransactionListPacket,
  buildAdvisorTransactionTextIntentPacket,
  countAdvisorDuplicateLabels,
  getAdvisorReviewableCategorizationTransactions,
  getAdvisorTransactionImpactRow,
  getAdvisorTransactionListMode,
  getAdvisorTransactionListRow,
  getLedgerCleanupSourceRefsFromPayload,
  isAdvisorCategorizationVagueCategory
} from '@cavalry/advisor/domain/advisor/packets.js';

function makeWorkbook() {
  return {
    id: 'workbook-one',
    name: 'The Plan',
    year: 2026,
    currency: 'PHP',
    accounts: [
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'wallet',
        currency: 'PHP',
        isActive: true
      },
      { id: 'card', name: 'Card', group: 'liability', currency: 'PHP', isActive: false },
      {
        id: 'food-account',
        name: 'Food Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'salary-account',
        name: 'Salary Income',
        group: 'income',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'food-account',
        isActive: true
      },
      {
        id: 'salary',
        name: 'Salary',
        type: 'income',
        currency: 'PHP',
        linkedAccountId: 'salary-account',
        isActive: true
      },
      {
        id: 'transport',
        name: 'Transport',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: '',
        isActive: true
      },
      {
        id: 'old-debt',
        name: 'Old Debt',
        type: 'debt',
        currency: 'PHP',
        linkedAccountId: '',
        isActive: false
      }
    ],
    counterparties: [{ id: 'store', name: 'Store', kind: 'merchant', isActive: true }],
    transactions: [
      {
        id: 'txn-one',
        date: '2026-06-18',
        template: 'expense_paid',
        description: 'Lunch',
        categoryId: 'food',
        counterpartyId: 'store',
        recurringItemId: 'recurring-one',
        amount: 150,
        baseAmount: 150,
        originalCurrency: 'PHP',
        source: 'advisor',
        reference: 'advisor:draft:draft-one',
        note: 'With receipt',
        lines: [
          {
            id: 'txn-one-debit',
            accountId: 'food-account',
            direction: 'debit',
            amount: 150,
            currency: 'PHP',
            baseAmount: 150
          },
          {
            id: 'txn-one-credit',
            accountId: 'cash',
            direction: 'credit',
            amount: 150,
            currency: 'PHP',
            baseAmount: 150
          }
        ]
      },
      {
        id: 'txn-income',
        date: '2026-06-19',
        template: 'income_received',
        description: 'Salary',
        categoryId: 'salary',
        counterpartyId: '',
        recurringItemId: '',
        amount: 1000,
        baseAmount: 1000,
        originalCurrency: 'PHP',
        source: 'manual',
        reference: '',
        note: '',
        lines: [
          {
            id: 'txn-income-debit',
            accountId: 'cash',
            direction: 'debit',
            amount: 1000,
            currency: 'PHP',
            baseAmount: 1000
          },
          {
            id: 'txn-income-credit',
            accountId: 'salary-account',
            direction: 'credit',
            amount: 1000,
            currency: 'PHP',
            baseAmount: 1000
          }
        ]
      },
      {
        id: 'txn-transfer',
        date: '2026-06-17',
        template: 'transfer',
        description: 'Move cash',
        categoryId: '',
        counterpartyId: '',
        recurringItemId: '',
        amount: 75,
        baseAmount: 75,
        originalCurrency: 'PHP',
        source: 'manual',
        reference: '',
        note: '',
        lines: [
          {
            id: 'txn-transfer-debit',
            accountId: 'card',
            direction: 'debit',
            amount: 75,
            currency: 'PHP',
            baseAmount: 75
          },
          {
            id: 'txn-transfer-credit',
            accountId: 'cash',
            direction: 'credit',
            amount: 75,
            currency: 'PHP',
            baseAmount: 75
          }
        ]
      }
    ],
    recurringItems: [
      {
        id: 'recurring-one',
        kind: 'subscription',
        name: 'Lunch plan',
        categoryId: 'food',
        counterpartyId: 'store',
        accountId: 'cash',
        amount: 150,
        currency: 'PHP',
        frequency: 'monthly',
        anchorDate: '2026-06-18',
        autoRenew: true,
        isActive: true,
        note: 'Test recurring'
      }
    ],
    sheets: [
      {
        id: 'sheet-june',
        name: 'June',
        monthIndex: 5,
        notes: 'Budget month',
        budgets: [{ categoryId: 'food', planned: 2000 }],
        budgetLineItems: [
          {
            id: 'line-food',
            name: 'Food line',
            categoryId: 'food',
            planned: 2000,
            currency: 'PHP',
            dueDate: '2026-06-30',
            recurringItemId: 'recurring-one'
          }
        ]
      }
    ],
    aiDrafts: [
      {
        id: 'draft-one',
        status: 'pending',
        operation: 'create',
        objectType: 'transaction',
        title: 'Lunch',
        sourceRefs: ['transaction:txn-one']
      }
    ]
  };
}

describe('advisor packet builders', () => {
  it('builds stable source refs', () => {
    expect(advisorPacketSourceRef('transaction', 'txn-one')).toBe('transaction:txn-one');
    expect(advisorPacketSourceRef('workbook', '')).toBe('workbook:unknown');
  });

  it('serializes the full workbook packet without renderer dependencies', () => {
    const packet = buildAdvisorFullWorkbookPacket(makeWorkbook());

    expect(packet.packet_version).toBe('cavalry.workbook.structured.v1');
    expect(packet.workbook).toMatchObject({
      id: 'workbook-one',
      name: 'The Plan',
      currency: 'PHP',
      source_ref: 'workbook:workbook-one'
    });
    expect(packet.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'cash', source_ref: 'account:cash', isActive: true }),
        expect.objectContaining({ id: 'card', source_ref: 'account:card', isActive: false })
      ])
    );
    expect(packet.transactions[0]).toMatchObject({
      id: 'txn-one',
      categoryId: 'food',
      counterpartyId: 'store',
      source_ref: 'transaction:txn-one'
    });
    expect(packet.recurring_items[0]).toMatchObject({
      id: 'recurring-one',
      autoRenew: true,
      source_ref: 'recurringItem:recurring-one'
    });
    expect(packet.budgets[0].budgets[0]).toMatchObject({
      categoryId: 'food',
      source_ref: 'budget:sheet-june:food'
    });
    expect(packet.budgets[0].budgetLineItems[0]).toMatchObject({
      id: 'line-food',
      source_ref: 'budgetLineItem:line-food'
    });
    expect(packet.ai_drafts[0]).toMatchObject({
      id: 'draft-one',
      source_refs: ['transaction:txn-one'],
      source_ref: 'aiDraft:draft-one'
    });
  });

  it('builds account snapshot packets with balances and source refs', () => {
    const workbook = makeWorkbook();
    workbook.accounts.find((account) => account.id === 'card').isActive = false;
    const packet = buildAdvisorAccountSnapshotPacket(workbook, { asOfDate: '2026-06-19' });

    expect(packet.packet_version).toBe('cavalry.account_snapshot.v1');
    expect(packet.selection.policy).toBe('active_asset_liability_accounts_plus_archived_nonzero');
    expect(packet.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account_id: 'cash',
          name: 'Cash',
          group: 'asset',
          balance: '775.00',
          source_ref: 'account:cash'
        }),
        expect.objectContaining({
          account_id: 'card',
          group: 'liability',
          is_active: false,
          balance: '-75.00',
          source_refs: ['account:card']
        })
      ])
    );
    expect(packet.accounts.map((account) => account.account_id)).not.toContain('food-account');
    expect(JSON.stringify(packet)).not.toContain('With receipt');
  });

  it('builds a full category inventory including zero-use and archived categories', () => {
    const packet = buildAdvisorCategoryInventoryPacket(makeWorkbook(), {
      profile: {
        rangeStart: '2026-06-18',
        rangeEnd: '2026-06-19',
        rangeLabel: 'June 18 - 19, 2026',
        currency: 'PHP'
      }
    });

    expect(packet.packet_version).toBe('cavalry.category_inventory.v1');
    expect(packet.selection).toMatchObject({
      policy: 'full_category_inventory',
      source_count: 4,
      included_count: 4,
      omitted_count: 0
    });
    expect(packet.counts).toMatchObject({
      categories_total: 4,
      active_categories: 3,
      archived_categories: 1,
      selected_period_categories_without_transactions: 2
    });
    expect(packet.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category_id: 'food',
          name: 'Food',
          selected_period_transaction_count: 1,
          selected_period_amount: '150.00',
          source_ref: 'category:food'
        }),
        expect.objectContaining({
          category_id: 'transport',
          name: 'Transport',
          selected_period_transaction_count: 0,
          selected_period_amount: '0.00',
          source_ref: 'category:transport'
        }),
        expect.objectContaining({
          category_id: 'old-debt',
          name: 'Old Debt',
          is_active: false,
          source_refs: ['category:old-debt']
        })
      ])
    );
  });

  it('formats transfer transaction list rows with source and destination accounts', () => {
    const row = getAdvisorTransactionListRow(
      makeWorkbook(),
      makeWorkbook().transactions.find((transaction) => transaction.id === 'txn-transfer')
    );

    expect(row).toMatchObject({
      template: 'transfer',
      category_name: 'Transfer',
      account_label: 'Cash -> Card'
    });
  });

  it('does not treat last two weeks as a latest-transaction list request', () => {
    expect(getAdvisorTransactionListMode('show my latest transaction')).toBe('last');
    expect(getAdvisorTransactionListMode('show my transactions for the last 2 weeks')).toBe('full');
  });

  it('marks system accounts as non-postable in workbook context', () => {
    const workbook = makeWorkbook();
    workbook.accounts.push({
      id: 'unassigned-cash',
      name: 'Unassigned Cash',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      isSystem: true,
      isActive: true
    });

    const packet = buildAdvisorFullWorkbookPacket(workbook);

    expect(packet.accounts.find((account) => account.id === 'cash')).toMatchObject({
      isSystem: false,
      canUseInTransactionDraft: true
    });
    expect(packet.accounts.find((account) => account.id === 'unassigned-cash')).toMatchObject({
      isSystem: true,
      canUseInTransactionDraft: false
    });
  });

  it('builds compact, targeted, and full Advisor Brain context packets', () => {
    const workbook = makeWorkbook();
    for (let index = 0; index < 30; index += 1) {
      workbook.transactions.push({
        id: 'txn-history-' + String(index),
        date: '2026-06-' + String((index % 20) + 1).padStart(2, '0'),
        template: 'expense_paid',
        description: index % 2 ? 'Store groceries' : 'Other history',
        categoryId: 'food',
        counterpartyId: index % 2 ? 'store' : '',
        amount: 100 + index,
        lines: [
          {
            id: 'txn-history-' + String(index) + '-debit',
            accountId: 'food-account',
            direction: 'debit',
            amount: 100 + index,
            baseAmount: 100 + index
          },
          {
            id: 'txn-history-' + String(index) + '-credit',
            accountId: 'cash',
            direction: 'credit',
            amount: 100 + index,
            baseAmount: 100 + index
          }
        ]
      });
    }

    const compact = buildAdvisorBrainContextPacket(workbook, 'delete the Store transaction', {
      currentDate: '2026-06-21'
    });
    const targeted = buildAdvisorBrainContextPacket(workbook, 'edit the Store transaction', {
      contextRequests: [{ kind: 'transactions', query: 'Store', limit: 10 }],
      currentDate: '2026-06-21'
    });
    const full = buildAdvisorBrainContextPacket(
      workbook,
      'review the whole workbook and prepare cleanup drafts',
      {
        contextMode: 'full',
        currentDate: '2026-06-21'
      }
    );

    expect(compact.packet_version).toBe('cavalry.advisor_brain.context.v1');
    expect(compact.intent).toBe('advisor_brain');
    expect(compact.context_mode).toBe('compact');
    expect(compact.full_workbook).toBeUndefined();
    expect(compact.workbook_map.recent_transactions).toHaveLength(6);
    expect(JSON.stringify(compact)).not.toContain('txn-history-0');

    expect(targeted.context_mode).toBe('targeted');
    expect(targeted.targeted_context.transactions.length).toBeLessThanOrEqual(12);
    expect(targeted.targeted_context.transactions[0].description).toMatch(/Store|Lunch/);
    expect(targeted.full_workbook).toBeUndefined();

    expect(full.context_mode).toBe('full');
    expect(full.full_workbook.transactions).toHaveLength(workbook.transactions.length);
    expect(full.targeted_context).toBeUndefined();
  });

  it('builds image transaction intent packets without embedding base64 image data', () => {
    const workbook = makeWorkbook();
    workbook.accounts.push({
      id: 'unassigned-cash',
      name: 'Unassigned Cash',
      group: 'asset',
      subtype: 'cash',
      currency: 'PHP',
      isSystem: true,
      isActive: true
    });
    const packet = buildAdvisorTransactionImageIntentPacket(
      workbook,
      '',
      [
        {
          id: 'image-one',
          filename: 'receipt.jpg',
          mimeType: 'image/jpeg',
          size: 1200,
          width: 900,
          height: 1200,
          dataUrl: 'data:image/jpeg;base64,abc'
        }
      ],
      {
        currentDate: '2026-06-19'
      }
    );

    expect(packet.packet_version).toBe('cavalry.transaction_image_intent.v1');
    expect(packet.intake_mode).toBe('transaction_image_intake');
    expect(packet.current_date).toBe('2026-06-19');
    expect(packet.max_transactions).toBe(8);
    expect(packet.user_message).toBe('Create transaction draft from this image.');
    expect(packet.workbook_context).toMatchObject({
      workbook: {
        id: 'workbook-one',
        name: 'The Plan',
        currency: 'PHP',
        source_ref: 'workbook:workbook-one'
      },
      data_policy: expect.stringContaining('intentionally omitted')
    });
    expect(packet.workbook_context.transactions).toBeUndefined();
    expect(packet.workbook_context.budgets).toBeUndefined();
    expect(packet.workbook_context.recurring_items).toBeUndefined();
    expect(packet.workbook_context.ai_drafts).toBeUndefined();
    expect(packet.output_schema.transactions[0].missing_fields).toEqual(['field name']);
    expect(packet.image_attachments).toEqual([
      {
        id: 'image-one',
        filename: 'receipt.jpg',
        mimeType: 'image/jpeg',
        size: 1200,
        width: 900,
        height: 1200,
        modelWidth: 900,
        modelHeight: 1200,
        modelQuality: 0.92,
        modelMaxEdge: 1536
      }
    ]);
    expect(packet.output_schema.transactions[0].extraction).toMatchObject({
      imageEvidence: expect.any(String),
      sourceAttachmentId: expect.any(String),
      usedUserText: expect.any(String),
      usedImageText: expect.any(String),
      uncertainFields: ['field name']
    });
    expect(packet.output_schema.transactions[0].sourceAttachmentId).toContain('image_attachments');
    expect(packet.rules.join(' ')).toContain('grand total');
    expect(packet.rules.join(' ')).toContain('sourceAttachmentId');
    expect(packet.rules.join(' ')).toContain('Total Sales');
    expect(packet.rules.join(' ')).toContain('PAYMAYA');
    expect(packet.rules.join(' ')).toContain('Do not extract line items');
    expect(packet.accounts.map((account) => account.id)).toEqual(['cash']);
    expect(packet.accounts[0]).toMatchObject({
      id: 'cash',
      canUseInTransactionDraft: true
    });
    expect(JSON.stringify(packet)).not.toContain('base64');
    expect(JSON.stringify(packet)).not.toContain('txn-one');
    expect(JSON.stringify(packet)).not.toContain('recurring-one');
    expect(JSON.stringify(packet)).not.toContain('sheet-june');
    expect(JSON.stringify(packet.accounts)).not.toContain('unassigned-cash');
  });

  it('builds lightweight text transaction intent packets without workbook history', () => {
    const workbook = makeWorkbook();
    workbook.accounts.push(
      {
        id: 'freedom-fund',
        name: 'Freedom Fund',
        group: 'asset',
        subtype: 'savings',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'unassigned-cash',
        name: 'Unassigned Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      }
    );
    for (let index = 0; index < 80; index += 1) {
      workbook.transactions.push({
        id: 'txn-history-' + String(index),
        date: '2026-06-01',
        template: 'expense_paid',
        description: 'History ' + String(index),
        amount: index + 1,
        lines: []
      });
    }

    const packet = buildAdvisorTransactionTextIntentPacket(
      workbook,
      'transferred 9000 of my cash to my freedom fund',
      null,
      {
        currentDate: '2026-06-21'
      }
    );
    const json = JSON.stringify(packet);

    expect(packet.packet_version).toBe('cavalry.transaction_intent.v4');
    expect(packet.intake_schema_version).toBe('cavalry.transaction_intake_interpretation.v2');
    expect(packet.intake_mode).toBe('transaction_text_intake');
    expect(packet.current_date).toBe('2026-06-21');
    expect(packet.output_schema).toMatchObject({
      route:
        'new_transaction_batch | update_pending_draft | clarification | cancel | not_transaction',
      usePendingDraft:
        'boolean; true only when the user is clearly modifying the supplied pending_draft'
    });
    expect(packet.lookup_scope).toMatchObject({
      mode: 'focused_candidates'
    });
    expect(packet.prepared_transaction_rows).toEqual([]);
    expect(packet.preflight_hints.amountMentions.map((mention) => mention.amount)).toEqual([9000]);
    expect(packet.preflight_hints.workbookVocab.accounts.map((account) => account.id)).toEqual([
      'cash',
      'freedom-fund'
    ]);
    expect(packet.rules.join(' ')).toContain('pending_draft');
    expect(packet.rules.join(' ')).toContain('Model-first segmentation');
    expect(packet.output_schema.transactions[0].fieldEvidence.amount).toContain('amount');
    expect(packet.output_schema.transactions[0].missingFields).toEqual([
      'field name such as amount, date, primaryAccountId, categoryId'
    ]);
    expect(packet.local_parser_hints).toEqual([]);
    expect(packet.workbook_context.data_policy).toContain('intentionally omitted');
    expect(packet.workbook_context.transactions).toBeUndefined();
    expect(packet.workbook_context.budgets).toBeUndefined();
    expect(packet.workbook_context.recurring_items).toBeUndefined();
    expect(packet.workbook_context.ai_drafts).toBeUndefined();
    expect(packet.history_context).toMatchObject({
      included: false,
      reason: 'not_requested',
      transactions: []
    });
    expect(packet.accounts.map((account) => account.id)).toEqual(['cash', 'freedom-fund']);
    expect(json).not.toContain('txn-history-');
    expect(json).not.toContain('sheet-june');
    expect(json).not.toContain('recurring-one');
    expect(json).not.toContain('draft-one');
    expect(json.length).toBeLessThan(10500);
  });

  it('prepares row-bound transaction evidence and focused lookup candidates for model intake', () => {
    const workbook = makeWorkbook();
    workbook.accounts.push(
      {
        id: 'rcbc-card',
        name: 'RCBC Credit Card',
        group: 'liability',
        subtype: 'credit card',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'savings',
        name: 'Savings',
        group: 'asset',
        subtype: 'savings',
        currency: 'PHP',
        isActive: true
      }
    );
    for (let index = 0; index < 40; index += 1) {
      workbook.accounts.push({
        id: 'extra-account-' + String(index),
        name: 'Extra Account ' + String(index),
        group: 'asset',
        subtype: 'wallet',
        currency: 'PHP',
        isActive: true
      });
      workbook.categories.push({
        id: 'extra-category-' + String(index),
        name: 'Extra Category ' + String(index),
        type: 'expense',
        currency: 'PHP',
        isActive: true
      });
      workbook.counterparties.push({
        id: 'extra-counterparty-' + String(index),
        name: 'Extra Counterparty ' + String(index),
        kind: 'merchant',
        isActive: true
      });
    }
    workbook.categories.push({
      id: 'subscriptions',
      name: 'Subscriptions',
      type: 'expense',
      currency: 'PHP',
      isActive: true
    });
    workbook.counterparties.push({
      id: 'vercel',
      name: 'Vercel',
      kind: 'merchant',
      isActive: true
    });

    const prompt = [
      'post these transactions:',
      'add these',
      '',
      'Jun 23 - Wolfgang food - 9199 - RCBC Credit Card',
      'Jun 24 - Vercel - 20$ - RCBC CREDIT CARD'
    ].join('\n');
    const packet = buildAdvisorTransactionTextIntentPacket(workbook, prompt, null, {
      currentDate: '2026-06-25'
    });
    const json = JSON.stringify(packet);

    expect(packet.max_transactions).toBe(20);
    expect(packet.prepared_transaction_rows).toHaveLength(2);
    expect(packet.prepared_transaction_rows[0]).toMatchObject({
      sourceText: 'Jun 23 - Wolfgang food - 9199 - RCBC Credit Card',
      evidence: {
        date: '2026-06-23',
        amount: 9199,
        primaryAccountName: 'RCBC Credit Card',
        counterpartyName: 'Wolfgang'
      }
    });
    expect(packet.prepared_transaction_rows[1]).toMatchObject({
      sourceText: 'Jun 24 - Vercel - 20$ - RCBC CREDIT CARD',
      evidence: {
        date: '2026-06-24',
        amount: 20,
        currency: 'USD',
        primaryAccountName: 'RCBC CREDIT CARD',
        counterpartyName: 'Vercel'
      }
    });
    expect(packet.accounts.map((account) => account.id)).toContain('rcbc-card');
    expect(packet.counterparties.map((counterparty) => counterparty.id)).toContain('vercel');
    expect(packet.accounts.length).toBeLessThanOrEqual(16);
    expect(packet.categories.length).toBeLessThanOrEqual(24);
    expect(packet.counterparties.length).toBeLessThanOrEqual(16);
    expect(packet.lookup_scope.workbook_counts.accounts).toBeGreaterThan(packet.accounts.length);
    expect(json).not.toContain('extra-account-39');
    expect(json.length).toBeLessThan(15000);
  });

  it('includes all rows from a 15-row pasted transaction batch in text intake evidence', () => {
    const workbook = makeWorkbook();
    workbook.accounts.push(
      {
        id: 'gcash',
        name: 'GCash',
        group: 'asset',
        subtype: 'wallet',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'savings',
        name: 'Savings',
        group: 'asset',
        subtype: 'savings',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'credit-card',
        name: 'Credit Card',
        group: 'liability',
        subtype: 'credit card',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'rcbc-card',
        name: 'RCBC Credit Card',
        group: 'liability',
        subtype: 'credit card',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'bpi-bank',
        name: 'BPI Bank',
        group: 'asset',
        subtype: 'checking',
        currency: 'PHP',
        isActive: true
      }
    );
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
    const packet = buildAdvisorTransactionTextIntentPacket(workbook, prompt, null, {
      currentDate: '2026-06-26',
      defaultDateForUndatedRows: true
    });

    expect(packet.max_transactions).toBe(20);
    expect(packet.prepared_transaction_rows).toHaveLength(15);
    expect(packet.prepared_transaction_rows.map((row) => row.evidence.amount)).toEqual([
      245, 1200, 85, 15000, 799, 350, 2450, 500, 5000, 1850, 320, 1500, 10000, 450, 899
    ]);
    expect(packet.prepared_transaction_rows[14].sourceText).toBe(
      '899 pesos Netflx subscripton - RCBC Credit Card'
    );
  });

  it('includes local parser hints as non-authoritative text intake context', () => {
    const packet = buildAdvisorTransactionTextIntentPacket(
      makeWorkbook(),
      'Also add these: 1000 ballpen',
      null,
      {
        currentDate: '2026-06-21',
        localHints: [
          {
            prompt: '1000 pesos bought ballpen using card',
            intent: {
              template: 'expense_charged',
              reason: 'Rules hint',
              fields: {
                amount: 1000,
                description: 'ballpen',
                primaryAccountName: 'Credit Card'
              }
            }
          }
        ]
      }
    );

    expect(packet.local_parser_hints).toEqual([
      expect.objectContaining({
        sourceText: '1000 pesos bought ballpen using card',
        template: 'expense_charged',
        reason: 'Rules hint',
        fields: expect.objectContaining({
          amount: 1000,
          description: 'ballpen'
        })
      })
    ]);
  });

  it('includes only a small recent matching history sample when text prompts ask for it', () => {
    const workbook = makeWorkbook();
    for (let index = 0; index < 12; index += 1) {
      workbook.transactions.push({
        id: 'txn-store-' + String(index),
        date: '2026-06-' + String(10 + index).padStart(2, '0'),
        template: 'expense_paid',
        description: 'Store groceries',
        categoryId: 'food',
        counterpartyId: 'store',
        recurringItemId: '',
        amount: 100 + index,
        baseAmount: 100 + index,
        originalCurrency: 'PHP',
        source: 'manual',
        reference: '',
        note: '',
        lines: [
          {
            id: 'txn-store-' + String(index) + '-debit',
            accountId: 'food-account',
            direction: 'debit',
            amount: 100 + index,
            currency: 'PHP',
            baseAmount: 100 + index
          },
          {
            id: 'txn-store-' + String(index) + '-credit',
            accountId: 'cash',
            direction: 'credit',
            amount: 100 + index,
            currency: 'PHP',
            baseAmount: 100 + index
          }
        ]
      });
    }
    for (let index = 0; index < 40; index += 1) {
      workbook.transactions.push({
        id: 'txn-history-' + String(index),
        date: '2026-05-01',
        template: 'income_received',
        description: 'Unrelated income ' + String(index),
        amount: index + 1,
        lines: []
      });
    }

    const packet = buildAdvisorTransactionTextIntentPacket(
      workbook,
      'Create this like last time at Store for 180 today',
      null,
      {
        currentDate: '2026-06-21'
      }
    );
    const ids = packet.history_context.transactions.map((transaction) => transaction.id);
    const json = JSON.stringify(packet);

    expect(packet.history_context).toMatchObject({
      included: true,
      reason: 'prompt_requested_history',
      policy: 'recent_matching_transactions',
      match_mode: 'token_match',
      max_transactions: 8
    });
    expect(ids).toHaveLength(8);
    expect(ids[0]).toBe('txn-store-11');
    expect(ids).toContain('txn-store-10');
    expect(ids).not.toContain('txn-income');
    expect(ids).not.toContain('txn-history-0');
    expect(packet.history_context.transactions[0]).toMatchObject({
      categoryName: 'Food',
      counterpartyName: 'Store',
      primaryAccountName: 'Cash',
      account_names: ['Cash']
    });
    expect(packet.workbook_context.transactions).toBeUndefined();
    expect(packet.workbook_context.budgets).toBeUndefined();
    expect(packet.workbook_context.recurring_items).toBeUndefined();
    expect(packet.workbook_context.ai_drafts).toBeUndefined();
    expect(json).not.toContain('txn-history-');
    expect(json).not.toContain('sheet-june');
    expect(json).not.toContain('recurring-one');
    expect(json).not.toContain('draft-one');
    expect(json.length).toBeLessThan(14000);
  });

  it('collects unique source refs from cleanup payloads', () => {
    const refs = getLedgerCleanupSourceRefsFromPayload({
      transactionPatches: [
        { transactionId: 'txn-one' },
        { transactionId: 'txn-one' },
        { transactionId: 'txn-two' }
      ],
      categoryChanges: [
        { categoryId: 'food', replacementCategoryId: 'dining' },
        { targetCategoryId: 'misc', replacementCategoryId: 'dining' }
      ],
      counterpartyChanges: [
        { counterpartyId: 'store', replacementCounterpartyId: 'market' },
        { targetCounterpartyId: 'store' }
      ]
    });

    expect(refs).toEqual([
      'transaction:txn-one',
      'transaction:txn-two',
      'category:food',
      'category:dining',
      'category:misc',
      'counterparty:store',
      'counterparty:market'
    ]);
  });

  it('builds categorization review packets from domain review signals', () => {
    const workbook = makeWorkbook();
    workbook.categories.push(
      { id: 'misc', name: 'Misc', type: 'expense', currency: 'PHP', isActive: true },
      { id: 'food-copy', name: 'Food', type: 'expense', currency: 'PHP', isActive: true }
    );
    workbook.counterparties.push({
      id: 'store-copy',
      name: 'Store',
      kind: 'merchant',
      isActive: true
    });
    workbook.transactions.push(
      {
        id: 'txn-misc',
        date: '2026-06-16',
        template: 'expense_paid',
        description: 'Coffee',
        categoryId: 'misc',
        amount: 75,
        baseAmount: 75,
        originalCurrency: 'PHP',
        lines: []
      },
      {
        id: 'txn-missing',
        date: '2026-06-15',
        template: 'expense_paid',
        description: 'Unknown purchase',
        categoryId: '',
        amount: 20,
        baseAmount: 20,
        originalCurrency: 'PHP',
        lines: []
      }
    );
    const services = {
      buildAdvisorCleanupSuggestionPacketRows: () => [
        {
          kind: 'category',
          title: 'Rename Misc',
          detail: 'Misc can become Needs Review.',
          source_refs: ['category:misc']
        }
      ],
      buildLocalAdvisorLedgerCleanupProposal: () => ({
        categoryChanges: [
          { action: 'rename', categoryId: 'misc', name: 'Needs Review', type: 'expense' }
        ],
        counterpartyChanges: [
          { action: 'merge', counterpartyId: 'store-copy', replacementCounterpartyId: 'store' }
        ],
        transactionPatches: [{ transactionId: 'txn-misc', categoryId: 'food' }]
      }),
      formatVisibleDateRangeLabel: () => 'June 2026',
      getAdvisorLedgerCleanupRange: () => ({ start: '2026-06-01', end: '2026-06-30' }),
      getTransactionBaseAmount: (transaction) => Number(transaction.baseAmount || 0),
      transactionIsInDateRange: (transaction, range) =>
        transaction.date >= range.start && transaction.date <= range.end
    };

    expect(
      isAdvisorCategorizationVagueCategory(
        workbook.categories.find((category) => category.id === 'misc')
      )
    ).toBe(true);
    expect(
      countAdvisorDuplicateLabels(
        workbook.categories,
        (category) => String(category.type || '') + ':' + String(category.name || '').toLowerCase()
      )
    ).toEqual([{ label: 'expense:food', count: 2, names: ['Food', 'Food'] }]);

    const reviewable = getAdvisorReviewableCategorizationTransactions(
      workbook,
      'review categories',
      services
    );
    expect(reviewable.map((transaction) => transaction.id)).toEqual([
      'txn-transfer',
      'txn-misc',
      'txn-missing'
    ]);

    const packet = buildAdvisorCategorizationReviewPacket(
      workbook,
      {
        profile: {
          rangeStart: '2026-06-01',
          rangeEnd: '2026-06-30',
          rangeLabel: 'June 2026'
        }
      },
      'review categories',
      services
    );
    expect(packet.packet_version).toBe('cavalry.categorization_review.v1');
    expect(packet.period).toEqual({ start: '2026-06-01', end: '2026-06-30', label: 'June 2026' });
    expect(packet.counts).toMatchObject({
      transactions_reviewed: 5,
      vague_categories: 1,
      transactions_in_vague_or_missing_categories: 3,
      duplicate_category_label_groups: 1,
      duplicate_counterparty_label_groups: 1,
      safe_candidate_changes: 1
    });
    expect(packet.selection).toMatchObject({
      policy: 'categorization_review_slices',
      source_count: 9,
      included_count: 4,
      omitted_count: 5,
      continuation_supported: true,
      row_limit: 12
    });
    expect(packet.vague_categories[0]).toMatchObject({
      id: 'misc',
      source_refs: ['category:misc']
    });
    expect(packet.duplicate_categories[0]).toMatchObject({ label: 'expense:food', count: 2 });
    expect(packet.duplicate_counterparties[0]).toMatchObject({ label: 'store', count: 2 });
    expect(packet.candidate_cleanup).toMatchObject({
      categoryChanges: [{ action: 'rename', categoryId: 'misc', name: 'Needs Review' }],
      counterpartyChanges: [
        { action: 'merge', counterpartyId: 'store-copy', replacementCounterpartyId: 'store' }
      ],
      transactionPatches: [{ transactionId: 'txn-misc', categoryId: 'food' }]
    });
    expect(packet.candidate_improvements[0]).toMatchObject({
      title: 'Rename Misc',
      source_refs: ['category:misc']
    });
    expect(packet.category_reliability).toMatchObject({
      level: expect.any(String),
      score: expect.any(Number)
    });
    expect(packet.semantic_summary.review_needed_count).toBeGreaterThan(0);
    expect(
      packet.sample_transactions_needing_review.map((transaction) => transaction.transaction_id)
    ).toEqual(['txn-transfer', 'txn-misc', 'txn-missing']);
    expect(packet.sample_transactions_needing_review[1]).toMatchObject({
      amount: '75.00',
      current_category: 'Misc',
      source_refs: ['transaction:txn-misc']
    });
  });

  it('builds transaction list packets with modes and ledger rows', () => {
    const workbook = makeWorkbook();
    const context = {
      profile: {
        rangeStart: '2026-06-01',
        rangeEnd: '2026-06-30',
        rangeLabel: 'June 2026'
      }
    };

    expect(getAdvisorTransactionListMode('show the latest transaction', '')).toBe('last');
    const row = getAdvisorTransactionListRow(workbook, workbook.transactions[0], {
      getTemplateLabel: () => 'Expense Paid',
      formatMoneyWithCurrency: (value, currency) => `${currency} ${Number(value).toFixed(2)}`
    });
    expect(row).toMatchObject({
      transaction_id: 'txn-one',
      type_label: 'Expense Paid',
      amount_display: 'PHP 150.00',
      category_name: 'Food',
      counterparty_name: 'Store',
      semantic_classification: expect.objectContaining({
        economicFlow: 'consumption_expense',
        recurrence: 'recurring_active'
      }),
      source_ref: 'transaction:txn-one'
    });
    expect(row.account_lines[1]).toMatchObject({
      account_id: 'cash',
      account_name: 'Cash',
      base_amount: '150.00'
    });

    const fullPacket = buildAdvisorTransactionListPacket(
      workbook,
      context,
      {
        question: 'show full transaction history',
        responseStyle: 'breakdown'
      },
      {
        formatMoneyWithCurrency: (value, currency) => `${currency} ${Number(value).toFixed(2)}`
      }
    );
    expect(fullPacket.mode).toBe('full');
    expect(fullPacket.selection).toMatchObject({
      policy: 'full_selected_range',
      source_count: 3,
      included_count: 3,
      omitted_count: 0,
      continuation_supported: false,
      row_limit: 3
    });
    expect(fullPacket.transactions.map((transaction) => transaction.transaction_id)).toEqual([
      'txn-income',
      'txn-one',
      'txn-transfer'
    ]);
    expect(fullPacket.source_refs).toEqual([
      'transaction:txn-income',
      'transaction:txn-one',
      'transaction:txn-transfer'
    ]);

    const lastPacket = buildAdvisorTransactionListPacket(workbook, context, {
      question: 'latest transaction'
    });
    expect(lastPacket.mode).toBe('last');
    expect(lastPacket.selection).toMatchObject({
      policy: 'latest_transaction',
      source_count: 3,
      included_count: 1,
      omitted_count: 2,
      continuation_supported: true,
      row_limit: 1
    });
    expect(lastPacket.transactions).toHaveLength(1);
    expect(lastPacket.transactions[0].transaction_id).toBe('txn-income');
  });

  it('builds transaction analysis packets with advisor review signals', () => {
    const workbook = makeWorkbook();
    workbook.categories.push(
      {
        id: 'subscriptions',
        name: 'Subscriptions',
        type: 'expense',
        currency: 'PHP',
        isActive: true
      },
      { id: 'random', name: 'Random', type: 'expense', currency: 'PHP', isActive: true }
    );
    workbook.transactions.push(
      {
        id: 'txn-chatgpt',
        date: '2026-06-14',
        template: 'expense_charged',
        description: 'ChatGPT Pro',
        categoryId: 'subscriptions',
        recurringItemId: 'recurring-chatgpt',
        amount: 6490,
        baseAmount: 6490,
        originalCurrency: 'PHP',
        lines: []
      },
      {
        id: 'txn-random',
        date: '2026-06-10',
        template: 'expense_paid',
        description: 'Vape',
        categoryId: 'random',
        amount: 450,
        baseAmount: 450,
        originalCurrency: 'PHP',
        lines: []
      }
    );
    const context = {
      profile: {
        currency: 'PHP',
        rangeStart: '2026-06-01',
        rangeEnd: '2026-06-30',
        rangeLabel: 'June 2026'
      },
      snapshot: {
        income: 1000,
        outflow: 7490,
        expense: 7165,
        savings: 75,
        debt: 250,
        net: -6490
      },
      budget: {
        plannedOutflow: 100,
        budgetUsedPercent: 7165,
        topSpendRows: [
          { category: { id: 'subscriptions', name: 'Subscriptions' }, total: 6490 },
          { category: { id: 'food', name: 'Food' }, total: 150 },
          { category: { id: 'random', name: 'Random' }, total: 450 }
        ],
        overspentRows: [
          {
            category: { id: 'subscriptions', name: 'Subscriptions' },
            planned: 300,
            actual: 6490,
            remaining: -6190,
            percent: 2163
          }
        ]
      }
    };
    const packet = buildAdvisorTransactionAnalysisPacket(
      workbook,
      context,
      {
        questionType: 'spending_analysis'
      },
      {
        formatMoney: (value) => `PHP ${Number(value).toFixed(2)}`,
        formatMoneyWithCurrency: (value, currency) => `${currency} ${Number(value).toFixed(2)}`,
        formatDeltaMoney: (value) =>
          `${Number(value) >= 0 ? '+' : '-'}PHP ${Math.abs(Number(value)).toFixed(2)}`
      }
    );

    expect(packet.packet_version).toBe('cavalry.transaction_analysis.v1');
    expect(packet.question_type).toBe('spending_analysis');
    expect(packet.selection).toMatchObject({
      policy: 'ranked_analysis_slices',
      source_count: 5,
      included_count: 4,
      omitted_count: 1,
      continuation_supported: true,
      row_limit_per_slice: 12,
      category_limit: 8
    });
    expect(packet.selection.included_transaction_ids).toEqual(
      expect.arrayContaining(['txn-chatgpt', 'txn-random', 'txn-transfer', 'txn-one'])
    );
    expect(packet.totals.selected_period_total_outflow.amount).toBe('7490.00');
    expect(packet.totals.selected_period_spending.amount).toBe('7090.00');
    expect(packet.totals.selected_period_consumption_spending.amount).toBe('7090.00');
    expect(packet.totals.selected_period_expenses_only.amount).toBe('7165.00');
    expect(packet.totals.selected_period_debt_payments.amount).toBe('250.00');
    expect(packet.totals.selected_period_transfers_or_internal_moves.amount).toBe('75.00');
    expect(packet.totals.selected_period_net_cashflow.amount).toBe('-6490.00');
    expect(packet.budget_reliability.status).toBe('extreme_or_mismatched');
    expect(packet.budget_reliability).toMatchObject({
      percent_of_budget: '7490.00',
      percent_over_budget: '7390.00'
    });
    expect(packet.spending_definition).toMatchObject({
      selected: 'consumption_only',
      label: 'Consumption spending'
    });
    expect(packet.semantic_summary.by_economic_flow).toMatchObject({
      consumption_expense: 7090,
      internal_transfer: 75,
      income: 1000
    });
    expect(packet.category_reliability.level).toMatch(/medium|low|high/);
    expect(packet.top_spending_categories.map((row) => row.name)).toEqual([
      'Subscriptions',
      'Food',
      'Random'
    ]);
    expect(packet.recurring_or_subscription_rows.map((row) => row.transaction_id)).toContain(
      'txn-chatgpt'
    );
    expect(packet.vague_category_rows.map((row) => row.transaction_id)).toContain('txn-random');
    expect(packet.transfer_like_rows.map((row) => row.transaction_id)).toContain('txn-transfer');
    expect(packet.transfer_like_rows[0].semantic_classification.economicFlow).toBe(
      'internal_transfer'
    );
    expect(packet.largest_real_expense_rows[0].transaction_id).toBe('txn-chatgpt');
  });

  it('builds net-worth impact packets with included and neutral rows', () => {
    const workbook = makeWorkbook();
    const context = {
      profile: {
        currency: 'PHP',
        rangeStart: '2026-06-01',
        rangeEnd: '2026-06-30',
        rangeLabel: 'June 2026'
      },
      snapshot: {
        income: 1000,
        expense: 150,
        net: 850
      }
    };
    const services = {
      formatMoney: (value) => `PHP ${Number(value).toFixed(2)}`,
      formatDeltaMoney: (value) =>
        `${Number(value) >= 0 ? '+' : '-'}PHP ${Math.abs(Number(value)).toFixed(2)}`,
      formatDisplayDate: (value) => value
    };

    const impactRow = getAdvisorTransactionImpactRow(workbook, workbook.transactions[0], services);
    expect(impactRow).toMatchObject({
      transaction_id: 'txn-one',
      direction: 'negative',
      net_worth_impact: '-150.00',
      net_worth_impact_display: '-PHP 150.00'
    });

    const packet = buildAdvisorNetWorthImpactPacket(workbook, context, { limit: 6 }, services);
    expect(packet.packet_version).toBe('cavalry.transaction_impact.v1');
    expect(packet.selection).toMatchObject({
      policy: 'ranked_net_worth_impact_rows',
      source_count: 3,
      included_count: 2,
      omitted_count: 0,
      continuation_supported: false,
      row_limit: 6
    });
    expect(packet.totals.estimated_transaction_net_worth_impact).toMatchObject({
      amount: '850.00',
      currency: 'PHP'
    });
    expect(packet.top_positive_impact_transactions[0].transaction_id).toBe('txn-income');
    expect(packet.top_negative_impact_transactions[0].transaction_id).toBe('txn-one');
    expect(packet.excluded_transactions_summary.transfer_excluded).toBe(1);
    expect(packet.source_refs).toEqual(['transaction:txn-income', 'transaction:txn-one']);
  });
});
