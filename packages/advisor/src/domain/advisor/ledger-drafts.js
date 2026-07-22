import {
  normalizeDateKey as normalizeDomainDateKey,
  roundMoney
} from '@cavalry/finance-core/domain/money.js';
import {
  advisorTransactionTextKey,
  normalizeAdvisorTransactionTemplate as normalizeDomainAdvisorTransactionTemplate
} from './transaction-drafts.js';

const DEFAULT_TYPE_LABELS = {
  income: 'Income',
  expense: 'Expense',
  savings: 'Savings',
  debt: 'Debt'
};

const DEFAULT_TYPE_COLORS = {
  income: '#53d18f',
  expense: '#ef7f7f',
  savings: '#84b7ff',
  debt: '#f2b359'
};

function requireService(services, name) {
  if (typeof services[name] !== 'function') {
    throw new Error(name + ' service is not available.');
  }
  return services[name];
}

function getCategoryById(workbook, categoryId) {
  return workbook && workbook.categories
    ? workbook.categories.find((category) => category.id === categoryId) || null
    : null;
}

function getCounterpartyById(workbook, counterpartyId) {
  return workbook && workbook.counterparties
    ? workbook.counterparties.find((counterparty) => counterparty.id === counterpartyId) || null
    : null;
}

function findTransactionById(workbook, transactionId) {
  return (
    (workbook && workbook.transactions ? workbook.transactions : []).find(
      (transaction) => transaction.id === transactionId
    ) || null
  );
}

function pickAdvisorArray(source, keys) {
  for (let index = 0; index < keys.length; index += 1) {
    if (Array.isArray(source && source[keys[index]])) {
      return source[keys[index]];
    }
  }
  return [];
}

function normalizeAdvisorCleanupAction(value) {
  const action = String(value || '')
    .trim()
    .toLowerCase();
  if (action === 'deactivate' || action === 'remove' || action === 'delete') return 'archive';
  if (action === 'combine') return 'merge';
  return action;
}

function normalizeLedgerCleanupChangeList(value, allowedActions) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const source = item && typeof item === 'object' ? item : {};
      const normalizedAction = normalizeAdvisorCleanupAction(
        source.action || source.operation || source.type
      );
      const action = allowedActions.indexOf(normalizedAction) >= 0 ? normalizedAction : '';
      const normalized = Object.assign({}, source, { action });
      if (!normalized.clientId)
        normalized.clientId = String(
          source.client_id ||
            source.tempId ||
            source.temp_id ||
            source.localId ||
            source.local_id ||
            ''
        ).trim();
      if (!normalized.categoryId) normalized.categoryId = String(source.category_id || '').trim();
      if (!normalized.targetCategoryId)
        normalized.targetCategoryId = String(
          source.target_category_id || source.target_id || ''
        ).trim();
      if (!normalized.replacementCategoryId)
        normalized.replacementCategoryId = String(
          source.replacement_category_id || source.replacement_id || ''
        ).trim();
      if (!normalized.counterpartyId)
        normalized.counterpartyId = String(source.counterparty_id || '').trim();
      if (!normalized.targetCounterpartyId)
        normalized.targetCounterpartyId = String(
          source.target_counterparty_id || source.target_id || ''
        ).trim();
      if (!normalized.replacementCounterpartyId)
        normalized.replacementCounterpartyId = String(
          source.replacement_counterparty_id || source.replacement_id || ''
        ).trim();
      if (!normalized.name)
        normalized.name = String(source.label || source.newName || source.new_name || '').trim();
      return normalized;
    })
    .filter((item) => !!item.action);
}

function normalizeLedgerCleanupPatchList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const source = item && typeof item === 'object' ? item : {};
      const normalized = Object.assign({}, source, {
        transactionId: String(
          source.transactionId || source.transaction_id || source.id || ''
        ).trim()
      });
      if (!normalized.categoryId) normalized.categoryId = String(source.category_id || '').trim();
      if (!normalized.counterpartyId)
        normalized.counterpartyId = String(source.counterparty_id || '').trim();
      if (!normalized.counterpartyName)
        normalized.counterpartyName = String(
          source.counterparty_name || source.payee || source.merchant || ''
        ).trim();
      if (!normalized.counterpartyKind)
        normalized.counterpartyKind = String(source.counterparty_kind || '').trim();
      if (
        !normalized.primaryAccountId &&
        (Object.prototype.hasOwnProperty.call(source, 'primary_account_id') ||
          Object.prototype.hasOwnProperty.call(source, 'account_id'))
      ) {
        normalized.primaryAccountId = String(
          source.primary_account_id || source.account_id || ''
        ).trim();
      }
      if (
        !normalized.secondaryAccountId &&
        Object.prototype.hasOwnProperty.call(source, 'secondary_account_id')
      ) {
        normalized.secondaryAccountId = String(source.secondary_account_id || '').trim();
      }
      return normalized;
    })
    .filter((patch) => !!patch.transactionId);
}

export function normalizeLedgerCleanupPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    mode: 'ledger_cleanup_v1',
    summary: String(source.summary || source.reason || source.description || '').trim(),
    categoryChanges: normalizeLedgerCleanupChangeList(
      pickAdvisorArray(source, ['categoryChanges', 'category_changes', 'categories']),
      ['create', 'rename', 'merge', 'archive']
    ),
    counterpartyChanges: normalizeLedgerCleanupChangeList(
      pickAdvisorArray(source, [
        'counterpartyChanges',
        'counterparty_changes',
        'counterparties',
        'merchantChanges',
        'merchant_changes'
      ]),
      ['create', 'rename', 'merge', 'archive']
    ),
    transactionPatches: normalizeLedgerCleanupPatchList(
      pickAdvisorArray(source, [
        'transactionPatches',
        'transaction_patches',
        'patches',
        'transactions'
      ])
    ),
    skippedSuggestions: pickAdvisorArray(source, [
      'skippedSuggestions',
      'skipped_suggestions',
      'skipped'
    ])
      .map((item) => ({
        reason: String((item && item.reason) || '').trim(),
        sourceRef: String((item && item.sourceRef) || (item && item.source_ref) || '').trim()
      }))
      .filter((item) => item.reason)
  };
}

function cleanupHasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function normalizeCleanupVisibleText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanupVisibleTextEqual(left, right) {
  return normalizeCleanupVisibleText(left) === normalizeCleanupVisibleText(right);
}

function cleanupEscapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCleanupNumericOnlyLabel(value) {
  const cleaned = normalizeCleanupVisibleText(value).replace(/[\u20b1$\u20ac\u00a3\u00a5,\s]/g, '');
  return /^\d+(?:\.\d+)?$/.test(cleaned);
}

function cleanupTransactionEvidenceText(workbook, transaction) {
  const counterparty =
    transaction && transaction.counterpartyId
      ? getCounterpartyById(workbook, transaction.counterpartyId)
      : null;
  return normalizeCleanupVisibleText(
    [
      transaction && transaction.description,
      transaction && transaction.note,
      counterparty && counterparty.name
    ]
      .filter(Boolean)
      .join(' ')
  ).toLowerCase();
}

function cleanupEvidenceMentionsLabel(workbook, transaction, label) {
  const needle = normalizeCleanupVisibleText(label).toLowerCase();
  const haystack = cleanupTransactionEvidenceText(workbook, transaction);
  if (!(needle && haystack)) {
    return false;
  }
  const pattern = isCleanupNumericOnlyLabel(needle)
    ? new RegExp('(^|[^0-9])' + cleanupEscapeRegex(needle) + '([^0-9]|$)')
    : new RegExp('(^|[^a-z0-9])' + cleanupEscapeRegex(needle) + '([^a-z0-9]|$)', 'i');
  return pattern.test(haystack);
}

function getCreatedCounterpartyName(proposed, counterpartyId) {
  const created =
    (proposed && proposed.counterpartyChanges ? proposed.counterpartyChanges : []).find(
      (change) => change.action === 'create' && getLedgerCleanupCreateRef(change) === counterpartyId
    ) || null;
  return created && created.name ? normalizeCleanupVisibleText(created.name) : '';
}

function getCleanupPatchCounterpartyTargetName(workbook, proposed, patch) {
  const directName = normalizeCleanupVisibleText(patch && patch.counterpartyName);
  if (directName) {
    return directName;
  }
  const counterpartyId = String((patch && patch.counterpartyId) || '').trim();
  if (counterpartyId) {
    const createdName = getCreatedCounterpartyName(proposed, counterpartyId);
    if (createdName) {
      return createdName;
    }
    const counterparty = getCounterpartyById(workbook, counterpartyId);
    return counterparty
      ? normalizeCleanupVisibleText(counterparty.name)
      : normalizeCleanupVisibleText(counterpartyId);
  }
  return '';
}

function isSuspiciousCleanupCounterpartyPatch(workbook, proposed, patch, transaction) {
  const targetName = getCleanupPatchCounterpartyTargetName(workbook, proposed, patch);
  return !!(
    targetName &&
    isCleanupNumericOnlyLabel(targetName) &&
    !cleanupEvidenceMentionsLabel(workbook, transaction, targetName)
  );
}

function getTypeLabels(services) {
  return services.typeLabels || DEFAULT_TYPE_LABELS;
}

function isMeaningfulLedgerCleanupCategoryChange(workbook, proposed, change, services) {
  const currentId = String(change.categoryId || change.targetCategoryId || '');
  const category = getCategoryById(workbook, currentId);
  const typeLabels = getTypeLabels(services);
  if (change.action === 'create') {
    return !!normalizeCleanupVisibleText(change.name);
  }
  if (change.action === 'rename') {
    if (!category) return true;
    const nextName = normalizeCleanupVisibleText(change.name);
    const nextType = String(change.type || '')
      .trim()
      .toLowerCase();
    return (
      !!nextName &&
      (!cleanupVisibleTextEqual(category.name, nextName) ||
        (typeLabels[nextType] && nextType !== category.type))
    );
  }
  if (change.action === 'merge') {
    const replacementId = String(change.replacementCategoryId || change.targetCategoryId || '');
    return !!currentId && !!replacementId && currentId !== replacementId;
  }
  if (change.action === 'archive') {
    return !category || category.isActive !== false;
  }
  return false;
}

function isMeaningfulLedgerCleanupCounterpartyChange(workbook, proposed, change) {
  const currentId = String(change.counterpartyId || change.targetCounterpartyId || '');
  const counterparty = getCounterpartyById(workbook, currentId);
  if (change.action === 'create') {
    return !!normalizeCleanupVisibleText(change.name);
  }
  if (change.action === 'rename') {
    if (!counterparty) return true;
    const nextName = normalizeCleanupVisibleText(change.name);
    const nextKind = String(change.kind || '')
      .trim()
      .toLowerCase();
    return (
      !!nextName &&
      (!cleanupVisibleTextEqual(counterparty.name, nextName) ||
        (nextKind && nextKind !== String(counterparty.kind || 'other')))
    );
  }
  if (change.action === 'merge') {
    const replacementId = String(
      change.replacementCounterpartyId || change.targetCounterpartyId || ''
    );
    return !!currentId && !!replacementId && currentId !== replacementId;
  }
  if (change.action === 'archive') {
    return !counterparty || counterparty.isActive !== false;
  }
  return false;
}

function isMeaningfulLedgerCleanupTransactionPatch(workbook, proposed, patch, services) {
  const transaction = findTransactionById(workbook, patch && patch.transactionId);
  if (!transaction) {
    return true;
  }
  const getTransactionEditDraft = services.getTransactionEditDraft;
  const draft =
    typeof getTransactionEditDraft === 'function'
      ? getTransactionEditDraft(workbook, transaction)
      : null;
  const currentCounterparty = transaction.counterpartyId
    ? getCounterpartyById(workbook, transaction.counterpartyId)
    : null;
  const normalizeAdvisorTransactionTemplate =
    services.normalizeAdvisorTransactionTemplate || normalizeDomainAdvisorTransactionTemplate;
  const normalizeDateKey = services.normalizeDateKey || normalizeDomainDateKey;
  if (
    cleanupHasOwn(patch, 'categoryId') &&
    String(patch.categoryId || '').trim() &&
    String(patch.categoryId || '') !== String(transaction.categoryId || '')
  )
    return true;
  if (
    cleanupHasOwn(patch, 'counterpartyId') &&
    String(patch.counterpartyId || '').trim() &&
    String(patch.counterpartyId || '') !== String(transaction.counterpartyId || '')
  ) {
    return !isSuspiciousCleanupCounterpartyPatch(workbook, proposed, patch, transaction);
  }
  if (
    cleanupHasOwn(patch, 'counterpartyName') &&
    normalizeCleanupVisibleText(patch.counterpartyName) &&
    !cleanupVisibleTextEqual(
      patch.counterpartyName,
      currentCounterparty ? currentCounterparty.name : ''
    )
  ) {
    return !isSuspiciousCleanupCounterpartyPatch(workbook, proposed, patch, transaction);
  }
  if (
    cleanupHasOwn(patch, 'description') &&
    normalizeCleanupVisibleText(patch.description) &&
    !cleanupVisibleTextEqual(patch.description, transaction.description || '')
  )
    return true;
  if (cleanupHasOwn(patch, 'note') && !cleanupVisibleTextEqual(patch.note, transaction.note || ''))
    return true;
  if (
    cleanupHasOwn(patch, 'template') &&
    normalizeAdvisorTransactionTemplate(patch.template) &&
    normalizeAdvisorTransactionTemplate(patch.template) !== String(transaction.template || '')
  )
    return true;
  if (
    cleanupHasOwn(patch, 'date') &&
    normalizeDateKey(patch.date) &&
    normalizeDateKey(patch.date) !== String(transaction.date || '')
  )
    return true;
  if (
    cleanupHasOwn(patch, 'amount') &&
    Number(patch.amount || 0) > 0 &&
    roundMoney(Number(patch.amount || 0)) !== roundMoney(Number(transaction.amount || 0))
  )
    return true;
  if (
    cleanupHasOwn(patch, 'currency') &&
    String(patch.currency || '')
      .trim()
      .toUpperCase() &&
    String(patch.currency || '')
      .trim()
      .toUpperCase() !==
      String(transaction.originalCurrency || workbook.currency || '').toUpperCase()
  )
    return true;
  if (draft && !draft.isManualOnly) {
    if (
      cleanupHasOwn(patch, 'primaryAccountId') &&
      String(patch.primaryAccountId || '').trim() &&
      String(patch.primaryAccountId || '') !== String(draft.primaryAccountId || '')
    )
      return true;
    if (
      cleanupHasOwn(patch, 'secondaryAccountId') &&
      String(patch.secondaryAccountId || '').trim() &&
      String(patch.secondaryAccountId || '') !== String(draft.secondaryAccountId || '')
    )
      return true;
  }
  return false;
}

export function getMeaningfulLedgerCleanupPayload(workbook, payload, services = {}) {
  const proposed = normalizeLedgerCleanupPayload(payload);
  return Object.assign({}, proposed, {
    categoryChanges: proposed.categoryChanges.filter((change) =>
      isMeaningfulLedgerCleanupCategoryChange(workbook, proposed, change, services)
    ),
    counterpartyChanges: proposed.counterpartyChanges.filter((change) =>
      isMeaningfulLedgerCleanupCounterpartyChange(workbook, proposed, change)
    ),
    transactionPatches: proposed.transactionPatches.filter((patch) =>
      isMeaningfulLedgerCleanupTransactionPatch(workbook, proposed, patch, services)
    )
  });
}

function categoryHasReferences(workbook, categoryId) {
  return (
    (workbook.transactions || []).some((item) => item.categoryId === categoryId) ||
    (workbook.recurringItems || []).some((item) => item.categoryId === categoryId) ||
    (workbook.sheets || []).some(
      (sheet) =>
        (sheet.budgets || []).some((budget) => budget.categoryId === categoryId) ||
        (sheet.budgetLineItems || []).some((item) => item.categoryId === categoryId)
    )
  );
}

function moveCategoryReferences(workbook, fromId, toId) {
  (workbook.transactions || []).forEach((transaction) => {
    if (transaction.categoryId === fromId) transaction.categoryId = toId;
  });
  (workbook.recurringItems || []).forEach((item) => {
    if (item.categoryId === fromId) item.categoryId = toId;
  });
  (workbook.sheets || []).forEach((sheet) => {
    (sheet.budgets || []).forEach((budget) => {
      if (budget.categoryId === fromId) budget.categoryId = toId;
    });
    (sheet.budgetLineItems || []).forEach((item) => {
      if (item.categoryId === fromId) item.categoryId = toId;
    });
  });
}

function moveCounterpartyReferences(workbook, fromId, toId) {
  (workbook.transactions || []).forEach((transaction) => {
    if (transaction.counterpartyId === fromId) transaction.counterpartyId = toId;
  });
  (workbook.recurringItems || []).forEach((item) => {
    if (item.counterpartyId === fromId) item.counterpartyId = toId;
  });
}

export function getLedgerCleanupCreateRef(change) {
  return String(
    (change &&
      (change.clientId ||
        change.client_id ||
        change.id ||
        change.tempId ||
        change.temp_id ||
        change.localId ||
        change.local_id)) ||
      ''
  ).trim();
}

function getUniqueCleanupId(workbook, collectionKey, prefix, preferredId) {
  const raw = String(preferredId || '').trim();
  if (!raw) return '';
  let candidate = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  if (!candidate) return '';
  if (!/^[a-z]/.test(candidate)) candidate = String(prefix || 'id') + '_' + candidate;
  const used = new Set(
    (workbook && workbook[collectionKey] ? workbook[collectionKey] : []).map((item) =>
      String((item && item.id) || '')
    )
  );
  if (!used.has(candidate)) return candidate;
  let suffix = 2;
  while (used.has(candidate + '_' + suffix)) {
    suffix += 1;
  }
  return candidate + '_' + suffix;
}

function resolveLedgerCleanupReference(value, referenceMap) {
  const key = String(value || '').trim();
  return key && referenceMap[key] ? referenceMap[key] : key;
}

function rewriteLedgerCleanupCreatedReferences(proposed, categoryMap, counterpartyMap) {
  (proposed.categoryChanges || []).forEach((change) => {
    if (change.action !== 'create' && change.categoryId)
      change.categoryId = resolveLedgerCleanupReference(change.categoryId, categoryMap);
    if (change.action === 'merge' || change.action === 'archive') {
      if (change.targetCategoryId)
        change.targetCategoryId = resolveLedgerCleanupReference(
          change.targetCategoryId,
          categoryMap
        );
      if (change.replacementCategoryId)
        change.replacementCategoryId = resolveLedgerCleanupReference(
          change.replacementCategoryId,
          categoryMap
        );
    }
  });
  (proposed.counterpartyChanges || []).forEach((change) => {
    if (change.action !== 'create' && change.counterpartyId)
      change.counterpartyId = resolveLedgerCleanupReference(change.counterpartyId, counterpartyMap);
    if (change.action === 'merge' || change.action === 'archive') {
      if (change.targetCounterpartyId)
        change.targetCounterpartyId = resolveLedgerCleanupReference(
          change.targetCounterpartyId,
          counterpartyMap
        );
      if (change.replacementCounterpartyId)
        change.replacementCounterpartyId = resolveLedgerCleanupReference(
          change.replacementCounterpartyId,
          counterpartyMap
        );
    }
  });
  (proposed.transactionPatches || []).forEach((patch) => {
    if (patch.categoryId)
      patch.categoryId = resolveLedgerCleanupReference(patch.categoryId, categoryMap);
    if (patch.counterpartyId)
      patch.counterpartyId = resolveLedgerCleanupReference(patch.counterpartyId, counterpartyMap);
  });
}

export function ledgerCleanupPatchNeedsRebuild(patch) {
  return (
    Object.prototype.hasOwnProperty.call(patch, 'template') ||
    Object.prototype.hasOwnProperty.call(patch, 'date') ||
    Object.prototype.hasOwnProperty.call(patch, 'amount') ||
    Object.prototype.hasOwnProperty.call(patch, 'currency') ||
    Object.prototype.hasOwnProperty.call(patch, 'primaryAccountId') ||
    Object.prototype.hasOwnProperty.call(patch, 'secondaryAccountId') ||
    Object.prototype.hasOwnProperty.call(patch, 'fxRateToBase') ||
    Object.prototype.hasOwnProperty.call(patch, 'usdExpenseRate')
  );
}

export function ledgerCleanupPatchHasMetadataEdit(patch) {
  return (
    Object.prototype.hasOwnProperty.call(patch, 'description') ||
    Object.prototype.hasOwnProperty.call(patch, 'note') ||
    Object.prototype.hasOwnProperty.call(patch, 'categoryId') ||
    Object.prototype.hasOwnProperty.call(patch, 'counterpartyId') ||
    Object.prototype.hasOwnProperty.call(patch, 'counterpartyName') ||
    Object.prototype.hasOwnProperty.call(patch, 'counterpartyKind')
  );
}

function ensureCleanupCategory(workbook, name, type, preferredId, services) {
  const categoryName = String(name || '').trim();
  if (!categoryName) throw new Error('Category name is required.');
  const typeLabels = getTypeLabels(services);
  const typeColors = services.typeColors || DEFAULT_TYPE_COLORS;
  const categoryType = typeLabels[String(type || '').toLowerCase()]
    ? String(type).toLowerCase()
    : 'expense';
  const existing =
    (workbook.categories || []).find(
      (category) =>
        advisorTransactionTextKey(category.name) === advisorTransactionTextKey(categoryName) &&
        category.type === categoryType
    ) || null;
  const ensureCategoryPlannerBucket = requireService(services, 'ensureCategoryPlannerBucket');
  if (existing) {
    existing.isActive = true;
    ensureCategoryPlannerBucket(workbook, existing);
    return existing;
  }
  const normalizeCategory = requireService(services, 'normalizeCategory');
  const normalizeAccount = requireService(services, 'normalizeAccount');
  const isAccountNameTaken = requireService(services, 'isAccountNameTaken');
  const categoryId = getUniqueCleanupId(workbook, 'categories', 'cat', preferredId);
  let accountName = categoryName;
  let suffix = 2;
  const accountGroup = categoryType === 'income' ? 'income' : 'expense';
  while (isAccountNameTaken(workbook, accountName, accountGroup, workbook.currency)) {
    accountName = categoryName + ' ' + suffix;
    suffix += 1;
  }
  const category = normalizeCategory(
    {
      id: categoryId || undefined,
      name: categoryName,
      type: categoryType,
      color: typeColors[categoryType],
      currency: workbook.currency,
      isActive: true
    },
    (workbook.categories || []).length,
    workbook.currency
  );
  const account = normalizeAccount(
    {
      name: accountName,
      group: accountGroup,
      subtype: categoryType,
      currency: workbook.currency,
      note: 'Linked posting account for ' + categoryName
    },
    (workbook.accounts || []).length,
    workbook.currency
  );
  category.linkedAccountId = account.id;
  ensureCategoryPlannerBucket(workbook, category);
  workbook.categories.push(category);
  workbook.accounts.push(account);
  return category;
}

function ensureCleanupCounterparty(workbook, input, preferredId, services) {
  const name = String(input && input.name ? input.name : '').trim();
  const kind = String(input && input.kind ? input.kind : 'other').toLowerCase();
  const note = String(input && input.note ? input.note : '').trim();
  if (!name) {
    return null;
  }
  let existing =
    (workbook.counterparties || []).find(
      (counterparty) => counterparty.name.trim().toLowerCase() === name.toLowerCase()
    ) || null;
  if (existing) {
    existing.isActive = true;
    if (kind) {
      existing.kind = kind;
    }
    if (note) {
      existing.note = note;
    }
    return existing;
  }
  const normalizeCounterparty = requireService(services, 'normalizeCounterparty');
  existing = normalizeCounterparty(
    {
      id: getUniqueCleanupId(workbook, 'counterparties', 'counterparty', preferredId) || undefined,
      name,
      kind: kind || 'other',
      note,
      isActive: true
    },
    (workbook.counterparties || []).length
  );
  workbook.counterparties.push(existing);
  return existing;
}

export function validateLedgerCleanupDraft(workbook, draft, services = {}) {
  const proposed = getMeaningfulLedgerCleanupPayload(workbook, draft && draft.proposed, services);
  if (!(
    proposed.categoryChanges.length ||
    proposed.counterpartyChanges.length ||
    proposed.transactionPatches.length
  )) {
    throw new Error('Ledger cleanup draft has no proposed changes.');
  }
  const simulatedWorkbook = JSON.parse(JSON.stringify(workbook || {}));
  const categoryMap = {};
  const counterpartyMap = {};
  proposed.categoryChanges.forEach((change) => {
    if (change.action === 'create') {
      if (!String(change.name || '').trim()) throw new Error('Category create needs a name.');
      const category = ensureCleanupCategory(
        simulatedWorkbook,
        change.name,
        change.type,
        getLedgerCleanupCreateRef(change),
        services
      );
      const createRef = getLedgerCleanupCreateRef(change);
      if (createRef) categoryMap[createRef] = category.id;
    }
  });
  proposed.counterpartyChanges.forEach((change) => {
    if (change.action === 'create') {
      if (!String(change.name || '').trim()) throw new Error('Counterparty create needs a name.');
      const counterparty = ensureCleanupCounterparty(
        simulatedWorkbook,
        {
          name: change.name,
          kind: change.kind || 'merchant',
          note: change.note || ''
        },
        getLedgerCleanupCreateRef(change),
        services
      );
      const createRef = getLedgerCleanupCreateRef(change);
      if (createRef && counterparty) counterpartyMap[createRef] = counterparty.id;
    }
  });
  rewriteLedgerCleanupCreatedReferences(proposed, categoryMap, counterpartyMap);
  proposed.categoryChanges.forEach((change) => {
    const categoryId = String(change.categoryId || change.targetCategoryId || '');
    if (change.action === 'create') {
      if (!String(change.name || '').trim()) throw new Error('Category create needs a name.');
      return;
    }
    const category = getCategoryById(simulatedWorkbook, categoryId);
    if (!category) throw new Error('Category not found: ' + categoryId);
    if (
      (change.action === 'rename' || change.action === 'merge') &&
      !String(change.name || change.replacementCategoryId || change.targetCategoryId || '').trim()
    ) {
      throw new Error('Category change needs a target or name.');
    }
    if (
      (change.action === 'merge' ||
        (change.action === 'archive' && categoryHasReferences(simulatedWorkbook, categoryId))) &&
      !getCategoryById(
        simulatedWorkbook,
        String(change.replacementCategoryId || change.targetCategoryId || '')
      )
    ) {
      throw new Error('Category archive/merge needs a valid replacement category.');
    }
  });
  proposed.counterpartyChanges.forEach((change) => {
    const counterpartyId = String(change.counterpartyId || change.targetCounterpartyId || '');
    if (change.action === 'create') {
      if (!String(change.name || '').trim()) throw new Error('Counterparty create needs a name.');
      return;
    }
    if (!getCounterpartyById(simulatedWorkbook, counterpartyId))
      throw new Error('Counterparty not found: ' + counterpartyId);
    if (
      (change.action === 'merge' || change.action === 'archive') &&
      String(change.replacementCounterpartyId || change.targetCounterpartyId || '') &&
      !getCounterpartyById(
        simulatedWorkbook,
        String(change.replacementCounterpartyId || change.targetCounterpartyId || '')
      )
    ) {
      throw new Error('Counterparty replacement not found.');
    }
  });
  proposed.transactionPatches.forEach((patch) => {
    const transaction = findTransactionById(simulatedWorkbook, patch.transactionId);
    if (!transaction) throw new Error('Transaction not found: ' + patch.transactionId);
    const getLedgerCleanupTransactionFields = requireService(
      services,
      'getLedgerCleanupTransactionFields'
    );
    const buildLedgerTransactionFromDraftFields = requireService(
      services,
      'buildLedgerTransactionFromDraftFields'
    );
    const fields = getLedgerCleanupTransactionFields(simulatedWorkbook, transaction, patch);
    if (!fields) {
      if (
        typeof patch.categoryId !== 'undefined' &&
        patch.categoryId &&
        !getCategoryById(simulatedWorkbook, patch.categoryId)
      )
        throw new Error('Category not found: ' + patch.categoryId);
      if (
        typeof patch.counterpartyId !== 'undefined' &&
        patch.counterpartyId &&
        !getCounterpartyById(simulatedWorkbook, patch.counterpartyId)
      )
        throw new Error('Counterparty not found: ' + patch.counterpartyId);
      if (ledgerCleanupPatchNeedsRebuild(patch)) {
        throw new Error('Transaction cannot be rebuilt safely: ' + patch.transactionId);
      }
      if (ledgerCleanupPatchHasMetadataEdit(patch)) {
        return;
      }
      throw new Error('Transaction cannot be rebuilt safely: ' + patch.transactionId);
    }
    buildLedgerTransactionFromDraftFields(
      simulatedWorkbook,
      fields,
      transaction,
      (simulatedWorkbook.transactions || []).indexOf(transaction),
      {}
    );
  });
  return proposed;
}

export function applyLedgerCleanupAiDraftMutation(workbook, draft, services = {}) {
  const proposed = validateLedgerCleanupDraft(workbook, draft, services);
  proposed.categoryChanges.forEach((change) => {
    if (change.action === 'create') {
      ensureCleanupCategory(
        workbook,
        change.name,
        change.type,
        getLedgerCleanupCreateRef(change),
        services
      );
    }
  });
  proposed.counterpartyChanges.forEach((change) => {
    if (change.action === 'create') {
      ensureCleanupCounterparty(
        workbook,
        {
          name: change.name,
          kind: change.kind || 'merchant',
          note: change.note || ''
        },
        getLedgerCleanupCreateRef(change),
        services
      );
    }
  });
  proposed.categoryChanges.forEach((change) => {
    if (change.action === 'rename') {
      const category = getCategoryById(
        workbook,
        String(change.categoryId || change.targetCategoryId || '')
      );
      if (category && change.name) category.name = String(change.name).trim();
      if (category && getTypeLabels(services)[String(change.type || '').toLowerCase()])
        category.type = String(change.type).toLowerCase();
    } else if (change.action === 'merge' || change.action === 'archive') {
      const categoryId = String(change.categoryId || change.targetCategoryId || '');
      const replacementId = String(change.replacementCategoryId || change.targetCategoryId || '');
      const category = getCategoryById(workbook, categoryId);
      if (replacementId && replacementId !== categoryId)
        moveCategoryReferences(workbook, categoryId, replacementId);
      if (category) category.isActive = false;
    }
  });
  proposed.counterpartyChanges.forEach((change) => {
    const counterpartyId = String(change.counterpartyId || change.targetCounterpartyId || '');
    if (change.action === 'rename') {
      const counterparty = getCounterpartyById(workbook, counterpartyId);
      if (counterparty && change.name) counterparty.name = String(change.name).trim();
      if (counterparty && change.kind) counterparty.kind = String(change.kind).toLowerCase();
    } else if (change.action === 'merge' || change.action === 'archive') {
      const replacementId = String(
        change.replacementCounterpartyId || change.targetCounterpartyId || ''
      );
      const counterparty = getCounterpartyById(workbook, counterpartyId);
      if (replacementId && replacementId !== counterpartyId)
        moveCounterpartyReferences(workbook, counterpartyId, replacementId);
      if (counterparty) counterparty.isActive = false;
    }
  });
  proposed.transactionPatches.forEach((patch) => {
    const index = (workbook.transactions || []).findIndex(
      (transaction) => transaction.id === patch.transactionId
    );
    const transaction = index >= 0 ? workbook.transactions[index] : null;
    if (!transaction) return;
    const getLedgerCleanupTransactionFields = requireService(
      services,
      'getLedgerCleanupTransactionFields'
    );
    const buildLedgerTransactionFromDraftFields = requireService(
      services,
      'buildLedgerTransactionFromDraftFields'
    );
    const fields = getLedgerCleanupTransactionFields(workbook, transaction, patch);
    if (fields) {
      workbook.transactions[index] = buildLedgerTransactionFromDraftFields(
        workbook,
        fields,
        transaction,
        index,
        {}
      );
      if (typeof services.refreshGeneratedDailyInterestAfterTransaction === 'function') {
        services.refreshGeneratedDailyInterestAfterTransaction(workbook, transaction);
        services.refreshGeneratedDailyInterestAfterTransaction(
          workbook,
          workbook.transactions[index]
        );
      }
    } else {
      if (typeof patch.description !== 'undefined')
        transaction.description = String(patch.description || '').trim() || transaction.description;
      if (typeof patch.note !== 'undefined') transaction.note = String(patch.note || '');
      if (typeof patch.categoryId !== 'undefined' && getCategoryById(workbook, patch.categoryId))
        transaction.categoryId = String(patch.categoryId);
      if (
        typeof patch.counterpartyId !== 'undefined' &&
        getCounterpartyById(workbook, patch.counterpartyId)
      )
        transaction.counterpartyId = String(patch.counterpartyId);
      if (typeof patch.counterpartyName !== 'undefined') {
        const ensureCounterparty = requireService(services, 'ensureCounterparty');
        const counterparty = ensureCounterparty(workbook, {
          name: patch.counterpartyName,
          kind: patch.counterpartyKind || 'merchant'
        });
        if (counterparty) transaction.counterpartyId = counterparty.id;
      }
    }
  });
  if (typeof services.validateWorkbookHealth === 'function') {
    const health = services.validateWorkbookHealth(workbook);
    if (health.errors.length) {
      throw new Error(
        'Ledger cleanup left workbook health errors: ' +
          health.errors.map((item) => item.message).join('; ')
      );
    }
  }
  return (
    String(proposed.transactionPatches.length) +
    ' transaction patch' +
    (proposed.transactionPatches.length === 1 ? '' : 'es')
  );
}

export function normalizeLedgerReviewPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const period = source.period && typeof source.period === 'object' ? source.period : {};
  const counts = source.counts && typeof source.counts === 'object' ? source.counts : {};
  const groups = (Array.isArray(source.groups) ? source.groups : [])
    .map((group, groupIndex) => {
      const rawGroup = group && typeof group === 'object' ? group : {};
      const items = (Array.isArray(rawGroup.items) ? rawGroup.items : [])
        .map((item) => {
          const rawItem = item && typeof item === 'object' ? item : {};
          const transactionId = String(
            rawItem.transactionId || rawItem.transaction_id || ''
          ).trim();
          const sourceRef = String(
            rawItem.sourceRef ||
              rawItem.source_ref ||
              (transactionId ? 'transaction:' + transactionId : '')
          ).trim();
          return {
            transactionId,
            date: String(rawItem.date || '').trim(),
            description: String(rawItem.description || 'Transaction').trim(),
            amount: Number(rawItem.amount || 0) || 0,
            amountDisplay: String(rawItem.amountDisplay || rawItem.amount_display || '').trim(),
            currency: String(rawItem.currency || '').trim(),
            account: String(rawItem.account || '').trim(),
            currentCategory: String(
              rawItem.currentCategory || rawItem.current_category || 'Missing category'
            ).trim(),
            reason: String(rawItem.reason || '').trim(),
            sourceRef
          };
        })
        .filter((item) => item.transactionId);
      return {
        id: String(rawGroup.id || 'review_group_' + groupIndex).trim(),
        title: String(rawGroup.title || 'Transactions to Review').trim(),
        reason: String(rawGroup.reason || '').trim(),
        sourceRefs: (Array.isArray(rawGroup.sourceRefs)
          ? rawGroup.sourceRefs
          : Array.isArray(rawGroup.source_refs)
            ? rawGroup.source_refs
            : []
        )
          .map((ref) => String(ref || '').trim())
          .filter(Boolean),
        items
      };
    })
    .filter((group) => group.items.length);
  const reviewItemCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  return {
    mode: 'ledger_review_v1',
    summary: String(source.summary || '').trim(),
    period: {
      start: String(period.start || '').trim(),
      end: String(period.end || '').trim(),
      label: String(period.label || '').trim()
    },
    counts: {
      transactionsReviewed:
        Number(counts.transactionsReviewed || counts.transactions_reviewed || 0) || 0,
      reviewItemCount:
        Number(counts.reviewItemCount || counts.review_item_count || reviewItemCount) ||
        reviewItemCount,
      vagueOrMissingTransactions:
        Number(counts.vagueOrMissingTransactions || counts.vague_or_missing_transactions || 0) || 0,
      duplicateCategoryGroups:
        Number(counts.duplicateCategoryGroups || counts.duplicate_category_groups || 0) || 0,
      duplicateCounterpartyGroups:
        Number(counts.duplicateCounterpartyGroups || counts.duplicate_counterparty_groups || 0) ||
        0,
      safeCandidateChanges:
        Number(counts.safeCandidateChanges || counts.safe_candidate_changes || 0) || 0
    },
    groups,
    sourceRefs: groups.reduce((refs, group) => {
      group.items.forEach((item) => {
        if (item.sourceRef && refs.indexOf(item.sourceRef) < 0) {
          refs.push(item.sourceRef);
        }
      });
      group.sourceRefs.forEach((ref) => {
        if (ref && refs.indexOf(ref) < 0) {
          refs.push(ref);
        }
      });
      return refs;
    }, [])
  };
}

export function validateLedgerReviewDraft(workbook, draft) {
  const review = normalizeLedgerReviewPayload(draft && draft.proposed);
  const items = review.groups.reduce((list, group) => list.concat(group.items), []);
  if (!items.length) {
    throw new Error('Ledger review draft has no transactions to review.');
  }
  items.forEach((item) => {
    if (!findTransactionById(workbook, item.transactionId)) {
      throw new Error('Transaction not found: ' + item.transactionId);
    }
  });
  return review;
}
