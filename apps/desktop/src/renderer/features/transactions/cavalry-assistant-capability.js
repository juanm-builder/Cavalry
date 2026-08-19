import { defineCavalryAssistantCapability } from '../assistant/cavalry-assistant-capability-registry.js';
import {
  DATE_RANGE_PROPERTIES,
  assistantBooleanProperty,
  assistantNumberProperty,
  assistantStringProperty,
  defineCavalryAssistantTool
} from '../assistant/cavalry-assistant-tool-definitions.js';
import {
  createTransaction,
  searchTransactions
} from '../assistant/cavalry-assistant-tool-support.js';

const CREATE_REFUND_PROPERTIES = Object.freeze({
  amount: assistantNumberProperty('Positive amount returned by the merchant.'),
  currency: assistantStringProperty('ISO currency code, such as PHP or USD.'),
  date: assistantStringProperty(
    'Optional refund date in YYYY-MM-DD format. When omitted, Cavalry uses the current date.'
  ),
  fxRateToBase: assistantNumberProperty(
    'Optional exchange rate from the refund currency to the workbook base currency.'
  ),
  description: assistantStringProperty('Plain-language refund description.'),
  originalCategory: assistantStringProperty(
    'Original expense category ID or exact name. The refund reduces this category.'
  ),
  originalCategoryId: assistantStringProperty(
    'Original expense category ID or exact name. The refund reduces this category.'
  ),
  refundedTo: assistantStringProperty(
    'Asset or liability account ID or exact name that received the refund.'
  ),
  refundedToAccountId: assistantStringProperty(
    'Asset or liability account ID or exact name that received the refund.'
  ),
  merchant: assistantStringProperty(
    'Existing merchant/counterparty ID or exact name, matched case-insensitively.'
  ),
  merchantId: assistantStringProperty(
    'Existing merchant/counterparty ID or exact name, matched case-insensitively.'
  ),
  note: assistantStringProperty('Optional refund note.'),
  allowDuplicate: assistantBooleanProperty(
    'Set true only after the user confirms posting a possible duplicate refund.'
  ),
  allowCurrencyConversion: assistantBooleanProperty(
    'Set true only after the user explicitly confirms the disclosed currency conversion.'
  )
});

const SEARCH_REFUND_PROPERTIES = Object.freeze({
  query: assistantStringProperty(
    'Search text matched across refund descriptions, notes, references, and IDs.'
  ),
  account: assistantStringProperty('Optional receiving account ID or exact name.'),
  accountId: assistantStringProperty('Optional receiving account ID or exact name.'),
  category: assistantStringProperty('Optional original expense category ID or exact name.'),
  categoryId: assistantStringProperty('Optional original expense category ID or exact name.'),
  ...DATE_RANGE_PROPERTIES,
  minAmount: assistantNumberProperty('Optional minimum refund amount.'),
  maxAmount: assistantNumberProperty('Optional maximum refund amount.'),
  page: assistantNumberProperty('Result page number, starting at 1.'),
  limit: assistantNumberProperty('Maximum rows per page, from 1 to 500.'),
  sortDirection: assistantStringProperty('Sort direction.', { enum: ['asc', 'desc'] })
});

function createRefund(environment) {
  const args = environment.arguments || {};
  return createTransaction({
    ...environment,
    arguments: {
      ...args,
      template: 'merchant_refund',
      category: args.originalCategory,
      categoryId: args.originalCategoryId,
      primaryAccount: args.refundedTo,
      primaryAccountId: args.refundedToAccountId,
      counterparty: args.merchant,
      counterpartyId: args.merchantId
    },
    context: {
      ...(environment.context || {}),
      forcedTransactionTemplate: 'merchant_refund'
    }
  });
}

function searchRefunds(environment) {
  return searchTransactions({
    ...environment,
    arguments: { ...(environment.arguments || {}), type: 'refund' }
  });
}

export default defineCavalryAssistantCapability({
  id: 'transactions.refunds',
  title: 'Merchant refunds',
  description:
    'Record and inspect merchant refunds as expense reversals, including cash and card refunds.',
  instructions:
    'A merchant refund reduces the original expense category and is never new income. Use the account that received the money or card credit.',
  tools: [
    {
      definition: defineCavalryAssistantTool(
        'create_refund',
        'Record a merchant refund as a validated expense reversal. Use the original expense category and the cash, bank, wallet, or credit-card account that received the refund. The amount stays positive while Cavalry applies a negative spending impact.',
        CREATE_REFUND_PROPERTIES,
        ['amount', 'description']
      ),
      execute: createRefund,
      approvalFields: ['allowDuplicate', 'allowCurrencyConversion'],
      actionVerb: 'Recorded refund for'
    },
    {
      definition: defineCavalryAssistantTool(
        'search_refunds',
        'Search only merchant refunds and return their positive received amounts plus signed expense and cash-flow effects.',
        SEARCH_REFUND_PROPERTIES
      ),
      execute: searchRefunds
    }
  ]
});
