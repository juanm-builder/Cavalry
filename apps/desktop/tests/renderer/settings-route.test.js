import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsRoute } from '../../src/renderer/features/settings/SettingsRoute.jsx';

function buildSettingsRouteFixture() {
  return {
    summaryItems: [
      {
        id: 'workbook',
        icon: 'account_balance_wallet',
        title: 'The Plan',
        detail: '5 accounts • 10 transactions'
      },
      { id: 'save', icon: 'save', title: 'Saved', detail: 'Cavalry.html' },
      {
        id: 'advisor',
        icon: 'psychology_alt',
        title: 'Local llama.cpp • cavalry-advisor',
        detail: 'Ready'
      },
      {
        id: 'health',
        icon: 'health_and_safety',
        title: 'Clear',
        detail: 'Workbook validation passed',
        titleClassName: 'status-good'
      }
    ],
    workbook: {
      name: 'The Plan',
      currency: 'PHP',
      usdRate: '56.2',
      details: [
        { label: 'Visible Date Range', detail: 'April 1 - June 19, 2026' },
        { label: 'Last Saved', detail: 'just now' },
        { label: 'File Link', detail: 'Cavalry.html', amount: 'Linked' }
      ]
    },
    advisor: {
      providerLabel: 'Local llama.cpp',
      fieldsDisabled: false,
      modelLocationDisabled: false,
      modelPlaceholder: 'cavalry-advisor',
      endpointPlaceholder: 'http://127.0.0.1:8080/v1/chat/completions',
      apiKeyPlaceholder: 'Optional for local endpoints',
      settings: {
        provider: 'custom',
        model: 'cavalry-advisor',
        endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
        localModelPath: '/models/cavalry.gguf',
        mmprojPath: '/models/mmproj-cavalry.gguf'
      },
      toggle: {
        disabled: false,
        icon: 'play_arrow',
        label: 'Start Model'
      },
      statusLine: 'Current provider: Local llama.cpp',
      connectionLine: '',
      serverLine: 'Server: Local model server is stopped.',
      microphone: {
        title: 'Microphone access',
        detail: 'Request access to use voice input with Advisor.',
        tone: 'info',
        canRequest: true,
        canOpenSettings: false,
        canRefresh: true,
        requestLabel: 'Request Access'
      },
      localStartLine:
        'Cavalry starts llama-server when you start, test, or use the assistant. Image intake requires a matching Vision Projector.'
    },
    files: {
      canSaveFileNow: true,
      canRevealFile: true,
      canChooseAutosaveFile: true,
      canClearFile: true,
      persistentUnavailable: false
    },
    counterparties: [
      { id: 'counterparty-1', name: 'Globe', kindLabel: 'Biller', note: 'Internet' }
    ],
    health: {
      tone: 'good',
      label: 'Clear',
      issues: []
    }
  };
}

function renderSettingsRoute(model = buildSettingsRouteFixture()) {
  return renderToStaticMarkup(React.createElement(SettingsRoute, { model }));
}

describe('SettingsRoute', () => {
  it('renders the Cavalry Assistant model controls', () => {
    const html = renderSettingsRoute();

    expect(html).toContain('class="settings-shell"');
    expect(html).toContain('id="advisor-settings-form"');
    expect(html).toContain('Model connection');
    expect(html).toContain('id="settings-advisor-provider"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('Local Model');
    expect(html).not.toContain('Advisor Model');
    expect(html).toContain('Start Model');
    expect(html).toContain('Test Model');
    expect(html).not.toContain('Save Advisor Model');
    expect(html).not.toContain('Open Advisor');
    expect(html).not.toContain('Cavalry LlamaCPP');
  });

  it('preserves Settings workflow ids and classes used by controller interactions', () => {
    const html = renderSettingsRoute();

    expect(html).toContain('id="usd-rate-form"');
    expect(html).toContain('id="counterparty-form"');
    expect(html).toContain('id="workbook-name-form"');
    expect(html).toContain('id="account-profile-form"');
    expect(html).toContain('id="settings-import-file"');
    expect(html).toContain('Vision Projector');
    expect(html).toContain('aria-label="Archive counterparty"');
    expect(html).toContain('settings-section-nav');
    expect(html).toContain('Workbook');
    expect(html).toContain('Account');
    expect(html).not.toContain('Backups');
    expect(html).not.toContain('Restore');
    expect(html).toContain('settings-layout');
    expect(html).not.toContain('Data health');
    expect(html).not.toContain('settings-data-health');
  });

  it('keeps local settings available when iCloud is unavailable', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: false,
      status: 'unavailable'
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('id="account-profile-form"');
    expect(html).toContain('Stored on this Mac');
    expect(html).toContain('>iCloud<');
    expect(html).toContain('Unavailable');
    expect(html).toContain('iCloud is not connected');
    expect(html).toContain('System Settings');
    expect(html).not.toContain('Continue with Google');
  });

  it('uses the system iCloud account without a separate provider login', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_out',
      user: null,
      workbooks: []
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('Sign in needed');
    expect(html).toContain('System Settings');
    expect(html).toContain('id="account-profile-form"');
    expect(html).not.toContain('Continue with Apple');
    expect(html).not.toContain('Continue with Google');
    expect(html).not.toContain('browser');
  });

  it('shows a connected private iCloud database without exposing account metadata', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_in',
      user: {
        id: 'apple-user',
        name: 'iCloud',
        email: '',
        provider: 'icloud'
      },
      current: {},
      workbooks: []
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('Connected');
    expect(html).toContain('Connected to your private iCloud library');
    expect(html).toContain('Changes save on this Mac before they sync');
    expect(html).not.toContain('apple-user');
    expect(html).not.toContain('relay@privaterelay.appleid.com');
  });

  it('renders accessible actions for every iCloud workbook', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_in',
      user: {
        id: 'user-1',
        name: 'Alex Example',
        email: 'alex@example.com',
        avatarUrl: 'https://images.example.com/alex-example.png'
      },
      current: {
        workbookId: 'workbook-plan',
        name: 'The Plan',
        linked: false,
        status: 'local_only'
      },
      workbooks: [
        {
          id: 'workbook-plan',
          name: 'The Plan',
          year: 2026,
          currency: 'PHP',
          updatedAt: '2026-07-20T04:00:00.000Z'
        },
        {
          id: 'workbook-business',
          name: 'Business 2026',
          year: 2026,
          currency: 'USD',
          updatedAt: '2026-07-19T04:00:00.000Z'
        }
      ]
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('Connected');
    expect(html).toContain('Add to iCloud');
    expect(html).not.toContain('Sync Now');
    expect(html).not.toContain('Sync Workbook');
    expect(html).toContain('2 in iCloud');
    expect(html).toContain('aria-label="iCloud workbooks"');
    expect(html).toContain('aria-label="Open The Plan from iCloud"');
    expect(html).toContain('aria-label="Delete The Plan from iCloud"');
    expect(html).toContain('aria-label="Open Business 2026 from iCloud"');
    expect(html).toContain('aria-label="Delete Business 2026 from iCloud"');
    expect(html).toContain('Current');
    expect(html).toContain('id="account-profile-form"');
    expect(html).not.toContain('Alex Example');
    expect(html).not.toContain('alex@example.com');
  });

  it('counts confirmed and queued iCloud workbooks separately', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_in',
      user: { id: 'user-1', name: 'iCloud' },
      current: {
        workbookId: 'workbook-plan',
        linked: true,
        status: 'pending'
      },
      pendingCount: 1,
      workbooks: [
        {
          id: 'workbook-plan',
          name: 'The Plan',
          revision: 1,
          pending: true
        }
      ]
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('0 in iCloud · 1 waiting');
    expect(html).toContain('Waiting for iCloud');
    expect(html).toContain('Saved on this Mac · waiting for iCloud');
    expect(html).toContain('aria-label="The Plan is waiting for iCloud"');
    expect(html).toContain('aria-label="Cancel upload of The Plan"');
    expect(html).not.toContain('1 in iCloud');
  });

  it('keeps a confirmed workbook counted while its update is waiting', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_in',
      user: { id: 'user-1', name: 'iCloud' },
      current: {
        workbookId: 'workbook-plan',
        linked: true,
        status: 'pending'
      },
      pendingCount: 1,
      workbooks: [
        {
          id: 'workbook-plan',
          name: 'The Plan',
          revision: 2,
          pending: true,
          inCloud: true
        }
      ]
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('1 in iCloud · 1 waiting');
    expect(html).toContain('Waiting for iCloud');
    expect(html).not.toContain('0 in iCloud');
  });

  it('shows explicit sync state for a linked current workbook', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_in',
      user: { id: 'user-1', name: 'Alex Example', email: 'alex@example.com' },
      current: {
        workbookId: 'workbook-plan',
        name: 'The Plan',
        linked: true,
        status: 'synced',
        cloudUpdatedAt: '2026-07-20T04:00:00.000Z'
      },
      workbooks: [
        {
          id: 'workbook-plan',
          name: 'The Plan',
          year: 2026,
          currency: 'PHP',
          updatedAt: '2026-07-20T04:00:00.000Z'
        }
      ]
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('Sync Changes');
    expect(html).toContain('aria-label="Delete The Plan from iCloud"');
    expect(html).toContain('Local copy is safe · iCloud copy updated');
    expect(html).not.toContain('Last synced');
    expect(html).not.toContain('Your iCloud library is empty');
    expect(html).not.toContain('Add to iCloud</button>');
  });

  it('separates an account connection from a terminal iCloud sync problem', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_in',
      user: { id: 'user-1', name: 'iCloud' },
      current: {
        workbookId: 'workbook-plan',
        linked: false,
        status: 'local_only'
      },
      workbooks: [],
      error:
        'iCloud needs a Cavalry database update before it can save this workbook. Your Mac copy is safe.',
      errorCode: 'cloud_database_update_required',
      errorDetails:
        'Technical code: CKError.serverRejectedRequest. The CavalryWorkbook schema must be deployed to Production.',
      errorRetryable: false,
      failedOperation: 'upload'
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('Sync needs attention');
    expect(html).toContain('Connected to your private iCloud library');
    expect(html).toContain('Local copy safe');
    expect(html).toContain('Retry Add');
    expect(html).toContain('View Details');
    expect(html).toContain('The Plan remains saved on this Mac');
    expect(html).toContain('0 in iCloud');
    expect(html).toContain('Your iCloud library is empty');
    expect(html).not.toContain('No iCloud workbooks yet');
  });

  it('does not attribute a library refresh error to the current workbook', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_in',
      user: { id: 'user-1', name: 'iCloud' },
      current: { workbookId: 'workbook-plan', linked: false, status: 'local_only' },
      workbooks: [],
      error: 'The iCloud library could not be refreshed.',
      errorOperation: 'refresh',
      errorRetryable: true
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('No workbook saved on this Mac was changed or deleted.');
    expect(html).not.toContain('The Plan remains saved on this Mac');
    expect(html).toContain('Check Again');
  });

  it('requires explicit review when the current iCloud workbook has changed', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_in',
      user: { id: 'user-1', name: 'Alex Example', email: 'alex@example.com' },
      current: {
        workbookId: 'workbook-plan',
        name: 'The Plan',
        linked: true,
        conflict: true,
        status: 'conflict'
      },
      workbooks: [
        {
          id: 'workbook-plan',
          name: 'The Plan',
          year: 2026,
          currency: 'PHP',
          revision: 8
        }
      ]
    };

    const html = renderSettingsRoute(model);

    expect(html).not.toContain('Both copies are safe. Review each clash and choose what to keep.');
    expect(html).not.toContain('0 decisions needed');
    expect(html).toContain('Choose a version');
    expect(html).toContain('Use Mac Version');
    expect(html).toContain('Use iCloud Version');
    expect(html).toContain('aria-label="Delete The Plan from iCloud"');
    expect(html).not.toContain('Keep Mac Copy');
    expect(html).not.toContain('Review iCloud Copy');
  });

  it('does not offer a missing iCloud version as a conflict choice', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_in',
      user: { id: 'user-1', name: 'iCloud' },
      current: {
        workbookId: 'workbook-plan',
        linked: false,
        conflict: true,
        status: 'conflict'
      },
      workbooks: []
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('Not in iCloud');
    expect(html).toContain('No iCloud version was found');
    expect(html).toContain('Add Mac Version to iCloud');
    expect(html).not.toContain('Use iCloud Version');
    expect(html).not.toContain('Delete The Plan from iCloud');
  });

  it('hides the retired microphone controls from the assistant settings', () => {
    const html = renderSettingsRoute();

    expect(html).not.toContain('Microphone access');
    expect(html).not.toContain('Request Access');
    expect(html).not.toContain('aria-label="Refresh microphone status"');
    expect(html).not.toContain('Open Microphone Settings');

    const model = buildSettingsRouteFixture();
    model.advisor.microphone = {
      title: 'Microphone access blocked',
      detail: 'Enable Cavalry for Mac in macOS Microphone settings.',
      tone: 'bad',
      canRequest: false,
      canOpenSettings: true,
      canRefresh: true
    };
    const deniedHtml = renderSettingsRoute(model);

    expect(deniedHtml).not.toContain('Microphone access blocked');
    expect(deniedHtml).not.toContain('Open Microphone Settings');
    expect(deniedHtml).not.toContain('Request Access');
  });

  it('shows only remote model controls for OpenAI API provider', () => {
    const model = buildSettingsRouteFixture();
    model.advisor = Object.assign({}, model.advisor, {
      providerLabel: 'OpenAI / API',
      modelPlaceholder: 'gpt-5.4-mini',
      endpointPlaceholder: 'https://api.openai.com/v1/responses',
      apiKeyPlaceholder: '************',
      settings: {
        provider: 'openai',
        apiMode: 'responses',
        model: 'gpt-5.4-mini',
        endpoint: 'https://api.openai.com/v1/responses',
        hasApiKey: true,
        apiKeyPreview: '************'
      },
      statusLine: 'Current provider: OpenAI / API',
      serverLine: '',
      localStartLine: ''
    });

    const html = renderSettingsRoute(model);

    expect(html).toContain('OpenAI / API');
    expect(html).not.toContain('OpenAI API key active');
    expect(html).not.toContain('Active for this app session');
    expect(html).not.toContain('OpenAI API key saved');
    expect(html).toContain('value="************"');
    expect(html).toContain('id="settings-advisor-api-key"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-label="Remove saved OpenAI key"');
    expect(html).toContain('Saved OpenAI keys are protected with macOS Keychain.');
    expect(html).not.toContain('ChatGPT is connected');
    expect(html).toContain('name="model"');
    expect(html).toContain('name="apiKey"');
    expect(html).toContain('name="apiMode"');
    expect(html).toContain('name="apiMode" value="responses"');
    expect(html).not.toContain('API Mode');
    expect(html).not.toContain('Responses / Agent');
    expect(html).not.toContain('Chat Completions');
    expect(html).toContain('name="endpoint"');
    expect(html).toContain('Test Model');
    expect(html).not.toContain('Local GGUF Model');
    expect(html).not.toContain('Vision Projector');
    expect(html).not.toContain('Context Allocation');
    expect(html).not.toContain('Start Model');
  });

  it('does not present an OpenAI provider as connected until an API key is saved', () => {
    const model = buildSettingsRouteFixture();
    model.advisor = Object.assign({}, model.advisor, {
      providerLabel: 'OpenAI / API',
      settings: {
        provider: 'openai',
        apiMode: 'responses',
        model: 'gpt-5.4-mini',
        endpoint: 'https://api.openai.com/v1/responses',
        hasApiKey: false,
        apiKeyPreview: ''
      },
      serverLine: '',
      localStartLine: ''
    });

    const html = renderSettingsRoute(model);

    expect(html).toContain('API key required');
    expect(html).toContain('settings-status-pill warn');
  });

  it('allows a GGUF-only local model to be started without a vision projector', () => {
    const model = buildSettingsRouteFixture();
    model.advisor.settings.mmprojPath = '';

    const html = renderSettingsRoute(model);

    expect(html).toContain('/models/cavalry.gguf');
    expect(html).toContain('Vision Projector <span class="field-optional">Optional</span>');
    expect(html).toContain('Start Model');
    expect(html).not.toContain('name="endpoint"');
    expect(html).not.toContain('>Alias<');
    expect(html).not.toContain('>Access Key<');
  });

  it('keeps Stop Model visible for OpenAI when a managed local model is running', () => {
    const model = buildSettingsRouteFixture();
    model.advisor = Object.assign({}, model.advisor, {
      providerLabel: 'OpenAI / API',
      modelPlaceholder: 'gpt-5.4-mini',
      endpointPlaceholder: 'https://api.openai.com/v1/responses',
      apiKeyPlaceholder: '************',
      settings: {
        provider: 'openai',
        apiMode: 'responses',
        model: 'gpt-5.4-mini',
        endpoint: 'https://api.openai.com/v1/responses',
        hasApiKey: true,
        apiKeyPreview: '************'
      },
      toggle: {
        disabled: false,
        icon: 'stop_circle',
        label: 'Stop Model',
        shouldStop: true
      },
      statusLine: 'Current provider: OpenAI / API',
      serverLine: 'Server: Local model server is running. PID 123. Source: managed.',
      localStartLine: ''
    });

    const html = renderSettingsRoute(model);

    expect(html).toContain('Stop Model');
    expect(html).toContain('Test Model');
    expect(html).not.toContain('Start Model');
  });

  it('keeps Stop enabled and prevents another Test while a local model is starting', () => {
    const model = buildSettingsRouteFixture();
    model.advisor.toggle = {
      disabled: false,
      icon: 'stop',
      label: 'Stop Model',
      shouldStop: true,
      pending: true,
      testDisabled: true
    };

    const html = renderSettingsRoute(model);

    expect(html).toMatch(
      /<button aria-busy="true" class="btn" type="button"><svg[^>]*data-cavalry-icon="stop"[\s\S]*?<\/svg>Stop Model<\/button>/
    );
    expect(html).toMatch(
      /<button aria-busy="true" class="btn" disabled="" type="button"><svg[^>]*data-cavalry-icon="network_check"[\s\S]*?<\/svg>Testing Model…<\/button>/
    );
  });
});
