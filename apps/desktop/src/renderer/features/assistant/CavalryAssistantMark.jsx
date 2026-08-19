import React from 'react';

import companionLogo from '../../assets/ai-companion-logo.png';

export function CavalryAssistantMark({ className = '', working = false }) {
  const classes = ['cavalry-assistant-mark', working ? 'working' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      aria-hidden="true"
      className={classes}
      style={{ '--cavalry-assistant-mark-source': `url(${companionLogo})` }}
    />
  );
}
