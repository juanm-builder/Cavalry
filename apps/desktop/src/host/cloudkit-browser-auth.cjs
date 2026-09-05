'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const {
  LOOPBACK_ORIGIN,
  CLOUDKIT_WEB_ORIGIN,
  CLOUDKIT_SIGN_IN_URL,
  appleAuthenticationUrl,
  validSessionToken
} = require('./cloudkit-web-api.cjs');

function browserPage({ nonce, redirectURL }) {
  const redirect = JSON.stringify(redirectURL).replace(/</g, '\\u003c');
  const bridgeOrigin = JSON.stringify(CLOUDKIT_WEB_ORIGIN);
  const bridgeURL = JSON.stringify(`${CLOUDKIT_SIGN_IN_URL}#${nonce}`);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Cavalry to iCloud</title>
<style nonce="${nonce}">body{color:#f4f5f7;background:#0d0e10;font:16px system-ui;max-width:540px;margin:12vh auto;padding:32px}h1{font-size:28px}p{line-height:1.6;color:#b9bec7}button{background:#8da2c6;color:#0d0e10;border:0;border-radius:8px;padding:14px 22px;font:600 16px system-ui;cursor:pointer}button:disabled{opacity:.6}a{color:#8da2c6}</style>
<h1>Choose your iCloud account</h1><p>Open Cavalry’s secure sign-in page to choose the account Cavalry should use. This does not change the Apple Account on your Mac.</p><button id="continue">Open secure sign-in</button><p id="status" role="status">Keep this page open until you return to Cavalry.</p><button id="cancel">Cancel</button>
<script nonce="${nonce}">
let popup = null, phase = 'idle';
const nonce = '${nonce}', bridgeOrigin = ${bridgeOrigin};
const start = document.getElementById('continue'), status = document.getElementById('status');
const cancelButton = document.getElementById('cancel');
function closePopup() { try { if(popup) popup.close(); } catch {} }
function cancel(message) {
  if(phase === 'done' || phase === 'cancelled') return;
  const mayHaveBeenReceived = phase === 'submitting';
  phase = 'cancelled'; start.disabled = true; cancelButton.disabled = true;
  try { if(popup) popup.postMessage({type:'cavalry-icloud-cancel',nonce}, bridgeOrigin); } catch {}
  closePopup(); status.textContent = mayHaveBeenReceived
    ? 'Sign-in may already have been received. Return to Cavalry to check your account.'
    : message;
  void fetch('/cancel/' + nonce, {method:'POST'}).catch(()=>{});
}
start.onclick = () => {
  if(phase !== 'idle') return;
  popup = window.open(${bridgeURL}, 'cavalry-icloud-${nonce}', 'popup,width=620,height=740');
  if(!popup) { status.textContent='Allow this page to open Cavalry’s sign-in window, then try again.'; return; }
  phase = 'waiting'; start.disabled = true;
  status.textContent='Continue in Cavalry’s secure sign-in window.';
};
window.addEventListener('message', async event => {
  if(!popup || event.source !== popup || event.origin !== bridgeOrigin ||
     !event.data || event.data.nonce !== nonce) return;
  const data = event.data;
  if(data.type === 'cavalry-icloud-ready' && phase === 'waiting') {
    phase = 'authenticating';
    popup.postMessage({type:'cavalry-icloud-start',nonce,redirectURL:${redirect}}, bridgeOrigin);
    return;
  }
  if(data.type === 'cavalry-icloud-cancel') {
    cancel('Cancelled. Your existing Cavalry library has not changed.'); return;
  }
  if(data.type !== 'cavalry-icloud-complete' || phase !== 'authenticating') return;
  const token = data.token;
  if(typeof token !== 'string' || !token || token.length > 16384 || /[\\r\\n\\0]/.test(token)) return;
  phase = 'submitting'; cancelButton.disabled = true;
  status.textContent='Checking your selected iCloud account…';
  try {
    const response = await fetch('/complete/' + nonce, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    if(phase !== 'submitting') return;
    if(!response.ok) throw new Error();
    phase = 'done';
    popup.postMessage({type:'cavalry-icloud-received',nonce}, bridgeOrigin);
    status.textContent='Sign-in received. Return to Cavalry to finish checking your library.';
    cancelButton.hidden = true;
  } catch {
    if(phase !== 'submitting') return;
    phase = 'cancelled'; closePopup();
    status.textContent='Cavalry could not receive the sign-in. Return to the app and try again.';
    cancelButton.disabled = true;
  }
});
cancelButton.onclick = () => cancel('Cancelled. Your existing Cavalry library has not changed.');
setTimeout(() => cancel('Sign-in expired. Return to Cavalry and try again.'), 5 * 60 * 1000);
setInterval(() => {
  if((phase === 'waiting' || phase === 'authenticating') && popup && popup.closed)
    cancel('Sign-in closed. Return to Cavalry and try again.');
}, 500);
window.addEventListener('pagehide', () => cancel('Sign-in closed.'));
</script></html>`;
}

// The HTTPS bridge receives Apple's popup callback, then hands it to this exact
// loopback opener using source/origin/nonce-bound messages. A same-origin POST
// keeps bearer tokens out of the renderer, URLs, hosted servers and app logs.
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
    if (request.method !== 'POST' || request.headers.origin !== LOOPBACK_ORIGIN || finished) {
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
    await openExternal(`${LOOPBACK_ORIGIN}/start/${nonce}`);
    return await answer;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { authenticateInBrowser, browserPage };
