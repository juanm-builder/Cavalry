const PAYMENT_PATTERNS = Object.freeze([
  {
    kind: 'credit_card',
    label: 'Credit card',
    pattern: /\b(?:credit\s*card|card\s*credit|cc)\b/i
  },
  {
    kind: 'debit',
    label: 'Debit card',
    pattern: /\b(?:debit\s*card|card\s*debit|debit)\b/i
  },
  {
    kind: 'wallet',
    label: 'E-wallet',
    pattern: /\b(?:e[\s-]?wallet|wallet|gcash|maya)\b/i
  },
  {
    kind: 'bank',
    label: 'Bank',
    pattern: /\b(?:bank\s*transfer|bank)\b/i
  },
  {
    kind: 'cash',
    label: 'Cash',
    pattern: /\bcash\b/i
  }
]);

const CATEGORY_ALIASES = Object.freeze({
  transport: [
    'transport',
    'transportation',
    'commute',
    'fare',
    'taxi',
    'grab',
    'bus',
    'train',
    'jeep',
    'fuel',
    'gas',
    'parking',
    'toll'
  ],
  groceries: ['groceries', 'grocery', 'supermarket', 'market'],
  coffee: ['coffee', 'cafe', 'café'],
  food: ['food', 'dining', 'meal', 'breakfast', 'lunch', 'dinner', 'restaurant', 'takeout'],
  utilities: ['utilities', 'utility', 'electric', 'electricity', 'water', 'internet', 'phone'],
  housing: ['housing', 'rent', 'mortgage'],
  health: ['health', 'medical', 'medicine', 'doctor', 'hospital', 'pharmacy'],
  shopping: ['shopping', 'clothes', 'clothing', 'shoes'],
  entertainment: ['entertainment', 'movie', 'movies', 'cinema', 'game', 'games'],
  travel: ['travel', 'flight', 'hotel', 'vacation'],
  education: ['education', 'school', 'tuition', 'book', 'books'],
  subscriptions: ['subscription', 'subscriptions', 'membership'],
  salary: ['salary', 'paycheck', 'payroll', 'wages'],
  income: ['income', 'received', 'earnings', 'revenue']
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value);
}

function normalize(value) {
  return asString(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsPhrase(haystack, needle) {
  if (!needle) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(needle).replace(/\\ /g, '\\s+')}(?:$|\\s)`).test(
    haystack
  );
}

function activeCategories(workbook) {
  return asArray(workbook && workbook.categories).filter(
    (category) =>
      category &&
      category.isActive !== false &&
      ['expense', 'income'].includes(asString(category.type).toLowerCase())
  );
}

function balanceAccounts(workbook) {
  return asArray(workbook && workbook.accounts).filter(
    (account) =>
      account &&
      account.isActive !== false &&
      ['asset', 'liability'].includes(asString(account.group).toLowerCase())
  );
}

export function isCreditCardAccount(account) {
  const subtype = normalize(account && account.subtype);
  const details = asObject(account && account.details);
  return !!(
    account &&
    asString(account.group).toLowerCase() === 'liability' &&
    (['credit card', 'card'].includes(subtype) ||
      normalize(account.icon) === 'credit card' ||
      details.creditLimit != null ||
      details.cardNetwork ||
      containsPhrase(normalize(account.name), 'credit card'))
  );
}

function isCashAccount(account) {
  return (
    normalize(account && account.subtype) === 'cash' ||
    containsPhrase(normalize(account && account.name), 'cash')
  );
}

function isWalletAccount(account) {
  const descriptor = normalize(
    [
      account && account.name,
      account && account.subtype,
      account && account.institution,
      asObject(account && account.details).provider,
      asObject(account && account.details).providerName
    ].join(' ')
  );
  return ['wallet', 'e wallet', 'ewallet', 'gcash', 'maya'].some((term) =>
    containsPhrase(descriptor, term)
  );
}

function isBankAccount(account) {
  const subtype = normalize(account && account.subtype);
  return (
    asString(account && account.group).toLowerCase() === 'asset' &&
    (['bank', 'checking', 'savings', 'debit', 'debit card'].includes(subtype) ||
      containsPhrase(normalize(account && account.name), 'bank'))
  );
}

function categoryAliasKeys(categoryName) {
  const normalizedName = normalize(categoryName);
  return Object.keys(CATEGORY_ALIASES).filter(
    (key) => containsPhrase(normalizedName, key) || containsPhrase(key, normalizedName)
  );
}

function findCategory(workbook, normalizedLine) {
  const categories = activeCategories(workbook);
  const direct = categories
    .map((category) => ({ category, phrase: normalize(category.name) }))
    .filter(({ phrase }) => phrase && containsPhrase(normalizedLine, phrase))
    .sort((left, right) => right.phrase.length - left.phrase.length);

  if (direct.length) {
    const bestLength = direct[0].phrase.length;
    const best = direct.filter((candidate) => candidate.phrase.length === bestLength);
    return {
      category: best[0].category,
      matchedPhrase: best[0].phrase,
      ambiguous: best.length > 1
    };
  }

  const aliases = categories
    .flatMap((category) =>
      categoryAliasKeys(category.name).flatMap((key) =>
        CATEGORY_ALIASES[key]
          .map(normalize)
          .filter((alias) => containsPhrase(normalizedLine, alias))
          .map((alias) => ({ category, alias, key }))
      )
    )
    .sort((left, right) => right.alias.length - left.alias.length);
  if (aliases.length) {
    const bestLength = aliases[0].alias.length;
    const best = aliases.filter((candidate) => candidate.alias.length === bestLength);
    const categoryIds = new Set(best.map((candidate) => asString(candidate.category.id)));
    return {
      category: best[0].category,
      matchedPhrase: best[0].alias,
      ambiguous: categoryIds.size > 1
    };
  }

  const fallback =
    categories.find((category) => {
      const name = normalize(category.name);
      return category.type === 'expense' && ['general', 'other', 'uncategorized'].includes(name);
    }) ||
    categories.find((category) => category.type === 'expense') ||
    categories[0] ||
    null;
  return { category: fallback, matchedPhrase: '', ambiguous: false, fallback: true };
}

function accountDescriptor(account) {
  const details = asObject(account && account.details);
  return normalize(
    [
      account && account.name,
      account && account.subtype,
      account && account.institution,
      details.provider,
      details.providerName,
      details.walletProvider,
      details.walletProviderName
    ].join(' ')
  );
}

function findPayment(workbook, normalizedLine, transactionKind) {
  const accounts = balanceAccounts(workbook);
  const direct = accounts
    .map((account) => ({ account, phrase: normalize(account.name) }))
    .filter(({ phrase }) => phrase && containsPhrase(normalizedLine, phrase))
    .sort((left, right) => right.phrase.length - left.phrase.length);
  const paymentPattern = PAYMENT_PATTERNS.find((candidate) =>
    candidate.pattern.test(normalizedLine)
  );
  if (direct.length) {
    const bestLength = direct[0].phrase.length;
    const best = direct.filter((candidate) => candidate.phrase.length === bestLength);
    return {
      account: best[0].account,
      matchedPhrase: best[0].phrase,
      label: paymentPattern ? paymentPattern.label : paymentLabel(best[0].account),
      kind: paymentPattern ? paymentPattern.kind : paymentKind(best[0].account),
      ambiguous: best.length > 1
    };
  }

  let candidates = [];
  if (paymentPattern?.kind === 'credit_card') {
    candidates = accounts.filter(isCreditCardAccount);
  } else if (paymentPattern?.kind === 'cash') {
    candidates = accounts.filter(isCashAccount);
  } else if (paymentPattern?.kind === 'wallet') {
    candidates = accounts.filter(isWalletAccount);
  } else if (paymentPattern?.kind === 'debit') {
    candidates = accounts.filter(
      (account) =>
        account.group === 'asset' &&
        !isCashAccount(account) &&
        !isWalletAccount(account) &&
        (isBankAccount(account) ||
          containsPhrase(accountDescriptor(account), 'debit') ||
          !normalize(account.subtype))
    );
  } else if (paymentPattern?.kind === 'bank') {
    candidates = accounts.filter(isBankAccount);
  }

  if (transactionKind === 'income') {
    candidates = candidates.filter((account) => account.group === 'asset');
  }

  if (!paymentPattern) {
    const eligible = accounts.filter((account) =>
      transactionKind === 'income' ? account.group === 'asset' : true
    );
    const cash = eligible.filter(isCashAccount);
    candidates = cash.length ? cash : eligible;
  }

  return {
    account: candidates[0] || null,
    matchedPhrase: paymentPattern ? normalize(paymentPattern.label) : '',
    label: paymentPattern?.label || (candidates[0] ? paymentLabel(candidates[0]) : 'Not selected'),
    kind: paymentPattern?.kind || (candidates[0] ? paymentKind(candidates[0]) : ''),
    ambiguous: candidates.length > 1,
    missing: !paymentPattern,
    unavailable: !!paymentPattern && candidates.length === 0
  };
}

function paymentKind(account) {
  if (isCreditCardAccount(account)) return 'credit_card';
  if (isCashAccount(account)) return 'cash';
  if (isWalletAccount(account)) return 'wallet';
  if (isBankAccount(account)) return 'debit';
  return asString(account && account.group).toLowerCase() === 'liability' ? 'credit_card' : 'bank';
}

export function paymentLabel(account) {
  const kind = paymentKind(account);
  if (kind === 'credit_card') return 'Credit card';
  if (kind === 'cash') return 'Cash';
  if (kind === 'wallet') return 'E-wallet';
  if (kind === 'debit') return 'Debit card';
  return account ? asString(account.name).trim() || 'Account' : 'Not selected';
}

function parseDate(source, today) {
  const isoMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(source);
  if (isoMatch) return { date: isoMatch[1], matchedText: isoMatch[0] };
  if (/\byesterday\b/i.test(source) && /^\d{4}-\d{2}-\d{2}$/.test(today)) {
    const timestamp = Date.parse(`${today}T00:00:00Z`);
    return {
      date: new Date(timestamp - 86400000).toISOString().slice(0, 10),
      matchedText: 'yesterday'
    };
  }
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10),
    matchedText: /\btoday\b/i.test(source) ? 'today' : ''
  };
}

function parseAmount(source, workbookCurrency) {
  const matches = Array.from(
    source.matchAll(
      /(?:₱|PHP\s*)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)|(?:US\$|\$|USD\s*)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)|(?:^|\s)([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?=\s|$)/gi
    )
  );
  const match = matches[0];
  if (!match) return { amount: 0, currency: workbookCurrency, matchedText: '' };
  const rawNumber = match[1] || match[2] || match[3] || '';
  const amount = Number(rawNumber.replace(/,/g, ''));
  const marker = match[0].toUpperCase();
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currency: match[1]
      ? 'PHP'
      : match[2] || marker.includes('$') || marker.includes('USD')
        ? 'USD'
        : workbookCurrency,
    matchedText: match[0].trim(),
    ambiguous: matches.length > 1
  };
}

function removePhrase(source, phrase) {
  if (!phrase) return source;
  return source.replace(new RegExp(escapeRegExp(phrase), 'i'), ' ');
}

function buildDescription(source, ...matchedPhrases) {
  let description = source;
  matchedPhrases.filter(Boolean).forEach((phrase) => {
    description = removePhrase(description, phrase);
  });
  description = description
    .replace(/\b(?:today|yesterday)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, '')
    .trim();
  if (!description) return 'Transaction from Notes';
  return description.charAt(0).toUpperCase() + description.slice(1);
}

function issue(code, field, message) {
  return { code, field, message };
}

export function validateNotesEntry(workbook, entry) {
  const issues = [];
  const categories = activeCategories(workbook);
  const accounts = balanceAccounts(workbook);
  const allAccounts = asArray(workbook && workbook.accounts);
  const category = categories.find(
    (candidate) => asString(candidate.id) === asString(entry && entry.categoryId)
  );
  const account = accounts.find(
    (candidate) => asString(candidate.id) === asString(entry && entry.primaryAccountId)
  );
  const amount = Number(entry && entry.amount);
  const date = asString(entry && entry.date);
  const currency = asString(entry && entry.currency).toUpperCase();
  const workbookCurrency = asString(workbook && workbook.currency).toUpperCase() || 'PHP';
  const dateTimestamp = Date.parse(`${date}T00:00:00Z`);
  const dateIsValid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(dateTimestamp) &&
    new Date(dateTimestamp).toISOString().slice(0, 10) === date;

  if (!(amount > 0)) {
    issues.push(issue('amount_missing', 'amount', 'Enter an amount greater than zero.'));
  }
  if (!category) {
    issues.push(issue('category_missing', 'categoryId', 'Choose a category.'));
  } else {
    const linkedAccount = allAccounts.find(
      (candidate) =>
        asString(candidate && candidate.id) === asString(category && category.linkedAccountId)
    );
    const expectedGroup = category.type === 'income' ? 'income' : 'expense';
    if (
      !linkedAccount ||
      linkedAccount.isActive === false ||
      asString(linkedAccount.group).toLowerCase() !== expectedGroup
    ) {
      issues.push(
        issue(
          'category_link_invalid',
          'categoryId',
          `${category.name} is not linked to an active ${expectedGroup} account.`
        )
      );
    }
  }
  if (!account) {
    issues.push(issue('payment_missing', 'primaryAccountId', 'Choose a payment account.'));
  }
  if (!dateIsValid) {
    issues.push(issue('date_invalid', 'date', 'Choose a valid transaction date.'));
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    issues.push(issue('currency_invalid', 'currency', 'Choose a valid currency.'));
  }
  const accountCurrency = asString(account && account.currency).toUpperCase() || currency;
  if (
    account &&
    currency &&
    (currency !== workbookCurrency || accountCurrency !== currency) &&
    !(Number(entry && entry.fxRateToBase) > 0)
  ) {
    issues.push(
      issue(
        'fx_rate_missing',
        'fxRateToBase',
        `Enter the conversion rate used for this ${currency} transaction.`
      )
    );
  }
  if (category && account) {
    if (category.type === 'income' && account.group !== 'asset') {
      issues.push(
        issue('income_account_invalid', 'primaryAccountId', 'Income must go to an asset account.')
      );
    }
    if (category.type === 'expense' && !['asset', 'liability'].includes(account.group)) {
      issues.push(
        issue(
          'expense_account_invalid',
          'primaryAccountId',
          'Expenses must use an asset or liability account.'
        )
      );
    }
    if (
      category.type === 'expense' &&
      account.group === 'liability' &&
      !isCreditCardAccount(account)
    ) {
      issues.push(
        issue(
          'expense_liability_invalid',
          'primaryAccountId',
          'Choose a cash, bank, e-wallet, or credit card account.'
        )
      );
    }
  }
  return issues;
}

function resolveTemplate(category, account) {
  if (category?.type === 'income') return 'income_received';
  return account?.group === 'liability' ? 'expense_charged' : 'expense_paid';
}

export function resolveNotesEntry(workbook, entry, options = {}) {
  const categories = activeCategories(workbook);
  const accounts = balanceAccounts(workbook);
  const category =
    categories.find((candidate) => asString(candidate.id) === asString(entry.categoryId)) || null;
  const account =
    accounts.find((candidate) => asString(candidate.id) === asString(entry.primaryAccountId)) ||
    null;
  const structuralIssues = validateNotesEntry(workbook, entry);
  return {
    ...entry,
    amount: Number(entry.amount) || 0,
    currency: asString(entry.currency || workbook?.currency || 'PHP').toUpperCase(),
    description: asString(entry.description).trim() || 'Transaction from Notes',
    categoryName: category?.name || 'Choose category',
    categoryColor: category?.color || '',
    categoryIcon: category?.icon || '',
    paymentLabel: account ? paymentLabel(account) : 'Choose account',
    template: resolveTemplate(category, account),
    issues: options.keepInferenceIssues
      ? [...asArray(entry.issues), ...structuralIssues].filter(
          (candidate, index, all) =>
            all.findIndex(
              (other) => other.code === candidate.code && other.field === candidate.field
            ) === index
        )
      : structuralIssues,
    manuallyReviewed: options.manuallyReviewed === true || entry.manuallyReviewed === true
  };
}

export function parseNotesLine(line, workbook, options = {}) {
  const sourceText = asString(line).trim();
  const workbookCurrency = asString(workbook && workbook.currency).toUpperCase() || 'PHP';
  const today =
    typeof options.today === 'function' ? asString(options.today()) : asString(options.today);
  const dateResult = parseDate(sourceText, today);
  const amountSource = removePhrase(sourceText, dateResult.matchedText);
  const amountResult = parseAmount(amountSource, workbookCurrency);
  const normalizedLine = normalize(sourceText);
  const categoryResult = findCategory(workbook, normalizedLine);
  const transactionKind = categoryResult.category?.type === 'income' ? 'income' : 'expense';
  const paymentResult = findPayment(workbook, normalizedLine, transactionKind);
  const inferenceIssues = [];
  const suggestedFxRate =
    amountResult.currency !== workbookCurrency
      ? Number(asObject(workbook && workbook.settings).usdToBaseRate) || 0
      : 0;

  if (!amountResult.amount) {
    inferenceIssues.push(issue('amount_missing', 'amount', 'Cavalry could not find an amount.'));
  } else if (amountResult.ambiguous) {
    inferenceIssues.push(
      issue('amount_ambiguous', 'amount', 'More than one amount appears on this line.')
    );
  }
  if (!categoryResult.category || categoryResult.fallback) {
    inferenceIssues.push(
      issue(
        'category_uncertain',
        'categoryId',
        categoryResult.category
          ? `Check whether ${categoryResult.category.name} is the right category.`
          : 'Choose a category.'
      )
    );
  } else if (categoryResult.ambiguous) {
    inferenceIssues.push(
      issue('category_ambiguous', 'categoryId', 'More than one category matched this line.')
    );
  }
  if (paymentResult.unavailable) {
    inferenceIssues.push(
      issue(
        'payment_unavailable',
        'primaryAccountId',
        `${paymentResult.label} does not match an account in this workbook.`
      )
    );
  } else if (paymentResult.missing) {
    inferenceIssues.push(
      issue('payment_unspecified', 'primaryAccountId', 'Check the payment account.')
    );
  } else if (paymentResult.ambiguous) {
    inferenceIssues.push(
      issue(
        'payment_ambiguous',
        'primaryAccountId',
        `More than one account matches ${paymentResult.label.toLowerCase()}.`
      )
    );
  }
  if (amountResult.currency !== workbookCurrency) {
    inferenceIssues.push(
      issue(
        'currency_conversion_review',
        'fxRateToBase',
        suggestedFxRate
          ? `Check the ${amountResult.currency} to ${workbookCurrency} conversion rate.`
          : `Add the ${amountResult.currency} to ${workbookCurrency} conversion rate.`
      )
    );
  }

  const paymentPhrase =
    PAYMENT_PATTERNS.find((candidate) => candidate.pattern.test(sourceText))?.pattern.exec(
      sourceText
    )?.[0] || paymentResult.matchedPhrase;
  const description = buildDescription(
    sourceText,
    amountResult.matchedText,
    dateResult.matchedText,
    paymentPhrase
  );
  const parsed = {
    id: options.id || `notes-line-${Number(options.lineNumber) || 1}`,
    lineNumber: Number(options.lineNumber) || 1,
    sourceText,
    amount: amountResult.amount,
    currency: amountResult.currency,
    fxRateToBase: suggestedFxRate,
    date: dateResult.date,
    description,
    categoryId: asString(categoryResult.category?.id),
    categoryName: categoryResult.category?.name || 'Choose category',
    categoryColor: categoryResult.category?.color || '',
    categoryIcon: categoryResult.category?.icon || '',
    primaryAccountId: asString(paymentResult.account?.id),
    paymentLabel: paymentResult.account
      ? paymentResult.label || paymentLabel(paymentResult.account)
      : paymentResult.label || 'Choose account',
    template: resolveTemplate(categoryResult.category, paymentResult.account),
    issues: inferenceIssues,
    manuallyReviewed: false
  };
  return resolveNotesEntry(workbook, parsed, { keepInferenceIssues: true });
}

export function parseNotesText(text, workbook, options = {}) {
  return asString(text)
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim())
    .map(({ line, lineNumber }) =>
      parseNotesLine(line, workbook, {
        ...options,
        id: `notes-line-${lineNumber}`,
        lineNumber
      })
    );
}

export function notesEntryToTransactionInput(entry) {
  return {
    template: entry.template,
    amount: Number(entry.amount) || 0,
    currency: entry.currency,
    date: entry.date,
    description: entry.description,
    categoryId: entry.categoryId,
    primaryAccountId: entry.primaryAccountId,
    secondaryAccountId: '',
    note: 'Captured from Notes',
    sourceRoute: 'notes',
    allowDuplicate: entry.allowDuplicate === true,
    allowCurrencyConversion: entry.manuallyReviewed === true && Number(entry.fxRateToBase) > 0,
    fxRateToBase: Number(entry.fxRateToBase) || 0
  };
}
