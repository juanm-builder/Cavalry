import { describe, expect, it } from 'vitest';
import {
  buildPortableWorkbookHtml,
  parsePortableWorkbookText
} from '@cavalry/finance-core/domain/workbook/portable.js';

describe('portable workbook files', () => {
  const workbook = {
    name: 'Cavalry <Main>',
    year: 2026,
    currency: 'PHP',
    accounts: [{ id: 'cash' }],
    transactions: [{ id: 'txn-one', reference: 'manual' }]
  };

  it('exports workbook JSON inside an HTML payload without raw script-breaking tags', () => {
    const html = buildPortableWorkbookHtml({
      ...workbook,
      note: '</script><script>alert(1)</script>'
    });

    expect(html).toContain('Cavalry Workbook Export');
    expect(html).toContain('id="ledger-grove-export"');
    expect(html).not.toContain('</script><script>alert');
  });

  it('imports exported workbook HTML', () => {
    const html = buildPortableWorkbookHtml(workbook);
    expect(parsePortableWorkbookText(html)).toEqual(workbook);
  });

  it('imports raw workbook JSON', () => {
    expect(parsePortableWorkbookText(JSON.stringify(workbook))).toEqual(workbook);
  });

  it('rejects files without a Cavalry payload', () => {
    expect(() => parsePortableWorkbookText('<html></html>')).toThrow('Cavalry workbook payload');
  });
});
