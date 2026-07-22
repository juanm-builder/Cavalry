import React, { useEffect, useMemo, useRef, useState } from 'react';

import { NAVIGATION_ROUTES } from '../app/routes.js';
import { CavalryAssistantMark } from '../features/assistant/CavalryAssistantMark.jsx';

function Icon({ name }) {
  return (
    <span aria-hidden="true" className="material-symbols-rounded">
      {name}
    </span>
  );
}

function includesQuery(item, query) {
  if (!query) return true;
  return `${item.label} ${item.description || ''}`.toLowerCase().includes(query);
}

export function CommandPalette({
  activeRouteId,
  onClose,
  onNavigate,
  onAddTransaction,
  onAddAccount,
  onAskAssistant,
  onAskAdvisor,
  onOpenSetupGuide
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  useEffect(() => {
    const focusTimer = setTimeout(() => searchRef.current?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const quickActions = useMemo(() => {
    const askAssistant = onAskAssistant || onAskAdvisor;
    const askLabel = typeof onAskAssistant === 'function' ? 'Ask Cavalry' : 'Ask Advisor';
    return [
      typeof onAddTransaction === 'function'
        ? {
            id: 'add-transaction',
            icon: 'add_card',
            label: 'Add transaction',
            description: 'Record income, spending, or a transfer',
            run: onAddTransaction
          }
        : null,
      typeof onAddAccount === 'function'
        ? {
            id: 'add-account',
            icon: 'account_balance_wallet',
            label: 'Add account',
            description: 'Create an asset, liability, or tracking account',
            run: onAddAccount
          }
        : null,
      typeof askAssistant === 'function'
        ? {
            id: 'ask-cavalry',
            companionLogo: true,
            label: askLabel,
            description: 'Ask a question or take action in this workbook',
            run: askAssistant
          }
        : null,
      typeof onOpenSetupGuide === 'function'
        ? {
            id: 'setup-guide',
            icon: 'checklist',
            label: 'Open setup guide',
            description: 'Finish setting up your workspace',
            run: onOpenSetupGuide
          }
        : null
    ].filter(Boolean);
  }, [onAddAccount, onAddTransaction, onAskAdvisor, onAskAssistant, onOpenSetupGuide]);

  const normalizedQuery = query.trim().toLowerCase();
  const routes = NAVIGATION_ROUTES.filter((route) => includesQuery(route, normalizedQuery));
  const actions = quickActions.filter((action) => includesQuery(action, normalizedQuery));
  const hasResults = routes.length || actions.length;
  const run = (callback) => {
    onClose?.();
    callback?.();
  };

  return (
    <div
      className="command-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <section
        aria-label="Command menu"
        aria-modal="true"
        className="command-palette"
        role="dialog"
      >
        <div className="command-search">
          <Icon name="search" />
          <input
            aria-label="Search commands"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Go to a page or run an action…"
            ref={searchRef}
            type="search"
            value={query}
          />
          <kbd>esc</kbd>
        </div>
        <div className="command-results">
          {actions.length ? (
            <div className="command-group">
              <p>Quick actions</p>
              {actions.map((action) => (
                <button key={action.id} onClick={() => run(action.run)} type="button">
                  <span className="command-result-icon">
                    {action.companionLogo ? (
                      <CavalryAssistantMark className="cavalry-assistant-inline-mark" />
                    ) : (
                      <Icon name={action.icon} />
                    )}
                  </span>
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.description}</small>
                  </span>
                  <Icon name="arrow_forward" />
                </button>
              ))}
            </div>
          ) : null}
          {routes.length ? (
            <div className="command-group">
              <p>Pages</p>
              {routes.map((route) => (
                <button
                  key={route.id}
                  onClick={() => run(() => onNavigate?.(route.id))}
                  type="button"
                >
                  <span className="command-result-icon">
                    <Icon name={route.icon} />
                  </span>
                  <span>
                    <strong>{route.label}</strong>
                    <small>{route.description}</small>
                  </span>
                  {route.id === activeRouteId ? (
                    <span className="command-current">Current</span>
                  ) : (
                    <Icon name="arrow_forward" />
                  )}
                </button>
              ))}
            </div>
          ) : null}
          {!hasResults ? (
            <div className="command-empty">
              <Icon name="search_off" />
              <strong>No matching command</strong>
              <span>Try a page name such as “Budget” or an action such as “Add”.</span>
            </div>
          ) : null}
        </div>
        <footer className="command-footer">
          <span>
            <kbd>⌘</kbd>
            <kbd>K</kbd> open menu
          </span>
          <span>Type to filter</span>
        </footer>
      </section>
    </div>
  );
}
