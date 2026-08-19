import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SanitizedRichText } from '../../src/renderer/shared/SanitizedRichText.jsx';

describe('SanitizedRichText', () => {
  it('preserves audited application markup and data callbacks', () => {
    const html = renderToStaticMarkup(
      React.createElement(SanitizedRichText, {
        html: '<button class="btn" data-action="open-review" aria-label="Review">Review &amp; apply</button>'
      })
    );

    expect(html).toContain('class="btn"');
    expect(html).toContain('data-action="open-review"');
    expect(html).toContain('aria-label="Review"');
    expect(html).toContain('Review &amp; apply');
  });

  it('removes executable tags, event handlers, unsafe URLs, and CSS URLs', () => {
    const html = renderToStaticMarkup(
      React.createElement(SanitizedRichText, {
        html: [
          '<script>alert(1)</script>',
          '<a href="javascript:alert(2)" onclick="alert(3)">Unsafe</a>',
          '<img src="data:text/html;base64,PHNjcmlwdD4=" onerror="alert(4)">',
          '<span style="color:#fff;background-image:url(javascript:alert(5))">Safe text</span>'
        ].join('')
      })
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('background-image');
    expect(html).toContain('Safe text');
  });
});
