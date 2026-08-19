import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  readOnboardingState,
  WELCOME_STATES,
  writeOnboardingState
} from '../../app/onboarding-preferences.js';
import { CAVALRY_ASSISTANT_CONVERSATIONS_EVENT } from '../assistant/cavalry-assistant-conversations.js';

function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_error) {
    return null;
  }
}

export function useOnboarding({ storage } = {}) {
  const resolvedStorage = useMemo(() => storage || browserStorage(), [storage]);
  const [state, setState] = useState(() => readOnboardingState(resolvedStorage));

  const update = useCallback(
    (patch) => {
      setState((current) => writeOnboardingState(resolvedStorage, { ...current, ...patch }));
    },
    [resolvedStorage]
  );

  return {
    state,
    markWelcomeSeen: useCallback(() => update({ welcome: WELCOME_STATES.SEEN }), [update]),
    setChecklistDismissed: useCallback(
      (dismissed) => update({ checklistDismissed: dismissed === true }),
      [update]
    )
  };
}

// Bumps whenever the assistant persists conversations, so checklist derivations
// that read conversation storage can recompute.
export function useAssistantActivitySignal() {
  const [signal, setSignal] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const bump = () => setSignal((current) => current + 1);
    window.addEventListener(CAVALRY_ASSISTANT_CONVERSATIONS_EVENT, bump);
    return () => window.removeEventListener(CAVALRY_ASSISTANT_CONVERSATIONS_EVENT, bump);
  }, []);
  return signal;
}
