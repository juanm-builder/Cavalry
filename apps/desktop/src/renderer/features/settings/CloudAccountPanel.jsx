import React, { useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

import { useActionBindings } from '../../shared/action-binding.jsx';
import { AppleOAuthButton } from '../../shared/AppleOAuthButton.jsx';
import { readAccountProfile, writeAccountProfile } from './account-preferences.js';

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

function EmptyState({ detail, icon = 'cloud', title }) {
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

function normalizeCloudWorkbook(value, currentWorkbookId) {
  const source = asObject(value);
  const id = asString(source.id || source.workbookId || source.workbook_id);
  return {
    id,
    name: asString(source.name || source.title) || 'Untitled workbook',
    year: asString(source.year),
    currency: asString(source.currency).toUpperCase(),
    updatedAt: formatCloudTimestamp(
      source.updatedAt || source.updated_at || source.lastSyncedAt || source.last_synced_at
    ),
    isCurrent: source.isCurrent === true || (!!id && id === currentWorkbookId)
  };
}

function LocalProfileFallback({ cloud }) {
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
    <>
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

      <SettingsCard
        headingId="settings-account-sync-heading"
        icon="cloud_off"
        title="Cavalry Cloud"
        trailing={
          <StatusPill icon="cloud_off" tone="warn">
            Unavailable
          </StatusPill>
        }
      >
        <div className="settings-inline-message" role={cloud.error ? 'alert' : 'note'}>
          <Icon name={cloud.error ? 'error' : 'info'} />
          {cloud.error ||
            'Cloud sign-in is not configured in this build. Your profile and workbook remain on this Mac.'}
        </div>
      </SettingsCard>
    </>
  );
}

function SignedOutCloud({ cloud }) {
  const actions = useActionBindings();
  const unavailable = cloud.status === 'unavailable';
  const connecting = cloud.status === 'signing_in';
  const pending = !!asString(cloud.pendingOperation) || cloud.status === 'initializing';
  const busy = pending || connecting;
  const openingApple = asString(cloud.pendingOperation) === 'sign-in-apple';

  return (
    <SettingsCard
      className="settings-cloud-welcome-card"
      headingId="settings-account-cloud-heading"
      icon="cloud"
      title="Cavalry Cloud"
      trailing={
        <StatusPill
          icon={busy ? 'progress_activity' : unavailable ? 'cloud_off' : 'logout'}
          tone="info"
        >
          {busy ? 'Connecting' : unavailable ? 'Unavailable' : 'Signed out'}
        </StatusPill>
      }
    >
      <div className="settings-cloud-welcome">
        <span className="settings-cloud-welcome-icon" aria-hidden="true">
          <Icon name="cloud_sync" />
        </span>
        <div className="settings-cloud-welcome-copy">
          <strong>Your workbooks, available across your devices</strong>
          <p>
            Sign in with Apple or Google to add selected Cavalry workbooks to your private cloud
            library. Nothing is uploaded until you choose Add to Cloud.
          </p>
          <p>
            Already have a Google-backed Cloud library? Continue with Google first, then connect
            Apple from this Account section to keep one owner.
          </p>
        </div>
        <div className="settings-cloud-provider-actions">
          <AppleOAuthButton
            className="settings-apple-sign-in"
            disabled={busy || unavailable}
            pending={openingApple}
            {...actions.action('sign-in-with-apple')}
          />
          <button
            className="btn btn-primary settings-google-sign-in"
            disabled={busy || unavailable}
            type="button"
            {...actions.action('sign-in-with-google')}
          >
            <span aria-hidden="true" className="settings-google-mark">
              G
            </span>
            {!openingApple && pending ? 'Opening Google…' : 'Continue with Google'}
          </button>
        </div>
      </div>
      <div className="settings-inline-message" role="note">
        <Icon name="shield_lock" />
        Cavalry opens provider sign-in in your browser. macOS Keychain protects your session and may
        ask you to approve access; Cavalry never receives your Mac password. Your local workbook
        stays on this Mac until you explicitly add it to Cloud.
      </div>
    </SettingsCard>
  );
}

function CloudIdentity({ cloud }) {
  const actions = useActionBindings();
  const user = asObject(cloud.user);
  const name = asString(user.name || user.displayName || user.fullName) || 'Cavalry user';
  const email = asString(user.email);
  const avatarUrl = asString(user.avatarUrl || user.avatar_url || user.picture);
  const linkedProviders = new Set([
    asString(user.provider).toLowerCase(),
    ...asArray(user.providers).map((provider) => asString(provider).toLowerCase())
  ]);
  const appleLinked = linkedProviders.has('apple');
  const connectedProviderLabel = Array.from(linkedProviders)
    .filter(Boolean)
    .map((provider) =>
      provider === 'apple' ? 'Apple' : provider === 'google' ? 'Google' : provider
    )
    .join(' and ');
  const pendingOperation = asString(cloud.pendingOperation);
  const pending = !!pendingOperation;
  const updatingProfile = pendingOperation === 'profile-update';
  const linkingApple = pendingOperation === 'link-apple';

  return (
    <SettingsCard
      headingId="settings-account-profile-heading"
      icon="account_circle"
      title="Profile"
      trailing={
        <StatusPill icon="verified_user" tone="good">
          Signed in to Cavalry Cloud
        </StatusPill>
      }
    >
      <div className="settings-cloud-identity">
        <span className="settings-cloud-avatar">
          {avatarUrl ? (
            <img alt="" referrerPolicy="no-referrer" src={avatarUrl} />
          ) : (
            <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <form
          className="settings-cloud-identity-copy settings-cloud-profile-form"
          id="settings-cloud-profile-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <label htmlFor="settings-cloud-profile-name">Name</label>
          <input
            aria-describedby="settings-cloud-profile-email"
            defaultValue={name}
            disabled={pending}
            id="settings-cloud-profile-name"
            key={`${user.id || email}-${name}`}
            maxLength={80}
            name="name"
            required
            type="text"
          />
          <small id="settings-cloud-profile-email">
            {email || name}
            {connectedProviderLabel ? ` · Connected: ${connectedProviderLabel}` : ''}
          </small>
        </form>
        <div className="settings-cloud-identity-actions">
          {!appleLinked ? (
            <AppleOAuthButton
              className="settings-apple-sign-in"
              disabled={pending}
              pending={linkingApple}
              {...actions.action('link-apple-cloud')}
            />
          ) : null}
          <button
            className="btn btn-primary"
            disabled={pending}
            form="settings-cloud-profile-form"
            type="submit"
            {...actions.action('update-cloud-profile', {}, { includeForm: true })}
          >
            <Icon name="save" />
            {updatingProfile ? 'Saving…' : 'Save Name'}
          </button>
          <button
            className="btn"
            disabled={pending}
            type="button"
            {...actions.action('refresh-cloud-workbooks')}
          >
            <Icon name="refresh" />
            Refresh
          </button>
          <button
            className="btn"
            disabled={pending}
            type="button"
            {...actions.action('sign-out-cloud')}
          >
            <Icon name="logout" />
            Sign Out
          </button>
        </div>
      </div>
      {!appleLinked ? (
        <div className="settings-inline-message" role="note">
          <Icon name="link" />
          Connect Apple while you are signed in to keep one Cloud library even if you choose Hide My
          Email. Manual identity linking must be enabled in the Cavalry Supabase project.
        </div>
      ) : null}
    </SettingsCard>
  );
}

function CurrentWorkbookCloudAction({ cloud, workbook }) {
  const actions = useActionBindings();
  const current = asObject(cloud.current);
  const pendingOperation = asString(cloud.pendingOperation);
  const linked = current.linked === true || current.isLinked === true;
  const conflict = current.conflict === true || asString(current.status) === 'conflict';
  const pending = !!pendingOperation;
  const workbookName =
    asString(current.name || current.workbookName || workbook.name) || 'Current workbook';
  const status = asString(current.status);
  const lastSyncedAt = formatCloudTimestamp(current.lastSyncedAt || current.last_synced_at);

  return (
    <div className="settings-cloud-current">
      <span className={'settings-cloud-current-icon' + (linked ? ' is-linked' : '')}>
        <Icon name={linked ? 'cloud_done' : 'cloud_upload'} />
      </span>
      <div className="settings-cloud-current-copy">
        <strong>{workbookName}</strong>
        <small>
          {conflict
            ? 'The Cloud copy changed. Save this local workbook, then review the Cloud copy below.'
            : linked
              ? lastSyncedAt
                ? `Last synced ${lastSyncedAt}`
                : ['syncing', 'uploading'].includes(status)
                  ? 'Syncing changes…'
                  : 'This workbook is in Cavalry Cloud.'
              : 'This workbook is currently stored only on this Mac.'}
        </small>
      </div>
      <button
        className="btn btn-primary settings-cloud-current-action"
        disabled={pending || conflict}
        type="button"
        {...actions.action('upload-current-workbook')}
      >
        <Icon name={conflict ? 'sync_problem' : linked ? 'sync' : 'add_to_drive'} />
        {conflict
          ? 'Cloud copy changed'
          : ['upload', 'upload-workbook', 'sync-workbook'].includes(pendingOperation)
            ? linked
              ? 'Syncing…'
              : 'Adding…'
            : linked
              ? 'Sync Now'
              : 'Add to Cloud'}
      </button>
    </div>
  );
}

function CloudWorkbookRow({
  confirmingRemoval,
  currentWorkbookConflict,
  currentWorkbookId,
  onCancelRemoval,
  onRequestRemoval,
  pending,
  workbook
}) {
  const actions = useActionBindings();
  const item = normalizeCloudWorkbook(workbook, currentWorkbookId);
  const resolvingCurrentConflict = item.isCurrent && currentWorkbookConflict;
  const metadata = [item.year, item.currency, item.updatedAt ? `Updated ${item.updatedAt}` : '']
    .filter(Boolean)
    .join(' • ');

  return (
    <li className="settings-cloud-workbook-row">
      <span className="settings-cloud-workbook-icon">
        <Icon name="table_view" />
      </span>
      <div className="settings-cloud-workbook-copy">
        <div className="settings-cloud-workbook-title">
          <strong>{item.name}</strong>
          {item.isCurrent ? (
            <StatusPill tone={resolvingCurrentConflict ? 'info' : 'good'}>
              {resolvingCurrentConflict ? 'Cloud changed' : 'Current'}
            </StatusPill>
          ) : null}
        </div>
        <small>{metadata || 'Cloud workbook'}</small>
      </div>
      <div className="settings-cloud-workbook-actions">
        <button
          aria-label={`${resolvingCurrentConflict ? 'Review' : 'Open'} ${item.name} from Cavalry Cloud`}
          className="btn"
          disabled={pending || !item.id || (item.isCurrent && !resolvingCurrentConflict)}
          type="button"
          {...actions.action('open-cloud-workbook', { workbookId: item.id })}
        >
          <Icon name="open_in_new" />
          {resolvingCurrentConflict ? 'Review' : 'Open'}
        </button>
        {confirmingRemoval ? (
          <>
            <span className="settings-cloud-removal-warning">
              Permanently deletes every Cloud version.
            </span>
            <button
              aria-label={`Confirm removal of ${item.name} from Cavalry Cloud`}
              className="btn btn-danger settings-cloud-remove"
              disabled={pending || !item.id}
              type="button"
              {...actions.action('delete-cloud-workbook', { workbookId: item.id })}
            >
              <Icon name="delete_forever" />
              Confirm
            </button>
            <button className="btn" disabled={pending} onClick={onCancelRemoval} type="button">
              Cancel
            </button>
          </>
        ) : (
          <button
            aria-label={`Remove ${item.name} from Cavalry Cloud`}
            className="btn settings-cloud-remove"
            disabled={pending || !item.id}
            onClick={() => onRequestRemoval(item.id)}
            type="button"
          >
            <Icon name="delete_outline" />
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

function SignedInCloud({ cloud, workbook }) {
  const [removalId, setRemovalId] = useState('');
  const current = asObject(cloud.current);
  const workbooks = asArray(cloud.workbooks);
  const currentWorkbookId = asString(
    current.workbookId || current.workbook_id || cloud.currentWorkbookId
  );
  const pending = !!asString(cloud.pendingOperation);

  return (
    <>
      <CloudIdentity cloud={cloud} />
      <SettingsCard
        headingId="settings-account-sync-heading"
        icon="cloud_done"
        title="Cloud workbooks"
        trailing={
          <StatusPill icon="cloud_done" tone="good">
            {workbooks.length} {workbooks.length === 1 ? 'workbook' : 'workbooks'}
          </StatusPill>
        }
      >
        <CurrentWorkbookCloudAction cloud={cloud} workbook={workbook} />
        {workbooks.length ? (
          <ul aria-label="Cavalry Cloud workbooks" className="settings-cloud-workbook-list">
            {workbooks.map((item, index) => (
              <CloudWorkbookRow
                confirmingRemoval={removalId === asString(item?.id || item?.workbookId)}
                currentWorkbookConflict={current.conflict === true}
                currentWorkbookId={currentWorkbookId}
                key={asString(item?.id || item?.workbookId) || `cloud-workbook-${index}`}
                onCancelRemoval={() => setRemovalId('')}
                onRequestRemoval={setRemovalId}
                pending={pending}
                workbook={item}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            detail="Add the current workbook above, or refresh after uploading from another device."
            icon="cloud_queue"
            title="No cloud workbooks yet"
          />
        )}
      </SettingsCard>
    </>
  );
}

export function CloudAccountPanel({ cloud: rawCloud, feedback, workbook = {} }) {
  const cloud = asObject(rawCloud);
  const configured = cloud.configured === true;
  const user = asObject(cloud.user);
  const signedIn =
    configured &&
    (cloud.status === 'signed_in' || cloud.status === 'authenticated' || !!asString(user.id));
  const cloudFeedback = {
    error: configured ? asString(cloud.error) : '',
    notice: configured ? asString(cloud.notice) : ''
  };

  return (
    <div className="settings-content-stack">
      <SettingsFeedback feedback={feedback} />
      <SettingsFeedback feedback={cloudFeedback} />
      {!configured ? <LocalProfileFallback cloud={cloud} /> : null}
      {configured && !signedIn ? <SignedOutCloud cloud={cloud} /> : null}
      {signedIn ? <SignedInCloud cloud={cloud} workbook={workbook} /> : null}
    </div>
  );
}
