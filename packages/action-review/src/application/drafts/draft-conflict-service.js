import { uniqueIssues } from '../../domain/cavalry-action-plan/issues.js';
import { findTransactionDuplicateCandidates } from './duplicate-detection.js';
import { findExternalDraftGroup } from './draft-group-model.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function issue(code, message, detail = {}) {
  return Object.assign(
    {
      code,
      severity: detail.severity || 'blocked',
      message,
      field: detail.field || undefined,
      action_id: detail.actionId || detail.action_id || undefined
    },
    detail
  );
}

function findAccount(workbook, accountId) {
  const id = asString(accountId);
  return id
    ? asArray(workbook && workbook.accounts).find(
        (account) => asString(account && account.id) === id
      ) || null
    : null;
}

function findCategory(workbook, categoryId) {
  const id = asString(categoryId);
  return id
    ? asArray(workbook && workbook.categories).find(
        (category) => asString(category && category.id) === id
      ) || null
    : null;
}

function findTransaction(workbook, transactionId) {
  const id = asString(transactionId);
  return id
    ? asArray(workbook && workbook.transactions).find(
        (transaction) => asString(transaction && transaction.id) === id
      ) || null
    : null;
}

function checkAccount(workbook, accountId, conflicts, field = 'payment_account_id') {
  const id = asString(accountId);
  if (!id) {
    return;
  }
  const account = findAccount(workbook, id);
  if (!account) {
    conflicts.push(
      issue('missing_account', 'Draft account reference no longer exists.', { field, value: id })
    );
  } else if (account.isActive === false) {
    conflicts.push(
      issue('archived_account', 'Draft account reference is archived.', { field, value: id })
    );
  }
}

function checkCategory(workbook, categoryId, conflicts, field = 'category_id') {
  const id = asString(categoryId);
  if (!id) {
    return;
  }
  const category = findCategory(workbook, id);
  if (!category) {
    conflicts.push(
      issue('missing_category', 'Draft category reference no longer exists.', { field, value: id })
    );
  } else if (category.isActive === false) {
    conflicts.push(
      issue('archived_category', 'Draft category reference is archived.', { field, value: id })
    );
  }
}

function detectTransactionDraftConflicts(workbook, draft) {
  const values = draft.proposed_values || {};
  const conflicts = [];
  if (!(Number(values.amount) > 0)) {
    conflicts.push(
      issue('invalid_amount', 'Draft transaction amount is invalid.', { field: 'amount' })
    );
  }
  checkAccount(workbook, values.payment_account_id, conflicts, 'payment_account_id');
  if (values.template !== 'transfer') {
    checkCategory(workbook, values.category_id, conflicts, 'category_id');
  }
  const duplicateCandidates = findTransactionDuplicateCandidates(workbook, {
    date: values.date,
    description: values.description,
    amount: values.amount,
    currency: values.currency,
    payment_account_id: values.payment_account_id
  }).filter((candidate) => asString(candidate.draft_id) !== asString(draft.draft_id));
  const committedDuplicate =
    duplicateCandidates.find((candidate) => candidate.transaction_id) || null;
  if (committedDuplicate) {
    conflicts.push(
      issue(
        'duplicate_transaction_created',
        'A matching transaction was created after this draft was prepared.',
        {
          field: 'amount',
          transaction_id: committedDuplicate.transaction_id
        }
      )
    );
  } else if (duplicateCandidates.length) {
    conflicts.push(
      issue('duplicate_pending_draft', 'Another pending draft looks like this draft.', {
        severity: 'warning',
        field: 'amount',
        draft_id: duplicateCandidates[0].draft_id
      })
    );
  }
  return conflicts;
}

function detectCategoryChangeDraftConflicts(workbook, draft) {
  const values = draft.proposed_values || {};
  const original = draft.original_values || {};
  const conflicts = [];
  const transaction = findTransaction(workbook, values.transaction_id || original.transaction_id);
  if (!transaction) {
    conflicts.push(
      issue('target_transaction_missing', 'The target transaction no longer exists.', {
        field: 'transaction_id',
        transaction_id: values.transaction_id || original.transaction_id
      })
    );
  } else if (
    asString(original.category_id) &&
    asString(transaction.categoryId) !== asString(original.category_id)
  ) {
    conflicts.push(
      issue(
        'target_transaction_changed',
        'The target transaction category changed after this draft was prepared.',
        {
          field: 'category_id',
          transaction_id: transaction.id,
          expected_category_id: original.category_id,
          current_category_id: transaction.categoryId
        }
      )
    );
  }
  checkCategory(workbook, values.suggested_category_id, conflicts, 'suggested_category_id');
  return conflicts;
}

function detectRecurringDraftConflicts(workbook, draft) {
  const values = draft.proposed_values || {};
  const conflicts = [];
  if (Object.prototype.hasOwnProperty.call(values, 'amount') && !(Number(values.amount) > 0)) {
    conflicts.push(
      issue('invalid_amount', 'Draft recurring item amount is invalid.', { field: 'amount' })
    );
  }
  checkAccount(workbook, values.payment_account_id, conflicts, 'payment_account_id');
  checkCategory(workbook, values.category_id, conflicts, 'category_id');
  return conflicts;
}

function detectBudgetDraftConflicts(workbook, draft) {
  const values = draft.proposed_values || {};
  const conflicts = [];
  if (!(Number(values.amount) > 0)) {
    conflicts.push(issue('invalid_amount', 'Draft budget amount is invalid.', { field: 'amount' }));
  }
  checkCategory(workbook, values.category_id, conflicts, 'category_id');
  if (!asArray(workbook && workbook.sheets).length) {
    conflicts.push(
      issue('missing_budget_sheet', 'No budget sheet exists for this draft.', { field: 'sheet' })
    );
  }
  return conflicts;
}

export function detectDraftItemConflicts(workbook, draft, options = {}) {
  const conflicts = [];
  if (!draft) {
    return [issue('draft_not_found', 'Draft was not found.')];
  }
  if (options.requireReady !== false && draft.status !== 'ready') {
    conflicts.push(
      issue('draft_not_ready', 'Only ready drafts can be applied.', {
        field: 'status',
        draft_id: draft.draft_id,
        status: draft.status
      })
    );
  }
  if (draft.type === 'transaction') {
    conflicts.push(...detectTransactionDraftConflicts(workbook, draft));
  } else if (draft.type === 'category_change') {
    conflicts.push(...detectCategoryChangeDraftConflicts(workbook, draft));
  } else if (draft.type === 'recurring_item') {
    conflicts.push(...detectRecurringDraftConflicts(workbook, draft));
  } else if (draft.type === 'budget_change') {
    conflicts.push(...detectBudgetDraftConflicts(workbook, draft));
  } else {
    conflicts.push(
      issue('unsupported_draft_type', 'Unsupported draft type: ' + asString(draft.type), {
        field: 'type',
        draft_id: draft.draft_id
      })
    );
  }
  return uniqueIssues(conflicts).map((conflict) =>
    Object.assign({}, conflict, {
      draft_id: asString(draft.draft_id),
      draft_type: asString(draft.type)
    })
  );
}

export function detectDraftGroupConflicts(workbook, draftGroupOrId, options = {}) {
  const group =
    typeof draftGroupOrId === 'string'
      ? findExternalDraftGroup(workbook, draftGroupOrId)
      : draftGroupOrId;
  const conflicts = [];
  if (!group) {
    conflicts.push(issue('draft_group_not_found', 'Draft group was not found.'));
  } else if (group.status === 'rejected') {
    conflicts.push(issue('draft_group_rejected', 'Rejected draft groups cannot be applied.'));
  } else if (group.status === 'applied') {
    return {
      ok: true,
      group,
      conflicts: [],
      blockingConflicts: [],
      warningConflicts: []
    };
  }
  const selected =
    Array.isArray(options.selectedDraftIds) && options.selectedDraftIds.length
      ? new Set(options.selectedDraftIds.map(asString))
      : null;
  const drafts = group && Array.isArray(group.drafts) ? group.drafts : [];
  const selectedDrafts = selected
    ? drafts.filter((draft) => selected.has(asString(draft.draft_id)))
    : drafts;
  if (selected && selectedDrafts.length !== selected.size) {
    conflicts.push(issue('draft_not_found', 'A selected draft was not found.'));
  }
  selectedDrafts.forEach((draft) => {
    conflicts.push(...detectDraftItemConflicts(workbook, draft, options));
  });
  const unique = uniqueIssues(conflicts);
  const blockingConflicts = unique.filter(
    (conflict) => conflict.severity !== 'warning' && conflict.severity !== 'info'
  );
  const warningConflicts = unique.filter((conflict) => conflict.severity === 'warning');
  return {
    ok: blockingConflicts.length === 0,
    group,
    conflicts: unique,
    blockingConflicts,
    warningConflicts
  };
}
