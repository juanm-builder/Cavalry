import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export const AMOUNT_VISIBILITY_STORAGE_KEY = 'cavalry.amounts-hidden.v1';
const AmountVisibilityContext = createContext({ amountsHidden: false, toggleAmounts: () => {} });

function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function AmountVisibilityProvider({ children, storage }) {
  const resolvedStorage = storage === undefined ? browserStorage() : storage;
  const [amountsHidden, setAmountsHidden] = useState(() => {
    try {
      return resolvedStorage?.getItem(AMOUNT_VISIBILITY_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const toggleAmounts = useCallback(() => {
    setAmountsHidden((current) => !current);
  }, []);

  // Persist after commit, never from the state updater (which React may replay).
  React.useEffect(() => {
    try {
      resolvedStorage?.setItem(AMOUNT_VISIBILITY_STORAGE_KEY, String(amountsHidden));
    } catch {
      // The toggle still works for this session when storage is unavailable.
    }
  }, [amountsHidden, resolvedStorage]);

  const value = useMemo(() => ({ amountsHidden, toggleAmounts }), [amountsHidden, toggleAmounts]);
  return (
    <AmountVisibilityContext.Provider value={value}>{children}</AmountVisibilityContext.Provider>
  );
}

export function useAmountVisibility() {
  return useContext(AmountVisibilityContext);
}
