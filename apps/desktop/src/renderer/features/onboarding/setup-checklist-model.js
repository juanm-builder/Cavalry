import { hasCavalryAssistantConversationActivity } from '../assistant/cavalry-assistant-conversations.js';

// createWorkbook seeds Cash, Opening Balance Equity, Income, and General Expense.
const SEEDED_ACCOUNT_COUNT = 4;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function hasUserAccount(workbook) {
  return asArray(workbook?.accounts).length > SEEDED_ACCOUNT_COUNT;
}

export function hasTransaction(workbook) {
  return asArray(workbook?.transactions).length > 0;
}

export function hasBudget(workbook) {
  return asArray(workbook?.sheets).some(
    (sheet) => asArray(sheet?.budgets).length > 0 || asArray(sheet?.budgetLineItems).length > 0
  );
}

export function isAssistantConnected(settings = {}) {
  if (settings.provider === 'custom') return true;
  return settings.provider === 'openai' && settings.hasApiKey === true;
}

export function hasAssistantConversation(workbook, options = {}) {
  if (!workbook) return false;
  return hasCavalryAssistantConversationActivity(workbook, options);
}

export function buildSetupChecklist({
  workbook = null,
  assistantConnected = false,
  assistantAsked = false
} = {}) {
  const items = [
    {
      id: 'workbook',
      icon: 'book_2',
      label: 'Create your first workbook',
      description: 'Your private home for accounts, budgets, and plans.',
      complete: Boolean(workbook)
    },
    {
      id: 'account',
      icon: 'account_balance_wallet',
      label: 'Add an account',
      description: 'Track where your money lives.',
      complete: hasUserAccount(workbook)
    },
    {
      id: 'transaction',
      icon: 'receipt_long',
      label: 'Add a transaction',
      description: 'Record income, spending, or a transfer.',
      complete: hasTransaction(workbook)
    },
    {
      id: 'budget',
      icon: 'savings',
      label: 'Create a budget',
      description: 'Set a simple monthly limit for a category.',
      complete: hasBudget(workbook)
    },
    {
      id: 'assistant-connect',
      icon: 'link',
      label: 'Connect the AI Companion',
      description: 'Choose a local model or add an API key.',
      complete: assistantConnected
    },
    {
      id: 'assistant-ask',
      icon: 'forum',
      label: 'Ask the AI Companion a question',
      description: 'Try “Where is my money going?”',
      complete: assistantAsked
    }
  ];
  const completedCount = items.filter((item) => item.complete).length;
  return {
    items,
    completedCount,
    totalCount: items.length,
    allComplete: completedCount === items.length
  };
}
