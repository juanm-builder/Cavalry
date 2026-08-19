import { useCallback, useEffect } from 'react';

export function useModalDismiss(onClose, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [active, onClose]);

  return useCallback(
    (event) => {
      if (event.target === event.currentTarget) onClose?.();
    },
    [onClose]
  );
}
