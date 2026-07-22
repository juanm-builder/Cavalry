export const NAVIGATION_ROUTES = Object.freeze([
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'space_dashboard',
    description: 'High-level money state',
    component: 'dashboard'
  },
  {
    id: 'ledger',
    label: 'Transactions',
    icon: 'receipt_long',
    description: 'Post and review money movement',
    component: 'transactions'
  },
  {
    id: 'budgets',
    label: 'Budget',
    icon: 'pie_chart',
    description: 'Monthly plan and actuals',
    component: 'budgets'
  },
  {
    id: 'accounts',
    label: 'Accounts',
    icon: 'account_balance_wallet',
    description: 'Balances and account details',
    component: 'accounts'
  },
  {
    id: 'bills',
    label: 'Bills & Subscriptions',
    icon: 'event_repeat',
    description: 'Recurring payments and due dates',
    component: 'bills'
  },
  {
    id: 'categories',
    label: 'Categories',
    icon: 'category',
    description: 'Posting categories and linked accounts',
    component: 'categories'
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    description: 'Rates, backups, and files',
    component: 'settings'
  }
]);

export const ROUTES = NAVIGATION_ROUTES;

export const DEFAULT_ROUTE_ID = 'dashboard';

export function getRouteById(routeId) {
  const id = String(routeId || DEFAULT_ROUTE_ID);
  return ROUTES.find((route) => route.id === id) || ROUTES[0];
}
