// Keeps sanitized fixture workbooks valid for future route parity and workflow tests.

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateLedgerInvariants } from '@cavalry/finance-core/domain/ledger/invariants.js';
import {
  buildPortableWorkbookHtml,
  parsePortableWorkbookText
} from '@cavalry/finance-core/domain/workbook/portable.js';
import {
  normalizeLoadedWorkbook,
  validateWorkbookAfterLoad
} from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';

const fixtureDir = fileURLToPath(new URL('../fixtures/workbooks/', import.meta.url));
const expectedFixtures = [
  'advisor-drafts-workbook.json',
  'checkpoints-workbook.json',
  'full-ledger-workbook.json',
  'import-preview-workbook.json',
  'minimal-workbook.json',
  'recurring-bills-workbook.json'
];

function readFixture(fileName) {
  const text = readFileSync(resolve(fixtureDir, fileName), 'utf8');
  return {
    text,
    data: JSON.parse(text)
  };
}

describe('golden workbook fixtures', () => {
  it('keeps the expected fixture set explicit', () => {
    const fixtureFiles = readdirSync(fixtureDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .sort();

    expect(fixtureFiles).toEqual(expectedFixtures);
  });

  it.each(expectedFixtures)('%s normalizes and validates as a workbook', (fileName) => {
    const { data } = readFixture(fileName);
    const normalized = normalizeLoadedWorkbook(data, {
      now: () => new Date('2026-07-09T00:00:00.000Z'),
      createId: (prefix, index) => String(prefix || 'id') + '_' + String(index || 0)
    });
    const workbookValidation = validateWorkbookAfterLoad(normalized, { rawWorkbook: data });
    const ledgerValidation = validateLedgerInvariants(normalized);

    expect(normalized.id).toBe(data.id);
    expect(workbookValidation.errors).toEqual([]);
    expect(ledgerValidation.errors).toEqual([]);
  });

  it.each(expectedFixtures)('%s round-trips through portable workbook HTML', (fileName) => {
    const { data } = readFixture(fileName);
    const normalized = normalizeLoadedWorkbook(data, {
      now: () => new Date('2026-07-09T00:00:00.000Z'),
      createId: (prefix, index) => String(prefix || 'id') + '_' + String(index || 0)
    });
    const html = buildPortableWorkbookHtml(normalized);
    const parsed = parsePortableWorkbookText(html);

    expect(parsed.id).toBe(normalized.id);
    expect(parsed.name).toBe(normalized.name);
    expect(parsed.transactions.length).toBe(normalized.transactions.length);
  });

  it.each(expectedFixtures)('%s stays synthetic and secret-free', (fileName) => {
    const { text } = readFixture(fileName);

    expect(text).not.toMatch(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    expect(text).not.toMatch(/\bsk-[A-Za-z0-9_-]{16,}\b/);
    expect(text).not.toMatch(/BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/);
    expect(text).not.toMatch(/\b(?:password|secret|api[_-]?key)\b/i);
  });
});
