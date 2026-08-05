import React from 'react';

import appleContinueBlackButtonUrl from '../assets/apple-continue-black-en-us.png';
import appleContinueWhiteButtonUrl from '../assets/apple-continue-white-en-us.png';

export function AppleOAuthButton({ className = '', disabled = false, onClick, pending = false }) {
  const label = pending ? 'Opening Continue with Apple in your browser' : 'Continue with Apple';
  return (
    <button
      aria-busy={pending || undefined}
      aria-label={label}
      className={`apple-oauth-button ${className}`.trim()}
      disabled={disabled}
      onClick={onClick}
      title="Continue with Apple"
      type="button"
    >
      <img
        alt=""
        className="apple-oauth-button-dark-surface"
        draggable="false"
        src={appleContinueWhiteButtonUrl}
      />
      <img
        alt=""
        className="apple-oauth-button-light-surface"
        draggable="false"
        src={appleContinueBlackButtonUrl}
      />
    </button>
  );
}
