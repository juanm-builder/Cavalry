// Tests for the Companion GPT Actions OpenAPI contract.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { packagePath } from '../../scripts/companion-paths.mjs';

const specPath = packagePath('openapi/cavalry-gpt-actions.openapi.yaml');
const specText = readFileSync(specPath, 'utf8');

describe('Cavalry GPT Actions OpenAPI spec', () => {
  it('declares OpenAPI 3.1 and stable operation IDs', () => {
    expect(specText).toMatch(/^openapi:\s*3\.1\.0/m);
    [
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
    ].forEach((operationId) => {
      expect(specText).toContain('operationId: ' + operationId);
    });
  });

  it('does not expose GPT-facing apply/delete/direct transaction mutation paths', () => {
    expect(specText).not.toMatch(/operationId:\s*.*Apply/i);
    expect(specText).not.toMatch(/operationId:\s*.*Delete/i);
    expect(specText).not.toMatch(/\/v1\/workbooks\/\{workbook_id\}\/transactions\s*:/);
    expect(specText).not.toMatch(/\/apply\s*:/);
  });

  it('includes examples and error schemas for draft creation', () => {
    expect(specText).toContain('examples:');
    expect(specText).toContain('ErrorResponse:');
    expect(specText).toContain('DraftGroupResponse:');
    expect(specText).toContain('This creates drafts only');
  });
});
