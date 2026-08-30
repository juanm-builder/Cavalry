import { describe, expect, it } from 'vitest';

import {
  buildSettingsAdvisorViewModel,
  buildSettingsHealthSummary,
  buildSettingsRouteViewModel,
  formatSettingsCounterpartyKind,
  formatSettingsSavedAt
} from '@cavalry/finance-core/application/settings/settings-route-view-model-service.js';

function makeSettingsWorkbook() {
  return {
    name: 'The Plan',
    version: 2,
    currency: 'PHP',
    updatedAt: '2026-06-19T10:15:00.000Z',
    settings: {
      usdToBaseRate: 56.2,
      lastSavedAt: '2026-06-20T09:30:00.000Z'
    },
    accounts: [{ id: 'cash' }, { id: 'bank' }],
    transactions: [{ id: 'txn-1' }, { id: 'txn-2' }]
  };
}

function makeSettingsOptions(overrides = {}) {
  return Object.assign(
    {
      saveStatusLabel: 'Saved just now',
      fileAutosave: {
        status: 'Workbook file ready',
        detail: 'Cavalry.html',
        fileName: 'Cavalry.html'
      },
      canSaveFileNow: true,
      canRevealFile: true,
      canChooseAutosaveFile: true,
      counterparties: [
        { id: 'zeta', name: 'Zeta', kind: 'merchant', note: 'last' },
        { id: 'alpha', name: 'Alpha', kind: 'biller', note: 'first' }
      ],
      health: {
        errors: [],
        warnings: [
          {
            severity: 'warning',
            message: 'Category has no linked posting account.',
            detail: 'Food'
          }
        ],
        notices: []
      },
      visibleRangeLabel: 'June 1 - 20, 2026',
      advisorSettings: {
        provider: 'custom',
        model: 'cavalry-advisor',
        endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
        localModelPath: '/models/cavalry.gguf'
      },
      advisorProviderLabel: 'Local llama.cpp',
      advisorStatus: '',
      advisorConnection: 'Ready',
      advisorServerStatus: { running: false, starting: false },
      advisorServerToggleState: { disabled: false, label: 'Start Model', icon: 'play_arrow' },
      advisorServerDetail: 'Local model server is stopped.',
      advisorMicrophone: {
        title: 'Microphone access',
        detail: 'Request access to use voice input with Advisor.',
        tone: 'info'
      },
      defaultContextWindowTokens: 32768,
      contextWindowTokenOptions: [16384, 32768],
      localAdvisorModel: 'cavalry-advisor',
      localAdvisorEndpoint: 'http://127.0.0.1:8080/v1/chat/completions',
      openAiEndpoint: 'https://api.openai.com/v1/chat/completions',
      openAiResponsesEndpoint: 'https://api.openai.com/v1/responses'
    },
    overrides
  );
}

describe('settings route view-model service', () => {
  it('builds the settings summary and workbook details from renderer-provided runtime facts', () => {
    const model = buildSettingsRouteViewModel(makeSettingsWorkbook(), makeSettingsOptions());

    expect(model.summaryItems).toEqual([
      {
        id: 'workbook',
        icon: 'account_balance_wallet',
        title: 'The Plan',
        detail: '2 accounts • 2 transactions'
      },
      { id: 'save', icon: 'save', title: 'Saved just now', detail: 'Cavalry.html' },
      {
        id: 'advisor',
        icon: 'auto_awesome',
        title: 'Local llama.cpp • cavalry-advisor',
        detail: 'Ready'
      },
      {
        id: 'health',
        icon: 'health_and_safety',
        title: '1 warning',
        detail: 'Review details below',
        titleClassName: 'status-warn'
      }
    ]);
    expect(model.workbook).toMatchObject({
      name: 'The Plan',
      currency: 'PHP',
      usdRate: '56.2'
    });
    expect(model.workbook.details.map((detail) => detail.label)).toEqual([
      'Visible Date Range',
      'Last Saved',
      'File Link'
    ]);
    expect(model.workbook.details[0].detail).toBe('June 1 - 20, 2026');
    expect(model.workbook.details[2]).toMatchObject({
      detail: 'Cavalry.html',
      amount: 'Workbook file ready'
    });
    expect(model).not.toHaveProperty('snapshots');
  });

  it('preserves Advisor OpenAI placeholder and API key copy', () => {
    const advisor = buildSettingsAdvisorViewModel(
      makeSettingsOptions({
        advisorSettings: {
          provider: 'openai',
          apiMode: 'responses',
          model: 'gpt-5.4-mini',
          hasApiKey: true,
          apiKeyPreview: '************'
        },
        advisorProviderLabel: 'OpenAI / API',
        advisorStatus: 'saved',
        advisorConnection: ''
      })
    );

    expect(advisor).toMatchObject({
      providerLabel: 'OpenAI / API',
      fieldsDisabled: false,
      modelLocationDisabled: true,
      modelPlaceholder: 'gpt-5.4-mini',
      endpointPlaceholder: 'https://api.openai.com/v1/responses',
      apiKeyPlaceholder: '************',
      statusLine: 'Settings: saved',
      connectionLine: '',
      localStartLine: ''
    });
  });

  it('reports a selected OpenAI profile without a saved key as incomplete', () => {
    const advisor = buildSettingsAdvisorViewModel(
      makeSettingsOptions({
        advisorSettings: {
          provider: 'openai',
          apiMode: 'responses',
          model: 'gpt-5.4-mini',
          hasApiKey: false,
          apiKeyPreview: ''
        },
        advisorProviderLabel: 'OpenAI / API',
        advisorStatus: '',
        advisorConnection: ''
      })
    );

    expect(advisor.summaryTitle).toBe('OpenAI / API');
    expect(advisor.summaryDetail).toBe('API key required');
    expect(advisor.apiKeyPlaceholder).toBe('OpenAI API key');
  });

  it('locks local model context until the server has fully stopped', () => {
    const advisor = buildSettingsAdvisorViewModel(
      makeSettingsOptions({
        advisorServerStatus: { running: true, starting: false }
      })
    );

    expect(advisor.contextDisabled).toBe(true);
    expect(advisor.contextLine).toBe(
      'Context allocation is locked while the local model is running. Stop Model to change it.'
    );
    expect(advisor.contextOptions).toEqual([
      { value: 16384, label: '16K tokens' },
      { value: 32768, label: '32K tokens' }
    ]);
    expect(advisor.statusLine).toBe('');

    expect(
      buildSettingsAdvisorViewModel(
        makeSettingsOptions({
          advisorServerStatus: { running: false, starting: false, stopping: true }
        })
      ).contextDisabled
    ).toBe(true);
  });

  it('summarizes health issues and caps rendered issue rows', () => {
    const issues = Array.from({ length: 14 }, (_item, index) => ({
      severity: index === 0 ? 'error' : 'notice',
      message: 'Issue ' + String(index + 1),
      detail: ''
    }));
    const summary = buildSettingsHealthSummary({
      errors: issues.slice(0, 1),
      warnings: [],
      notices: issues.slice(1)
    });

    expect(summary).toMatchObject({ issueCount: 14, tone: 'bad', label: '1 error' });
    expect(summary.issues).toHaveLength(12);
    expect(summary.issues[0]).toEqual({
      code: '',
      tone: 'bad',
      title: 'Error: Issue 1',
      detail: 'Review the affected record before relying on balances or reports.'
    });
  });

  it('turns ledger warning codes into a clear next step', () => {
    const summary = buildSettingsHealthSummary(
      {
        errors: [],
        warnings: [
          {
            code: 'line_archived_account',
            message: 'Transaction line references an archived account.',
            detail: 'txn-1:cash'
          }
        ],
        notices: []
      },
      {
        transactions: [{ id: 'txn-1', description: 'Coffee purchase' }],
        accounts: [{ id: 'cash', name: 'Old Cash account' }]
      }
    );

    expect(summary.issues[0]).toMatchObject({
      code: 'line_archived_account',
      tone: 'warn',
      detail:
        'Open Transactions and choose an active account for this entry, or reactivate the account in Accounts. Affected record: Coffee purchase • Old Cash account.'
    });
  });

  it('gives account currency mismatches an explicit repair path', () => {
    const summary = buildSettingsHealthSummary({
      errors: [],
      warnings: [
        {
          code: 'account_posting_currency_mismatch',
          message: 'Account currency metadata does not match its ledger posting currency.',
          detail: 'cash: configured USD; postings PHP'
        }
      ],
      notices: []
    });

    expect(summary.issues[0]).toMatchObject({
      code: 'account_posting_currency_mismatch',
      tone: 'warn',
      detail:
        'Open Accounts and repair the account currency so it matches its ledger postings; use an explicit conversion transaction to change currencies. Affected record: cash: configured USD; postings PHP.'
    });
  });

  it('sorts counterparties and keeps file action flags stable', () => {
    const model = buildSettingsRouteViewModel(
      makeSettingsWorkbook(),
      makeSettingsOptions({
        canSaveFileNow: false,
        canRevealFile: false,
        canChooseAutosaveFile: false,
        fileAutosave: {
          status: 'Unsupported in this browser',
          detail: 'No file selected',
          fileName: ''
        }
      })
    );

    expect(model.files).toEqual({
      canSaveFileNow: false,
      canRevealFile: false,
      canChooseAutosaveFile: false,
      canClearFile: false,
      persistentUnavailable: true
    });
    expect(model.counterparties.map((counterparty) => counterparty.id)).toEqual(['alpha', 'zeta']);
    expect(model.counterparties[0].kindLabel).toBe('Biller');
    expect(formatSettingsCounterpartyKind('merchant')).toBe('Merchant');
    expect(formatSettingsSavedAt('bad-date-value')).toBe('bad-date-value');
  });

  it('does not mutate the workbook or renderer-provided option objects', () => {
    const workbook = makeSettingsWorkbook();
    const options = makeSettingsOptions();
    const beforeWorkbook = JSON.stringify(workbook);
    const beforeOptions = JSON.stringify(options);

    buildSettingsRouteViewModel(workbook, options);

    expect(JSON.stringify(workbook)).toBe(beforeWorkbook);
    expect(JSON.stringify(options)).toBe(beforeOptions);
  });
});
