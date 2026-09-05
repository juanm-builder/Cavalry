import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store =
  process.argv[2] || path.join(project, 'src-tauri/src/cloudkit/CavalryCloudKitStore.swift');
const source = readFileSync(store, 'utf8');

function extractMethod(name) {
  const start = source.indexOf(`  private func ${name}(`);
  assert.ok(start >= 0, `Missing production method ${name}`);
  const body = source.indexOf('{', start);
  let depth = 1;
  let end = body + 1;
  for (; end < source.length && depth > 0; end += 1) {
    if (source[end] === '{') depth += 1;
    if (source[end] === '}') depth -= 1;
  }
  assert.equal(depth, 0, `Unbalanced production method ${name}`);
  return source.slice(start, end);
}

const eventStart = source.indexOf('    case .accountChange(let event):');
const eventEnd = source.indexOf('    case .fetchedDatabaseChanges(let event):', eventStart);
assert.ok(eventStart >= 0 && eventEnd > eventStart, 'Missing production account-change handler');
const handlerStart = source.indexOf('  func handleEvent(');
assert.ok(handlerStart >= 0 && handlerStart < eventStart);
const handlerGuard = source.slice(handlerStart, eventStart);
assert.match(handlerGuard, /guard engine === syncEngine else \{ return \}/);
const accountHandler = source.slice(
  eventStart + '    case .accountChange(let event):'.length,
  eventEnd
);

// This compiles the current production method bodies. Only CloudKit and owner
// selection are simulated; the tests intentionally do not contact any account.
// Apple's contract says account events clear pending database/record changes:
// https://developer.apple.com/documentation/cloudkit/cksyncengine-5sie5/event/accountchange
const fixture = readFileSync(
  path.join(project, 'scripts/cloudkit-account-event-tests.swift'),
  'utf8'
)
  .replace('// INSERT_PRODUCTION_SEED', extractMethod('seedPendingChanges'))
  .replace('// INSERT_PRODUCTION_STOP', extractMethod('stopEngineForOwnerChange'))
  .replace('// INSERT_PRODUCTION_ACCOUNT_EVENT', accountHandler);
const directory = mkdtempSync(path.join(tmpdir(), 'cavalry-native-account-events-'));
try {
  const fixturePath = path.join(directory, 'account-event-tests.swift');
  const executable = path.join(directory, 'account-event-tests');
  writeFileSync(fixturePath, fixture);
  console.log(
    `Account-event production source SHA-256: ${createHash('sha256').update(source).digest('hex')}`
  );
  const compile = spawnSync(
    'xcrun',
    ['swiftc', '-parse-as-library', fixturePath, '-o', executable],
    { stdio: 'inherit' }
  );
  if (compile.error) throw compile.error;
  if (compile.status !== 0) process.exitCode = compile.status || 1;
  else {
    const run = spawnSync(executable, [], { stdio: 'inherit' });
    if (run.error) throw run.error;
    process.exitCode = run.status || (run.signal ? 1 : 0);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
