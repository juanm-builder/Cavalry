import {
  CAVALRY_SYNC_FOUNDATION_VERSION,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATION_TYPES,
  asArray,
  asString,
  clonePlain,
  createSyncDeviceMetadata,
  hashValue
} from './sync-types.js';

function nowIso(now) {
  return typeof now === 'function' ? now() : new Date().toISOString();
}

function makeId(prefix, createId) {
  if (typeof createId === 'function') {
    return createId(prefix);
  }
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

export function getWorkbookSyncSnapshot(workbook) {
  const source = workbook && typeof workbook === 'object' ? workbook : {};
  return {
    id: asString(source.id),
    version: Number(source.version) || 0,
    name: asString(source.name),
    currency: asString(source.currency),
    accounts: clonePlain(asArray(source.accounts)),
    categories: clonePlain(asArray(source.categories)),
    transactions: clonePlain(asArray(source.transactions)),
    externalDraftGroups: clonePlain(asArray(source.externalDraftGroups)),
    sheets: clonePlain(asArray(source.sheets))
  };
}

export function getWorkbookSyncHash(workbook) {
  return hashValue(getWorkbookSyncSnapshot(workbook));
}

export function getEntitySyncHash(entity) {
  return hashValue(entity == null ? null : clonePlain(entity));
}

export function ensureSyncState(workbook, options = {}) {
  if (!workbook) {
    throw new Error('Workbook is required.');
  }
  const device = createSyncDeviceMetadata(options.device || {});
  workbook.syncState =
    workbook.syncState && typeof workbook.syncState === 'object' ? workbook.syncState : {};
  workbook.syncState.mode = asString(workbook.syncState.mode || 'local_only');
  workbook.syncState.enabled = workbook.syncState.enabled === true;
  workbook.syncState.status = asString(workbook.syncState.status || 'local_only');
  workbook.syncState.deviceId = asString(workbook.syncState.deviceId || device.deviceId);
  workbook.syncState.workbookVersion =
    Number(workbook.syncState.workbookVersion || workbook.version) || 0;
  workbook.syncState.workbookHash = getWorkbookSyncHash(workbook);
  workbook.syncState.outbox = asArray(workbook.syncState.outbox);
  workbook.syncState.appliedChangeIds = asArray(workbook.syncState.appliedChangeIds);
  workbook.syncState.lastSyncAt = asString(workbook.syncState.lastSyncAt);
  return workbook.syncState;
}

export function createSyncChange({
  workbook,
  entityType,
  entityId,
  operation = 'upsert',
  before,
  after,
  entity,
  device,
  metadata,
  now,
  createId
} = {}) {
  const normalizedEntityType = asString(entityType);
  const normalizedOperation = asString(operation || 'upsert');
  if (!SYNC_ENTITY_TYPES.includes(normalizedEntityType)) {
    throw new Error('Unsupported sync entity type: ' + normalizedEntityType);
  }
  if (!SYNC_OPERATION_TYPES.includes(normalizedOperation)) {
    throw new Error('Unsupported sync operation: ' + normalizedOperation);
  }
  const nextEntity = after !== undefined ? after : entity;
  const previousEntity = before !== undefined ? before : null;
  const safeDevice = createSyncDeviceMetadata(device || {});
  return {
    sync_change_version: CAVALRY_SYNC_FOUNDATION_VERSION,
    change_id: makeId('sync_change', createId),
    workbook_id: asString(workbook && workbook.id),
    workbook_version: Number(workbook && workbook.version) || 0,
    workbook_hash: getWorkbookSyncHash(workbook || {}),
    entity_type: normalizedEntityType,
    entity_id: asString(
      entityId || (nextEntity && nextEntity.id) || (nextEntity && nextEntity.draft_group_id)
    ),
    operation: normalizedOperation,
    base_entity_hash: previousEntity == null ? '' : getEntitySyncHash(previousEntity),
    entity_hash: normalizedOperation === 'delete' ? '' : getEntitySyncHash(nextEntity),
    before: previousEntity == null ? null : clonePlain(previousEntity),
    after: normalizedOperation === 'delete' ? null : clonePlain(nextEntity),
    device_id: safeDevice.deviceId,
    device: safeDevice,
    created_at: nowIso(now),
    sync_status: 'pending',
    metadata: clonePlain(metadata || {})
  };
}

export function recordWorkbookEntityChange(workbook, options = {}) {
  const state = ensureSyncState(workbook, options);
  const change = createSyncChange(Object.assign({}, options, { workbook }));
  state.outbox.push(change);
  state.workbookHash = getWorkbookSyncHash(workbook);
  return change;
}

export function recordTransactionChange(workbook, transaction, options = {}) {
  return recordWorkbookEntityChange(
    workbook,
    Object.assign({}, options, {
      entityType: 'transaction',
      entityId: asString(options.entityId || (transaction && transaction.id)),
      after: options.after !== undefined ? options.after : transaction
    })
  );
}

export function recordCategoryChange(workbook, category, options = {}) {
  return recordWorkbookEntityChange(
    workbook,
    Object.assign({}, options, {
      entityType: 'category',
      entityId: asString(options.entityId || (category && category.id)),
      after: options.after !== undefined ? options.after : category
    })
  );
}

export function recordAccountChange(workbook, account, options = {}) {
  return recordWorkbookEntityChange(
    workbook,
    Object.assign({}, options, {
      entityType: 'account',
      entityId: asString(options.entityId || (account && account.id)),
      after: options.after !== undefined ? options.after : account
    })
  );
}

export function recordDraftGroupChange(workbook, draftGroup, options = {}) {
  return recordWorkbookEntityChange(
    workbook,
    Object.assign({}, options, {
      entityType: 'draft_group',
      entityId: asString(options.entityId || (draftGroup && draftGroup.draft_group_id)),
      after: options.after !== undefined ? options.after : draftGroup
    })
  );
}

export function getPendingSyncChanges(workbook) {
  const state = ensureSyncState(workbook);
  return state.outbox
    .filter((change) => change && change.sync_status !== 'applied')
    .map(clonePlain);
}

export function markSyncChangesApplied(workbook, changeIds, options = {}) {
  const state = ensureSyncState(workbook);
  const ids = new Set(asArray(changeIds).map(asString));
  state.outbox.forEach((change) => {
    if (ids.has(asString(change && change.change_id))) {
      change.sync_status = 'applied';
      change.applied_at = nowIso(options.now);
    }
  });
  state.appliedChangeIds = Array.from(new Set(state.appliedChangeIds.concat(Array.from(ids))));
  state.lastSyncAt = nowIso(options.now);
  return state;
}
