import { describe, expect, it } from 'vitest';

import {
  inferAdvisorTransactionTemplateFromText,
  parseAdvisorAmountFromText
} from '@cavalry/advisor/domain/advisor/transaction-drafts.js';
import { splitAdvisorTransactionPrompts } from '@cavalry/advisor/domain/advisor/transaction-prompt-splitter.js';

const options = { currentDate: '2026-06-15' };

describe('Advisor transaction prompt splitting', () => {
  it('keeps shared transfer accounts and maps each amount to its stated purpose', () => {
    const prompts = splitAdvisorTransactionPrompts(
      'Hello! I would like you to add these transactions\n\nFrom my freedom fund, i transferred 750 and 100 pesos to my gcash. the 750 is payment to my friend because i loaned him something, and the 100, to get some keys duplicated. all today',
      options
    );

    expect(prompts).toHaveLength(2);
    expect(prompts.map(parseAdvisorAmountFromText)).toEqual([750, 100]);
    expect(prompts.map(inferAdvisorTransactionTemplateFromText)).toEqual(['transfer', 'transfer']);
    expect(prompts[0]).toMatch(/freedom fund/i);
    expect(prompts[0]).toMatch(/gcash/i);
    expect(prompts[0]).toContain('payment to my friend');
    expect(prompts[1]).toContain('keys duplicated');
  });

  it('splits mixed expense amounts and carries the shared funding account', () => {
    const prompts = splitAdvisorTransactionPrompts(
      'I paid 200 for groceries and 120 for transport from GCash today',
      options
    );

    expect(prompts).toHaveLength(2);
    expect(prompts.map(parseAdvisorAmountFromText)).toEqual([200, 120]);
    expect(prompts[0]).toMatch(/groceries/i);
    expect(prompts[0]).toMatch(/from GCash/i);
    expect(prompts[1]).toMatch(/transport/i);
  });

  it('does not split an explicit total', () => {
    expect(
      splitAdvisorTransactionPrompts('I spent 850 total on groceries from GCash today', options)
    ).toEqual(['I spent 850 total on groceries from GCash today']);
  });

  it('splits per-destination transfers and ambiguous amount lists for review', () => {
    const transfers = splitAdvisorTransactionPrompts(
      'Move 5000 to savings and 2000 to investments',
      options
    );
    const ambiguous = splitAdvisorTransactionPrompts('I spent 300 and 400 today', options);

    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatch(/to savings/i);
    expect(transfers[1]).toMatch(/to investments/i);
    expect(ambiguous).toHaveLength(2);
    expect(ambiguous.map(parseAdvisorAmountFromText)).toEqual([300, 400]);
  });
});
