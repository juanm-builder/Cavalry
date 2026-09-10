import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APPEARANCE_THEMES } from '../../src/renderer/app/appearance-preferences.js';
import { BudgetTransactionsModal } from '../../src/renderer/features/budgets/BudgetTransactionsModal.jsx';
import { BudgetCategoryAvatar } from '../../src/renderer/features/budgets/budget-view-helpers.jsx';

const styleEntry = resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/app.css');
const styles = [...readFileSync(styleEntry, 'utf8').matchAll(/@import\s+'([^']+)'/g)]
  .map((match) => readFileSync(resolve(dirname(styleEntry), match[1]), 'utf8'))
  .join('\n');
let stylesheet;

beforeEach(() => {
  // Load the production cascade: the original bug only appeared when a later
  // heading text selector overrode the avatar's grid container inside a portal.
  stylesheet = document.createElement('style');
  stylesheet.textContent = styles;
  document.head.append(stylesheet);
});

afterEach(() => {
  stylesheet.remove();
  delete document.documentElement.dataset.theme;
});

describe.each(APPEARANCE_THEMES.map(({ id }) => id))('budget category rendering in %s', (theme) => {
  it.each([
    { id: 'subscriptions', name: 'Subscriptions', icon: 'receipt_long', color: '#f2c94c' },
    { id: 'coffee', name: 'Coffee and meals', icon: 'local_cafe' }
  ])('keeps $name centered consistently in the row and portaled details', (category) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(
      <>
        <div className="budget-category-list-row">
          <span className="budget-category-list-name">
            <BudgetCategoryAvatar category={category} />
          </span>
        </div>
        <BudgetTransactionsModal
          currency="PHP"
          onClose={() => {}}
          row={{
            category,
            categoryType: 'expense',
            planned: 100,
            actual: 0,
            statusLabel: 'On plan'
          }}
          sheetId="september"
        />
      </>
    );
    const dialog = screen.getByRole('dialog', { name: `${category.name} budget details` });
    const rowAvatar = container.querySelector('.budget-category-avatar');
    const detailAvatar = dialog.querySelector('.budget-category-avatar');
    expect(container.contains(dialog)).toBe(false);
    expect(detailAvatar.style.getPropertyValue('--category-color')).toBe(
      rowAvatar.style.getPropertyValue('--category-color')
    );
    for (const avatar of [rowAvatar, detailAvatar]) {
      const layout = getComputedStyle(avatar);
      const glyph = avatar.querySelector('svg');
      expect(layout.display).toBe('grid');
      expect(layout.placeItems).toBe('center');
      expect(layout.borderRadius).toBe('10px');
      expect(getComputedStyle(glyph).width).toBe('1em');
      expect(getComputedStyle(glyph).height).toBe('1em');
      expect(Number.parseFloat(getComputedStyle(glyph).fontSize)).toBeLessThan(
        Number.parseFloat(layout.width)
      );
      expect(glyph.dataset.cavalryIcon).toBe(category.icon);
    }
    expect(getComputedStyle(screen.getByText('On plan')).display).toBe('block');
  });
});
