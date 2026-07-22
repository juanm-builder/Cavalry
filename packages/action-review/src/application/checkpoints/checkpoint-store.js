import { validateCheckpoint } from '../../domain/checkpoints/validation.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function ensureCheckpointCollections(workbook) {
  if (!workbook) {
    throw new Error('Workbook is required.');
  }
  workbook.checkpoints = Array.isArray(workbook.checkpoints) ? workbook.checkpoints : [];
  workbook.checkpointAuditEvents = Array.isArray(workbook.checkpointAuditEvents)
    ? workbook.checkpointAuditEvents
    : [];
  workbook.checkpointIdempotencyRecords = Array.isArray(workbook.checkpointIdempotencyRecords)
    ? workbook.checkpointIdempotencyRecords
    : [];
  return workbook;
}

export function createWorkbookCheckpointStore(workbook) {
  ensureCheckpointCollections(workbook);
  return {
    createCheckpoint(input) {
      const checkpoint = input && typeof input === 'object' ? input : {};
      const validation = validateCheckpoint(checkpoint);
      if (!validation.ok) {
        const error = new Error('Malformed checkpoint was rejected.');
        error.code = 'checkpoint_create_failed';
        error.issues = validation.issues;
        throw error;
      }
      if (asString(checkpoint.workbook_id) !== asString(workbook.id)) {
        const error = new Error('Checkpoint belongs to a different workbook.');
        error.code = 'checkpoint_cross_workbook_denied';
        throw error;
      }
      const existingIndex = workbook.checkpoints.findIndex(
        (item) => asString(item.checkpoint_id) === asString(checkpoint.checkpoint_id)
      );
      if (existingIndex >= 0) {
        workbook.checkpoints[existingIndex] = checkpoint;
      } else {
        workbook.checkpoints.push(checkpoint);
      }
      return checkpoint;
    },

    getCheckpoint(workbookId, checkpointId) {
      if (asString(workbookId) !== asString(workbook.id)) {
        return null;
      }
      return (
        workbook.checkpoints.find(
          (checkpoint) => asString(checkpoint.checkpoint_id) === asString(checkpointId)
        ) || null
      );
    },

    listCheckpoints(workbookId, options = {}) {
      if (asString(workbookId) !== asString(workbook.id)) {
        return [];
      }
      const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
      return workbook.checkpoints
        .slice()
        .sort(
          (a, b) =>
            asString(b.created_at).localeCompare(asString(a.created_at)) ||
            asString(b.checkpoint_id).localeCompare(asString(a.checkpoint_id))
        )
        .slice(0, limit);
    },

    updateCheckpointStatus(workbookId, checkpointId, statusPatch = {}) {
      const checkpoint = this.getCheckpoint(workbookId, checkpointId);
      if (!checkpoint) {
        return null;
      }
      Object.assign(checkpoint, statusPatch);
      return checkpoint;
    },

    appendCheckpointAuditEvent(workbookId, checkpointId, event) {
      if (asString(workbookId) !== asString(workbook.id)) {
        const error = new Error('Checkpoint audit event belongs to a different workbook.');
        error.code = 'checkpoint_cross_workbook_denied';
        throw error;
      }
      const safeEvent = Object.assign({}, event || {});
      delete safeEvent.token;
      delete safeEvent.access_token;
      delete safeEvent.authorization;
      delete safeEvent.raw_action_plan;
      delete safeEvent.raw_request_body;
      safeEvent.workbook_id = asString(workbookId);
      safeEvent.checkpoint_id = asString(checkpointId);
      workbook.checkpointAuditEvents.push(safeEvent);
      return safeEvent;
    },

    getIdempotencyRecord(workbookId, userId, idempotencyKey) {
      const key = asString(idempotencyKey);
      if (!key || asString(workbookId) !== asString(workbook.id)) {
        return null;
      }
      return (
        workbook.checkpointIdempotencyRecords.find(
          (record) =>
            asString(record.workbook_id) === asString(workbook.id) &&
            asString(record.user_id) === asString(userId) &&
            asString(record.idempotency_key) === key
        ) || null
      );
    },

    saveIdempotencyRecord(record) {
      const key = asString(record && record.idempotency_key);
      if (!key) {
        return null;
      }
      const existingIndex = workbook.checkpointIdempotencyRecords.findIndex(
        (item) =>
          asString(item.workbook_id) === asString(record.workbook_id) &&
          asString(item.user_id) === asString(record.user_id) &&
          asString(item.idempotency_key) === key
      );
      if (existingIndex >= 0) {
        workbook.checkpointIdempotencyRecords[existingIndex] = record;
      } else {
        workbook.checkpointIdempotencyRecords.push(record);
      }
      return record;
    }
  };
}
