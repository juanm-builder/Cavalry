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
});
