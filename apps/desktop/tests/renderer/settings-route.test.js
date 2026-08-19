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
    expect(html).toContain('Choose a connection');
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

  it('keeps the local profile form as a fallback when Cavalry Cloud is unconfigured', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: false,
      status: 'unavailable'
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('id="account-profile-form"');
    expect(html).toContain('Stored on this Mac');
    expect(html).toContain('Cavalry Cloud');
    expect(html).toContain('Unavailable');
    expect(html).toContain('Your profile and workbook remain on this Mac.');
    expect(html).not.toContain('Continue with Google');
  });

  it('renders private Apple and Google sign-in without exposing the local email form', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_out',
      user: null,
      workbooks: []
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('Continue with Apple');
    expect(html).toContain('Continue with Google');
    expect(html).toContain('Already have a Google-backed Cloud library?');
    expect(html).toContain('Signed out');
    expect(html).toContain('Nothing is uploaded until you choose Add to Cloud.');
    expect(html).toContain('Cavalry opens provider sign-in in your browser.');
    expect(html).toContain('Cavalry never receives your Mac password.');
    expect(html).not.toContain('id="account-profile-form"');
    expect(html).not.toContain('settings-account-email');
  });

  it('renders Apple as the verified Cloud identity provider', () => {
    const model = buildSettingsRouteFixture();
    model.cloud = {
      configured: true,
      status: 'signed_in',
      user: {
        id: 'apple-user',
        name: 'Private User',
        email: 'relay@privaterelay.appleid.com',
        provider: 'apple'
      },
      current: {},
      workbooks: []
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('Signed in to Cavalry Cloud');
    expect(html).toContain('relay@privaterelay.appleid.com · Connected: Apple');
    expect(html).not.toContain('aria-label="Continue with Apple"');
  });

  it('renders a verified account and accessible actions for every cloud workbook', () => {
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

    expect(html).toContain('Signed in to Cavalry Cloud');
    expect(html).toContain('Alex Example');
    expect(html).toContain('alex@example.com');
    expect(html).toContain('id="settings-cloud-profile-name"');
    expect(html).toContain('value="Alex Example"');
    expect(html).toContain('Save Name');
    expect(html).toContain('aria-label="Continue with Apple"');
    expect(html).toContain('Hide My Email');
    expect(html).toContain('Add to Cloud');
    expect(html).toContain('Refresh');
    expect(html).toContain('Sign Out');
    expect(html).toContain('2 workbooks');
    expect(html).toContain('aria-label="Cavalry Cloud workbooks"');
    expect(html).toContain('aria-label="Open The Plan from Cavalry Cloud"');
    expect(html).toContain('aria-label="Remove The Plan from Cavalry Cloud"');
    expect(html).toContain('aria-label="Open Business 2026 from Cavalry Cloud"');
    expect(html).toContain('aria-label="Remove Business 2026 from Cavalry Cloud"');
    expect(html).toContain('Current');
    expect(html).not.toContain('id="account-profile-form"');
  });

  it('provides a Cloud-synced Feedback tab with report submission and review', () => {
    const model = buildSettingsRouteFixture();
    model.activeSection = 'settings-feedback';
    const html = renderToStaticMarkup(
      React.createElement(SettingsRoute, {
        model,
        feedback: {
          model: {
            configured: true,
            signedIn: true,
            status: 'signed_in',
            loaded: true,
            reports: [
              {
                id: 'report-1',
                kind: 'bug',
                description: 'The filter stopped responding.',
                status: 'received',
                source: 'settings',
                context: { routeId: 'ledger' },
                createdAt: '2026-07-24T02:00:00.000Z',
                attachment: null
              }
            ]
          }
        }
      })
    );

    expect(html).toContain('id="settings-feedback"');
    expect(html).toContain('aria-label="Feedback"');
    expect(html).toContain('Send feedback');
    expect(html).toContain('Cloud synced');
    expect(html).toContain('The filter stopped responding.');
    expect(html).toContain('From Transactions');
    expect(html).toContain('Your reports');
  });

  it('does not render a feedback submit action while Cavalry Cloud is signed out', () => {
    const model = buildSettingsRouteFixture();
    model.activeSection = 'settings-feedback';
    const html = renderToStaticMarkup(
      React.createElement(SettingsRoute, {
        model,
        feedback: {
          model: {
            configured: true,
            signedIn: false,
            status: 'signed_out',
            reports: []
          }
        }
      })
    );

    expect(html).toContain('Sign in to send feedback');
    expect(html).toContain('Open Account settings');
    expect(html).not.toContain('>Send report</button>');
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
        lastSyncedAt: '2026-07-20T04:00:00.000Z'
      },
      workbooks: []
    };

    const html = renderSettingsRoute(model);

    expect(html).toContain('Sync Now');
    expect(html).toContain('Last synced');
    expect(html).toContain('No cloud workbooks yet');
    expect(html).not.toContain('Add to Cloud</button>');
  });

  it('requires explicit review when the current Cloud workbook has changed', () => {
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

    expect(html).toContain('The Cloud copy changed.');
    expect(html).toContain('Cloud copy changed</button>');
    expect(html).toContain('Review The Plan from Cavalry Cloud');
    expect(html).toContain('>Review</button>');
    expect(html).not.toContain('Sync Now');
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
