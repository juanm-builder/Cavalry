import {
  checkpointRollback,
  draftGroups,
  draftReview as externalDraftReview
} from '@cavalry/action-review';
import {
  applyDraftGroup,
  rejectDraftGroup
} from '@cavalry/action-review/application/drafts/draft-apply-service.js';
import { buildDraftSourceMetadataViewModel } from '@cavalry/action-review/application/drafts/draft-source-metadata-view-model-service.js';
import { buildCheckpointReviewPanelViewModel } from '@cavalry/action-review/application/checkpoints/checkpoint-review-view-model-service.js';
import {
  buildAiDraftResolutionUpdate,
  findAiDraftById,
  refreshAdvisorDraftGroupStatuses,
  validateAiDraftSourceRefs
} from '@cavalry/action-review/domain/drafts/draft-lifecycle.js';
import { draftCards, draftReview as advisorDraftReview } from '@cavalry/advisor';
import {
  cloneWorkbook,
  commandError,
  commandOk
} from '@cavalry/finance-core/application/types/command-result.js';

export const DRAFT_REVIEW_ACTIONS = Object.freeze({
  UPDATE: 'draft/update',
  APPLY: 'draft/apply',
  REJECT: 'draft/reject',
  APPROVE_CHECKPOINT: 'checkpoint/approve',
  ROLLBACK_CHECKPOINT: 'checkpoint/rollback'
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function plain(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return null;
  }
}

function errorResult(workbook, error, fallbackCode = 'draft.command_failed') {
  return commandError(workbook, {
    code: asText(error?.code) || fallbackCode,
    message: asText(error?.message) || 'The draft action could not be completed.',
    ...(error?.details ? { details: plain(error.details) } : {}),
    ...(error?.issues ? { issues: plain(error.issues) } : {})
  });
}

function commandServices(workbook, services = {}) {
  const counters = {};
  const createId =
    typeof services.createId === 'function'
      ? services.createId
      : (prefix = 'id') => {
          counters[prefix] = (counters[prefix] || 0) + 1;
          return `${prefix}_${asArray(workbook?.transactions).length + counters[prefix]}`;
        };
  const timestamp =
    typeof services.now === 'function'
      ? asText(services.now())
      : asText(services.now) || '1970-01-01T00:00:00.000Z';
  return {
    ...services,
    createId,
    now: () => timestamp,
    timestamp
  };
}

function coerceEditedValue(value, currentValue) {
  if (typeof currentValue === 'number') {
    const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(parsed)) throw new Error('Enter a valid number.');
    return parsed;
  }
  if (typeof currentValue === 'boolean') return String(value) === 'true';
  return String(value ?? '').trim();
}

function updateValueAtPath(target, path, value) {
  const segments = asArray(path);
  if (
    !segments.length ||
    segments.some((segment) => ['__proto__', 'prototype', 'constructor'].includes(String(segment)))
  ) {
    throw new Error('That draft field cannot be edited.');
  }
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!current || typeof current !== 'object' || !(segment in current)) {
      throw new Error('That draft field is no longer available.');
    }
    current = current[segment];
  }
  const finalSegment = segments.at(-1);
  if (!current || typeof current !== 'object' || !(finalSegment in current)) {
    throw new Error('That draft field is no longer available.');
  }
  current[finalSegment] = coerceEditedValue(value, current[finalSegment]);
}

function normalizeValidation(workbook, draft, options = {}) {
  const sourceError = validateAiDraftSourceRefs(workbook, draft);
  if (sourceError) return { ok: false, error: sourceError };
  if (options.validationByDraftId?.[draft.id]) {
    return options.validationByDraftId[draft.id];
  }
  if (typeof options.validateAiDraft === 'function') {
    try {
      const result = options.validateAiDraft(workbook, draft);
      return result && typeof result === 'object'
        ? { ok: result.ok !== false, error: asText(result.error || result.reason) }
        : { ok: result !== false, error: '' };
    } catch (error) {
      return { ok: false, error: asText(error?.message) || 'Draft validation failed.' };
    }
  }
  return { ok: true, error: '' };
}

function humanizeKey(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

const FRIENDLY_FIELD_LABELS = Object.freeze({
  amount: 'Amount',
  openingbalance: 'Opening balance',
  planned: 'Budget amount',
  date: 'Date',
  currency: 'Currency',
  template: 'Transaction type',
  primaryaccountid: 'Paid from account',
  primaryaccountname: 'Paid from account',
  paymentaccountid: 'Payment account',
  paymentaccountdisplay: 'Payment account',
  secondaryaccountid: 'Destination account',
  secondaryaccountname: 'Destination account',
  categoryid: 'Category',
  categoryname: 'Category',
  suggestedcategoryid: 'Suggested category',
  counterpartyid: 'Person or merchant',
  counterpartyname: 'Person or merchant',
  counterpartyhint: 'Person or merchant',
  transactionid: 'Transaction',
  description: 'Description',
  note: 'Note',
  notes: 'Notes',
  kind: 'Type',
  mode: 'Review method',
  summary: 'Summary'
});

const MONEY_FIELD_KEYS = new Set([
  'amount',
  'acquisitioncost',
  'annualfee',
  'baseamount',
  'balance',
  'costbasis',
  'creditlimit',
  'estimatedmaturityamount',
  'monthlycontribution',
  'monthlypayment',
  'openingbalance',
  'originalbalance',
  'planned',
  'price',
  'total'
]);

function normalizedFieldKey(value) {
  return String(value || '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function friendlyFieldLabel(key) {
  return FRIENDLY_FIELD_LABELS[normalizedFieldKey(key)] || humanizeKey(key);
}

function fieldHelp(key, label) {
  const normalized = normalizedFieldKey(key);
  if (MONEY_FIELD_KEYS.has(normalized)) return 'The money value that will be recorded.';
  if (normalized === 'date') return 'The date this change will use.';
  if (normalized === 'template') return 'How Cavalry will record this money movement.';
  if (normalized.includes('account')) return 'The workbook account this change will use.';
  if (normalized.includes('category')) return 'The category used for reporting and budgets.';
  if (normalized.includes('counterparty')) return 'The person, business, or organization involved.';
  if (normalized === 'currency') return 'The currency used for this amount.';
  if (normalized === 'description' || normalized === 'summary') {
    return 'The plain-language description saved with this change.';
  }
  if (normalized === 'note' || normalized === 'notes')
    return 'Optional context saved with this change.';
  return `The proposed ${String(label || 'field').toLowerCase()} value.`;
}

function findCurrency(source, fallback = 'PHP') {
  const direct = asText(source?.currency);
  const nested = asText(source?.fields?.currency);
  return direct || nested || asText(fallback) || 'PHP';
}

function formatDraftMoney(value, currency) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  } catch (_error) {
    return `${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}`.trim();
  }
}

function referenceCollection(workbook, key) {
  const normalized = normalizedFieldKey(key);
  if (normalized.includes('accountid')) return asArray(workbook?.accounts);
  if (normalized.includes('categoryid')) return asArray(workbook?.categories);
  if (normalized.includes('counterpartyid')) return asArray(workbook?.counterparties);
  if (normalized.includes('transactionid')) return asArray(workbook?.transactions);
  if (normalized.includes('sheetid')) return asArray(workbook?.sheets);
  return [];
}

function referenceLabel(item) {
  return asText(item?.name || item?.title || item?.description || item?.label || item?.id);
}

function inputOptionsForField(workbook, key, value) {
  const references = referenceCollection(workbook, key);
  if (references.length) {
    const options = references.map((item) => ({
      value: asText(item?.id),
      label: referenceLabel(item),
      type: asText(item?.type)
    }));
    if (value && !options.some((option) => option.value === asText(value))) {
      options.unshift({ value: asText(value), label: `Current value (${asText(value)})` });
    }
    return options;
  }
  if (normalizedFieldKey(key) === 'template') {
    return [
      ['expense_paid', 'Expense paid'],
      ['expense_charged', 'Expense charged to credit'],
      ['income_received', 'Income received'],
      ['transfer', 'Transfer between accounts'],
      ['debt_payment', 'Debt payment'],
      ['opening_balance', 'Opening balance']
    ].map(([optionValue, label]) => ({ value: optionValue, label }));
  }
  if (typeof value === 'boolean') {
    return [
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' }
    ];
  }
  return [];
}

function displayDraftFieldValue(value, key, source, workbook) {
  if (value === '' || value === null || value === undefined) return 'Not provided';
  const normalized = normalizedFieldKey(key);
  if (typeof value === 'number' && MONEY_FIELD_KEYS.has(normalized)) {
    return formatDraftMoney(value, findCurrency(source, workbook?.currency));
  }
  const reference = referenceCollection(workbook, key).find(
    (item) => asText(item?.id) === asText(value)
  );
  if (reference) return referenceLabel(reference);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  if (
    normalized === 'template' ||
    normalized === 'mode' ||
    normalized === 'kind' ||
    normalized === 'type' ||
    normalized === 'action' ||
    normalized.endsWith('id')
  )
    return humanizeKey(value);
  return String(value);
}

function groupLabel(key, index) {
  const normalized = normalizedFieldKey(key);
  const base =
    normalized === 'categorychanges'
      ? 'Category change'
      : normalized === 'counterpartychanges'
        ? 'Person or merchant change'
        : normalized === 'transactionpatches'
          ? 'Transaction update'
          : friendlyFieldLabel(key);
  return `${base} ${index + 1}`;
}

function meaningfulEntries(value) {
  return Object.entries(value && typeof value === 'object' ? value : {}).filter(
    ([, entryValue]) => entryValue !== '' && entryValue !== null && entryValue !== undefined
  );
}

function summarizeChange(key, value) {
  const source = value && typeof value === 'object' ? value : {};
  if (key === 'categoryChanges') {
    const action = humanizeKey(source.action || 'update');
    const name =
      asText(source.name || source.categoryName || source.targetCategoryId) || 'category';
    const type = asText(source.type);
    return `${action} “${name}”${type ? ` · ${humanizeKey(type)}` : ''}`;
  }
  if (key === 'counterpartyChanges') {
    const action = humanizeKey(source.action || 'update');
    const name =
      asText(source.name || source.counterpartyName || source.targetCounterpartyId) ||
      'counterparty';
    const kind = asText(source.kind);
    return `${action} “${name}”${kind ? ` · ${humanizeKey(kind)}` : ''}`;
  }
  if (key === 'transactionPatches') {
    const labels = [];
    if (source.categoryName || source.categoryId) {
      labels.push(`Category: ${humanizeKey(source.categoryName || source.categoryId)}`);
    }
    if (source.counterpartyName || source.counterpartyId) {
      labels.push(`Counterparty: ${source.counterpartyName || humanizeKey(source.counterpartyId)}`);
    }
    return labels.length ? labels.join(' · ') : 'Update transaction details';
  }
  const entries = meaningfulEntries(source)
    .filter(([entryKey]) => !/^(id|clientId)$/i.test(entryKey))
    .slice(0, 5)
    .map(([entryKey, entryValue]) => `${humanizeKey(entryKey)}: ${String(entryValue)}`);
  return entries.join(' · ') || 'No additional details';
}

function summarizeProposedValue(key, value) {
  if (Array.isArray(value)) {
    if (!value.length) return 'None';
    const visible = value
      .slice(0, 6)
      .map((entry) =>
        entry && typeof entry === 'object' ? summarizeChange(key, entry) : String(entry)
      );
    if (value.length > visible.length) visible.push(`+${value.length - visible.length} more`);
    return visible.join('\n');
  }
  if (value && typeof value === 'object') return summarizeChange(key, value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'mode') return humanizeKey(value);
  return String(value ?? '') || 'None';
}

export function formatDraftProposedRows(value, options = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const rows = [];
  const workbook = options.workbook || {};
  const includeEmpty = options.includeEmpty === true;

  function addRow(key, nextValue, path, prefix = '') {
    if (rows.length >= 24) return;
    const label = [prefix, friendlyFieldLabel(key)].filter(Boolean).join(' · ');
    const isPrimitive =
      nextValue === null || ['string', 'number', 'boolean'].includes(typeof nextValue);
    rows.push({
      key: path.join('.'),
      path,
      label,
      value: isPrimitive
        ? displayDraftFieldValue(nextValue, key, source, workbook)
        : summarizeProposedValue(key, nextValue),
      rawValue: isPrimitive ? (nextValue ?? '') : '',
      valueType: nextValue === null ? 'string' : typeof nextValue,
      money: typeof nextValue === 'number' && MONEY_FIELD_KEYS.has(normalizedFieldKey(key)),
      editable: isPrimitive,
      description: isPrimitive
        ? fieldHelp(key, friendlyFieldLabel(key))
        : 'This grouped change is shown as a summary and is not directly editable.',
      inputOptions: isPrimitive ? inputOptionsForField(workbook, key, nextValue) : [],
      itemCount: Array.isArray(nextValue) ? nextValue.length : undefined
    });
  }

  function visit(nextValue, path = [], prefix = '') {
    if (rows.length >= 24 || !nextValue || typeof nextValue !== 'object') return;
    Object.entries(nextValue).forEach(([key, entryValue]) => {
      const normalized = normalizedFieldKey(key);
      const matchingIdKey = Object.keys(nextValue).find(
        (candidate) =>
          normalizedFieldKey(candidate) === normalized.replace(/name$/, 'id') &&
          asText(nextValue[candidate])
      );
      const hasCounterparty = Object.entries(nextValue).some(
        ([candidate, candidateValue]) =>
          ['counterpartyid', 'counterpartyname'].includes(normalizedFieldKey(candidate)) &&
          asText(candidateValue)
      );
      if (
        rows.length >= 24 ||
        /^(id|clientId|evidenceSource|sourceText|missingFields|manualEdit|allowUnsupportedAmount|fieldEvidence)$/i.test(
          key
        ) ||
        /(_display|_hint)$/i.test(key) ||
        ['direction', 'paymentaccountgroup'].includes(normalized) ||
        (normalized === 'template' &&
          path.some((segment) => normalizedFieldKey(segment) === 'fields') &&
          asText(source.template)) ||
        (normalized === 'counterpartykind' && !hasCounterparty) ||
        (!includeEmpty &&
          !Array.isArray(entryValue) &&
          (entryValue === '' || entryValue === null || entryValue === undefined)) ||
        (normalized.endsWith('name') && matchingIdKey)
      )
        return;
      const nextPath = path.concat(key);
      if (Array.isArray(entryValue)) {
        if (!entryValue.length) {
          if (!includeEmpty) return;
          rows.push({
            key: nextPath.join('.'),
            path: nextPath,
            label: [prefix, friendlyFieldLabel(key)].filter(Boolean).join(' · '),
            value: 'None',
            rawValue: '',
            valueType: 'object',
            editable: false,
            description: 'No changes are proposed in this group.',
            inputOptions: [],
            itemCount: 0
          });
          return;
        }
        if (entryValue.every((entry) => entry && typeof entry === 'object')) {
          entryValue.forEach((entry, index) =>
            visit(entry, nextPath.concat(index), groupLabel(key, index))
          );
          return;
        }
        addRow(key, entryValue, nextPath, prefix);
        return;
      }
      if (entryValue && typeof entryValue === 'object') {
        visit(
          entryValue,
          nextPath,
          normalizedFieldKey(key) === 'fields' ? prefix : friendlyFieldLabel(key)
        );
        return;
      }
      addRow(key, entryValue, nextPath, prefix);
    });
  }

  visit(source);
  return rows;
}

function externalQueueItems(workbook) {
  return draftGroups.listDraftGroupsForReview(workbook || {}).map((group) => {
    const review = draftGroups.buildDraftGroupReviewModel(workbook, group.draft_group_id);
    const projection = externalDraftReview.buildDraftGroupReviewProjection(
      workbook,
      group.draft_group_id,
      {
        conflicts: review.conflicts
      }
    );
    const source = buildDraftSourceMetadataViewModel(
      {
        source: { type: 'external_api', externalDraftGroupId: group.draft_group_id },
        createdAt: group.created_at
      },
      { group }
    ).external;
    return {
      key: `external:${group.draft_group_id}`,
      kind: 'external-group',
      id: group.draft_group_id,
      title: projection.title,
      summary: `${projection.summary.ready} ready · ${projection.issueCounts.total} issues`,
      status: projection.status,
      statusLabel: projection.status.replace(/_/g, ' '),
      statusTone: projection.canApply
        ? 'good'
        : projection.blockingConflicts.length
          ? 'warn'
          : 'info',
      createdAt: projection.createdAt,
      amountDisplay: `${projection.summary.total} proposal${projection.summary.total === 1 ? '' : 's'}`,
      canApply: projection.canApply,
      canReject: projection.canReject,
      conflicts: plain(projection.conflicts) || [],
      blockingConflicts: plain(projection.blockingConflicts) || [],
      warnings: plain(projection.warningConflicts) || [],
      validationIssues: plain(projection.validationIssues) || [],
      source,
      drafts: projection.drafts.map((draft) => {
        const ready =
          draft.status === 'ready' &&
          !draft.conflicts.some(
            (conflict) => conflict.severity !== 'warning' && conflict.severity !== 'info'
          );
        return {
          id: draft.draftId,
          title: draft.title,
          summary: draft.summary,
          type: draft.type,
          status: draft.status,
          ready,
          issues: plain(draft.validationIssues) || [],
          conflicts: plain(draft.conflicts) || [],
          proposedRows: formatDraftProposedRows(draft.proposedValues, {
            workbook,
            includeEmpty: !ready
          })
        };
      })
    };
  });
}

function localQueueItems(workbook, options) {
  const route = advisorDraftReview.buildDraftReviewRouteViewModel(workbook || {}, {
    selectedDraftId: options.selectedDraftId,
    showAll: options.showAll,
    validateDraft: options.validateAiDraft,
    validationByDraftId: options.validationByDraftId
  });
  const drafts = asArray(workbook?.aiDrafts);
  const representedExternalGroups = new Set(
    asArray(workbook?.externalDraftGroups)
      .map((group) => group?.draft_group_id)
      .filter(Boolean)
  );
  return route.reviewDraftIds
    .map((draftId) => {
      const draft = drafts.find((item) => item?.id === draftId);
      if (representedExternalGroups.has(draft?.source?.externalDraftGroupId)) return null;
      const validation = normalizeValidation(workbook, draft, options);
      const card = draftCards.buildAiDraftCardViewModel(workbook, draft, { validation });
      const source = buildDraftSourceMetadataViewModel(draft, {
        externalDraftGroup: asArray(workbook?.externalDraftGroups).find((group) => {
          return group?.draft_group_id === draft?.source?.externalDraftGroupId;
        })
      });
      return {
        key: `ai:${draftId}`,
        kind: 'ai-draft',
        id: draftId,
        title: card.title,
        summary: card.statusCopy,
        status: draft.status,
        statusLabel: card.displayStatusLabel,
        statusTone: card.reviewStatus.tone,
        createdAt: draft.createdAt || '',
        amountDisplay: card.amountDisplay,
        canApply: card.canConfirm,
        canReject: card.canResolve,
        conflicts: [],
        blockingConflicts: validation.ok
          ? []
          : [{ code: 'draft_validation_failed', message: validation.error }],
        warnings: [],
        validationIssues: validation.ok
          ? []
          : [{ code: 'draft_validation_failed', message: validation.error }],
        source: source.external,
        drafts: [
          {
            id: draftId,
            title: card.title,
            summary: card.statusCopy,
            type: card.objectLabel,
            status: draft.status,
            ready: card.canConfirm,
            issues: validation.ok ? [] : [{ message: validation.error }],
            conflicts: [],
            proposedRows: formatDraftProposedRows(draft.proposed, {
              workbook,
              includeEmpty: !card.canConfirm
            })
          }
        ]
      };
    })
    .filter(Boolean);
}

export function buildDraftReviewFeatureModel(workbook, options = {}) {
  const externalItems = externalQueueItems(workbook);
  const localItems = localQueueItems(workbook, options);
  const queueItems = externalItems.concat(localItems);
  const requestedKey = asText(options.selectedKey);
  const selectedKey = queueItems.some((item) => item.key === requestedKey)
    ? requestedKey
    : queueItems[0]?.key || '';
  const resolvedExternal = asArray(workbook?.externalDraftGroups)
    .filter((group) => ['applied', 'rejected', 'expired'].includes(group?.status))
    .map((group) => ({
      key: `external:${group.draft_group_id}`,
      title: group.title || 'Draft group',
      status: group.status,
      resolvedAt: group.applied_at || group.rejected_at || ''
    }));
  const resolvedLocal = asArray(workbook?.aiDrafts)
    .filter((draft) => ['confirmed', 'rejected'].includes(draft?.status))
    .map((draft) => ({
      key: `ai:${draft.id}`,
      title: draft.title || 'AI draft',
      status: draft.status,
      resolvedAt: draft.resolvedAt || ''
    }));
  const readyCount = queueItems.filter((item) => item.canApply).length;
  const needsFixCount = queueItems.length - readyCount;
  const checkpointModel = buildCheckpointReviewPanelViewModel(asArray(workbook?.checkpoints), {
    selectedCheckpointId: options.selectedCheckpointId
  });
  const selectedCheckpoint = asArray(workbook?.checkpoints).find((checkpoint) => {
    return checkpoint?.checkpoint_id === checkpointModel.selectedCheckpointId;
  });
  if (checkpointModel.visible) {
    checkpointModel.visibleChangeRows = checkpointModel.visibleChangeRows.map((row, index) => {
      const change = asArray(selectedCheckpoint?.changes)[index] || {};
      return {
        ...row,
        changeId: change.change_id || '',
        reversible:
          change.status === 'applied' &&
          change.inverse_patch &&
          change.inverse_patch.type !== 'unsupported_rollback'
      };
    });
    checkpointModel.reviewStatus = selectedCheckpoint?.review_status || '';
  }
  return {
    openCount: queueItems.length,
    selectedKey,
    queueItems: options.showAll ? queueItems : queueItems.slice(0, 8),
    hiddenQueueCount: options.showAll ? 0 : Math.max(0, queueItems.length - 8),
    commandBar: advisorDraftReview.buildDraftReviewCommandBarViewModel({
      readyCount,
      needsFixCount,
      confirmedCount:
        resolvedLocal.filter((item) => item.status === 'confirmed').length +
        resolvedExternal.filter((item) => item.status === 'applied').length,
      rejectedCount:
        resolvedLocal.filter((item) => item.status === 'rejected').length +
        resolvedExternal.filter((item) => item.status === 'rejected').length
    }),
    checkpoints: checkpointModel,
    recentDecisions: resolvedExternal
      .concat(resolvedLocal)
      .sort((left, right) => asText(right.resolvedAt).localeCompare(asText(left.resolvedAt)))
      .slice(0, 8)
  };
}

export function previewCheckpointRollback(workbook, payload = {}) {
  if (!workbook) {
    return {
      status: 'failed',
      conflicted_changes: [{ reason: 'workbook_required' }],
      rolled_back_changes: []
    };
  }
  return checkpointRollback.previewRollback({
    workbook: cloneWorkbook(workbook),
    checkpointId: payload.checkpointId,
    changeIds: payload.changeIds
  });
}

export function executeDraftReviewCommand(workbook, action, services = {}) {
  if (!workbook || typeof workbook !== 'object') {
    return errorResult(workbook, {
      code: 'draft.workbook_required',
      message: 'Open a workbook before reviewing drafts.'
    });
  }
  const type = asText(action?.type);
  const payload = action?.payload && typeof action.payload === 'object' ? action.payload : {};
  const nextWorkbook = cloneWorkbook(workbook);
  const ports = commandServices(nextWorkbook, services);

  try {
    if (type === DRAFT_REVIEW_ACTIONS.UPDATE && payload.kind === 'ai-draft') {
      const draft = findAiDraftById(nextWorkbook, payload.id);
      if (!draft) {
        return errorResult(workbook, { code: 'draft.not_found', message: 'Draft was not found.' });
      }
      if (['confirmed', 'rejected'].includes(draft.status)) {
        return errorResult(workbook, {
          code: 'draft.already_resolved',
          message: 'Applied or rejected drafts can no longer be edited.'
        });
      }
      updateValueAtPath(draft.proposed, payload.path, payload.value);
      const validation = normalizeValidation(nextWorkbook, draft, services);
      draft.status = validation.ok ? 'pending' : 'needs_fix';
      draft.error = validation.ok ? '' : validation.error;
      refreshAdvisorDraftGroupStatuses(nextWorkbook, { resolvedAt: ports.timestamp });
      return commandOk(nextWorkbook, {
        events: [{ type: 'draft.updated', draftKind: payload.kind, draftId: payload.id }]
      });
    }

    if (type === DRAFT_REVIEW_ACTIONS.UPDATE && payload.kind === 'external-group') {
      const group = asArray(nextWorkbook.externalDraftGroups).find(
        (item) => asText(item?.draft_group_id) === asText(payload.id)
      );
      const draft = asArray(group?.drafts).find(
        (item) => asText(item?.draft_id) === asText(payload.draftId)
      );
      if (!group || !draft) {
        return errorResult(workbook, { code: 'draft.not_found', message: 'Draft was not found.' });
      }
      if (!['pending_review', 'partially_ready', 'needs_info', 'blocked'].includes(group.status)) {
        return errorResult(workbook, {
          code: 'draft.already_resolved',
          message: 'Applied or rejected drafts can no longer be edited.'
        });
      }
      updateValueAtPath(draft.proposed_values, payload.path, payload.value);
      group.updated_at = ports.timestamp;
      return commandOk(nextWorkbook, {
        events: [
          {
            type: 'draft.updated',
            draftKind: payload.kind,
            draftId: payload.draftId,
            draftGroupId: payload.id
          }
        ]
      });
    }

    if (type === DRAFT_REVIEW_ACTIONS.APPLY && payload.kind === 'external-group') {
      const group = applyDraftGroup({
        workbook: nextWorkbook,
        draftGroupId: payload.id,
        selectedDraftIds: payload.selectedDraftIds,
        confirmedByUser: payload.confirmedByUser === true,
        caller: services.caller || { user_id: 'cavalry_user', scopes: ['cavalry.draft.apply'] },
        createId: ports.createId,
        now: ports.now
      });
      return commandOk(nextWorkbook, {
        events: [
          {
            type: 'draft.applied',
            draftKind: payload.kind,
            draftId: payload.id,
            appliedDraftIds: plain(group.applied_draft_ids) || []
          }
        ]
      });
    }

    if (type === DRAFT_REVIEW_ACTIONS.REJECT && payload.kind === 'external-group') {
      const group = rejectDraftGroup({
        workbook: nextWorkbook,
        draftGroupId: payload.id,
        caller: services.caller || { user_id: 'cavalry_user', scopes: ['cavalry.draft.apply'] },
        createId: ports.createId,
        now: ports.now
      });
      return commandOk(nextWorkbook, {
        events: [
          {
            type: 'draft.rejected',
            draftKind: payload.kind,
            draftId: payload.id,
            status: group.status
          }
        ]
      });
    }

    if (
      [DRAFT_REVIEW_ACTIONS.APPLY, DRAFT_REVIEW_ACTIONS.REJECT].includes(type) &&
      payload.kind === 'ai-draft'
    ) {
      const draft = findAiDraftById(nextWorkbook, payload.id);
      if (!draft)
        return errorResult(workbook, { code: 'draft.not_found', message: 'Draft was not found.' });
      if (type === DRAFT_REVIEW_ACTIONS.REJECT) {
        Object.assign(
          draft,
          buildAiDraftResolutionUpdate('rejected', { resolvedAt: ports.timestamp })
        );
        refreshAdvisorDraftGroupStatuses(nextWorkbook, { resolvedAt: ports.timestamp });
        return commandOk(nextWorkbook, {
          events: [{ type: 'draft.rejected', draftKind: payload.kind, draftId: payload.id }]
        });
      }
      if (payload.confirmedByUser !== true) {
        return errorResult(workbook, {
          code: 'draft.confirmation_required',
          message: 'Applying a draft requires explicit confirmation.'
        });
      }
      const validation = normalizeValidation(nextWorkbook, draft, services);
      if (!validation.ok)
        return errorResult(workbook, {
          code: 'draft.validation_failed',
          message: validation.error
        });
      let resultObjectId = '';
      if (draft.objectType !== 'ledgerReview') {
        if (typeof services.applyAiDraftMutation !== 'function') {
          return errorResult(workbook, {
            code: 'draft.apply_adapter_required',
            message: 'This draft type needs its domain apply adapter before it can be posted.'
          });
        }
        resultObjectId = asText(services.applyAiDraftMutation(nextWorkbook, draft));
      }
      Object.assign(
        draft,
        buildAiDraftResolutionUpdate('confirmed', {
          resolvedAt: ports.timestamp,
          resultObjectId
        })
      );
      refreshAdvisorDraftGroupStatuses(nextWorkbook, { resolvedAt: ports.timestamp });
      return commandOk(nextWorkbook, {
        events: [
          { type: 'draft.applied', draftKind: payload.kind, draftId: payload.id, resultObjectId }
        ]
      });
    }

    if (type === DRAFT_REVIEW_ACTIONS.APPROVE_CHECKPOINT) {
      const checkpoint = asArray(nextWorkbook.checkpoints).find(
        (item) => item?.checkpoint_id === payload.checkpointId
      );
      if (!checkpoint)
        return errorResult(workbook, {
          code: 'checkpoint.not_found',
          message: 'Checkpoint was not found.'
        });
      checkpoint.review_status = 'approved';
      checkpoint.reviewed_at = ports.timestamp;
      return commandOk(nextWorkbook, {
        events: [{ type: 'checkpoint.approved', checkpointId: payload.checkpointId }]
      });
    }

    if (type === DRAFT_REVIEW_ACTIONS.ROLLBACK_CHECKPOINT) {
      if (payload.confirmedByUser !== true) {
        return errorResult(workbook, {
          code: 'checkpoint.confirmation_required',
          message: 'Rollback requires explicit confirmation.'
        });
      }
      const rollback = checkpointRollback.rollbackCheckpoint({
        workbook: nextWorkbook,
        checkpointId: payload.checkpointId,
        changeIds: payload.changeIds,
        conflictPolicy: 'safe_only',
        caller: services.caller || { callerType: 'cavalry_user' },
        createId: ports.createId,
        now: ports.now
      });
      if (asArray(rollback.conflicted_changes).length) {
        return errorResult(workbook, {
          code: 'checkpoint.rollback_conflict',
          message:
            'The workbook changed after this checkpoint. Review conflicts before rolling back.',
          details: rollback
        });
      }
      return commandOk(nextWorkbook, {
        events: [
          {
            type: 'checkpoint.rolled_back',
            checkpointId: payload.checkpointId,
            changeIds: plain(rollback.rolled_back_changes) || []
          }
        ]
      });
    }

    return errorResult(workbook, {
      code: 'draft.action_unknown',
      message: `Unsupported draft action: ${type || 'empty'}.`
    });
  } catch (error) {
    return errorResult(workbook, error);
  }
}
