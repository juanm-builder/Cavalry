import React, { useEffect } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { createPortal } from 'react-dom';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

export function SetupChecklistPanel({ checklist, onClose, onDismiss, onItemAction }) {
  const { items, completedCount, totalCount, allComplete } = checklist;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <section aria-label="Setup guide" className="setup-checklist-panel" role="dialog">
      <header className="setup-checklist-header">
        <div>
          <strong>{allComplete ? 'You’re all set' : 'Let’s get you set up'}</strong>
          <small>
            {completedCount} of {totalCount} completed
          </small>
        </div>
        <button
          aria-label="Close setup guide"
          className="btn btn-icon"
          onClick={onClose}
          type="button"
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="setup-checklist-progress" role="presentation">
        <i style={{ width: `${Math.round((completedCount / totalCount) * 100)}%` }} />
      </div>
      <ul className="setup-checklist-items">
        {items.map((item) => (
          <li key={item.id}>
            <button
              className={`setup-checklist-item${item.complete ? ' complete' : ''}`}
              onClick={() => onItemAction?.(item.id)}
              type="button"
            >
              <span
                aria-hidden="true"
                className={`setup-checklist-status${item.complete ? ' complete' : ''}`}
              >
                {item.complete ? <Icon name="check" /> : null}
              </span>
              <span className="setup-checklist-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <Icon name="chevron_right" />
            </button>
          </li>
        ))}
      </ul>
      <footer className="setup-checklist-footer">
        {allComplete ? (
          <>
            <span>Nice work — Cavalry is ready to ride. 🎉</span>
            <button className="btn btn-quiet" onClick={onDismiss} type="button">
              Hide setup guide
            </button>
          </>
        ) : (
          <>
            <span>Progress updates automatically as you go.</span>
            <button className="btn btn-quiet" onClick={onDismiss} type="button">
              Hide
            </button>
          </>
        )}
      </footer>
    </section>,
    document.body
  );
}

const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function SetupProgressButton({ completedCount, totalCount, onClick }) {
  const fraction = totalCount > 0 ? completedCount / totalCount : 0;
  return (
    <button
      aria-label={`Open setup guide, ${completedCount} of ${totalCount} steps completed`}
      className="btn btn-soft setup-progress-trigger"
      onClick={onClick}
      title="Finish setting up your workspace"
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <circle className="setup-progress-track" cx="10" cy="10" r={RING_RADIUS} />
        <circle
          className="setup-progress-fill"
          cx="10"
          cy="10"
          r={RING_RADIUS}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <span>Set up</span>
      <small>
        {completedCount}/{totalCount}
      </small>
    </button>
  );
}
