import React from 'react';

import { CavalryIcon } from '../shared/CavalryIcon.jsx';

const HIDDEN_STATUSES = new Set(['disabled', 'idle', 'checking', 'up-to-date']);

function versionSuffix(version) {
  return version ? ` ${version}` : '';
}

function getPresentation(state, update) {
  const version = String(state.version || '').trim();
  const percent = Math.min(100, Math.max(0, Math.round(Number(state.percent) || 0)));

  if (state.status === 'available') {
    return {
      action: update.downloadUpdate,
      actionLabel: `Download Cavalry update${versionSuffix(version)}`,
      detail: version ? `Version ${version}` : 'Ready to download',
      icon: 'download',
      title: 'Update available'
    };
  }
  if (state.status === 'downloading') {
    return {
      detail: version ? `Version ${version}` : 'Downloading in the background',
      icon: 'downloading',
      percent,
      title: 'Downloading update'
    };
  }
  if (state.status === 'ready') {
    return {
      action: update.restartAndInstall,
      actionLabel: `Restart Cavalry to install update${versionSuffix(version)}`,
      detail: version ? `Version ${version} is ready` : 'Ready to install',
      icon: 'restart_alt',
      title: 'Restart to update'
    };
  }
  if (state.status === 'error' && state.kind === 'download') {
    return {
      action: update.downloadUpdate,
      actionLabel: `Retry downloading Cavalry update${versionSuffix(version)}`,
      detail: 'Check your connection and retry',
      icon: 'sync_problem',
      title: 'Download paused'
    };
  }
  return null;
}

export function isSidebarUpdateVisible(state = {}) {
  const status = String(state.status || 'disabled');
  if (HIDDEN_STATUSES.has(status)) return false;
  return status !== 'error' || String(state.kind || '').toLowerCase() === 'download';
}

export function SidebarUpdateStatus({ update = {} }) {
  const state = update.state || {};
  if (!isSidebarUpdateVisible(state)) return null;
  const presentation = getPresentation(state, update);
  if (!presentation) return null;

  if (state.status === 'downloading') {
    return (
      <span
        aria-hidden="true"
        className="rail-update-indicator downloading"
        title={`${presentation.title}, ${presentation.percent}%`}
      >
        <CavalryIcon name={presentation.icon} />
      </span>
    );
  }

  return (
    <button
      aria-label={presentation.actionLabel}
      className={`btn btn-icon rail-update-button ${state.status}`}
      disabled={typeof presentation.action !== 'function'}
      onClick={() => void presentation.action?.()}
      title={presentation.actionLabel}
      type="button"
    >
      <CavalryIcon name={presentation.icon} />
    </button>
  );
}

export function SidebarUpdateProgress({ update = {} }) {
  const state = update.state || {};
  if (state.status !== 'downloading') return null;
  const presentation = getPresentation(state, update);
  if (!presentation) return null;

  return (
    <section aria-label="Software update" className="rail-update-progress-card">
      <div className="rail-update-progress-copy">
        <CavalryIcon name={presentation.icon} />
        <span>
          <strong>{presentation.title}</strong>
          <small>{presentation.detail}</small>
        </span>
        <b aria-hidden="true">{presentation.percent}%</b>
      </div>
      <div
        aria-label={`Downloading Cavalry update${versionSuffix(state.version)}`}
        aria-valuemax="100"
        aria-valuemin="0"
        aria-valuenow={presentation.percent}
        aria-valuetext={`${presentation.percent}% downloaded`}
        className="rail-update-progress"
        role="progressbar"
      >
        <span style={{ width: `${presentation.percent}%` }} />
      </div>
    </section>
  );
}
