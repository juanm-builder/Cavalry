import React, { createContext, useCallback, useContext, useMemo } from 'react';

export const NAVIGATE_ACTION_TYPE = 'route/navigate';

const EMPTY_BINDING = Object.freeze({
  onAction: null,
  getActionProps: null
});

const ActionBindingContext = createContext(EMPTY_BINDING);

function normalizePayload(payload) {
  return Object.entries(payload && typeof payload === 'object' ? payload : {}).reduce(
    (next, [key, value]) => {
      if (value !== null && typeof value !== 'undefined') {
        next[key] = value;
      }
      return next;
    },
    {}
  );
}

export function payloadFromActionAttributes(attributes) {
  return Object.entries(attributes && typeof attributes === 'object' ? attributes : {}).reduce(
    (payload, [key, value]) => {
      if (!String(key).startsWith('data-') || value === null || typeof value === 'undefined') {
        return payload;
      }
      const payloadKey = String(key)
        .slice(5)
        .replace(/-([a-z0-9])/g, (_match, character) => character.toUpperCase());
      if (payloadKey && payloadKey !== 'action' && payloadKey !== 'route') {
        payload[payloadKey] = value;
      }
      return payload;
    },
    {}
  );
}

function createAction(type, payload) {
  return {
    type: String(type || ''),
    payload: normalizePayload(payload)
  };
}

function withControlValue(action, event, options = {}) {
  const control = event && event.currentTarget;
  if (!control) {
    return action;
  }
  const controlValue = String(control.value == null ? '' : control.value);
  const controlPayload =
    control.type === 'checkbox'
      ? { checked: !!control.checked }
      : { value: options.valueType === 'number' ? Number(controlValue) || 0 : controlValue };
  return createAction(action.type, { ...action.payload, ...controlPayload });
}

function withFormValues(action, event) {
  const control = event && event.currentTarget;
  const form = control && control.form;
  if (!form || typeof FormData !== 'function') {
    return action;
  }
  const values = {};
  new FormData(form).forEach((value, key) => {
    if (!(key in values) && typeof value === 'string') {
      values[key] = value;
    }
  });
  return createAction(action.type, { ...action.payload, ...values });
}

export function ActionBindingProvider({ onAction, getActionProps, children }) {
  const parent = useContext(ActionBindingContext);
  const value = useMemo(
    () => ({
      onAction: typeof onAction === 'function' ? onAction : parent.onAction,
      getActionProps: typeof getActionProps === 'function' ? getActionProps : parent.getActionProps
    }),
    [getActionProps, onAction, parent.getActionProps, parent.onAction]
  );

  return <ActionBindingContext.Provider value={value}>{children}</ActionBindingContext.Provider>;
}

export function useActionBindings() {
  const { onAction, getActionProps } = useContext(ActionBindingContext);
  const dispatch = useCallback(
    (type, payload = {}) => {
      if (typeof onAction !== 'function') return undefined;
      return onAction(createAction(type, payload));
    },
    [onAction]
  );
  const bind = useCallback(
    (type, payload = {}, options = {}) => {
      const action = createAction(type, payload);
      if (typeof getActionProps === 'function') {
        return getActionProps(action, options) || {};
      }
      if (options.event === 'change') {
        if (typeof onAction !== 'function') {
          return { onChange: () => {} };
        }
        return { onChange: (event) => onAction(withControlValue(action, event, options)) };
      }
      if (typeof onAction !== 'function') {
        return {};
      }
      return {
        onClick: (event) => onAction(options.includeForm ? withFormValues(action, event) : action)
      };
    },
    [getActionProps, onAction]
  );

  return useMemo(
    () => ({
      action: (type, payload, options) => bind(type, payload, options),
      change: (type, payload, options = {}) => bind(type, payload, { ...options, event: 'change' }),
      dispatch,
      navigate: (routeId) => bind(NAVIGATE_ACTION_TYPE, { routeId })
    }),
    [bind, dispatch]
  );
}
