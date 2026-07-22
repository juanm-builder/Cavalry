// Pins packaged renderer selection and the shared privileged IPC authorization boundary.

import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  APPROVED_DEV_RENDERER_URL,
  createTrustedRendererIpcGuard,
  resolveCavalryRendererUrl
} = require('../../src/main/privileged-ipc-security.cjs');

function createHarness(url = 'file:///Applications/Cavalry/index.html') {
  const frame = { url, top: null };
  const webContents = {
    mainFrame: frame,
    getURL: () => frame.url,
    isDestroyed: () => false
  };
  const window = {
    webContents,
    isDestroyed: () => false
  };
  return {
    event: { sender: webContents, senderFrame: frame },
    frame,
    webContents,
    window
  };
}

describe('privileged renderer IPC security', () => {
  it('ignores renderer overrides in packaged builds and accepts only the fixed dev URL', () => {
    expect(
      resolveCavalryRendererUrl({
        isPackaged: true,
        rendererUrl: 'https://attacker.example/app'
      })
    ).toBe('');
    expect(
      resolveCavalryRendererUrl({ isPackaged: true, rendererUrl: APPROVED_DEV_RENDERER_URL })
    ).toBe('');
    expect(
      resolveCavalryRendererUrl({ isPackaged: false, rendererUrl: 'http://127.0.0.1:5173' })
    ).toBe(APPROVED_DEV_RENDERER_URL);

    for (const rendererUrl of [
      'https://attacker.example/app',
      'http://localhost:5173/',
      'http://127.0.0.1:5174/',
      'http://127.0.0.1:5173/?debug=1',
      'http://127.0.0.1:5173/#debug'
    ]) {
      expect(resolveCavalryRendererUrl({ isPackaged: false, rendererUrl })).toBe('');
    }
  });

  it('requires the intended live window, its main frame, and the exact packaged URL', () => {
    const harness = createHarness();
    const guard = createTrustedRendererIpcGuard({
      getMainWindow: () => harness.window,
      indexPath: '/Applications/Cavalry/index.html'
    });

    expect(guard(harness.event)).toBe(true);
    expect(() =>
      guard({
        ...harness.event,
        senderFrame: { url: 'file:///Applications/Cavalry/index.html', top: harness.frame }
      })
    ).toThrow(/only to Cavalry/);
  });

  it('rejects remote URLs, subframes, different windows, and destroyed senders', () => {
    const harness = createHarness();
    const guard = createTrustedRendererIpcGuard({
      getMainWindow: () => harness.window,
      indexPath: '/Applications/Cavalry/index.html'
    });

    harness.frame.url = 'https://attacker.example/app';
    expect(() => guard(harness.event)).toThrow(/only to Cavalry/);
    harness.frame.url = 'file:///Applications/Cavalry/index.html';
    expect(() =>
      guard({
        sender: harness.webContents,
        senderFrame: { url: harness.frame.url, top: harness.frame }
      })
    ).toThrow(/only to Cavalry/);
    expect(() =>
      guard({
        sender: { ...harness.webContents, mainFrame: harness.frame },
        senderFrame: harness.frame
      })
    ).toThrow(/only to Cavalry/);
    harness.webContents.isDestroyed = () => true;
    expect(() => guard(harness.event)).toThrow(/only to Cavalry/);
  });

  it('authorizes the exact approved development document only', () => {
    const harness = createHarness(APPROVED_DEV_RENDERER_URL);
    const guard = createTrustedRendererIpcGuard({
      getMainWindow: () => harness.window,
      indexPath: '/Applications/Cavalry/index.html',
      rendererUrl: APPROVED_DEV_RENDERER_URL
    });

    expect(guard(harness.event)).toBe(true);
    harness.frame.url = 'http://127.0.0.1:5173/other';
    expect(() => guard(harness.event)).toThrow(/only to Cavalry/);
  });
});
