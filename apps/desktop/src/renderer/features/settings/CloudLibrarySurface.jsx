import React, { useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { useActionBindings } from '../../shared/action-binding.jsx';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function Icon({ name }) {
  return <CavalryIcon name={name} />;
}

function StatusPill({ children, icon, tone = 'neutral' }) {
  return (
    <span className={'settings-status-pill ' + tone}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
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
  const id = asString(source.id || source.workbookId);
  return {
    id,
    name: asString(source.name || source.title) || 'Untitled workbook',
    year: asString(source.year),
    currency: asString(source.currency).toUpperCase(),
    revision: Number(source.revision) || 0,
    updatedAt: formatCloudTimestamp(source.updatedAt),
    pending: source.pending === true,
    inCloud: source.inCloud === true || source.pending !== true,
    isCurrent: source.isCurrent === true || (!!id && id === currentWorkbookId)
  };
}

export function cloudLibraryCounts(workbooks) {
  const queued = asArray(workbooks).filter((workbook) => workbook?.pending === true).length;
  return {
    confirmed: asArray(workbooks).filter(
      (workbook) => workbook?.inCloud === true || workbook?.pending !== true
    ).length,
    queued
  };
}

export function cloudLibraryCountLabel(counts) {
  const confirmed = `${counts.confirmed} in iCloud`;
  return counts.queued ? `${confirmed} · ${counts.queued} waiting` : confirmed;
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
  const queuedCreate = item.pending && !item.inCloud;
  const metadata = [
    item.year,
    item.currency,
    item.revision ? `Revision ${item.revision}` : '',
    item.updatedAt ? `Updated ${item.updatedAt}` : ''
  ]
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
              {resolvingCurrentConflict ? 'Review changes' : 'Current'}
            </StatusPill>
          ) : null}
          {item.pending ? <StatusPill tone="info">Waiting for iCloud</StatusPill> : null}
        </div>
        <small>{metadata || 'iCloud workbook'}</small>
      </div>
      <div className="settings-cloud-workbook-actions">
        <button
          aria-label={
            item.pending
              ? `${item.name} is waiting for iCloud`
              : `${resolvingCurrentConflict ? 'Review' : 'Open'} ${item.name} from iCloud`
          }
          className="btn"
          disabled={
            pending || item.pending || !item.id || (item.isCurrent && !resolvingCurrentConflict)
          }
          type="button"
          {...actions.action('open-cloud-workbook', { workbookId: item.id })}
        >
          <Icon name="open_in_new" />
          {item.pending ? 'Waiting' : resolvingCurrentConflict ? 'Review' : 'Open'}
        </button>
        {item.isCurrent ? null : confirmingRemoval ? (
          <>
            <span className="settings-cloud-removal-warning">
              {queuedCreate
                ? 'Cancels this queued upload. Any separately saved Mac file is not deleted.'
                : 'Removes this iCloud copy from your Apple devices. Any separately saved Mac file is not deleted.'}
            </span>
            <button
              aria-label={
                queuedCreate
                  ? `Confirm canceling upload of ${item.name}`
                  : `Confirm deletion of ${item.name} from iCloud`
              }
              className="btn btn-danger settings-cloud-remove"
              disabled={pending || !item.id}
              type="button"
              {...actions.action('delete-cloud-workbook', { workbookId: item.id })}
            >
              <Icon name="delete_forever" />
              {queuedCreate ? 'Cancel Upload' : 'Delete from iCloud'}
            </button>
            <button className="btn" disabled={pending} onClick={onCancelRemoval} type="button">
              Cancel
            </button>
          </>
        ) : (
          <button
            aria-label={
              queuedCreate ? `Cancel upload of ${item.name}` : `Delete ${item.name} from iCloud`
            }
            className="btn settings-cloud-remove"
            disabled={pending || !item.id}
            onClick={() => onRequestRemoval(item.id)}
            type="button"
          >
            <Icon name="delete_outline" />
            {queuedCreate ? 'Cancel Upload' : 'Delete from iCloud'}
          </button>
        )}
      </div>
    </li>
  );
}

export function CloudLibrarySurface({
  cloud,
  currentWorkbookAction,
  currentWorkbookError,
  libraryError
}) {
  const [removalId, setRemovalId] = useState('');
  const current = asObject(cloud.current);
  const workbooks = asArray(cloud.workbooks);
  const counts = cloudLibraryCounts(workbooks);
  const currentWorkbookId = asString(current.workbookId || cloud.currentWorkbookId);
  const pending = !!asString(cloud.pendingOperation);

  return (
    <div className="settings-cloud-surfaces">
      <section
        aria-labelledby="settings-current-local-workbook-heading"
        className="settings-cloud-surface"
      >
        <header className="settings-cloud-surface-header">
          <div>
            <span>On this Mac</span>
            <h4 id="settings-current-local-workbook-heading">Current workbook</h4>
            <p>This is the editable copy. Cavalry always saves it locally before iCloud runs.</p>
          </div>
          <StatusPill icon="shield_lock" tone="neutral">
            Local copy safe
          </StatusPill>
        </header>
        {currentWorkbookError}
        {currentWorkbookAction}
      </section>

      <section aria-labelledby="settings-icloud-library-heading" className="settings-cloud-surface">
        <header className="settings-cloud-surface-header">
          <div>
            <span>In iCloud</span>
            <h4 id="settings-icloud-library-heading">Cloud library</h4>
            <p>Only workbooks confirmed or queued in iCloud appear in this list.</p>
          </div>
          <StatusPill
            icon={counts.queued ? 'cloud_upload' : 'cloud_done'}
            tone={counts.queued ? 'info' : counts.confirmed ? 'good' : 'neutral'}
          >
            {cloudLibraryCountLabel(counts)}
          </StatusPill>
        </header>
        {libraryError}
        {workbooks.length ? (
          <ul aria-label="iCloud workbooks" className="settings-cloud-workbook-list">
            {workbooks.map((item, index) => (
              <CloudWorkbookRow
                confirmingRemoval={removalId === asString(item?.id || item?.workbookId)}
                currentWorkbookConflict={current.conflict === true}
                currentWorkbookId={currentWorkbookId}
                key={asString(item?.id || item?.workbookId) || `icloud-workbook-${index}`}
                onCancelRemoval={() => setRemovalId('')}
                onRequestRemoval={setRemovalId}
                pending={pending}
                workbook={item}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            detail="Nothing has been uploaded. Your current workbook remains safely in the On This Mac section above."
            icon="cloud_queue"
            title="Your iCloud library is empty"
          />
        )}
      </section>
    </div>
  );
}
