import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(appRoot, 'dist/host/index.cjs');
const binariesDirectory = resolve(appRoot, 'src-tauri/binaries');

const TARGETS = Object.freeze({
  'aarch64-apple-darwin': { pkg: 'node22-macos-arm64', extension: '' },
  'x86_64-apple-darwin': { pkg: 'node22-macos-x64', extension: '' },
  'x86_64-pc-windows-msvc': { pkg: 'node22-win-x64', extension: '.exe' },
  'x86_64-unknown-linux-gnu': { pkg: 'node22-linux-x64', extension: '' },
  'aarch64-unknown-linux-gnu': { pkg: 'node22-linux-arm64', extension: '' }
});

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function detectTarget() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  if (process.platform === 'win32') return 'x86_64-pc-windows-msvc';
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  }
  throw new Error(`No Cavalry sidecar target is defined for ${process.platform}/${process.arch}.`);
}

const target = readArgument('--target') || process.env.TAURI_ENV_TARGET_TRIPLE || detectTarget();
const targetConfig = TARGETS[target];
if (!targetConfig) {
  throw new Error(`Unsupported Cavalry sidecar target: ${target}`);
}
if (!existsSync(input)) {
  throw new Error(`The host bundle is missing: ${input}. Run npm run build:host first.`);
}

mkdirSync(binariesDirectory, { recursive: true });
const output = resolve(binariesDirectory, `cavalry-host-${target}${targetConfig.extension}`);
rmSync(output, { force: true });

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  npx,
  [
    '--yes',
    '--package=@yao-pkg/pkg@6.22.0',
    'pkg',
    input,
    '--target',
    targetConfig.pkg,
    '--output',
    output,
    '--compress',
    'GZip'
  ],
  { cwd: appRoot, stdio: 'inherit', env: process.env }
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Cavalry sidecar packaging failed for ${target} (exit ${result.status}).`);
}
if (!existsSync(output) || statSync(output).size < 1_000_000) {
  throw new Error(`Cavalry sidecar output is missing or unexpectedly small: ${output}`);
}
if (process.platform !== 'win32') chmodSync(output, 0o755);

process.stdout.write(`Prepared ${output}\n`);
