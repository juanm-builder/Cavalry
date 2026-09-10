function formPayload(form) {
  const payload = {};
  if (!(form && typeof FormData === 'function')) {
    return payload;
  }
  new FormData(form).forEach((value, key) => {
    if (!(key in payload) && typeof value === 'string') {
      payload[key] = value;
    }
  });
  return payload;
}

export function submitAction(event, onAction, type) {
  event.preventDefault();
  if (typeof onAction === 'function') {
    return onAction({ type, payload: formPayload(event.currentTarget) });
  }
  return undefined;
}
