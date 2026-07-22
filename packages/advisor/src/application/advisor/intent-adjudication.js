import {
  ADVISOR_FINANCE_INTENT_KINDS,
  classifyAdvisorFinanceIntent,
  extractAdvisorAmountMentions,
  inferAdvisorDescriptionFromPrompt,
  parseAdvisorTransactionListRows
} from '../../domain/advisor/transaction-drafts.js';

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

export function advisorPromptLooksLikeTransactionBatch(prompt, amountMentions = null) {
  const lower = normalizeText(prompt);
  const amounts = Array.isArray(amountMentions)
    ? amountMentions
    : extractAdvisorAmountMentions(prompt);
  const batchLanguage =
    /\b(?:following|these|multiple|several|all these|all of these)\s+(?:transactions?|expenses?|payments?|purchases?|charges?|entries?)\b/.test(
      lower
    ) ||
    /\b(?:transactions?|expenses?|payments?|purchases?|charges?|entries?)\s+(?:below|following)\b/.test(
      lower
    );
  if (!(batchLanguage || amounts.length > 1)) {
    return false;
  }
  const parsedRows = parseAdvisorTransactionListRows(prompt, {
    defaultDateForUndatedRows: true
  });
  if (parsedRows.length > 1) {
    return true;
  }
  return batchLanguage && amounts.length > 1;
}

export function advisorPromptLooksLikeCreditCardExpense(prompt) {
  const lower = normalizeText(prompt);
  const semanticDecision = classifyAdvisorFinanceIntent(prompt);
  if (semanticDecision.kind === ADVISOR_FINANCE_INTENT_KINDS.LIABILITY_PAYMENT) {
    return false;
  }
  const amountMentions = extractAdvisorAmountMentions(prompt);
  const hasAmount = amountMentions.length > 0 || semanticDecision.amount > 0;
  const chargeLanguage =
    /\b(charged|charge|bought|buy|purchase|purchased|spent|expense|credits?)\b/.test(lower);
  const cardLanguage = /\b(credit card|card|visa|mastercard|amex)\b/.test(lower);
  const createAccountLanguage =
    /\b(create|add|make|new)\s+(?:a\s+|an\s+|the\s+)?(?:credit\s+card\s+)?(?:account|wallet)\b/.test(
      lower
    );
  const batchLanguage = advisorPromptLooksLikeTransactionBatch(prompt, amountMentions);
  if (semanticDecision.kind === ADVISOR_FINANCE_INTENT_KINDS.CARD_CHARGE) {
    return hasAmount && !createAccountLanguage && !batchLanguage;
  }
  return hasAmount && chargeLanguage && cardLanguage && !createAccountLanguage && !batchLanguage;
}

export function adjudicateAdvisorTransactionIntent({ message, intent } = {}) {
  const prompt = asString(message);
  const amountMentions = extractAdvisorAmountMentions(prompt);
  const firstAmount = amountMentions[0] || null;
  const semanticDecision = classifyAdvisorFinanceIntent(prompt);
  const looksLikeCardExpense = advisorPromptLooksLikeCreditCardExpense(prompt);
  const base = intent && typeof intent === 'object' ? intent : {};
  if (semanticDecision.kind === ADVISOR_FINANCE_INTENT_KINDS.LIABILITY_PAYMENT) {
    const description = inferAdvisorDescriptionFromPrompt(prompt) || 'Credit card payment';
    const fields = Object.assign({}, base.fields || {}, {
      description,
      amount:
        semanticDecision.amount > 0
          ? semanticDecision.amount
          : firstAmount
            ? firstAmount.amount
            : Number(base.fields && base.fields.amount) || 0,
      currency:
        semanticDecision.currency ||
        (firstAmount && firstAmount.currency
          ? firstAmount.currency
          : asString(base.fields && base.fields.currency)),
      secondaryAccountName:
        asString(base.fields && base.fields.secondaryAccountName) || 'Credit card',
      note:
        asString(base.fields && base.fields.note) ||
        'Payment target hint: credit card bill/payment.'
    });
    return {
      changed: true,
      intent: Object.assign({}, base, {
        targetIntent: 'record_transaction',
        command: 'record_debt_payment',
        template: 'debt_payment',
        fields,
        liabilityAccountHint: 'credit card',
        notIntent: ['create_account'],
        reason:
          'Credit-card bill/payment language describes a liability payment, not a new card charge.'
      }),
      adjudication: {
        route: 'record_debt_payment',
        template: 'debt_payment',
        amount:
          semanticDecision.amount > 0
            ? semanticDecision.amount
            : firstAmount
              ? firstAmount.amount
              : 0,
        currency: semanticDecision.currency || (firstAmount ? firstAmount.currency : ''),
        liabilityAccountHint: 'credit card',
        semanticDecision,
        suppressedIntents: ['create_account']
      }
    };
  }
  if (!looksLikeCardExpense) {
    return {
      changed: false,
      intent: base,
      adjudication: {
        route: 'unchanged',
        reason: 'No credit-card expense signal.',
        semanticDecision
      }
    };
  }
  const description = inferAdvisorDescriptionFromPrompt(prompt) || 'Credit card purchase';
  const fields = Object.assign({}, base.fields || {}, {
    description,
    amount: firstAmount ? firstAmount.amount : Number(base.fields && base.fields.amount) || 0,
    currency:
      firstAmount && firstAmount.currency
        ? firstAmount.currency
        : asString(base.fields && base.fields.currency),
    primaryAccountName: asString(base.fields && base.fields.primaryAccountName) || 'Credit card',
    note:
      asString(base.fields && base.fields.note) || 'Payment account hint: charged to credit card.'
  });
  return {
    changed: true,
    intent: Object.assign({}, base, {
      targetIntent: 'record_transaction',
      command: 'record_expense',
      template: 'expense_charged',
      fields,
      paymentAccountHint: 'credit card',
      notIntent: ['create_account'],
      reason:
        'Amount plus charged-to-credit-card language describes an expense paid with a liability account, not account creation.'
    }),
    adjudication: {
      route: 'record_expense',
      template: 'expense_charged',
      amount: firstAmount ? firstAmount.amount : 0,
      currency: firstAmount ? firstAmount.currency : '',
      paymentAccountHint: 'credit card',
      semanticDecision,
      suppressedIntents: ['create_account']
    }
  };
}
