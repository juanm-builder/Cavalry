function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (typeof value === 'undefined') return undefined;
  return JSON.parse(JSON.stringify(value));
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!(Array.isArray(left) && Array.isArray(right)) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!(isPlainObject(left) && isPlainObject(right))) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]))
    );
  }
  return false;
}

function normalizedId(value) {
  return String(value == null ? '' : value).trim();
}

function isIdCollection(values) {
  const arrays = values.filter(Array.isArray);
  if (arrays.length !== values.length) return false;
  const items = arrays.flat();
  if (!items.length) return false;
  if (!items.every((item) => isPlainObject(item) && normalizedId(item.id))) return false;
  return arrays.every((itemsInArray) => {
    const ids = itemsInArray.map((item) => normalizedId(item.id));
    return new Set(ids).size === ids.length;
  });
}

function itemMap(items) {
  return new Map(items.map((item) => [normalizedId(item.id), item]));
}

function conflict(path, kind) {
  return { path: path || '$', kind };
}

const AUTOMATIC_SETTINGS_PATHS = Object.freeze([
  'settings.activeAdvisorThreadId',
  'settings.dashboardLayout',
  'settings.fileAutosave',
  'settings.hiddenMonthlyMetrics',
  'settings.lastSavedAt',
  'settings.subscriptionReviewDecisions'
]);

const AUTOMATIC_COLLECTION_PATHS = new Set([
  'advisorDraftGroups',
  'advisorThreads',
  'aiDrafts',
  'checkpoints',
  'externalDraftGroups',
  'recurringReconciliations'
]);

function isAutomaticSettingsPath(path) {
  return AUTOMATIC_SETTINGS_PATHS.some(
    (candidate) => path === candidate || path.startsWith(`${candidate}.`)
  );
}

function isAutomaticMergePath(path) {
  if (['createdAt', 'updatedAt', 'version'].includes(path)) return true;
  if (/(?:^|\.)createdAt$/.test(path) || /(?:^|\.)updatedAt$/.test(path)) return true;
  return isAutomaticSettingsPath(path);
}

function isAutomaticCollectionPath(path) {
  return AUTOMATIC_COLLECTION_PATHS.has(path);
}

function timestampValue(value) {
  const source = String(value == null ? '' : value);
  return Number.isNaN(Date.parse(source)) ? '' : source;
}

function earliestTimestamp(...values) {
  return values.map(timestampValue).filter(Boolean).sort().at(0);
}

function preferredAutomaticValue(local, remote) {
  if (typeof local === 'undefined') return cloneJson(remote);
  if (typeof remote === 'undefined') return cloneJson(local);
  if (isPlainObject(local) && isPlainObject(remote)) {
    const localTimestamp = timestampValue(local.updatedAt || local.createdAt);
    const remoteTimestamp = timestampValue(remote.updatedAt || remote.createdAt);
    if (localTimestamp && remoteTimestamp && localTimestamp !== remoteTimestamp) {
      return cloneJson(localTimestamp > remoteTimestamp ? local : remote);
    }
  }
  return cloneJson(remote);
}

function automaticMergeValue(path, base, local, remote) {
  if (/(?:^|\.)updatedAt$/.test(path) || path === 'settings.lastSavedAt') {
    return latestTimestamp(base, local, remote) || preferredAutomaticValue(local, remote);
  }
  if (/(?:^|\.)createdAt$/.test(path)) {
    return earliestTimestamp(base, local, remote) || preferredAutomaticValue(local, remote);
  }
  if (path === 'version') {
    const versions = [base, local, remote].filter(Number.isFinite);
    return versions.length ? Math.max(...versions) : preferredAutomaticValue(local, remote);
  }
  return preferredAutomaticValue(local, remote);
}

function entityWithoutBookkeepingMetadata(value) {
  if (!isPlainObject(value)) return value;
  const copy = cloneJson(value);
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy;
}

function entitiesEqual(left, right) {
  return deepEqual(entityWithoutBookkeepingMetadata(left), entityWithoutBookkeepingMetadata(right));
}

function withMergedEntityBookkeeping(value, ...candidates) {
  if (!isPlainObject(value)) return cloneJson(value);
  const result = cloneJson(value);
  if (candidates.some((candidate) => isPlainObject(candidate) && 'createdAt' in candidate)) {
    const createdAt = earliestTimestamp(...candidates.map((candidate) => candidate?.createdAt));
    if (createdAt) result.createdAt = createdAt;
  }
  if (candidates.some((candidate) => isPlainObject(candidate) && 'updatedAt' in candidate)) {
    const updatedAt = latestTimestamp(...candidates.map((candidate) => candidate?.updatedAt));
    if (updatedAt) result.updatedAt = updatedAt;
  }
  return result;
}

const COLLECTION_LABELS = Object.freeze({
  accounts: 'Accounts',
  advisorDraftGroups: 'Assistant drafts',
  advisorThreads: 'Assistant conversations',
  aiDrafts: 'Assistant drafts',
  assets: 'Assets',
  categories: 'Categories',
  checkpoints: 'Checkpoints',
  counterparties: 'People & merchants',
  externalDraftGroups: 'Imported drafts',
  fxRates: 'Exchange rates',
  plannerBuckets: 'Planning groups',
  recurringItems: 'Bills & subscriptions',
  recurringReconciliations: 'Recurring matches',
  sheets: 'Budgets',
  transactions: 'Transactions'
});

const FIELD_LABELS = Object.freeze({
  accountId: 'Account',
  amount: 'Amount',
  anchorDate: 'Starting date',
  autoRenew: 'Auto-renew',
  baseAmount: 'Base amount',
  categoryId: 'Category',
  color: 'Color',
  counterpartyId: 'Person or merchant',
  currency: 'Currency',
  date: 'Date',
  description: 'Description',
  dueDate: 'Due date',
  frequency: 'Frequency',
  fxRateToBase: 'Exchange rate',
  group: 'Account type',
  institution: 'Institution',
  isActive: 'Active',
  kind: 'Type',
  lines: 'Account entries',
  linkedAccountId: 'Linked account',
  name: 'Name',
  note: 'Note',
  originalCurrency: 'Currency',
  planned: 'Planned amount',
  reference: 'Reference',
  template: 'Transaction type',
  usdToBaseRate: 'USD exchange rate',
  year: 'Year'
});

const REVIEW_FIELD_PRIORITY = Object.freeze([
  'description',
  'name',
  'date',
  'amount',
  'originalCurrency',
  'currency',
  'accountId',
  'categoryId',
  'counterpartyId',
  'reference',
  'note',
  'isActive'
]);

function humanize(value) {
  const source = String(value == null ? '' : value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return source ? source.charAt(0).toUpperCase() + source.slice(1) : 'Workbook';
}

function truncate(value, maximum = 120) {
  const source = String(value == null ? '' : value).trim();
  return source.length > maximum ? `${source.slice(0, maximum - 1)}…` : source;
}

function displayValue(value, field, entity, workbook) {
  if (typeof value === 'undefined' || value === null || value === '') return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    const amountField = /amount|planned|balance|payment|cost|fee/i.test(field);
    const formatted = Number.isInteger(value)
      ? value.toLocaleString('en-US')
      : value.toLocaleString('en-US', { maximumFractionDigits: 6 });
    if (!amountField) return formatted;
    const currency = normalizedId(
      (entity && (entity.originalCurrency || entity.currency)) || (workbook && workbook.currency)
    ).toUpperCase();
    return currency ? `${currency} ${formatted}` : formatted;
  }
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (isPlainObject(value)) return 'Changed';
  return truncate(value);
}

function pathParts(path) {
  if (!path || path === '$') return [];
  const parts = [];
  const pattern = /(?:^|\.)([A-Za-z0-9_$-]+)|\[((?:"(?:\\.|[^"\\])*")|(?:\d+))\]/g;
  let match;
  while ((match = pattern.exec(path))) {
    if (match[1]) parts.push(match[1]);
    else if (match[2]) {
      try {
        parts.push(JSON.parse(match[2]));
      } catch {
        parts.push(match[2]);
      }
    }
  }
  return parts;
}

function valueAtPath(value, parts) {
  let current = value;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (Array.isArray(current)) {
      current = current.find((item) => normalizedId(item && item.id) === normalizedId(part));
    } else if (isPlainObject(current)) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function sideAction(baseValue, sideValue, baseKnown) {
  if (!baseKnown) return 'different';
  if (typeof baseValue === 'undefined' && typeof sideValue !== 'undefined') return 'added';
  if (typeof baseValue !== 'undefined' && typeof sideValue === 'undefined') return 'deleted';
  if (deepEqual(baseValue, sideValue)) return 'unchanged';
  return 'edited';
}

function orderedReviewFields(values) {
  const fields = new Set(
    values
      .filter(isPlainObject)
      .flatMap((value) => Object.keys(value))
      .filter((field) => !['id', 'createdAt', 'updatedAt', 'monthKey', 'source'].includes(field))
  );
  return [...fields].sort((left, right) => {
    const leftPriority = REVIEW_FIELD_PRIORITY.indexOf(left);
    const rightPriority = REVIEW_FIELD_PRIORITY.indexOf(right);
    if (leftPriority >= 0 || rightPriority >= 0) {
      return (leftPriority < 0 ? 999 : leftPriority) - (rightPriority < 0 ? 999 : rightPriority);
    }
    return left.localeCompare(right);
  });
}

function sideDetails(baseValue, sideValue, action, workbook) {
  if (action === 'unchanged') return [];
  if (!(isPlainObject(baseValue) || isPlainObject(sideValue))) {
    return [
      {
        label: 'Value',
        before: displayValue(baseValue, '', null, workbook),
        after: displayValue(sideValue, '', null, workbook)
      }
    ];
  }
  const entity = isPlainObject(sideValue) ? sideValue : baseValue;
  const fields = orderedReviewFields([baseValue, sideValue]);
  const details = [];
  for (const field of fields) {
    const before = isPlainObject(baseValue) ? baseValue[field] : undefined;
    const after = isPlainObject(sideValue) ? sideValue[field] : undefined;
    if (action === 'edited' && deepEqual(before, after)) continue;
    details.push({
      label: FIELD_LABELS[field] || humanize(field),
      before: displayValue(before, field, entity, workbook),
      after: displayValue(after, field, entity, workbook)
    });
    if (details.length === 8) break;
  }
  return details;
}

function entityTitle(collection, baseValue, localValue, remoteValue) {
  const entity = [localValue, remoteValue, baseValue].find(isPlainObject) || {};
  if (collection === 'transactions') {
    return truncate(entity.description || entity.reference || 'Transaction');
  }
  if (collection === 'sheets') return truncate(entity.name || entity.monthKey || 'Budget');
  if (collection === 'fxRates') {
    return (
      truncate(entity.pair || `${entity.fromCurrency || ''} to ${entity.toCurrency || ''}`) ||
      'Exchange rate'
    );
  }
  return truncate(entity.name || entity.title || entity.label || humanize(collection));
}

function conflictMessage(kind, localAction, remoteAction) {
  if (kind === 'delete_vs_change') {
    return localAction === 'deleted'
      ? 'This device deleted it while iCloud changed it.'
      : 'iCloud deleted it while this device changed it.';
  }
  if (kind === 'merge_base_missing') {
    return 'Cavalry could not identify the last version these copies shared.';
  }
  if (kind === 'copies_differ_without_base') {
    return 'The two copies contain different versions of this item.';
  }
  if (kind === 'same_record_changed') {
    return 'Both copies changed this item differently.';
  }
  return 'Both copies changed this value differently.';
}

function expandCompositeReviewConflicts(conflicts, local, remote) {
  const expanded = [];
  for (const item of conflicts) {
    const path = String(item?.path || '$');
    if (!['$', 'settings'].includes(path)) {
      expanded.push(item);
      continue;
    }
    const parts = pathParts(path);
    const localValue = valueAtPath(local, parts);
    const remoteValue = valueAtPath(remote, parts);
    if (!(isPlainObject(localValue) && isPlainObject(remoteValue))) {
      if (!isAutomaticMergePath(path)) expanded.push(item);
      continue;
    }
    const nestedConflicts = [];
    mergeWithoutBaseValue(localValue, remoteValue, path === '$' ? '' : path, nestedConflicts);
    expanded.push(...nestedConflicts);
  }
  return expanded.filter((item) => !isAutomaticMergePath(String(item?.path || '$')));
}

/**
 * Converts structural merge conflicts into a compact, serializable review that
 * UI surfaces can explain without exposing raw workbook JSON.
 */
export function describeWorkbookConflicts({
  base = null,
  local,
  remote,
  conflicts = [],
  localLabel = 'This device',
  remoteLabel = 'iCloud'
} = {}) {
  const safeLocal = isPlainObject(local) ? local : {};
  const safeRemote = isPlainObject(remote) ? remote : {};
  const baseKnown = isPlainObject(base);
  const safeBase = baseKnown ? base : {};
  const reviewConflicts = expandCompositeReviewConflicts(conflicts, safeLocal, safeRemote);
  const entries = reviewConflicts.slice(0, 50).map((item, index) => {
    const path = String((item && item.path) || '$');
    const parts = pathParts(path);
    const collection = String(parts[0] || 'workbook');
    const baseValue = valueAtPath(safeBase, parts);
    const localValue = valueAtPath(safeLocal, parts);
    const remoteValue = valueAtPath(safeRemote, parts);
    const localAction = sideAction(baseValue, localValue, baseKnown);
    const remoteAction = sideAction(baseValue, remoteValue, baseKnown);
    const field = String(parts.at(-1) || 'workbook');
    const isEntityConflict = [
      safeBase[collection],
      safeLocal[collection],
      safeRemote[collection]
    ].some(Array.isArray);
    return {
      key: `${path}:${String((item && item.kind) || 'both_changed')}:${index}`,
      path,
      kind: String((item && item.kind) || 'both_changed'),
      section: COLLECTION_LABELS[collection] || humanize(collection),
      title:
        parts.length >= 2 && isEntityConflict
          ? entityTitle(collection, baseValue, localValue, remoteValue)
          : FIELD_LABELS[field] || humanize(field),
      message: conflictMessage(item && item.kind, localAction, remoteAction),
      local: {
        label: truncate(localLabel, 40) || 'This device',
        action: localAction,
        details: sideDetails(baseValue, localValue, localAction, safeLocal)
      },
      remote: {
        label: truncate(remoteLabel, 40) || 'iCloud',
        action: remoteAction,
        details: sideDetails(baseValue, remoteValue, remoteAction, safeRemote)
      }
    };
  });
  return {
    version: 1,
    workbookId: normalizedId(safeLocal.id || safeRemote.id),
    workbookName: truncate(safeLocal.name || safeRemote.name || 'Workbook', 160),
    conflictCount: reviewConflicts.length,
    omittedCount: Math.max(0, reviewConflicts.length - entries.length),
    entries
  };
}

/**
 * Identifies legacy reviews that exposed a whole workbook, a settings blob, or
 * bookkeeping metadata. Source devices use this to republish a precise review
 * after upgrading instead of asking the user to interpret internal state.
 */
export function shouldRefreshWorkbookConflictReview(review = {}) {
  const entries = Array.isArray(review?.entries) ? review.entries : [];
  if (Number(review?.conflictCount) > 0 && entries.length === 0) return true;
  return entries.some((entry) => {
    const path = String(entry?.path || '$');
    return path === '$' || path === 'settings' || isAutomaticMergePath(path);
  });
}

function selectedConflictValue(path, localValue, remoteValue, resolutions) {
  if (!(resolutions && resolutions.choices.has(path))) return { selected: false };
  const side = resolutions.choices.get(path);
  resolutions.used.add(path);
  return {
    selected: true,
    value: cloneJson(side === 'local' ? localValue : remoteValue)
  };
}

function mergeIdCollection(base, local, remote, path, conflicts, resolutions = null) {
  const baseMap = itemMap(base);
  const localMap = itemMap(local);
  const remoteMap = itemMap(remote);
  const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
  const merged = new Map();

  for (const id of ids) {
    const baseHas = baseMap.has(id);
    const localHas = localMap.has(id);
    const remoteHas = remoteMap.has(id);
    const baseValue = baseHas ? baseMap.get(id) : undefined;
    const localValue = localHas ? localMap.get(id) : undefined;
    const remoteValue = remoteHas ? remoteMap.get(id) : undefined;

    if (localHas === remoteHas && entitiesEqual(localValue, remoteValue)) {
      if (localHas) {
        merged.set(id, withMergedEntityBookkeeping(localValue, baseValue, localValue, remoteValue));
      }
      continue;
    }
    if (localHas === baseHas && entitiesEqual(localValue, baseValue)) {
      if (remoteHas) {
        merged.set(
          id,
          withMergedEntityBookkeeping(remoteValue, baseValue, localValue, remoteValue)
        );
      }
      continue;
    }
    if (remoteHas === baseHas && entitiesEqual(remoteValue, baseValue)) {
      if (localHas) {
        merged.set(id, withMergedEntityBookkeeping(localValue, baseValue, localValue, remoteValue));
      }
      continue;
    }

    if (isAutomaticCollectionPath(path)) {
      const automaticValue = preferredAutomaticValue(
        localHas ? localValue : undefined,
        remoteHas ? remoteValue : undefined
      );
      if (typeof automaticValue !== 'undefined') {
        merged.set(
          id,
          withMergedEntityBookkeeping(automaticValue, baseValue, localValue, remoteValue)
        );
      }
      continue;
    }

    const itemPath = `${path}[${JSON.stringify(id)}]`;
    const selected = selectedConflictValue(
      itemPath,
      localHas ? localValue : undefined,
      remoteHas ? remoteValue : undefined,
      resolutions
    );
    if (selected.selected) {
      if (typeof selected.value !== 'undefined') merged.set(id, selected.value);
      continue;
    }
    conflicts.push(
      conflict(itemPath, !localHas || !remoteHas ? 'delete_vs_change' : 'same_record_changed')
    );
  }

  const baseOrder = base.map((item) => normalizedId(item.id)).filter((id) => merged.has(id));
  const additions = [...merged.keys()]
    .filter((id) => !baseMap.has(id))
    .sort((left, right) => left.localeCompare(right));
  return [...baseOrder, ...additions].map((id) => merged.get(id));
}

function latestTimestamp(...values) {
  return values
    .filter((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)))
    .sort((left, right) => left.localeCompare(right))
    .at(-1);
}

function mergeValue(base, local, remote, path, conflicts, resolutions = null) {
  if (deepEqual(local, remote)) return cloneJson(local);
  if (deepEqual(local, base)) return cloneJson(remote);
  if (deepEqual(remote, base)) return cloneJson(local);

  if (
    isAutomaticMergePath(path) &&
    !(isPlainObject(base) && isPlainObject(local) && isPlainObject(remote))
  ) {
    return automaticMergeValue(path, base, local, remote);
  }

  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
    const result = {};
    const keys = [
      ...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])
    ].sort();
    for (const key of keys) {
      const merged = mergeValue(
        base[key],
        local[key],
        remote[key],
        path ? `${path}.${key}` : key,
        conflicts,
        resolutions
      );
      if (typeof merged !== 'undefined') result[key] = merged;
    }
    return result;
  }

  if (
    Array.isArray(base) &&
    Array.isArray(local) &&
    Array.isArray(remote) &&
    isIdCollection([base, local, remote])
  ) {
    return mergeIdCollection(base, local, remote, path, conflicts, resolutions);
  }

  const selected = selectedConflictValue(path || '$', local, remote, resolutions);
  if (selected.selected) return selected.value;
  conflicts.push(conflict(path, 'both_changed'));
  return cloneJson(local);
}

function deterministicTransactionOrder(left, right) {
  const leftDate = String(left && left.date ? left.date : '');
  const rightDate = String(right && right.date ? right.date : '');
  const dateOrder = leftDate.localeCompare(rightDate);
  if (dateOrder !== 0) return dateOrder;
  return normalizedId(left && left.id).localeCompare(normalizedId(right && right.id));
}

function mergeIdCollectionWithoutBase(local, remote, path, conflicts, resolutions = null) {
  const localMap = itemMap(local);
  const remoteMap = itemMap(remote);
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()]);
  const merged = new Map();

  for (const id of ids) {
    const localValue = localMap.get(id);
    const remoteValue = remoteMap.get(id);
    if (typeof localValue === 'undefined') {
      merged.set(id, cloneJson(remoteValue));
      continue;
    }
    if (typeof remoteValue === 'undefined') {
      merged.set(id, cloneJson(localValue));
      continue;
    }
    if (entitiesEqual(localValue, remoteValue)) {
      merged.set(id, withMergedEntityBookkeeping(localValue, localValue, remoteValue));
      continue;
    }
    if (isAutomaticCollectionPath(path)) {
      const automaticValue = preferredAutomaticValue(localValue, remoteValue);
      merged.set(id, withMergedEntityBookkeeping(automaticValue, localValue, remoteValue));
      continue;
    }

    const itemPath = `${path}[${JSON.stringify(id)}]`;
    const selected = selectedConflictValue(itemPath, localValue, remoteValue, resolutions);
    if (selected.selected) {
      if (typeof selected.value !== 'undefined') merged.set(id, selected.value);
      continue;
    }
    conflicts.push(conflict(itemPath, 'copies_differ_without_base'));
  }

  const remoteOrder = remote.map((item) => normalizedId(item.id)).filter((id) => merged.has(id));
  const localAdditions = local
    .map((item) => normalizedId(item.id))
    .filter((id) => !remoteMap.has(id) && merged.has(id));
  return [...new Set([...remoteOrder, ...localAdditions])].map((id) => merged.get(id));
}

function mergeWithoutBaseValue(local, remote, path, conflicts, resolutions = null) {
  if (deepEqual(local, remote)) return cloneJson(local);
  if (typeof local === 'undefined') return cloneJson(remote);
  if (typeof remote === 'undefined') return cloneJson(local);

  if (isAutomaticMergePath(path) && !(isPlainObject(local) && isPlainObject(remote))) {
    return automaticMergeValue(path, undefined, local, remote);
  }

  if (isPlainObject(local) && isPlainObject(remote)) {
    const result = {};
    const keys = [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort();
    for (const key of keys) {
      const merged = mergeWithoutBaseValue(
        local[key],
        remote[key],
        path ? `${path}.${key}` : key,
        conflicts,
        resolutions
      );
      if (typeof merged !== 'undefined') result[key] = merged;
    }
    return result;
  }

  if (Array.isArray(local) && Array.isArray(remote) && isIdCollection([local, remote])) {
    return mergeIdCollectionWithoutBase(local, remote, path, conflicts, resolutions);
  }

  const selected = selectedConflictValue(path || '$', local, remote, resolutions);
  if (selected.selected) return selected.value;
  conflicts.push(conflict(path, 'copies_differ_without_base'));
  return cloneJson(local);
}

function mergeWithoutBaseSnapshots(local, remote, resolutions = null) {
  const conflicts = [];
  const workbook = mergeWithoutBaseValue(local, remote, '', conflicts, resolutions);
  if (conflicts.length) {
    return {
      ok: false,
      conflicts,
      review: describeWorkbookConflicts({ local, remote, conflicts })
    };
  }
  if (Array.isArray(workbook.transactions)) {
    workbook.transactions.sort(deterministicTransactionOrder);
  }
  return {
    ok: true,
    workbook,
    usedConservativeUnion: true,
    needsUpload: !deepEqual(workbook, remote),
    needsLocalSave: !deepEqual(workbook, local)
  };
}

/**
 * Three-way merges two independently edited workbook snapshots. Collections
 * with stable IDs merge additions and one-sided edits/deletes. The same entity
 * changed differently on both devices remains an explicit conflict so Cavalry
 * never invents a financial result.
 *
 * A missing base is supported only for legacy sync anchors. In that mode the
 * service performs a no-loss union, auto-resolves bookkeeping and device UI
 * metadata, and asks only about meaningful values that genuinely disagree.
 */
export function mergeWorkbookSnapshots({ base = null, local, remote } = {}) {
  if (!(isPlainObject(local) && isPlainObject(remote))) {
    return { ok: false, conflicts: [conflict('$', 'invalid_workbook')] };
  }
  const localId = normalizedId(local.id);
  const remoteId = normalizedId(remote.id);
  if (!localId || localId !== remoteId) {
    return { ok: false, conflicts: [conflict('id', 'workbook_identity_mismatch')] };
  }
  if (!base) return mergeWithoutBaseSnapshots(local, remote);
  if (!isPlainObject(base) || normalizedId(base.id) !== localId) {
    return { ok: false, conflicts: [conflict('id', 'merge_base_mismatch')] };
  }

  const conflicts = [];
  const workbook = mergeValue(base, local, remote, '', conflicts);
  if (conflicts.length) {
    return {
      ok: false,
      conflicts,
      review: describeWorkbookConflicts({ base, local, remote, conflicts })
    };
  }
  return {
    ok: true,
    workbook,
    usedConservativeUnion: false,
    needsUpload: !deepEqual(workbook, remote),
    needsLocalSave: !deepEqual(workbook, local)
  };
}

function normalizeReconciliationChoices(choices) {
  if (!Array.isArray(choices)) {
    return { ok: false, code: 'invalid_resolution', choices: new Map() };
  }
  const normalized = new Map();
  for (const candidate of choices) {
    const path = String((candidate && candidate.path) || '').trim();
    const side = String((candidate && candidate.side) || '').trim();
    if (!path || !['local', 'remote'].includes(side)) {
      return { ok: false, code: 'invalid_resolution', choices: new Map() };
    }
    if (normalized.has(path) && normalized.get(path) !== side) {
      return { ok: false, code: 'invalid_resolution', choices: new Map() };
    }
    normalized.set(path, side);
  }
  return { ok: true, choices: normalized };
}

function resolutionFailure(code, conflicts, review) {
  return {
    ok: false,
    code,
    conflicts,
    ...(review ? { review } : {})
  };
}

function reviewForMergeFailure(base, local, remote, mergeResult) {
  return (
    mergeResult.review ||
    describeWorkbookConflicts({
      base,
      local,
      remote,
      conflicts: mergeResult.conflicts
    })
  );
}

function choiceCoverage(review, choices) {
  if (!(review && Array.isArray(review.entries)) || review.omittedCount > 0) {
    return { ok: false, code: 'resolution_too_large' };
  }
  const expected = new Set(review.entries.map((entry) => String(entry.path || '$')));
  const missing = [...expected].filter((path) => !choices.has(path));
  if (missing.length) return { ok: false, code: 'incomplete_resolution', missing };
  const unknown = [...choices.keys()].filter((path) => !expected.has(path));
  if (unknown.length) return { ok: false, code: 'stale_resolution', unknown };
  return { ok: true, expected };
}

/**
 * Applies one explicit local-or-remote choice to every reported conflict while
 * retaining all non-conflicting edits from both branches. Choices are matched
 * by the stable report path, so stale or partial UI submissions never mutate a
 * workbook silently.
 */
export function reconcileWorkbookSnapshots({ base = null, local, remote, choices = [] } = {}) {
  const normalizedChoices = normalizeReconciliationChoices(choices);
  if (!normalizedChoices.ok) {
    return resolutionFailure(normalizedChoices.code, [conflict('$', 'invalid_resolution')]);
  }
  const initial = mergeWorkbookSnapshots({ base, local, remote });
  if (initial.ok) {
    if (normalizedChoices.choices.size) {
      return resolutionFailure('stale_resolution', [conflict('$', 'stale_resolution')]);
    }
    return { ...initial, resolvedPaths: [] };
  }
  const review = reviewForMergeFailure(base, local, remote, initial);
  const coverage = choiceCoverage(review, normalizedChoices.choices);
  if (!coverage.ok) return resolutionFailure(coverage.code, initial.conflicts, review);

  if (!base) {
    const resolutions = {
      choices: normalizedChoices.choices,
      used: new Set()
    };
    const reconciled = mergeWithoutBaseSnapshots(local, remote, resolutions);
    if (!reconciled.ok) {
      return resolutionFailure('incomplete_resolution', reconciled.conflicts, reconciled.review);
    }
    if (
      resolutions.used.size !== normalizedChoices.choices.size ||
      [...normalizedChoices.choices.keys()].some((path) => !resolutions.used.has(path))
    ) {
      return resolutionFailure('stale_resolution', initial.conflicts, review);
    }
    return { ...reconciled, resolvedPaths: [...resolutions.used] };
  }

  const resolutions = {
    choices: normalizedChoices.choices,
    used: new Set()
  };
  const conflicts = [];
  const workbook = mergeValue(base, local, remote, '', conflicts, resolutions);
  if (conflicts.length) {
    return resolutionFailure(
      'incomplete_resolution',
      conflicts,
      describeWorkbookConflicts({ base, local, remote, conflicts })
    );
  }
  if (
    resolutions.used.size !== normalizedChoices.choices.size ||
    [...normalizedChoices.choices.keys()].some((path) => !resolutions.used.has(path))
  ) {
    return resolutionFailure('stale_resolution', initial.conflicts, review);
  }
  return {
    ok: true,
    workbook,
    usedConservativeUnion: false,
    needsUpload: !deepEqual(workbook, remote),
    needsLocalSave: !deepEqual(workbook, local),
    resolvedPaths: [...resolutions.used]
  };
}
