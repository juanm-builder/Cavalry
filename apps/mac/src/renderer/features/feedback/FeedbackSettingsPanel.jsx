import React, { useEffect } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

import { FeedbackComposer } from './FeedbackComposer.jsx';
import { FeedbackReportList } from './FeedbackReportList.jsx';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function SettingsCard({ children, headingId, icon, title, trailing }) {
  return (
    <section aria-labelledby={headingId} className="settings-card">
      <header className="settings-card-header">
        <div className="settings-card-heading">
          <span className="settings-card-icon">
            <Icon name={icon} />
          </span>
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

function cloudStatus(model) {
  if (model.signedIn) {
    return model.reportsError
      ? { icon: 'sync_problem', label: 'Sync issue', tone: 'warn' }
      : { icon: 'cloud_done', label: 'Cloud synced', tone: 'good' };
  }
  if (
    !model.configured ||
    ['unavailable', 'unconfigured', 'error'].includes(String(model.status || ''))
  ) {
    return { icon: 'cloud_off', label: 'Cloud unavailable', tone: 'warn' };
  }
  if (['initializing', 'signing_in'].includes(String(model.status || ''))) {
    return { icon: 'progress_activity', label: 'Connecting', tone: 'neutral' };
  }
  return { icon: 'login', label: 'Sign in required', tone: 'warn' };
}

export function FeedbackSettingsPanel({ feedback, onOpenAccountSettings, routeId = 'settings' }) {
  const model = feedback?.model || {};
  const ensureLoaded = feedback?.ensureLoaded;
  const status = cloudStatus(model);

  useEffect(() => {
    void ensureLoaded?.();
  }, [ensureLoaded]);

  return (
    <div className="settings-content-stack feedback-settings-panel">
      {model.notice ? (
        <div className={`feedback-message ${model.warning ? 'warn' : 'good'}`} role="status">
          <Icon name={model.warning ? 'warning' : 'check_circle'} />
          <span>{model.notice}</span>
        </div>
      ) : null}
      <SettingsCard
        headingId="settings-feedback-compose-heading"
        icon="rate_review"
        title="Send feedback"
        trailing={
          <span className={`settings-status-pill ${status.tone}`}>
            <Icon name={status.icon} />
            {status.label}
          </span>
        }
      >
        <p className="feedback-settings-intro">
          Tell us about a rough edge or an idea. Your report stays with your private Cavalry Cloud
          account and is available from your signed-in devices.
        </p>
        <FeedbackComposer
          feedback={model}
          key={model.sessionKey || 'feedback-session'}
          onOpenAccountSettings={onOpenAccountSettings}
          onSubmit={feedback?.submit}
          routeId={routeId}
          source="settings"
        />
      </SettingsCard>

      {model.signedIn ? (
        <SettingsCard
          headingId="settings-feedback-reports-heading"
          icon="history"
          title="Your reports"
          trailing={
            <button
              className="btn"
              disabled={model.pendingOperation === 'list'}
              onClick={() => void feedback?.refresh?.()}
              type="button"
            >
              <Icon name="refresh" />
              Refresh
            </button>
          }
        >
          <FeedbackReportList
            feedback={model}
            onDownloadAttachment={feedback?.downloadAttachment}
          />
        </SettingsCard>
      ) : null}
    </div>
  );
}
