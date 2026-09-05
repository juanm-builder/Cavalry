const unavailable = async () => ({ status: 'unavailable' });
const noop = async () => ({ ok: true });

export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

export function createNullRendererPorts(overrides = {}) {
  const defaults = {
    workbookStorage: {
      load: unavailable,
      listRecent: async () => ({ ok: true, workbooks: [] }),
      open: unavailable,
      openRecent: unavailable,
      save: noop,
      saveAs: noop,
      forget: noop,
      reveal: noop,
      subscribe: () => () => {}
    },
    browserCache: {
      load: unavailable,
      save: noop,
      clear: noop
    },
    lifecycle: { onBeforeExit: () => () => {} },
    advisor: {
      invoke: async () => ({ ok: false, unavailable: true }),
      subscribe: () => () => {}
    },
    companion: {
      publish: noop,
      getStatus: unavailable,
      subscribe: () => () => {}
    },
    cloud: {
      invoke: async () => ({
        ok: false,
        unavailable: true,
        state: {
          configured: false,
          status: 'unconfigured',
          user: null,
          workbooks: []
        }
      }),
      subscribe: () => () => {}
    },
    updates: {
      invoke: async () => ({
        ok: false,
        unavailable: true,
        state: { enabled: false, status: 'disabled' }
      }),
      subscribe: () => () => {}
    },
    downloads: {
      save: noop
    },
    filePicker: {
      openText: async () => ({ ok: false, unavailable: true })
    },
    clock: {
      now: () => new Date().toISOString(),
      today: () => localDateKey()
    },
    ids: {
      create: (prefix = 'id') => `${prefix}_${Math.random().toString(36).slice(2, 10)}`
    },
    fingerprint: {
      create: (value) => JSON.stringify(value)
    }
  };

  return Object.freeze({
    ...defaults,
    ...overrides,
    workbookStorage: Object.freeze({
      ...defaults.workbookStorage,
      ...(overrides.workbookStorage || {})
    }),
    browserCache: Object.freeze({ ...defaults.browserCache, ...(overrides.browserCache || {}) }),
    lifecycle: Object.freeze({ ...defaults.lifecycle, ...(overrides.lifecycle || {}) }),
    advisor: Object.freeze({ ...defaults.advisor, ...(overrides.advisor || {}) }),
    companion: Object.freeze({ ...defaults.companion, ...(overrides.companion || {}) }),
    cloud: Object.freeze({ ...defaults.cloud, ...(overrides.cloud || {}) }),
    updates: Object.freeze({ ...defaults.updates, ...(overrides.updates || {}) }),
    downloads: Object.freeze({ ...defaults.downloads, ...(overrides.downloads || {}) }),
    filePicker: Object.freeze({ ...defaults.filePicker, ...(overrides.filePicker || {}) }),
    clock: Object.freeze({ ...defaults.clock, ...(overrides.clock || {}) }),
    ids: Object.freeze({ ...defaults.ids, ...(overrides.ids || {}) }),
    fingerprint: Object.freeze({ ...defaults.fingerprint, ...(overrides.fingerprint || {}) })
  });
}
