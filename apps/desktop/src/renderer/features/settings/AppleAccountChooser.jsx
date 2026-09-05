import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

export function AccountDialog({ children, title, onClose, busy = false }) {
  const dialog = useRef(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current;
    const focusable = () => [
      ...element.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')
    ];
    (element.querySelector('input:checked') || focusable()[0] || element)?.focus();
    const keyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0];
      const last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === element)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    element.addEventListener('keydown', keyDown);
    return () => {
      element.removeEventListener('keydown', keyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label={title}
        aria-modal="true"
        aria-busy={busy}
        className="modal-card settings-account-dialog"
        ref={dialog}
        role="dialog"
        tabIndex={-1}
      >
        <button
          aria-label={`Close ${title}`}
          className="btn btn-icon settings-account-dialog-close"
          onClick={onClose}
          type="button"
        >
          <CavalryIcon name="close" />
        </button>
        <h2>{title}</h2>
        {children}
      </section>
    </div>,
    document.body
  );
}

export function AppleAccountChooser({
  accountSource = 'system',
  browserSignInAvailable = false,
  browserSignInUnavailableReason = '',
  onChoose,
  onClose,
  onCancelSignIn,
  pending = false
}) {
  const [source, setSource] = useState(
    accountSource === 'browser' && browserSignInAvailable ? 'browser' : 'system'
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const busy = submitting || pending;
  const cancel = async () => {
    if (!busy) {
      onClose();
      return;
    }
    if (source !== 'browser' || typeof onCancelSignIn !== 'function') return;
    const result = await onCancelSignIn();
    if (result?.ok) onClose();
    else setError(result?.error || 'Couldn’t cancel browser sign-in. Try again.');
  };
  const selectAccount = async (event) => {
    event.preventDefault();
    if (busy || (source === 'browser' && !browserSignInAvailable)) return;
    setError('');
    setSubmitting(true);
    try {
      const result = await onChoose(source);
      if (result?.ok) onClose();
      else
        setError(
          result?.error || result?.errors?.[0]?.message || 'The account was not changed. Try again.'
        );
    } catch (cause) {
      setError(cause?.message || 'The account was not changed. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccountDialog busy={busy} onClose={() => void cancel()} title="Choose an Apple Account">
      <p className="settings-account-dialog-intro">Choose which iCloud library Cavalry uses.</p>
      <form onSubmit={selectAccount}>
        <fieldset className="settings-account-options" disabled={busy}>
          <legend className="sr-only">Apple Account connection</legend>
          <label className={`settings-account-option${source === 'system' ? ' is-selected' : ''}`}>
            <input
              checked={source === 'system'}
              name="icloud-account-source"
              onChange={() => setSource('system')}
              type="radio"
              value="system"
            />
            <CavalryIcon name="computer" />
            <span>
              <strong>Use this Mac’s iCloud</strong>
              <small>Use the account in System Settings.</small>
            </span>
          </label>
          <label
            className={`settings-account-option${source === 'browser' ? ' is-selected' : ''}${!browserSignInAvailable ? ' is-unavailable' : ''}`}
          >
            <input
              checked={source === 'browser'}
              disabled={!browserSignInAvailable}
              name="icloud-account-source"
              onChange={() => setSource('browser')}
              type="radio"
              value="browser"
            />
            <CavalryIcon name="web" />
            <span>
              <strong>Use another Apple Account</strong>
              <small>Sign in securely in your browser.</small>
            </span>
          </label>
        </fieldset>
        {!browserSignInAvailable ? (
          <p className="settings-account-dialog-note" role="note">
            {browserSignInUnavailableReason || 'Browser sign-in is not available in this build.'}
          </p>
        ) : null}
        <p className="settings-account-dialog-note">Your saved copies on this Mac will be kept.</p>
        {error ? (
          <p className="settings-feedback-message bad" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="btn btn-primary settings-account-dialog-continue"
          disabled={busy}
          type="submit"
        >
          {busy
            ? source === 'browser'
              ? 'Waiting for browser sign-in…'
              : 'Connecting…'
            : source === 'browser'
              ? 'Continue in browser'
              : 'Use this Mac’s iCloud'}
        </button>
        <button
          className="btn settings-account-dialog-cancel"
          onClick={() => void cancel()}
          type="button"
        >
          Cancel
        </button>
      </form>
      <p className="settings-account-dialog-note">
        This won’t change the Apple Account on your Mac.
      </p>
    </AccountDialog>
  );
}
