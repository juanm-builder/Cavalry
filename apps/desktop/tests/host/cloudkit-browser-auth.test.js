import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { authenticateInBrowser } = require('../../src/host/cloudkit-browser-auth.cjs');
const ORIGIN = 'http://127.0.0.1:47639';
const pendingControllers = [];

function startAuthentication(overrides = {}) {
  const controller = new AbortController();
  pendingControllers.push(controller);
  let reportOpened;
  const opened = new Promise((resolve) => {
    reportOpened = resolve;
  });
  const result = authenticateInBrowser({
    redirectURL: 'https://idmsa.apple.com/signin?test=1',
    signal: controller.signal,
    openExternal: async (url) => reportOpened(url),
    ...overrides
  });
  return { controller, opened, result };
}

function submit(
  startUrl,
  {
    origin = ORIGIN,
    method = 'POST',
    suffix,
    body = { token: 'example-apple-session' },
    headers = {}
  } = {}
) {
  const target = new URL(startUrl);
  target.pathname = suffix || target.pathname.replace('/start/', '/complete/');
  return fetch(target, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) })
  });
}

afterEach(() => {
  for (const controller of pendingControllers.splice(0)) controller.abort();
});

describe('iCloud browser authentication loopback', () => {
  it('accepts a token only through a nonce-bound same-origin POST and closes the listener', async () => {
    const auth = startAuthentication();
    const url = await auth.opened;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:47639\/start\/[a-f0-9]{64}$/);
    const page = await fetch(url);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const html = await page.text();
    expect(html).toContain('event.source !== popup');
    expect(html).toContain('https://juanm-builder.github.io/Cavalry/icloud-sign-in/');
    expect(html).toContain('cavalry-icloud-complete');
    expect(html).not.toContain('example-apple-session');
    const accepted = await submit(url);
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toBe('Received');
    expect(await auth.result).toBe('example-apple-session');
    await expect(fetch(url)).rejects.toThrow();
  });

  it('rejects unrelated origins, nonce paths, hosts and GET callbacks without completing sign-in', async () => {
    const auth = startAuthentication();
    const url = await auth.opened;
    for (const options of [
      { origin: 'https://attacker.example' },
      { origin: '' },
      { suffix: '/complete/wrong-nonce' },
      { method: 'GET' },
      { headers: { 'Content-Type': 'text/plain' } }
    ]) {
      const rejected = await submit(url, options);
      expect(rejected.status, JSON.stringify(options)).toBe(403);
      await rejected.text();
    }
    // Node fetch supplies its own Host. Use an HTTP request to test rebinding.
    const wrongHost = await new Promise((resolve, reject) => {
      const request = http.request(
        url.replace('/start/', '/complete/'),
        {
          method: 'POST',
          headers: { Host: 'localhost:47639', Origin: ORIGIN, 'Content-Type': 'application/json' }
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        }
      );
      request.on('error', reject);
      request.end(JSON.stringify({ token: 'untrusted-host' }));
    });
    expect(wrongHost).toBe(403);
    expect((await submit(url)).status).toBe(200);
    expect(await auth.result).toBe('example-apple-session');
  });

  it('propagates opt-in callback diagnostics only into the fixed HTTPS bridge page', async () => {
    const auth = startAuthentication({ diagnostics: true });
    const url = await auth.opened;
    expect(url).not.toContain('diagnostics');
    const html = await (await fetch(url)).text();
    expect(html).toContain(
      'https://juanm-builder.github.io/Cavalry/icloud-sign-in/?v=2&diagnostics=1#'
    );
    expect(html).toContain('const diagnosticsEnabled = true;');
    expect((await submit(url)).status).toBe(200);
    expect(await auth.result).toBe('example-apple-session');
  });

  it('rejects invalid token values while leaving the sign-in available for a valid response', async () => {
    const auth = startAuthentication();
    const url = await auth.opened;
    for (const token of ['', null, 'contains\nnewline', 'x'.repeat(16385)]) {
      const rejected = await submit(url, { body: { token } });
      expect(rejected.status).toBe(400);
      await rejected.text();
    }
    expect((await submit(url)).status).toBe(200);
    expect(await auth.result).toBe('example-apple-session');
  });

  it('cancels from the browser without returning or retaining an authentication token', async () => {
    const auth = startAuthentication();
    const url = await auth.opened;
    const response = await submit(url, {
      suffix: new URL(url).pathname.replace('/start/', '/cancel/')
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Cancelled');
    expect(await auth.result).toBe(null);
  });

  it('cancels from the app and frees the fixed callback port for a later attempt', async () => {
    const first = startAuthentication();
    await first.opened;
    first.controller.abort();
    expect(await first.result).toBe(null);
    const second = startAuthentication();
    expect((await submit(await second.opened)).status).toBe(200);
    expect(await second.result).toBe('example-apple-session');
  });

  it('fails closed when another process owns the callback port', async () => {
    const blocker = http.createServer();
    await new Promise((resolve) => blocker.listen(47639, '127.0.0.1', resolve));
    try {
      await expect(startAuthentication().result).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it('rejects non-Apple redirects before opening a browser', async () => {
    let opened = false;
    await expect(
      authenticateInBrowser({
        redirectURL: 'https://appleid.apple.com.attacker.example/signin',
        openExternal: async () => {
          opened = true;
        }
      })
    ).rejects.toThrow('trusted iCloud sign-in address');
    expect(opened).toBe(false);
  });
});
