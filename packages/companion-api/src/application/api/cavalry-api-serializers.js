import { getDraftGroupReviewUrl } from '@cavalry/action-review/application/drafts/review-url.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function serializeWorkbookSummary(workbook) {
  return {
    workbook_id: asString(workbook && workbook.id),
    name: asString(workbook && workbook.name) || 'Cavalry',
    default_currency: asString(workbook && workbook.currency) || 'PHP',
    timezone: asString(workbook && workbook.timezone) || 'Asia/Manila',
    last_updated_at: asString(
      (workbook && workbook.updatedAt) ||
        (workbook && workbook.updated_at) ||
        (workbook && workbook.createdAt)
    )
  };
}

export function serializeAccount(account, snapshotRow = {}) {
  return {
    account_id: asString(account && account.id),
    display_name: asString(account && account.name),
    type: asString(account && account.group),
    subtype: asString(account && account.subtype),
    currency: asString(account && account.currency),
    selectable_for_transaction_drafts:
      account &&
      account.isActive !== false &&
      account.isSystem !== true &&
      ['asset', 'liability'].includes(asString(account.group)),
    is_active: account && account.isActive !== false,
    is_system: account && account.isSystem === true,
    balance: Object.prototype.hasOwnProperty.call(snapshotRow || {}, 'balance')
      ? snapshotRow.balance
      : undefined,
    balance_currency: asString(snapshotRow && snapshotRow.balance_currency) || undefined,
    balance_as_of: asString(snapshotRow && snapshotRow.as_of) || undefined,
    source_ref:
      asString(snapshotRow && snapshotRow.source_ref) ||
      (account && account.id ? 'account:' + asString(account.id) : undefined)
  };
}

export function serializeCategory(category) {
  return {
    category_id: asString(category && category.id),
    display_name: asString(category && category.name),
    type: asString(category && category.type),
    archived: category && category.isActive === false,
    budget_metadata: category && category.budgetMetadata ? category.budgetMetadata : undefined
  };
}

export function serializeDraftGroup(group) {
  return Object.assign({}, group, {
    review_url:
      group && group.review_url
        ? group.review_url
        : getDraftGroupReviewUrl(group && group.draft_group_id)
  });
}
