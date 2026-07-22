export const CREATE_TYPE_OPTIONS = Object.freeze([
  {
    template: 'expense_paid',
    kind: 'expense',
    label: 'Expense',
    description: 'Pay now or charge a credit card',
    example: 'e.g. groceries, bills, card purchases',
    icon: 'arrow_downward',
    tone: 'bad'
  },
  {
    template: 'income_received',
    kind: 'income',
    label: 'Income',
    description: 'Money coming in',
    example: 'e.g. salary, refund, gift',
    icon: 'arrow_upward',
    tone: 'good'
  },
  {
    template: 'transfer',
    kind: 'transfer',
    label: 'Transfer',
    description: 'Move money between accounts',
    example: 'e.g. BPI to Maya or pay a credit card',
    icon: 'sync_alt',
    tone: 'info'
  }
]);
