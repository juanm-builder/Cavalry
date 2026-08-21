import { CATEGORY_ICONS } from '../categories/category-options.js';

export const APP_ROUTES = Object.freeze([
  'dashboard',
  'ledger',
  'budgets',
  'accounts',
  'bills',
  'categories',
  'settings'
]);

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
  color: {
    type: 'string',
    description: 'Category color as a six-digit hexadecimal value, such as #499eee.',
    pattern: '^#[0-9a-fA-F]{6}$'
  },
  description: stringProperty('Optional category description, up to 80 characters.'),
  plannerBucketId: stringProperty('Optional planner group ID; use an empty string to unassign.'),
  autoCategorizeRules: {
    type: 'array',
    description: 'Optional rules used to categorize matching transaction descriptions.',
    items: CATEGORY_RULE_SCHEMA
  }
});
