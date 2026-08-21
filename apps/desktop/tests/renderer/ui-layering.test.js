import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const productRevisionStyles = readFileSync(
  new URL('../../styles/22-product-revisions.css', import.meta.url),
  'utf8'
);
const financeFriendlyStyles = readFileSync(
  new URL('../../styles/28-finance-friendly.css', import.meta.url),
  'utf8'
);
const assistantStyles = readFileSync(
  new URL('../../styles/features/assistant/22-cavalry-assistant.css', import.meta.url),
  'utf8'
);

function ruleZIndex(source, selector) {
  const ruleStart = source.indexOf(`${selector} {`);
  if (ruleStart < 0) throw new Error(`Missing CSS rule for ${selector}`);
  const ruleEnd = source.indexOf('}', ruleStart);
  const match = /z-index:\s*(\d+)/.exec(source.slice(ruleStart, ruleEnd));
  if (!match) throw new Error(`Missing numeric z-index for ${selector}`);
  return Number(match[1]);
}

describe('UI overlay layering', () => {
  it('keeps portaled category controls above body-level finance dialogs', () => {
    const modalLayer = ruleZIndex(financeFriendlyStyles, 'body > .modal-backdrop');
    const categoryMenuLayer = ruleZIndex(productRevisionStyles, '.categorized-select-menu');
    const categoryCreatorLayer = ruleZIndex(
      productRevisionStyles,
      '.categorized-select-create-backdrop'
    );

    expect(categoryMenuLayer).toBeGreaterThan(modalLayer);
    expect(categoryCreatorLayer).toBeGreaterThan(categoryMenuLayer);
  });

  it('gives Companion replies and Markdown tables comfortable reading space', () => {
    expect(
      /\.cavalry-assistant-messages\s*\{[^}]*gap:\s*22px;[^}]*padding:\s*24px 20px;/s.test(
        assistantStyles
      )
    ).toBe(true);
    expect(
      /\.cavalry-assistant-message\.assistant \.cavalry-assistant-message-content\s*\{[^}]*padding:\s*14px 16px 15px;/s.test(
        assistantStyles
      )
    ).toBe(true);
    expect(
      /\.cavalry-assistant-markdown \.markdown-table th,[\s\S]*?\.markdown-table td\s*\{[^}]*padding:\s*11px 14px;/s.test(
        assistantStyles
      )
    ).toBe(true);
    expect(
      /\.cavalry-assistant-messages\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s.test(
        assistantStyles
      )
    ).toBe(true);
    expect(
      /\.cavalry-assistant-markdown\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s.test(
        assistantStyles
      )
    ).toBe(true);
    expect(
      /\.markdown-table-wrap\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/s.test(
        assistantStyles
      )
    ).toBe(true);
    expect(
      /\.markdown-table\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;[^}]*max-width:\s*none;/s.test(
        assistantStyles
      )
    ).toBe(true);
    expect(
      /\.markdown-table \[data-align='right'\]\s*\{[^}]*text-align:\s*right;[^}]*font-variant-numeric:\s*tabular-nums;[^}]*white-space:\s*nowrap;/s.test(
        assistantStyles
      )
    ).toBe(true);
    expect(
      /\.markdown-table td\s*\{[^}]*overflow-wrap:\s*break-word;[^}]*word-break:\s*normal;[^}]*white-space:\s*normal;[^}]*max-width:\s*34ch;/s.test(
        assistantStyles
      )
    ).toBe(true);
  });
});
