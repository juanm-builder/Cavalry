import React, { useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

import { FeedbackComposer } from './FeedbackComposer.jsx';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

export function CompanionFeedbackPanel({ createId, feedback, onBack, onOpenSettings, routeId }) {
  const [submissionResult, setSubmissionResult] = useState(null);
  const model = feedback?.model || {};

  return (
    <section aria-labelledby="companion-feedback-heading" className="companion-feedback-panel">
      <header>
        <button
          aria-label="Back to Cavalry chat"
          className="btn btn-icon"
          onClick={onBack}
          type="button"
        >
          <Icon name="arrow_back" />
        </button>
        <div>
          <h2 id="companion-feedback-heading">Report a problem</h2>
          <p>Send a private Cloud report without leaving your current context.</p>
        </div>
      </header>

      {submissionResult ? (
        <div className="companion-feedback-success" role="status">
          <span>
            <Icon name="cloud_done" />
          </span>
          <h3>Report sent</h3>
          <p>It is synced with your Cavalry Cloud account and available across your devices.</p>
          {submissionResult.warning ? (
            <div className="feedback-message warn">
              <Icon name="warning" />
              <span>{submissionResult.warning}</span>
            </div>
          ) : null}
          <div>
            <button
              className="btn btn-primary"
              onClick={() => onOpenSettings?.('settings-feedback')}
              type="button"
            >
              View your reports
            </button>
            <button className="btn" onClick={() => setSubmissionResult(null)} type="button">
              Send another
            </button>
          </div>
        </div>
      ) : (
        <FeedbackComposer
          compact
          createId={createId}
          feedback={model}
          onOpenAccountSettings={() => onOpenSettings?.('settings-account')}
          onSubmit={feedback?.submit}
          onSubmitted={setSubmissionResult}
          routeId={routeId}
          source="assistant"
        />
      )}
    </section>
  );
}
