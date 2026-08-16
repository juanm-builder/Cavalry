import { LEDGER_TRANSACTION_TEMPLATES } from '@cavalry/finance-core';

import { CATEGORY_COLORS, CATEGORY_ICONS } from '../categories/category-options.js';

export const APP_ROUTES = Object.freeze([
  'dashboard',
  'ledger',
  'budgets',
  'accounts',
  'bills',
  'categories',
  'settings'
]);

const TRANSACTION_TEMPLATES = Object.freeze([...LEDGER_TRANSACTION_TEMPLATES]);

const CONFIRMATION_COPY =
  'Set confirmed to true only after the user explicitly confirms this destructive action.';

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function asText(value) {
  return String(value == null ? '' : value).trim();
}

export function textKey(value) {
  return asText(value).toLocaleLowerCase();
}

export function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(asObject(value), key);
}

export function clampInteger(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, Math.round(numeric)))
    : fallback;
}

export function clonePlain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function objectSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

function stringProperty(description, options = {}) {
  return {
    type: 'string',
    description,
    ...(options.enum ? { enum: options.enum } : {})
  };
}

function numberProperty(description) {
  return { type: 'number', description };
}

function booleanProperty(description) {
  return { type: 'boolean', description };
}

function tool(name, description, properties = {}, required = []) {
  return Object.freeze({
    type: 'function',
    name,
    description,
    parameters: objectSchema(properties, required),
    strict: false
  });
}

export function defineCavalryAssistantTool(name, description, properties = {}, required = []) {
  return tool(name, description, properties, required);
}

export const assistantStringProperty = stringProperty;
export const assistantNumberProperty = numberProperty;
export const assistantBooleanProperty = booleanProperty;

export const DATE_RANGE_PROPERTIES = Object.freeze({
  start: stringProperty('Optional inclusive start date in YYYY-MM-DD format.'),
  end: stringProperty('Optional inclusive end date in YYYY-MM-DD format.')
});

const TRANSACTION_WRITE_PROPERTIES = Object.freeze({
  template: stringProperty('The Cavalry transaction type.', { enum: TRANSACTION_TEMPLATES }),
  amount: numberProperty('A positive transaction amount.'),
  currency: stringProperty('ISO currency code, such as PHP or USD.'),
  date: stringProperty(
    'Optional transaction date in YYYY-MM-DD format. When omitted, Cavalry uses the app-provided current date.'
  ),
  fxRateToBase: numberProperty('Optional exchange rate from the transaction currency to base.'),
  description: stringProperty('Plain-language transaction description.'),
  category: stringProperty('Category ID or exact category name, matched case-insensitively.'),
  categoryId: stringProperty('Category ID or exact category name, matched case-insensitively.'),
  primaryAccount: stringProperty(
    'Primary account ID or exact account name, matched case-insensitively.'
  ),
  primaryAccountId: stringProperty(
    'Primary account ID or exact account name, matched case-insensitively.'
  ),
  secondaryAccount: stringProperty(
    'Secondary account ID or exact account name, matched case-insensitively.'
  ),
  secondaryAccountId: stringProperty(
    'Secondary account ID or exact account name, matched case-insensitively.'
  ),
  counterparty: stringProperty(
    'Counterparty ID or exact counterparty name, matched case-insensitively.'
  ),
  counterpartyId: stringProperty(
    'Counterparty ID or exact counterparty name, matched case-insensitively.'
  ),
  counterpartyName: stringProperty('A new counterparty name when no existing ID is supplied.'),
  counterpartyKind: stringProperty('Counterparty kind, such as merchant, employer, or client.'),
  note: stringProperty('Optional transaction note.'),
  allowDuplicate: booleanProperty(
    'Set true only after the user confirms posting a possible duplicate transaction.'
  ),
  allowCurrencyConversion: booleanProperty(
    'Set true only after the user explicitly confirms the disclosed currency conversion.'
  )
});

export const ACCOUNT_WRITE_PROPERTIES = Object.freeze({
  name: stringProperty('Account display name.'),
  group: stringProperty('Account group.', {
    enum: ['asset', 'liability', 'short_term_asset']
  }),
  subtype: stringProperty('Account subtype, such as cash, bank, credit_card, or time_deposit.'),
  currency: stringProperty('ISO account currency code.'),
  institution: stringProperty('Optional bank, institution, or provider name.'),
  openedDate: stringProperty('Opened date in YYYY-MM-DD format.'),
  openingBalance: numberProperty('Optional opening balance for a new account.'),
  note: stringProperty('Optional account note.'),
  placementDate: stringProperty('Optional time-deposit placement date.'),
  maturityDate: stringProperty('Optional time-deposit maturity date.'),
  interestRate: numberProperty('Optional time-deposit interest rate.'),
  estimatedMaturityAmount: numberProperty('Optional estimated maturity amount.')
});

export const ACCOUNT_UPDATE_PROPERTIES = Object.freeze(
  Object.fromEntries(
    Object.entries(ACCOUNT_WRITE_PROPERTIES).filter(
      ([field]) => !['group', 'openedDate', 'openingBalance'].includes(field)
    )
  )
);

export const BILL_WRITE_PROPERTIES = Object.freeze({
  kind: stringProperty('Recurring item kind.', { enum: ['bill', 'subscription'] }),
  name: stringProperty('Bill or subscription name.'),
  category: stringProperty('Expense category ID or exact name, matched case-insensitively.'),
  categoryId: stringProperty('Expense category ID or exact name, matched case-insensitively.'),
  account: stringProperty('Payment account ID or exact name, matched case-insensitively.'),
  accountId: stringProperty('Payment account ID or exact name, matched case-insensitively.'),
  amount: numberProperty('Recurring amount; zero is allowed for a variable bill.'),
  currency: stringProperty('ISO currency code.'),
  frequency: stringProperty('Cadence, such as Weekly, Monthly, Quarterly, or Yearly.'),
  dueDate: stringProperty(
    'Schedule anchor date in YYYY-MM-DD format. This may be a past known charge/due date; it is not necessarily the next expected occurrence.'
  ),
  autoRenew: booleanProperty('Whether a subscription renews automatically.'),
  isActive: booleanProperty('Whether the recurring tracker is active.'),
  note: stringProperty('Optional recurring item note.')
});

const CATEGORY_RULE_SCHEMA = objectSchema(
  {
    field: stringProperty('Category rule field.', { enum: ['description'] }),
    operator: stringProperty('Category rule comparison.', {
      enum: ['contains', 'starts_with']
    }),
    value: stringProperty('Text value used by the auto-categorization rule.')
  },
  ['value']
);

export const CATEGORY_CUSTOMIZATION_PROPERTIES = Object.freeze({
  icon: stringProperty("Exact icon ID from Cavalry's category icon catalog.", {
    enum: CATEGORY_ICONS
  }),
  color: stringProperty('Category color.', { enum: CATEGORY_COLORS }),
  description: stringProperty('Optional category description, up to 80 characters.'),
  plannerBucketId: stringProperty('Optional planner group ID; use an empty string to unassign.'),
  autoCategorizeRules: {
    type: 'array',
    description: 'Optional rules used to categorize matching transaction descriptions.',
    items: CATEGORY_RULE_SCHEMA
  }
});

export const CAVALRY_ASSISTANT_TOOLS = Object.freeze([
  tool(
    'read_workspace_context',
    'Read a safe, complete Cavalry workspace manifest plus a paginated transaction slice. Use subsequent pages until hasMore is false when the user asks about every transaction.',
    {
      includeArchived: booleanProperty(
        'Include hidden categories and inactive accounts, bills, and counterparties.'
      ),
      transactionPage: numberProperty('Transaction page number, starting at 1.'),
      transactionLimit: numberProperty('Transactions per page, from 1 to 500.'),
      transactionSortDirection: stringProperty('Transaction date order.', {
        enum: ['asc', 'desc']
      })
    }
  ),
  tool(
    'read_workspace_summary',
    'Read workbook counts, cash-flow totals, and asset/liability/net-worth totals valued in the workbook base currency.',
    DATE_RANGE_PROPERTIES
  ),
  tool('search_transactions', 'Search and filter transactions without changing the workbook.', {
    query: stringProperty('Search text matched across descriptions, notes, references, and IDs.'),
    type: stringProperty('Transaction flow filter.', {
      enum: ['all', 'income', 'expense', 'refund', 'transfer', 'opening', 'other']
    }),
    account: stringProperty('Account ID or exact name, matched case-insensitively.'),
    accountId: stringProperty('Account ID or exact name, matched case-insensitively.'),
    category: stringProperty('Category ID or exact name, matched case-insensitively.'),
    categoryId: stringProperty('Category ID or exact name, matched case-insensitively.'),
    ...DATE_RANGE_PROPERTIES,
    minAmount: numberProperty('Optional minimum amount.'),
    maxAmount: numberProperty('Optional maximum amount.'),
    page: numberProperty('Result page number, starting at 1.'),
    limit: numberProperty('Maximum number of rows per page, from 1 to 500.'),
    sortKey: stringProperty('Sort field.', {
      enum: ['date', 'amount', 'description', 'account', 'category', 'type']
    }),
    sortDirection: stringProperty('Sort direction.', { enum: ['asc', 'desc'] })
  }),
  tool(
    'summarize_spending',
    'Aggregate the full filtered transaction set into base-currency totals grouped by category, counterparty, account, or month, with counts, shares, and a citable evidence set. Prefer this over paginating raw transaction rows for totals, breakdowns, and questions like where the money is going.',
    {
      groupBy: stringProperty('How to group the aggregation.', {
        enum: ['category', 'counterparty', 'account', 'month']
      }),
      type: stringProperty('Transaction flow filter. Defaults to expense.', {
        enum: ['all', 'income', 'expense', 'refund', 'transfer', 'opening', 'other']
      }),
      account: stringProperty('Optional account ID or exact name filter.'),
      accountId: stringProperty('Optional account ID or exact name filter.'),
      category: stringProperty('Optional category ID or exact name filter.'),
      categoryId: stringProperty('Optional category ID or exact name filter.'),
      ...DATE_RANGE_PROPERTIES,
      limit: numberProperty('Maximum number of groups to return, from 1 to 50. Default 20.')
    },
    ['groupBy']
  ),
  tool(
    'list_accounts',
    'List accounts with native balance/currency, baseBalance/baseCurrency valuation, status, and usage counts.',
    {
      includeArchived: booleanProperty('Include archived accounts.'),
      asOfDate: stringProperty('Optional balance date in YYYY-MM-DD format.')
    }
  ),
  tool('list_categories', 'List categories, linked accounts, status, and usage counts.', {
    includeHidden: booleanProperty('Include hidden categories.')
  }),
  tool('read_budgets', 'Read budget plan-versus-actual data for one or all sheets.', {
    sheet: stringProperty('Optional sheet ID or exact sheet name, matched case-insensitively.'),
    sheetId: stringProperty('Optional sheet ID or exact sheet name, matched case-insensitively.')
  }),
  tool(
    'list_recurring_bills',
    'List bills and subscriptions with linked category/account details.',
    {
      includeArchived: booleanProperty('Include inactive recurring items.')
    }
  ),
  tool(
    'analyze_recurring_expenses',
    'Analyze tracked recurring items and dated expense patterns without changing the workbook. Use this for subscription audits and questions about possible recurring payments. It keeps tracker status separate from recent or stale charge evidence, and distinguishes confirmed linked charges, likely or uncertain recurrence, variable expenses, and user-confirmed non-recurring items, with the exact source transactions used for each conclusion.',
    {
      includeIgnored: booleanProperty(
        'Include candidates the user previously marked ignored or not a subscription.'
      )
    }
  ),
  tool('list_counterparties', 'List counterparties with status and usage counts.', {
    includeArchived: booleanProperty('Include inactive counterparties.')
  }),
  tool(
    'create_transaction',
    'Create a validated transaction, including merchant refunds that reduce the original expense category instead of counting as income. Omit date when the user did not specify one; Cavalry defaults it to the current date. Category and compatible accounts may be inferred from explicit wording, saved category rules, matching transaction history, and transaction semantics. Possible duplicates are returned for confirmation before posting.',
    TRANSACTION_WRITE_PROPERTIES,
    ['amount', 'description']
  ),
  tool('update_transaction', 'Partially update a transaction, preserving fields not supplied.', {
    transaction: stringProperty('Transaction ID or exact description, matched case-insensitively.'),
    transactionId: stringProperty(
      'Transaction ID or exact description, matched case-insensitively.'
    ),
    ...TRANSACTION_WRITE_PROPERTIES
  }),
  tool(
    'delete_transaction',
    `Permanently delete one transaction. Confirmation is required. ${CONFIRMATION_COPY}`,
    {
      transaction: stringProperty(
        'Transaction ID or exact description, matched case-insensitively.'
      ),
      transactionId: stringProperty(
        'Transaction ID or exact description, matched case-insensitively.'
      ),
      confirmed: booleanProperty(CONFIRMATION_COPY)
    }
  ),
  tool(
    'create_account',
    'Create a validated account and, when supplied, its opening-balance transaction.',
    ACCOUNT_WRITE_PROPERTIES,
    ['name']
  ),
  tool('update_account', 'Partially update an account, preserving fields not supplied.', {
    account: stringProperty('Account ID or exact account name, matched case-insensitively.'),
    accountId: stringProperty('Account ID or exact account name, matched case-insensitively.'),
    ...ACCOUNT_UPDATE_PROPERTIES
  }),
  tool('archive_account', `Archive an account. Confirmation is required. ${CONFIRMATION_COPY}`, {
    account: stringProperty('Account ID or exact account name, matched case-insensitively.'),
    accountId: stringProperty('Account ID or exact account name, matched case-insensitively.'),
    confirmed: booleanProperty(CONFIRMATION_COPY)
  }),
  tool('restore_account', 'Restore an archived account.', {
    account: stringProperty('Account ID or exact account name, matched case-insensitively.'),
    accountId: stringProperty('Account ID or exact account name, matched case-insensitively.')
  }),
  tool(
    'retire_account',
    `Retire a liability account. Confirmation is required. ${CONFIRMATION_COPY}`,
    {
      account: stringProperty('Account ID or exact account name, matched case-insensitively.'),
      accountId: stringProperty('Account ID or exact account name, matched case-insensitively.'),
      confirmed: booleanProperty(CONFIRMATION_COPY)
    }
  ),
  tool(
    'delete_account',
    `Delete an unused account or archive a referenced one. Confirmation is required. ${CONFIRMATION_COPY}`,
    {
      account: stringProperty('Account ID or exact account name, matched case-insensitively.'),
      accountId: stringProperty('Account ID or exact account name, matched case-insensitively.'),
      confirmed: booleanProperty(CONFIRMATION_COPY)
    }
  ),
  tool(
    'create_category',
    'Create a category and its linked posting account.',
    {
      name: stringProperty('Category name.'),
      type: stringProperty('Category type.', {
        enum: ['expense', 'income', 'debt', 'savings']
      }),
      postingAccountName: stringProperty('Optional linked posting-account name.'),
      ...CATEGORY_CUSTOMIZATION_PROPERTIES
    },
    ['name']
  ),
  tool(
    'update_category',
    'Update one category. For a general semantic icon request, use auto_assign_category_icons instead of guessing an icon.',
    {
      category: stringProperty('Category ID or exact name, matched case-insensitively.'),
      categoryId: stringProperty('Category ID or exact name, matched case-insensitively.'),
      ...CATEGORY_CUSTOMIZATION_PROPERTIES
    }
  ),
  tool(
    'auto_assign_category_icons',
    'Atomically fix semantic icon mismatches by category name and type (for example, Telecommunications uses phone_iphone and Personal Care never uses directions_car). Existing custom icons are replaced.',
    {
      scope: stringProperty('Whether to update active categories only or every category.', {
        enum: ['active', 'all']
      }),
      includeSystem: booleanProperty(
        'Whether appearance-only updates may include system categories. Defaults to true.'
      )
    }
  ),
  tool('rename_category', 'Rename a category.', {
    category: stringProperty('Category ID or exact name, matched case-insensitively.'),
    categoryId: stringProperty('Category ID or exact name, matched case-insensitively.'),
    name: stringProperty('New category name.')
  }),
  tool('update_category_linked_account', 'Rename or create the category linked posting account.', {
    category: stringProperty('Category ID or exact name, matched case-insensitively.'),
    categoryId: stringProperty('Category ID or exact name, matched case-insensitively.'),
    linkedAccountName: stringProperty('Linked posting-account name.')
  }),
  tool(
    'archive_category',
    `Hide a category from new entries. Confirmation is required. ${CONFIRMATION_COPY}`,
    {
      category: stringProperty('Category ID or exact name, matched case-insensitively.'),
      categoryId: stringProperty('Category ID or exact name, matched case-insensitively.'),
      confirmed: booleanProperty(CONFIRMATION_COPY)
    }
  ),
  tool('restore_category', 'Restore a hidden category.', {
    category: stringProperty('Category ID or exact name, matched case-insensitively.'),
    categoryId: stringProperty('Category ID or exact name, matched case-insensitively.')
  }),
  tool(
    'delete_category',
    `Delete an unreferenced category. Confirmation is required. ${CONFIRMATION_COPY}`,
    {
      category: stringProperty('Category ID or exact name, matched case-insensitively.'),
      categoryId: stringProperty('Category ID or exact name, matched case-insensitively.'),
      confirmed: booleanProperty(CONFIRMATION_COPY)
    }
  ),
  tool(
    'set_budget',
    'Create or update a category budget on a workbook sheet.',
    {
      sheet: stringProperty('Sheet ID or exact sheet name, matched case-insensitively.'),
      sheetId: stringProperty('Sheet ID or exact sheet name, matched case-insensitively.'),
      category: stringProperty('Category ID or exact name, matched case-insensitively.'),
      categoryId: stringProperty('Category ID or exact name, matched case-insensitively.'),
      planned: numberProperty('Positive planned budget amount.'),
      month: stringProperty(
        'Budget month in YYYY-MM format. Use this to create a missing month when no sheet is supplied.'
      ),
      createdAt: stringProperty('Optional budget creation date in YYYY-MM-DD format.')
    },
    ['planned']
  ),
  tool(
    'archive_budget',
    `Remove a category budget from a sheet. Confirmation is required. ${CONFIRMATION_COPY}`,
    {
      sheet: stringProperty('Sheet ID or exact sheet name, matched case-insensitively.'),
      sheetId: stringProperty('Sheet ID or exact sheet name, matched case-insensitively.'),
      category: stringProperty('Category ID or exact name, matched case-insensitively.'),
      categoryId: stringProperty('Category ID or exact name, matched case-insensitively.'),
      confirmed: booleanProperty(CONFIRMATION_COPY)
    }
  ),
  tool(
    'create_bill',
    'Create a validated bill or subscription tracker. An active expense category is required.',
    BILL_WRITE_PROPERTIES,
    ['name', 'category', 'dueDate']
  ),
  tool('update_bill', 'Partially update a bill or subscription, preserving fields not supplied.', {
    bill: stringProperty('Recurring item ID or exact name, matched case-insensitively.'),
    recurringItemId: stringProperty('Recurring item ID or exact name, matched case-insensitively.'),
    ...BILL_WRITE_PROPERTIES,
    confirmed: booleanProperty(
      'Required when changing an active bill or subscription to inactive. ' + CONFIRMATION_COPY
    )
  }),
  tool(
    'pay_bill',
    'Record a bill or subscription payment as a validated linked Cavalry transaction. This records ledger activity; it does not send money. Existing reconciled or high-confidence ledger matches are reused; other possible duplicates require confirmation before posting.',
    {
      bill: stringProperty('Recurring item ID or exact name, matched case-insensitively.'),
      recurringItemId: stringProperty(
        'Recurring item ID or exact name, matched case-insensitively.'
      ),
      date: stringProperty('Payment posting date in YYYY-MM-DD format. Defaults to today.'),
      amount: numberProperty('Optional positive amount; defaults to the saved recurring amount.'),
      currency: stringProperty('Optional ISO currency code; defaults to the recurring currency.'),
      account: stringProperty(
        'Optional payment account ID or exact name, matched case-insensitively.'
      ),
      accountId: stringProperty(
        'Optional payment account ID or exact name, matched case-insensitively.'
      ),
      category: stringProperty(
        'Optional expense category ID or exact name, matched case-insensitively.'
      ),
      categoryId: stringProperty(
        'Optional expense category ID or exact name, matched case-insensitively.'
      ),
      description: stringProperty('Optional transaction description; defaults to the bill name.'),
      note: stringProperty('Optional transaction note; defaults to the saved recurring note.'),
      fxRateToBase: numberProperty('Optional exchange rate from transaction currency to base.'),
      allowDuplicate: booleanProperty(
        'Set true only after the user confirms posting a possible duplicate payment.'
      )
    }
  ),
  tool(
    'archive_bill',
    `Archive a bill or subscription. Confirmation is required. ${CONFIRMATION_COPY}`,
    {
      bill: stringProperty('Recurring item ID or exact name, matched case-insensitively.'),
      recurringItemId: stringProperty(
        'Recurring item ID or exact name, matched case-insensitively.'
      ),
      confirmed: booleanProperty(CONFIRMATION_COPY)
    }
  ),
  tool(
    'create_counterparty',
    'Create a person, merchant, biller, employer, family member, or client.',
    {
      name: stringProperty('Counterparty name.'),
      kind: stringProperty('Counterparty kind.', {
        enum: ['employer', 'family', 'client', 'merchant', 'biller', 'other']
      }),
      note: stringProperty('Optional counterparty note.')
    },
    ['name']
  ),
  tool(
    'archive_counterparty',
    `Archive a counterparty. Confirmation is required. ${CONFIRMATION_COPY}`,
    {
      counterparty: stringProperty('Counterparty ID or exact name, matched case-insensitively.'),
      counterpartyId: stringProperty('Counterparty ID or exact name, matched case-insensitively.'),
      confirmed: booleanProperty(CONFIRMATION_COPY)
    }
  ),
  tool(
    'set_exchange_rate',
    'Set the workbook USD-to-base conversion rate.',
    { usdRate: numberProperty('Positive USD-to-base conversion rate.') },
    ['usdRate']
  ),
  tool(
    'navigate_app',
    'Navigate Cavalry to a page without changing workbook data.',
    { routeId: stringProperty('Destination route.', { enum: APP_ROUTES }) },
    ['routeId']
  ),
  tool('save_workbook', 'Save the freshest workbook state now.')
]);

export const TOOL_NAMES = new Set(CAVALRY_ASSISTANT_TOOLS.map((definition) => definition.name));

export function getCavalryAssistantToolDefinitions() {
  return clonePlain(CAVALRY_ASSISTANT_TOOLS);
}
