'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { ORIGIN, appleAuthenticationUrl, validSessionToken } = require('./cloudkit-web-api.cjs');

function browserPage({ nonce, redirectURL }) {
  const redirect = JSON.stringify(redirectURL).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Cavalry to iCloud</title>
<style nonce="${nonce}">body{color:#f4f5f7;background:#0d0e10;font:16px system-ui;max-width:540px;margin:12vh auto;padding:32px}h1{font-size:28px}p{line-height:1.6;color:#b9bec7}button{background:#8da2c6;color:#0d0e10;border:0;border-radius:8px;padding:14px 22px;font:600 16px system-ui;cursor:pointer}button:disabled{opacity:.6}a{color:#8da2c6}</style>
<h1>Choose your iCloud account</h1><p>Continue to Apple and choose the account Cavalry should use. This does not change the Apple Account on your Mac.</p><button id="continue">Continue to Apple</button><p id="status" role="status">Keep this page open until you return to Cavalry.</p><button id="cancel">Cancel</button>
<script nonce="${nonce}">
let popup = null, submitted = false;
const start = document.getElementById('continue'), status = document.getElementById('status');
start.onclick = () => { popup = window.open(${redirect}, 'cavalry-icloud-${nonce}', 'popup,width=620,height=740'); if(!popup) status.textContent='Allow this page to open Apple’s sign-in window, then try again.'; };
window.addEventListener('message', async event => {
  if(submitted || !popup || event.source !== popup || !['https://idmsa.apple.com','https://appleid.apple.com','https://account.apple.com','https://www.icloud.com','https://icloud.com','https://api.apple-cloudkit.com'].includes(event.origin)) return;
  const token = event.data && (event.data.ckWebAuthToken || event.data.ckSession);
  if(typeof token !== 'string' || !token || token.length > 16384) return;
  submitted = true; start.disabled = true; status.textContent='Checking your selected iCloud account…';
  try { const response = await fetch('/complete/${nonce}', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}); if(!response.ok) throw new Error(); status.textContent='Sign-in received. Return to Cavalry to finish checking your library.'; if(popup) popup.close(); document.getElementById('cancel').hidden=true; }
  catch { status.textContent='Cavalry could not receive the sign-in. Return to the app and try again.'; }
});
document.getElementById('cancel').onclick = async () => { await fetch('/cancel/${nonce}', {method:'POST'}).catch(()=>{}); if(popup) popup.close(); status.textContent='Cancelled. Your existing Cavalry library has not changed.'; start.disabled=true; };
</script></html>`;
}

// A loopback-only bridge keeps Apple's bearer token out of the renderer, custom
// URL handlers, logs and callback query strings. The browser additionally binds
// Apple's response to the exact popup it opened and a known Apple origin.
async function authenticateInBrowser({
  redirectURL,
  openExternal,
  timeoutMs = 5 * 60 * 1000,
  port = 47639,
  signal
}) {
  const appleURL = appleAuthenticationUrl(redirectURL);
  if (!appleURL) throw new Error('Apple did not return a trusted iCloud sign-in address.');
  if (port !== 47639) throw new Error('The iCloud browser callback port is invalid.');
  const nonce = crypto.randomBytes(32).toString('hex');
  let settle;
  let timer;
  let finished = false;
  const answer = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const cancel = () => {
    finished = true;
    settle.resolve(null);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  // Binding/opening errors can happen before the caller awaits this promise.
  void answer.catch(() => undefined);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
    );
    if (request.headers.host !== '127.0.0.1:47639') {
      response.writeHead(403).end();
      return;
    }
    if (request.method === 'GET' && request.url === `/start/${nonce}` && !finished) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(browserPage({ nonce, redirectURL: appleURL }));
      return;
    }
    if (request.method !== 'POST' || request.headers.origin !== ORIGIN || finished) {
      response.writeHead(403).end();
      return;
    }
    if (request.url === `/cancel/${nonce}`) {
      finished = true;
      response.end('Cancelled', () => settle.resolve(null));
      return;
    }
    if (
      request.url !== `/complete/${nonce}` ||
      request.headers['content-type'] !== 'application/json'
    ) {
      response.writeHead(403).end();
      return;
    }
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 20000) throw new Error('size');
        chunks.push(chunk);
      }
      const { token } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!validSessionToken(token)) throw new Error('token');
      finished = true;
      response.end('Received', () => settle.resolve(token));
    } catch (_error) {
      response.writeHead(400).end('Invalid sign-in response');
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  try {
    if (signal?.aborted) return null;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    timer = setTimeout(() => {
      finished = true;
      settle.reject(new Error('Apple sign-in timed out. Your existing library has not changed.'));
    }, timeoutMs);
    timer.unref?.();
    await openExternal(`${ORIGIN}/start/${nonce}`);
    return await answer;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { authenticateInBrowser, browserPage };
