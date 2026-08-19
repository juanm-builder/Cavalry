import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  CAVALRY_ICON_NAMES,
  CavalryIcon,
  hasCavalryIcon
} from '../../src/renderer/shared/CavalryIcon.jsx';
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS
} from '../../src/renderer/features/categories/category-options.js';

function renderIcon(name) {
  return renderToStaticMarkup(React.createElement(CavalryIcon, { name }));
}

describe('CavalryIcon', () => {
  it('renders a bundled Font Awesome SVG without ligature text or a font dependency', () => {
    const html = renderIcon('space_dashboard');

    expect(html).toContain('<svg');
    expect(html).toContain('data-prefix="fas"');
    expect(html).toContain('data-cavalry-icon="space_dashboard"');
    expect(html).toContain('data-icon-source="font-awesome"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('>space_dashboard<');
    expect(html).not.toContain('material-symbols');
  });

  it('provides an explicit, visually distinct glyph for every category option', () => {
    const signatures = CATEGORY_ICONS.map((name) => {
      expect(hasCavalryIcon(name), `${name} should have a local glyph`).toBe(true);
      const html = renderIcon(name);
      expect(html).toContain('data-cavalry-family="category"');
      return html.replace(` data-cavalry-icon="${name}"`, '');
    });

    expect(new Set(signatures).size).toBe(CATEGORY_ICONS.length);
  });

  it('resolves every registered name to Font Awesome SVG geometry', () => {
    CAVALRY_ICON_NAMES.forEach((name) => {
      const html = renderIcon(name);
      expect(html, `${name} should use Font Awesome`).toContain('data-icon-source="font-awesome"');
      expect(html, `${name} should retain visible SVG geometry`).toContain('<path');
    });
  });

  it('keeps category decoration away from financial red and green', () => {
    expect(CATEGORY_COLORS).toEqual([
      '#1a3fe9',
      '#4d79eb',
      '#499eee',
      '#809fec',
      '#c47a2c',
      '#7758b8',
      '#626a78'
    ]);
  });

  it('keeps unknown legacy workbook icons safe and text-free', () => {
    const html = renderIcon('legacy_custom_icon');

    expect(CAVALRY_ICON_NAMES.length).toBeGreaterThan(100);
    expect(html).toContain('data-cavalry-icon="legacy_custom_icon"');
    expect(html).toContain('data-icon-source="font-awesome"');
    expect(html).not.toContain('>legacy_custom_icon<');
  });
});
