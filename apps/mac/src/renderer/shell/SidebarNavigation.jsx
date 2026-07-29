import React from 'react';

import { NAVIGATION_ROUTES } from '../app/routes.js';
import cavalryMark from '../assets/cavalry-mark.png';
import {
  isSidebarUpdateVisible,
  SidebarUpdateProgress,
  SidebarUpdateStatus
} from './SidebarUpdateStatus.jsx';

const NAVIGATION_GROUPS = Object.freeze([
  Object.freeze({ id: 'home', label: 'Workspace', routes: ['dashboard', 'notes'] }),
  Object.freeze({
    id: 'money',
    label: 'Money',
    routes: ['ledger', 'budgets', 'accounts', 'bills']
  }),
  Object.freeze({ id: 'manage', label: 'Manage', routes: ['categories', 'settings'] })
]);

function CavalryMark() {
  return (
    <span
      aria-label="Cavalry"
      className="brand-symbol"
      role="img"
      style={{ '--brand-symbol-source': `url(${cavalryMark})` }}
      title="Cavalry"
    />
  );
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function NavigationButton({ route, activeRouteId, pendingDraftCount, onNavigate }) {
  const isActive = route.id === activeRouteId;
  const badgeCount = route.id === 'ai-drafts' ? normalizeCount(pendingDraftCount) : 0;
  const accessibleLabel = badgeCount ? `${route.label}, ${badgeCount} pending` : route.label;

  return (
    <button
      aria-current={isActive ? 'page' : undefined}
      aria-label={accessibleLabel}
      className={`nav-item${isActive ? ' active' : ''}`}
      onClick={() => onNavigate?.(route.id)}
      title={route.label}
      type="button"
    >
      <span className="nav-copy">
        <span aria-hidden="true" className="material-symbols-rounded">
          {route.icon}
        </span>
        <span>
          <b>{route.label}</b>
          <small>{route.description}</small>
        </span>
      </span>
      {badgeCount ? <span className="nav-count">{badgeCount}</span> : null}
    </button>
  );
}

export function SidebarNavigation({
  activeRouteId,
  compact = false,
  workbookName = 'Finance workspace',
  pendingDraftCount = 0,
  userInitials = 'CA',
  userLabel = 'Cavalry User',
  update,
  onNavigate,
  onAddTransaction,
  onAddAccount
}) {
  const hasQuickActions =
    typeof onAddTransaction === 'function' || typeof onAddAccount === 'function';
  const updateVisible = isSidebarUpdateVisible(update?.state);
  const updateStatus = ['available', 'downloading', 'ready', 'error'].includes(
    update?.state?.status
  )
    ? update.state.status
    : '';

  return (
    <aside aria-label="Application sidebar" className="nav-rail">
      <div className="brand-block">
        <CavalryMark />
        <div className="brand-copy">
          <strong>Cavalry</strong>
          <small>{workbookName || 'Finance workspace'}</small>
        </div>
      </div>

      <nav aria-label="Workbook" className="rail-section nav-groups">
        {NAVIGATION_GROUPS.map((group) => (
          <section className="nav-group" key={group.id}>
            <p className="nav-group-label">{group.label}</p>
            <div className="nav-list nav-list-expanded">
              {group.routes.map((routeId) => {
                const route = NAVIGATION_ROUTES.find((item) => item.id === routeId);
                return route ? (
                  <NavigationButton
                    key={route.id}
                    activeRouteId={activeRouteId}
                    onNavigate={onNavigate}
                    pendingDraftCount={pendingDraftCount}
                    route={route}
                  />
                ) : null;
              })}
            </div>
          </section>
        ))}
      </nav>

      {hasQuickActions ? (
        <section aria-label="Quick add" className="quick-add-card">
          {!compact ? (
            <div className="quick-add-title">
              <div>
                <strong>Quick Add</strong>
                <small>Capture money movement fast</small>
              </div>
              <span aria-hidden="true" className="quick-add-badge">
                +
              </span>
            </div>
          ) : null}
          {typeof onAddTransaction === 'function' ? (
            <button
              aria-label="Add Transaction"
              className="quick-add-primary"
              onClick={onAddTransaction}
              title="Add Transaction"
              type="button"
            >
              <span aria-hidden="true" className="material-symbols-rounded">
                receipt_long
              </span>
              Add Transaction
            </button>
          ) : null}
          {typeof onAddAccount === 'function' ? (
            <button
              aria-label="Add Account"
              onClick={onAddAccount}
              title="Add Account"
              type="button"
            >
              <span aria-hidden="true" className="material-symbols-rounded">
                account_balance_wallet
              </span>
              Add Account
            </button>
          ) : null}
        </section>
      ) : null}

      <SidebarUpdateProgress update={update} />

      <div className={`rail-user-card${updateVisible ? ` has-update update-${updateStatus}` : ''}`}>
        <span aria-hidden="true">{userInitials}</span>
        <strong>{userLabel}</strong>
        <SidebarUpdateStatus update={update} />
        <button
          aria-label="Settings"
          className="btn btn-icon"
          onClick={() => onNavigate?.('settings')}
          title="Settings"
          type="button"
        >
          <span aria-hidden="true" className="material-symbols-rounded">
            settings
          </span>
        </button>
      </div>
    </aside>
  );
}
