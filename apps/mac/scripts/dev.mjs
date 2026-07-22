import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');
const workspaceRoot = resolve(appRoot, '../..');
const executableName = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);

function findExecutable(name) {
  const candidates = [
    resolve(appRoot, 'node_modules/.bin', executableName(name)),
    resolve(workspaceRoot, 'node_modules/.bin', executableName(name))
  ];
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error(`${name} is not installed. Run npm ci from the workspace root.`);
  return executable;
}

const vite = findExecutable('vite');
const electron = findExecutable('electron');
const children = new Set();
let stopping = false;

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: appRoot,
    env: Object.assign({}, process.env, options.env || {}),
    stdio: 'inherit'
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = start(command, args);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${signal || code}.`));
    });
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 100).unref();
}

async function waitForRenderer(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_error) {
      // Vite has not started listening yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Renderer dev server did not become ready at ${url}.`);
}

async function main() {
  await Promise.all([
    run(vite, ['build', '--config', 'vite.main.config.mjs']),
    run(vite, ['build', '--config', 'vite.preload.config.mjs'])
  ]);

  const rendererUrl = 'http://127.0.0.1:5173';
  start(vite, [
    '--config',
    'vite.renderer.config.mjs',
    '--host',
    '127.0.0.1',
    '--port',
    '5173',
    '--strictPort'
  ]);
  start(vite, ['build', '--config', 'vite.main.config.mjs', '--watch']);
  start(vite, ['build', '--config', 'vite.preload.config.mjs', '--watch']);
  await waitForRenderer(rendererUrl);

  const app = start(electron, ['.'], {
    env: { CAVALRY_RENDERER_URL: rendererUrl }
  });
  app.once('exit', (code) => stop(code == null ? 1 : code));
}

process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  stop(1);
});
