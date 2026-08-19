// Resolves every application route through the single React shell.

import React from 'react';

import { AccountRoute } from '../features/accounts/AccountRoute.jsx';
import { BudgetRoute } from '../features/budgets/BudgetRoute.jsx';
import { CategoryRoute } from '../features/categories/CategoryRoute.jsx';
import { DashboardRoute } from '../features/dashboard/DashboardRoute.jsx';
import { BillsRoute } from '../features/recurring/BillsRoute.jsx';
import { SettingsRoute } from '../features/settings/SettingsRoute.jsx';
import { TransactionRoute } from '../features/transactions/TransactionRoute.jsx';
import { getRouteById } from './routes.js';
import { NotesRouteContainer } from './NotesRouteContainer.jsx';

export function AppRouter({ routeId, routeModels = {}, routeProps = {}, onAction }) {
  const route = getRouteById(routeId);

  if (route.component === 'settings') {
    const props = routeProps.settings || {};
    return (
      <SettingsRoute
        key={props.instanceKey}
        {...props}
        model={props.model || routeModels.settings || {}}
        onAction={props.onAction || onAction}
      />
    );
  }

  if (route.component === 'budgets') {
    const props = routeProps.budgets || {};
    return (
      <BudgetRoute
        {...props}
        model={props.model || routeModels.budgets || {}}
        onAction={props.onAction || onAction}
      />
    );
  }

  if (route.component === 'dashboard') {
    const props = routeProps.dashboard || {};
    return (
      <DashboardRoute
        {...props}
        model={props.model || routeModels.dashboard || {}}
        onAction={props.onAction || onAction}
      />
    );
  }

  if (route.component === 'notes') {
    return <NotesRouteContainer onAction={onAction} />;
  }

  if (route.component === 'categories') {
    const props = routeProps.categories || {};
    return (
      <CategoryRoute
        {...props}
        model={props.model || routeModels.categories || {}}
        onAction={props.onAction || onAction}
      />
    );
  }

  if (route.component === 'accounts') {
    const { key: instanceKey, ...props } = routeProps.accounts || {};
    return (
      <AccountRoute
        key={instanceKey}
        {...props}
        model={props.model || routeModels.accounts || {}}
        onAction={props.onAction || onAction}
      />
    );
  }

  if (route.component === 'transactions') {
    const props = routeProps.transactions || {};
    return (
      <TransactionRoute
        {...props}
        model={props.model || routeModels.transactions || {}}
        onAction={props.onAction || onAction}
      />
    );
  }

  if (route.component === 'bills') {
    const props = routeProps.bills || {};
    return (
      <BillsRoute
        {...props}
        model={props.model || routeModels.bills || {}}
        onAction={props.onAction || onAction}
      />
    );
  }

  return null;
}
