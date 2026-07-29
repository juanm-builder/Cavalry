import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createTransactionBatchDraftGroup } from '@cavalry/action-review/application/drafts/external-draft-service.js';
import { buildCheckpointDiff } from '@cavalry/action-review/domain/checkpoints/diff.js';
import { buildInversePatch } from '@cavalry/action-review/domain/checkpoints/inverse-patch.js';
import {
  CATEGORY_ACTIONS,
  executeCategoryCommand
} from '../../src/renderer/features/categories/category-controller.js';
import { DraftReviewRoute } from '../../src/renderer/features/drafts/DraftReviewRoute.jsx';

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return `${prefix}_${counters[prefix]}`;
  };
}

function makeWorkbook() {
  return {
    id: 'draft-interaction-workbook',
    version: 2,
    name: 'Draft Interactions',
    year: 2026,
    currency: 'PHP',
    accounts: [
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true },
      { id: 'food-expense', name: 'Food', group: 'expense', currency: 'PHP', isActive: true }
    ],
    categories: [
      { id: 'food', name: 'Food', type: 'expense', linkedAccountId: 'food-expense', isActive: true }
    ],
    transactions: [],
    recurringItems: [],
    sheets: [{ id: 'sheet-june', budgets: [] }],
    aiDrafts: [],
    advisorDraftGroups: [],
    externalDraftGroups: [],
    checkpoints: [],
    checkpointAuditEvents: [],
    checkpointIdempotencyRecords: []
  };
}

function addDraft(workbook, createId) {
  return createTransactionBatchDraftGroup({
    workbook,
    caller: {
      user_id: 'user-1',
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
    createId,
    now: () => '2026-07-01T09:00:00.000Z'
  });
}

function addCheckpoint(workbook) {
  const before = { id: 'txn-checkpoint', description: 'Before', amount: 100, baseAmount: 100 };
  const after = { id: 'txn-checkpoint', description: 'After', amount: 125, baseAmount: 125 };
  const diff = buildCheckpointDiff(before, after);
  workbook.transactions.push(after);
  workbook.checkpoints.push({
    checkpoint_id: 'checkpoint-1',
    checkpoint_version: '1.0',
    workbook_id: workbook.id,
    actor: { type: 'external_ai', display_name: 'ChatGPT Companion' },
    origin: 'chatgpt_companion',
    status: 'applied',
    created_at: '2026-07-01T08:00:00.000Z',
    source_prompt: 'Update the transaction.',
    summary: { applied: 1, blocked: 0, warnings: 0 },
    changes: [
      {
        change_id: 'change-1',
        action_id: 'action-1',
        action_type: 'update_transaction',
        entity_type: 'transaction',
        entity_id: after.id,
        operation: 'update',
        before: diff.before,
        after: diff.after,
        before_fingerprint: diff.before_fingerprint,
        after_fingerprint: diff.after_fingerprint,
        inverse_patch: buildInversePatch({
          operation: 'update',
          entityType: 'transaction',
          entityId: after.id,
          before,
          after
        }),
        status: 'applied',
        validation_issues: [],
        warnings: [],
        human_summary: 'Updated checkpoint transaction.'
      }
    ],
    validation_issues: [],
    warnings: []
  });
}

function DraftHarness({ initialWorkbook, onResult, services }) {
  const [workbook, setWorkbook] = useState(initialWorkbook);
  function handleResult(result) {
    onResult(result);
    if (result.ok) setWorkbook(result.workbook);
  }
  function handleCreateCategory(payload) {
    const result = executeCategoryCommand(
      workbook,
      { type: CATEGORY_ACTIONS.CREATE, payload },
      services
    );
    if (result.ok) setWorkbook(result.workbook);
    return result;
  }
  return (
    <>
      <output aria-label="Draft workbook state">
        {JSON.stringify({ transactions: workbook.transactions, checkpoints: workbook.checkpoints })}
      </output>
      <DraftReviewRoute
        workbook={workbook}
        onCommandResult={handleResult}
        onCreateCategory={handleCreateCategory}
        services={services}
      />
    </>
  );
}

describe('draft and checkpoint interactions', () => {
  it('applies a selected draft only after explicit confirmation and rerenders', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const createId = makeCreateId();
    addDraft(workbook, createId);
    const onResult = vi.fn();
    render(
      <DraftHarness
        initialWorkbook={workbook}
        onResult={onResult}
        services={{ createId, now: () => '2026-07-01T10:00:00.000Z' }}
      />
    );

    expect(screen.getByText(/prepared these Cavalry drafts/)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Review & Apply' }));
    const dialog = screen.getByRole('dialog', { name: 'Apply Draft' });
    expect(onResult).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Apply Selected' }));

    expect(await screen.findByRole('heading', { name: 'All caught up' })).not.toBeNull();
    const result = onResult.mock.calls[0][0];
    expect(result.ok).toBe(true);
    expect(result.workbook).not.toBe(workbook);
    expect(result.workbook.transactions[0].description).toBe('Coffee beans');
    expect(workbook.transactions).toEqual([]);
  });

  it('rejects a draft through a cancellable confirmation', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const createId = makeCreateId();
    addDraft(workbook, createId);
    const onResult = vi.fn();
    render(
      <DraftHarness
        initialWorkbook={workbook}
        onResult={onResult}
        services={{ createId, now: () => '2026-07-01T10:00:00.000Z' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    let dialog = screen.getByRole('dialog', { name: 'Reject Draft' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onResult).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    dialog = screen.getByRole('dialog', { name: 'Reject Draft' });
    await user.click(within(dialog).getByRole('button', { name: 'Reject Draft' }));
    expect(await screen.findByRole('heading', { name: 'All caught up' })).not.toBeNull();
    expect(onResult.mock.calls[0][0].events[0].type).toBe('draft.rejected');
  });

  it('edits a proposed money field on double-click before applying', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const createId = makeCreateId();
    addDraft(workbook, createId);
    const onResult = vi.fn();
    render(
      <DraftHarness
        initialWorkbook={workbook}
        onResult={onResult}
        services={{ createId, now: () => '2026-07-01T10:00:00.000Z' }}
      />
    );

    await user.dblClick(screen.getByRole('button', { name: /Amount: ₱250\.00/ }));
    const amountInput = screen.getByRole('textbox', { name: 'Edit Amount' });
    await user.clear(amountInput);
    await user.type(amountInput, '1,000.50');
    await user.click(screen.getByRole('button', { name: 'Save Amount' }));

    expect(await screen.findByText('₱1,000.50')).not.toBeNull();
    const result = onResult.mock.calls[0][0];
    expect(result.events[0]).toMatchObject({ type: 'draft.updated' });
    expect(result.workbook.externalDraftGroups[0].drafts[0].proposed_values.amount).toBe(1000.5);
    expect(workbook.externalDraftGroups[0].drafts[0].proposed_values.amount).toBe(250);
  });

  it('creates and selects a category while editing a proposed transaction', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    workbook.categories.push(
      {
        id: 'salary',
        name: 'Salary',
        type: 'income',
        linkedAccountId: 'salary-income',
        isActive: true
      },
      {
        id: 'archived-travel',
        name: 'Archived travel',
        type: 'expense',
        linkedAccountId: 'archived-travel-expense',
        isActive: false
      }
    );
    const createId = makeCreateId();
    addDraft(workbook, createId);
    const onResult = vi.fn();
    render(
      <DraftHarness
        initialWorkbook={workbook}
        onResult={onResult}
        services={{ createId, now: () => '2026-07-01T10:00:00.000Z' }}
      />
    );

    await user.dblClick(screen.getByRole('button', { name: /Category: Food/ }));
    const categorySelect = screen.getByRole('combobox', { name: 'Edit Category' });
    await user.click(categorySelect);
    expect(screen.queryByRole('option', { name: 'Salary' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Archived travel' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Create new category' }));
    const dialog = screen.getByRole('dialog', { name: 'Create new category' });
    expect(within(dialog).queryByLabelText('Category type')).toBeNull();
    await user.type(within(dialog).getByLabelText('Category name'), 'Trip Fund');
    await user.click(within(dialog).getByRole('button', { name: 'Create & select' }));

    expect(categorySelect.textContent).toContain('Trip Fund');
    await user.click(screen.getByRole('button', { name: 'Save Category' }));

    expect(await screen.findByText('Trip Fund')).not.toBeNull();
    const result = onResult.mock.calls.at(-1)[0];
    const createdCategory = result.workbook.categories.find(
      (category) => category.name === 'Trip Fund'
    );
    expect(createdCategory).toMatchObject({ type: 'expense', isActive: true });
    expect(result.workbook.externalDraftGroups[0].drafts[0].proposed_values.amount).toBe(250);
    expect(result.workbook.externalDraftGroups[0].drafts[0].proposed_values.category_id).toBe(
      createdCategory.id
    );
  });

  it('offers inline category creation when a draft has no existing category options', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    workbook.categories = [];
    const createId = makeCreateId();
    addDraft(workbook, createId);
    const onResult = vi.fn();
    render(
      <DraftHarness
        initialWorkbook={workbook}
        onResult={onResult}
        services={{ createId, now: () => '2026-07-01T10:00:00.000Z' }}
      />
    );

    await user.dblClick(screen.getByRole('button', { name: /Category: Not provided/ }));
    const categorySelect = screen.getByRole('combobox', { name: 'Edit Category' });
    await user.click(categorySelect);
    await user.click(screen.getByRole('option', { name: 'Create new category' }));
    const dialog = screen.getByRole('dialog', { name: 'Create new category' });
    await user.type(within(dialog).getByLabelText('Category name'), 'Unplanned trip');
    await user.click(within(dialog).getByRole('button', { name: 'Create & select' }));
    await user.click(screen.getByRole('button', { name: 'Save Category' }));

    const result = onResult.mock.calls.at(-1)[0];
    const createdCategory = result.workbook.categories.find(
      (category) => category.name === 'Unplanned trip'
    );
    expect(createdCategory).toMatchObject({ type: 'expense', isActive: true });
    expect(result.workbook.externalDraftGroups[0].drafts[0].proposed_values.category_id).toBe(
      createdCategory.id
    );
  });

  it('approves and rolls back selected checkpoint changes after preview', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    addCheckpoint(workbook);
    const onResult = vi.fn();
    render(
      <DraftHarness
        initialWorkbook={workbook}
        onResult={onResult}
        services={{ createId: makeCreateId(), now: () => '2026-07-01T11:00:00.000Z' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Keep Changes' }));
    expect(await screen.findByRole('button', { name: 'Approved' })).not.toBeNull();
    expect(onResult.mock.calls[0][0].workbook).not.toBe(workbook);

    await user.click(screen.getByRole('button', { name: 'Preview Rollback' }));
    const dialog = screen.getByRole('dialog', { name: 'Rollback Preview' });
    expect(within(dialog).getByText('1 safe')).not.toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Rollback Selected' }));

    expect(screen.getByLabelText('Draft workbook state').textContent).toContain('Before');
    expect(onResult.mock.calls.at(-1)[0].events[0].type).toBe('checkpoint.rolled_back');
  });
});
