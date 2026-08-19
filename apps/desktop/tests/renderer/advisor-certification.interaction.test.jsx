import React, { act, useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createTransactionBatchDraftGroup } from '@cavalry/action-review/application/drafts/external-draft-service.js';
import { createAdvisorProvider } from '@cavalry/advisor/application/ai/advisor-provider-interface.js';
import { AdvisorRoute } from '../../src/renderer/features/advisor/AdvisorRoute.jsx';
import { DraftReviewRoute } from '../../src/renderer/features/drafts/DraftReviewRoute.jsx';

const CERTIFICATION_TIME = '2026-07-01T09:00:00.000Z';

function makeWorkbook() {
  return {
    id: 'advisor-certification-workbook',
    version: 2,
    name: 'Advisor Certification',
    year: 2026,
    currency: 'PHP',
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
    settings: { activeAdvisorThreadId: '' },
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        currency: 'PHP',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        linkedAccountId: 'food-expense',
        isActive: true
      }
    ],
    counterparties: [],
    transactions: [],
    recurringItems: [],
    sheets: [{ id: 'sheet-july', budgets: [] }],
    advisorThreads: [],
    aiDrafts: [],
    advisorDraftGroups: [],
    externalDraftGroups: [],
    externalDraftAuditEvents: [],
    externalDraftIdempotencyRecords: [],
    checkpoints: [],
    checkpointAuditEvents: [],
    checkpointIdempotencyRecords: []
  };
}

function makeServices(provider) {
  const counters = {};
  return {
    provider,
    settings: {
      enabled: true,
      provider: 'local_rules',
      allowDraftCreation: true
    },
    createId(prefix = 'id') {
      counters[prefix] = (counters[prefix] || 0) + 1;
      return `${prefix}_${counters[prefix]}`;
    },
    now: () => CERTIFICATION_TIME,
    today: () => '2026-07-01'
  };
}

function createDraftFirstProvider() {
  return createAdvisorProvider({
    id: 'certification-draft-provider',
    run: async ({ workbook, services }) => {
      const draftGroup = createTransactionBatchDraftGroup({
        workbook,
        caller: {
          user_id: 'certification-user',
          scopes: ['cavalry.draft.apply'],
          allowed_workbook_ids: [workbook.id]
        },
        request: {
          date_default: '2026-07-01',
          currency_default: 'PHP',
          transactions: [
            {
              description: 'Coffee beans',
              amount: 250,
              direction: 'expense',
              payment_account_hint: 'Cash',
              category_hint: 'Food'
            }
          ]
        },
        createId: services.createId,
        now: services.now
      });
      return {
        ok: true,
        status: 'draft_prepared',
        message: 'I prepared a transaction draft for review. Nothing has been posted.',
        draftGroup,
        actions: [
          {
            id: 'review-prepared-draft',
            type: 'open_draft_review',
            label: 'Review prepared draft',
            draftGroupId: draftGroup.draft_group_id
          }
        ]
      };
    }
  });
}

function coreLedger(workbook) {
  return {
    accounts: workbook.accounts,
    categories: workbook.categories,
    transactions: workbook.transactions,
    recurringItems: workbook.recurringItems
  };
}

function CertificationHarness({ initialWorkbook, services, onResult, onIntent }) {
  const [workbook, setWorkbook] = useState(initialWorkbook);
  const [route, setRoute] = useState('advisor');

  function handleResult(result) {
    onResult?.(result);
    if (result.ok) setWorkbook(result.workbook);
  }

  function handleIntent(intent) {
    onIntent?.(intent);
    if (intent.type === 'advisor/provider-action') setRoute('drafts');
  }

  return (
    <>
      <output aria-label="Certification route">{route}</output>
      <output aria-label="Certification workbook">{JSON.stringify(workbook)}</output>
      {route === 'advisor' ? (
        <AdvisorRoute
          onCommandResult={handleResult}
          onIntent={handleIntent}
          services={services}
          workbook={workbook}
        />
      ) : (
        <DraftReviewRoute onCommandResult={handleResult} services={services} workbook={workbook} />
      )}
    </>
  );
}

async function prepareDraftThroughAdvisor({ user, workbook, onResult, onIntent = vi.fn() }) {
  render(
    <CertificationHarness
      initialWorkbook={workbook}
      onIntent={onIntent}
      onResult={onResult}
      services={makeServices(createDraftFirstProvider())}
    />
  );
  await user.type(screen.getByRole('textbox', { name: 'Ask Advisor' }), 'Add coffee beans');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  expect(
    await screen.findByText('I prepared a transaction draft for review. Nothing has been posted.')
  ).not.toBeNull();
  return { onIntent };
}

describe('Advisor UI safety certification', () => {
  it('stages a draft without ledger mutation and applies it only after visible confirmation', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const originalCore = structuredClone(coreLedger(workbook));
    const onResult = vi.fn();
    const { onIntent } = await prepareDraftThroughAdvisor({ user, workbook, onResult });

    const advisorResult = onResult.mock.calls[0][0];
    expect(advisorResult.ok).toBe(true);
    expect(advisorResult.workbook).not.toBe(workbook);
    expect(coreLedger(advisorResult.workbook)).toEqual(originalCore);
    expect(advisorResult.workbook.externalDraftGroups).toHaveLength(1);
    expect(coreLedger(workbook)).toEqual(originalCore);

    await user.click(screen.getByRole('button', { name: 'Review prepared draft' }));
    expect(onIntent).toHaveBeenCalledWith({
      type: 'advisor/provider-action',
      payload: expect.objectContaining({ draftGroupId: expect.any(String) })
    });
    expect(screen.getByLabelText('Certification route').textContent).toBe('drafts');
    expect(screen.getAllByText('Coffee beans').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Review & Apply' }));
    const dialog = screen.getByRole('dialog', { name: 'Apply Draft' });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(screen.getByLabelText('Certification workbook').textContent).transactions
    ).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Apply Selected' }));
    expect(await screen.findByRole('heading', { name: 'All caught up' })).not.toBeNull();
    const applyResult = onResult.mock.calls[1][0];
    expect(applyResult.ok).toBe(true);
    expect(applyResult.events[0].type).toBe('draft.applied');
    expect(applyResult.workbook.transactions).toHaveLength(1);
    expect(applyResult.workbook.transactions[0].description).toBe('Coffee beans');
    expect(coreLedger(workbook)).toEqual(originalCore);
  });

  it('keeps rejection cancellable and rejects without changing ledger data', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const originalCore = structuredClone(coreLedger(workbook));
    const onResult = vi.fn();
    await prepareDraftThroughAdvisor({ user, workbook, onResult });
    await user.click(screen.getByRole('button', { name: 'Review prepared draft' }));

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    let dialog = screen.getByRole('dialog', { name: 'Reject Draft' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onResult).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    dialog = screen.getByRole('dialog', { name: 'Reject Draft' });
    await user.click(within(dialog).getByRole('button', { name: 'Reject Draft' }));

    expect(await screen.findByRole('heading', { name: 'All caught up' })).not.toBeNull();
    const rejectResult = onResult.mock.calls[1][0];
    expect(rejectResult.events[0].type).toBe('draft.rejected');
    expect(rejectResult.workbook.externalDraftGroups[0].status).toBe('rejected');
    expect(coreLedger(rejectResult.workbook)).toEqual(originalCore);
    expect(coreLedger(workbook)).toEqual(originalCore);
  });

  it('shows the built-in safe fallback when a configured provider fails', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const onResult = vi.fn();
    const failedProvider = createAdvisorProvider({
      id: 'certification-offline-provider',
      run: async () => {
        throw new Error('Provider offline');
      }
    });
    render(
      <CertificationHarness
        initialWorkbook={workbook}
        onIntent={vi.fn()}
        onResult={onResult}
        services={makeServices(failedProvider)}
      />
    );

    await user.type(screen.getByRole('textbox', { name: 'Ask Advisor' }), 'Show a summary');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    const messageList = document.querySelector('.advisor-message-list');
    expect(await within(messageList).findByText(/Income:/)).not.toBeNull();
    const result = onResult.mock.calls[0][0];
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'advisor.provider_fallback' })
    );
    expect(coreLedger(result.workbook)).toEqual(coreLedger(workbook));
  });

  it('cancels a pending turn and ignores the provider response that arrives later', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const onResult = vi.fn();
    const onIntent = vi.fn();
    let resolveProvider;
    const slowProvider = createAdvisorProvider({
      id: 'certification-slow-provider',
      run: () =>
        new Promise((resolve) => {
          resolveProvider = resolve;
        })
    });
    render(
      <CertificationHarness
        initialWorkbook={workbook}
        onIntent={onIntent}
        onResult={onResult}
        services={makeServices(slowProvider)}
      />
    );

    await user.type(screen.getByRole('textbox', { name: 'Ask Advisor' }), 'Wait for provider');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await user.click(await screen.findByRole('button', { name: 'Stop thinking' }));

    expect(onIntent).toHaveBeenCalledWith({
      type: 'advisor/request-cancel',
      payload: { threadId: '' }
    });
    await act(async () => {
      resolveProvider({ ok: true, status: 'answered', message: 'Late unsafe response' });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByText('Late unsafe response')).toBeNull());
    expect(onResult).not.toHaveBeenCalled();
    expect(coreLedger(workbook)).toEqual(coreLedger(makeWorkbook()));
  });
});
