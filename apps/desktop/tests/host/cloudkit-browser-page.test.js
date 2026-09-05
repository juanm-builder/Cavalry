import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { browserPage } = require('../../src/host/cloudkit-browser-auth.cjs');
const NONCE = 'a3'.repeat(32);
const BRIDGE_ORIGIN = 'https://juanm-builder.github.io';
const REDIRECT_URL = 'https://idmsa.apple.com/signin?test=1';
const TOKEN = 'synthetic-apple-session';

function createPage({ fetch = vi.fn().mockResolvedValue({ ok: true }) } = {}) {
  vi.useFakeTimers();
  const elements = new Map(
    ['continue', 'cancel', 'status'].map((id) => [id, { disabled: false, hidden: false }])
  );
  const listeners = new Map();
  const popup = { closed: false, close: vi.fn(), postMessage: vi.fn() };
  const window = {
    open: vi.fn().mockReturnValue(popup),
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    }
  };
  window.self = window;
  window.top = window;
  const html = browserPage({ nonce: NONCE, redirectURL: REDIRECT_URL });
  const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('The browser page has no executable script.');
  runInNewContext(script, {
    window,
    document: { getElementById: (id) => elements.get(id) },
    fetch,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  });

  const dispatch = async (type, event = {}) => {
    await Promise.all((listeners.get(type) || []).map((listener) => listener(event)));
  };
  const message = (type, overrides = {}) =>
    dispatch('message', {
      source: popup,
      origin: BRIDGE_ORIGIN,
      data: { type, nonce: NONCE, ...overrides.data },
      ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'data'))
    });
  const start = () => elements.get('continue').onclick();
  const ready = async () => {
    start();
    await message('cavalry-icloud-ready');
  };
  return {
    window,
    popup,
    fetch,
    elements,
    message,
    dispatch,
    start,
    ready,
    complete: (token = TOKEN, overrides = {}) =>
      message('cavalry-icloud-complete', { ...overrides, data: { token, ...overrides.data } }),
    cancel: () => elements.get('cancel').onclick(),
    acknowledgements: () =>
      popup.postMessage.mock.calls.filter(([data]) => data.type === 'cavalry-icloud-received')
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('iCloud loopback page protocol', () => {
  it('opens only the fixed HTTPS bridge and waits for its bound ready message', async () => {
    const page = createPage();
    page.start();
    expect(page.window.open).toHaveBeenCalledWith(
      `${BRIDGE_ORIGIN}/Cavalry/icloud-sign-in/#${NONCE}`,
      `cavalry-icloud-${NONCE}`,
      'popup,width=620,height=740'
    );
    expect(page.popup.postMessage).not.toHaveBeenCalled();
    await page.complete();
    expect(page.fetch).not.toHaveBeenCalled();
    await page.message('cavalry-icloud-ready');
    expect(page.popup.postMessage).toHaveBeenCalledExactlyOnceWith(
      { type: 'cavalry-icloud-start', nonce: NONCE, redirectURL: REDIRECT_URL },
      BRIDGE_ORIGIN
    );
    await page.message('cavalry-icloud-ready');
    page.start();
    expect(page.popup.postMessage).toHaveBeenCalledTimes(1);
    expect(page.window.open).toHaveBeenCalledTimes(1);
  });

  it('lets a user retry when the browser initially blocks the popup', async () => {
    const page = createPage();
    page.window.open.mockReturnValueOnce(null);
    page.start();
    expect(page.elements.get('continue').disabled).toBe(false);
    await page.message('cavalry-icloud-ready');
    expect(page.popup.postMessage).not.toHaveBeenCalled();
    await page.ready();
    expect(page.window.open).toHaveBeenCalledTimes(2);
    expect(page.popup.postMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['another window', { source: {} }],
    ['a missing source', { source: null }],
    ['a foreign origin', { origin: 'https://attacker.example' }],
    ['an origin suffix lookalike', { origin: `${BRIDGE_ORIGIN}.attacker.example` }],
    ['an insecure origin', { origin: 'http://juanm-builder.github.io' }],
    ['the loopback origin', { origin: 'http://127.0.0.1:47639' }],
    ['an opaque origin', { origin: 'null' }],
    ['an old nonce', { data: { nonce: 'b4'.repeat(32) } }],
    ['a missing nonce', { data: { nonce: undefined } }]
  ])('ignores ready, completion and cancellation from %s', async (_name, overrides) => {
    const page = createPage();
    page.start();
    await page.message('cavalry-icloud-ready', overrides);
    await page.message('cavalry-icloud-cancel', overrides);
    expect(page.popup.postMessage).not.toHaveBeenCalled();
    expect(page.fetch).not.toHaveBeenCalled();
    await page.message('cavalry-icloud-ready');
    await page.complete(TOKEN, overrides);
    await page.message('cavalry-icloud-cancel', overrides);
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.popup.close).not.toHaveBeenCalled();
    await page.complete();
    expect(page.fetch).toHaveBeenCalledTimes(1);
    expect(page.acknowledgements()).toHaveLength(1);
  });

  it('rejects malformed messages and tokens without consuming the valid attempt', async () => {
    const page = createPage();
    await page.ready();
    for (const data of [undefined, null, 'session', 42, {}, { ckSession: TOKEN }]) {
      await page.dispatch('message', { source: page.popup, origin: BRIDGE_ORIGIN, data });
    }
    for (const token of [
      '',
      null,
      42,
      {},
      ['session'],
      'a\rb',
      'a\nb',
      'a\0b',
      'x'.repeat(16385)
    ]) {
      await page.complete(token);
    }
    expect(page.fetch).not.toHaveBeenCalled();
    await page.complete('x'.repeat(16384));
    expect(page.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(page.fetch.mock.calls[0][1].body).token).toHaveLength(16384);
  });

  it('submits once and acknowledges only after the same-origin POST succeeds', async () => {
    let resolvePost;
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        })
    );
    const page = createPage({ fetch });
    await page.ready();
    const submitting = page.complete();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/complete/${NONCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN })
    });
    expect(page.acknowledgements()).toHaveLength(0);
    await page.complete('duplicate-session');
    expect(fetch).toHaveBeenCalledTimes(1);
    resolvePost({ ok: true });
    await submitting;
    expect(page.acknowledgements()).toEqual([
      [{ type: 'cavalry-icloud-received', nonce: NONCE }, BRIDGE_ORIGIN]
    ]);
    await page.complete('late-session');
    await page.message('cavalry-icloud-cancel');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(page.acknowledgements()).toHaveLength(1);
    expect(page.elements.get('cancel').hidden).toBe(true);
  });

  it.each(['http rejection', 'network failure'])('never acknowledges a %s', async (failure) => {
    const fetch = vi.fn();
    if (failure === 'http rejection') fetch.mockResolvedValue({ ok: false });
    else fetch.mockRejectedValue(new Error('unavailable'));
    const page = createPage({ fetch });
    await page.ready();
    await page.complete();
    expect(page.acknowledgements()).toHaveLength(0);
    expect(page.popup.close).toHaveBeenCalledTimes(1);
    expect(page.elements.get('cancel').disabled).toBe(true);
    await page.complete('late-session');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['local button', 'bridge message', 'expiry', 'pagehide', 'closed popup'])(
    'makes cancellation terminal after %s',
    async (trigger) => {
      const page = createPage();
      await page.ready();
      if (trigger === 'local button') page.cancel();
      else if (trigger === 'bridge message') await page.message('cavalry-icloud-cancel');
      else if (trigger === 'expiry') await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      else if (trigger === 'pagehide') await page.dispatch('pagehide');
      else {
        page.popup.closed = true;
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(page.fetch).toHaveBeenCalledExactlyOnceWith(`/cancel/${NONCE}`, { method: 'POST' });
      expect(page.popup.postMessage).toHaveBeenLastCalledWith(
        { type: 'cavalry-icloud-cancel', nonce: NONCE },
        BRIDGE_ORIGIN
      );
      expect(page.popup.close).toHaveBeenCalledTimes(1);
      expect(page.elements.get('continue').disabled).toBe(true);
      await page.message('cavalry-icloud-ready');
      await page.complete();
      page.start();
      page.cancel();
      expect(page.fetch).toHaveBeenCalledTimes(1);
      expect(page.window.open).toHaveBeenCalledTimes(1);
      expect(page.acknowledgements()).toHaveLength(0);
    }
  );

  it('does not revive a cancelled attempt when its pending POST later succeeds', async () => {
    let resolvePost;
    const fetch = vi.fn().mockImplementation((url) =>
      url.startsWith('/complete/')
        ? new Promise((resolve) => {
            resolvePost = resolve;
          })
        : Promise.resolve({ ok: true })
    );
    const page = createPage({ fetch });
    await page.ready();
    const submitting = page.complete();
    page.cancel();
    resolvePost({ ok: true });
    await submitting;
    expect(page.acknowledgements()).toHaveLength(0);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `/complete/${NONCE}`,
      `/cancel/${NONCE}`
    ]);
    expect(page.elements.get('cancel').hidden).toBe(false);
    expect(page.elements.get('cancel').disabled).toBe(true);
    expect(page.elements.get('status').textContent).toContain('may already have been received');
  });
});
