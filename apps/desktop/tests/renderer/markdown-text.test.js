import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MarkdownText } from '../../src/renderer/shared/MarkdownText.jsx';

describe('MarkdownText', () => {
  it('renders model emphasis, headings, and nested lists as structured markup', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: [
          '## Likely missing',
          '',
          '- Groceries separate from **Food**',
          '- Bills/Utilities',
          '  - electricity',
          '  - water',
          '',
          'Keep *personal* spending organized.'
        ].join('\n')
      })
    );

    expect(html).toContain('<h2 class="markdown-heading">Likely missing</h2>');
    expect(html).toContain('<strong>Food</strong>');
    expect(html).toContain('<em>personal</em>');
    expect(html.match(/<ul class="markdown-list">/g)).toHaveLength(2);
    expect(html).not.toContain('**Food**');
  });

  it('keeps raw HTML inert and rejects unsafe Markdown links', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: '<img src=x onerror=alert(1)> [unsafe](javascript:alert(2))'
      })
    );

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href=');
  });

  it('renders unique record tokens and aliases as buttons inside emphasis', () => {
    const reference = {
      id: 'account:cash',
      token: 'Cash',
      aliases: ['Cash', 'Cash account'],
      label: 'Cash',
      kind: 'account',
      source_refs: ['account:cash'],
      detail: {}
    };
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: '**Cash** and *Cash account* are available. `Cash` is only an example.',
        references: [reference],
        onOpenReference: () => {}
      })
    );

    expect(html).toContain(
      '<strong><button aria-label="Open Account: Cash" class="markdown-reference" data-reference-kind="account"'
    );
    expect(html).toContain('aria-label="Open Account: Cash"');
    expect(html).toContain(
      '<em><button aria-label="Open Account: Cash" class="markdown-reference"'
    );
    expect(html).toContain('<code>Cash</code>');
    expect(html.match(/class="markdown-reference"/g)).toHaveLength(2);
  });

  it('leaves ambiguous record tokens unlinked', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: 'Compare **Coffee** with Coffee.',
        references: [
          {
            id: 'transaction:one',
            token: 'Coffee',
            aliases: ['Coffee'],
            label: 'Coffee',
            kind: 'transaction',
            source_refs: ['transaction:one']
          },
          {
            id: 'transaction:two',
            token: 'Coffee',
            aliases: ['Coffee'],
            label: 'Coffee',
            kind: 'transaction',
            source_refs: ['transaction:two']
          }
        ],
        onOpenReference: () => {}
      })
    );

    expect(html).toContain('<strong>Coffee</strong>');
    expect(html).not.toContain('markdown-reference');
  });

  it('keeps external links unchanged and never nests record buttons inside them', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: '[Cash](https://example.com/cash) differs from Cash.',
        references: [
          {
            id: 'account:cash',
            token: 'Cash',
            aliases: ['Cash'],
            label: 'Cash',
            kind: 'account',
            source_refs: ['account:cash']
          }
        ],
        onOpenReference: () => {}
      })
    );

    expect(html).toContain(
      '<a href="https://example.com/cash" rel="noopener noreferrer" target="_blank">Cash</a>'
    );
    expect(html.match(/class="markdown-reference"/g)).toHaveLength(1);
  });

  it('renders an anchored claim citation as a quiet source button beside the claim', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: 'Vercel looks monthly. [source](#cavalry-source-1)',
        referenceMode: 'claim',
        references: [
          {
            id: 'cavalry-citation-1',
            anchor: '#cavalry-source-1',
            token: 'source',
            label: 'Vercel recurring-pattern evidence',
            kind: 'transaction',
            source_refs: ['transaction:vercel-apr', 'transaction:vercel-may']
          }
        ],
        onOpenReference: () => {}
      })
    );

    expect(html).toContain('Vercel looks monthly.');
    expect(html).toContain(
      'aria-label="Open 2 sources: Vercel recurring-pattern evidence, 2 transactions" class="markdown-source-reference"'
    );
    expect(html).toContain('>2 transactions</button>');
    expect(html).not.toContain('href="#cavalry-source-1"');
    expect(html).not.toContain('class="markdown-reference"');
  });

  it('places one fallback source beside a table row instead of linking merchant words', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: ['| Expense | Finding |', '| --- | --- |', '| Vercel | About ₱1,276 a month |'].join(
          '\n'
        ),
        referenceMode: 'claim',
        references: [
          {
            id: 'vercel-evidence',
            token: 'Vercel',
            aliases: ['Vercel'],
            label: 'Vercel',
            kind: 'transaction',
            source_refs: ['transaction:vercel-apr', 'transaction:vercel-may']
          }
        ],
        onOpenReference: () => {}
      })
    );

    expect(html).toContain('<td>Vercel</td>');
    expect(html.match(/class="markdown-source-reference"/g)).toHaveLength(1);
    expect(html).not.toContain('class="markdown-reference"');
  });

  it('keeps one explicit source with each factual table row', () => {
    const references = [
      [
        '#cavalry-source-1',
        'Vercel evidence',
        ['transaction:vercel-apr', 'transaction:vercel-may']
      ],
      ['#cavalry-source-2', 'Hosting evidence', ['transaction:hosting-apr']],
      ['#cavalry-source-3', 'AirPods installment', ['recurringItem:airpods']]
    ].map(([anchor, label, source_refs], index) => ({
      id: `citation-${index + 1}`,
      anchor,
      token: 'source',
      label,
      kind: index === 2 ? 'recurringItem' : 'transaction',
      source_refs
    }));
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: [
          '| Expense | Finding |',
          '| --- | --- |',
          '| Vercel | About ₱1,276/month [source](#cavalry-source-1) |',
          '| Hosting | Last found in April [source](#cavalry-source-2) |',
          '| AirPods installment | Installment 08/12 [source](#cavalry-source-3) |'
        ].join('\n'),
        referenceMode: 'claim',
        references,
        onOpenReference: () => {}
      })
    );

    expect(html.match(/class="markdown-source-reference"/g)).toHaveLength(3);
    expect(html).toContain('Open 2 sources: Vercel evidence, 2 transactions');
    expect(html).toContain('Open source: Hosting evidence, transaction');
    expect(html).toContain('Open source: AirPods installment, recurring');
    expect(html).toContain('>recurring</button>');
    expect(html).not.toContain('class="markdown-reference"');
  });

  it('keeps one explicit source beside each factual bullet', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: [
          '- Vercel looks monthly. [source](#cavalry-source-1)',
          '- Hosting is uncertain. [source](#cavalry-source-2)'
        ].join('\n'),
        referenceMode: 'claim',
        references: [
          {
            anchor: '#cavalry-source-1',
            token: 'source',
            label: 'Vercel evidence',
            kind: 'transaction',
            source_refs: ['transaction:vercel-apr', 'transaction:vercel-may']
          },
          {
            anchor: '#cavalry-source-2',
            token: 'source',
            label: 'Hosting evidence',
            kind: 'transaction',
            source_refs: ['transaction:hosting-apr']
          }
        ],
        onOpenReference: () => {}
      })
    );

    expect(html.match(/class="markdown-source-reference"/g)).toHaveLength(2);
    expect(html).toContain('Open 2 sources: Vercel evidence, 2 transactions');
    expect(html).toContain('Open source: Hosting evidence, transaction');
  });

  it('captions source chips with the detail that tells them apart', () => {
    const chip = (reference) =>
      renderToStaticMarkup(
        React.createElement(MarkdownText, {
          text: 'Fact. [source](#cavalry-source-1)',
          referenceMode: 'claim',
          references: [{ anchor: '#cavalry-source-1', token: 'source', ...reference }],
          onOpenReference: () => {}
        })
      );

    const datedTransaction = chip({
      label: 'ChatGPT Pro',
      kind: 'transaction',
      source_refs: ['transaction:openai-jun'],
      detail: { date: '2026-06-14', amount: 6490, currency: 'PHP' }
    });
    expect(datedTransaction).toContain('>Jun 14</button>');
    expect(datedTransaction).toContain('aria-label="Open source: ChatGPT Pro, Jun 14"');
    expect(datedTransaction).toContain('title="Open ChatGPT Pro — Jun 14"');

    const transactionRange = chip({
      label: 'Vercel evidence',
      kind: 'transaction',
      source_refs: ['transaction:vercel-apr', 'transaction:vercel-may'],
      detail: {
        records: [
          { source_ref: 'transaction:vercel-apr', detail: { date: '2026-04-08' } },
          { source_ref: 'transaction:vercel-may', detail: { date: '2026-05-08' } }
        ]
      }
    });
    expect(transactionRange).toContain('>Apr 8–May 8</button>');

    const sameDayPair = chip({
      label: 'Coffee',
      kind: 'transaction',
      source_refs: ['transaction:txn-one', 'transaction:txn-two'],
      detail: {
        records: [
          { source_ref: 'transaction:txn-one', detail: { date: '2026-07-11' } },
          { source_ref: 'transaction:txn-two', detail: { date: '2026-07-11' } }
        ]
      }
    });
    expect(sameDayPair).toContain('>Jul 11 ×2</button>');
    expect(sameDayPair).toContain('aria-label="Open 2 sources: Coffee, 2 transactions on Jul 11"');

    const crossYearPair = chip({
      label: 'Annual plan',
      kind: 'transaction',
      source_refs: ['transaction:plan-2025', 'transaction:plan-2026'],
      detail: {
        records: [
          { source_ref: 'transaction:plan-2025', detail: { date: '2025-06-14' } },
          { source_ref: 'transaction:plan-2026', detail: { date: '2026-06-14' } }
        ]
      }
    });
    expect(crossYearPair).toContain('>Jun 2025–Jun 2026</button>');
    expect(crossYearPair).toContain(
      'aria-label="Open 2 sources: Annual plan, Jun 2025 to Jun 2026"'
    );
    expect(crossYearPair).not.toContain('×2');

    const partlyUndatedPair = chip({
      label: 'Mixed evidence',
      kind: 'evidence',
      source_refs: ['transaction:txn-one', 'account:bpi'],
      detail: {
        records: [
          { source_ref: 'transaction:txn-one', detail: { date: '2026-06-14' } },
          { source_ref: 'account:bpi', detail: { accountId: 'bpi' } }
        ]
      }
    });
    expect(partlyUndatedPair).toContain('>2 records</button>');
    expect(partlyUndatedPair).not.toContain('×2');

    const malformedDate = chip({
      label: 'Odd row',
      kind: 'transaction',
      source_refs: ['transaction:odd'],
      detail: { date: '2025-02-30' }
    });
    expect(malformedDate).toContain('>transaction</button>');
    expect(malformedDate).not.toContain('Mar 2');

    const undatedAmount = chip({
      label: 'Coffee',
      kind: 'transaction',
      source_refs: ['transaction:txn-one'],
      detail: { amount: 2000, currency: 'PHP' }
    });
    expect(undatedAmount).toContain('>₱2,000.00</button>');

    const evidenceSet = chip({
      label: 'Monthly fixed-expense estimate',
      kind: 'evidence',
      source_refs: ['transaction:openai-jun', 'transaction:vercel-may', 'recurringItem:airpods'],
      detail: { sourceCount: 3 }
    });
    expect(evidenceSet).toContain('>3 records</button>');

    const bill = chip({
      label: 'AirPods installment',
      kind: 'recurringItem',
      source_refs: ['recurringItem:airpods'],
      detail: { kind: 'bill' }
    });
    expect(bill).toContain('>bill</button>');

    const anchoredBill = chip({
      label: 'AirPods installment',
      kind: 'recurringItem',
      source_refs: ['recurringItem:airpods'],
      detail: {
        sourceCount: 1,
        records: [
          { source_ref: 'recurringItem:airpods', kind: 'recurringItem', detail: { kind: 'bill' } }
        ]
      }
    });
    expect(anchoredBill).toContain('>bill</button>');

    const account = chip({
      label: 'BPI Savings',
      kind: 'account',
      source_refs: ['account:bpi'],
      detail: {}
    });
    expect(account).toContain('>account</button>');

    const budgetRow = chip({
      label: 'Food',
      kind: 'budget',
      source_refs: ['budget:sheet-jun:food'],
      detail: { sheetName: 'June' }
    });
    expect(budgetRow).toContain('>June budget</button>');

    const anchoredBudgetRow = chip({
      label: 'Food',
      kind: 'budget',
      source_refs: ['budget:sheet-jun:food'],
      detail: {
        sourceCount: 1,
        records: [
          {
            source_ref: 'budget:sheet-jun:food',
            kind: 'budget',
            detail: { sheetName: 'June', categoryName: 'Food' }
          }
        ]
      }
    });
    expect(anchoredBudgetRow).toContain('>June budget</button>');

    const singleSheet = chip({
      label: 'June',
      kind: 'sheet',
      source_refs: ['sheet:sheet-jun'],
      detail: {}
    });
    expect(singleSheet).toContain('>June budget</button>');

    const multiSheet = chip({
      label: 'Supporting records',
      kind: 'sheet',
      source_refs: ['sheet:sheet-may', 'sheet:sheet-jun'],
      detail: {
        sourceCount: 2,
        records: [
          { source_ref: 'sheet:sheet-may', kind: 'sheet', detail: { sheetName: 'May' } },
          { source_ref: 'sheet:sheet-jun', kind: 'sheet', detail: { sheetName: 'June' } }
        ]
      }
    });
    expect(multiSheet).toContain('>2 budget months</button>');
    expect(multiSheet).not.toContain('Supporting records budg');
  });

  it('renders pipe tables as structured tables with column alignment', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: [
          'Recommended plan:',
          '| Category | Monthly cap |',
          '|---|---:|',
          '| **Subscriptions** | ₱6,490 |',
          '| Food | ₱7,000 |',
          '',
          'Adjust as needed.'
        ].join('\n')
      })
    );

    expect(html).toContain('<p>Recommended plan:</p>');
    expect(html).toContain('<div class="markdown-table-wrap">');
    expect(html).toContain('<table class="markdown-table">');
    expect(html).toContain('<th>Category</th>');
    expect(html).toContain('<th data-align="right">Monthly cap</th>');
    expect(html).toContain('<td><strong>Subscriptions</strong></td>');
    expect(html).toContain('<td data-align="right">₱6,490</td>');
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(html).toContain('<p>Adjust as needed.</p>');
    expect(html).not.toContain('|');
  });

  it('pads short table rows and drops cells beyond the header width', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: ['| A | B |', '| :---: | --- |', '| only-a |', '| a2 | b2 | extra |'].join('\n')
      })
    );

    expect(html).toContain('<th data-align="center">A</th>');
    expect(html).toContain('<td data-align="center">only-a</td>');
    expect(html).toContain('<td></td>');
    expect(html).not.toContain('extra');
  });

  it('keeps escaped pipes inside table cells as literal text', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: ['| Name | Note |', '| --- | --- |', '| a \\| b | fine |'].join('\n')
      })
    );

    expect(html).toContain('<td>a | b</td>');
  });

  it('leaves pipe lines without a separator row as plain paragraphs', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: 'either | or'
      })
    );

    expect(html).toContain('<p>either | or</p>');
    expect(html).not.toContain('<table');
  });

  it('ends a table at the next block even without a blank line between', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: ['| A | B |', '| --- | --- |', '| 1 | 2 |', '## Costs | Fees', '- item | note'].join(
          '\n'
        )
      })
    );

    expect(html).toContain('<td>1</td>');
    expect(html).toContain('<h2 class="markdown-heading">Costs | Fees</h2>');
    expect(html).toContain('<li>item | note</li>');
    expect(html).not.toContain('<td>## Costs</td>');
  });

  it('lets a table without leading pipes interrupt a paragraph', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: ['Totals below:', 'Name | Amount', '--- | ---', 'Rent | 100'].join('\n')
      })
    );

    expect(html).toContain('<p>Totals below:</p>');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('<td>Rent</td>');
    expect(html).not.toContain('---');
  });

  it('keeps a lone pipe-led continuation line inside its paragraph', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: 'Choose\n| left or right'
      })
    );

    expect(html).toContain('<p>Choose | left or right</p>');
  });

  it('caps degenerate table dimensions instead of exploding the element tree', () => {
    const wideHeader = `|${Array.from({ length: 30 }, (_v, i) => ` c${i} |`).join('')}`;
    const wideSeparator = `|${' --- |'.repeat(30)}`;
    const wide = renderToStaticMarkup(
      React.createElement(MarkdownText, { text: `${wideHeader}\n${wideSeparator}\n| x |` })
    );
    expect(wide).not.toContain('<table');

    const tall = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: ['| A |', '| --- |', ...Array.from({ length: 500 }, (_v, i) => `| r${i} |`)].join(
          '\n'
        )
      })
    );
    expect(tall.match(/<tr>/g).length).toBeLessThanOrEqual(401);
  });

  it('keeps Unicode case folding aligned with the original visible text', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownText, {
        text: 'İ and İ',
        references: [
          {
            id: 'account:unicode',
            token: 'İ',
            aliases: ['İ'],
            label: 'İ',
            kind: 'account',
            source_refs: ['account:unicode']
          }
        ],
        onOpenReference: () => {}
      })
    );

    expect(html.match(/class="markdown-reference"/g)).toHaveLength(2);
    expect(html.match(/>İ<\/button>/g)).toHaveLength(2);
  });
});
