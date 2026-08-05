import React, { useState } from 'react';

import cavalryMark from '../assets/cavalry-mark.png';
import { AppleOAuthButton } from '../shared/AppleOAuthButton.jsx';
import { formatUiDateTime } from '../shared/date-format.js';

export const WORKBOOK_STARTUP_STATUS = Object.freeze({
  EMPTY: 'empty',
  LOADING: 'loading',
  ERROR: 'error'
});

const CURRENCY_SYMBOLS = Object.freeze({
  PHP: '₱',
  USD: '$'
});

function StartupBrand() {
  return (
    <div className="landing-brand">
      <span className="landing-brand-mark" aria-hidden="true">
        <img alt="" src={cavalryMark} />
      </span>
      <span>
        <strong>Cavalry</strong>
        <small>Private finance workspace</small>
      </span>
    </div>
  );
}

function cloudText(value) {
  return String(value == null ? '' : value).trim();
}

function RecentWorkbookLibrary({ recent: rawRecent, onOpenRecent }) {
  const recent = rawRecent && typeof rawRecent === 'object' ? rawRecent : {};
  const items = Array.isArray(recent.items) ? recent.items.slice(0, 5) : [];
  const openingId = cloudText(recent.openingId);
  const loading = recent.status === 'loading';

  return (
    <section
      aria-busy={loading || !!openingId}
      aria-labelledby="landing-recent-heading"
      className="landing-recent-library"
    >
      <div className="landing-recent-heading">
        <div>
          <small>On this Mac</small>
          <h2 id="landing-recent-heading">Recent workbooks</h2>
        </div>
        {items.length ? <span>{items.length} recent</span> : null}
      </div>
      {recent.error ? (
        <div className="panel-note status-bad" role="alert">
          {cloudText(recent.error)}
        </div>
      ) : null}
      {items.length ? (
        <ul aria-label="Recent workbooks on this Mac" className="landing-recent-workbooks">
          {items.map((item) => {
            const id = cloudText(item && item.id);
            const fileName = cloudText(item && item.fileName) || 'Untitled workbook';
            const folderName = cloudText(item && item.folderName);
            const savedAt = cloudText(item && item.savedAt);
            const lastUsedAt = cloudText(item && item.lastUsedAt);
            const timestamp = savedAt || lastUsedAt;
            const opening = openingId === id;
            return (
              <li key={id}>
                <span aria-hidden="true" className="landing-recent-icon material-symbols-rounded">
                  description
                </span>
                <span className="landing-recent-copy">
                  <strong title={fileName}>{fileName}</strong>
                  <small>
                    {folderName ? <span title={folderName}>{folderName}</span> : null}
                    {folderName && timestamp ? <span aria-hidden="true"> • </span> : null}
                    {timestamp ? (
                      <span>
                        {savedAt ? 'Saved ' : 'Last used '}
                        <time dateTime={timestamp} title={formatUiDateTime(timestamp)}>
                          {formatUiDateTime(timestamp)}
                        </time>
                      </span>
                    ) : null}
                  </small>
                </span>
                <button
                  aria-label={`Open ${fileName}`}
                  className="btn btn-soft"
                  disabled={loading || !!openingId || !id || typeof onOpenRecent !== 'function'}
                  onClick={() => onOpenRecent?.(id)}
                  type="button"
                >
                  {opening ? 'Opening…' : 'Open'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="landing-recent-empty">
          {loading
            ? 'Looking for recently used workbooks…'
            : 'Workbooks you open or save will appear here.'}
        </p>
      )}
    </section>
  );
}

function StartupCloudLibrary({ cloud: rawCloud, onCloudAction }) {
  const cloud = rawCloud && typeof rawCloud === 'object' ? rawCloud : {};
  if (cloud.configured !== true) return null;
  const workbooks = Array.isArray(cloud.workbooks) ? cloud.workbooks : [];
  const user = cloud.user && typeof cloud.user === 'object' ? cloud.user : null;
  const signedIn = cloud.status === 'signed_in' && !!user;
  const pending = !!cloudText(cloud.pendingOperation) || cloud.status === 'initializing';
  const connecting = cloud.status === 'signing_in';
  const busy = pending || connecting;
  const openingApple = cloudText(cloud.pendingOperation) === 'sign-in-apple';
  const run = (operation, payload) => {
    if (typeof onCloudAction === 'function') void onCloudAction(operation, payload || {});
  };

  return (
    <section aria-labelledby="landing-cloud-heading" className="landing-cloud-library">
      <div className="landing-cloud-heading">
        <div>
          <small>Cavalry Cloud</small>
          <h2 id="landing-cloud-heading">
            {signedIn ? 'Your Cloud workbooks' : 'Open a workbook from any device'}
          </h2>
        </div>
        {signedIn ? (
          <span className="landing-cloud-user">{cloudText(user.email || user.name)}</span>
        ) : null}
      </div>
      {cloud.error ? (
        <div className="panel-note status-bad" role="alert">
          {cloudText(cloud.error)}
        </div>
      ) : null}
      {cloud.notice ? (
        <div className="panel-note" role="status">
          {cloudText(cloud.notice)}
        </div>
      ) : null}
      {!signedIn ? (
        <div className="landing-cloud-signed-out">
          <p>Sign in with Apple or Google to see your private Cloud library on this Mac.</p>
          <p>
            If you already used Google for Cavalry Cloud, continue with Google first and connect
            Apple later in Settings.
          </p>
          <div className="landing-cloud-provider-actions">
            <AppleOAuthButton
              className="landing-apple-sign-in"
              disabled={busy || cloud.status === 'unavailable'}
              onClick={() => run('sign-in-apple')}
              pending={openingApple}
            />
            <button
              className="btn btn-primary"
              disabled={busy || cloud.status === 'unavailable'}
              onClick={() => run('sign-in')}
              type="button"
            >
              <span aria-hidden="true" className="landing-google-mark">
                G
              </span>
              {!openingApple && pending ? 'Opening Google…' : 'Continue with Google'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="landing-cloud-toolbar">
            <button
              className="btn btn-soft"
              disabled={pending}
              onClick={() => run('refresh')}
              type="button"
            >
              Refresh
            </button>
            <button
              className="btn btn-quiet"
              disabled={pending}
              onClick={() => run('sign-out')}
              type="button"
            >
              Sign Out
            </button>
          </div>
          {workbooks.length ? (
            <ul aria-label="Cavalry Cloud workbooks" className="landing-cloud-workbooks">
              {workbooks.map((workbook) => {
                const id = cloudText(workbook && workbook.id);
                const name = cloudText(workbook && workbook.name) || 'Untitled workbook';
                const metadata = [
                  workbook && workbook.year,
                  cloudText(workbook && workbook.currency)
                ]
                  .filter(Boolean)
                  .join(' • ');
                return (
                  <li key={id}>
                    <span aria-hidden="true" className="material-symbols-rounded">
                      table_view
                    </span>
                    <span>
                      <strong>{name}</strong>
                      <small>{metadata || 'Cloud workbook'}</small>
                    </span>
                    <button
                      aria-label={`Open ${name} from Cavalry Cloud`}
                      className="btn btn-primary"
                      disabled={pending || !id}
                      onClick={() => run('open', { workbookId: id })}
                      type="button"
                    >
                      Open
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="landing-cloud-empty">
              No Cloud workbooks yet. Create one locally, then choose Add to Cloud in Settings.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function WorkbookLandingScreen({
  defaultName = 'Cavalry',
  defaultYear = '',
  defaultCurrency = 'PHP',
  currencies = ['PHP', 'USD'],
  busy = false,
  cloud,
  error = '',
  onCreate,
  onCloudAction,
  onOpen,
  onOpenRecent,
  recentWorkbooks
}) {
  const [name, setName] = useState(String(defaultName));
  const [year, setYear] = useState(String(defaultYear));
  const [currency, setCurrency] = useState(String(defaultCurrency));
  const [validationError, setValidationError] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    if (typeof onCreate !== 'function') return;
    const normalizedName = name.trim();
    const normalizedYear = Number(year);
    if (!normalizedName) {
      setValidationError('Give your workbook a name so it is easy to recognize later.');
      return;
    }
    if (!Number.isInteger(normalizedYear) || normalizedYear < 1900 || normalizedYear > 9999) {
      setValidationError('Enter a valid four-digit workbook year.');
      return;
    }
    setValidationError('');
    onCreate({
      name: normalizedName,
      year: normalizedYear,
      currency
    });
  }

  function stepYear(delta) {
    const current = Number(year);
    const base =
      Number.isInteger(current) && current >= 1900 && current <= 9999
        ? current
        : Number(defaultYear) || new Date().getFullYear();
    setYear(String(Math.min(9999, Math.max(1900, base + delta))));
    if (validationError) setValidationError('');
  }

  return (
    <main className="landing">
      <div className="landing-card">
        <StartupBrand />
        <form className="landing-form stack-list" noValidate onSubmit={handleSubmit}>
          <div className="landing-form-heading">
            <h1>Start a workbook</h1>
          </div>
          {error || validationError ? (
            <div className="panel-note status-bad" role="alert">
              {error || validationError}
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="workbook-name">1. Workbook Name</label>
            <div className="landing-input">
              <span aria-hidden="true" className="material-symbols-rounded landing-input-icon">
                book_2
              </span>
              <input
                aria-invalid={!name.trim() && !!validationError}
                autoComplete="off"
                disabled={busy}
                id="workbook-name"
                name="name"
                onChange={(event) => {
                  setName(event.target.value);
                  if (validationError) setValidationError('');
                }}
                placeholder="e.g. Household plan"
                required
                type="text"
                value={name}
              />
            </div>
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="workbook-year">2. Year</label>
              <div className="landing-input">
                <span aria-hidden="true" className="material-symbols-rounded landing-input-icon">
                  calendar_month
                </span>
                <input
                  disabled={busy}
                  id="workbook-year"
                  inputMode="numeric"
                  name="year"
                  onBeforeInput={(event) => {
                    if (event.data && event.data.length === 1 && /\D/.test(event.data)) {
                      event.preventDefault();
                    }
                  }}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, '').slice(0, 4);
                    if (event.target.value !== digits) event.target.value = digits;
                    setYear(digits);
                    if (validationError) setValidationError('');
                  }}
                  pattern="[0-9]*"
                  required
                  type="text"
                  value={year}
                />
                <span className="landing-stepper">
                  <button
                    aria-label="Increase year"
                    disabled={busy}
                    onClick={() => stepYear(1)}
                    tabIndex={-1}
                    type="button"
                  >
                    <span aria-hidden="true" className="material-symbols-rounded">
                      keyboard_arrow_up
                    </span>
                  </button>
                  <button
                    aria-label="Decrease year"
                    disabled={busy}
                    onClick={() => stepYear(-1)}
                    tabIndex={-1}
                    type="button"
                  >
                    <span aria-hidden="true" className="material-symbols-rounded">
                      keyboard_arrow_down
                    </span>
                  </button>
                </span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="workbook-currency">3. Base Currency</label>
              <div className="landing-input">
                <span aria-hidden="true" className="landing-currency-badge">
                  {CURRENCY_SYMBOLS[currency] || String(currency).charAt(0)}
                </span>
                <select
                  disabled={busy}
                  id="workbook-currency"
                  name="currency"
                  onChange={(event) => setCurrency(event.target.value)}
                  value={currency}
                >
                  {currencies.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <span
                  aria-hidden="true"
                  className="material-symbols-rounded landing-select-chevron"
                >
                  expand_more
                </span>
              </div>
            </div>
          </div>
          <div className="landing-actions">
            <button
              className="btn btn-primary landing-create-button"
              disabled={busy || typeof onCreate !== 'function'}
              type="submit"
            >
              <span aria-hidden="true" className="material-symbols-rounded">
                arrow_forward
              </span>
              {busy ? 'Creating…' : 'Create Workbook'}
            </button>
            <span>or</span>
            <button
              aria-label="Open Workbook File"
              className="btn btn-quiet"
              disabled={busy || typeof onOpen !== 'function'}
              onClick={onOpen}
              type="button"
            >
              <span aria-hidden="true" className="material-symbols-rounded">
                folder_open
              </span>
              Open an existing workbook
            </button>
          </div>
          <p className="landing-file-note">
            <span className="material-symbols-rounded">info</span>Supports HTML and JSON files.
          </p>
        </form>
        <RecentWorkbookLibrary recent={recentWorkbooks} onOpenRecent={onOpenRecent} />
        <StartupCloudLibrary cloud={cloud} onCloudAction={onCloudAction} />
      </div>
    </main>
  );
}

export function WorkbookLoadingScreen({ message = 'Loading workbook…' }) {
  return (
    <main className="landing">
      <div className="landing-card">
        <StartupBrand />
        <div aria-live="polite" className="landing-form landing-status stack-list" role="status">
          <span className="landing-loader" aria-hidden="true" />
          <div>
            <h1>Opening workbook</h1>
            <p>{message}</p>
          </div>
        </div>
      </div>
    </main>
  );
}

export function WorkbookErrorScreen({ error = 'Workbook could not be opened.', onRetry, onOpen }) {
  return (
    <main className="landing">
      <div className="landing-card">
        <StartupBrand />
        <div className="landing-form landing-status stack-list">
          <div role="alert">
            <span className="landing-error-icon material-symbols-rounded" aria-hidden="true">
              error
            </span>
            <h1>Workbook could not be opened</h1>
            <p>{error}</p>
          </div>
          <div className="page-actions">
            {typeof onRetry === 'function' ? (
              <button className="btn btn-soft" onClick={onRetry} type="button">
                Try Again
              </button>
            ) : null}
            {typeof onOpen === 'function' ? (
              <button className="btn btn-primary" onClick={onOpen} type="button">
                <span aria-hidden="true" className="material-symbols-rounded">
                  folder_open
                </span>
                Open Another Workbook
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

export function WorkbookStartupScreen({ status = WORKBOOK_STARTUP_STATUS.EMPTY, ...props }) {
  if (status === WORKBOOK_STARTUP_STATUS.LOADING) {
    return <WorkbookLoadingScreen message={props.loadingMessage} />;
  }
  if (status === WORKBOOK_STARTUP_STATUS.ERROR) {
    return (
      <WorkbookErrorScreen error={props.error} onOpen={props.onOpen} onRetry={props.onRetry} />
    );
  }
  return <WorkbookLandingScreen {...props} />;
}
