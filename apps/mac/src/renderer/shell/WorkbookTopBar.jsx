import React from 'react';

import { CavalryAssistantMark } from '../features/assistant/CavalryAssistantMark.jsx';
import { SetupProgressButton } from '../features/onboarding/SetupChecklist.jsx';
import { CavalryIcon } from '../shared/CavalryIcon.jsx';
import { formatUiDateTime } from '../shared/date-format.js';

const SAVE_PRESENTATIONS = Object.freeze({
  idle: Object.freeze({ label: 'Not saved', tone: 'info' }),
  dirty: Object.freeze({ label: 'Unsaved changes', tone: 'warn' }),
  saving: Object.freeze({ label: 'Saving…', tone: 'info' }),
  saved: Object.freeze({ label: 'Saved', tone: 'good' }),
  cache: Object.freeze({ label: 'Saved locally', tone: 'info' }),
  error: Object.freeze({ label: 'Save failed', tone: 'bad' })
});

export function getSaveStatusPresentation(save = {}) {
  const status = String(save.status || 'idle');
  const presentation = SAVE_PRESENTATIONS[status] || SAVE_PRESENTATIONS.idle;
  let detail = presentation.label;

  if (status === 'error' && save.error) {
    detail = String(save.error);
  } else if ((status === 'saved' || status === 'cache') && save.lastSavedAt) {
    detail = `${presentation.label} at ${formatUiDateTime(save.lastSavedAt)}`;
  }

  return { ...presentation, detail, status };
}

function getWorkbookSubtitle(workbook) {
  const parts = [];
  if (workbook?.year !== undefined && workbook?.year !== null && workbook?.year !== '') {
    parts.push(String(workbook.year));
  }
  if (workbook?.currency) {
    parts.push(`${workbook.currency} base`);
  }
  return parts.join(' • ');
}

export function WorkbookTopBar({
  workbook,
  save = {},
  navigationCompact = false,
  onAskAssistant,
  onAskAdvisor,
  onOpenCommandPalette,
  onOpenSetupGuide,
  onToggleNavigation,
  setupProgress = null
}) {
  const savePresentation = getSaveStatusPresentation(save);
  const workbookName = workbook?.name || 'Cavalry';
  const subtitle = getWorkbookSubtitle(workbook);
  const askAssistant = onAskAssistant || onAskAdvisor;
  const askLabel = typeof onAskAssistant === 'function' ? 'Ask Cavalry' : 'Ask Advisor';

  return (
    <header className="top-strip">
      <button
        aria-label={navigationCompact ? 'Expand navigation' : 'Collapse navigation'}
        aria-pressed={navigationCompact}
        className="btn btn-icon top-navigation-toggle"
        onClick={onToggleNavigation}
        title={navigationCompact ? 'Expand navigation' : 'Collapse navigation'}
        type="button"
      >
        <CavalryIcon name={navigationCompact ? 'dock_to_right' : 'dock_to_left'} />
      </button>
      <div className="top-copy">
        <h2>{workbookName}</h2>
        <p>
          {subtitle ? <span>{subtitle}</span> : null}
          <span
            aria-live="polite"
            className={`header-save-indicator ${savePresentation.tone}`}
            role="status"
            title={savePresentation.detail}
          >
            <i aria-hidden="true" />
            {savePresentation.label}
          </span>
        </p>
      </div>
      <div className="top-actions">
        {setupProgress && typeof onOpenSetupGuide === 'function' ? (
          <SetupProgressButton
            completedCount={setupProgress.completedCount}
            onClick={onOpenSetupGuide}
            totalCount={setupProgress.totalCount}
          />
        ) : null}
        <button
          aria-label="Open command menu"
          className="btn btn-soft command-menu-trigger"
          onClick={onOpenCommandPalette}
          title="Search pages and actions"
          type="button"
        >
          <CavalryIcon name="search" />
          <span>Search</span>
          <kbd>⌘ K</kbd>
        </button>
        <button
          aria-label={askLabel}
          className="btn btn-soft"
          disabled={typeof askAssistant !== 'function'}
          onClick={askAssistant}
          title="Open the Cavalry assistant"
          type="button"
        >
          <CavalryAssistantMark className="cavalry-assistant-inline-mark" />
          {askLabel}
        </button>
      </div>
    </header>
  );
}
