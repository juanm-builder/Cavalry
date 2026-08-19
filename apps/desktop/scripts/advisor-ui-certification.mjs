import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitestPackage = fileURLToPath(import.meta.resolve('vitest/package.json'));
const vitestCli = path.join(path.dirname(vitestPackage), 'vitest.mjs');
const certificationTest = 'tests/renderer/advisor-certification.interaction.test.jsx';
const child = spawn(
  process.execPath,
  [
    vitestCli,
    'run',
    '--config',
    'vitest.renderer.config.mjs',
    certificationTest,
    '--reporter=verbose',
    ...process.argv.slice(2)
  ],
  {
    cwd: appDirectory,
    stdio: 'inherit',
    env: process.env
  }
);

child.on('error', (error) => {
  console.error('Advisor UI certification could not start:', error.message);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error('Advisor UI certification stopped by signal:', signal);
    process.exit(1);
  }
  process.exit(code || 0);
});
