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

function StatusPill({ children, tone = 'neutral' }) {
  return <span className={`settings-status-pill ${tone}`}>{children}</span>;
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

function normalizeCloudWorkbook(value) {
  const source = asObject(value);
  return {
    id: asString(source.id || source.workbookId),
    name: asString(source.name || source.title) || 'Untitled workbook',
    year: asString(source.year),
    currency: asString(source.currency).toUpperCase(),
    updatedAt: formatCloudTimestamp(source.updatedAt),
    pending: source.pending === true,
    inCloud: source.inCloud === true || source.pending !== true
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

function CloudWorkbookRow({
  confirmingRemoval,
  onCancelRemoval,
  onRequestRemoval,
  pending,
  workbook
}) {
  const actions = useActionBindings();
  const item = normalizeCloudWorkbook(workbook);
  const queuedCreate = item.pending && !item.inCloud;
  const metadata = [item.year, item.currency, item.updatedAt].filter(Boolean).join(' • ');

  return (
    <li className="settings-cloud-workbook-row">
      <span className="settings-cloud-workbook-icon" aria-hidden="true">
        <Icon name="table_view" />
      </span>
      <div className="settings-cloud-workbook-copy">
        <div className="settings-cloud-workbook-title">
          <strong>{item.name}</strong>
          {item.pending ? <StatusPill tone="info">Waiting</StatusPill> : null}
        </div>
        {metadata ? <small>{metadata}</small> : null}
      </div>
      <div className="settings-cloud-workbook-actions">
        <button
          aria-label={`Open ${item.name} from iCloud`}
          className="btn"
          disabled={pending || item.pending || !item.id}
          type="button"
          {...actions.action('open-cloud-workbook', { workbookId: item.id })}
        >
          <Icon name="open_in_new" />
          Open
        </button>
        {confirmingRemoval ? (
          <>
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
              {queuedCreate ? 'Cancel Upload' : 'Delete'}
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
            {queuedCreate ? 'Cancel Upload' : 'Delete'}
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
  const currentWorkbookId = asString(current.workbookId || cloud.currentWorkbookId);
  const otherWorkbooks = asArray(cloud.workbooks).filter(
    (item) => asString(item?.id || item?.workbookId) !== currentWorkbookId
  );
  const pending = !!asString(cloud.pendingOperation);

  return (
    <div className="settings-cloud-surfaces">
      <p className="settings-cloud-account-notice">
        iCloud workbooks open inside Cavalry. To keep a file in iCloud Drive, use Save As in Files
        &amp; Data settings.
      </p>
      {currentWorkbookError}
      {currentWorkbookAction}
      {libraryError}
      {otherWorkbooks.length ? (
        <section
          aria-labelledby="settings-other-cloud-workbooks-heading"
          className="settings-cloud-other-workbooks"
        >
          <header>
            <h4 id="settings-other-cloud-workbooks-heading">Other workbooks</h4>
            <StatusPill>{otherWorkbooks.length}</StatusPill>
          </header>
          <ul aria-label="Other iCloud workbooks" className="settings-cloud-workbook-list">
            {otherWorkbooks.map((item, index) => (
              <CloudWorkbookRow
                confirmingRemoval={removalId === asString(item?.id || item?.workbookId)}
                key={asString(item?.id || item?.workbookId) || `icloud-workbook-${index}`}
                onCancelRemoval={() => setRemovalId('')}
                onRequestRemoval={setRemovalId}
                pending={pending}
                workbook={item}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
