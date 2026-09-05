import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import {
  deserializeWorkbookFromFile,
  serializeWorkbookForSave
} from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';
import { makeIncomeAndExpenseWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length !== 0 && !(args.length === 2 && args[0] === '--binary' && args[1])) {
  throw new Error('Usage: workbook-recovery-smoke.mjs [--binary <packaged-host>]');
}
const binaryPath = args.length ? resolve(args[1]) : '';
const hostPath = resolve(appRoot, 'dist/host/index.cjs');
const prefix = 'CAVALRY_IPC_V1:';
const children = new Set();
const userDataDir = await mkdtemp(resolve(tmpdir(), 'cavalry-workbook-recovery-smoke-'));
let nextRequest = 0;
let timeout;
let rejectHostFailure;
const hostFailure = new Promise((_, reject) => {
  rejectHostFailure = reject;
});

function launch() {
  let expectedExit = false;
  let stderr = '';
  let resolveReady;
  let rejectReady;
  const requests = new Map();
  const ready = new Promise((resolveValue, reject) => {
    resolveReady = resolveValue;
    rejectReady = reject;
  });
  const child = spawn(binaryPath || process.execPath, binaryPath ? [] : [hostPath], {
    cwd: appRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CAVALRY_APP_NAME: 'Cavalry Recovery Smoke',
      CAVALRY_IS_PACKAGED: binaryPath ? '1' : '0',
      CAVALRY_USER_DATA_DIR: userDataDir,
      CAVALRY_COMPANION_API_ENABLED: '0'
    }
  });
  const closed = new Promise((resolveValue) => child.once('close', resolveValue));
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const fail = (error) => {
    const detailed = new Error(`${error.message}\n${stderr}`);
    rejectHostFailure(detailed);
    rejectReady(detailed);
    for (const request of requests.values()) request.reject(detailed);
    requests.clear();
  };
  const write = (message) => {
    child.stdin.write(`${prefix}${JSON.stringify({ version: 1, ...message })}\n`);
  };
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_000);
  });
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', (code, signal) => {
    if (!expectedExit) fail(new Error(`Desktop host exited unexpectedly (${code ?? signal}).`));
  });
  lines.on('line', (line) => {
    const index = line.indexOf(prefix);
    if (index < 0) return;
    let message;
    try {
      message = JSON.parse(line.slice(index + prefix.length));
    } catch {
      fail(new Error('Desktop host emitted malformed IPC.'));
      return;
    }
    if (message.type === 'ready') resolveReady();
    if (message.type === 'fatal') fail(new Error(JSON.stringify(message.error || message)));
    // No native bridge is attached: this test must never inspect an account,
    // contact CloudKit, or open any real user file through an OS dialog.
    if (message.type === 'native-request') {
      fail(new Error('Local workbook recovery unexpectedly requested a native operation.'));
      return;
    }
    if (message.type !== 'response') return;
    const request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else
      request.reject(new Error(`IPC ${request.channel} failed: ${JSON.stringify(message.error)}`));
  });

  const host = {
    ready,
    async request(channel, payload = {}) {
      await ready;
      const id = `workbook-recovery-smoke-${++nextRequest}`;
      return new Promise((resolveValue, reject) => {
        requests.set(id, { channel, resolve: resolveValue, reject });
        write({ type: 'request', id, channel, payload });
      });
    },
    async crash() {
      expectedExit = true;
      // Do not send shutdown or close stdin: durability must not depend on an
      // orderly exit, WebView shutdown, or a subsequent autosave timer.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
      lines.close();
      children.delete(host);
    }
  };
  children.add(host);
  return host;
}

function fixture(id, name) {
  const workbook = {
    ...makeIncomeAndExpenseWorkbook(),
    id,
    name,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z'
  };
  assert.ok(workbook.transactions.length > 0, 'Smoke fixture must contain financial entries.');
  return serializeWorkbookForSave(workbook, { rejectInvalid: true }).html;
}

function verifyWorkbook(result, expectedHtml) {
  assert.equal(result.ok, true, 'Recovery load must succeed.');
  assert.equal(result.recovery, true, 'Workbook must come from native recovery storage.');
  assert.equal(
    result.text,
    expectedHtml,
    'Durably acknowledged workbook bytes changed after restart.'
  );
  assert.deepEqual(
    deserializeWorkbookFromFile(result.text, { rejectInvalid: true }).workbook,
    deserializeWorkbookFromFile(expectedHtml, { rejectInvalid: true }).workbook
  );
}

async function verifyLibrary(host) {
  const library = await host.request('cavalry-files:list-recent');
  assert.equal(library.ok, true);
  assert.equal(library.workbooks.length, 2, 'Both saved workbooks must survive restart.');
  assert.deepEqual(library.workbooks.map((book) => book.fileName).sort(), [
    'Crash recovery first.html',
    'Crash recovery latest.html'
  ]);
  assert.ok(library.workbooks.every((book) => book.id.startsWith('recovery-') && !book.error));
  return library.workbooks;
}

async function verifyClockRollbackRetention() {
  const workbookId = 'recovery-smoke-clock-rollback';
  const digest = (text) => createHash('sha256').update(text).digest('hex');
  const workbookKey = digest(workbookId);
  const folder = resolve(userDataDir, 'Workbook Recovery', workbookKey);
  const snapshots = [];
  const writer = launch();
  for (let revision = 1; revision <= 30; revision += 1) {
    const html = fixture(
      workbookId,
      `Clock rollback revision ${String(revision).padStart(2, '0')}`
    );
    const saved = await writer.request('cavalry-files:recovery-save', { html });
    assert.equal(saved.ok, true);
    assert.equal(saved.durable, true);
    snapshots.push({ revision, html, fileName: `${digest(html)}.html` });
  }
  const snapshotFiles = (await readdir(folder)).filter((fileName) => fileName.endsWith('.html'));
  assert.equal(snapshotFiles.length, 30, 'Prepare a full retained history before clock rollback.');
  assert.deepEqual(snapshotFiles.sort(), snapshots.map((snapshot) => snapshot.fileName).sort());
  const futureStart = Date.now() + 24 * 60 * 60 * 1000;
  for (const snapshot of snapshots) {
    // Change only synthetic snapshot mtimes, never the system clock or metadata.
    // Preserve the old revisions' order one day in the future.
    const future = new Date(futureStart + snapshot.revision * 1000);
    await utimes(resolve(folder, snapshot.fileName), future, future);
  }
  const latestHtml = fixture(workbookId, 'Clock rollback revision 31');
  const saved = await writer.request('cavalry-files:recovery-save', { html: latestHtml });
  assert.equal(saved.ok, true);
  assert.equal(saved.durable, true, 'Newest snapshot must be acknowledged before forced exit.');
  await writer.crash();

  const restarted = launch();
  verifyWorkbook(await restarted.request('cavalry-files:recovery-load'), latestHtml);
  const retained = (await readdir(folder)).filter((fileName) => fileName.endsWith('.html'));
  const expected = [
    ...snapshots.slice(1),
    { revision: 31, html: latestHtml, fileName: `${digest(latestHtml)}.html` }
  ];
  assert.equal(retained.length, 30, 'Clock rollback must not bypass bounded retention.');
  assert.deepEqual(
    retained.sort(),
    expected.map((snapshot) => snapshot.fileName).sort(),
    'Retain committed revisions 2 through 31; future mtimes cannot evict the newest save.'
  );
  for (const snapshot of expected) {
    assert.equal(await readFile(resolve(folder, snapshot.fileName), 'utf8'), snapshot.html);
  }
  const library = await restarted.request('cavalry-files:list-recent');
  assert.equal(library.ok, true);
  assert.equal(library.workbooks.length, 3, 'Pruning one history must preserve other workbooks.');
  const entry = library.workbooks.find((book) => book.id === `recovery-${workbookKey}`);
  assert.equal(entry?.fileName, 'Clock rollback revision 31.html');
  assert.equal(entry.error, undefined);
  verifyWorkbook(
    await restarted.request('cavalry-files:open-recent', { id: entry.id }),
    latestHtml
  );
  await restarted.crash();
}

async function smoke() {
  const firstHtml = fixture('recovery-smoke-first', 'Crash recovery first');
  const latestHtml = fixture('recovery-smoke-latest', 'Crash recovery latest');
  const first = launch();
  const info = await first.request('cavalry-host:get-info');
  assert.equal(info.userDataDir, userDataDir, 'Smoke must use its isolated data directory.');
  for (const html of [firstHtml, latestHtml]) {
    const saved = await first.request('cavalry-files:recovery-save', { html });
    assert.equal(saved.ok, true);
    assert.equal(saved.durable, true, 'Host must acknowledge a durable save before crash.');
  }
  await first.crash();

  const restarted = launch();
  verifyWorkbook(await restarted.request('cavalry-files:recovery-load'), latestHtml);
  await verifyLibrary(restarted);
  const cleared = await restarted.request('cavalry-files:recovery-clear');
  assert.equal(cleared.ok, true);
  await restarted.crash();

  const afterClear = launch();
  const inactive = await afterClear.request('cavalry-files:recovery-load');
  assert.equal(inactive.ok, false);
  assert.equal(inactive.empty, true);
  assert.equal(inactive.cleared, true, 'Cleared selection must remain cleared after restart.');
  const library = await verifyLibrary(afterClear);
  for (const [name, html] of [
    ['Crash recovery first.html', firstHtml],
    ['Crash recovery latest.html', latestHtml]
  ]) {
    const entry = library.find((book) => book.fileName === name);
    verifyWorkbook(await afterClear.request('cavalry-files:open-recent', { id: entry.id }), html);
  }
  await afterClear.crash();
  await verifyClockRollbackRetention();
}

try {
  await Promise.race([
    smoke(),
    hostFailure,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Workbook recovery smoke timed out.')), 30_000);
    })
  ]);
  process.stdout.write(
    'Cavalry workbook recovery crash/relaunch and clock-rollback retention smoke passed.\n'
  );
} finally {
  clearTimeout(timeout);
  await Promise.all([...children].map((host) => host.crash()));
  await rm(userDataDir, { recursive: true, force: true });
}
