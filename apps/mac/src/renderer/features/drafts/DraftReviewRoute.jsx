import React, { useMemo, useState } from 'react';

import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { formatUiDateTime } from '../../shared/date-format.js';
import { FinancialValueInput } from '../../shared/FinancialValueInput.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';
import {
  buildDraftReviewFeatureModel,
  DRAFT_REVIEW_ACTIONS,
  executeDraftReviewCommand,
  previewCheckpointRollback
} from './draft-review-controller.js';

function Icon({ name }) {
  return (
    <span aria-hidden="true" className="material-symbols-rounded">
      {name}
    </span>
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function withClick(binding, callback) {
  const boundClick = binding?.onClick;
  return {
    ...(binding || {}),
    onClick(event) {
      boundClick?.(event);
      callback?.(event);
    }
  };
}

function DraftCommandBar({ model }) {
  return (
    <section className="ai-drafts-command-bar">
      <div className="ai-drafts-command-copy">
        <span>Review queue</span>
        <h3>{model.title}</h3>
        <p>{model.copy}</p>
      </div>
      <div className="ai-draft-status-strip">
        {asArray(model.metrics).map((metric) => (
          <div key={metric.id} className={`ai-draft-metric ${metric.tone || ''}`}>
            <Icon name={metric.icon} />
            <span>
              <strong>{metric.count}</strong>
              <small>{metric.label}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CheckpointPanel({
  model,
  selectedChangeIds,
  onSelectCheckpoint,
  onToggleChange,
  onApprove,
  onPreviewRollback,
  actions
}) {
  if (!model?.visible) return null;
  return (
    <section className="ai-checkpoint-review-panel">
      <div className="ai-checkpoint-review-head">
        <div>
          <span className="badge">{model.badgeLabel}</span>
          <h3>Review checkpoint</h3>
          <p>{model.headerCopy}</p>
        </div>
        <div className="page-actions">
          <button
            className="btn"
            disabled={model.reviewStatus === 'approved'}
            onClick={onApprove}
            type="button"
          >
            <Icon name="verified" />
            {model.reviewStatus === 'approved' ? 'Approved' : 'Keep Changes'}
          </button>
          <button
            className="btn btn-primary"
            disabled={model.rollbackButton?.disabled}
            type="button"
            {...withClick(
              actions.action('preview-checkpoint-rollback', {
                checkpointId: model.selectedCheckpointId
              }),
              onPreviewRollback
            )}
          >
            <Icon name="undo" />
            Preview Rollback
          </button>
        </div>
      </div>
      <div className="ai-checkpoint-picker">
        {asArray(model.pickerItems).map((item) => (
          <button
            key={item.checkpointId}
            className={item.active ? 'active' : ''}
            onClick={() => onSelectCheckpoint(item.checkpointId)}
            type="button"
          >
            <strong>{item.checkpointId}</strong>
            <small>
              {formatUiDateTime(item.createdAt) || 'Unknown date'} · {item.appliedCount} applied
            </small>
          </button>
        ))}
      </div>
      <p className="panel-note">{model.sourcePrompt}</p>
      <div className="ai-checkpoint-change-list">
        {asArray(model.visibleChangeRows).length ? (
          model.visibleChangeRows.map((row) => (
            <label key={row.changeId || row.summary} className="ai-checkpoint-change-row">
              <input
                checked={row.reversible && selectedChangeIds.includes(row.changeId)}
                disabled={!row.reversible}
                onChange={() => onToggleChange(row.changeId)}
                type="checkbox"
              />
              <Icon name={row.icon} />
              <span>
                <strong>{row.title}</strong>
                <small>{row.summary}</small>
              </span>
              <span className={`status-pill ${row.statusTone}`}>{row.statusLabel}</span>
            </label>
          ))
        ) : (
          <div className="empty-state compact-empty">{model.emptyChangeCopy}</div>
        )}
      </div>
    </section>
  );
}

function DraftQueue({ items, selectedKey, onSelect, actions }) {
  return (
    <aside className="ai-draft-queue-panel">
      <div className="ai-draft-lane-head">
        <div>
          <h3>Needs review</h3>
          <p>Select a proposal to inspect its exact changes.</p>
        </div>
      </div>
      <div className="ai-draft-queue-list">
        {items.map((item) => (
          <button
            key={item.key}
            className={`ai-draft-queue-item ai-draft-money-info${item.key === selectedKey ? ' active' : ''}`}
            type="button"
            {...withClick(actions.action('select-ai-draft', { draftKey: item.key }), () =>
              onSelect(item.key)
            )}
          >
            <span className="ai-draft-kind-mark">
              <Icon name={item.kind === 'external-group' ? 'inventory_2' : 'auto_awesome'} />
            </span>
            <span className="ai-draft-queue-copy">
              <small>
                {item.kind === 'external-group' ? 'External draft group' : 'Automated draft'}
              </small>
              <strong>{item.title}</strong>
              <em>{item.summary}</em>
            </span>
            <span className="ai-draft-queue-side">
              <strong>{item.amountDisplay}</strong>
              <small className={item.statusTone}>{item.statusLabel}</small>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function SourceMetadata({ source }) {
  if (!source?.visible) return null;
  return (
    <section className="ai-draft-why-panel">
      <small>Why this draft exists</small>
      <p>{source.originLabel}</p>
      <div className="ai-draft-source-rows">
        {asArray(source.rows).map((row) => (
          <span key={row.id} className="tag">
            {row.label || formatUiDateTime(row.createdAt)}
          </span>
        ))}
      </div>
    </section>
  );
}

function fieldEditKey(draftId, row) {
  return `${draftId}:${asArray(row?.path).join('.')}`;
}

function EditableDraftField({
  draftId,
  row,
  edit,
  onStartEdit,
  onChangeEdit,
  onCancelEdit,
  onSaveEdit
}) {
  const editing = edit?.key === fieldEditKey(draftId, row);
  const interactive = row.editable === true;

  function handleKeyDown(event) {
    if (event.key === 'Escape' && editing) {
      event.preventDefault();
      onCancelEdit();
      return;
    }
    if (editing && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSaveEdit();
      return;
    }
    if (!editing && interactive && (event.key === 'Enter' || event.key === 'F2')) {
      event.preventDefault();
      onStartEdit(draftId, row);
    }
  }

  return (
    <div
      aria-label={interactive ? `${row.label}: ${row.value}. Double-click to edit.` : undefined}
      className={`ai-draft-readout${interactive ? ' ai-draft-editable-field' : ''}${editing ? ' is-editing' : ''}`}
      onDoubleClick={() => interactive && onStartEdit(draftId, row)}
      onKeyDown={handleKeyDown}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={interactive ? 'Double-click to edit this field' : undefined}
    >
      <span className="ai-draft-field-label">
        <small>{row.label}</small>
        {interactive && !editing ? <Icon name="edit" /> : null}
      </span>
      {editing ? (
        <div className="ai-draft-inline-editor">
          {asArray(row.inputOptions).length && /categoryid/i.test(String(row.key || '')) ? (
            <CategorizedSelect
              aria-label={`Edit ${row.label}`}
              onValueChange={onChangeEdit}
              options={row.inputOptions}
              value={edit.value}
            />
          ) : asArray(row.inputOptions).length ? (
            <select
              aria-label={`Edit ${row.label}`}
              autoFocus
              className="ai-draft-inline-input"
              onChange={(event) => onChangeEdit(event.target.value)}
              value={edit.value}
            >
              {row.inputOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : row.money ? (
            <FinancialValueInput
              aria-label={`Edit ${row.label}`}
              autoFocus
              className="ai-draft-inline-input amount"
              onChange={(event) => onChangeEdit(event.target.value)}
              value={edit.value}
            />
          ) : (
            <input
              aria-label={`Edit ${row.label}`}
              autoFocus
              className={`ai-draft-inline-input${row.money ? ' amount' : ''}`}
              inputMode={row.valueType === 'number' ? 'decimal' : undefined}
              onChange={(event) => onChangeEdit(event.target.value)}
              type={normalizedInputType(row)}
              value={edit.value}
            />
          )}
          <span className="ai-draft-inline-actions">
            <button aria-label={`Cancel editing ${row.label}`} onClick={onCancelEdit} type="button">
              <Icon name="close" />
            </button>
            <button aria-label={`Save ${row.label}`} onClick={onSaveEdit} type="button">
              <Icon name="check" />
            </button>
          </span>
        </div>
      ) : (
        <strong className={row.money ? 'amount' : ''}>{row.value}</strong>
      )}
      <em>{row.description}</em>
      {editing && edit.error ? <span className="ai-draft-inline-error">{edit.error}</span> : null}
    </div>
  );
}

function normalizedInputType(row) {
  const finalPath = asArray(row?.path).at(-1);
  return /date/i.test(String(finalPath || '')) ? 'date' : 'text';
}

function DraftDetail({
  item,
  selectedDraftIds,
  edit,
  onStartEdit,
  onChangeEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleDraft,
  onRequestApply,
  onRequestReject
}) {
  if (!item)
    return (
      <article className="ai-draft-detail-panel ai-draft-empty-detail">
        <p>Select a draft to review.</p>
      </article>
    );
  return (
    <article className="ai-draft-detail-panel">
      <div className="ai-draft-detail-head">
        <div className="ai-draft-detail-title">
          <small>{item.kind === 'external-group' ? 'Draft group' : 'Review proposal'}</small>
          <h2>{item.title}</h2>
          <div className="ai-draft-detail-meta">
            <span className={`status-pill ${item.statusTone}`}>{item.statusLabel}</span>
            <span>{formatUiDateTime(item.createdAt) || 'Not dated'}</span>
          </div>
        </div>
        <div className="ai-draft-detail-amount">
          <strong>{item.amountDisplay}</strong>
          <small>Nothing changes before approval</small>
        </div>
      </div>
      <div className="ai-draft-detail-body">
        {asArray(item.blockingConflicts).length ? (
          <div className="ai-draft-required-task">
            <div className="ai-draft-required-head">
              <Icon name="warning" />
              <div>
                <strong>Resolve before applying</strong>
                <small>
                  {item.blockingConflicts
                    .map((conflict) => conflict.message || conflict.code)
                    .join(' · ')}
                </small>
              </div>
            </div>
          </div>
        ) : (
          <div className="ai-draft-ready-note">
            <Icon name="verified_user" />
            <div>
              <strong>Ready for your review</strong>
              <small>
                Check the details below. Applying creates a backup before anything changes.
              </small>
            </div>
          </div>
        )}
        <div className="ai-draft-proposal-list">
          {item.drafts.map((draft) => (
            <section key={draft.id} className="ai-draft-card ai-draft-card-compact">
              <div className="ai-draft-compact-top">
                {item.kind === 'external-group' ? (
                  <input
                    aria-label={`Select ${draft.title}`}
                    checked={selectedDraftIds.includes(draft.id)}
                    disabled={!draft.ready}
                    onChange={() => onToggleDraft(draft.id)}
                    type="checkbox"
                  />
                ) : null}
                <div className="ai-draft-compact-title">
                  <small>{draft.type}</small>
                  <strong>{draft.title}</strong>
                </div>
                <span className={`status-pill ${draft.ready ? 'good' : 'warn'}`}>
                  {draft.status}
                </span>
              </div>
              <p className="ai-draft-summary">{draft.summary}</p>
              <div className="ai-draft-details-heading">
                <span>
                  <strong>Proposed details</strong>
                  <small>These are the exact values Cavalry will use.</small>
                </span>
                <span className="ai-draft-edit-hint">
                  <Icon name="edit" />
                  Double-click a field to edit
                </span>
              </div>
              <div className="ai-draft-detail-grid">
                {draft.proposedRows.map((row) => (
                  <EditableDraftField
                    draftId={draft.id}
                    edit={edit}
                    key={row.key}
                    onCancelEdit={onCancelEdit}
                    onChangeEdit={onChangeEdit}
                    onSaveEdit={onSaveEdit}
                    onStartEdit={onStartEdit}
                    row={row}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        <SourceMetadata source={item.source} />
      </div>
      <div className="ai-draft-detail-actions">
        <button
          className="btn ai-draft-action-reject"
          disabled={!item.canReject}
          onClick={onRequestReject}
          type="button"
        >
          <Icon name="close" />
          Reject
        </button>
        <button
          className="btn btn-primary ai-draft-action-apply"
          disabled={!item.canApply || !selectedDraftIds.length}
          onClick={onRequestApply}
          type="button"
        >
          <Icon name="check" />
          Review & Apply
        </button>
      </div>
    </article>
  );
}

function ConfirmationModal({
  title,
  copy,
  error,
  confirmLabel,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  children
}) {
  const dismiss = useModalDismiss(onCancel);
  return (
    <div className="modal-backdrop" onMouseDown={dismiss}>
      <section
        aria-labelledby="draft-confirm-title"
        aria-modal="true"
        className="modal-card"
        role="dialog"
      >
        <div className="page-header">
          <h2 id="draft-confirm-title">{title}</h2>
          <button aria-label="Close" className="btn btn-icon" onClick={onCancel} type="button">
            <Icon name="close" />
          </button>
        </div>
        <p className="panel-note">{copy}</p>
        {children}
        {error ? (
          <p className="panel-note status-bad" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={confirmDisabled}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function RecentDecisions({ items }) {
  return (
    <section className="ai-draft-recent-panel">
      <div className="ai-draft-recent-head">
        <strong>Recently handled</strong>
        <small>Applied and rejected decisions remain auditable.</small>
      </div>
      {items.length ? (
        <div className="stack-list">
          {items.map((item) => (
            <div key={item.key} className="list-row">
              <span>
                <strong>{item.title}</strong>
                <small>{formatUiDateTime(item.resolvedAt)}</small>
              </span>
              <span className="status-pill info">{item.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state compact-empty">No recent decisions.</div>
      )}
    </section>
  );
}

function DraftReviewController({
  model,
  workbook,
  onAction,
  onCommandResult,
  commandExecutor,
  services = {},
  initialSelectedKey = '',
  initialSelectedCheckpointId = ''
}) {
  const actions = useActionBindings();
  const [selectedKey, setSelectedKey] = useState(initialSelectedKey);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState(initialSelectedCheckpointId);
  const [showAll, setShowAll] = useState(false);
  const [draftSelections, setDraftSelections] = useState({});
  const [checkpointSelections, setCheckpointSelections] = useState({});
  const [confirmation, setConfirmation] = useState(null);
  const [fieldEdit, setFieldEdit] = useState(null);
  const resolvedModel = useMemo(
    () =>
      workbook
        ? buildDraftReviewFeatureModel(workbook, {
            selectedKey,
            selectedCheckpointId,
            showAll,
            validateAiDraft: services.validateAiDraft
          })
        : model || { queueItems: [], commandBar: {}, checkpoints: {}, recentDecisions: [] },
    [model, selectedCheckpointId, selectedKey, services.validateAiDraft, showAll, workbook]
  );
  const activeKey = resolvedModel.selectedKey || selectedKey;
  const selectedItem =
    asArray(resolvedModel.queueItems).find((item) => item.key === activeKey) || null;
  const selectedDraftIds = selectedItem
    ? draftSelections[selectedItem.key] ||
      selectedItem.drafts.filter((draft) => draft.ready).map((draft) => draft.id)
    : [];
  const checkpoint = resolvedModel.checkpoints || {};
  const selectedChangeIds =
    checkpointSelections[checkpoint.selectedCheckpointId] ||
    asArray(checkpoint.visibleChangeRows)
      .filter((row) => row.reversible)
      .map((row) => row.changeId);

  function runCommand(action) {
    onAction?.(action);
    if (!workbook) return null;
    const executor =
      typeof commandExecutor === 'function' ? commandExecutor : executeDraftReviewCommand;
    const result = executor(workbook, action, services);
    if (result.ok && action.type !== DRAFT_REVIEW_ACTIONS.UPDATE) setConfirmation(null);
    else if (!result.ok && action.type !== DRAFT_REVIEW_ACTIONS.UPDATE)
      setConfirmation((current) => ({
        ...current,
        error: result.errors?.[0]?.message || 'The action could not be completed.'
      }));
    onCommandResult?.(result);
    return result;
  }

  function startFieldEdit(draftId, row) {
    setFieldEdit({
      key: fieldEditKey(draftId, row),
      draftId,
      path: asArray(row.path),
      value: String(row.rawValue ?? ''),
      error: ''
    });
  }

  function saveFieldEdit() {
    if (!fieldEdit || !selectedItem) return;
    const result = runCommand({
      type: DRAFT_REVIEW_ACTIONS.UPDATE,
      payload: {
        kind: selectedItem.kind,
        id: selectedItem.id,
        draftId: fieldEdit.draftId,
        path: fieldEdit.path,
        value: fieldEdit.value
      }
    });
    if (result?.ok) setFieldEdit(null);
    else {
      setFieldEdit((current) => ({
        ...current,
        error: result?.errors?.[0]?.message || 'This value could not be saved.'
      }));
    }
  }

  function toggleDraft(draftId) {
    setDraftSelections((current) => {
      const existing = current[selectedItem.key] || selectedDraftIds;
      return {
        ...current,
        [selectedItem.key]: existing.includes(draftId)
          ? existing.filter((id) => id !== draftId)
          : existing.concat(draftId)
      };
    });
  }

  function toggleCheckpointChange(changeId) {
    setCheckpointSelections((current) => {
      const existing = current[checkpoint.selectedCheckpointId] || selectedChangeIds;
      return {
        ...current,
        [checkpoint.selectedCheckpointId]: existing.includes(changeId)
          ? existing.filter((id) => id !== changeId)
          : existing.concat(changeId)
      };
    });
  }

  function openRollbackPreview() {
    const preview = previewCheckpointRollback(workbook, {
      checkpointId: checkpoint.selectedCheckpointId,
      changeIds: selectedChangeIds
    });
    setConfirmation({ kind: 'rollback', preview, error: '' });
  }

  return (
    <section className="ai-drafts-page" data-react-route="ai-drafts">
      <section className="page-header">
        <div>
          <h1>Review Drafts</h1>
        </div>
        <div className="page-actions" />
      </section>
      <p className="page-subtitle ai-drafts-subtitle">
        AI-prepared suggestions stay reviewable here. Nothing changes until you apply a draft.
      </p>
      <section className="ai-drafts-workbench">
        <DraftCommandBar model={resolvedModel.commandBar || {}} />
        <CheckpointPanel
          actions={actions}
          model={checkpoint}
          onApprove={() =>
            runCommand({
              type: DRAFT_REVIEW_ACTIONS.APPROVE_CHECKPOINT,
              payload: { checkpointId: checkpoint.selectedCheckpointId }
            })
          }
          onPreviewRollback={openRollbackPreview}
          onSelectCheckpoint={setSelectedCheckpointId}
          onToggleChange={toggleCheckpointChange}
          selectedChangeIds={selectedChangeIds}
        />
        {resolvedModel.openCount ? (
          <>
            <div className="ai-drafts-review-workspace">
              <DraftQueue
                actions={actions}
                items={asArray(resolvedModel.queueItems)}
                onSelect={setSelectedKey}
                selectedKey={activeKey}
              />
              <DraftDetail
                edit={fieldEdit}
                item={selectedItem}
                onCancelEdit={() => setFieldEdit(null)}
                onChangeEdit={(value) =>
                  setFieldEdit((current) => ({ ...current, value, error: '' }))
                }
                onRequestApply={() =>
                  setConfirmation({ kind: 'apply', item: selectedItem, error: '' })
                }
                onRequestReject={() =>
                  setConfirmation({ kind: 'reject', item: selectedItem, error: '' })
                }
                onSaveEdit={saveFieldEdit}
                onStartEdit={startFieldEdit}
                onToggleDraft={toggleDraft}
                selectedDraftIds={selectedDraftIds}
              />
            </div>
            {resolvedModel.hiddenQueueCount ? (
              <button
                className="btn ai-draft-review-toggle"
                onClick={() => setShowAll((value) => !value)}
                type="button"
              >
                <Icon name="visibility" />
                View all drafts{' '}
                <span className="ai-draft-hidden-count">{resolvedModel.hiddenQueueCount}</span>
              </button>
            ) : null}
          </>
        ) : (
          <section className="ai-drafts-empty-panel">
            <span className="ai-drafts-empty-icon">
              <Icon name="task_alt" />
            </span>
            <h2>All caught up</h2>
            <p>No drafts need a decision.</p>
          </section>
        )}
        <RecentDecisions items={asArray(resolvedModel.recentDecisions)} />
      </section>
      {confirmation?.kind === 'apply' ? (
        <ConfirmationModal
          confirmDisabled={!selectedDraftIds.length}
          confirmLabel="Apply Selected"
          copy="Cavalry will apply only the selected ready proposals. This confirmation is required and will be recorded."
          error={confirmation.error}
          onCancel={() => setConfirmation(null)}
          onConfirm={() =>
            runCommand({
              type: DRAFT_REVIEW_ACTIONS.APPLY,
              payload: {
                kind: confirmation.item.kind,
                id: confirmation.item.id,
                selectedDraftIds,
                confirmedByUser: true
              }
            })
          }
          title="Apply Draft"
        />
      ) : null}
      {confirmation?.kind === 'reject' ? (
        <ConfirmationModal
          confirmLabel="Reject Draft"
          copy="The proposal will remain in decision history and no workbook data will be applied."
          error={confirmation.error}
          onCancel={() => setConfirmation(null)}
          onConfirm={() =>
            runCommand({
              type: DRAFT_REVIEW_ACTIONS.REJECT,
              payload: { kind: confirmation.item.kind, id: confirmation.item.id }
            })
          }
          title="Reject Draft"
        />
      ) : null}
      {confirmation?.kind === 'rollback' ? (
        <ConfirmationModal
          confirmDisabled={
            asArray(confirmation.preview?.conflicted_changes).length > 0 ||
            !selectedChangeIds.length
          }
          confirmLabel="Rollback Selected"
          copy={`${selectedChangeIds.length} selected checkpoint change${selectedChangeIds.length === 1 ? '' : 's'} will be restored to their before values.`}
          error={
            confirmation.error ||
            (asArray(confirmation.preview?.conflicted_changes).length
              ? 'Rollback conflicts require manual review.'
              : '')
          }
          onCancel={() => setConfirmation(null)}
          onConfirm={() =>
            runCommand({
              type: DRAFT_REVIEW_ACTIONS.ROLLBACK_CHECKPOINT,
              payload: {
                checkpointId: checkpoint.selectedCheckpointId,
                changeIds: selectedChangeIds,
                confirmedByUser: true
              }
            })
          }
          title="Rollback Preview"
        >
          <div className="ai-checkpoint-rollback-preview">
            <span className="status-pill info">
              {asArray(confirmation.preview?.rolled_back_changes).length} safe
            </span>
            <span className="status-pill warn">
              {asArray(confirmation.preview?.conflicted_changes).length} conflicts
            </span>
          </div>
        </ConfirmationModal>
      ) : null}
    </section>
  );
}

export function DraftReviewRoute(props) {
  return (
    <ActionBindingProvider onAction={props.onAction}>
      <DraftReviewController {...props} />
    </ActionBindingProvider>
  );
}
