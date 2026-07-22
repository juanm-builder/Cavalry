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

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!/^openapi:\s*3\.1\.0/m.test(spec)) {
  fail('OpenAPI spec must declare openapi: 3.1.0');
}

for (const operationId of requiredOperationIds) {
  if (!spec.includes('operationId: ' + operationId)) {
    fail('Missing operationId: ' + operationId);
  }
}

if (/operationId:\s*.*(?:Apply|Delete|Archive|PostTransaction)/i.test(spec)) {
  fail('GPT-facing OpenAPI spec must not expose apply/delete/archive/post operations.');
}

if (/\/v1\/workbooks\/\{workbook_id\}\/transactions\s*:/m.test(spec)) {
  fail('GPT-facing OpenAPI spec must not expose direct transaction creation.');
}

if (
  !/OAuth2:/m.test(spec) ||
  !/cavalry\.draft\.create/m.test(spec) ||
  !/cavalry\.read\.transactions\.recent/m.test(spec)
) {
  fail('OpenAPI spec must document OAuth scopes.');
}

if (
  !/examples:/m.test(spec) ||
  !/ErrorResponse:/m.test(spec) ||
  !/DraftGroupResponse:/m.test(spec)
) {
  fail('OpenAPI spec must include examples, error schemas, and draft group schemas.');
}

console.log('OpenAPI validation passed:', specPath);
