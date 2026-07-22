import { CAVALRY_ACTION_PLAN_VERSION } from './schema.js';

export function getExampleTransactionActionPlan(options = {}) {
  const date = String(options.date || '2026-06-27');
  return {
    cavalry_action_plan_version: CAVALRY_ACTION_PLAN_VERSION,
    source: 'chatgpt',
    generated_at: String(options.generatedAt || '2026-06-27T10:44:25.095Z'),
    workbook_name: String(options.workbookName || 'The Plan'),
    timezone: String(options.timezone || 'Asia/Manila'),
    currency_default: String(options.currencyDefault || 'PHP'),
    date_default: date,
    user_goal: 'Add two transactions from chat',
    actions: [
      {
        id: 'action_001',
        type: 'create_transaction',
        date,
        description: 'Printer paper',
        amount: 150,
        currency: 'PHP',
        direction: 'expense',
        payment_account_hint: 'Office Cash Account',
        category_hint: 'Office Supplies',
        confidence: 'high',
        source_text: '150 pesos for printer paper charged to Office Cash Account'
      },
      {
        id: 'action_002',
        type: 'create_transaction',
        date,
        description: 'OpenAI API credits',
        amount: 15,
        currency: 'USD',
        direction: 'expense',
        payment_account_hint: 'Credit Card',
        category_hint: 'Software',
        notes: 'Purchased credits for OpenAI API',
        confidence: 'high',
        source_text: '15usd charged to my credit card. purchased credits for open ai API'
      }
    ]
  };
}

export function getExampleRecurringActionPlan() {
  return {
    cavalry_action_plan_version: CAVALRY_ACTION_PLAN_VERSION,
    source: 'chatgpt',
    currency_default: 'PHP',
    actions: [
      {
        id: 'recurring_001',
        type: 'create_recurring_item',
        name: 'ChatGPT Pro',
        amount: 6490,
        currency: 'PHP',
        cadence: 'monthly',
        category_hint: 'Subscriptions',
        confidence: 'high'
      },
      {
        id: 'recurring_002',
        type: 'create_recurring_item',
        name: 'RFID Card Load',
        amount: 1012,
        currency: 'PHP',
        cadence: 'unknown',
        category_hint: 'Transport',
        confidence: 'low'
      }
    ]
  };
}
