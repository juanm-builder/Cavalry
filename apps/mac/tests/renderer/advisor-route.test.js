import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdvisorRoute } from '../../src/renderer/features/advisor/AdvisorRoute.jsx';

function makeModel(overrides = {}) {
  return {
    activeThreadId: 'thread-1',
    threadOpen: true,
    sourceOpen: true,
    threads: [
      {
        id: 'thread-1',
        title: 'June spending review',
        updatedAt: '2026-07-01',
        messages: [
          {
            id: 'message-1',
            role: 'user',
            text: 'What changed?',
            createdAt: '09:00',
            attachments: [
              { id: 'attachment-1', name: 'receipt.png', kind: 'image', mimeType: 'image/png' }
            ]
          },
          {
            id: 'message-2',
            role: 'assistant',
            format: 'rich',
            richText: '<p><strong>Spending rose.</strong></p>',
            createdAt: '09:01',
            references: [{ id: 'ref-1', label: 'Ledger', sourceRefs: ['transaction:txn-1'] }]
          }
        ]
      }
    ],
    sources: [
      {
        id: 'transaction:txn-1',
        label: 'Coffee transaction',
        detail: 'PHP 250',
        kind: 'transaction'
      }
    ],
    questionPresets: ['What changed this month?'],
    attachments: [
      { id: 'composer-1', name: 'statement.pdf', kind: 'document', mimeType: 'application/pdf' }
    ],
    voice: { status: 'recording', availability: { available: true }, copy: 'Listening' },
    ...overrides
  };
}

describe('AdvisorRoute', () => {
  it('renders structured threads, messages, sources, and attachments', () => {
    const html = renderToStaticMarkup(React.createElement(AdvisorRoute, { model: makeModel() }));

    expect(html).toContain('data-react-route="advisor"');
    expect(html).toContain('advisor-workspace advisor-source-open');
    expect(html).toContain('advisor-thread-panel');
    expect(html).toContain('June spending review');
    expect(html).toContain('What changed?');
    expect(html).toContain('<strong>Spending rose.</strong>');
    expect(html).toContain('Coffee transaction');
    expect(html).toContain('receipt.png');
    expect(html).toContain('statement.pdf');
    expect(html).toContain('aria-label="Add attachment"');
    expect(html).not.toContain('messagesHtml');
    expect(html).not.toContain('data-action=');
  });

  it('renders empty chat and collapsed side panels from structured state', () => {
    const html = renderToStaticMarkup(
      React.createElement(AdvisorRoute, {
        model: makeModel({
          activeThreadId: '',
          threads: [],
          sources: [],
          attachments: [],
          threadOpen: false,
          sourceOpen: false,
          voice: { status: 'idle', availability: { available: false, message: 'Unavailable' } }
        })
      })
    );

    expect(html).toContain('advisor-thread-collapsed');
    expect(html).toContain('advisor-source-collapsed');
    expect(html).toContain('Start a new Advisor chat');
    expect(html).toContain('What changed this month?');
    expect(html).not.toContain('advisor-source-drawer');
  });
});
