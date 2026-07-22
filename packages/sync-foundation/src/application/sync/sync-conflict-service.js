import { asArray, asString, createSyncIssue } from './sync-types.js';

function keyForChange(change) {
  return [asString(change && change.entity_type), asString(change && change.entity_id)].join(':');
}

function findById(items, id) {
  const key = asString(id);
  return key ? asArray(items).find((item) => asString(item && item.id) === key) || null : null;
}

function pushUnique(conflicts, issue) {
  const key = [
    issue.code,
    issue.entity_type,
    issue.entity_id,
    issue.field,
    issue.value,
    issue.local_change_id,
    issue.remote_change_id
  ]
    .map(asString)
    .join('|');
  if (
    !conflicts.some(
      (existing) =>
        [
          existing.code,
          existing.entity_type,
          existing.entity_id,
          existing.field,
          existing.value,
          existing.local_change_id,
          existing.remote_change_id
        ]
          .map(asString)
          .join('|') === key
    )
  ) {
    conflicts.push(issue);
  }
}

function collectTransactionAccountIds(transaction) {
  const ids = [];
  if (transaction) {
    ids.push(
      transaction.primaryAccountId,
      transaction.payment_account_id,
      transaction.paymentAccountId
    );
    asArray(transaction.lines).forEach((line) =>
      ids.push(line && (line.accountId || line.account_id))
    );
  }
  return ids.map(asString).filter(Boolean);
}

function collectDraftGroupRefs(group) {
  const accountIds = [];
  const categoryIds = [];
  asArray(group && group.drafts).forEach((draft) => {
    const values = (draft && (draft.proposed_values || draft.proposedValues)) || {};
    accountIds.push(
      values.payment_account_id,
      values.paymentAccountId,
      values.account_id,
      values.accountId
    );
    categoryIds.push(
      values.category_id,
      values.categoryId,
      values.suggested_category_id,
      values.suggestedCategoryId
    );
  });
  return {
    accountIds: accountIds.map(asString).filter(Boolean),
    categoryIds: categoryIds.map(asString).filter(Boolean)
  };
}

function detectReferenceConflictsForChange(workbook, change) {
  const conflicts = [];
  const entityType = asString(change && change.entity_type);
  const entity = change && change.after;
  if (entityType === 'transaction' && entity) {
    collectTransactionAccountIds(entity).forEach((accountId) => {
      if (!findById(workbook && workbook.accounts, accountId)) {
        conflicts.push(
          createSyncIssue(
            'missing_account_reference',
            'Synced transaction references a missing account.',
            {
              entity_type: entityType,
              entity_id: asString(change.entity_id),
              change_id: asString(change.change_id),
              field: 'account_id',
              value: accountId
            }
          )
        );
      }
    });
    const categoryId = asString(entity.categoryId || entity.category_id);
    if (categoryId && !findById(workbook && workbook.categories, categoryId)) {
      conflicts.push(
        createSyncIssue(
          'missing_category_reference',
          'Synced transaction references a missing category.',
          {
            entity_type: entityType,
            entity_id: asString(change.entity_id),
            change_id: asString(change.change_id),
            field: 'category_id',
            value: categoryId
          }
        )
      );
    }
  }
  if (entityType === 'draft_group' && entity) {
    const refs = collectDraftGroupRefs(entity);
    refs.accountIds.forEach((accountId) => {
      if (!findById(workbook && workbook.accounts, accountId)) {
        conflicts.push(
          createSyncIssue(
            'missing_account_reference',
            'Synced draft references a missing account.',
            {
              entity_type: entityType,
              entity_id: asString(change.entity_id),
              change_id: asString(change.change_id),
              field: 'payment_account_id',
              value: accountId
            }
          )
        );
      }
    });
    refs.categoryIds.forEach((categoryId) => {
      if (!findById(workbook && workbook.categories, categoryId)) {
        conflicts.push(
          createSyncIssue(
            'missing_category_reference',
            'Synced draft references a missing category.',
            {
              entity_type: entityType,
              entity_id: asString(change.entity_id),
              change_id: asString(change.change_id),
              field: 'category_id',
              value: categoryId
            }
          )
        );
      }
    });
  }
  return conflicts;
}

export function detectSyncConflicts({ workbook, localChanges = [], remoteChanges = [] } = {}) {
  const conflicts = [];
  const remoteByEntity = new Map();
  asArray(remoteChanges).forEach((change) => {
    const key = keyForChange(change);
    remoteByEntity.set(key, (remoteByEntity.get(key) || []).concat(change));
  });
  asArray(localChanges).forEach((localChange) => {
    asArray(remoteByEntity.get(keyForChange(localChange))).forEach((remoteChange) => {
      const sameDevice =
        asString(localChange.device_id) &&
        asString(localChange.device_id) === asString(remoteChange.device_id);
      const changedDifferently =
        asString(localChange.entity_hash) !== asString(remoteChange.entity_hash) ||
        asString(localChange.operation) !== asString(remoteChange.operation);
      if (!sameDevice && changedDifferently) {
        pushUnique(
          conflicts,
          createSyncIssue(
            'concurrent_entity_update',
            'The same sync entity changed on two devices.',
            {
              entity_type: asString(localChange.entity_type),
              entity_id: asString(localChange.entity_id),
              local_change_id: asString(localChange.change_id),
              remote_change_id: asString(remoteChange.change_id),
              local_device_id: asString(localChange.device_id),
              remote_device_id: asString(remoteChange.device_id)
            }
          )
        );
      }
    });
  });
  asArray(localChanges)
    .concat(asArray(remoteChanges))
    .forEach((change) => {
      detectReferenceConflictsForChange(workbook, change).forEach((conflict) =>
        pushUnique(conflicts, conflict)
      );
    });
  const blockingConflicts = conflicts.filter(
    (conflict) => conflict.severity !== 'warning' && conflict.severity !== 'info'
  );
  return {
    ok: blockingConflicts.length === 0,
    conflicts,
    blockingConflicts,
    warningConflicts: conflicts.filter((conflict) => conflict.severity === 'warning')
  };
}
