import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DraftReviewRoute } from '../../src/renderer/features/drafts/DraftReviewRoute.jsx';

function makeDraftReviewModel(overrides = {}) {
  return {
    openCount: 1,
    selectedKey: 'external:group-1',
    hiddenQueueCount: 0,
    commandBar: {
      title: '1 draft needs your decision',
      copy: 'Review the ready draft, then apply, save for later, or reject.',
      metrics: [{ id: 'ready', label: 'Ready', count: 1, icon: 'task_alt', tone: 'posted' }]
    },
    checkpoints: {
      visible: true,
      badgeLabel: 'Checkpointed AI actions',
      headerCopy: 'Review reversible changes.',
      sourcePrompt: 'Add coffee.',
      selectedCheckpointId: 'cp-1',
      reviewStatus: '',
      rollbackButton: { disabled: false },
      pickerItems: [
        { checkpointId: 'cp-1', active: true, createdAt: '2026-07-01', appliedCount: 1 }
      ],
      visibleChangeRows: [
        {
          changeId: 'change-1',
          reversible: true,
          icon: 'task_alt',
          title: 'Create Transaction',
          summary: 'Created coffee transaction.',
          statusLabel: 'applied',
          statusTone: 'info'
        }
      ]
    },
    queueItems: [
      {
        key: 'external:group-1',
        kind: 'external-group',
        id: 'group-1',
        title: 'Coffee transaction',
        summary: '1 ready · 0 issues',
        status: 'pending_review',
        statusLabel: 'pending review',
        statusTone: 'good',
        createdAt: '2026-07-01',
        amountDisplay: '1 proposal',
        canApply: true,
        canReject: true,
        blockingConflicts: [],
        source: {
          visible: true,
          originLabel: 'ChatGPT prepared these Cavalry drafts.',
          rows: [{ id: 'source', label: 'ChatGPT' }]
        },
        drafts: [
          {
            id: 'draft-1',
            title: 'Coffee',
            summary: 'Create expense',
            type: 'transaction',
            status: 'ready',
            ready: true,
            proposedRows: [{ key: 'amount', label: 'Amount', value: '250' }]
          }
        ]
      }
    ],
    recentDecisions: [
      { key: 'old-1', title: 'Old draft', status: 'rejected', resolvedAt: '2026-06-30' }
    ],
    ...overrides
  };
}

describe('DraftReviewRoute', () => {
  it('renders structured draft, source, approval, and checkpoint models as JSX', () => {
    const html = renderToStaticMarkup(
      React.createElement(DraftReviewRoute, {
        model: makeDraftReviewModel()
      })
    );

    expect(html).toContain('data-react-route="ai-drafts"');
    expect(html).toContain('Review Drafts');
    expect(html).toContain('1 draft needs your decision');
    expect(html).toContain('Checkpointed AI actions');
    expect(html).toContain('Coffee transaction');
    expect(html).toContain('ChatGPT prepared these Cavalry drafts.');
    expect(html).toContain('Review &amp; Apply');
    expect(html).toContain('Recently handled');
    expect(html).not.toContain('data-action=');
    expect(html).not.toContain('commandBarHtml');
  });

  it('renders a native empty state without HTML fragments', () => {
    const html = renderToStaticMarkup(
      React.createElement(DraftReviewRoute, {
        model: makeDraftReviewModel({
          openCount: 0,
          selectedKey: '',
          queueItems: [],
          checkpoints: { visible: false },
          recentDecisions: []
        })
      })
    );

    expect(html).toContain('All caught up');
    expect(html).not.toContain('ai-drafts-review-workspace');
  });
});
