export class CategoryManagementError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CategoryManagementError';
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_TYPE_LABELS = {
  income: 'Income',
  expense: 'Expense',
  savings: 'Savings',
  debt: 'Debt'
};

function ensureArrayContainer(workbook, key) {
  if (!workbook[key] || !Array.isArray(workbook[key])) {
    workbook[key] = [];
  }
  return workbook[key];
}

function getWorkbookCurrency(workbook) {
  return String((workbook && workbook.currency) || 'PHP')
    .trim()
    .toUpperCase();
}

function getCategoryById(workbook, categoryId, services) {
  if (services && typeof services.getCategoryById === 'function') {
    return services.getCategoryById(workbook, categoryId);
  }
  return (
    (workbook && workbook.categories ? workbook.categories : []).find(
      (category) => category.id === categoryId
    ) || null
  );
}

function getAccountById(workbook, accountId, services) {
  if (services && typeof services.getAccountById === 'function') {
    return services.getAccountById(workbook, accountId);
  }
  return (
    (workbook && workbook.accounts ? workbook.accounts : []).find(
      (account) => account.id === accountId
    ) || null
  );
}

function isCategoryNameTaken(workbook, name, excludeId, services) {
  if (services && typeof services.isCategoryNameTaken === 'function') {
    return services.isCategoryNameTaken(workbook, name, excludeId);
  }
  const targetName = String(name || '')
    .trim()
    .toLowerCase();
  return (workbook && workbook.categories ? workbook.categories : []).some((category) => {
    if (excludeId && category.id === excludeId) {
      return false;
    }
    return (
      String(category.name || '')
        .trim()
        .toLowerCase() === targetName
    );
  });
}

function isAccountNameTaken(workbook, name, group, currency, excludeId, services) {
  if (services && typeof services.isAccountNameTaken === 'function') {
    return services.isAccountNameTaken(workbook, name, group, currency, excludeId);
  }
  const targetName = String(name || '')
    .trim()
    .toLowerCase();
  const targetGroup = String(group || '').toLowerCase();
  const targetCurrency = String(currency || '').toUpperCase();
  return (workbook && workbook.accounts ? workbook.accounts : []).some((account) => {
    if (excludeId && account.id === excludeId) {
      return false;
    }
    if (account.isActive === false) {
      return false;
    }
    return (
      account.group === targetGroup &&
      account.currency === targetCurrency &&
      String(account.name || '')
        .trim()
        .toLowerCase() === targetName
    );
  });
}

function normalizeCategory(workbook, input, services) {
  if (services && typeof services.normalizeCategory === 'function') {
    return services.normalizeCategory(
      input,
      (workbook.categories || []).length,
      getWorkbookCurrency(workbook)
    );
  }
  return {
    id: 'category_' + String((workbook.categories || []).length + 1),
    name: String(input.name || '').trim(),
    type: input.type,
    color: input.color || '',
    icon: String(input.icon || '').trim(),
    description: String(input.description || '').trim(),
    autoCategorizeRules: Array.isArray(input.autoCategorizeRules) ? input.autoCategorizeRules : [],
    currency: String(input.currency || getWorkbookCurrency(workbook))
      .trim()
      .toUpperCase(),
    isActive: input.isActive !== false,
    plannerBucketId: String(input.plannerBucketId || '').trim()
  };
}

function normalizeAccount(workbook, input, services) {
  if (services && typeof services.normalizeAccount === 'function') {
    return services.normalizeAccount(
      input,
      (workbook.accounts || []).length,
      getWorkbookCurrency(workbook)
    );
  }
  return {
    id: 'account_' + String((workbook.accounts || []).length + 1),
    name: String(input.name || '').trim(),
    group: String(input.group || 'asset').toLowerCase(),
    subtype: String(input.subtype || '').trim(),
    currency: String(input.currency || getWorkbookCurrency(workbook))
      .trim()
      .toUpperCase(),
    note: String(input.note || ''),
    isActive: input.isActive !== false
  };
}

function ensurePlannerBucket(workbook, category, services) {
  if (services && typeof services.ensureCategoryPlannerBucket === 'function') {
    return services.ensureCategoryPlannerBucket(workbook, category);
  }
  return category && category.plannerBucketId ? category.plannerBucketId : '';
}

function getCategoryType(rawType, services) {
  const type = String(rawType || 'expense').toLowerCase();
  const typeLabels = services && services.typeLabels ? services.typeLabels : DEFAULT_TYPE_LABELS;
  return Object.prototype.hasOwnProperty.call(typeLabels, type) ? type : 'expense';
}

function getCategoryColor(type, services) {
  const typeColors = services && services.typeColors ? services.typeColors : {};
  return typeColors[type] || '';
}

function getCategoryPostingGroup(categoryType) {
  return categoryType === 'income' ? 'income' : 'expense';
}

function getUniqueAccountName(workbook, baseName, group, currency, services) {
  let candidateName = baseName;
  let suffix = 2;
  while (isAccountNameTaken(workbook, candidateName, group, currency, null, services)) {
    candidateName = baseName + ' ' + suffix;
    suffix += 1;
  }
  return candidateName;
}

function getAccountTransactionUsage(workbook, accountId, services) {
  if (services && typeof services.getAccountTransactionUsage === 'function') {
    return services.getAccountTransactionUsage(workbook, accountId);
  }
  const relatedTransactions = (
    workbook && workbook.transactions ? workbook.transactions : []
  ).filter((transaction) => {
    return (transaction.lines || []).some((line) => line.accountId === accountId);
  });
  return {
    relatedTransactions,
    hasHistory: relatedTransactions.length > 0,
    openingOnly:
      relatedTransactions.length > 0 &&
      relatedTransactions.every((transaction) => transaction.template === 'opening_balance')
  };
}

function archiveAccount(workbook, accountId, services) {
  if (services && typeof services.archiveAccount === 'function') {
    return services.archiveAccount(workbook, accountId);
  }
  const account = getAccountById(workbook, accountId, services);
  if (!account) {
    return false;
  }
  account.isActive = false;
  return true;
}

export function getCategoryUsageSummary(workbook, categoryId) {
  const targetId = String(categoryId || '');
  const transactionCount = (workbook && workbook.transactions ? workbook.transactions : []).filter(
    (transaction) => {
      return transaction.categoryId === targetId;
    }
  ).length;
  const recurringItemCount = (
    workbook && workbook.recurringItems ? workbook.recurringItems : []
  ).filter((item) => {
    return item.categoryId === targetId;
  }).length;
  let budgetCount = 0;
  let budgetLineItemCount = 0;
  let sheetEntryCount = 0;
  (workbook && workbook.sheets ? workbook.sheets : []).forEach((sheet) => {
    budgetCount += (sheet.budgets || []).filter((budget) => budget.categoryId === targetId).length;
    budgetLineItemCount += (sheet.budgetLineItems || []).filter(
      (item) => item.categoryId === targetId
    ).length;
    sheetEntryCount += (sheet.entries || []).filter(
      (entry) => entry.categoryId === targetId
    ).length;
  });

  const totalReferences =
    transactionCount + recurringItemCount + budgetCount + budgetLineItemCount + sheetEntryCount;
  return {
    categoryId: targetId,
    transactionCount,
    budgetCount,
    budgetLineItemCount,
    sheetEntryCount,
    recurringItemCount,
    totalReferences,
    hasReferences: totalReferences > 0
  };
}

export function createCategoryWithLinkedAccount(workbook, input = {}, services = {}) {
  ensureArrayContainer(workbook, 'categories');
  ensureArrayContainer(workbook, 'accounts');
  const name = String(input.name || '').trim();
  const categoryType = getCategoryType(input.type, services);
  const postingAccountName = String(input.postingAccountName || '').trim() || name;
  const targetGroup = getCategoryPostingGroup(categoryType);

  if (!name) {
    throw new CategoryManagementError('category_name_required', 'Category name is required.');
  }
  if (isCategoryNameTaken(workbook, name, null, services)) {
    throw new CategoryManagementError(
      'category_name_duplicate',
      'A category with this name already exists.'
    );
  }
  if (!postingAccountName) {
    throw new CategoryManagementError(
      'posting_account_name_required',
      'Posting account name is required.'
    );
  }

  const accountName = getUniqueAccountName(
    workbook,
    postingAccountName,
    targetGroup,
    getWorkbookCurrency(workbook),
    services
  );
  const category = normalizeCategory(
    workbook,
    {
      name,
      type: categoryType,
      color: getCategoryColor(categoryType, services),
      currency: getWorkbookCurrency(workbook),
      isActive: true
    },
    services
  );
  const account = normalizeAccount(
    workbook,
    {
      name: accountName,
      group: targetGroup,
      subtype: categoryType,
      currency: getWorkbookCurrency(workbook),
      note: 'Linked posting account for ' + name
    },
    services
  );

  category.linkedAccountId = account.id;
  ensurePlannerBucket(workbook, category, services);
  workbook.categories.push(category);
  workbook.accounts.push(account);

  return {
    changed: true,
    category,
    account,
    feedback: {
      categoryId: category.id,
      kind: 'good',
      message: 'Category created.'
    }
  };
}

export function renameCategory(workbook, input = {}, services = {}) {
  const categoryId = String(input.categoryId || '');
  const name = String(input.name || '').trim();
  const category = getCategoryById(workbook, categoryId, services);
  if (!category) {
    return { changed: false, category: null, feedback: null };
  }
  if (!name) {
    throw new CategoryManagementError('category_name_required', 'Category name is required.');
  }
  if (isCategoryNameTaken(workbook, name, category.id, services)) {
    throw new CategoryManagementError(
      'category_name_duplicate',
      'A category with this name already exists.'
    );
  }

  category.name = name;
  return {
    changed: true,
    category,
    feedback: {
      categoryId: category.id,
      kind: 'good',
      message: 'Category renamed.'
    }
  };
}

export function updateCategoryLinkedAccount(workbook, input = {}, services = {}) {
  ensureArrayContainer(workbook, 'accounts');
  const categoryId = String(input.categoryId || '');
  const accountName = String(input.linkedAccountName || '').trim();
  const category = getCategoryById(workbook, categoryId, services);
  if (!category) {
    return { changed: false, category: null, account: null, feedback: null };
  }
  if (!accountName) {
    throw new CategoryManagementError(
      'linked_account_name_required',
      'Linked account name is required.'
    );
  }

  let account = category.linkedAccountId
    ? getAccountById(workbook, category.linkedAccountId, services)
    : null;
  const targetGroup = getCategoryPostingGroup(category.type);
  const currency = String(category.currency || getWorkbookCurrency(workbook))
    .trim()
    .toUpperCase();
  const excludeId = account ? account.id : null;
  if (isAccountNameTaken(workbook, accountName, targetGroup, currency, excludeId, services)) {
    throw new CategoryManagementError(
      'linked_account_name_duplicate',
      'An active linked account with this name already exists.'
    );
  }

  if (!account) {
    account = normalizeAccount(
      workbook,
      {
        name: accountName,
        group: targetGroup,
        subtype: category.type,
        currency
      },
      services
    );
    workbook.accounts.push(account);
    category.linkedAccountId = account.id;
  } else {
    account.name = accountName;
    account.group = targetGroup;
    account.subtype = category.type;
    account.currency = currency;
  }

  return {
    changed: true,
    category,
    account,
    feedback: {
      categoryId: category.id,
      kind: 'good',
      message: 'Linked account saved.'
    }
  };
}

export function replaceCategoryLinkedAccount(workbook, input = {}, services = {}) {
  ensureArrayContainer(workbook, 'accounts');
  const categoryId = String(input.categoryId || '');
  const category = getCategoryById(workbook, categoryId, services);
  if (!category) {
    return { changed: false, category: null, account: null, previousAccount: null, feedback: null };
  }

  const currentAccount = category.linkedAccountId
    ? getAccountById(workbook, category.linkedAccountId, services)
    : null;
  const targetGroup = getCategoryPostingGroup(category.type);
  const currency = String(category.currency || getWorkbookCurrency(workbook))
    .trim()
    .toUpperCase();
  const usage = currentAccount
    ? getAccountTransactionUsage(workbook, currentAccount.id, services)
    : null;
  let archivedPreviousAccount = false;
  let removedPreviousAccount = false;

  if (currentAccount) {
    if (usage && usage.hasHistory) {
      archivedPreviousAccount = archiveAccount(workbook, currentAccount.id, services);
    } else {
      workbook.accounts = (workbook.accounts || []).filter(
        (account) => account.id !== currentAccount.id
      );
      removedPreviousAccount = true;
    }
  }

  const replacementName = String(category.name || '').trim() || 'Linked account';
  const accountName = getUniqueAccountName(
    workbook,
    replacementName,
    targetGroup,
    currency,
    services
  );
  const replacementAccount = normalizeAccount(
    workbook,
    {
      name: accountName,
      group: targetGroup,
      subtype: category.type,
      currency,
      note: 'Replacement linked account'
    },
    services
  );

  workbook.accounts.push(replacementAccount);
  category.linkedAccountId = replacementAccount.id;

  return {
    changed: true,
    category,
    account: replacementAccount,
    previousAccount: currentAccount,
    archivedPreviousAccount,
    removedPreviousAccount,
    feedback: {
      categoryId: category.id,
      kind: 'warn',
      message: archivedPreviousAccount
        ? 'Linked account archived. Replacement created.'
        : 'Linked account replaced.'
    }
  };
}

export function setCategoryActive(workbook, input = {}, services = {}) {
  const categoryId = String(input.categoryId || '');
  const category = getCategoryById(workbook, categoryId, services);
  if (!category) {
    return { changed: false, category: null, feedback: null };
  }
  category.isActive = !!input.isActive;
  return {
    changed: true,
    category,
    feedback: {
      categoryId: category.id,
      kind: category.isActive ? 'good' : 'warn',
      message: category.isActive ? 'Category restored.' : 'Category hidden from new entry choices.'
    }
  };
}

export function deleteCategory(workbook, input = {}, services = {}) {
  const categoryId = String(input.categoryId || '');
  const allowReferencedDelete = input.allowReferencedDelete === true;
  const category = getCategoryById(workbook, categoryId, services);
  if (!category) {
    return {
      changed: false,
      category: null,
      usage: getCategoryUsageSummary(workbook, categoryId),
      feedback: null
    };
  }

  const usage = getCategoryUsageSummary(workbook, categoryId);
  if (usage.hasReferences && !allowReferencedDelete) {
    throw new CategoryManagementError(
      'category_in_use',
      'Category is still referenced. Hide it instead of deleting it.',
      { usage }
    );
  }

  workbook.categories = (workbook.categories || []).filter((item) => item.id !== categoryId);
  (workbook.transactions || []).forEach((transaction) => {
    if (transaction.categoryId === categoryId) {
      transaction.categoryId = '';
    }
  });
  (workbook.sheets || []).forEach((sheet) => {
    sheet.budgets = (sheet.budgets || []).filter((budget) => budget.categoryId !== categoryId);
    sheet.budgetLineItems = (sheet.budgetLineItems || []).filter(
      (item) => item.categoryId !== categoryId
    );
    (sheet.entries || []).forEach((entry) => {
      if (entry.categoryId === categoryId) {
        entry.categoryId = '';
      }
    });
  });
  workbook.recurringItems = (workbook.recurringItems || []).filter(
    (item) => item.categoryId !== categoryId
  );

  return {
    changed: true,
    category,
    usage,
    feedback: {
      categoryId,
      kind: 'warn',
      message: 'Category deleted.'
    }
  };
}
