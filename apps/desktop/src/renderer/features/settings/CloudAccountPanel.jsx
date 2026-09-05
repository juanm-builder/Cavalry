import React, { useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { useActionBindings } from '../../shared/action-binding.jsx';
import { readAccountProfile, writeAccountProfile } from './account-preferences.js';
import { CloudLibrarySurface, cloudLibraryCounts } from './CloudLibrarySurface.jsx';

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
    <span className={`settings-status-pill ${tone}`}>
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
          <h3 id={headingId}>{title}</h3>
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
  let storage = null;
  try {
    storage = typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_error) {
    // A blocked storage getter must not prevent the account settings from opening.
  }
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
      title="Local profile"
      trailing={
        <StatusPill icon="lock" tone="good">
          Stored on this Mac
        </StatusPill>
      }
    >
      <p>
        This profile is stored on this Mac. Your iCloud Apple Account is managed in System Settings.
      </p>
      <form className="settings-account-form" id="account-profile-form" onSubmit={saveProfile}>
        <div className="field">
          <label htmlFor="settings-account-name">Name</label>
          <input
            defaultValue={profile.name}
            id="settings-account-name"
            key={`name-${profile.name}`}
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
            key={`email-${profile.email}`}
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

function ICloudConnection({ cloud }) {
  const actions = useActionBindings();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const signedIn = cloud.status === 'signed_in';
  const disconnected = cloud.status === 'disconnected';
  const accountReference = asString(asObject(cloud.user).id)
    .replace(/^_/, '')
    .slice(-12)
    .toUpperCase();
  const checking = cloud.status === 'initializing';
  const pending = !!asString(cloud.pendingOperation);
  const icon = checking ? 'progress_activity' : signedIn ? 'cloud_done' : 'cloud_off';
  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(accountReference);
      setCopyNotice('Account reference copied.');
    } catch (_error) {
      setCopyNotice('Couldn’t copy. Select the reference to copy it.');
    }
  };

  return (
    <div className="settings-cloud-account">
      <div className="settings-cloud-account-identity">
        <span className="settings-cloud-account-avatar" aria-hidden="true">
          <Icon name={icon} />
        </span>
        <div className="settings-cloud-account-copy">
          <span className="settings-cloud-account-label">Apple Account</span>
          <strong>
            {checking
              ? 'Checking iCloud'
              : signedIn
                ? 'iCloud account'
                : disconnected
                  ? 'iCloud disconnected'
                  : 'iCloud unavailable'}
          </strong>
          <p>
            {signedIn
              ? 'Private iCloud library'
              : disconnected
                ? 'Local workbooks are available. Connect again to resume syncing.'
                : 'Check iCloud in System Settings.'}
          </p>
        </div>
      </div>
      <div className="settings-cloud-account-actions">
        <button
          className="btn"
          disabled={pending || checking}
          type="button"
          {...actions.action(disconnected ? 'connect-icloud' : 'refresh-cloud-workbooks')}
        >
          <Icon name="refresh" />
          {disconnected
            ? 'Connect iCloud'
            : asString(cloud.pendingOperation) === 'refresh'
              ? 'Checking…'
              : 'Check Now'}
        </button>
        {!disconnected ? (
          confirmDisconnect ? (
            <>
              <button
                className="btn"
                disabled={pending || checking}
                type="button"
                {...actions.action('disconnect-icloud')}
              >
                Confirm Disconnect
              </button>
              <button
                className="btn"
                disabled={pending}
                onClick={() => setConfirmDisconnect(false)}
                type="button"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn"
              disabled={pending || checking}
              onClick={() => setConfirmDisconnect(true)}
              type="button"
            >
              Disconnect iCloud
            </button>
          )
        ) : null}
      </div>
      {signedIn && accountReference ? (
        <div className="settings-cloud-account-reference">
          <span>Account reference</span>
          <div className="settings-cloud-account-reference-value">
            <strong>{accountReference}</strong>
            <button
              aria-label="Copy account reference"
              className="btn btn-icon"
              onClick={copyReference}
              type="button"
            >
              <Icon name="content_copy" />
            </button>
          </div>
          {copyNotice ? (
            <span className="settings-cloud-account-notice" role="status">
              {copyNotice}
            </span>
          ) : null}
        </div>
      ) : null}
      {confirmDisconnect && !disconnected ? (
        <p className="settings-cloud-account-notice" role="status">
          Disconnect iCloud on this Mac? Local workbooks and existing iCloud copies stay available.
          An upload already received by iCloud may still finish. Your Mac stays signed into its
          Apple Account.
        </p>
      ) : null}
    </div>
  );
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
    retryScope === 'sync-state'
      ? 'retry-cloud-sync-state'
      : appliesToCurrentWorkbook && retryScope === 'upload'
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
    retryScope === 'sync-state'
      ? 'Retry'
      : appliesToCurrentWorkbook && retryScope === 'upload'
        ? 'Retry Sync'
        : appliesToCurrentWorkbook && retryScope === 'keep-local'
          ? 'Retry'
          : retryScope === 'delete'
            ? 'Retry Delete'
            : retryScope === 'open'
              ? 'Retry Open'
              : 'Check Again';
  const details = asString(cloud.errorDetails);
  const errorCode = asString(cloud.errorCode);
  const pending = !!asString(cloud.pendingOperation);
  const workbookName = asString(workbook.name) || 'This workbook';

  return (
    <div className="settings-cloud-error">
      <span className="settings-cloud-error-icon" aria-hidden="true">
        <Icon name="error" />
      </span>
      <div className="settings-cloud-error-copy" role="alert">
        <strong>{error}</strong>
        <p>
          {appliesToCurrentWorkbook
            ? `${workbookName} is still saved on this Mac.`
            : 'Your local files are unchanged.'}
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

function CurrentWorkbookCard({ cloud, workbook }) {
  const actions = useActionBindings();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const current = asObject(cloud.current);
  const currentWorkbookId = asString(current.workbookId || workbook.id);
  const workbookName = asString(workbook.name) || 'Current workbook';
  const linked = current.linked === true;
  const conflictNotice = asObject(current.conflictNotice);
  const legacyConflict =
    current.conflict === true ||
    asString(current.status) === 'conflict' ||
    !!asString(conflictNotice.id);
  const currentStatus = asString(current.status);
  const uploading = currentStatus === 'uploading';
  const queued = ['pending', 'waiting'].includes(currentStatus);
  const retrying = currentStatus === 'retrying';
  const remoteDeleted = current.remoteDeleted === true;
  const syncBlocked = current.syncBlocked === true || asString(current.status) === 'attention';
  const autoSyncEnabled = current.autoSyncEnabled !== false;
  const pendingOperation = asString(cloud.pendingOperation);
  const pending = !!pendingOperation;
  const cloudUpdatedAt = formatCloudTimestamp(current.cloudUpdatedAt);
  const currentCloudItem = asArray(cloud.workbooks).find(
    (item) => asString(item?.id || item?.workbookId) === currentWorkbookId
  );
  const cloudCopyAvailable = !!currentCloudItem;

  const status = remoteDeleted
    ? { label: 'Removed from iCloud', tone: 'warn', icon: 'cloud_off' }
    : legacyConflict || syncBlocked
      ? { label: 'Needs attention', tone: 'warn', icon: 'sync_problem' }
      : retrying
        ? { label: 'Retrying', tone: 'info', icon: 'sync' }
        : uploading
          ? { label: 'Syncing', tone: 'info', icon: 'cloud_upload' }
          : queued
            ? { label: 'Waiting', tone: 'info', icon: 'cloud_upload' }
            : linked && autoSyncEnabled
              ? { label: 'Synced', tone: 'good', icon: 'cloud_done' }
              : linked
                ? { label: 'iCloud paused', tone: 'neutral', icon: 'pause_circle' }
                : { label: 'On this Mac', tone: 'neutral', icon: 'computer' };
  const detail = remoteDeleted
    ? 'Mac copy is safe'
    : legacyConflict
      ? 'Previous sync needs recovery.'
      : syncBlocked
        ? 'Sync needs attention'
        : retrying
          ? 'Waiting for iCloud'
          : uploading
            ? 'Saving to iCloud'
            : queued
              ? 'Waiting for iCloud'
              : linked && cloudUpdatedAt
                ? `Updated ${cloudUpdatedAt}`
                : linked
                  ? 'Available on your Apple devices'
                  : 'Not in iCloud';

  const runConfirmedAction = async () => {
    const result =
      confirmation === 'delete'
        ? await actions.dispatch('delete-cloud-workbook', { workbookId: currentWorkbookId })
        : confirmation === 'icloud'
          ? await actions.dispatch('open-cloud-workbook', { workbookId: currentWorkbookId })
          : confirmation === 'mac'
            ? await actions.dispatch('keep-local-cloud-workbook')
            : null;
    if (result && result.ok) setConfirmation('');
  };

  return (
    <section
      aria-label="Current workbook"
      className={`settings-cloud-current${legacyConflict ? ' has-conflict' : ''}`}
    >
      <span
        className={`settings-cloud-current-icon${linked && !legacyConflict ? ' is-linked' : ''}`}
        aria-hidden="true"
      >
        <Icon name={status.icon} />
      </span>
      <div className="settings-cloud-current-copy">
        <span className="settings-cloud-current-title">
          <strong>{workbookName}</strong>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </span>
        <small>{detail}</small>
      </div>
      <div className="settings-cloud-current-actions">
        <button
          className="btn settings-cloud-current-action"
          type="button"
          {...actions.action('choose-autosave-file')}
        >
          <Icon name="download" />
          Save Local Copy
        </button>
        {legacyConflict ? (
          <button
            aria-expanded={detailsOpen}
            className="btn btn-primary settings-cloud-current-action"
            onClick={() => setDetailsOpen((open) => !open)}
            type="button"
          >
            <Icon name="info" />
            {detailsOpen ? 'Hide Details' : 'View Details'}
          </button>
        ) : (
          <button
            className="btn btn-primary settings-cloud-current-action"
            disabled={pending}
            type="button"
            {...actions.action('upload-current-workbook')}
          >
            <Icon name={linked ? 'sync' : 'cloud_upload'} />
            {pendingOperation === 'upload' ? 'Syncing…' : linked ? 'Sync Now' : 'Add to iCloud'}
          </button>
        )}
        {linked && !legacyConflict ? (
          <button
            aria-label={`Remove ${workbookName} from iCloud`}
            className="btn settings-cloud-remove"
            disabled={pending}
            onClick={() => setConfirmation('delete')}
            type="button"
          >
            <Icon name="delete_outline" />
            Remove
          </button>
        ) : null}
      </div>

      <div className="settings-cloud-autosave">
        <div>
          <strong>Autosave with iCloud</strong>
          <small>
            {remoteDeleted
              ? 'Add to iCloud to resume'
              : syncBlocked
                ? 'Sync needs attention'
                : autoSyncEnabled
                  ? 'Changes sync automatically'
                  : 'Manual sync only'}
          </small>
        </div>
        <label className="settings-cloud-switch">
          <span className="sr-only">Autosave with iCloud</span>
          <input
            aria-label="Autosave with iCloud"
            checked={autoSyncEnabled}
            disabled={pending || remoteDeleted}
            type="checkbox"
            {...actions.change('set-cloud-autosave')}
          />
          <span aria-hidden="true" />
        </label>
      </div>

      {detailsOpen && legacyConflict ? (
        <div className="settings-cloud-legacy-recovery" role="note">
          <div>
            <strong>Legacy sync recovery</strong>
            <small>
              {asString(conflictNotice.summary) ||
                'Choose the copy to keep. Your Mac file stays safe.'}
            </small>
          </div>
          <div>
            {cloudCopyAvailable ? (
              <button
                className="btn"
                disabled={pending}
                onClick={() => setConfirmation('icloud')}
                type="button"
              >
                <Icon name="download" />
                Use iCloud Copy
              </button>
            ) : null}
            <button
              className="btn btn-primary"
              disabled={pending}
              onClick={() => setConfirmation('mac')}
              type="button"
            >
              <Icon name="cloud_upload" />
              {cloudCopyAvailable ? 'Use Mac Copy' : 'Add Mac Copy'}
            </button>
          </div>
        </div>
      ) : null}

      {confirmation ? (
        <div
          className="settings-cloud-confirmation"
          role="group"
          aria-label="Confirm iCloud action"
        >
          <span>
            {confirmation === 'delete'
              ? 'Remove the iCloud copy? The Mac file stays.'
              : confirmation === 'icloud'
                ? 'Open the iCloud copy? The Mac file stays.'
                : cloudCopyAvailable
                  ? 'Replace the iCloud copy with this Mac copy?'
                  : 'Add this Mac copy to iCloud?'}
          </span>
          <button
            className={`btn ${confirmation === 'delete' ? 'btn-danger' : 'btn-primary'}`}
            disabled={pending}
            onClick={() => void runConfirmedAction()}
            type="button"
          >
            {confirmation === 'delete'
              ? 'Confirm Remove'
              : confirmation === 'icloud'
                ? 'Confirm Use iCloud Copy'
                : cloudCopyAvailable
                  ? 'Confirm Use Mac Copy'
                  : 'Confirm Add to iCloud'}
          </button>
          <button
            className="btn"
            disabled={pending}
            onClick={() => setConfirmation('')}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ICloudWorkspace({ cloud, signedIn, workbook }) {
  const counts = cloudLibraryCounts(cloud.workbooks);
  const checking = cloud.status === 'initializing';
  const connected = cloud.status === 'signed_in';
  const needsAttention = connected && !!asString(cloud.error);
  const headerLabel = checking
    ? 'Checking'
    : needsAttention
      ? 'Needs attention'
      : connected
        ? counts.queued
          ? 'Syncing'
          : 'Connected'
        : cloud.status === 'unavailable'
          ? 'Unavailable'
          : cloud.status === 'disconnected'
            ? 'Disconnected'
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
                  ? 'cloud_done'
                  : 'cloud_off'
          }
          tone={connected && !needsAttention ? (counts.queued ? 'info' : 'good') : 'warn'}
        >
          {headerLabel}
        </StatusPill>
      }
    >
      <ICloudConnection
        cloud={cloud}
        key={`${cloud.status}-${asString(asObject(cloud.user).id)}`}
      />
      <CloudSyncError cloud={cloud} scope="global" workbook={workbook} />
      {signedIn ? (
        <CloudLibrarySurface
          cloud={cloud}
          currentWorkbookAction={<CurrentWorkbookCard cloud={cloud} workbook={workbook} />}
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
  const cloudFeedback = { notice: asString(cloud.notice) };

  return (
    <div className="settings-content-stack">
      <SettingsFeedback feedback={feedback} />
      <SettingsFeedback feedback={cloudFeedback} />
      <LocalProfile />
      <ICloudWorkspace cloud={cloud} signedIn={signedIn} workbook={workbook} />
    </div>
  );
}
