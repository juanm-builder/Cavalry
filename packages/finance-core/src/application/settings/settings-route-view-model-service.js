function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function titleCaseLabel(value, fallback) {
  const source = asString(value || fallback).replace(/[_-]+/g, ' ');
  if (!source) {
    return '';
  }
  return source
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function formatSettingsSavedAt(value) {
  if (!value) {
    return 'Not saved yet';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).replace('T', ' ').slice(0, 16);
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function formatSettingsCounterpartyKind(kind) {
  const value = String(kind || 'other');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getHealthIssueGuidance(issue) {
  const code = asString(issue && issue.code);
  if (code === 'line_archived_account') {
    return 'Open Transactions and choose an active account for this entry, or reactivate the account in Accounts.';
  }
  if (code === 'transaction_archived_category') {
    return 'Open Transactions and choose an active category, or reactivate the category in Categories.';
  }
  if (code === 'transaction_unknown_template') {
    return 'Open Transactions and edit this entry so it uses a supported transaction type.';
  }
  if (code === 'transaction_uncategorized') {
    return 'Open Transactions and choose the category that best describes this entry.';
  }
  if (code === 'transaction_month_mismatch') {
    return 'Open Transactions and resave the date so the entry appears in the correct month.';
  }
  if (code === 'account_posting_currency_mismatch') {
    return 'Open Accounts and repair the account currency so it matches its ledger postings; use an explicit conversion transaction to change currencies.';
  }
  if (
    ['transaction_zero_amount', 'transaction_negative_amount', 'line_non_positive_amount'].includes(
      code
    )
  ) {
    return 'Open Transactions and correct the amount before relying on balances or reports.';
  }
  if (code.includes('missing_account')) {
    return 'Open the affected entry and replace the missing account reference.';
  }
  if (code.includes('missing_category')) {
    return 'Open the affected entry and replace the missing category reference.';
  }
  return 'Review the affected record before relying on balances or reports.';
}

function formatHealthIssueReference(issue, workbook) {
  const rawReference = asString(issue && issue.detail);
  if (!rawReference || !workbook) return rawReference;
  const [transactionId, relatedId] = rawReference.split(':');
  const transaction = asArray(workbook.transactions).find(
    (item) => item && item.id === transactionId
  );
  const account = asArray(workbook.accounts).find((item) => item && item.id === relatedId);
  const transactionLabel = asString(
    transaction && (transaction.description || transaction.title || transaction.date)
  );
  const accountLabel = asString(account && account.name);
  return [transactionLabel, accountLabel].filter(Boolean).join(' • ') || rawReference;
}

function formatHealthIssueDetail(issue, workbook) {
  const reference = formatHealthIssueReference(issue, workbook);
  const guidance = getHealthIssueGuidance(issue);
  return reference ? `${guidance} Affected record: ${reference}.` : guidance;
}

export function buildSettingsHealthSummary(health = {}, workbook = null) {
  const errors = asArray(health.errors);
  const warnings = asArray(health.warnings);
  const notices = asArray(health.notices);
  const issueCount = errors.length + warnings.length + notices.length;
  const tone = errors.length ? 'bad' : warnings.length ? 'warn' : notices.length ? 'info' : 'good';
  const label = errors.length
    ? String(errors.length) + ' error' + (errors.length === 1 ? '' : 's')
    : warnings.length
      ? String(warnings.length) + ' warning' + (warnings.length === 1 ? '' : 's')
      : notices.length
        ? String(notices.length) + ' notice' + (notices.length === 1 ? '' : 's')
        : 'Clear';
  return {
    issueCount,
    tone,
    label,
    issues: errors
      .map((issue) => ({ issue, fallbackSeverity: 'error' }))
      .concat(warnings.map((issue) => ({ issue, fallbackSeverity: 'warning' })))
      .concat(notices.map((issue) => ({ issue, fallbackSeverity: 'notice' })))
      .slice(0, 12)
      .map(({ issue, fallbackSeverity }) => {
        const severity = asString(issue && issue.severity) || fallbackSeverity;
        const issueTone = severity === 'error' ? 'bad' : severity === 'warning' ? 'warn' : 'info';
        return {
          code: asString(issue && issue.code),
          tone: issueTone,
          title: titleCaseLabel(severity) + ': ' + asString(issue && issue.message),
          detail: formatHealthIssueDetail(issue, workbook)
        };
      })
  };
}

function buildAdvisorContextOptions(tokens) {
  return asArray(tokens).map((value) => {
    const numeric = Math.round(Number(value) || 0);
    return {
      value: numeric,
      label:
        numeric >= 1024
          ? String(Math.round(numeric / 1024)) + 'K tokens'
          : String(numeric) + ' tokens'
    };
  });
}

export function buildSettingsAdvisorViewModel(options = {}) {
  const advisorSettings =
    options.advisorSettings && typeof options.advisorSettings === 'object'
      ? options.advisorSettings
      : {};
  const advisorProvider = asString(advisorSettings.provider) || 'local';
  const providerLabel =
    asString(options.advisorProviderLabel) || titleCaseLabel(advisorProvider, 'Assistant');
  const advisorStatus = asString(options.advisorStatus);
  const advisorConnection = asString(options.advisorConnection);
  const advisorServerStatus =
    options.advisorServerStatus && typeof options.advisorServerStatus === 'object'
      ? options.advisorServerStatus
      : {};
  const advisorContextLocked =
    advisorProvider === 'custom' && !!(advisorServerStatus.running || advisorServerStatus.starting);
  const advisorUsesConfiguredModel = advisorProvider === 'openai' || advisorProvider === 'custom';
  return {
    providerLabel,
    fieldsDisabled: advisorProvider === 'local',
    modelLocationDisabled: advisorProvider !== 'custom',
    modelPlaceholder:
      advisorProvider === 'openai'
        ? asString(options.openAiModelPlaceholder) || 'gpt-5.4-mini'
        : asString(options.localAdvisorModel),
    endpointPlaceholder:
      advisorProvider === 'openai' && advisorSettings.apiMode === 'responses'
        ? asString(options.openAiResponsesEndpoint)
        : advisorProvider === 'openai'
          ? asString(options.openAiEndpoint)
          : asString(options.localAdvisorEndpoint),
    apiKeyPlaceholder: advisorSettings.hasApiKey
      ? advisorSettings.apiKeyPreview || 'Saved API key'
      : advisorProvider === 'openai'
        ? 'OpenAI API key'
        : 'Optional for local endpoints',
    settings: advisorSettings,
    defaultContextWindowTokens: Math.round(Number(options.defaultContextWindowTokens) || 32768),
    contextOptions: buildAdvisorContextOptions(options.contextWindowTokenOptions),
    contextDisabled: advisorProvider !== 'custom' || advisorContextLocked,
    toggle: options.advisorServerToggleState || {},
    statusLine: advisorStatus ? 'Settings: ' + advisorStatus : '',
    connectionLine: advisorConnection ? 'Model test: ' + advisorConnection : '',
    serverLine:
      options.advisorServerDetail &&
      (advisorProvider === 'custom' || options.advisorServerToggleState?.shouldStop)
        ? 'Server: ' + options.advisorServerDetail
        : '',
    contextLine: advisorContextLocked
      ? 'Context allocation is locked while the local model is running. Stop Model to change it.'
      : '',
    microphone: options.advisorMicrophone || {},
    localStartLine:
      advisorProvider === 'custom'
        ? 'Cavalry starts llama-server when you start, test, or use the assistant. Image intake requires a matching Vision Projector.'
        : '',
    summaryTitle:
      providerLabel +
      (advisorUsesConfiguredModel && advisorSettings.model ? ' • ' + advisorSettings.model : ''),
    summaryDetail: advisorConnection || advisorStatus || 'Ready'
  };
}

export function buildSettingsRouteViewModel(workbook, options = {}) {
  const sourceWorkbook = workbook && typeof workbook === 'object' ? workbook : {};
  const workbookSettings =
    sourceWorkbook.settings && typeof sourceWorkbook.settings === 'object'
      ? sourceWorkbook.settings
      : {};
  const fileAutosave =
    options.fileAutosave && typeof options.fileAutosave === 'object' ? options.fileAutosave : {};
  const health = buildSettingsHealthSummary(options.health || {}, sourceWorkbook);
  const advisor = buildSettingsAdvisorViewModel(options);
  const canSaveFileNow = options.canSaveFileNow === true;
  const canChooseAutosaveFile = options.canChooseAutosaveFile === true;
  const usdRate = Number(workbookSettings.usdToBaseRate) || 0;
  const lastSavedAt =
    options.lastSavedAt || workbookSettings.lastSavedAt || sourceWorkbook.updatedAt || '';
  return {
    summaryItems: [
      {
        id: 'workbook',
        icon: 'account_balance_wallet',
        title: sourceWorkbook.name || 'Workbook',
        detail:
          String(asArray(sourceWorkbook.accounts).length) +
          ' accounts • ' +
          String(asArray(sourceWorkbook.transactions).length) +
          ' transactions'
      },
      {
        id: 'save',
        icon: 'save',
        title: options.saveStatusLabel || 'Local cache only',
        detail: fileAutosave.detail || 'No file selected'
      },
      {
        id: 'advisor',
        icon: 'auto_awesome',
        title: advisor.summaryTitle,
        detail: advisor.summaryDetail
      },
      {
        id: 'health',
        icon: 'health_and_safety',
        title: health.label,
        detail: health.issueCount ? 'Review details below' : 'Workbook validation passed',
        titleClassName: 'status-' + health.tone
      }
    ],
    workbook: {
      name: sourceWorkbook.name || '',
      currency: sourceWorkbook.currency || 'PHP',
      usdRate: usdRate ? String(usdRate) : '',
      details: [
        { label: 'Visible Date Range', detail: options.visibleRangeLabel || 'Visible period' },
        { label: 'Last Saved', detail: formatSettingsSavedAt(lastSavedAt) },
        {
          label: 'File Link',
          detail: fileAutosave.detail || 'No file selected',
          amount: fileAutosave.status
        }
      ]
    },
    advisor,
    files: {
      canSaveFileNow,
      canRevealFile: options.canRevealFile === true,
      canChooseAutosaveFile,
      canClearFile: canSaveFileNow || !!fileAutosave.fileName,
      persistentUnavailable: !canChooseAutosaveFile
    },
    counterparties: asArray(options.counterparties)
      .slice()
      .sort((a, b) => {
        return asString(a && a.name).localeCompare(asString(b && b.name));
      })
      .map((counterparty) => ({
        id: counterparty.id,
        name: counterparty.name,
        kindLabel: formatSettingsCounterpartyKind(counterparty.kind),
        note: counterparty.note || ''
      })),
    health: {
      tone: health.tone,
      label: health.label,
      issues: health.issues
    }
  };
}
