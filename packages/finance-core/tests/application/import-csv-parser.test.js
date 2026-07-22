import { describe, expect, it } from 'vitest';

import {
  normalizeCsvHeader,
  parseCsv,
  parseCsvNumber
} from '@cavalry/finance-core/application/import-export/csv-import-parser.js';

describe('csv import parser', () => {
  it('parses quoted commas, escaped quotes, and CRLF rows', () => {
    const parsed = parseCsv('Date,Description,Amount\r\n2026-06-01,"Lunch, ""set""",250\r\n');

    expect(parsed.ok).toBe(true);
    expect(parsed.normalizedHeaders).toEqual(['date', 'description', 'amount']);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].values.description).toBe('Lunch, "set"');
  });

  it('normalizes headers and reports duplicate normalized names', () => {
    const parsed = parseCsv(' Account Name ,account-name\nCash,Bank\n');

    expect(normalizeCsvHeader(' Account Name ')).toBe('account_name');
    expect(parsed.ok).toBe(false);
    expect(parsed.errors.some((issue) => issue.code === 'duplicate_header')).toBe(true);
  });

  it('parses common money formats without guessing blank values', () => {
    expect(parseCsvNumber('1,234.50')).toBe(1234.5);
    expect(parseCsvNumber('(1,234.50)')).toBe(-1234.5);
    expect(Number.isNaN(parseCsvNumber(''))).toBe(true);
  });

  it('reports unclosed quoted fields as parse errors', () => {
    const parsed = parseCsv('date,description\n2026-06-01,"open field\n');

    expect(parsed.ok).toBe(false);
    expect(parsed.errors.some((issue) => issue.code === 'unclosed_quote')).toBe(true);
  });
});
