// Applies command-result workbook/effects in one place as mutation workflows migrate.

import React, { createContext, useCallback, useContext, useMemo } from 'react';

import { useWorkbookSession } from './WorkbookProvider.jsx';

const CommandExecutorContext = createContext(null);

export function normalizeCommandResult(result) {
  const source = result && typeof result === 'object' ? result : {};
  return {
    ok: source.ok === true,
    workbook: Object.prototype.hasOwnProperty.call(source, 'workbook')
      ? source.workbook
      : undefined,
    events: Array.isArray(source.events) ? source.events : [],
    warnings: Array.isArray(source.warnings) ? source.warnings : [],
    errors: Array.isArray(source.errors) ? source.errors : []
  };
}

export function CommandExecutorProvider({ children, onEvent, onEffect }) {
  const { dispatch, scheduleWorkbookSave, setWorkbook } = useWorkbookSession();
  const executeCommandResult = useCallback(
    (result) => {
      const normalized = normalizeCommandResult(result);
      let nextWorkbook;
      if (normalized.ok && typeof normalized.workbook !== 'undefined') {
        nextWorkbook = setWorkbook(normalized.workbook);
      }
      if (!normalized.ok && normalized.errors.length) {
        dispatch({
          type: 'error/reported',
          error: normalized.errors[0]
        });
      }
      const eventHandler = typeof onEvent === 'function' ? onEvent : onEffect;
      normalized.events.forEach((event) => {
        if (event.type === 'navigate') dispatch({ type: 'route/navigated', routeId: event.route });
        else if (event.type === 'close-modal' || event.type === 'close-overlay')
          dispatch({ type: 'overlay/closed', id: event.id });
        else if (event.type === 'open-overlay' && event.overlay)
          dispatch({ type: 'overlay/opened', overlay: event.overlay });
        else if (event.type === 'schedule-save')
          scheduleWorkbookSave(nextWorkbook || normalized.workbook);
        else if (event.type === 'set-save-status') {
          dispatch(
            event.status === 'saving' ? { type: 'save/started' } : { type: 'save/succeeded' }
          );
        }
        if (typeof eventHandler === 'function') eventHandler(event, normalized);
      });
      return normalized;
    },
    [dispatch, onEffect, onEvent, scheduleWorkbookSave, setWorkbook]
  );
  const value = useMemo(
    () => ({
      executeCommandResult
    }),
    [executeCommandResult]
  );

  return (
    <CommandExecutorContext.Provider value={value}>{children}</CommandExecutorContext.Provider>
  );
}

export function useCommandExecutor() {
  const context = useContext(CommandExecutorContext);
  if (!context) {
    throw new Error('useCommandExecutor must be used inside CommandExecutorProvider.');
  }
  return context;
}
