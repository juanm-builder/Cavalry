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
  health: [
    'health',
    'medical',
    'medicine',
    'meds',
    'doctor',
    'clinic',
    'hospital',
    'pharmacy',
    'dental',
    'dentist'
  ],
  'personal care': [
    'personal care',
    'make up',
    'makeup',
    'cosmetic',
    'cosmetics',
    'beauty',
    'skincare',
    'skin care',
    'salon',
    'barber',
    'medicine',
    'meds',
    'pharmacy'
  ],
  beauty: [
    'beauty',
    'make up',
    'makeup',
    'cosmetic',
    'cosmetics',
    'skincare',
    'skin care',
    'salon'
  ],
  electronics: [
    'electronics',
    'electronic',
    'laptop',
    'computer',
    'gadget',
    'device',
    'airpods',
    'headphones',
    'appliance'
  ],
  shopping: [
    'shopping',
    'clothes',
    'clothing',
    'shoes',
    'mall',
    'department store',
    'shopee',
    'lazada'
  ],
  entertainment: ['entertainment', 'movie', 'movies', 'cinema', 'game', 'games'],
  travel: ['travel', 'flight', 'hotel', 'vacation'],
  education: ['education', 'school', 'tuition', 'book', 'books'],
  subscriptions: ['subscription', 'subscriptions', 'membership'],
  salary: ['salary', 'paycheck', 'payroll', 'wages'],
  income: ['income', 'received', 'earnings', 'revenue']
});

const BROAD_SHOPPING_ALIASES = Object.freeze([
  'make up',
  'makeup',
  'cosmetic',
  'cosmetics',
  'medicine',
  'meds',
  'pharmacy',
  'laptop',
  'computer',
  'electronics',
  'gadget',
  'device',
  'appliance'
]);

const SEMANTIC_CATEGORY_PREFERENCES = Object.freeze([
  {
    aliases: ['medicine', 'meds', 'pharmacy', 'doctor', 'clinic', 'hospital', 'dental', 'dentist'],
    categoryNames: ['health', 'medical', 'personal care']
  },
  {
    aliases: ['make up', 'makeup', 'cosmetic', 'cosmetics', 'skincare', 'skin care', 'salon'],
    categoryNames: ['beauty', 'personal care']
  },
  {
    aliases: ['laptop', 'computer', 'electronics', 'gadget', 'device', 'appliance'],
    categoryNames: ['electronics', 'shopping']
  }
]);

const GENERIC_CATEGORY_NAMES = Object.freeze([
  'uncategorized',
  'uncategorised',
  'general',
  'other',
  'random',
  'misc',
  'miscellaneous'
]);

const HISTORY_STOP_WORDS = new Set([
  'and',
  'card',
  'cash',
  'credit',
  'debit',
  'expense',
  'for',
  'from',
  'gcash',
  'into',
  'maya',
  'paid',
  'payment',
  'php',
  'purchase',
  'the',
  'this',
  'today',
  'transaction',
  'using',
  'wallet',
  'with',
  'yesterday'
]);

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

function uniqueBest(matches, scoreForMatch) {
  const ranked = matches
    .map((match) => ({ ...match, score: Number(scoreForMatch(match)) || 0 }))
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;
  const best = ranked.filter((candidate) => candidate.score === ranked[0].score);
  const ids = new Set(
    best.map((candidate) => asString(candidate.category && candidate.category.id))
  );
  return ids.size === 1 ? best[0] : { ...best[0], category: null, ambiguous: true };
}

function findCategoryFromRules(categories, description) {
  const matches = [];
  categories.forEach((category) => {
    asArray(category && category.autoCategorizeRules).forEach((rule) => {
      const field = normalize(rule && rule.field) || 'description';
      if (field !== 'description') return;
      const value = normalize(rule && rule.value);
      if (!value) return;
      const operator = normalize(rule && rule.operator).replace(/\s+/g, '_') || 'contains';
      const matched =
        operator === 'equals'
          ? description === value
          : operator === 'starts_with'
            ? description.startsWith(value)
            : containsPhrase(description, value) || description.includes(value);
      if (!matched) return;
      matches.push({
        category,
        matchedPhrase: value,
        priority: operator === 'equals' ? 3 : operator === 'starts_with' ? 2 : 1
      });
    });
  });
  return uniqueBest(matches, (match) => match.priority * 10000 + match.matchedPhrase.length);
}

function meaningfulTokens(value) {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 2 && !/^\d+$/.test(token) && !HISTORY_STOP_WORDS.has(token));
}

function historicalTransactionScore(transaction, description) {
  const prior = normalize(transaction && transaction.description);
  const requested = normalize(description);
  if (!prior || !requested) return 0;
  if (prior === requested) return 8;
  if (
    prior.length >= 4 &&
    requested.length >= 4 &&
    (prior.includes(requested) || requested.includes(prior))
  ) {
    return 5;
  }
  const priorTokens = new Set(meaningfulTokens(prior));
  const requestedTokens = meaningfulTokens(requested);
  if (!requestedTokens.length) return 0;
  const overlap = requestedTokens.filter((token) => priorTokens.has(token)).length;
  const denominator = new Set([...requestedTokens, ...priorTokens]).size || 1;
  const similarity = overlap / denominator;
  if (similarity >= 0.6) return 4;
  if (similarity >= 0.35) return 2;
  return 0;
}

function historicalWinner(workbook, description, valueForTransaction, allowedIds) {
  const totals = new Map();
  asArray(workbook && workbook.transactions).forEach((transaction) => {
    const value = asString(valueForTransaction(transaction));
    if (!value || !allowedIds.has(value)) return;
    const score = historicalTransactionScore(transaction, description);
    if (score < 4) return;
    const timestamp = Date.parse(`${asString(transaction && transaction.date)}T00:00:00Z`);
    const recencyWeight = Number.isFinite(timestamp) ? Math.max(0, timestamp / 1e15) : 0;
    totals.set(value, (totals.get(value) || 0) + score + recencyWeight);
  });
  const ranked = Array.from(totals.entries()).sort((left, right) => right[1] - left[1]);
  if (!ranked.length || (ranked[1] && ranked[0][1] - ranked[1][1] < 1)) return '';
  return ranked[0][0];
}

function impliedCategoryType(description) {
  return /\b(?:allowance|earned|earnings|income|paid\s+by|paycheck|payroll|received|revenue|salary|wages)\b/.test(
    description
  )
    ? 'income'
    : 'expense';
}

function findPreferredSemanticCategory(categories, description) {
  for (const preference of SEMANTIC_CATEGORY_PREFERENCES) {
    const matchedPhrase = preference.aliases
      .map(normalize)
      .filter((alias) => containsPhrase(description, alias))
      .sort((left, right) => right.length - left.length)[0];
    if (!matchedPhrase) continue;
    for (const preferredName of preference.categoryNames) {
      const matches = categories.filter((category) => {
        const categoryName = normalize(category && category.name);
        return categoryName === preferredName || containsPhrase(categoryName, preferredName);
      });
      if (matches.length) {
        return {
          category: matches.length === 1 ? matches[0] : null,
          matchedPhrase,
          ambiguous: matches.length > 1,
          source: 'semantic'
        };
      }
    }
  }
  return null;
}

function findCategory(workbook, description) {
  const categories = activeCategories(workbook);
  const direct = categories
    .map((category) => ({ category, phrase: normalize(category.name) }))
    .filter(({ phrase }) => phrase && containsPhrase(description, phrase))
    .sort((left, right) => right.phrase.length - left.phrase.length);

  if (direct.length) {
    const bestLength = direct[0].phrase.length;
    const best = direct.filter((candidate) => candidate.phrase.length === bestLength);
    const categoryIds = new Set(best.map((candidate) => asString(candidate.category.id)));
    return {
      category: categoryIds.size === 1 ? best[0].category : null,
      matchedPhrase: best[0].phrase,
      ambiguous: categoryIds.size > 1
    };
  }

  const ruleMatch = findCategoryFromRules(categories, description);
  if (ruleMatch) {
    return {
      category: ruleMatch.category,
      matchedPhrase: ruleMatch.matchedPhrase,
      ambiguous: ruleMatch.ambiguous === true,
      source: 'rule'
    };
  }

  const historicalId = historicalWinner(
    workbook,
    description,
    (transaction) => transaction && transaction.categoryId,
    new Set(categories.map((category) => asString(category.id)))
  );
  if (historicalId) {
    const historicalCategory = categories.find(
      (category) => asString(category.id) === historicalId
    );
    if (historicalCategory) {
      return {
        category: historicalCategory,
        matchedPhrase: '',
        ambiguous: false,
        source: 'history'
      };
    }
  }

  const semanticMatch = findPreferredSemanticCategory(categories, description);
  if (semanticMatch) return semanticMatch;

  const aliases = categories
    .flatMap((category) =>
      categoryAliasKeys(category.name).flatMap((key) =>
        CATEGORY_ALIASES[key]
          .map(normalize)
          .filter((alias) => containsPhrase(description, alias))
          .map((alias) => ({ category, alias, key }))
      )
    )
    .sort((left, right) => right.alias.length - left.alias.length);
  if (aliases.length) {
    const bestLength = aliases[0].alias.length;
    const best = aliases.filter((candidate) => candidate.alias.length === bestLength);
    const categoryIds = new Set(best.map((candidate) => asString(candidate.category.id)));
    return {
      category: categoryIds.size === 1 ? best[0].category : null,
      matchedPhrase: best[0].alias,
      ambiguous: categoryIds.size > 1
    };
  }

  const broadShoppingPhrase = BROAD_SHOPPING_ALIASES.map(normalize)
    .filter((alias) => containsPhrase(description, alias))
    .sort((left, right) => right.length - left.length)[0];
  if (broadShoppingPhrase) {
    const broadMatches = categories.filter((category) =>
      ['shopping', 'lifestyle', 'retail'].some((name) =>
        containsPhrase(normalize(category && category.name), name)
      )
    );
    if (broadMatches.length === 1) {
      return {
        category: broadMatches[0],
        matchedPhrase: broadShoppingPhrase,
        ambiguous: false,
        source: 'broad_semantic'
      };
    }
  }

  const expectedType = impliedCategoryType(description);
  const compatible = categories.filter((category) => category.type === expectedType);
  const generic = compatible
    .filter((category) => GENERIC_CATEGORY_NAMES.includes(normalize(category.name)))
    .sort(
      (left, right) =>
        GENERIC_CATEGORY_NAMES.indexOf(normalize(left.name)) -
        GENERIC_CATEGORY_NAMES.indexOf(normalize(right.name))
    )[0];
  const fallback = generic || (compatible.length === 1 ? compatible[0] : null) || null;
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

function preferredAccount(candidates, kind = '') {
  const sorted = [...candidates].sort((left, right) => {
    const leftName = normalize(left && left.name);
    const rightName = normalize(right && right.name);
    const expectedNames =
      kind === 'cash'
        ? ['cash']
        : kind === 'wallet'
          ? ['e wallet', 'wallet']
          : kind === 'credit_card'
            ? ['credit card']
            : [];
    const leftExact = expectedNames.includes(leftName) ? 1 : 0;
    const rightExact = expectedNames.includes(rightName) ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;
    return (
      leftName.localeCompare(rightName) ||
      asString(left && left.id).localeCompare(asString(right && right.id))
    );
  });
  return sorted[0] || null;
}

function primaryAccountIdFromTransaction(workbook, transaction) {
  const accountsById = new Map(
    balanceAccounts(workbook).map((account) => [asString(account.id), account])
  );
  const lines = asArray(transaction && transaction.lines);
  const template = asString(transaction && transaction.template);
  const expectedDirection = template === 'income_received' ? 'debit' : 'credit';
  const expectedGroups =
    template === 'expense_charged'
      ? ['liability']
      : template === 'income_received'
        ? ['asset']
        : ['asset'];
  const matched = lines.find((line) => {
    const account = accountsById.get(asString(line && line.accountId));
    return (
      line &&
      asString(line.direction) === expectedDirection &&
      account &&
      expectedGroups.includes(asString(account.group).toLowerCase())
    );
  });
  return asString(matched && matched.accountId);
}

function findPayment(workbook, normalizedLine, transactionKind, description = normalizedLine) {
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
    const historicalId = historicalWinner(
      workbook,
      description,
      (transaction) => primaryAccountIdFromTransaction(workbook, transaction),
      new Set(eligible.map((account) => asString(account.id)))
    );
    const historical = eligible.find((account) => asString(account.id) === historicalId) || null;
    if (historical) {
      return {
        account: historical,
        matchedPhrase: '',
        label: paymentLabel(historical),
        kind: paymentKind(historical),
        ambiguous: false,
        missing: false,
        unavailable: false,
        source: 'history'
      };
    }
    const cash = eligible.filter(isCashAccount);
    const exactCash = cash.filter((account) => normalize(account && account.name) === 'cash');
    candidates = exactCash.length
      ? exactCash
      : cash.length === 1
        ? cash
        : eligible.length === 1
          ? eligible
          : [];
  }

  const selectedAccount = preferredAccount(candidates, paymentPattern?.kind || '');

  return {
    account: selectedAccount,
    matchedPhrase: paymentPattern ? normalize(paymentPattern.label) : '',
    label:
      paymentPattern?.label || (selectedAccount ? paymentLabel(selectedAccount) : 'Not selected'),
    kind: paymentPattern?.kind || (selectedAccount ? paymentKind(selectedAccount) : ''),
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
      /(?:₱|PHP\s*)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)([km])?|(?:US\$|\$|USD\s*)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)([km])?|(?:^|\s)([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)([km])?(?=\s|$)/gi
    )
  );
  const match = matches[0];
  if (!match) return { amount: 0, currency: workbookCurrency, matchedText: '' };
  const rawNumber = match[1] || match[3] || match[5] || '';
  const suffix = asString(match[2] || match[4] || match[6]).toLowerCase();
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
  const amount = Number(rawNumber.replace(/,/g, '')) * multiplier;
  const marker = match[0].toUpperCase();
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currency: match[1]
      ? 'PHP'
      : match[3] || marker.includes('$') || marker.includes('USD')
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
  const paymentPattern = PAYMENT_PATTERNS.find((candidate) => candidate.pattern.test(sourceText));
  const paymentPhrase = paymentPattern?.pattern.exec(sourceText)?.[0] || '';
  const preliminaryDescription = buildDescription(
    sourceText,
    amountResult.matchedText,
    dateResult.matchedText,
    paymentPhrase
  );
  const normalizedDescription = normalize(preliminaryDescription);
  const categoryResult = findCategory(workbook, normalizedDescription || normalizedLine);
  const transactionKind = categoryResult.category?.type === 'income' ? 'income' : 'expense';
  const paymentResult = findPayment(
    workbook,
    normalizedLine,
    transactionKind,
    normalizedDescription || normalizedLine
  );
  const description = buildDescription(
    sourceText,
    amountResult.matchedText,
    dateResult.matchedText,
    paymentPhrase || paymentResult.matchedPhrase
  );
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
  if (categoryResult.ambiguous) {
    inferenceIssues.push(
      issue('category_ambiguous', 'categoryId', 'More than one category matched this line.')
    );
  } else if (!categoryResult.category || categoryResult.fallback) {
    inferenceIssues.push(
      issue(
        'category_uncertain',
        'categoryId',
        categoryResult.category
          ? `Check whether ${categoryResult.category.name} is the right category.`
          : 'Choose a category.'
      )
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
    transactionId: asString(entry.transactionId),
    template: entry.template,
    amount: Number(entry.amount) || 0,
    currency: entry.currency,
    date: entry.date,
    description: entry.description,
    categoryId: entry.categoryId,
    primaryAccountId: entry.primaryAccountId,
    secondaryAccountId: '',
    counterpartyId: asString(entry.counterpartyId),
    note: asString(entry.transactionNote) || 'Captured from Notes',
    sourceRoute: 'notes',
    // Notes is intentionally one-step intake: duplicate-looking lines are saved and remain
    // editable instead of introducing a second confirmation/approval gate.
    allowDuplicate: entry.allowDuplicate !== false,
    allowCurrencyConversion: Number(entry.fxRateToBase) > 0,
    fxRateToBase: Number(entry.fxRateToBase) || 0
  };
}
