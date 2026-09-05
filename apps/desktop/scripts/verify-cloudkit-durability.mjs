import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store =
  process.argv[2] || path.join(project, 'src-tauri/src/cloudkit/CavalryCloudKitStore.swift');
const directory = mkdtempSync(path.join(tmpdir(), 'cavalry-native-durability-'));
try {
  const executable = path.join(directory, 'durability-tests');
  const compile = spawnSync(
    'xcrun',
    [
      'swiftc',
      '-target',
      `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.0`,
      store,
      path.join(project, 'scripts/cloudkit-durability-tests.swift'),
      '-o',
      executable
    ],
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
