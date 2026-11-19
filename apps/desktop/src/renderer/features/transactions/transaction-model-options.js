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
    template: 'merchant_refund',
    kind: 'refund',
    categoryType: 'expense',
    label: 'Refund',
    description: 'Reverse an earlier purchase',
    example: 'e.g. returned item or card reversal',
    icon: 'undo',
    tone: 'good'
  },
  {
    template: 'income_received',
    kind: 'income',
    label: 'Income',
    description: 'Money coming in',
    example: 'e.g. salary, client payment, gift',
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

export const TEMPLATE_OPTIONS = Object.freeze([
  { value: 'expense_paid', label: 'Expense paid' },
  { value: 'expense_charged', label: 'Expense charged' },
  { value: 'income_received', label: 'Income received' },
  { value: 'merchant_refund', label: 'Merchant refund' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'debt_payment', label: 'Debt payment' },
  { value: 'liability_payment', label: 'Liability payment' },
  { value: 'opening_balance', label: 'Opening balance' }
]);

export const ACCOUNT_EDIT_CONTEXTS = Object.freeze({
  bank: {
    kind: 'bank',
    title: 'Edit Bank Transaction',
    badge: 'Bank transaction',
    label: 'Bank account',
    fieldLabel: 'bank account',
    icon: 'account_balance',
    accent: '#14804f',
    description: 'Update the activity recorded against this bank account.',
    descriptionPlaceholder: 'e.g., ATM withdrawal, deposit, or bank transfer'
  },
  cash: {
    kind: 'cash',
    title: 'Edit Cash Transaction',
    badge: 'Cash transaction',
    label: 'Cash account',
    fieldLabel: 'cash account',
    icon: 'payments',
    accent: '#14804f',
    description: 'Update this cash movement and its balance impact.',
    descriptionPlaceholder: 'e.g., Cash purchase or cash received'
  },
  wallet: {
    kind: 'wallet',
    title: 'Edit E-Wallet Transaction',
    badge: 'E-wallet transaction',
    label: 'E-wallet',
    fieldLabel: 'e-wallet',
    icon: 'account_balance_wallet',
    accent: '#14804f',
    description: 'Update this wallet payment, receipt, or transfer.',
    descriptionPlaceholder: 'e.g., QR payment, wallet top-up, or transfer'
  },
  credit_card: {
    kind: 'credit_card',
    title: 'Edit Credit Card Transaction',
    badge: 'Credit card transaction',
    label: 'Credit card',
    fieldLabel: 'credit card',
    icon: 'credit_card',
    accent: '#7048d7',
    description: 'Update this card purchase, fee, refund, or payment.',
    descriptionPlaceholder: 'e.g., Card purchase, annual fee, or payment'
  },
  investment: {
    kind: 'investment',
    title: 'Edit Investment Transaction',
    badge: 'Investment transaction',
    label: 'Investment account',
    fieldLabel: 'investment account',
    icon: 'trending_up',
    accent: '#1756b5',
    description: 'Update this contribution, withdrawal, distribution, or transfer.',
    descriptionPlaceholder: 'e.g., Contribution, distribution, or account fee'
  },
  liability: {
    kind: 'liability',
    title: 'Edit Liability Transaction',
    badge: 'Liability transaction',
    label: 'Liability account',
    fieldLabel: 'liability account',
    icon: 'request_quote',
    accent: '#bf2f31',
    description: 'Update this loan, debt, or liability payment.',
    descriptionPlaceholder: 'e.g., Loan payment, interest, or adjustment'
  },
  asset: {
    kind: 'asset',
    title: 'Edit Asset Transaction',
    badge: 'Asset transaction',
    label: 'Asset account',
    fieldLabel: 'asset account',
    icon: 'account_balance_wallet',
    accent: '#14804f',
    description: 'Update this account activity and its balance impact.',
    descriptionPlaceholder: 'Describe this transaction'
  }
});
