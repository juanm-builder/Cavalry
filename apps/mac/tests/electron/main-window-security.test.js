// Pins BrowserWindow webPreferences so renderer code stays behind preload bridges.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { APPROVED_DEV_RENDERER_URL } = require('../../src/main/privileged-ipc-security.cjs');

const mainWindowControllerPath = fileURLToPath(
  new URL('../../src/main/main-window-controller.cjs', import.meta.url)
);
const mainEntryPath = fileURLToPath(new URL('../../src/main/index.cjs', import.meta.url));

function getBrowserWindowPreferencesBlock() {
  const source = readFileSync(mainWindowControllerPath, 'utf8');
  const browserWindowIndex = source.indexOf('new BrowserWindow({');
  const webPreferencesIndex = source.indexOf('webPreferences:', browserWindowIndex);
  expect(browserWindowIndex).toBeGreaterThanOrEqual(0);
  expect(webPreferencesIndex).toBeGreaterThan(browserWindowIndex);
  const blockLines = source.slice(webPreferencesIndex).split('\n');
  const closingIndex = blockLines.findIndex((line, index) => index > 0 && /^    }[,]?$/.test(line));
  expect(closingIndex).toBeGreaterThan(0);
  return blockLines.slice(0, closingIndex + 1).join('\n');
}

describe('Electron main window security', () => {
  it('keeps renderer Node integration disabled behind context isolation and sandboxing', () => {
    const block = getBrowserWindowPreferencesBlock();

    const mainSource = readFileSync(mainEntryPath, 'utf8');
    expect(mainSource).toContain("preloadPath: path.join(__dirname, '..', 'preload', 'index.cjs')");
    expect(block).toContain('preload: options.preloadPath');
    expect(block).toContain('nodeIntegration: false');
    expect(block).toContain('contextIsolation: true');
    expect(block).toContain('sandbox: true');
    expect(block).not.toContain('nodeIntegration: true');
    expect(block).not.toContain('contextIsolation: false');
    expect(block).not.toContain('sandbox: false');
  });

  it('keeps insecure BrowserWindow preferences out of the renderer surface', () => {
    const block = getBrowserWindowPreferencesBlock();
    const forbiddenPreferences = [
      'webSecurity: false',
      'allowRunningInsecureContent: true',
      'enableRemoteModule: true',
      'webviewTag: true'
    ];

    forbiddenPreferences.forEach((preference) => {
      expect(block).not.toContain(preference);
    });
  });

  it('uses one resolved renderer URL and one guard for every privileged IPC surface', () => {
    const mainSource = readFileSync(mainEntryPath, 'utf8');

    expect(mainSource).toContain('isPackaged: !!(app && app.isPackaged)');
    expect(mainSource.match(/process\.env\.CAVALRY_RENDERER_URL/g)).toHaveLength(1);
    expect(mainSource.match(/assertTrustedSender: assertTrustedRendererIpcSender/g)).toHaveLength(
      5
    );
    expect(APPROVED_DEV_RENDERER_URL).toBe('http://127.0.0.1:5173/');
  });

  it('does not hold first-window startup on cloud initialization', () => {
    const mainSource = readFileSync(mainEntryPath, 'utf8');
    const localStateIndex = mainSource.indexOf('await workbookFileController.loadFileState()');
    const handlersIndex = mainSource.indexOf('workbookFileController.registerFileHandlers()');
    const deepLinkIndex = mainSource.indexOf(
      'if (launchDeepLink) deepLinkController.handle(launchDeepLink)'
    );
    const windowIndex = mainSource.indexOf(
      'if (!BrowserWindow.getAllWindows().length) createMainWindow()'
    );
    const cloudIndex = mainSource.indexOf(
      'void cloudController.initialize().catch(() => undefined)'
    );

    expect(localStateIndex).toBeGreaterThan(0);
    expect(handlersIndex).toBeGreaterThan(localStateIndex);
    expect(deepLinkIndex).toBeGreaterThan(handlersIndex);
    expect(windowIndex).toBeGreaterThan(deepLinkIndex);
    expect(cloudIndex).toBeGreaterThan(windowIndex);
    expect(mainSource).not.toContain(
      'Promise.all([workbookFileController.loadFileState(), cloudController.initialize()])'
    );
  });
});
