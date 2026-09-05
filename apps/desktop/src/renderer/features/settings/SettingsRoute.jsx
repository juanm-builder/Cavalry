import React, { useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { CavalrySelect, UncontrolledCavalrySelect } from '../../shared/CavalrySelect.jsx';
import { useAppearance } from '../../app/AppearanceProvider.jsx';
import { CUSTOM_COLOR_FIELDS } from '../../app/appearance-preferences.js';
import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import { CloudAccountPanel } from './CloudAccountPanel.jsx';

const COUNTERPARTY_KIND_OPTIONS = Object.freeze([
  { value: 'employer', label: 'Employer' },
  { value: 'family', label: 'Family' },
  { value: 'client', label: 'Client' },
  { value: 'merchant', label: 'Merchant' },
  { value: 'biller', label: 'Biller' },
  { value: 'other', label: 'Other' }
]);

const ADVISOR_PROVIDER_OPTIONS = Object.freeze([
  { value: 'local', label: 'Choose a connection…', icon: 'link_off' },
  { value: 'openai', label: 'ChatGPT / OpenAI', icon: 'auto_awesome' },
  { value: 'custom', label: 'Local Model', icon: 'memory' }
]);

function formPayload(form) {
  const payload = {};
  if (!(form && typeof FormData === 'function')) {
    return payload;
  }
  new FormData(form).forEach((value, key) => {
    if (!(key in payload) && typeof value === 'string') {
      payload[key] = value;
    }
  });
  return payload;
}

function submitAction(event, onAction, type) {
  event.preventDefault();
  if (typeof onAction === 'function') {
    return onAction({ type, payload: formPayload(event.currentTarget) });
  }
  return undefined;
}

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function StatusPill({ children, icon, tone = 'neutral' }) {
  return (
    <span className={'settings-status-pill ' + tone}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

function SettingsFeedback({ feedback = {} }) {
  if (!(feedback.error || feedback.notice)) return null;
  return (
    <div className="settings-feedback">
      {feedback.error ? (
        <div className="settings-feedback-message bad" role="alert">
          <Icon name="error" />
          <span>{feedback.error}</span>
        </div>
      ) : null}
      {feedback.notice ? (
        <div className="settings-feedback-message good" role="status">
          <Icon name="check_circle" />
          <span>{feedback.notice}</span>
        </div>
      ) : null}
    </div>
  );
}

function SettingsCard({ children, className = '', headingId, icon, title, trailing }) {
  const classes = ['settings-card', className].filter(Boolean).join(' ');
  return (
    <section aria-labelledby={headingId} className={classes}>
      <header className="settings-card-header">
        <div className="settings-card-heading">
          {icon ? (
            <span className="settings-card-icon">
              <Icon name={icon} />
            </span>
          ) : null}
          <div>
            <h3 id={headingId}>{title}</h3>
          </div>
        </div>
        {trailing ? <div className="settings-card-trailing">{trailing}</div> : null}
      </header>
      {children}
    </section>
  );
}

function EmptyState({ detail, icon = 'inbox', title }) {
  return (
    <div className="settings-empty-state">
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}

const SETTINGS_SECTIONS = [
  {
    id: 'settings-general',
    label: 'Workbook',
    icon: 'tune'
  },
  {
    id: 'settings-appearance',
    label: 'Appearance',
    icon: 'palette'
  },
  {
    id: 'settings-advisor',
    label: 'Assistant',
    icon: 'auto_awesome'
  },
  {
    id: 'settings-account',
    label: 'Account & sync',
    icon: 'cloud'
  },
  {
    id: 'settings-files',
    label: 'Files & Data',
    icon: 'folder_open'
  }
];

function SettingsSectionNav({ activeSection, onSelect }) {
  const moveSelection = (event, currentIndex) => {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = SETTINGS_SECTIONS.length - 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % SETTINGS_SECTIONS.length;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
    }

    onSelect(SETTINGS_SECTIONS[nextIndex].id);
    const tabs = event.currentTarget.parentElement?.querySelectorAll('[role="tab"]');
    tabs?.[nextIndex]?.focus();
  };

  return (
    <nav aria-label="Settings sections" className="settings-section-nav">
      <div aria-orientation="vertical" role="tablist">
        {SETTINGS_SECTIONS.map((section, index) => {
          const selected = activeSection === section.id;
          return (
            <button
              aria-controls={section.id}
              aria-label={section.label}
              aria-selected={selected}
              className={selected ? 'active' : ''}
              id={'settings-tab-' + section.id}
              key={section.id}
              onClick={() => onSelect(section.id)}
              onKeyDown={(event) => moveSelection(event, index)}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span className="settings-section-nav-icon">
                <Icon name={section.icon} />
              </span>
              <span className="settings-section-nav-copy">
                <strong>{section.label}</strong>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function SettingsTabPanel({ activeSection, children, id }) {
  return (
    <div
      aria-labelledby={'settings-tab-' + id}
      className="settings-tab-panel"
      hidden={activeSection !== id}
      id={id}
      role="tabpanel"
      tabIndex="0"
    >
      {children}
    </div>
  );
}

function WorkspacePanel({ counterparties, feedback, onAction, workbook }) {
  const actions = useActionBindings();
  const details = workbook.details || [];

  return (
    <div className="settings-content-stack">
      <SettingsFeedback feedback={feedback} />
      <SettingsCard
        headingId="settings-workbook-details-heading"
        icon="description"
        title="Workbook details"
      >
        <form
          aria-label="Workbook name"
          className="settings-workbook-name-form"
          id="workbook-name-form"
          onSubmit={(event) => submitAction(event, onAction, 'rename-workbook')}
        >
          <div className="field">
            <label htmlFor="settings-workbook-name">Name</label>
            <input
              defaultValue={workbook.name || ''}
              id="settings-workbook-name"
              key={workbook.name || 'unnamed-workbook'}
              name="name"
              placeholder="e.g. The Plan"
              type="text"
            />
          </div>
          <button className="btn" type="submit">
            <Icon name="edit" />
            Rename
          </button>
        </form>
        {details.length ? (
          <dl className="settings-detail-list">
            {details.map((item) => (
              <div className="settings-detail-item" key={item.label}>
                <dt>{item.label}</dt>
                <dd>
                  <span>{item.detail}</span>
                  {item.amount ? <StatusPill tone="neutral">{item.amount}</StatusPill> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <EmptyState
            detail="Workbook information will appear after the file finishes loading."
            icon="description"
            title="No workbook details available"
          />
        )}
      </SettingsCard>

      <SettingsCard
        headingId="settings-exchange-rate-heading"
        icon="currency_exchange"
        title="Exchange rate"
      >
        <div className="settings-setting-row settings-rate-row">
          <div className="settings-setting-copy">
            <strong>USD to {workbook.currency || 'PHP'}</strong>
            <small>Enter how much one US dollar is worth in your base currency.</small>
          </div>
          <form
            aria-label="Exchange rate"
            className="settings-rate-form"
            id="usd-rate-form"
            onSubmit={(event) => submitAction(event, onAction, 'update-usd-rate')}
          >
            <label className="sr-only" htmlFor="settings-usd-rate">
              USD to {workbook.currency || 'PHP'} rate
            </label>
            <div className="settings-input-suffix">
              <input
                defaultValue={workbook.usdRate || ''}
                id="settings-usd-rate"
                inputMode="decimal"
                min="0"
                name="usdRate"
                placeholder="56.20"
                step="0.01"
                type="number"
              />
              <span>{workbook.currency || 'PHP'}</span>
            </div>
            <button className="btn" type="submit">
              Update Rate
            </button>
          </form>
        </div>
      </SettingsCard>

      <SettingsCard
        headingId="settings-counterparties-heading"
        icon="group"
        title="People & merchants"
        trailing={<StatusPill tone="neutral">{String(counterparties.length)}</StatusPill>}
      >
        <form
          className="settings-counterparty-form"
          id="counterparty-form"
          onSubmit={(event) => submitAction(event, onAction, 'add-counterparty')}
        >
          <div className="field">
            <label htmlFor="settings-counterparty-name">Name</label>
            <input
              id="settings-counterparty-name"
              name="name"
              placeholder="e.g. Globe Telecom"
              type="text"
            />
          </div>
          <div className="field">
            <label htmlFor="settings-counterparty-kind">Type</label>
            <UncontrolledCavalrySelect
              aria-label="Type"
              defaultValue="employer"
              id="settings-counterparty-kind"
              name="kind"
              options={COUNTERPARTY_KIND_OPTIONS}
              showLeadingIcon={false}
            />
          </div>
          <div className="field">
            <label htmlFor="settings-counterparty-note">
              Note <span className="field-optional">Optional</span>
            </label>
            <input
              id="settings-counterparty-note"
              name="note"
              placeholder="What you use this for"
              type="text"
            />
          </div>
          <button className="btn btn-primary settings-counterparty-add" type="submit">
            <Icon name="add" />
            Add
          </button>
        </form>

        {counterparties.length ? (
          <ul className="settings-counterparty-list">
            {counterparties.map((counterparty) => (
              <li className="settings-counterparty-item" key={counterparty.id}>
                <span className="settings-counterparty-avatar">
                  <Icon name="person" />
                </span>
                <div className="settings-counterparty-copy">
                  <strong>{counterparty.name}</strong>
                  <small>{counterparty.note || 'No note'}</small>
                </div>
                <StatusPill tone="neutral">{counterparty.kindLabel}</StatusPill>
                <button
                  aria-label="Archive counterparty"
                  className="btn settings-row-action"
                  title={'Archive ' + counterparty.name}
                  type="button"
                  {...actions.action('archive-counterparty', {
                    counterpartyId: counterparty.id
                  })}
                >
                  <Icon name="archive" />
                  Archive
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            detail="Add one above to make transaction entry faster."
            icon="group"
            title="No people or merchants yet"
          />
        )}
      </SettingsCard>
    </div>
  );
}

function AppearancePanel({ feedback }) {
  const {
    preferences,
    themes,
    densities,
    setTheme,
    setCustomPalette,
    resetCustomPalette,
    setDensity,
    setNavigation
  } = useAppearance();

  return (
    <div className="settings-content-stack">
      <SettingsFeedback feedback={feedback} />
      <SettingsCard
        headingId="settings-theme-heading"
        icon="colors"
        title="Color theme"
        trailing={
          <StatusPill icon="bolt" tone="good">
            Applies instantly
          </StatusPill>
        }
      >
        <div className="appearance-theme-grid">
          {themes.map((theme) => {
            const selected = preferences.theme === theme.id;
            return (
              <button
                aria-pressed={selected}
                className="appearance-theme-card"
                key={theme.id}
                onClick={() => setTheme(theme.id)}
                type="button"
              >
                <span className="appearance-theme-preview" aria-hidden="true">
                  {theme.swatches.map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </span>
                <span className="appearance-theme-copy">
                  <strong>{theme.label}</strong>
                  <small>{theme.description}</small>
                </span>
                <span className="appearance-theme-selection">
                  <Icon name={selected ? 'check_circle' : 'circle'} />
                </span>
              </button>
            );
          })}
        </div>

        {preferences.theme === 'custom' ? (
          <section className="custom-palette-editor" aria-labelledby="custom-palette-heading">
            <div className="custom-palette-heading">
              <div>
                <strong id="custom-palette-heading">Custom colors</strong>
                <small>Fine-tune each role in your workspace palette.</small>
              </div>
              <button className="btn" onClick={resetCustomPalette} type="button">
                <Icon name="restart_alt" />
                Reset
              </button>
            </div>
            <div className="custom-palette-scheme">
              <span>Control style</span>
              <div className="segmented-control" role="group" aria-label="Custom control style">
                {[
                  ['dark', 'Dark'],
                  ['light', 'Light']
                ].map(([id, label]) => (
                  <button
                    aria-pressed={preferences.customPalette.scheme === id}
                    className={preferences.customPalette.scheme === id ? 'active' : ''}
                    key={id}
                    onClick={() => setCustomPalette({ scheme: id })}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="custom-color-grid">
              {CUSTOM_COLOR_FIELDS.map((field) => (
                <label className="custom-color-field" key={field.id}>
                  <span>{field.label}</span>
                  <span className="custom-color-control">
                    <input
                      aria-label={field.label + ' color'}
                      onChange={(event) => setCustomPalette({ [field.id]: event.target.value })}
                      type="color"
                      value={preferences.customPalette[field.id]}
                    />
                    <code>{preferences.customPalette[field.id].toUpperCase()}</code>
                  </span>
                </label>
              ))}
            </div>
          </section>
        ) : null}
      </SettingsCard>

      <SettingsCard headingId="settings-interface-heading" icon="view_quilt" title="Interface">
        <div className="settings-setting-list">
          <div className="settings-setting-row">
            <div className="settings-setting-copy">
              <strong>Layout density</strong>
              <small>Comfortable adds breathing room; Compact fits more on screen.</small>
            </div>
            <div className="segmented-control" role="group" aria-label="Layout density">
              {densities.map((density) => (
                <button
                  aria-pressed={preferences.density === density.id}
                  className={preferences.density === density.id ? 'active' : ''}
                  key={density.id}
                  onClick={() => setDensity(density.id)}
                  type="button"
                >
                  {density.label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-setting-row">
            <div className="settings-setting-copy">
              <strong>Navigation</strong>
              <small>Keep page names visible or reclaim more room for your workbook.</small>
            </div>
            <div className="segmented-control" role="group" aria-label="Navigation size">
              {[
                ['expanded', 'Expanded'],
                ['compact', 'Compact']
              ].map(([id, label]) => (
                <button
                  aria-pressed={preferences.navigation === id}
                  className={preferences.navigation === id ? 'active' : ''}
                  key={id}
                  onClick={() => setNavigation(id)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

function AssistantPanel({ advisor, feedback, onAction }) {
  const actions = useActionBindings();
  const advisorSettings = advisor.settings || {};
  const advisorToggle = advisor.toggle || {};
  const advisorContextValue = String(
    advisorSettings.contextWindowTokens || advisor.defaultContextWindowTokens || 32768
  );
  const advisorProvider = advisorSettings.provider || 'local';
  const advisorUsesLocalModel = advisorProvider === 'custom';
  const advisorUsesRemoteModel = advisorProvider === 'openai';
  const advisorUsesConfiguredModel = advisorUsesLocalModel || advisorUsesRemoteModel;
  const advisorCanToggleLocalModel = advisorUsesLocalModel || !!advisorToggle.shouldStop;
  const advisorShouldStop =
    advisorToggle.shouldStop === true || /stop/i.test(String(advisorToggle.label || ''));
  const advisorTestPending = advisorToggle.testDisabled === true;
  const advisorLifecyclePending = advisorToggle.pending === true;
  const advisorApiKeyValue = advisorSettings.hasApiKey
    ? advisorSettings.apiKeyPreview || advisor.apiKeyPlaceholder || ''
    : '';
  const advisorHasSavedApiKey = advisorUsesRemoteModel && advisorSettings.hasApiKey === true;
  const advisorHasModelName = !!String(advisorSettings.model || '').trim();
  const advisorConnectionReady = advisorUsesRemoteModel
    ? advisorHasSavedApiKey && advisorHasModelName
    : advisorUsesLocalModel
      ? advisorHasModelName &&
        (!!String(advisorSettings.localModelPath || '').trim() || advisorToggle.shouldStop === true)
      : false;
  const advisorConnectionLabel = advisorConnectionReady
    ? advisor.providerLabel || 'Connected'
    : advisorUsesRemoteModel && !advisorHasSavedApiKey
      ? 'API key required'
      : advisorUsesLocalModel || advisorUsesRemoteModel
        ? 'Choose a model'
        : 'Not connected';
  const [unlockedApiKeyPreview, setUnlockedApiKeyPreview] = useState('');
  const apiKeyLocked = advisorHasSavedApiKey && unlockedApiKeyPreview !== advisorApiKeyValue;
  const advisorModeTitle = advisorUsesLocalModel ? 'Local model' : 'No model connected';
  const advisorModeDetail = advisorUsesLocalModel
    ? advisorSettings.localModelPath || 'Choose a GGUF model'
    : 'Choose a local model or connect an API';
  const advisorEndpointValue =
    advisorUsesRemoteModel &&
    advisorSettings.endpoint === 'https://api.openai.com/v1/chat/completions'
      ? 'https://api.openai.com/v1/responses'
      : advisorSettings.endpoint || '';
  const normalizedStatusLine = String(advisor.statusLine || '').replace(/^Settings:\s*/i, '');
  const normalizedConnectionLine = String(advisor.connectionLine || '').replace(
    /^Model test:\s*/i,
    ''
  );
  const statusLines = [
    {
      icon: 'settings',
      text:
        normalizedStatusLine && normalizedStatusLine !== normalizedConnectionLine
          ? advisor.statusLine
          : ''
    },
    { icon: 'network_check', text: advisor.connectionLine },
    { icon: 'dns', text: advisor.serverLine },
    { icon: 'memory', text: advisor.contextLine },
    { icon: 'info', text: advisor.localStartLine }
  ].filter((item) => item.text);

  return (
    <div className="settings-content-stack">
      <SettingsFeedback
        feedback={{
          error: feedback?.error || '',
          notice: statusLines.length ? '' : feedback?.notice || ''
        }}
      />
      <SettingsCard
        headingId="settings-assistant-connection-heading"
        icon="hub"
        title="Model connection"
        trailing={
          <StatusPill
            icon={advisorConnectionReady ? 'check_circle' : 'link_off'}
            tone={advisorConnectionReady ? 'good' : 'warn'}
          >
            {advisorConnectionLabel}
          </StatusPill>
        }
      >
        <form
          className="advisor-settings-form advisor-copilot-form"
          id="advisor-settings-form"
          onSubmit={(event) => {
            const result = submitAction(event, onAction, 'save-advisor-settings');
            if (advisorHasSavedApiKey) setUnlockedApiKeyPreview('');
            return result;
          }}
        >
          <div className="advisor-copilot-topline">
            <div className="field advisor-mode-field">
              <label htmlFor="settings-advisor-provider">Connection</label>
              <CavalrySelect
                aria-label="Connection"
                disabled={advisorLifecyclePending}
                id="settings-advisor-provider"
                name="provider"
                options={ADVISOR_PROVIDER_OPTIONS}
                placeholder="Choose a connection…"
                value={advisorProvider}
                {...actions.change('set-advisor-provider')}
              />
            </div>
            {!advisorUsesRemoteModel ? (
              <div className="advisor-copilot-status">
                <Icon name={advisorUsesLocalModel ? 'memory' : 'link_off'} />
                <div>
                  <strong>{advisorModeTitle}</strong>
                  <small>{advisorModeDetail}</small>
                </div>
              </div>
            ) : null}
          </div>

          {advisorUsesRemoteModel ? (
            <>
              <div className="advisor-config-grid advisor-config-grid-openai">
                <input name="apiMode" type="hidden" value="responses" />
                <div className="field advisor-api-key-field">
                  <label htmlFor="settings-advisor-api-key">OpenAI key</label>
                  <div className={'advisor-api-key-control' + (apiKeyLocked ? ' is-locked' : '')}>
                    <input
                      autoComplete="off"
                      defaultValue={apiKeyLocked ? advisorApiKeyValue : ''}
                      disabled={apiKeyLocked}
                      id="settings-advisor-api-key"
                      key={apiKeyLocked ? 'saved-key' : 'editable-key'}
                      name="apiKey"
                      placeholder={advisor.apiKeyPlaceholder}
                      type="password"
                    />
                    {apiKeyLocked ? (
                      <button
                        aria-label="Remove saved OpenAI key"
                        className="btn btn-icon advisor-api-key-remove"
                        onClick={() => setUnlockedApiKeyPreview(advisorApiKeyValue)}
                        title="Remove saved key and enter a new one"
                        type="button"
                      >
                        <Icon name="close" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="settings-advisor-model">Model</label>
                  <input
                    defaultValue={advisorSettings.model || ''}
                    id="settings-advisor-model"
                    name="model"
                    placeholder={advisor.modelPlaceholder}
                    type="text"
                  />
                </div>
              </div>
              <div className="settings-inline-message" role="note">
                <Icon name="shield_lock" />
                Saved OpenAI keys are protected with macOS Keychain. If macOS asks you to approve
                access, Cavalry never receives your Mac password.
              </div>
            </>
          ) : null}

          {advisorUsesLocalModel ? (
            <div className="advisor-local-model-grid">
              <div className="field advisor-model-location-field">
                <label htmlFor="settings-local-model">GGUF Model</label>
                <div className="advisor-model-location-row">
                  <input
                    id="settings-local-model"
                    name="localModelPath"
                    placeholder="Qwen3.5-9B-UD-Q4_K_XL.gguf"
                    readOnly
                    type="text"
                    value={advisorSettings.localModelPath || ''}
                  />
                  <button
                    aria-label="Browse for GGUF model"
                    className="btn"
                    disabled={advisorLifecyclePending}
                    type="button"
                    {...actions.action('choose-local-model', {}, { includeForm: true })}
                  >
                    <Icon name="folder_open" />
                    Browse
                  </button>
                </div>
              </div>
              <div className="field advisor-model-location-field">
                <label htmlFor="settings-vision-projector">
                  Vision Projector <span className="field-optional">Optional</span>
                </label>
                <div className="advisor-model-location-row">
                  <input
                    id="settings-vision-projector"
                    name="mmprojPath"
                    placeholder="mmproj-*.gguf"
                    readOnly
                    type="text"
                    value={advisorSettings.mmprojPath || ''}
                  />
                  <button
                    aria-label="Browse for vision projector"
                    className="btn"
                    disabled={advisorLifecyclePending}
                    type="button"
                    {...actions.action('choose-mmproj', {}, { includeForm: true })}
                  >
                    <Icon name="visibility" />
                    Browse
                  </button>
                  {advisorSettings.mmprojPath ? (
                    <button
                      aria-label="Clear vision projector"
                      className="btn"
                      disabled={advisorLifecyclePending}
                      type="button"
                      {...actions.action('clear-mmproj')}
                    >
                      <Icon name="close" />
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="field">
                <label htmlFor="settings-context-allocation">Context Allocation</label>
                {advisor.contextDisabled ? (
                  <input name="contextWindowTokens" type="hidden" value={advisorContextValue} />
                ) : null}
                <UncontrolledCavalrySelect
                  aria-label="Context Allocation"
                  defaultValue={String(advisorContextValue)}
                  disabled={advisor.contextDisabled}
                  id="settings-context-allocation"
                  name={advisor.contextDisabled ? '' : 'contextWindowTokens'}
                  options={(advisor.contextOptions || []).map((option) => ({
                    value: String(option.value),
                    label: option.label
                  }))}
                  showLeadingIcon={false}
                />
              </div>
            </div>
          ) : null}

          {advisorUsesRemoteModel ? (
            <details className="advisor-advanced-settings">
              <summary>
                <Icon name="tune" />
                Advanced connection
              </summary>
              <div className="field-grid advisor-advanced-grid">
                <div className="field">
                  <label htmlFor="settings-advisor-endpoint">Endpoint</label>
                  <input
                    defaultValue={advisorEndpointValue}
                    id="settings-advisor-endpoint"
                    name="endpoint"
                    placeholder={advisor.endpointPlaceholder}
                    type="url"
                  />
                </div>
              </div>
            </details>
          ) : null}

          {advisorUsesConfiguredModel || advisorCanToggleLocalModel ? (
            <div className="advisor-settings-actions">
              {advisorUsesConfiguredModel ? (
                <button
                  className="btn btn-primary"
                  disabled={advisorLifecyclePending}
                  type="submit"
                >
                  <Icon name="save" />
                  Save Assistant
                </button>
              ) : null}
              {advisorCanToggleLocalModel ? (
                <button
                  aria-busy={advisorToggle.pending === true}
                  className="btn"
                  disabled={advisorToggle.disabled}
                  type="button"
                  {...actions.action(
                    'toggle-advisor-server',
                    { serverAction: advisorShouldStop ? 'stop' : 'start' },
                    { includeForm: true }
                  )}
                >
                  <Icon name={advisorToggle.icon || 'play_arrow'} />
                  {advisorToggle.label || 'Start Model'}
                </button>
              ) : null}
              {advisorUsesConfiguredModel ? (
                <button
                  aria-busy={advisorTestPending}
                  className="btn"
                  disabled={advisorTestPending}
                  type="button"
                  {...actions.action('test-advisor-connection', {}, { includeForm: true })}
                >
                  <Icon name="network_check" />
                  {advisorTestPending ? 'Testing Model…' : 'Test Model'}
                </button>
              ) : null}
            </div>
          ) : null}
        </form>
        {statusLines.length ? (
          <div aria-live="polite" className="settings-status-list" role="status">
            {statusLines.map((item, index) => (
              <div className="settings-status-item" key={item.icon + '-' + index}>
                <Icon name={item.icon} />
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        ) : null}
      </SettingsCard>
    </div>
  );
}

function FileAction({ action, children, disabled, icon, primary = false }) {
  const actions = useActionBindings();
  return (
    <button
      className={'btn settings-file-action' + (primary ? ' btn-primary' : '')}
      disabled={disabled}
      type="button"
      {...actions.action(action)}
    >
      <Icon name={icon} />
      <span>{children}</span>
    </button>
  );
}

function FilesPanel({ feedback, files, summaryItems }) {
  const actions = useActionBindings();
  const fileSummary = (summaryItems || []).find((item) => item.id === 'save') || {};

  return (
    <div className="settings-content-stack">
      <SettingsFeedback feedback={feedback} />
      <SettingsCard
        headingId="settings-current-file-heading"
        icon="description"
        title="Current file"
        trailing={
          <StatusPill
            icon={files.persistentUnavailable ? 'cloud_off' : 'lock'}
            tone={files.persistentUnavailable ? 'warn' : 'good'}
          >
            {files.persistentUnavailable ? 'Local cache only' : 'Stored locally'}
          </StatusPill>
        }
      >
        <div className="settings-file-summary">
          <span>
            <Icon name={files.canSaveFileNow ? 'cloud_done' : 'cloud_off'} />
          </span>
          <div>
            <strong>{fileSummary.title || 'Local cache only'}</strong>
            <small>{fileSummary.detail || 'No workbook file selected'}</small>
          </div>
        </div>
        <div className="settings-file-action-grid">
          <FileAction
            action="run-file-autosave"
            disabled={!files.canSaveFileNow}
            icon="save"
            primary
          >
            Save Now
          </FileAction>
          <FileAction
            action="choose-autosave-file"
            disabled={!files.canChooseAutosaveFile}
            icon="save_as"
          >
            Save As
          </FileAction>
          <FileAction action="open-workbook-file" icon="folder_open">
            Open File
          </FileAction>
          <FileAction
            action="reveal-workbook-file"
            disabled={!files.canRevealFile}
            icon="folder_managed"
          >
            Show in Finder
          </FileAction>
        </div>
        {files.persistentUnavailable ? (
          <div className="settings-inline-message" role="note">
            <Icon name="info" />
            Persistent file saving is unavailable in this runtime.
          </div>
        ) : null}
      </SettingsCard>

      <SettingsCard
        headingId="settings-transfer-data-heading"
        icon="swap_vert"
        title="Import & export"
      >
        <div className="settings-file-action-grid settings-file-action-grid-three">
          <FileAction action="trigger-csv-import" icon="upload_file">
            Import CSV
          </FileAction>
          <FileAction action="export-csv-bundle" icon="table_view">
            Export CSV
          </FileAction>
          <FileAction action="export-workbook" icon="download">
            Export Copy
          </FileAction>
        </div>
        <input accept=".csv,text/csv" className="hidden" id="settings-import-file" type="file" />
      </SettingsCard>

      <SettingsCard
        className="settings-danger-zone"
        headingId="settings-danger-zone-heading"
        icon="warning"
        title="Workbook controls"
      >
        <div className="settings-setting-list">
          <div className="settings-setting-row">
            <div className="settings-setting-copy">
              <strong>Forget this file</strong>
              <small>Stops saving to the linked file. The file itself stays on disk.</small>
            </div>
            <button
              className="btn"
              disabled={!files.canClearFile}
              type="button"
              {...actions.action('clear-autosave-file')}
            >
              <Icon name="link_off" />
              Forget File
            </button>
          </div>
          <div className="settings-setting-row">
            <div className="settings-setting-copy">
              <strong>Exit workbook</strong>
              <small>
                Closes this workbook and clears it from Cavalry. Export a copy first if you are
                unsure about your latest saved version.
              </small>
            </div>
            <button className="btn btn-danger" type="button" {...actions.action('exit-workbook')}>
              <Icon name="logout" />
              Exit Workbook
            </button>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

function SettingsRouteView({ model, onAction }) {
  const data = model || {};
  const requestedSection = SETTINGS_SECTIONS.some((section) => section.id === data.activeSection)
    ? data.activeSection
    : SETTINGS_SECTIONS[0].id;
  const [activeSection, setActiveSection] = useState(requestedSection);
  const workbook = data.workbook || {};
  const advisor = data.advisor || {};
  const files = data.files || {};
  const counterparties = data.counterparties || [];
  const feedback = data.feedback || {};
  const feedbackSection = SETTINGS_SECTIONS.some((section) => section.id === feedback.section)
    ? feedback.section
    : requestedSection;
  const feedbackFor = (sectionId) => (feedbackSection === sectionId ? feedback : {});

  return (
    <section className="settings-shell" data-react-route="settings">
      <header className="settings-page-header">
        <div>
          <h1>Settings</h1>
        </div>
      </header>

      <div className="settings-layout">
        <SettingsSectionNav activeSection={activeSection} onSelect={setActiveSection} />
        <div className="settings-content">
          <SettingsTabPanel activeSection={activeSection} id="settings-general">
            <WorkspacePanel
              counterparties={counterparties}
              feedback={feedbackFor('settings-general')}
              onAction={onAction}
              workbook={workbook}
            />
          </SettingsTabPanel>
          <SettingsTabPanel activeSection={activeSection} id="settings-appearance">
            <AppearancePanel feedback={feedbackFor('settings-appearance')} />
          </SettingsTabPanel>
          <SettingsTabPanel activeSection={activeSection} id="settings-advisor">
            <AssistantPanel
              advisor={advisor}
              feedback={feedbackFor('settings-advisor')}
              onAction={onAction}
            />
          </SettingsTabPanel>
          <SettingsTabPanel activeSection={activeSection} id="settings-account">
            <CloudAccountPanel
              cloud={data.cloud}
              localSave={data.localSave}
              recovery={data.recovery}
              feedback={feedbackFor('settings-account')}
              onAction={onAction}
              workbook={workbook}
            />
          </SettingsTabPanel>
          <SettingsTabPanel activeSection={activeSection} id="settings-files">
            <FilesPanel
              feedback={feedbackFor('settings-files')}
              files={files}
              summaryItems={data.summaryItems || []}
            />
          </SettingsTabPanel>
        </div>
      </div>
    </section>
  );
}

export function SettingsRoute({ model, onAction }) {
  return (
    <ActionBindingProvider onAction={onAction}>
      <SettingsRouteView model={model} onAction={onAction} />
    </ActionBindingProvider>
  );
}
