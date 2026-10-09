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
function extract(marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing production declaration ${marker}`);
  const body = source.indexOf('{', start);
  let depth = 1;
  let end = body + 1;
  for (; end < source.length && depth > 0; end += 1) {
    if (source[end] === '{') depth += 1;
    if (source[end] === '}') depth -= 1;
  }
  assert.equal(depth, 0, `Unbalanced production declaration ${marker}`);
  return source.slice(start, end);
}
const models = [
  'CloudConflictNotice',
  'CloudWorkbookMetadata',
  'RemoteWorkbook',
  'StoredConflictPackage',
  'PendingWorkbook',
  'PendingConflictNoticeUpdate',
  'WorkbookConflict'
].map((name) => extract(`private struct ${name}:`));
models.push(
  extract('struct CavalryCloudKitRecordRecovery:'),
  extract('extension CKRecord.FieldKey {')
);
const helpers = [
  'normalizedWorkbookId',
  'normalizedName',
  'normalizedCurrency',
  'normalizedDate',
  'normalizedConflictText',
  'normalizedConflictReport',
  'sha256',
  'hashedRecordName',
  'encodeSystemFields',
  'cloudMetadata',
  'noticeWithResolutionAvailability',
  'cloudRecordValueType',
  'isRemoteSnapshotIssue',
  'isoDate'
].map((name) => extract(`private func ${name}(`));
const methods = [
  'prepareRecordRecovery',
  'rejectRemoteRecord',
  'resolveRejectedRemoteRecord',
  'completeRecordRecoveryFetch',
  'clearLastError',
  'decodeRemoteRecord',
  'metadata',
  'conflictNotice',
  'decodeConflictPackage',
  'invalidRemoteRecordFields',
  'hydrateConflictingRecord',
  'applyFetchedRecord',
  'applyFetchedDeletion',
  'latchConflict',
  'retryRejectedRemoteRecords'
].map((name) =>
  extract(`  private func ${name}(`)
    .replace('private func', 'func')
    .replaceAll('CKSyncEngine', 'TestSyncEngine')
);
const failedSave = extract('  private func handleFailedSave(');
const collisionStart = failedSave.indexOf('    case .serverRecordChanged:');
const collisionEnd = failedSave.indexOf('    case .zoneNotFound:', collisionStart);
assert.ok(collisionStart >= 0 && collisionEnd > collisionStart);
const collisionBody = failedSave.slice(
  collisionStart + '    case .serverRecordChanged:'.length,
  collisionEnd
);
assert.doesNotMatch(
  collisionBody,
  /applyFetchedRecord\(serverRecord\)/,
  'Never decode a metadata-only conflict record'
);
const fixture = readFileSync(path.join(project, 'scripts/cloudkit-record-tests.swift'), 'utf8')
  .replace('// INSERT_PRODUCTION_MODELS', models.join('\n\n'))
  .replace('// INSERT_PRODUCTION_HELPERS', helpers.join('\n\n'))
  .replace('// INSERT_PRODUCTION_METHODS', methods.join('\n\n'))
  .replace('// INSERT_PRODUCTION_COLLISION', collisionBody);
const directory = mkdtempSync(path.join(tmpdir(), 'cavalry-native-records-'));
try {
  const fixturePath = path.join(directory, 'record-tests.swift');
  const executable = path.join(directory, 'record-tests');
  writeFileSync(fixturePath, fixture);
  console.log(
    `Record-contract production source SHA-256: ${createHash('sha256').update(source).digest('hex')}`
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
