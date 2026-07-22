import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from '../../src/renderer/App.jsx';
import { AppShell } from '../../src/renderer/app/AppShell.jsx';
import { normalizeCommandResult } from '../../src/renderer/app/CommandExecutor.jsx';
import { DEFAULT_ROUTE_ID, getRouteById } from '../../src/renderer/app/routes.js';

function makeSettingsModel() {
  return {
    summaryItems: [
      {
        id: 'workbook',
        icon: 'account_balance_wallet',
        title: 'Shell Workbook',
        detail: '0 transactions'
      }
    ],
    workbook: {
      currency: 'PHP',
      usdRate: '58',
      details: [{ label: 'Workbook', detail: 'Shell Workbook' }]
    },
    advisor: {
      providerLabel: 'Built-in',
      modelPlaceholder: 'cavalry-advisor',
      endpointPlaceholder: 'http://127.0.0.1:8080/v1/chat/completions',
      apiKeyPlaceholder: 'Optional for local endpoints',
      settings: { provider: 'local' },
      toggle: {},
      microphone: {},
      statusLine: 'Current provider: Built-in'
    },
    files: {},
    counterparties: [],
    health: {
      tone: 'good',
      label: 'Clear',
      issues: []
    }
  };
}

describe('AppShell', () => {
  it('routes the first migrated settings route through the shell', () => {
    const html = renderToStaticMarkup(
      React.createElement(AppShell, {
        routeId: 'settings',
        routeModels: { settings: makeSettingsModel() }
      })
    );

    expect(html).toContain('data-renderer-shell="app-shell"');
    expect(html).toContain('data-react-route="settings"');
    expect(html).toContain('Shell Workbook');
  });

  it('retires the legacy Advisor route and falls back to the dashboard', () => {
    const html = renderToStaticMarkup(
      React.createElement(AppShell, {
        routeId: 'advisor',
        routeModels: {
          advisor: {
            chatTitle: 'Shell Advisor',
            questionPresets: ['Review cash flow'],
            voiceButton: {
              icon: 'mic',
              title: 'Dictate to Advisor',
              ariaLabel: 'Dictate to Advisor'
            }
          }
        }
      })
    );

    expect(html).toContain('data-renderer-shell="app-shell"');
    expect(html).toContain('data-react-route="dashboard"');
    expect(html).toContain('Ask Cavalry');
    expect(html).not.toContain('data-react-route="advisor"');
    expect(html).not.toContain('Shell Advisor');
  });

  it('defaults production boot to dashboard hydration', () => {
    const html = renderToStaticMarkup(React.createElement(App));

    expect(DEFAULT_ROUTE_ID).toBe('dashboard');
    expect(html).toContain('data-renderer-shell="app-shell"');
    expect(html).toContain('Loading workbook');
  });

  it('keeps migrated React routes explicitly addressable', () => {
    const html = renderToStaticMarkup(
      React.createElement(App, { routeId: 'dashboard', autoHydrate: false })
    );

    expect(html).toContain('data-react-route="dashboard"');
  });

  it('falls back to dashboard for unknown routes', () => {
    expect(getRouteById('not-a-route')).toMatchObject({
      id: 'dashboard',
      component: 'dashboard'
    });
  });

  it('normalizes command-result objects for command services', () => {
    expect(
      normalizeCommandResult({
        ok: true,
        workbook: { id: 'wb-shell' },
        events: [{ type: 'schedule-save' }],
        warnings: [{ code: 'heads-up' }]
      })
    ).toEqual({
      ok: true,
      workbook: { id: 'wb-shell' },
      events: [{ type: 'schedule-save' }],
      warnings: [{ code: 'heads-up' }],
      errors: []
    });

    expect(normalizeCommandResult(null)).toEqual({
      ok: false,
      workbook: undefined,
      events: [],
      warnings: [],
      errors: []
    });
  });
});
