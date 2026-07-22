import React from 'react';
import { createPortal } from 'react-dom';

import cavalryMark from '../../assets/cavalry-mark.png';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';

function Icon({ name }) {
  return (
    <span aria-hidden="true" className="material-symbols-rounded">
      {name}
    </span>
  );
}

const WELCOME_POINTS = Object.freeze([
  {
    id: 'private',
    icon: 'auto_awesome',
    title: 'Your data stays with you',
    body: 'Your financial data is stored locally on your Mac. You are in control.'
  },
  {
    id: 'assistant',
    icon: 'forum',
    title: 'AI that works for you',
    body: 'Ask questions, get insights, and let Cavalry help you take action.'
  },
  {
    id: 'early-access',
    icon: 'science',
    title: 'Early access means we are still building',
    body: 'You may run into bugs or rough edges. Your feedback helps us improve.'
  }
]);

export function WelcomeModal({ onDismiss, onGetStarted }) {
  const dismissOnBackdrop = useModalDismiss(onDismiss);

  return createPortal(
    <div className="modal-backdrop onboarding-backdrop" onMouseDown={dismissOnBackdrop}>
      <section
        aria-labelledby="onboarding-welcome-title"
        aria-modal="true"
        className="modal-card onboarding-welcome"
        role="dialog"
      >
        <header className="onboarding-welcome-header">
          <span aria-hidden="true" className="onboarding-welcome-mark">
            <img alt="" src={cavalryMark} />
          </span>
          <div>
            <h1 id="onboarding-welcome-title">
              Welcome to Cavalry
              <span className="onboarding-badge">Early access</span>
            </h1>
            <p>Thank you for helping shape the future of personal finance.</p>
          </div>
        </header>
        <ul className="onboarding-welcome-points">
          {WELCOME_POINTS.map((point) => (
            <li key={point.id}>
              <span aria-hidden="true" className="onboarding-point-icon">
                <Icon name={point.icon} />
              </span>
              <span>
                <strong>{point.title}</strong>
                <small>{point.body}</small>
              </span>
            </li>
          ))}
        </ul>
        <footer className="onboarding-welcome-actions">
          <button className="btn btn-quiet" onClick={onDismiss} type="button">
            Not now
          </button>
          <button className="btn btn-primary" onClick={onGetStarted} type="button">
            Let&rsquo;s get started
            <Icon name="arrow_forward" />
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
