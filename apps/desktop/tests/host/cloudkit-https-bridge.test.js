import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Keep the same protocol tests available to the repository suite and the small
// standalone check used when publishing these static assets.
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
const script = readFileSync(new URL('../../cloudkit-sign-in/bridge.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../cloudkit-sign-in/index.html', import.meta.url), 'utf8');
const LOCAL_ORIGIN = 'http://127.0.0.1:47639';
const NONCE = 'ab'.repeat(32);
const APPLE_URL = 'https://idmsa.apple.com/signin?request=example';

function page(options = {}) {
  const outgoing = [];
  const order = [];
  const opened = [];
  const events = new Map();
  const timers = new Map();
  const intervals = new Map();
  const elements = Object.fromEntries(
    ['continue', 'cancel', 'status'].map((id) => [
      id,
      {
        disabled: true,
        textContent: '',
        listeners: new Map(),
        addEventListener(type, handler) {
          this.listeners.set(type, handler);
        }
      }
    ])
  );
  const opener = {
    postMessage(data, origin) {
      order.push('post');
      outgoing.push({ data: JSON.parse(JSON.stringify(data)), origin });
    }
  };
  const popup = {
    closed: false,
    closeCount: 0,
    close() {
      this.closed = true;
      this.closeCount += 1;
    }
  };
  const window = {
    opener: options.noOpener ? null : opener,
    location: new URL(
      `https://juanm-builder.github.io/Cavalry/icloud-sign-in/#${options.nonce ?? NONCE}`
    ),
    history: {
      replaceState(_state, _title, url) {
        order.push('remove-fragment');
        if (options.historyFailure) throw new Error('History unavailable');
        window.location = new URL(url, window.location);
      }
    },
    addEventListener(type, handler) {
      events.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (events.get(type) === handler) events.delete(type);
    },
    open(...args) {
      opened.push(args);
      if (options.blockPopup) return null;
      if (options.throwPopup) throw new Error('Popup unavailable');
      return popup;
    }
  };
  window.self = window;
  window.top = options.framed ? {} : window;
  let timerID = 0;
  vm.runInNewContext(script, {
    window,
    document: { getElementById: (id) => elements[id] },
    URL,
    setTimeout(callback, delay) {
      const id = ++timerID;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(callback, delay) {
      const id = ++timerID;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    }
  });
  const result = {
    window,
    opener,
    popup,
    elements,
    outgoing,
    opened,
    order,
    timers,
    intervals,
    events,
    message(data, origin = LOCAL_ORIGIN, source = opener) {
      events.get('message')?.({ data, origin, source });
    },
    click(id) {
      // Invoke even disabled controls to check the state guard against queued
      // clicks or stale event dispatch, rather than relying only on the DOM.
      elements[id].listeners.get('click')?.();
    },
    init(overrides = {}) {
      result.message({
        type: 'cavalry-icloud-start',
        nonce: NONCE,
        redirectURL: APPLE_URL,
        ...overrides
      });
    },
    apple(data = { ckSession: 'example-session' }, origin = 'https://api.apple-cloudkit.com') {
      result.message(data, origin, popup);
    }
  };
  return result;
}

test('removes the nonce fragment before a ready message to the exact local opener', () => {
  const bridge = page();
  assert.equal(bridge.window.location.hash, '');
  assert.deepEqual(bridge.order, ['remove-fragment', 'post']);
  assert.deepEqual(bridge.outgoing, [
    { data: { type: 'cavalry-icloud-ready', nonce: NONCE }, origin: LOCAL_ORIGIN }
  ]);
  assert.equal(bridge.elements.continue.disabled, true);
  assert.equal(bridge.elements.cancel.disabled, false);
  assert.deepEqual(
    [...bridge.timers.values()].map(({ delay }) => delay),
    [300000]
  );
  assert.equal(bridge.opened.length, 0);
});

test('rejects missing, malformed or framed requests without creating a session', () => {
  for (const options of [
    { nonce: '' },
    { nonce: 'ab'.repeat(31) },
    { nonce: 'ab'.repeat(33) },
    { nonce: NONCE.toUpperCase() },
    { nonce: `${NONCE}?extra` },
    { nonce: `%61${NONCE.slice(1)}` },
    { nonce: `${NONCE}%0A` },
    { framed: true },
    { noOpener: true },
    { historyFailure: true }
  ]) {
    const bridge = page(options);
    bridge.init();
    bridge.click('continue');
    assert.equal(bridge.outgoing.length, 0, JSON.stringify(options));
    assert.equal(bridge.opened.length, 0);
    assert.equal(bridge.timers.size, 0);
    assert.equal(bridge.elements.continue.disabled, true);
    assert.equal(bridge.elements.cancel.disabled, true);
  }
});

test('accepts initialization only from the original opener, exact origin and nonce', () => {
  const bridge = page();
  const init = { type: 'cavalry-icloud-start', nonce: NONCE, redirectURL: APPLE_URL };
  bridge.message(init, 'http://localhost:47639');
  bridge.message(init, 'http://127.0.0.1:47640');
  bridge.message(init, 'https://127.0.0.1:47639');
  bridge.message(init, 'https://attacker.example');
  bridge.message(init, LOCAL_ORIGIN, {});
  bridge.message({ ...init, nonce: 'cd'.repeat(32) });
  bridge.message({ ...init, type: 'start' });
  bridge.window.opener = {};
  bridge.message(init, LOCAL_ORIGIN, bridge.window.opener);
  bridge.message(null);
  bridge.message('cavalry-icloud-start');
  bridge.click('continue');
  assert.equal(bridge.opened.length, 0);
  bridge.message(init);
  bridge.click('continue');
  assert.equal(bridge.opened[0][0], APPLE_URL);
});

test('rejects redirect URLs outside the native Apple authentication allowlist', () => {
  const credentials = new URL(APPLE_URL);
  credentials.username = 'test-user';
  credentials.password = 'test-password';
  for (const redirectURL of [
    null,
    {},
    'not a URL',
    'http://idmsa.apple.com/signin',
    'https://idmsa.apple.com.attacker.example/signin',
    'https://attacker.example/idmsa.apple.com',
    'https://api.apple-cloudkit.com/signin',
    'https://idmsa.apple.com:8443/signin',
    credentials.href,
    'javascript:alert(1)',
    `https://idmsa.apple.com/${'x'.repeat(32768)}`
  ]) {
    const bridge = page();
    bridge.init({ redirectURL });
    bridge.click('continue');
    assert.equal(bridge.elements.continue.disabled, true);
    assert.equal(bridge.opened.length, 0);
  }
});

test('accepts each native Apple authentication host without automatically opening a popup', () => {
  for (const host of [
    'idmsa.apple.com',
    'appleid.apple.com',
    'account.apple.com',
    'www.icloud.com',
    'icloud.com'
  ]) {
    const bridge = page();
    bridge.init({ redirectURL: `https://${host}/signin` });
    assert.equal(bridge.elements.continue.disabled, false);
    assert.equal(bridge.opened.length, 0);
    bridge.click('continue');
    assert.equal(bridge.opened[0][0], `https://${host}/signin`);
  }
});

test('initialization is immutable and successful popup opening consumes the Continue action', () => {
  const bridge = page();
  bridge.init();
  bridge.init({ redirectURL: 'https://account.apple.com/different-signin' });
  bridge.click('continue');
  bridge.init({ redirectURL: 'https://icloud.com/another-signin' });
  bridge.click('continue');
  assert.equal(bridge.opened.length, 1);
  assert.equal(bridge.opened[0][0], APPLE_URL);
  assert.equal(bridge.opened[0][1], `cavalry-icloud-apple-${NONCE}`);
  assert.notEqual(bridge.opened[0][1], `cavalry-icloud-${NONCE}`);
  assert.equal(bridge.elements.continue.disabled, true);
});

test('a blocked popup can retry, keeping the initial validated redirect', () => {
  const options = { blockPopup: true };
  const bridge = page(options);
  bridge.init();
  bridge.click('continue');
  assert.match(bridge.elements.status.textContent, /Allow this page/);
  assert.equal(bridge.elements.continue.disabled, false);
  bridge.apple();
  assert.equal(bridge.outgoing.length, 1);
  options.blockPopup = false;
  bridge.click('continue');
  bridge.apple();
  assert.equal(bridge.outgoing[1].data.type, 'cavalry-icloud-complete');
});

test('tokens require both the actual Apple popup and an exact trusted Apple origin', () => {
  const bridge = page();
  bridge.init();
  bridge.apple();
  bridge.click('continue');
  for (const origin of [
    'null',
    'http://idmsa.apple.com',
    'https://idmsa.apple.com:8443',
    'https://idmsa.apple.com.attacker.example',
    LOCAL_ORIGIN
  ]) {
    bridge.apple({ ckSession: 'example-session' }, origin);
  }
  bridge.message({ ckSession: 'example-session' }, 'https://idmsa.apple.com', {});
  bridge.message({ ckSession: 'example-session' }, 'https://idmsa.apple.com', bridge.opener);
  assert.equal(bridge.outgoing.length, 1);
  bridge.apple();
  assert.equal(bridge.outgoing[1].data.type, 'cavalry-icloud-complete');
});

test('each trusted Apple origin can return either documented token field', () => {
  for (const origin of [
    'https://idmsa.apple.com',
    'https://appleid.apple.com',
    'https://account.apple.com',
    'https://www.icloud.com',
    'https://icloud.com',
    'https://api.apple-cloudkit.com'
  ]) {
    for (const field of ['ckSession', 'ckWebAuthToken']) {
      const bridge = page();
      bridge.init();
      bridge.click('continue');
      bridge.apple({ [field]: 'example-session' }, origin);
      assert.deepEqual(bridge.outgoing[1], {
        data: { type: 'cavalry-icloud-complete', nonce: NONCE, token: 'example-session' },
        origin: LOCAL_ORIGIN
      });
    }
  }
});

test('invalid or oversized tokens are rejected before a single bounded relay', () => {
  const bridge = page();
  bridge.init();
  bridge.click('continue');
  for (const token of ['', null, {}, 123, 'a\rb', 'a\nb', 'a\0b', 'x'.repeat(16385)]) {
    bridge.apple({ ckSession: token });
  }
  assert.equal(bridge.outgoing.length, 1);
  bridge.apple({ ckSession: 'x'.repeat(16384) });
  bridge.apple({ ckSession: 'second-session' });
  bridge.click('cancel');
  bridge.click('continue');
  assert.equal(bridge.outgoing.length, 2);
  assert.equal(bridge.outgoing[1].data.token.length, 16384);
  assert.equal(bridge.opened.length, 1);
  assert.equal(bridge.elements.cancel.disabled, true);
  assert.equal(bridge.popup.closeCount, 0);
});

test('only a matching local acknowledgment completes a submitted sign-in', () => {
  const bridge = page();
  const ack = { type: 'cavalry-icloud-received', nonce: NONCE };
  bridge.message(ack);
  assert.equal(bridge.events.has('message'), true);
  bridge.init();
  bridge.click('continue');
  bridge.apple();
  bridge.message(ack, 'https://attacker.example');
  bridge.message(ack, LOCAL_ORIGIN, {});
  bridge.message({ ...ack, nonce: 'cd'.repeat(32) });
  assert.equal(bridge.popup.closeCount, 0);
  bridge.message(ack);
  assert.equal(bridge.popup.closeCount, 1);
  assert.match(bridge.elements.status.textContent, /Sign-in received/);
  assert.equal(bridge.timers.size, 0);
  assert.equal(bridge.intervals.size, 0);
  assert.equal(bridge.events.size, 0);
  bridge.init();
  bridge.click('continue');
  bridge.apple();
  assert.equal(bridge.outgoing.length, 2);
  assert.equal(bridge.opened.length, 1);
});

test('cancel is terminal before initialization and while waiting for Apple', () => {
  for (const withPopup of [false, true]) {
    const bridge = page();
    if (withPopup) {
      bridge.init();
      bridge.click('continue');
    }
    bridge.click('cancel');
    bridge.click('cancel');
    bridge.init();
    bridge.click('continue');
    bridge.apple();
    assert.deepEqual(bridge.outgoing[1], {
      data: { type: 'cavalry-icloud-cancel', nonce: NONCE },
      origin: LOCAL_ORIGIN
    });
    assert.equal(bridge.outgoing.length, 2);
    assert.equal(bridge.opened.length, withPopup ? 1 : 0);
    assert.equal(bridge.popup.closeCount, withPopup ? 1 : 0);
    assert.equal(bridge.timers.size, 0);
    assert.equal(bridge.events.size, 0);
  }
});

test('only the original local opener can cancel, including a submitted sign-in', () => {
  for (const submitted of [false, true]) {
    const bridge = page();
    bridge.init();
    bridge.click('continue');
    const cancel = { type: 'cavalry-icloud-cancel', nonce: NONCE };
    bridge.message(cancel, 'https://attacker.example');
    bridge.message(cancel, LOCAL_ORIGIN, {});
    bridge.message({ ...cancel, nonce: 'cd'.repeat(32) });
    assert.equal(bridge.popup.closeCount, 0);
    if (submitted) bridge.apple();
    const lateHandler = bridge.events.get('message');
    bridge.message(cancel);
    assert.equal(bridge.popup.closeCount, 1);
    assert.match(bridge.elements.status.textContent, /cancelled/);
    assert.equal(bridge.timers.size, 0);
    assert.equal(bridge.intervals.size, 0);
    assert.equal(bridge.events.size, 0);
    lateHandler({
      data: { type: 'cavalry-icloud-received', nonce: NONCE },
      source: bridge.opener,
      origin: LOCAL_ORIGIN
    });
    bridge.apple();
    bridge.init();
    bridge.click('continue');
    assert.match(bridge.elements.status.textContent, /cancelled/);
    assert.equal(bridge.outgoing.length, submitted ? 2 : 1);
    assert.equal(bridge.opened.length, 1);
  }
});

test('expiry closes and invalidates a request even if Apple later sends a token', () => {
  const bridge = page();
  bridge.init();
  bridge.click('continue');
  const lateAppleHandler = bridge.events.get('message');
  [...bridge.timers.values()][0].callback();
  lateAppleHandler({
    data: { ckSession: 'late-session' },
    source: bridge.popup,
    origin: 'https://api.apple-cloudkit.com'
  });
  bridge.init();
  bridge.click('continue');
  assert.equal(bridge.outgoing.length, 2);
  assert.equal(bridge.outgoing[1].data.type, 'cavalry-icloud-cancel');
  assert.equal(bridge.popup.closeCount, 1);
  assert.equal(bridge.elements.continue.disabled, true);
  assert.equal(bridge.elements.cancel.disabled, true);
  assert.match(bridge.elements.status.textContent, /timed out/);
});

test('an unacknowledged submission times out without claiming it was received or cancelled', () => {
  const bridge = page();
  bridge.init();
  bridge.click('continue');
  bridge.apple();
  [...bridge.timers.values()][0].callback();
  bridge.message({ type: 'cavalry-icloud-received', nonce: NONCE });
  assert.equal(bridge.outgoing.length, 2);
  assert.match(bridge.elements.status.textContent, /check your account/);
  assert.equal(bridge.popup.closeCount, 1);
  assert.equal(bridge.events.size, 0);
});

test('closing Apple before submitting or leaving the bridge invalidates pending callbacks', () => {
  for (const operation of ['close-apple', 'leave-page']) {
    const bridge = page();
    bridge.init();
    bridge.click('continue');
    if (operation === 'close-apple') {
      bridge.popup.closed = true;
      [...bridge.intervals.values()][0].callback();
    } else {
      bridge.events.get('pagehide')();
    }
    bridge.apple();
    bridge.click('continue');
    assert.equal(bridge.outgoing.length, 2);
    assert.equal(bridge.outgoing[1].data.type, 'cavalry-icloud-cancel');
    assert.equal(bridge.opened.length, 1);
    assert.equal(bridge.intervals.size, 0);
    assert.equal(bridge.events.size, 0);
  }
});

test('the static document permits only its own script and stylesheet with no fetch or referrer', () => {
  assert.match(html, /name="referrer" content="no-referrer"/);
  for (const directive of [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ]) {
    assert.ok(html.includes(directive), directive);
  }
  assert.doesNotMatch(html, /unsafe-inline|<style\b|<iframe\b|<form\b/i);
  assert.match(html, /<script src="\.\/bridge\.js" defer><\/script>/);
  assert.doesNotMatch(
    script,
    /\bfetch\s*\(|\blocalStorage\b|\bsessionStorage\b|\bdocument\.cookie\b/
  );
});
