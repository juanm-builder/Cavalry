import React, { useState } from 'react';
import { shouldRefreshWorkbookConflictReview } from '@cavalry/finance-core';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { useActionBindings } from '../../shared/action-binding.jsx';
import { readAccountProfile, writeAccountProfile } from './account-preferences.js';
import {
  CloudLibrarySurface,
  cloudLibraryCountLabel,
  cloudLibraryCounts
} from './CloudLibrarySurface.jsx';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function formPayload(form) {
  const payload = {};
  if (!(form && typeof FormData === 'function')) return payload;
  new FormData(form).forEach((value, key) => {
    if (!(key in payload) && typeof value === 'string') payload[key] = value;
  });
  return payload;
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
  return (
    <section
      aria-labelledby={headingId}
      className={['settings-card', className].filter(Boolean).join(' ')}
    >
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

function formatCloudTimestamp(value) {
  const source = asString(value);
  if (!source) return '';
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return source;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function LocalProfile() {
  const storage = typeof window !== 'undefined' ? window.localStorage : null;
  const [profile, setProfile] = useState(() => readAccountProfile(storage));
  const [profileNotice, setProfileNotice] = useState('');

  const saveProfile = (event) => {
    event.preventDefault();
    const saved = writeAccountProfile(storage, formPayload(event.currentTarget));
    setProfile(saved);
    setProfileNotice('Profile saved on this Mac.');
  };

  return (
    <SettingsCard
      headingId="settings-account-profile-heading"
      icon="account_circle"
      title="Profile"
      trailing={
        <StatusPill icon="lock" tone="good">
          Stored on this Mac
        </StatusPill>
      }
    >
      <form className="settings-account-form" id="account-profile-form" onSubmit={saveProfile}>
        <div className="field">
          <label htmlFor="settings-account-name">Name</label>
          <input
            defaultValue={profile.name}
            id="settings-account-name"
            key={'name-' + profile.name}
            name="name"
            placeholder="How Cavalry should greet you"
            type="text"
          />
        </div>
        <div className="field">
          <label htmlFor="settings-account-email">
            Email <span className="field-optional">Optional</span>
          </label>
          <input
            defaultValue={profile.email}
            id="settings-account-email"
            inputMode="email"
            key={'email-' + profile.email}
            name="email"
            placeholder="you@example.com"
            type="text"
          />
        </div>
        <button className="btn btn-primary settings-account-save" type="submit">
          <Icon name="save" />
          Save Profile
        </button>
      </form>
      {profileNotice ? (
        <div className="settings-inline-message" role="status">
          <Icon name="check_circle" />
          {profileNotice}
        </div>
      ) : null}
    </SettingsCard>
  );
}

function ICloudIdentity({ cloud }) {
  const actions = useActionBindings();
  const signedIn = cloud.status === 'signed_in';
  const checking = cloud.status === 'initializing';
  const unavailable = cloud.status === 'unavailable';
  const pendingCount = Math.max(0, Number(cloud.pendingCount) || 0);
  const pending = !!asString(cloud.pendingOperation);
  const lastSyncAt = formatCloudTimestamp(cloud.lastSyncAt);
  const label = checking
    ? 'Checking iCloud'
    : signedIn
      ? pendingCount
        ? `${pendingCount} pending`
        : 'Connected'
      : unavailable
        ? 'Unavailable'
        : 'Sign in needed';
  const icon = checking
    ? 'progress_activity'
    : signedIn
      ? pendingCount
        ? 'cloud_upload'
        : 'cloud_done'
      : 'cloud_off';

  return (
    <div className="settings-cloud-overview">
      <span className="settings-cloud-welcome-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <div className="settings-cloud-welcome-copy">
        <strong>
          {signedIn
            ? 'Connected to your private iCloud library'
            : checking
              ? 'Checking your iCloud connection'
              : 'iCloud is not connected'}
        </strong>
        <p>
          {signedIn
            ? lastSyncAt
              ? `Last checked ${lastSyncAt}. Changes save on this Mac before they sync.`
              : 'Changes save on this Mac before they sync to your other Apple devices.'
            : 'Sign in under System Settings › Apple Account › iCloud. Cavalry reconnects when you return.'}
        </p>
      </div>
      <div className="settings-cloud-overview-actions">
        <StatusPill
          icon={icon}
          tone={signedIn && !pendingCount ? 'good' : unavailable || !signedIn ? 'warn' : 'info'}
        >
          {label}
        </StatusPill>
        {signedIn ? (
          <button
            className="btn"
            disabled={pending || checking}
            type="button"
            {...actions.action('refresh-cloud-workbooks')}
          >
            <Icon name="refresh" />
            {pendingOperationLabel(cloud.pendingOperation, 'Checking…', 'Check Now')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function pendingOperationLabel(operation, pendingLabel, idleLabel) {
  return asString(operation) === 'refresh' ? pendingLabel : idleLabel;
}

function CloudSyncError({ cloud, workbook, scope = 'global' }) {
  const actions = useActionBindings();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const error = asString(cloud.error);
  if (!error) return null;

  const failedOperation = asString(cloud.failedOperation);
  const errorOperation = asString(cloud.errorOperation);
  const errorWorkbookId = asString(cloud.errorWorkbookId || cloud.failedWorkbookId);
  const currentWorkbookId = asString(asObject(cloud.current).workbookId);
  const retryScope = failedOperation || errorOperation;
  const currentOperations = ['upload', 'keep-local', 'reconcile', 'conflict'];
  const libraryOperations = ['delete', 'open'];
  const errorSurface = currentOperations.includes(retryScope)
    ? 'current'
    : libraryOperations.includes(retryScope)
      ? 'library'
      : 'global';
  if (scope !== errorSurface) return null;
  const appliesToCurrentWorkbook =
    currentOperations.includes(retryScope) &&
    (!errorWorkbookId || errorWorkbookId === currentWorkbookId);
  const retryAction =
    appliesToCurrentWorkbook && retryScope === 'upload'
      ? 'upload-current-workbook'
      : appliesToCurrentWorkbook && retryScope === 'keep-local'
        ? 'keep-local-cloud-workbook'
        : retryScope === 'delete' && errorWorkbookId
          ? 'delete-cloud-workbook'
          : retryScope === 'open' && errorWorkbookId
            ? 'open-cloud-workbook'
            : 'refresh-cloud-workbooks';
  const retryPayload =
    libraryOperations.includes(retryScope) && errorWorkbookId
      ? { workbookId: errorWorkbookId }
      : {};
  const retryLabel =
    appliesToCurrentWorkbook && retryScope === 'upload'
      ? 'Retry Add'
      : appliesToCurrentWorkbook && retryScope === 'keep-local'
        ? 'Retry Upload'
        : retryScope === 'delete'
          ? 'Retry Delete'
          : retryScope === 'open'
            ? 'Retry Open'
            : 'Check Again';
  const errorCode = asString(cloud.errorCode);
  const details = asString(cloud.errorDetails);
  const workbookName = asString(workbook.name) || 'The current workbook';
  const targetWorkbook = asArray(cloud.workbooks).find(
    (item) => asString(item?.id || item?.workbookId) === errorWorkbookId
  );
  const targetWorkbookName =
    asString(cloud.errorWorkbookName || targetWorkbook?.name || targetWorkbook?.title) ||
    'The selected workbook';
  const pending = !!asString(cloud.pendingOperation);

  return (
    <div className="settings-cloud-error">
      <span className="settings-cloud-error-icon" aria-hidden="true">
        <Icon name="error" />
      </span>
      <div className="settings-cloud-error-copy" role="alert">
        <strong>{error}</strong>
        <p>
          {appliesToCurrentWorkbook
            ? `${workbookName} remains saved on this Mac. No local data was replaced or deleted.`
            : retryScope === 'delete'
              ? `${targetWorkbookName}'s iCloud copy was not removed. Nothing saved on this Mac was deleted.`
              : retryScope === 'open'
                ? `${targetWorkbookName} could not be opened. The workbook already open on this Mac is unchanged.`
                : 'No workbook saved on this Mac was changed or deleted.'}
        </p>
        {detailsOpen ? (
          <div className="settings-cloud-error-details" role="note">
            {details || `Technical code: ${errorCode || 'cloud_request_failed'}.`}
          </div>
        ) : null}
      </div>
      <div className="settings-cloud-error-actions">
        <button
          className="btn btn-primary"
          disabled={pending}
          type="button"
          {...actions.action(retryAction, retryPayload)}
        >
          <Icon name="refresh" />
          {retryLabel}
        </button>
        <button className="btn" onClick={() => setDetailsOpen((open) => !open)} type="button">
          <Icon name="info" />
          {detailsOpen ? 'Hide Details' : 'View Details'}
        </button>
      </div>
    </div>
  );
}

function conflictDetailValue(detail, action) {
  const source = asObject(detail);
  const before = asString(source.before);
  const after = asString(source.after);
  return action === 'deleted' ? before || after || 'None' : after || before || 'None';
}

function findConflictDetail(details, labels) {
  return details.find((detail) => labels.includes(asString(detail.label).toLowerCase()));
}

function conflictSidePresentation(entry, sideKey) {
  const side = asObject(entry[sideKey]);
  const other = asObject(entry[sideKey === 'local' ? 'remote' : 'local']);
  const action = asString(side.action);
  const details = asArray(side.details).map(asObject);
  const titleDetail = findConflictDetail(details, ['description', 'name']);
  const amountDetail = findConflictDetail(details, ['amount', 'planned amount', 'value']);
  const titleValue = titleDetail ? conflictDetailValue(titleDetail, action) : '';
  const amountValue = amountDetail ? conflictDetailValue(amountDetail, action) : '';
  const fallbackTitle = asString(entry.title) || 'Change';
  const primaryTitle = titleValue && titleValue !== 'None' ? titleValue : fallbackTitle;
  const primary = [primaryTitle, amountValue && amountValue !== primaryTitle ? amountValue : '']
    .filter(Boolean)
    .join(' · ');
  const usedDetails = new Set([titleDetail, amountDetail].filter(Boolean));
  const secondary = [];

  if (amountDetail && ['edited', 'different'].includes(action)) {
    const before = asString(amountDetail.before);
    const after = asString(amountDetail.after);
    if (before && before !== after) secondary.push(`Was ${before}`);
  }

  details.forEach((detail) => {
    if (secondary.length >= 2 || usedDetails.has(detail)) return;
    const value = conflictDetailValue(detail, action);
    if (!value || value === 'None') return;
    const label = asString(detail.label) || 'Value';
    secondary.push(label === 'Date' ? value : `${label}: ${value}`);
  });

  const otherAction = asString(other.action);
  const status =
    action === 'deleted'
      ? 'Deleted'
      : otherAction === 'deleted'
        ? 'Kept'
        : action === 'added'
          ? 'Added'
          : action === 'unchanged'
            ? 'Unchanged'
            : action === 'different'
              ? 'Different'
              : 'Edited';

  return {
    action,
    label: asString(side.label) || (sideKey === 'local' ? 'This device' : 'iCloud'),
    primary,
    secondary,
    status
  };
}

function conflictQuestion(entry) {
  const localAction = asString(asObject(entry.local).action);
  const remoteAction = asString(asObject(entry.remote).action);
  if ((localAction === 'deleted') !== (remoteAction === 'deleted')) {
    return asString(entry.section).toLowerCase() === 'transactions'
      ? 'Keep this transaction?'
      : 'Keep this item?';
  }
  return 'Which version should Cavalry keep?';
}

function conflictChoiceLabel(entry, sideKey) {
  const side = asObject(entry[sideKey]);
  const other = asObject(entry[sideKey === 'local' ? 'remote' : 'local']);
  const action = asString(side.action);
  const deletionChoice = (action === 'deleted') !== (asString(other.action) === 'deleted');
  if (deletionChoice) {
    return action === 'deleted' ? 'No — delete everywhere' : 'Yes — keep everywhere';
  }
  return `Use ${asString(side.label) || (sideKey === 'local' ? 'this device' : 'iCloud')}`;
}

function shortConflictLocation(label) {
  const source = asString(label);
  if (/icloud/i.test(source)) return 'iCloud';
  return source.replace(/^this\s+/i, '') || 'device';
}

function conflictQueueSummary(entry) {
  const local = asObject(entry.local);
  const remote = asObject(entry.remote);
  const localAction = asString(local.action);
  const remoteAction = asString(remote.action);
  if ((localAction === 'deleted') !== (remoteAction === 'deleted')) {
    const deleted = localAction === 'deleted' ? local : remote;
    const kept = localAction === 'deleted' ? remote : local;
    return `Deleted on ${shortConflictLocation(deleted.label)} · Still in ${shortConflictLocation(kept.label)}`;
  }
  const localLabels = new Set(
    asArray(local.details).map((detail) => asString(asObject(detail).label))
  );
  const changedLabel = asArray(remote.details)
    .map((detail) => asString(asObject(detail).label))
    .find((label) => label && localLabels.has(label));
  return `${changedLabel || asString(entry.section) || 'Item'} changed on both devices`;
}

function ConflictVersionRow({ entry, sideKey }) {
  const side = conflictSidePresentation(entry, sideKey);
  return (
    <div
      className={
        'settings-cloud-conflict-version' + (side.action === 'deleted' ? ' is-deleted' : '')
      }
    >
      <strong className="settings-cloud-conflict-version-label">{side.label}</strong>
      <span className="settings-cloud-conflict-version-copy">
        <b>{side.primary}</b>
        {side.secondary.length ? <small>{side.secondary.join(' · ')}</small> : null}
      </span>
      <span className="settings-cloud-conflict-version-status">{side.status}</span>
    </div>
  );
}

function ConflictReview({ activePath, canResolve, choices, notice, onChoose, onReviewEntry }) {
  const report = asObject(asObject(notice).report);
  const entries = asArray(report.entries);
  if (!entries.length) return null;
  const activeIndex = Math.max(
    0,
    entries.findIndex((rawEntry) => asString(asObject(rawEntry).path) === activePath)
  );
  const entry = asObject(entries[activeIndex]);
  const entryPath = asString(entry.path);
  const queuedEntries = entries
    .map((rawEntry, index) => ({ entry: asObject(rawEntry), index }))
    .filter(({ index }) => index !== activeIndex);

  return (
    <div className="settings-cloud-conflict-review" data-testid="cloud-conflict-review">
      <article className="settings-cloud-conflict-entry" key={asString(entry.key) || activeIndex}>
        <header className="settings-cloud-conflict-entry-header">
          <span className="settings-cloud-conflict-number">{activeIndex + 1}</span>
          <strong>{asString(entry.title) || 'Change'}</strong>
        </header>
        <div className="settings-cloud-conflict-versions">
          <ConflictVersionRow entry={entry} sideKey="local" />
          <ConflictVersionRow entry={entry} sideKey="remote" />
        </div>
        {canResolve ? (
          <div className="settings-cloud-conflict-decision">
            <strong>{conflictQuestion(entry)}</strong>
            <div className="settings-cloud-conflict-sides" role="radiogroup">
              {['local', 'remote'].map((sideKey) => {
                const side = asObject(entry[sideKey]);
                const selected = choices[entryPath] === sideKey;
                return (
                  <button
                    aria-checked={selected}
                    aria-label={`Use ${asString(side.label) || 'this copy'} for ${asString(entry.title) || 'this change'}`}
                    className={'settings-cloud-conflict-side' + (selected ? ' is-selected' : '')}
                    key={`${asString(entry.key)}:${sideKey}`}
                    onClick={() => onChoose(entryPath, sideKey)}
                    role="radio"
                    type="button"
                  >
                    <span className="settings-cloud-conflict-radio" aria-hidden="true" />
                    <strong>{conflictChoiceLabel(entry, sideKey)}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <strong className="settings-cloud-conflict-finish">
            The full conflict details are still syncing from{' '}
            {asString(notice.sourceDevice) || 'the other device'}. Choose Sync Now and try again.
          </strong>
        )}
      </article>
      {queuedEntries.length ? (
        <section className="settings-cloud-conflict-queue" aria-label="Other decisions">
          <strong className="settings-cloud-conflict-queue-label">Up next</strong>
          <div className="settings-cloud-conflict-queue-list">
            {queuedEntries.map(({ entry: queuedEntry, index }) => {
              const path = asString(queuedEntry.path);
              const chosen = !!choices[path];
              return (
                <div
                  className="settings-cloud-conflict-queue-row"
                  key={asString(queuedEntry.key) || index}
                >
                  <span className="settings-cloud-conflict-number">{index + 1}</span>
                  <span className="settings-cloud-conflict-queue-copy">
                    <strong>{asString(queuedEntry.title) || 'Change'}</strong>
                    <small>{conflictQueueSummary(queuedEntry)}</small>
                  </span>
                  {chosen ? <StatusPill tone="good">Chosen</StatusPill> : null}
                  <button className="btn" onClick={() => onReviewEntry(path)} type="button">
                    Review
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      {Number(report.omittedCount) > 0 ? (
        <small>{Number(report.omittedCount)} more changes are not shown.</small>
      ) : null}
    </div>
  );
}

function CurrentWorkbookCloudAction({ cloud, workbook }) {
  const actions = useActionBindings();
  const [simpleConfirmation, setSimpleConfirmation] = useState('');
  const [confirmingReconcileNoticeId, setConfirmingReconcileNoticeId] = useState(null);
  const [reviewNoticeId, setReviewNoticeId] = useState(null);
  const [conflictChoiceState, setConflictChoiceState] = useState({
    noticeId: '',
    values: {}
  });
  const [activeConflictState, setActiveConflictState] = useState({
    noticeId: '',
    path: ''
  });
  const current = asObject(cloud.current);
  const conflictNotice = asObject(current.conflictNotice);
  const conflictNoticeId = asString(conflictNotice.id);
  const confirmingReconcile = confirmingReconcileNoticeId === conflictNoticeId;
  const reviewOpen = reviewNoticeId === conflictNoticeId;
  const conflictChoices =
    conflictChoiceState.noticeId === conflictNoticeId ? conflictChoiceState.values : {};
  const conflictReviewNeedsRefresh =
    !!conflictNoticeId && shouldRefreshWorkbookConflictReview(conflictNotice.report);
  const conflictEntries = conflictReviewNeedsRefresh
    ? []
    : asArray(asObject(conflictNotice.report).entries);
  const pendingOperation = asString(cloud.pendingOperation);
  const linked = current.linked === true;
  const conflict = current.conflict === true || asString(current.status) === 'conflict';
  const sharedReview = !conflict && (conflictEntries.length > 0 || conflictReviewNeedsRefresh);
  const hasReview = conflictEntries.length > 0;
  const canReconcile =
    hasReview &&
    conflictNotice.resolutionAvailable === true &&
    Number(asObject(conflictNotice.report).omittedCount) === 0;
  const selectedConflictCount = conflictEntries.filter(
    (entry) => conflictChoices[asString(asObject(entry).path)]
  ).length;
  const firstConflictPath = asString(asObject(conflictEntries[0]).path);
  const activeConflictPath =
    activeConflictState.noticeId === conflictNoticeId &&
    conflictEntries.some(
      (entry) => asString(asObject(entry).path) === asString(activeConflictState.path)
    )
      ? asString(activeConflictState.path)
      : firstConflictPath;
  const queued = asString(current.status) === 'pending';
  const pending = !!pendingOperation;
  const workbookName = asString(workbook.name) || 'Current workbook';
  const currentWorkbookId = asString(current.workbookId);
  const currentCloudItem = asArray(cloud.workbooks).find(
    (item) => asString(item?.id || item?.workbookId) === currentWorkbookId
  );
  const cloudCopyAvailable = !!currentCloudItem;
  const queuedCreate = currentCloudItem?.pending === true && currentCloudItem?.inCloud !== true;
  const missingCloudCopy = conflict && !cloudCopyAvailable;
  const cloudUpdatedAt = formatCloudTimestamp(current.cloudUpdatedAt);

  const runSimpleAction = async (type, payload = {}) => {
    const result = await actions.dispatch(type, payload);
    if (result && result.ok) setSimpleConfirmation('');
  };

  const simpleConfirmationCopy =
    simpleConfirmation === 'icloud'
      ? {
          message:
            'Opens the iCloud version on this Mac. Your current Mac file stays saved locally.',
          label: 'Confirm Use iCloud Version',
          icon: 'download',
          pendingLabel: 'Opening…',
          tone: 'primary'
        }
      : simpleConfirmation === 'mac'
        ? {
            message: cloudCopyAvailable
              ? 'Replaces the iCloud version with this Mac version on your Apple devices.'
              : 'Adds this Mac version to iCloud so it is available on your Apple devices.',
            label: cloudCopyAvailable ? 'Confirm Use Mac Version' : 'Confirm Add to iCloud',
            icon: 'cloud_upload',
            pendingLabel: 'Uploading…',
            tone: 'primary'
          }
        : simpleConfirmation === 'delete'
          ? {
              message: queuedCreate
                ? 'Cancels this queued upload. This workbook stays saved on this Mac.'
                : 'Deletes only the iCloud version. This workbook stays saved on this Mac.',
              label: queuedCreate ? 'Confirm Cancel Upload' : 'Confirm Delete from iCloud',
              icon: 'delete_forever',
              pendingLabel: 'Deleting…',
              tone: 'danger'
            }
          : null;

  return (
    <div
      className={
        'settings-cloud-current' +
        (conflict || sharedReview ? ' has-conflict' : '') +
        (reviewOpen ? ' is-reviewing' : '')
      }
    >
      <span className={'settings-cloud-current-icon' + (linked && !queued ? ' is-linked' : '')}>
        <Icon
          name={
            conflict || sharedReview
              ? 'sync_problem'
              : queued
                ? 'cloud_upload'
                : linked
                  ? 'cloud_done'
                  : 'cloud_upload'
          }
        />
      </span>
      <div className="settings-cloud-current-copy">
        <span className="settings-cloud-current-title">
          <strong>{workbookName}</strong>
          {conflictReviewNeedsRefresh ? (
            <StatusPill tone="warn">Updating details</StatusPill>
          ) : hasReview ? (
            <StatusPill tone="warn">
              {conflictEntries.length} {conflictEntries.length === 1 ? 'decision' : 'decisions'}{' '}
              needed
            </StatusPill>
          ) : missingCloudCopy ? (
            <StatusPill tone="warn">Not in iCloud</StatusPill>
          ) : conflict ? (
            <StatusPill tone="warn">Choose a version</StatusPill>
          ) : queued ? (
            <StatusPill tone="info">Waiting for iCloud</StatusPill>
          ) : (
            <StatusPill tone={linked ? 'good' : 'neutral'}>
              {linked ? 'In iCloud' : 'On this Mac'}
            </StatusPill>
          )}
        </span>
        <small>
          {missingCloudCopy
            ? 'No iCloud version was found. Your Mac workbook is safe and can be added again.'
            : conflict && !hasReview
              ? 'This Mac and iCloud have different versions. Choose which version to keep.'
              : sharedReview || hasReview
                ? 'Review the changed items, then apply your choices.'
                : queued
                  ? 'Saved on this Mac · waiting for iCloud'
                  : linked
                    ? cloudUpdatedAt
                      ? `Local copy is safe · iCloud copy updated ${cloudUpdatedAt}`
                      : 'A separate iCloud copy is available on your Apple devices.'
                    : 'Saved on this Mac only. Add a separate copy to your iCloud library.'}
        </small>
      </div>
      {conflict || sharedReview ? (
        <div className="settings-cloud-current-actions">
          {hasReview ? (
            <button
              aria-expanded={reviewOpen}
              className="btn settings-cloud-current-action"
              onClick={() => {
                setReviewNoticeId(reviewOpen ? null : conflictNoticeId);
                if (!reviewOpen) {
                  setActiveConflictState({ noticeId: conflictNoticeId, path: activeConflictPath });
                }
              }}
              type="button"
            >
              <Icon name="difference" />
              {reviewOpen ? 'Hide Changes' : 'Review Changes'}
            </button>
          ) : null}
          {simpleConfirmationCopy ? (
            <div
              className="settings-cloud-confirmation"
              role="group"
              aria-label="Confirm iCloud action"
            >
              <span className="settings-cloud-removal-warning">
                {simpleConfirmationCopy.message}
              </span>
              <button
                className={`btn ${simpleConfirmationCopy.tone === 'danger' ? 'btn-danger' : 'btn-primary'} settings-cloud-current-action`}
                disabled={pending}
                onClick={() => {
                  if (simpleConfirmation === 'icloud') {
                    void runSimpleAction('open-cloud-workbook', {
                      workbookId: currentWorkbookId
                    });
                  } else if (simpleConfirmation === 'mac') {
                    void runSimpleAction('keep-local-cloud-workbook');
                  } else if (simpleConfirmation === 'delete') {
                    void runSimpleAction('delete-cloud-workbook', {
                      workbookId: currentWorkbookId
                    });
                  }
                }}
                type="button"
              >
                <Icon name={simpleConfirmationCopy.icon} />
                {pending ? simpleConfirmationCopy.pendingLabel : simpleConfirmationCopy.label}
              </button>
              <button
                className="btn"
                disabled={pending}
                onClick={() => setSimpleConfirmation('')}
                type="button"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              {conflict && !hasReview && !conflictReviewNeedsRefresh && cloudCopyAvailable ? (
                <button
                  aria-label={`Use iCloud version of ${workbookName}`}
                  className="btn settings-cloud-current-action"
                  disabled={pending}
                  onClick={() => setSimpleConfirmation('icloud')}
                  type="button"
                >
                  <Icon name="download" />
                  Use iCloud Version
                </button>
              ) : null}
              {conflict && !canReconcile && !conflictReviewNeedsRefresh ? (
                <button
                  className="btn btn-primary settings-cloud-current-action"
                  disabled={pending}
                  onClick={() => setSimpleConfirmation('mac')}
                  type="button"
                >
                  <Icon name="cloud_upload" />
                  {cloudCopyAvailable ? 'Use Mac Version' : 'Add Mac Version to iCloud'}
                </button>
              ) : null}
              {cloudCopyAvailable ? (
                <button
                  aria-label={
                    queuedCreate
                      ? `Cancel upload of ${workbookName}`
                      : `Delete ${workbookName} from iCloud`
                  }
                  className="btn settings-cloud-remove settings-cloud-current-action"
                  disabled={pending}
                  onClick={() => setSimpleConfirmation('delete')}
                  type="button"
                >
                  <Icon name="delete_outline" />
                  {queuedCreate ? 'Cancel Upload' : 'Delete from iCloud'}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="settings-cloud-current-actions">
          {simpleConfirmationCopy ? (
            <div
              className="settings-cloud-confirmation"
              role="group"
              aria-label="Confirm iCloud action"
            >
              <span className="settings-cloud-removal-warning">
                {simpleConfirmationCopy.message}
              </span>
              <button
                className="btn btn-danger settings-cloud-current-action"
                disabled={pending}
                onClick={() =>
                  void runSimpleAction('delete-cloud-workbook', {
                    workbookId: currentWorkbookId
                  })
                }
                type="button"
              >
                <Icon name="delete_forever" />
                {pending ? simpleConfirmationCopy.pendingLabel : simpleConfirmationCopy.label}
              </button>
              <button
                className="btn"
                disabled={pending}
                onClick={() => setSimpleConfirmation('')}
                type="button"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                className="btn btn-primary settings-cloud-current-action"
                disabled={pending}
                type="button"
                {...actions.action('upload-current-workbook')}
              >
                <Icon name={linked ? 'sync' : 'cloud_upload'} />
                {pendingOperation === 'upload'
                  ? 'Syncing…'
                  : linked
                    ? 'Sync Changes'
                    : 'Add to iCloud'}
              </button>
              {cloudCopyAvailable ? (
                <button
                  aria-label={
                    queuedCreate
                      ? `Cancel upload of ${workbookName}`
                      : `Delete ${workbookName} from iCloud`
                  }
                  className="btn settings-cloud-remove settings-cloud-current-action"
                  disabled={pending}
                  onClick={() => setSimpleConfirmation('delete')}
                  type="button"
                >
                  <Icon name="delete_outline" />
                  {queuedCreate ? 'Cancel Upload' : 'Delete from iCloud'}
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
      {conflictReviewNeedsRefresh ? (
        <div className="settings-inline-message settings-cloud-conflict-refresh" role="status">
          <Icon name="sync" />
          Cavalry is refreshing this review so it shows only real workbook changes.
        </div>
      ) : null}
      {reviewOpen && hasReview ? (
        <>
          <ConflictReview
            activePath={activeConflictPath}
            canResolve={canReconcile}
            choices={conflictChoices}
            notice={conflictNotice}
            onChoose={(path, side) => {
              setConfirmingReconcileNoticeId(null);
              setConflictChoiceState((current) => ({
                noticeId: conflictNoticeId,
                values: {
                  ...(current.noticeId === conflictNoticeId ? current.values : {}),
                  [path]: side
                }
              }));
            }}
            onReviewEntry={(path) => {
              setConfirmingReconcileNoticeId(null);
              setActiveConflictState({ noticeId: conflictNoticeId, path });
            }}
          />
          {canReconcile ? (
            <div className="settings-cloud-conflict-apply">
              <strong>
                {selectedConflictCount} of {conflictEntries.length}{' '}
                {conflictEntries.length === 1 ? 'decision' : 'decisions'} made
              </strong>
              {confirmingReconcile ? (
                <div className="settings-cloud-conflict-confirm">
                  <span>Combine these choices and sync the result?</span>
                  <button
                    className="btn btn-primary"
                    disabled={pending}
                    onClick={async () => {
                      const result = await actions.dispatch('reconcile-cloud-workbook', {
                        conflictNoticeId,
                        choices: conflictEntries.map((rawEntry) => {
                          const entry = asObject(rawEntry);
                          const path = asString(entry.path);
                          return { path, side: conflictChoices[path] };
                        })
                      });
                      if (result && result.ok) {
                        setConfirmingReconcileNoticeId(null);
                        setReviewNoticeId(null);
                        setConflictChoiceState({ noticeId: '', values: {} });
                      }
                    }}
                    type="button"
                  >
                    <Icon name="merge" />
                    {pendingOperation === 'reconcile' ? 'Applying…' : 'Confirm Resolution'}
                  </button>
                  <button
                    className="btn"
                    disabled={pending}
                    onClick={() => setConfirmingReconcileNoticeId(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="settings-cloud-conflict-footer-actions">
                  <button
                    className="btn"
                    disabled={pending}
                    onClick={() => setReviewNoticeId(null)}
                    type="button"
                  >
                    Review Later
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={pending || selectedConflictCount !== conflictEntries.length}
                    onClick={() => setConfirmingReconcileNoticeId(conflictNoticeId)}
                    type="button"
                  >
                    <Icon name="merge" />
                    Apply Resolution
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ICloudWorkspace({ cloud, signedIn, workbook }) {
  const workbooks = asArray(cloud.workbooks);
  const counts = cloudLibraryCounts(workbooks);
  const checking = cloud.status === 'initializing';
  const connected = cloud.status === 'signed_in';
  const needsAttention = connected && !!asString(cloud.error);
  const headerLabel = checking
    ? 'Checking'
    : needsAttention
      ? 'Sync needs attention'
      : connected
        ? cloudLibraryCountLabel(counts)
        : cloud.status === 'unavailable'
          ? 'Unavailable'
          : 'Sign in needed';

  return (
    <SettingsCard
      className="settings-cloud-workspace"
      headingId="settings-account-cloud-heading"
      icon="cloud_sync"
      title="iCloud"
      trailing={
        <StatusPill
          icon={
            checking
              ? 'progress_activity'
              : needsAttention
                ? 'sync_problem'
                : connected
                  ? counts.queued
                    ? 'cloud_upload'
                    : 'cloud_done'
                  : 'cloud_off'
          }
          tone={connected && !needsAttention ? (counts.queued ? 'info' : 'good') : 'warn'}
        >
          {headerLabel}
        </StatusPill>
      }
    >
      <ICloudIdentity cloud={cloud} />
      <CloudSyncError cloud={cloud} scope="global" workbook={workbook} />
      {signedIn ? (
        <CloudLibrarySurface
          cloud={cloud}
          currentWorkbookAction={<CurrentWorkbookCloudAction cloud={cloud} workbook={workbook} />}
          currentWorkbookError={
            <CloudSyncError cloud={cloud} scope="current" workbook={workbook} />
          }
          libraryError={<CloudSyncError cloud={cloud} scope="library" workbook={workbook} />}
        />
      ) : null}
    </SettingsCard>
  );
}

export function CloudAccountPanel({ cloud: rawCloud, feedback, workbook = {} }) {
  const cloud = asObject(rawCloud);
  const signedIn = cloud.status === 'signed_in' && !!asString(asObject(cloud.user).id);
  const cloudFeedback = {
    notice: asString(cloud.notice)
  };

  return (
    <div className="settings-content-stack">
      <SettingsFeedback feedback={feedback} />
      <SettingsFeedback feedback={cloudFeedback} />
      <LocalProfile />
      <ICloudWorkspace cloud={cloud} signedIn={signedIn} workbook={workbook} />
    </div>
  );
}
