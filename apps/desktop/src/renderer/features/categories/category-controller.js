import {
  buildCategoryRouteViewModel,
  createCategoryWithLinkedAccount,
  deleteCategory,
  getCategoryUsageSummary,
  getTransactionContributions,
  renameCategory,
  replaceCategoryLinkedAccount,
  roundMoney,
  setCategoryActive,
  updateCategoryLinkedAccount
} from '@cavalry/finance-core';
import {
  cloneWorkbook,
  commandError,
  commandOk
} from '@cavalry/finance-core/application/types/command-result.js';
import { isSupportedCategoryIcon, matchCategoryIcon } from './category-options.js';

export const CATEGORY_ACTIONS = Object.freeze({
  CREATE: 'category/create',
  UPDATE: 'category/update',
  RENAME: 'category/rename',
  HIDE: 'category/hide',
  RESTORE: 'category/restore',
  DELETE: 'category/delete',
  LINK: 'category/link',
  REPLACE_LINK: 'category/replace-linked-account'
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function getCategory(workbook, categoryId) {
  return asArray(workbook?.categories).find((category) => category?.id === categoryId) || null;
}

function errorResult(workbook, error, fallbackCode = 'category.command_failed') {
  return commandError(workbook, {
    code: asText(error?.code) || fallbackCode,
    message: asText(error?.message) || 'The category change could not be completed.',
    ...(asText(error?.field) ? { field: asText(error.field) } : {}),
    ...(error?.details ? { details: error.details } : {})
  });
}

function makeUniqueId(workbook, collectionName, prefix, createId) {
  const existing = new Set(asArray(workbook?.[collectionName]).map((item) => item?.id));
  if (typeof createId === 'function') {
    let candidate = createId(prefix);
    while (existing.has(candidate)) candidate = createId(prefix);
    return candidate;
  }
  let index = existing.size + 1;
  let candidate = `${prefix}_${index}`;
  while (existing.has(candidate)) candidate = `${prefix}_${++index}`;
  return candidate;
}

function deterministicServices(workbook, services = {}) {
  const customCategoryNormalizer = services.normalizeCategory;
  const customAccountNormalizer = services.normalizeAccount;
  return {
    ...services,
    normalizeCategory:
      typeof customCategoryNormalizer === 'function'
        ? customCategoryNormalizer
        : (input, _index, baseCurrency) => ({
            id: makeUniqueId(workbook, 'categories', 'category', services.createId),
            name: asText(input?.name),
            type: asText(input?.type) || 'expense',
            color: asText(input?.color),
            icon: asText(input?.icon),
            description: asText(input?.description),
            autoCategorizeRules: asArray(input?.autoCategorizeRules),
            currency: asText(input?.currency || baseCurrency).toUpperCase() || 'PHP',
            isActive: input?.isActive !== false,
            plannerBucketId: asText(input?.plannerBucketId)
          }),
    normalizeAccount:
      typeof customAccountNormalizer === 'function'
        ? customAccountNormalizer
        : (input, _index, baseCurrency) => ({
            id: makeUniqueId(workbook, 'accounts', 'account', services.createId),
            name: asText(input?.name),
            group: asText(input?.group).toLowerCase() || 'expense',
            subtype: asText(input?.subtype),
            currency: asText(input?.currency || baseCurrency).toUpperCase() || 'PHP',
            note: asText(input?.note),
            isSystem: false,
            isActive: input?.isActive !== false
          })
  };
}

function changedOrError(originalWorkbook, nextWorkbook, operation, event, warnings = []) {
  if (!operation?.changed) {
    return errorResult(originalWorkbook, {
      code: 'category.not_changed',
      message: 'The category was not found or could not be changed.'
    });
  }
  return commandOk(nextWorkbook, { events: [event], warnings });
}

function applyCategoryCustomization(category, payload, { allowType = false } = {}) {
  if (!category) return;
  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  if (has('color')) category.color = asText(payload.color);
  if (has('icon')) category.icon = asText(payload.icon);
  if (has('description')) category.description = asText(payload.description).slice(0, 80);
  if (has('plannerBucketId')) category.plannerBucketId = asText(payload.plannerBucketId);
  if (allowType && ['income', 'expense', 'savings', 'debt'].includes(asText(payload.type))) {
    category.type = asText(payload.type);
  }
  if (has('autoCategorizeRules')) {
    category.autoCategorizeRules = asArray(payload.autoCategorizeRules)
      .map((rule) => ({
        field: asText(rule?.field) || 'description',
        operator: asText(rule?.operator) || 'contains',
        value: asText(rule?.value)
      }))
      .filter((rule) => rule.value);
  }
}

function categoryCustomizationSnapshot(category) {
  return JSON.stringify({
    icon: asText(category?.icon),
    color: asText(category?.color),
    description: asText(category?.description),
    plannerBucketId: asText(category?.plannerBucketId),
    autoCategorizeRules: asArray(category?.autoCategorizeRules).map((rule) => ({
      field: asText(rule?.field),
      operator: asText(rule?.operator),
      value: asText(rule?.value)
    }))
  });
}

function validateCategoryCustomization(workbook, payload) {
  if (
    Object.prototype.hasOwnProperty.call(payload, 'icon') &&
    !isSupportedCategoryIcon(payload.icon)
  ) {
    return errorResult(workbook, {
      code: 'category.icon_invalid',
      message: `“${asText(payload.icon) || '(empty)'}” is not a supported category icon. Choose an icon from Cavalry's category icon catalog.`,
      field: 'icon',
      details: { field: 'icon' }
    });
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'color') &&
    asText(payload.color) &&
    !/^#[0-9a-f]{6}$/i.test(asText(payload.color))
  ) {
    return errorResult(workbook, {
      code: 'category.color_invalid',
      message: 'Category colors must use a six-digit hex value such as #499eee.',
      field: 'color',
      details: { field: 'color' }
    });
  }
  return null;
}

export function executeCategoryCommand(workbook, action, services = {}) {
  if (!workbook || typeof workbook !== 'object') {
    return errorResult(workbook, {
      code: 'category.workbook_required',
      message: 'Open a workbook before changing categories.'
    });
  }

  const type = asText(action?.type);
  const payload = action?.payload && typeof action.payload === 'object' ? action.payload : {};
  const categoryId = asText(payload.categoryId);
  const originalCategory = categoryId ? getCategory(workbook, categoryId) : null;
  const customizationError = validateCategoryCustomization(workbook, payload);
  if (customizationError) return customizationError;
  if (
    originalCategory?.isSystem &&
    type === CATEGORY_ACTIONS.UPDATE &&
    ['name', 'type', 'plannerBucketId', 'autoCategorizeRules'].some((key) =>
      Object.prototype.hasOwnProperty.call(payload, key)
    )
  ) {
    return errorResult(workbook, {
      code: 'category.system_protected',
      message: 'System categories only allow appearance changes.'
    });
  }
  if (
    originalCategory?.isSystem &&
    type !== CATEGORY_ACTIONS.CREATE &&
    type !== CATEGORY_ACTIONS.UPDATE
  ) {
    return errorResult(workbook, {
      code: 'category.system_protected',
      message: 'System categories cannot be renamed, hidden, relinked, or deleted.'
    });
  }

  const nextWorkbook = cloneWorkbook(workbook);
  const commandServices = deterministicServices(nextWorkbook, services);
  try {
    if (type === CATEGORY_ACTIONS.CREATE) {
      const createPayload = Object.prototype.hasOwnProperty.call(payload, 'icon')
        ? payload
        : { ...payload, icon: matchCategoryIcon(payload.name, payload.type) };
      const operation = createCategoryWithLinkedAccount(
        nextWorkbook,
        createPayload,
        commandServices
      );
      applyCategoryCustomization(operation.category, createPayload, { allowType: true });
      return changedOrError(workbook, nextWorkbook, operation, {
        type: 'category.created',
        categoryId: operation.category?.id || '',
        linkedAccountId: operation.account?.id || ''
      });
    }

    if (!categoryId) {
      return errorResult(workbook, {
        code: 'category.id_required',
        message: 'Choose a category before continuing.'
      });
    }

    if (type === CATEGORY_ACTIONS.UPDATE) {
      const category = getCategory(nextWorkbook, categoryId);
      if (!category) {
        return errorResult(workbook, {
          code: 'category.not_found',
          message: 'The category was not found.'
        });
      }
      const before = categoryCustomizationSnapshot(category);
      applyCategoryCustomization(category, payload);
      if (before === categoryCustomizationSnapshot(category)) {
        return errorResult(workbook, {
          code: 'category.not_changed',
          message: 'The category already has those details.'
        });
      }
      return commandOk(nextWorkbook, {
        events: [{ type: 'category.updated', categoryId }]
      });
    }

    if (type === CATEGORY_ACTIONS.RENAME) {
      const operation = renameCategory(nextWorkbook, payload, commandServices);
      applyCategoryCustomization(operation.category, payload);
      return changedOrError(workbook, nextWorkbook, operation, {
        type: 'category.updated',
        categoryId
      });
    }

    if (type === CATEGORY_ACTIONS.HIDE || type === CATEGORY_ACTIONS.RESTORE) {
      const isActive = type === CATEGORY_ACTIONS.RESTORE;
      const operation = setCategoryActive(nextWorkbook, { categoryId, isActive }, commandServices);
      return changedOrError(workbook, nextWorkbook, operation, {
        type: isActive ? 'category.restored' : 'category.hidden',
        categoryId
      });
    }

    if (type === CATEGORY_ACTIONS.LINK) {
      const operation = updateCategoryLinkedAccount(nextWorkbook, payload, commandServices);
      return changedOrError(workbook, nextWorkbook, operation, {
        type: 'category.linked_account_updated',
        categoryId,
        linkedAccountId: operation.account?.id || ''
      });
    }

    if (type === CATEGORY_ACTIONS.REPLACE_LINK) {
      const operation = replaceCategoryLinkedAccount(nextWorkbook, payload, commandServices);
      return changedOrError(
        workbook,
        nextWorkbook,
        operation,
        {
          type: 'category.linked_account_replaced',
          categoryId,
          linkedAccountId: operation.account?.id || ''
        },
        operation.archivedPreviousAccount
          ? [
              {
                code: 'category.previous_link_archived',
                message: 'The previous linked account had history and was archived.'
              }
            ]
          : []
      );
    }

    if (type === CATEGORY_ACTIONS.DELETE) {
      const operation = deleteCategory(nextWorkbook, { categoryId }, commandServices);
      return changedOrError(workbook, nextWorkbook, operation, {
        type: 'category.deleted',
        categoryId
      });
    }

    return errorResult(workbook, {
      code: 'category.action_unknown',
      message: `Unsupported category action: ${type || 'empty'}.`
    });
  } catch (error) {
    return errorResult(workbook, error);
  }
}

function categoryDescription(category) {
  if (category?.description) return String(category.description);
  const descriptions = {
    income: 'Income and incoming cash flow',
    expense: 'Spending and operating costs',
    savings: 'Savings and reserve contributions',
    debt: 'Debt and liability payments'
  };
  return descriptions[category?.type] || 'Workbook category';
}

function categoryIcon(category) {
  if (category?.icon) return String(category.icon);
  const icons = {
    income: 'payments',
    expense: 'shopping_cart',
    savings: 'savings',
    debt: 'credit_card'
  };
  return icons[category?.type] || 'category';
}

function categoryColor(category, index) {
  if (category?.color) return String(category.color);
  const colors = {
    income: '#4d79eb',
    expense: '#c47a2c',
    savings: '#499eee',
    debt: '#7758b8'
  };
  return colors[category?.type] || ['#1a3fe9', '#4d79eb', '#499eee', '#809fec'][index % 4];
}

function titleCase(value, fallback = 'Category') {
  const text = asText(value).replace(/[_-]+/g, ' ');
  return text ? text.replace(/\b\w/g, (character) => character.toUpperCase()) : fallback;
}

function transactionCategoryActivity(workbook, transaction, categoryType) {
  const contribution = getTransactionContributions(workbook, transaction);
  if (categoryType === 'income') return Number(contribution.metrics.income) || 0;
  if (categoryType === 'expense') return Number(contribution.metrics.categoryBudget) || 0;
  if (categoryType === 'savings') return Number(contribution.metrics.savings) || 0;
  if (categoryType === 'debt') return Number(contribution.metrics.debt) || 0;
  return 0;
}

export function buildCategoriesFeatureModel(workbook, options = {}) {
  const currency = asText(workbook?.currency).toUpperCase() || 'PHP';
  const coreModel = buildCategoryRouteViewModel(workbook || {}, {
    includeHidden: options.showHidden === true
  });
  const transactions = asArray(workbook?.transactions).filter((transaction) => {
    const date = asText(transaction?.date);
    if (options.rangeStart && date && date < options.rangeStart) return false;
    if (options.rangeEnd && date && date > options.rangeEnd) return false;
    return true;
  });
  const categories = asArray(coreModel.categories)
    .map((item) => getCategory(workbook, item.value))
    .filter(Boolean);
  const categoryById = new Map(categories.map((category) => [asText(category.id), category]));
  const spendByCategory = transactions.reduce((totals, transaction) => {
    const categoryId = asText(transaction?.categoryId);
    const category = categoryById.get(categoryId);
    if (categoryId && category) {
      totals[categoryId] = roundMoney(
        (totals[categoryId] || 0) +
          transactionCategoryActivity(workbook, transaction, category.type)
      );
    }
    return totals;
  }, {});
  const spendingRows = categories
    .filter((category) => category.type !== 'income')
    .map((category) => ({
      category: { id: category.id, name: category.name },
      total: spendByCategory[category.id] || 0
    }))
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total);
  const totalActivity = roundMoney(
    Object.values(spendByCategory).reduce(
      (total, amount) => total + Math.abs(Number(amount) || 0),
      0
    )
  );

  return {
    currency,
    periodLabel: options.periodLabel || 'Current workbook',
    showHidden: options.showHidden === true,
    hiddenCount: coreModel.hiddenCount,
    spendingRows,
    categoryRows: categories.map((category, index) => {
      const usage = getCategoryUsageSummary(workbook, category.id);
      const linkedAccount =
        asArray(workbook?.accounts).find((account) => account?.id === category.linkedAccountId) ||
        null;
      const plannerBucket =
        asArray(workbook?.plannerBuckets).find(
          (bucket) => bucket?.id === category.plannerBucketId
        ) || null;
      const spent = roundMoney(spendByCategory[category.id] || 0);
      const isSystem = category.isSystem === true;
      return {
        id: category.id,
        name: category.name || '',
        description: categoryDescription(category),
        icon: categoryIcon(category),
        color: categoryColor(category, index),
        tone: ['good', 'info', 'warn', 'bad', 'tone-4', 'tone-5'][index % 6],
        typeTone:
          category.type === 'income'
            ? 'good'
            : category.type === 'debt'
              ? 'warn'
              : category.type === 'savings'
                ? 'info'
                : 'bad',
        typeLabel: titleCase(category.type),
        amountTone:
          spent === 0
            ? 'neutral'
            : category.type === 'expense'
              ? spent < 0
                ? 'good'
                : 'bad'
              : ['income', 'savings', 'debt'].includes(category.type)
                ? spent > 0
                  ? 'good'
                  : 'bad'
                : 'neutral',
        activityLabel:
          category.type === 'income'
            ? 'Received'
            : category.type === 'savings'
              ? 'Saved'
              : category.type === 'debt'
                ? 'Paid down'
                : spent < 0
                  ? 'Refunded'
                  : 'Spent',
        bucketLabel:
          plannerBucket?.name ||
          (category.plannerBucketId ? titleCase(category.plannerBucketId) : 'Unassigned'),
        transactionCount: usage.transactionCount,
        spent,
        percent: totalActivity ? Math.round((Math.abs(spent) / totalActivity) * 1000) / 10 : 0,
        isArchived: category.isActive === false,
        isSystem,
        linkedAccountName: linkedAccount?.name || '',
        canRename: !isSystem,
        canToggleActive: !isSystem,
        canDelete: !isSystem,
        canLink: !isSystem,
        hasReferences: usage.hasReferences
      };
    })
  };
}
