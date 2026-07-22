const { contextBridge } = require('electron');

const calls = [];
const commandSubscribers = new Set();
let activeWorkbookHtml = process.env.CAVALRY_SMOKE_WORKBOOK_BASE64
  ? Buffer.from(process.env.CAVALRY_SMOKE_WORKBOOK_BASE64, 'base64').toString('utf8')
  : '';

function parseWorkbook(html) {
  const match = /<script[^>]+id=["']ledger-grove-export["'][^>]*>([\s\S]*?)<\/script>/i.exec(
    String(html || '')
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1].replace(/<\\\/script/gi, '</script'));
  } catch (_error) {
    return null;
  }
}

function setActiveWorkbookHtml(html) {
  activeWorkbookHtml = String(html || activeWorkbookHtml || '');
  if (activeWorkbookHtml) {
    try {
      process.env.CAVALRY_SMOKE_WORKBOOK_BASE64 = Buffer.from(activeWorkbookHtml, 'utf8').toString(
        'base64'
      );
    } catch (_error) {
      // The in-memory bridge still exercises save/open when a sandbox exposes a read-only environment.
    }
  }
}

function record(name, payload) {
  calls.push({
    name,
    payload: payload || null,
    at: new Date().toISOString()
  });
}

contextBridge.exposeInMainWorld('__CAVALRY_E2E__', true);

contextBridge.exposeInMainWorld('cavalrySmoke', {
  getCalls: () => calls.slice(),
  getWorkbook: () => parseWorkbook(activeWorkbookHtml),
  sendCommand: (command) => {
    record('sendCommand', command);
    for (const subscriber of commandSubscribers) subscriber(command);
  }
});

contextBridge.exposeInMainWorld('cavalryFiles', {
  getActiveWorkbookFile: () => {
    record('getActiveWorkbookFile');
    return Promise.resolve(
      activeWorkbookHtml
        ? {
            ok: true,
            fileName: 'cavalry-dom-smoke.html',
            savedAt: new Date().toISOString(),
            text: activeWorkbookHtml
          }
        : { ok: false, missing: false }
    );
  },
  openWorkbookFile: () => {
    record('openWorkbookFile');
    return Promise.resolve(
      activeWorkbookHtml
        ? {
            ok: true,
            fileName: 'cavalry-dom-smoke.html',
            savedAt: new Date().toISOString(),
            text: activeWorkbookHtml
          }
        : { ok: false, canceled: true }
    );
  },
  saveWorkbookAs: (payload) => {
    record('saveWorkbookAs', {
      suggestedName: payload && payload.suggestedName,
      htmlLength: payload && payload.html ? String(payload.html).length : 0
    });
    if (payload && payload.html) setActiveWorkbookHtml(payload.html);
    return Promise.resolve({
      ok: true,
      fileName: 'cavalry-dom-smoke.html',
      savedAt: new Date().toISOString()
    });
  },
  saveActiveWorkbook: (payload) => {
    record('saveActiveWorkbook', {
      htmlLength: payload && payload.html ? String(payload.html).length : 0
    });
    if (payload && payload.html) setActiveWorkbookHtml(payload.html);
    return Promise.resolve({
      ok: true,
      fileName: 'cavalry-dom-smoke.html',
      savedAt: new Date().toISOString()
    });
  },
  forgetActiveWorkbookFile: () => {
    record('forgetActiveWorkbookFile');
    return Promise.resolve({ ok: true });
  },
  revealActiveWorkbookFile: () => {
    record('revealActiveWorkbookFile');
    return Promise.resolve({ ok: true });
  },
  onCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    commandSubscribers.add(callback);
    return () => commandSubscribers.delete(callback);
  }
});

contextBridge.exposeInMainWorld('cavalryCompanion', {
  publishWorkbook: (payload) => {
    record('publishWorkbook', { reason: payload && payload.reason });
    return Promise.resolve({ ok: true });
  },
  getStatus: () => Promise.resolve({ ok: true, status: { running: false, enabled: false } }),
  onWorkbookUpdated: () => () => {},
  onStatus: () => () => {}
});

contextBridge.exposeInMainWorld('cavalryAdvisor', {
  getSettings: () =>
    Promise.resolve({
      ok: true,
      settings: {
        provider: 'local',
        model: 'built-in-rules',
        apiMode: 'chat'
      }
    }),
  saveSettings: (payload) => {
    record('saveAdvisorSettings', { provider: payload && payload.provider });
    return Promise.resolve({ ok: true, settings: payload || {} });
  },
  getServerStatus: () =>
    Promise.resolve({
      ok: true,
      status: {
        running: false,
        healthy: false,
        manageable: false,
        source: 'smoke',
        message: 'Local model server is not running during DOM smoke.'
      }
    }),
  startServer: () => Promise.resolve({ ok: false, error: 'Disabled during DOM smoke.' }),
  stopServer: () => Promise.resolve({ ok: true }),
  chooseLocalModel: () => Promise.resolve({ ok: false, canceled: true }),
  chooseMmproj: () => Promise.resolve({ ok: false, canceled: true }),
  testConnection: () => Promise.resolve({ ok: true, message: 'Using the built-in rules advisor.' }),
  chat: () => Promise.resolve({ ok: false, error: 'Advisor chat is disabled during DOM smoke.' }),
  runAgentTurn: () =>
    Promise.resolve({ ok: false, error: 'Advisor agent is disabled during DOM smoke.' }),
  getMicrophoneStatus: () =>
    Promise.resolve({ ok: true, status: { granted: false, canRequest: false } }),
  requestMicrophoneAccess: () => Promise.resolve({ ok: false, granted: false }),
  openMicrophoneSettings: () => Promise.resolve({ ok: true }),
  transcribeAudio: () =>
    Promise.resolve({ ok: false, error: 'Voice input is disabled during DOM smoke.' }),
  cancel: () => Promise.resolve({ ok: true }),
  onStatus: () => () => {}
});
