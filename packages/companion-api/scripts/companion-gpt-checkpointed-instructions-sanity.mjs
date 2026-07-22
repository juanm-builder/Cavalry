import { readFileSync } from 'node:fs';
import { packagePath, repoPath } from './companion-paths.mjs';

const paths = [
  packagePath('examples/custom-gpt-instructions-checkpointed.md'),
  repoPath('docs/integrations/companion-api-checkpointed-beta-test.md')
].filter((path) => {
  try {
    readFileSync(path, 'utf8');
    return true;
  } catch (_error) {
    return false;
  }
});

const text = paths
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
  .toLowerCase();

function fail(message) {
  console.error('Checkpointed GPT instructions sanity failed:', message);
  process.exit(1);
}

for (const phrase of [
  'reversible cavalry checkpoint',
  'review or undo in cavalry',
  'cannot permanently delete',
  'checkpointed mode enabled',
  'idempotency keys',
  'keep requests small',
  'external ai output is untrusted',
  'broad delete requests',
  'raw mutation requests must be refused'
]) {
  if (!text.includes(phrase)) {
    fail('missing required phrase: ' + phrase);
  }
}

for (const phrase of [
  'call post /transactions',
  'you may bypass checkpoints',
  'bypass rollback',
  'this is permanent',
  'i deleted everything',
  'i disabled checkpoints',
  'cavb_',
  'sk-'
]) {
  if (text.includes(phrase)) {
    fail('forbidden phrase or token pattern appears: ' + phrase);
  }
}

console.log('Checkpointed GPT instructions sanity passed.');
