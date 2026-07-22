import { getLedgerTransactionTemplateConfig } from '../../domain/ledger/transactions.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getAllowedTypes(options = {}) {
  if (Array.isArray(options.categoryTypes)) {
    return options.categoryTypes.map(asString).filter(Boolean);
  }
  return getLedgerTransactionTemplateConfig(options.template || 'expense_paid').categoryTypes || [];
}

function sortCategoriesForSelector(categories) {
  return categories
    .slice()
    .sort((a, b) => asString(a && a.name).localeCompare(asString(b && b.name)));
}

function sortCategoriesForRoute(categories) {
  return categories.slice().sort((a, b) => {
    if ((a.isActive === false) !== (b.isActive === false)) {
      return a.isActive === false ? 1 : -1;
    }
    if (a.type !== b.type) {
      return asString(a && a.type).localeCompare(asString(b && b.type));
    }
    return asString(a && a.name).localeCompare(asString(b && b.name));
  });
}

function toCategoryOption(category, options = {}) {
  const categoryId = asString(category && category.id);
  const categoryName = asString(category && category.name);
  const categoryType = asString(category && category.type);
  const labelMode = asString(options.labelMode || 'selector');
  return {
    categoryId,
    value: categoryId,
    label: labelMode === 'name' ? categoryName : categoryName + ' • ' + categoryType,
    name: categoryName,
    type: categoryType,
    currency: asString(category && category.currency).toUpperCase(),
    icon: asString(category && category.icon),
    color: asString(category && category.color),
    description: asString(category && category.description),
    linkedAccountId: asString(category && category.linkedAccountId),
    plannerBucketId: asString(category && category.plannerBucketId),
    isArchived: category && category.isActive === false,
    selected: asString(options.selectedValue) === categoryId
  };
}

export function getCategoryViewItems(workbook, options = {}) {
  const mode = asString(options.mode || 'selector');
  const allowedTypes = mode === 'selector' ? getAllowedTypes(options) : [];
  if (mode === 'selector' && !allowedTypes.length) {
    return [];
  }
  const categories = asArray(workbook && workbook.categories).filter((category) => {
    if (options.includeHidden !== true && category.isActive === false) {
      return false;
    }
    if (allowedTypes.length && allowedTypes.indexOf(category.type) < 0) {
      return false;
    }
    return true;
  });
  return mode === 'route'
    ? sortCategoriesForRoute(categories)
    : sortCategoriesForSelector(categories);
}

export function buildCategorySelectorOptions(workbook, options = {}) {
  return getCategoryViewItems(workbook, Object.assign({}, options, { mode: 'selector' })).map(
    (category) => toCategoryOption(category, options)
  );
}

export function buildCategoryRouteViewModel(workbook, options = {}) {
  const categories = getCategoryViewItems(workbook, Object.assign({}, options, { mode: 'route' }));
  return {
    categoryCount: categories.length,
    hiddenCount: asArray(workbook && workbook.categories).filter(
      (category) => category.isActive === false
    ).length,
    categories: categories.map((category) => {
      return toCategoryOption(category, Object.assign({}, options, { labelMode: 'name' }));
    })
  };
}
