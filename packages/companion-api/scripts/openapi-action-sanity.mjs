import { readFileSync } from 'node:fs';
import { resolvePackageInput } from './companion-paths.mjs';

const specPath = resolvePackageInput(process.argv[2], 'openapi/cavalry-gpt-actions.openapi.yaml');
const spec = readFileSync(specPath, 'utf8');

const requiredOperationIds = [
  'getCavalryCapabilities',
  'listCavalryWorkbooks',
  'getCavalryWorkbookSummary',
  'listCavalryAccounts',
  'listCavalryCategories',
  'listCavalryRecentTransactions',
  'createCavalryDraftGroupFromActionPlan',
  'createCavalryTransactionDraftBatch',
  'createCavalryRecurringItemDrafts',
  'createCavalryCategoryChangeDrafts',
  'getCavalryDraftGroup'
];

const stableErrorCodes = [
  'invalid_action_plan',
  'unsupported_action_type',
  'missing_required_field',
  'invalid_amount',
  'invalid_date',
  'invalid_currency',
  'workbook_not_found',
  'scope_denied',
  'idempotency_conflict',
  'duplicate_candidate',
  'draft_validation_failed',
  'payload_too_large',
  'rate_limited',
  'auth_required',
  'auth_forbidden',
  'server_not_enabled'
];

const stableScopes = [
  'cavalry.read.capabilities',
  'cavalry.read.workbooks',
  'cavalry.read.summary',
  'cavalry.read.accounts',
  'cavalry.read.categories',
  'cavalry.read.transactions.recent',
  'cavalry.draft.create',
  'cavalry.draft.read',
  'cavalry.draft.apply'
];

function fail(message) {
  console.error('OpenAPI action sanity failed:', message);
  process.exit(1);
}

function countMatches(pattern) {
  return Array.from(spec.matchAll(pattern)).length;
}

if (!/^openapi:\s*3\.1\.0/m.test(spec)) {
  fail('spec must declare OpenAPI 3.1.0');
}

if (Buffer.byteLength(spec, 'utf8') > 128 * 1024) {
  fail('spec exceeds the GPT Action payload budget');
}

if (/(?:sk-|cavb_|ghp_|xox[baprs]-|ya29\.|eyJ)[A-Za-z0-9_.-]{8,}/.test(spec)) {
  fail('spec must not contain raw token-like secrets');
}

for (const operationId of requiredOperationIds) {
  if (countMatches(new RegExp('operationId:\\s*' + operationId + '\\b', 'g')) !== 1) {
    fail('operationId must appear exactly once: ' + operationId);
  }
}

const operationBlocks = spec
  .split(/\n(?=\s{4}(?:get|post|put|patch|delete):\n)/g)
  .filter((block) => /operationId:\s*\w+/.test(block));
for (const operationId of requiredOperationIds) {
  const block =
    operationBlocks.find((candidate) => candidate.includes('operationId: ' + operationId)) || '';
  if (!/\n\s+summary:\s*\S/.test(block) || !/\n\s+description:\s*\S/.test(block)) {
    fail('operation must include summary and description: ' + operationId);
  }
}

if (
  /operationId:\s*.*(?:Apply|Delete|Archive|PostTransaction|CreatePostedTransaction)/i.test(spec)
) {
  fail('GPT-facing spec exposes apply/delete/archive/post-like operation IDs');
}

if (/\/v1\/workbooks\/\{workbook_id\}\/transactions\s*:/m.test(spec) || /\/apply\s*:/i.test(spec)) {
  fail('GPT-facing spec exposes direct transaction or apply paths');
}

if (/type:\s*apiKey/i.test(spec) || /name:\s*(?:X-API-Key|Authorization)\b/i.test(spec)) {
  fail('spec must not use custom-header-only auth');
}

if (!/OAuth2:\n\s+type:\s+oauth2/m.test(spec)) {
  fail('spec must document OAuth2 security');
}

for (const scope of stableScopes) {
  if (!spec.includes(scope + ':') && !spec.includes('- ' + scope)) {
    fail('missing stable scope: ' + scope);
  }
}

for (const errorCode of stableErrorCodes) {
  if (!spec.includes('- ' + errorCode) && !spec.includes('code: ' + errorCode)) {
    fail('missing stable error example/schema code: ' + errorCode);
  }
}

for (const operationId of requiredOperationIds) {
  const block =
    operationBlocks.find((candidate) => candidate.includes('operationId: ' + operationId)) || '';
  const isPost =
    /\n\s{4}post:\n/.test(block) ||
    /createCavalry.*(?:Draft|Drafts|Batch|ActionPlan)/.test(operationId);
  const expected = isPost ? 'true' : 'false';
  if (!new RegExp('x-openai-isConsequential:\\s*' + expected + '\\b').test(block)) {
    fail('operation must declare x-openai-isConsequential: ' + expected + ' for ' + operationId);
  }
}

for (const label of [
  'ready:',
  'mixedReadyNeedsReview:',
  'duplicateWarning:',
  'idempotencyReplay:',
  'unsupportedAction:',
  'idempotencyConflict:',
  'missingAccountOrCategory:',
  'unauthorized:',
  'forbidden:'
]) {
  if (!spec.includes(label)) {
    fail('missing required example: ' + label);
  }
}

console.log('OpenAPI action sanity passed:', specPath);
