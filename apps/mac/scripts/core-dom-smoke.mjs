import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
const executable = process.platform === 'win32' ? 'electron.cmd' : 'electron';
const electronBin = [
  resolve(appRoot, 'node_modules', '.bin', executable),
  resolve(appRoot, '../..', 'node_modules', '.bin', executable)
].find(existsSync);
const runner = resolve(__dirname, 'core-dom-smoke-electron.cjs');

if (!electronBin) {
  console.error('Electron binary was not found. Run npm install before DOM smoke.');
  process.exit(1);
}

const child = spawn(electronBin, [runner], {
  cwd: appRoot,
  stdio: 'inherit',
  env: Object.assign({}, process.env, {
    CAVALRY_COMPANION_API_ENABLED: '0'
  })
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Electron DOM smoke exited via signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code == null ? 1 : code);
});

child.on('error', (error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
