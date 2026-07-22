const CHECKPOINT_REVIEW_HEADER_COPY =
  'ChatGPT applied reversible changes in Cavalry. Nothing was permanently deleted. Review the checkpoint and undo anything that does not look right.';
const CHECKPOINT_REVIEW_SOURCE_PROMPT_FALLBACK =
  'Review the exact checkpoint before deciding what to keep.';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function titleCaseLabel(value, fallback) {
  const source = String(value || fallback || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!source) {
    return '';
  }
  return source
    .split(/\s+/)
    .map((part) => {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function getCheckpointId(checkpoint) {
  return asString(checkpoint && checkpoint.checkpoint_id);
}

function getSummaryValue(checkpoint, key) {
  return Number(checkpoint && checkpoint.summary && checkpoint.summary[key]) || 0;
}

function getSortedCheckpoints(checkpoints) {
  return asArray(checkpoints)
    .slice()
    .sort((a, b) => {
      const createdCompare = asString(b && b.created_at).localeCompare(asString(a && a.created_at));
      return createdCompare || getCheckpointId(b).localeCompare(getCheckpointId(a));
    });
}

function getReversibleChanges(changes) {
  return asArray(changes).filter((change) => {
    return (
      change &&
      change.status === 'applied' &&
      change.inverse_patch &&
      change.inverse_patch.type !== 'unsupported_rollback'
    );
  });
}

export function getCheckpointChangeTitle(change) {
  const actionType = asString(change && change.action_type).replace(/_/g, ' ');
  const entityType = asString(change && change.entity_type).replace(/_/g, ' ');
  const operation = asString(change && change.operation).replace(/_/g, ' ');
  return titleCaseLabel(operation + ' ' + entityType, actionType || 'Checkpoint change');
}

export function buildCheckpointChangeRowViewModel(change) {
  const status = asString(change && change.status) || 'applied';
  const target =
    change && change.entity_type === 'transaction' && change.entity_id
      ? {
          action: 'open-checkpoint-change-target',
          entityType: 'transaction',
          entityId: String(change.entity_id)
        }
      : null;
  return {
    status,
    statusLabel: status.replace(/_/g, ' '),
    statusTone:
      status === 'blocked'
        ? 'needs_info'
        : status === 'rollback_conflict'
          ? 'bad'
          : status === 'rolled_back'
            ? 'posted'
            : 'info',
    icon: status === 'blocked' ? 'block' : status === 'rolled_back' ? 'undo' : 'task_alt',
    title: getCheckpointChangeTitle(change),
    summary:
      asString(change && change.human_summary) ||
      asString(change && change.entity_id) ||
      'Checkpoint change',
    target
  };
}

export function buildCheckpointReviewPanelViewModel(checkpoints, options = {}) {
  const sortedCheckpoints = getSortedCheckpoints(checkpoints);
  if (!sortedCheckpoints.length) {
    return {
      visible: false,
      selectedCheckpointId: '',
      checkpoints: [],
      pickerItems: [],
      visibleChangeRows: []
    };
  }
  const requestedSelectedId = asString(options.selectedCheckpointId);
  const selected =
    sortedCheckpoints.find((checkpoint) => {
      return getCheckpointId(checkpoint) === requestedSelectedId;
    }) || sortedCheckpoints[0];
  const selectedCheckpointId = getCheckpointId(selected);
  const changes = asArray(selected && selected.changes);
  const blocked = changes.filter((change) => change && change.status === 'blocked');
  const reversible = getReversibleChanges(changes);
  const hiddenChangeCount = Math.max(0, changes.length - 12);

  return {
    visible: true,
    badgeLabel: 'Checkpointed AI actions',
    headerCopy: CHECKPOINT_REVIEW_HEADER_COPY,
    sourcePrompt:
      asString(selected && selected.source_prompt) || CHECKPOINT_REVIEW_SOURCE_PROMPT_FALLBACK,
    selectedCheckpointId,
    rollbackButton: {
      action: 'preview-checkpoint-rollback',
      checkpointId: selectedCheckpointId,
      disabled: !reversible.length
    },
    meta: {
      checkpointId: selectedCheckpointId,
      createdAt: selected && selected.created_at,
      statusLabel: (asString(selected && selected.status) || 'applied').replace(/_/g, ' '),
      origin: asString(selected && selected.origin) || 'chatgpt_companion'
    },
    metrics: [
      {
        id: 'applied',
        label: 'Applied',
        value: getSummaryValue(selected, 'applied'),
        icon: 'task_alt',
        tone: 'posted'
      },
      {
        id: 'blocked',
        label: 'Blocked',
        value: getSummaryValue(selected, 'blocked'),
        icon: 'block',
        tone: blocked.length ? 'needs_info' : ''
      },
      {
        id: 'warnings',
        label: 'Warnings',
        value: getSummaryValue(selected, 'warnings'),
        icon: 'error',
        tone: getSummaryValue(selected, 'warnings') ? 'needs_info' : ''
      },
      {
        id: 'reversible',
        label: 'Reversible',
        value: reversible.length,
        icon: 'undo',
        tone: 'info'
      }
    ],
    pickerItems: sortedCheckpoints.slice(0, 8).map((checkpoint) => {
      return {
        checkpointId: getCheckpointId(checkpoint),
        active: getCheckpointId(checkpoint) === selectedCheckpointId,
        createdAt: checkpoint && checkpoint.created_at,
        appliedCount: getSummaryValue(checkpoint, 'applied'),
        blockedCount: getSummaryValue(checkpoint, 'blocked')
      };
    }),
    visibleChangeRows: changes.slice(0, 12).map(buildCheckpointChangeRowViewModel),
    hiddenChangeCount,
    emptyChangeCopy: 'No checkpoint changes recorded.'
  };
}
