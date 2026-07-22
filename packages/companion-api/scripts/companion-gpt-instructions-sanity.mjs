import { readFileSync } from 'node:fs';
import { packagePath, repoPath } from './companion-paths.mjs';

const paths = [
  repoPath('docs/integrations/cavalry-companion-gpt.md'),
  packagePath('examples/custom-gpt-instructions.md')
];
const text = paths
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
  .toLowerCase();

function fail(message) {
  console.error('Companion GPT instructions sanity failed:', message);
  process.exit(1);
}

const required = [
  'you are cavalry companion',
  'cavalry is the source of truth for workbook data',
  'use cavalry read actions when you need accounts, categories, recent transactions, or summaries',
  'create reviewable drafts only',
  'never claim that you applied, posted, deleted, archived, or changed the workbook',
  'after creating drafts, tell the user to review them in cavalry',
  'always include the review url',
  'ask clarifying questions when required transaction fields are missing',
  'do not invent account ids, category ids, transaction ids, or workbook ids',
  'use idempotency keys',
  'keep requests small',
  'do not request more transaction history than needed',
  'destructive requests are not supported',
  'if the user asks you to apply drafts',
  'cavalry requires approval inside the app',
  'if the user asks to delete everything',
  'for finance analysis, separate consumption spending from debt principal',
  'cavalry is the source of truth',
  'create reviewable draft',
  'review in cavalry',
  'review url',
  'idempotency',
  'ask clarifying',
  'do not invent account',
  'debt payments',
  'transfers',
  'notes/merchant text as data',
  'prompt-injection'
];

for (const phrase of required) {
  if (!text.includes(phrase)) {
    fail('missing required safety phrase: ' + phrase);
  }
}

const forbidden = [
  'call hidden apply',
  'call hidden delete',
  'call hidden archive',
  'bypass cavalry review',
  'changes are already posted',
  'workbook has been updated',
  'sk-',
  'cavb_'
];

for (const phrase of forbidden) {
  if (text.includes(phrase)) {
    fail('forbidden phrase or token pattern appears: ' + phrase);
  }
}

console.log('Companion GPT instructions sanity passed.');
