import {
  detectRollbackConflict,
  createRollbackConflict
} from '../../domain/checkpoints/conflicts.js';
import { fingerprintWorkbookCore } from '../../domain/checkpoints/entity-fingerprint.js';
import { createWorkbookCheckpointStore } from './checkpoint-store.js';
import { appendCheckpointAuditEvent } from './checkpoint-audit.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function getEntityList(workbook, entityType) {
  if (entityType === 'transaction') {
    workbook.transactions = Array.isArray(workbook.transactions) ? workbook.transactions : [];
    return workbook.transactions;
  }
  if (entityType === 'recurring_item') {
    workbook.recurringItems = Array.isArray(workbook.recurringItems) ? workbook.recurringItems : [];
    return workbook.recurringItems;
  }
  if (entityType === 'category') {
    workbook.categories = Array.isArray(workbook.categories) ? workbook.categories : [];
    return workbook.categories;
  }
  return null;
}

function getBudgetList(workbook) {
  workbook.sheets = Array.isArray(workbook.sheets)
    ? workbook.sheets
    : [{ id: 'sheet_default', budgets: [] }];
  workbook.sheets[0].budgets = Array.isArray(workbook.sheets[0].budgets)
    ? workbook.sheets[0].budgets
    : [];
  return workbook.sheets[0].budgets;
}

function findEntity(workbook, entityType, entityId) {
  if (entityType === 'budget') {
    return (
      getBudgetList(workbook).find(
        (budget) => asString(budget.categoryId || budget.category_id) === asString(entityId)
      ) || null
    );
  }
  const list = getEntityList(workbook, entityType);
  return list ? list.find((entity) => asString(entity.id) === asString(entityId)) || null : null;
}

function removeEntity(workbook, entityType, entityId) {
  if (entityType === 'budget') {
    const list = getBudgetList(workbook);
    const index = list.findIndex(
      (budget) => asString(budget.categoryId || budget.category_id) === asString(entityId)
    );
    if (index >= 0) list.splice(index, 1);
    return;
  }
  const list = getEntityList(workbook, entityType);
  if (!list) return;
  const index = list.findIndex((entity) => asString(entity.id) === asString(entityId));
  if (index >= 0) list.splice(index, 1);
}

function restoreEntity(workbook, entityType, entityId, before) {
  if (entityType === 'budget') {
    const list = getBudgetList(workbook);
    const index = list.findIndex(
      (budget) => asString(budget.categoryId || budget.category_id) === asString(entityId)
    );
    if (before == null) {
      if (index >= 0) list.splice(index, 1);
      return;
    }
    if (index >= 0) {
      list[index] = clonePlain(before);
    } else {
      list.push(clonePlain(before));
    }
    return;
  }
  const list = getEntityList(workbook, entityType);
  if (!list) return;
  const index = list.findIndex((entity) => asString(entity.id) === asString(entityId));
  if (before == null) {
    if (index >= 0) list.splice(index, 1);
    return;
  }
  if (index >= 0) {
    list[index] = clonePlain(before);
  } else {
    list.push(clonePlain(before));
  }
}

function selectedChanges(checkpoint, changeIds) {
  const selected =
    Array.isArray(changeIds) && changeIds.length ? new Set(changeIds.map(asString)) : null;
  return (checkpoint.changes || []).filter(
    (change) =>
      change.status === 'applied' && (!selected || selected.has(asString(change.change_id)))
  );
}

export function previewRollback({ workbook, checkpointId, changeIds } = {}) {
  const store = createWorkbookCheckpointStore(workbook);
  const checkpoint = store.getCheckpoint(workbook && workbook.id, checkpointId);
  if (!checkpoint) {
    return {
      checkpoint_id: asString(checkpointId),
      status: 'failed',
      rolled_back_changes: [],
      conflicted_changes: [
        {
          change_id: '',
          entity_type: '',
          entity_id: '',
          reason: 'checkpoint_not_found',
          before: null,
          checkpoint_after: null,
          current: null,
          safe_options: ['manual_review']
        }
      ],
      skipped_changes: [],
      current_workbook_fingerprint: fingerprintWorkbookCore(workbook)
    };
  }
  const changes = selectedChanges(checkpoint, changeIds);
  const conflicts = [];
  changes.forEach((change) => {
    const current = findEntity(workbook, change.entity_type, change.entity_id);
    const reason = detectRollbackConflict(change, current);
    if (reason) {
      conflicts.push(createRollbackConflict(change, current, reason));
    }
  });
  return {
    checkpoint_id: checkpoint.checkpoint_id,
    status: conflicts.length ? 'conflict' : 'rolled_back',
    rolled_back_changes: conflicts.length ? [] : changes.map((change) => change.change_id),
    conflicted_changes: conflicts,
    skipped_changes: [],
    current_workbook_fingerprint: fingerprintWorkbookCore(workbook)
  };
}

export function rollbackCheckpoint({
  workbook,
  checkpointId,
  changeIds,
  conflictPolicy = 'safe_only',
  caller,
  createId,
  now
} = {}) {
  const store = createWorkbookCheckpointStore(workbook);
  const checkpoint = store.getCheckpoint(workbook && workbook.id, checkpointId);
  if (!checkpoint) {
    return previewRollback({ workbook, checkpointId, changeIds });
  }
  const preview = previewRollback({ workbook, checkpointId, changeIds });
  appendCheckpointAuditEvent(workbook, {
    createId,
    event_type: 'checkpoint_rollback_previewed',
    request_id: caller && (caller.requestId || caller.request_id),
    workbook_id: workbook.id,
    checkpoint_id: checkpoint.checkpoint_id,
    caller_type: caller && (caller.callerType || caller.caller_type || caller.subject_type),
    origin: checkpoint.origin,
    auth_method: caller && (caller.authMethod || caller.auth_method),
    operation_id: 'previewCavalryCheckpointRollback',
    action_count: selectedChanges(checkpoint, changeIds).length,
    conflict_count: preview.conflicted_changes.length,
    outcome: preview.status
  });
  if (preview.conflicted_changes.length && conflictPolicy !== 'force_restore_before_value') {
    checkpoint.status = 'rollback_conflict';
    appendCheckpointAuditEvent(workbook, {
      createId,
      event_type: 'checkpoint_rollback_conflict',
      request_id: caller && (caller.requestId || caller.request_id),
      workbook_id: workbook.id,
      checkpoint_id: checkpoint.checkpoint_id,
      caller_type: caller && (caller.callerType || caller.caller_type || caller.subject_type),
      origin: checkpoint.origin,
      auth_method: caller && (caller.authMethod || caller.auth_method),
      operation_id: 'rollbackCavalryCheckpoint',
      conflict_count: preview.conflicted_changes.length,
      outcome: 'conflict'
    });
    return preview;
  }
  const changes = selectedChanges(checkpoint, changeIds);
  const rolledBack = [];
  changes.forEach((change) => {
    if (change.inverse_patch.type === 'remove_created_entity') {
      removeEntity(workbook, change.entity_type, change.entity_id);
    } else if (change.inverse_patch.type === 'restore_before_snapshot') {
      restoreEntity(workbook, change.entity_type, change.entity_id, change.before);
    }
    change.status = 'rolled_back';
    rolledBack.push(change.change_id);
  });
  const remainingApplied = (checkpoint.changes || []).some((change) => change.status === 'applied');
  checkpoint.status = remainingApplied ? 'partially_rolled_back' : 'rolled_back';
  checkpoint.rolled_back_at = typeof now === 'function' ? now() : new Date().toISOString();
  appendCheckpointAuditEvent(workbook, {
    createId,
    event_type: 'checkpoint_rollback_completed',
    request_id: caller && (caller.requestId || caller.request_id),
    workbook_id: workbook.id,
    checkpoint_id: checkpoint.checkpoint_id,
    caller_type: caller && (caller.callerType || caller.caller_type || caller.subject_type),
    origin: checkpoint.origin,
    auth_method: caller && (caller.authMethod || caller.auth_method),
    operation_id: 'rollbackCavalryCheckpoint',
    action_count: changes.length,
    applied_count: rolledBack.length,
    outcome: checkpoint.status
  });
  return {
    checkpoint_id: checkpoint.checkpoint_id,
    status: remainingApplied ? 'partially_rolled_back' : 'rolled_back',
    rolled_back_changes: rolledBack,
    conflicted_changes: [],
    skipped_changes: [],
    current_workbook_fingerprint: fingerprintWorkbookCore(workbook)
  };
}
