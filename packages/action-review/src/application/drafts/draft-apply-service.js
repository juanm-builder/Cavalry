import {
  ExternalDraftServiceError,
  applyExternalDraftGroup,
  rejectExternalDraftGroup
} from './external-draft-service.js';
import { detectDraftGroupConflicts } from './draft-conflict-service.js';
import { findExternalDraftGroup } from './draft-group-model.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function applyDraftGroup({
  workbook,
  draftGroupId,
  selectedDraftIds,
  confirmedByUser,
  caller,
  createId,
  now
} = {}) {
  if (confirmedByUser !== true) {
    throw new ExternalDraftServiceError(
      'blocked_apply_from_external_origin',
      'Draft groups require explicit Cavalry-side confirmation before applying.',
      {
        status: 403
      }
    );
  }
  const group = findExternalDraftGroup(workbook, draftGroupId);
  if (!group) {
    throw new ExternalDraftServiceError('external_ref_not_found', 'Draft group was not found.', {
      status: 404
    });
  }
  if (group.status === 'rejected') {
    throw new ExternalDraftServiceError(
      'draft_validation_failed',
      'Rejected draft groups cannot be applied.',
      {
        status: 409,
        issues: [
          {
            code: 'draft_group_rejected',
            severity: 'blocked',
            message: 'Rejected draft groups cannot be applied.'
          }
        ]
      }
    );
  }
  if (group.status === 'applied') {
    return group;
  }
  const conflictResult = detectDraftGroupConflicts(workbook, group, {
    selectedDraftIds,
    requireReady: true
  });
  if (!conflictResult.ok) {
    throw new ExternalDraftServiceError(
      'draft_validation_failed',
      'Draft group has conflicts that must be reviewed before applying.',
      {
        status: 409,
        issues: conflictResult.blockingConflicts
      }
    );
  }
  const selected =
    Array.isArray(selectedDraftIds) && selectedDraftIds.length
      ? new Set(selectedDraftIds.map(asString))
      : null;
  const readyDrafts = (group.drafts || []).filter(
    (draft) => draft.status === 'ready' && (!selected || selected.has(asString(draft.draft_id)))
  );
  if (!readyDrafts.length) {
    throw new ExternalDraftServiceError(
      'draft_validation_failed',
      'No ready drafts are selected for apply.',
      {
        status: 409,
        issues: [
          {
            code: 'no_ready_drafts',
            severity: 'blocked',
            message: 'No ready drafts are selected for apply.'
          }
        ]
      }
    );
  }
  return applyExternalDraftGroup({
    workbook,
    draftGroupId,
    selectedDraftIds,
    confirmedByUser: true,
    caller,
    createId,
    now
  });
}

export function rejectDraftGroup({ workbook, draftGroupId, caller, createId, now } = {}) {
  return rejectExternalDraftGroup({
    workbook,
    draftGroupId,
    caller,
    createId,
    now
  });
}
