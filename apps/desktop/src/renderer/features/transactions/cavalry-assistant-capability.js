import { LEDGER_TRANSACTION_TEMPLATES } from '@cavalry/finance-core';

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
  deleteTransaction,
  replaceTransaction,
  searchTransactions,
  updateTransaction
} from '../assistant/cavalry-assistant-tool-support.js';

const CONFIRMATION_COPY =
  'Set confirmed to true only after the user explicitly confirms this destructive action.';

const TRANSACTION_WRITE_PROPERTIES = Object.freeze({
  template: assistantStringProperty('The Cavalry transaction type.', {
    enum: [...LEDGER_TRANSACTION_TEMPLATES]
  }),
  amount: assistantNumberProperty('A positive transaction amount.'),
  currency: assistantStringProperty('ISO currency code, such as PHP or USD.'),
  date: assistantStringProperty(
    'Optional transaction date in YYYY-MM-DD format. When omitted, Cavalry uses the current date.'
  ),
  fxRateToBase: assistantNumberProperty(
    'Optional exchange rate from the transaction currency to base.'
  ),
  description: assistantStringProperty('Plain-language transaction description.'),
  category: assistantStringProperty(
    'Category ID or exact category name, matched case-insensitively.'
  ),
  categoryId: assistantStringProperty(
    'Category ID or exact category name, matched case-insensitively.'
  ),
  primaryAccount: assistantStringProperty(
    'Primary account stable ID, exact name, or unique safe alias. Explicit user wording is authoritative; ambiguous aliases require clarification.'
  ),
  primaryAccountId: assistantStringProperty(
    'Primary account stable ID, exact name, or unique safe alias. IDs are matched exactly.'
  ),
  secondaryAccount: assistantStringProperty(
    'Secondary account stable ID, exact name, or unique safe alias. Transfer and debt-payment destination wording is authoritative.'
  ),
  secondaryAccountId: assistantStringProperty(
    'Secondary account stable ID, exact name, or unique safe alias. IDs are matched exactly.'
  ),
  counterparty: assistantStringProperty(
    'Counterparty ID or exact counterparty name, matched case-insensitively.'
  ),
  counterpartyId: assistantStringProperty(
    'Counterparty ID or exact counterparty name, matched case-insensitively.'
  ),
  counterpartyName: assistantStringProperty(
    'A new counterparty name when no existing ID is supplied.'
  ),
  counterpartyKind: assistantStringProperty(
    'Counterparty kind, such as merchant, employer, or client.'
  ),
  note: assistantStringProperty('Optional transaction note.'),
  allowDuplicate: assistantBooleanProperty(
    'Set true only after the user confirms posting a possible duplicate transaction.'
  ),
  allowCurrencyConversion: assistantBooleanProperty(
    'Set true only after the user explicitly confirms the disclosed currency conversion.'
  )
});

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

const SEARCH_TRANSACTION_PROPERTIES = Object.freeze({
  query: assistantStringProperty(
    'Search text matched across descriptions, notes, references, and IDs.'
  ),
  type: assistantStringProperty('Transaction flow filter.', {
    enum: ['all', 'income', 'expense', 'refund', 'transfer', 'opening', 'other']
  }),
  account: assistantStringProperty('Optional account ID or exact name.'),
  accountId: assistantStringProperty('Optional account ID or exact name.'),
  category: assistantStringProperty('Optional category ID or exact name.'),
  categoryId: assistantStringProperty('Optional category ID or exact name.'),
  ...DATE_RANGE_PROPERTIES,
  minAmount: assistantNumberProperty('Optional minimum amount.'),
  maxAmount: assistantNumberProperty('Optional maximum amount.'),
  page: assistantNumberProperty('Result page number, starting at 1.'),
  limit: assistantNumberProperty('Maximum rows per page, from 1 to 500.'),
  sortKey: assistantStringProperty('Sort field.', {
    enum: ['date', 'amount', 'description', 'account', 'category', 'type']
  }),
  sortDirection: assistantStringProperty('Sort direction.', { enum: ['asc', 'desc'] })
});

const SEARCH_REFUND_PROPERTIES = Object.freeze(
  Object.fromEntries(
    Object.entries(SEARCH_TRANSACTION_PROPERTIES).filter(([field]) => field !== 'type')
  )
);

const REPLACEMENT_WRITE_PROPERTIES = Object.freeze({
  ...Object.fromEntries(
    Object.entries(TRANSACTION_WRITE_PROPERTIES).filter(
      ([field]) => !['allowDuplicate', 'allowCurrencyConversion'].includes(field)
    )
  ),
  transactionId: assistantStringProperty(
    'Host-bound stable ID for a prepared replacement transaction.'
  ),
  recurringItemId: assistantStringProperty(
    'Host-bound recurring-item link preserved by a prepared replacement.'
  ),
  allowDuplicate: assistantBooleanProperty('Host-controlled duplicate approval.'),
  allowCurrencyConversion: assistantBooleanProperty('Host-controlled currency-conversion approval.')
});

const REPLACE_TRANSACTION_PROPERTIES = Object.freeze({
  transaction: assistantStringProperty(
    'Transaction ID or exact description to replace, matched case-insensitively.'
  ),
  transactionId: assistantStringProperty(
    'Transaction ID or exact description to replace, matched case-insensitively.'
  ),
  replacements: {
    type: 'array',
    description:
      'One or more complete replacement transactions. Cavalry validates every item before committing any change.',
    minItems: 1,
    items: {
      type: 'object',
      properties: REPLACEMENT_WRITE_PROPERTIES,
      required: ['amount', 'description'],
      additionalProperties: false
    }
  },
  operationKey: assistantStringProperty(
    'Opaque operation key from a previously prepared replacement proposal. Do not invent or change it.'
  ),
  proposalFingerprint: assistantStringProperty(
    'Opaque replacement fingerprint from a previously prepared proposal. Do not invent or change it.'
  ),
  targetFingerprint: assistantStringProperty(
    'Opaque target/workbook precondition fingerprint from a previously prepared proposal. Do not invent or change it.'
  ),
  confirmed: assistantBooleanProperty(CONFIRMATION_COPY),
  allowDuplicate: assistantBooleanProperty(
    'Set true only after the user confirms posting a possible duplicate replacement.'
  ),
  allowCurrencyConversion: assistantBooleanProperty(
    'Set true only after the user confirms every disclosed currency conversion.'
  )
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
  id: 'transactions.ledger',
  title: 'Transactions',
  description:
    'Search, create, correct, move, atomically replace, and delete ledger transactions and merchant refunds.',
  version: '2.1.0',
  compatibility: { minimumAppVersion: '2.1.0', workbookSchema: '2' },
  inputValidation: 'structure',
  instructions:
    'For a correction, recategorization, account move, or type change that remains one record, use update_transaction so the existing record is changed atomically. For a one-to-many or structural replacement, use replace_transaction; it validates every replacement before asking for confirmation and commits once. Never delete a record first as part of a replacement. Reimbursements and recurring-linked transactions cannot be structurally replaced because their contribution or reconciliation semantics require an explicit mapping. User wording such as from, to, into, or charged to is authoritative for account roles. Stable IDs are exact; names and safe aliases must identify one active compatible account, otherwise ask the user to clarify. A purchase assigned to a liability account is an expense_charged transaction. A merchant refund reduces the original expense category and is never new income.',
  tools: [
    {
      definition: () =>
        defineCavalryAssistantTool(
          'search_transactions',
          'Search and filter transactions without changing the workbook.',
          SEARCH_TRANSACTION_PROPERTIES
        ),
      execute: searchTransactions,
      access: 'read',
      confirmation: { mode: 'none' }
    },
    {
      definition: () =>
        defineCavalryAssistantTool(
          'create_transaction',
          'Create one validated transaction. Cavalry routes a purchase on a liability account to expense_charged automatically. Omit date when the user did not specify one. Possible duplicates and currency conversions require app confirmation.',
          TRANSACTION_WRITE_PROPERTIES,
          ['amount', 'description']
        ),
      execute: createTransaction,
      access: 'write',
      entityRequirements: [
        { type: 'account', role: 'primary', ambiguity: 'clarify' },
        { type: 'account', role: 'secondary', required: false, ambiguity: 'clarify' }
      ],
      confirmation: {
        mode: 'conditional',
        description: 'Possible duplicates and currency conversions require explicit approval.'
      },
      approvalFields: ['allowDuplicate', 'allowCurrencyConversion'],
      actionVerb: 'Recorded'
    },
    {
      definition: () =>
        defineCavalryAssistantTool(
          'update_transaction',
          'Atomically correct, recategorize, retype, or move one existing transaction while preserving fields not supplied. Prefer this over delete plus create whenever one record remains one record.',
          {
            transaction: assistantStringProperty(
              'Transaction ID or exact description, matched case-insensitively.'
            ),
            transactionId: assistantStringProperty(
              'Transaction ID or exact description, matched case-insensitively.'
            ),
            ...TRANSACTION_WRITE_PROPERTIES
          }
        ),
      execute: updateTransaction,
      access: 'write',
      entityRequirements: [
        { type: 'transaction', role: 'target', ambiguity: 'clarify' },
        { type: 'account', role: 'primary', required: false, ambiguity: 'clarify' },
        { type: 'account', role: 'secondary', required: false, ambiguity: 'clarify' }
      ],
      confirmation: {
        mode: 'conditional',
        description: 'Possible duplicates and currency conversions require explicit approval.'
      },
      approvalFields: ['allowDuplicate', 'allowCurrencyConversion'],
      actionVerb: 'Updated'
    },
    {
      definition: () =>
        defineCavalryAssistantTool(
          'replace_transaction',
          `Atomically replace one transaction with one or more validated transactions. Nothing changes unless every replacement succeeds. Confirmation is required. ${CONFIRMATION_COPY}`,
          REPLACE_TRANSACTION_PROPERTIES,
          ['replacements']
        ),
      execute: replaceTransaction,
      access: 'write',
      entityRequirements: [
        { type: 'transaction', role: 'target', ambiguity: 'clarify' },
        { type: 'account', role: 'primary', ambiguity: 'clarify' },
        { type: 'account', role: 'secondary', required: false, ambiguity: 'clarify' }
      ],
      confirmation: {
        mode: 'always',
        description: 'The canonical replacement proposal must be explicitly approved.'
      },
      atomicity: 'single-workbook-commit',
      idempotency: 'operation-key',
      approvalFields: ['confirmed', 'allowDuplicate', 'allowCurrencyConversion'],
      hostInputFields: [
        'operationKey',
        'proposalFingerprint',
        'targetFingerprint',
        'replacements[].transactionId',
        'replacements[].recurringItemId',
        'replacements[].allowDuplicate',
        'replacements[].allowCurrencyConversion'
      ],
      actionVerb: 'Replaced'
    },
    {
      definition: () =>
        defineCavalryAssistantTool(
          'delete_transaction',
          `Permanently delete one transaction. Use update_transaction or replace_transaction for corrections. Confirmation is required. ${CONFIRMATION_COPY}`,
          {
            transaction: assistantStringProperty(
              'Transaction ID or exact description, matched case-insensitively.'
            ),
            transactionId: assistantStringProperty(
              'Transaction ID or exact description, matched case-insensitively.'
            ),
            confirmed: assistantBooleanProperty(CONFIRMATION_COPY)
          }
        ),
      execute: deleteTransaction,
      access: 'write',
      entityRequirements: [{ type: 'transaction', role: 'target', ambiguity: 'clarify' }],
      confirmation: {
        mode: 'always',
        description: 'Permanent deletion requires explicit approval.'
      },
      approvalFields: ['confirmed'],
      actionVerb: 'Deleted'
    },
    {
      definition: () =>
        defineCavalryAssistantTool(
          'create_refund',
          'Record a merchant refund as a validated expense reversal. Use the original expense category and the cash, bank, wallet, or credit-card account that received the refund.',
          CREATE_REFUND_PROPERTIES,
          ['amount', 'description']
        ),
      execute: createRefund,
      access: 'write',
      entityRequirements: [
        { type: 'account', role: 'primary-receiving', ambiguity: 'clarify' },
        { type: 'account', role: 'secondary', required: false, ambiguity: 'clarify' }
      ],
      confirmation: {
        mode: 'conditional',
        description: 'Possible duplicates and currency conversions require explicit approval.'
      },
      approvalFields: ['allowDuplicate', 'allowCurrencyConversion'],
      actionVerb: 'Recorded refund for'
    },
    {
      definition: () =>
        defineCavalryAssistantTool(
          'search_refunds',
          'Search only merchant refunds and return their received amounts plus signed expense and cash-flow effects.',
          SEARCH_REFUND_PROPERTIES
        ),
      execute: searchRefunds,
      access: 'read',
      confirmation: { mode: 'none' }
    }
  ]
});
