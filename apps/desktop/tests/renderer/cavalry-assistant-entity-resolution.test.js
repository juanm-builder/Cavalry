import { describe, expect, it } from 'vitest';

import {
  cavalryAssistantAccountResolutionError,
  resolveCavalryAssistantAccount,
  resolveCavalryAssistantTransactionAccount
} from '../../src/renderer/features/assistant/cavalry-assistant-entity-resolution.js';

function makeWorkbook() {
  return {
    accounts: [
      {
        id: 'bank-main',
        name: 'Main Bank',
        aliases: ['payroll bank'],
        group: 'asset',
        subtype: 'checking',
        isActive: true
      },
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        isActive: true
      },
      {
        id: 'card-1111',
        name: 'Everyday Visa',
        group: 'liability',
        subtype: 'credit_card',
        details: { cardNetwork: 'Visa', accountNumber: '4111111111111111' },
        isActive: true
      },
      {
        id: 'card-2222',
        name: 'Travel Visa',
        group: 'liability',
        subtype: 'credit_card',
        details: { cardNetwork: 'Visa', accountNumber: '4222222222222222' },
        isActive: true
      },
      {
        id: 'old-bank',
        name: 'Old Bank',
        group: 'asset',
        subtype: 'checking',
        isActive: false
      }
    ]
  };
}

describe('Cavalry Assistant account resolution', () => {
  it('resolves exact stable IDs, exact names, and safe unique aliases', () => {
    const workbook = makeWorkbook();

    expect(
      resolveCavalryAssistantAccount(workbook, {
        reference: 'bank-main',
        groups: ['asset']
      })
    ).toMatchObject({ status: 'resolved', id: 'bank-main', provenance: 'stable_id' });
    expect(
      resolveCavalryAssistantAccount(workbook, {
        reference: 'MAIN BANK',
        groups: ['asset']
      })
    ).toMatchObject({ status: 'resolved', id: 'bank-main', provenance: 'exact_name' });
    expect(
      resolveCavalryAssistantAccount(workbook, {
        reference: 'payroll bank',
        groups: ['asset']
      })
    ).toMatchObject({ status: 'resolved', id: 'bank-main', provenance: 'alias' });
    expect(
      resolveCavalryAssistantAccount(workbook, {
        reference: 'card 1111',
        groups: ['liability']
      })
    ).toMatchObject({ status: 'resolved', id: 'card-1111', provenance: 'alias' });
  });

  it('never chooses an arbitrary account for ambiguous names or generic card aliases', () => {
    const workbook = makeWorkbook();
    workbook.accounts.push({
      id: 'bank-other',
      name: 'Main Bank',
      group: 'asset',
      subtype: 'savings',
      isActive: true
    });

    const duplicateName = resolveCavalryAssistantAccount(workbook, {
      reference: 'Main Bank',
      groups: ['asset']
    });
    const genericCard = resolveCavalryAssistantTransactionAccount(workbook, {
      template: 'expense_charged',
      prompt: 'Charge 500 to my card'
    });

    expect(duplicateName).toMatchObject({
      status: 'ambiguous',
      candidates: expect.arrayContaining([
        expect.objectContaining({ id: 'bank-main' }),
        expect.objectContaining({ id: 'bank-other' })
      ])
    });
    expect(genericCard).toMatchObject({ status: 'ambiguous' });
    expect(cavalryAssistantAccountResolutionError(genericCard, 'primaryAccountId')).toMatchObject({
      status: 'ambiguous_reference',
      error: { code: 'ambiguous_reference', field: 'primaryAccountId' }
    });
  });

  it('treats explicit role wording as authoritative over a conflicting supplied ID', () => {
    const workbook = makeWorkbook();
    const result = resolveCavalryAssistantTransactionAccount(workbook, {
      template: 'expense_paid',
      reference: 'bank-main',
      prompt: 'Pay 100 from Cash'
    });

    expect(result).toMatchObject({
      status: 'resolved',
      id: 'cash',
      role: 'funding',
      provenance: 'explicit_role'
    });
  });

  it('resolves source and destination independently for transfers', () => {
    const workbook = makeWorkbook();
    const prompt = 'Move 1,000 from Cash to Main Bank';

    expect(
      resolveCavalryAssistantTransactionAccount(workbook, {
        template: 'transfer',
        prompt
      })
    ).toMatchObject({ status: 'resolved', id: 'cash', role: 'source' });
    expect(
      resolveCavalryAssistantTransactionAccount(workbook, {
        template: 'transfer',
        secondary: true,
        prompt
      })
    ).toMatchObject({ status: 'resolved', id: 'bank-main', role: 'destination' });
  });

  it('uses an explicit update assignment target instead of the account being replaced', () => {
    const result = resolveCavalryAssistantTransactionAccount(makeWorkbook(), {
      template: 'expense_paid',
      reference: 'cash',
      prompt: 'Move Groceries from Cash to Main Bank',
      assignment: true
    });

    expect(result).toMatchObject({
      status: 'resolved',
      id: 'bank-main',
      role: 'funding',
      provenance: 'explicit_assignment'
    });
  });

  it('rejects unknown, wrong-role, and archived references without falling back', () => {
    const workbook = makeWorkbook();

    expect(
      resolveCavalryAssistantTransactionAccount(workbook, {
        template: 'expense_paid',
        reference: 'Moonstone account'
      })
    ).toMatchObject({ status: 'not_found' });
    expect(
      resolveCavalryAssistantTransactionAccount(workbook, {
        template: 'expense_paid',
        prompt: 'Pay a 100 fee to Main Bank'
      })
    ).toMatchObject({ status: 'not_found', provenance: 'role_mismatch' });
    expect(
      resolveCavalryAssistantTransactionAccount(workbook, {
        template: 'expense_paid',
        reference: 'old-bank'
      })
    ).toMatchObject({ status: 'not_found' });
  });

  it('rejects an unknown free-form account cue instead of accepting a conflicting supplied ID', () => {
    const workbook = makeWorkbook();

    expect(
      resolveCavalryAssistantTransactionAccount(workbook, {
        template: 'expense_charged',
        reference: 'card-1111',
        prompt: 'Charge 500 to Moonstone'
      })
    ).toMatchObject({
      status: 'not_found',
      reference: 'Moonstone',
      role: 'charged'
    });

    // A payee introduced with "to" is not a funding-account cue for a cash purchase.
    expect(
      resolveCavalryAssistantTransactionAccount(workbook, {
        template: 'expense_paid',
        reference: 'bank-main',
        prompt: 'Pay 500 to Moonstone'
      })
    ).toMatchObject({ status: 'resolved', id: 'bank-main', provenance: 'stable_id' });
  });

  it('rejects unknown destinations across refund, income, transfer, and debt-payment wording', () => {
    const workbook = makeWorkbook();
    const cases = [
      {
        template: 'merchant_refund',
        prompt: 'Refund 500 to Moonstone',
        reference: 'bank-main',
        role: 'receiving'
      },
      {
        template: 'income_received',
        prompt: 'Salary paid into Moonstone',
        reference: 'bank-main',
        role: 'receiving'
      },
      {
        template: 'transfer',
        secondary: true,
        prompt: 'Wire 500 from Cash into Moonstone',
        reference: 'bank-main',
        role: 'destination'
      },
      {
        template: 'debt_payment',
        secondary: true,
        prompt: 'Pay Moonstone from Main Bank',
        reference: 'card-1111',
        role: 'destination'
      }
    ];

    cases.forEach((input) => {
      expect(resolveCavalryAssistantTransactionAccount(workbook, input)).toMatchObject({
        status: 'not_found',
        reference: 'Moonstone',
        role: input.role
      });
    });
  });
});
