import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostPath = resolve(appRoot, 'dist/host/index.cjs');
const userDataDir = mkdtempSync(resolve(tmpdir(), 'cavalry-tauri-host-'));
const prefix = 'CAVALRY_IPC_V1:';
const requestId = 'sidecar-smoke-status';

const child = spawn(process.execPath, [hostPath], {
  cwd: appRoot,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    CAVALRY_APP_NAME: 'Cavalry Test',
    CAVALRY_APP_VERSION: '1.0.26',
    CAVALRY_IS_PACKAGED: '0',
    CAVALRY_USER_DATA_DIR: userDataDir,
    CAVALRY_COMPANION_API_ENABLED: '0',
    CAVALRY_SUPABASE_URL: '',
    CAVALRY_SUPABASE_PUBLISHABLE_KEY: ''
  }
});

let ready = false;
let completed = false;
let stderr = '';
const timeout = setTimeout(
  () => finish(new Error(`Desktop host smoke timed out.\n${stderr}`)),
  30_000
);

function write(message) {
  child.stdin.write(`${prefix}${JSON.stringify({ version: 1, ...message })}\n`);
}

function cleanup() {
  clearTimeout(timeout);
  try {
    child.kill('SIGTERM');
  } catch (_error) {
    // Best effort.
  }
  rmSync(userDataDir, { recursive: true, force: true });
}

function finish(error) {
  if (completed) return;
  completed = true;
  if (!child.stdin.destroyed) {
    write({ type: 'lifecycle', action: 'shutdown' });
    child.stdin.end();
  }
  setTimeout(cleanup, 100).unref();
  if (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } else {
    process.stdout.write('Cavalry desktop host smoke passed.\n');
  }
}

child.stderr.on('data', (chunk) => {
  stderr += String(chunk || '');
});
child.on('error', finish);
child.on('exit', (code, signal) => {
  if (!completed && code !== 0) {
    finish(
      new Error(
        `Desktop host exited before smoke completion (${code ?? signal ?? 'unknown'}).\n${stderr}`
      )
    );
  }
});

const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
lines.on('line', (line) => {
  const index = line.indexOf(prefix);
  if (index < 0) return;
  let message;
  try {
    message = JSON.parse(line.slice(index + prefix.length));
  } catch (_error) {
    return;
  }
  if (message.type === 'ready' && !ready) {
    ready = true;
    write({ type: 'request', id: requestId, channel: 'cavalry-host:get-info', payload: {} });
    return;
  }
  if (message.type === 'response' && message.id === requestId) {
    if (!message.ok || !message.result || message.result.protocolVersion !== 1) {
      finish(
        new Error(`Desktop host returned an invalid status response: ${JSON.stringify(message)}`)
      );
      return;
    }
    finish();
  }
  if (message.type === 'fatal') finish(new Error(JSON.stringify(message.error || message)));
});
