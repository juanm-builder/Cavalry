(() => {
  'use strict';

  const LOCAL_ORIGIN = 'http://127.0.0.1:47639';
  const APPLE_AUTH_HOSTS = [
    'idmsa.apple.com',
    'appleid.apple.com',
    'account.apple.com',
    'www.icloud.com',
    'icloud.com'
  ];
  const APPLE_CALLBACK_ORIGINS = [
    ...APPLE_AUTH_HOSTS.map((host) => `https://${host}`),
    'https://api.apple-cloudkit.com',
    'https://cdn.apple-cloudkit.com'
  ];
  const start = document.getElementById('continue');
  const cancel = document.getElementById('cancel');
  const status = document.getElementById('status');
  const diagnosticReport = document.getElementById('diagnostics');
  const diagnosticParameters = new URL(window.location.href).searchParams;
  const diagnosticsEnabled =
    diagnosticParameters.getAll('diagnostics').length === 1 &&
    diagnosticParameters.get('diagnostics') === '1';
  const diagnosticRecords = [];
  const originalOpener = window.opener;
  let nonce = window.location.hash.slice(1);
  let redirectURL = '';
  let applePopup = null;
  let phase = 'initializing';
  let timeout;
  let popupCheck;

  // The fragment is a one-time request identifier, never an Apple credential.
  // Remove it before exchanging any messages or opening Apple's sign-in page.
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    nonce = '';
  }

  if (
    nonce.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(nonce) ||
    window.top !== window.self ||
    !originalOpener
  ) {
    nonce = '';
    status.textContent = 'Open sign-in from Cavalry to connect your iCloud account.';
    return;
  }

  function post(type, extra = {}) {
    originalOpener.postMessage({ type, nonce, ...extra }, LOCAL_ORIGIN);
  }

  function closeApplePopup() {
    try {
      applePopup?.close();
    } catch {
      // A browser can revoke access after the Apple window has closed.
    }
    applePopup = null;
  }

  function finish(message) {
    phase = 'finished';
    start.disabled = true;
    cancel.disabled = true;
    redirectURL = '';
    nonce = '';
    clearTimeout(timeout);
    clearInterval(popupCheck);
    closeApplePopup();
    window.removeEventListener('message', receiveMessage);
    window.removeEventListener('pagehide', leavingPage);
    status.textContent = message;
  }

  function trustedAppleURL(value) {
    if (typeof value !== 'string' || value.length > 32768) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' &&
        APPLE_AUTH_HOSTS.includes(url.hostname) &&
        !url.port &&
        !url.username &&
        !url.password
        ? url.href
        : '';
    } catch {
      return '';
    }
  }

  function recordDiagnostic(event) {
    if (!diagnosticsEnabled || phase !== 'waiting-for-apple') return;
    // Inspect only field presence and shape. Never copy a callback payload,
    // credential, error text or account identity into this optional report.
    try {
      let origin = 'unavailable';
      if (typeof event.origin === 'string' && event.origin.length <= 256) {
        try {
          const parsed = new URL(event.origin);
          if (
            (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
            parsed.origin.length <= 256
          )
            origin = parsed.origin;
        } catch {
          // Opaque or malformed origins are represented by a fixed label.
        }
      }
      const data = event.data;
      const descriptor = (field) =>
        data && typeof data === 'object' ? Object.getOwnPropertyDescriptor(data, field) : undefined;
      const valid = (field) => {
        const value = descriptor(field)?.value;
        return (
          typeof value === 'string' &&
          value.length > 0 &&
          value.length <= 16384 &&
          !/[\r\n\0]/.test(value)
        );
      };
      const diagnostic = {
        origin,
        expectedPopup: Boolean(applePopup && event.source === applePopup),
        dataType: typeof data,
        ckSessionPresent: Boolean(descriptor('ckSession')),
        ckSessionValid: valid('ckSession'),
        ckWebAuthTokenPresent: Boolean(descriptor('ckWebAuthToken')),
        ckWebAuthTokenValid: valid('ckWebAuthToken'),
        errorMessagePresent: Boolean(descriptor('errorMessage')),
        errorCodePresent: Boolean(descriptor('errorCode'))
      };
      const description = JSON.stringify(diagnostic);
      if (diagnosticRecords.at(-1) === description) return;
      diagnosticRecords.push(description);
      if (diagnosticRecords.length > 20) diagnosticRecords.shift();
      diagnosticReport.hidden = false;
      diagnosticReport.textContent =
        'Sign-in callback diagnostics (metadata only):\n' + diagnosticRecords.join('\n');
      post('cavalry-icloud-diagnostic', { diagnostic });
    } catch {
      // Optional diagnostics must never affect authentication or rejection.
    }
  }

  function receiveMessage(event) {
    recordDiagnostic(event);
    const data = event.data;
    if (!data || typeof data !== 'object' || phase === 'finished') return;

    if (event.source === originalOpener && event.origin === LOCAL_ORIGIN && data.nonce === nonce) {
      if (data.type === 'cavalry-icloud-cancel') {
        finish('Sign-in cancelled. Return to Cavalry.');
      } else if (data.type === 'cavalry-icloud-start' && phase === 'initializing') {
        const validatedURL = trustedAppleURL(data.redirectURL);
        if (!validatedURL) return;
        redirectURL = validatedURL;
        phase = 'ready';
        start.disabled = false;
        status.textContent = 'Continue to Apple to choose the account for your Cavalry workbooks.';
      } else if (data.type === 'cavalry-icloud-received' && phase === 'submitted') {
        finish('Sign-in received. Return to Cavalry to finish checking your library.');
      }
      return;
    }

    if (
      phase !== 'waiting-for-apple' ||
      !applePopup ||
      event.source !== applePopup ||
      !APPLE_CALLBACK_ORIGINS.includes(event.origin)
    ) {
      return;
    }
    const token = data.ckWebAuthToken || data.ckSession;
    if (typeof token !== 'string' || !token || token.length > 16384 || /[\r\n\0]/.test(token)) {
      return;
    }
    phase = 'submitted';
    redirectURL = '';
    start.disabled = true;
    cancel.disabled = true;
    status.textContent = 'Sending your sign-in to Cavalry…';
    post('cavalry-icloud-complete', { token });
  }

  function leavingPage() {
    if (phase !== 'finished' && phase !== 'submitted') post('cavalry-icloud-cancel');
    finish('Return to Cavalry to continue.');
  }

  start.addEventListener('click', () => {
    if (phase !== 'ready') return;
    try {
      applePopup = window.open(
        redirectURL,
        `cavalry-icloud-apple-${nonce}`,
        'popup,width=620,height=740'
      );
    } catch {
      applePopup = null;
    }
    if (!applePopup) {
      status.textContent = 'Allow this page to open Apple’s sign-in window, then try again.';
      return;
    }
    phase = 'waiting-for-apple';
    start.disabled = true;
    status.textContent = 'Complete sign-in in the Apple window. You can return here to cancel.';
    popupCheck = setInterval(() => {
      if (phase === 'waiting-for-apple' && applePopup?.closed) {
        post('cavalry-icloud-cancel');
        finish('The Apple sign-in window closed. Return to Cavalry to try again.');
      }
    }, 500);
  });

  cancel.addEventListener('click', () => {
    if (phase === 'finished' || phase === 'submitted') return;
    post('cavalry-icloud-cancel');
    finish('Cancelled. Your existing Cavalry library has not changed.');
  });

  window.addEventListener('message', receiveMessage);
  window.addEventListener('pagehide', leavingPage);
  if (diagnosticsEnabled) {
    diagnosticReport.hidden = false;
    diagnosticReport.textContent =
      'Sign-in callback diagnostics (metadata only): No callback messages received.';
  }
  timeout = setTimeout(
    () => {
      if (phase !== 'submitted') post('cavalry-icloud-cancel');
      finish('Sign-in timed out. Return to Cavalry to check your account before trying again.');
    },
    5 * 60 * 1000
  );
  cancel.disabled = false;
  post('cavalry-icloud-ready');
})();
