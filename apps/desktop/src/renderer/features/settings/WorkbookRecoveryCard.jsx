import React, { useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { useActionBindings } from '../../shared/action-binding.jsx';
import { formatUiDateTime } from '../../shared/date-format.js';
import { AccountDialog } from './AppleAccountChooser.jsx';

export function WorkbookRecoveryCard({ recovery = {} }) {
  const actions = useActionBindings();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const busy = recovery.status === 'loading' || !!recovery.openingId;
  const items = Array.isArray(recovery.items) ? recovery.items : [];
  const refresh = async () => {
    setError('');
    const result = await actions.dispatch('refresh-workbook-recovery');
    if (result?.ok === false) setError(result.error || 'Recovery copies could not be loaded.');
  };
  const openCopy = async (id) => {
    setError('');
    const result = await actions.dispatch('open-workbook-recovery', { id });
    if (result?.status === 'loaded') setOpen(false);
    else if (result?.ok === false || result?.status === 'error') {
      setError(result.error || 'This recovery copy could not be opened.');
    }
  };

  return (
    <section
      aria-labelledby="settings-recovery-heading"
      className="settings-card settings-workbook-recovery"
    >
      <CavalryIcon name="history" />
      <div>
        <h3 id="settings-recovery-heading">Find a missing workbook</h3>
        <p>Check saved copies on this Mac and surviving local iCloud copies.</p>
        <button
          className="btn"
          onClick={() => {
            setOpen(true);
            void refresh();
          }}
          type="button"
        >
          Find recovery copies
        </button>
      </div>
      {open ? (
        <AccountDialog busy={busy} onClose={() => setOpen(false)} title="Find recovery copies">
          <p className="settings-account-dialog-intro">
            Your current workbook is saved before another copy opens. Recovery preserves the
            original copies.
          </p>
          {error || recovery.error ? (
            <p className="settings-feedback-message bad" role="alert">
              {error || recovery.error}
            </p>
          ) : null}
          {items.length ? (
            <ul aria-label="Workbook recovery copies" className="settings-recovery-list">
              {items.map((item) => (
                <li key={item.id}>
                  <CavalryIcon name="description" />
                  <span>
                    <strong>{item.fileName || 'Untitled workbook'}</strong>
                    <small>
                      {item.folderName || 'Saved on this Mac'}
                      {item.savedAt ? ` · ${formatUiDateTime(item.savedAt)}` : ''}
                    </small>
                  </span>
                  <button
                    aria-label={`Open recovery copy ${item.fileName || 'Untitled workbook'}`}
                    className="btn"
                    disabled={busy || !item.id}
                    onClick={() => void openCopy(item.id)}
                    type="button"
                  >
                    {recovery.openingId === item.id ? 'Opening…' : 'Open'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status">
              {busy ? 'Looking for saved copies…' : 'No saved copies were found on this Mac.'}
            </p>
          )}
          <p className="settings-account-dialog-note">
            To check another account’s iCloud library, close this window and choose Change account.
            The former Cavalry Cloud service is not searched here.
          </p>
          <button className="btn" disabled={busy} onClick={() => void refresh()} type="button">
            Check again
          </button>
        </AccountDialog>
      ) : null}
    </section>
  );
}
