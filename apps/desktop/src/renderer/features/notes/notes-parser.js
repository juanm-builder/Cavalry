import { validateNotesEntryFields } from './notes-entry-validation.js';
import { matchNotesAccounts, parseNotesTransfer } from './notes-transfer-parser.js';
import { prepareNotesSources } from './notes-source.js';
import {
  notesIntentIssues,
  parseNotesAmount,
  parseNotesDate,
  unsupportedNotesIntent
} from './notes-value-parser.js';

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

function oneLetterApart(left, right) {
  if (left === right) return false;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === right[index]) continue;
    return left.length === right.length
      ? left.slice(index + 1) === right.slice(index + 1) ||
          (left[index] === right[index + 1] &&
            left[index + 1] === right[index] &&
            left.slice(index + 2) === right.slice(index + 2))
      : left.length > right.length
        ? left.slice(index + 1) === right.slice(index)
        : left.slice(index) === right.slice(index + 1);
  }
  return true;
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

  const typoMatches = categories.flatMap((category) => {
    const phrases = [
      normalize(category.name),
      ...categoryAliasKeys(category.name).flatMap((key) => CATEGORY_ALIASES[key])
    ];
    return phrases
      .filter((phrase) => phrase.length >= 5 && !phrase.includes(' '))
      .flatMap((phrase) =>
        description
          .split(' ')
          .filter(
            (word) =>
              word.length >= 5 &&
              Math.abs(word.length - phrase.length) <= 1 &&
              oneLetterApart(word, phrase)
          )
          .map((word) => ({ category, matchedPhrase: word }))
      );
  });
  if (new Set(typoMatches.map((match) => match.category.id)).size === 1)
    return { ...typoMatches[0], typo: true };

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
  const incomeDestination =
    transactionKind === 'income' && /\b(?:to|into)\s+(.+)$/.exec(normalizedLine);
  if (incomeDestination) {
    const matches = matchNotesAccounts(
      incomeDestination[1],
      accounts.filter((account) => account.group === 'asset')
    );
    return {
      account: matches.length === 1 ? matches[0] : null,
      matchedPhrase: incomeDestination[1],
      label: matches.length === 1 ? paymentLabel(matches[0]) : 'Destination',
      ambiguous: matches.length > 1,
      unavailable: matches.length === 0
    };
  }
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
    .replace(/\b(?:today|yesterday|paid with|paid via|paid using)\b/gi, ' ')
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
  return validateNotesEntryFields(workbook, entry, {
    categories: activeCategories(workbook),
    accounts: balanceAccounts(workbook),
    isCreditCardAccount
  });
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
  const isTransfer = entry.template === 'transfer';
  const destination = accounts.find(
    (candidate) => asString(candidate.id) === asString(entry.secondaryAccountId)
  );
  const transferDescription = `Transfer: ${account?.name || 'Choose source'} → ${destination?.name || 'Choose destination'}${entry.transferMemo ? ` · ${entry.transferMemo}` : ''}`;
  const structuralIssues = validateNotesEntry(workbook, entry);
  return {
    ...entry,
    amount: Number(entry.amount) || 0,
    currency: asString(entry.currency || workbook?.currency || 'PHP').toUpperCase(),
    description:
      isTransfer && entry.autoTransferDescription
        ? transferDescription
        : asString(entry.description).trim() || 'Transaction from Notes',
    categoryId: isTransfer ? '' : entry.categoryId,
    categoryName: isTransfer ? 'Transfer' : category?.name || 'Choose category',
    categoryColor: isTransfer ? '' : category?.color || '',
    categoryIcon: isTransfer ? '' : category?.icon || '',
    paymentLabel: account ? paymentLabel(account) : 'Choose account',
    template: isTransfer ? 'transfer' : resolveTemplate(category, account),
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
  const sourceText = asString(options.sourceText || line).trim();
  const parsingText = asString(line).trim();
  const workbookCurrency = asString(workbook && workbook.currency).toUpperCase() || 'PHP';
  const today =
    typeof options.today === 'function' ? asString(options.today()) : asString(options.today);
  const explicitDate = parseNotesDate(parsingText, today);
  const dateResult = explicitDate.explicit ? explicitDate : options.dateContext || explicitDate;
  const amountSource = explicitDate.matchedTexts.reduce(
    (value, phrase) => removePhrase(value, phrase),
    parsingText
  );
  const amountResult = parseNotesAmount(amountSource, workbookCurrency);
  const transferResult = parseNotesTransfer(parsingText, balanceAccounts(workbook));
  const normalizedLine = normalize(parsingText);
  const paymentPattern = PAYMENT_PATTERNS.find((candidate) => candidate.pattern.test(parsingText));
  const paymentPhrase = paymentPattern?.pattern.exec(parsingText)?.[0] || '';
  const preliminaryDescription = buildDescription(
    parsingText,
    ...amountResult.matchedTexts,
    ...explicitDate.matchedTexts,
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
    parsingText,
    ...amountResult.matchedTexts,
    ...explicitDate.matchedTexts,
    paymentPhrase || paymentResult.matchedPhrase
  );
  const inferenceIssues = notesIntentIssues(parsingText).filter(
    (item) =>
      !(
        transferResult &&
        item.code === 'correction_review' &&
        !/\b(?:actually|correction|corrected|instead|not\s+\d|(?:should|meant)\s+(?:be|to)|cancel(?:led)?|void(?:ed)?)\b|~~/i.test(
          parsingText
        )
      )
  );
  if (transferResult) inferenceIssues.push(...transferResult.issues);
  const suggestedFxRate =
    amountResult.currency === 'USD' && workbookCurrency !== 'USD'
      ? Number(asObject(workbook && workbook.settings).usdToBaseRate) || 0
      : 0;

  if (dateResult.ambiguous)
    inferenceIssues.push(
      issue(
        'date_ambiguous',
        'date',
        'Choose the date; this note has an ambiguous or conflicting date.'
      )
    );
  if (dateResult.future)
    inferenceIssues.push(
      issue(
        'date_future_review',
        'date',
        'This date is in the future. Check whether this transaction has happened.'
      )
    );
  if (amountResult.invalid || amountResult.signed)
    inferenceIssues.push(
      issue('amount_format_review', 'amount', 'Check the amount format or sign before recording.')
    );
  if (amountResult.approximate)
    inferenceIssues.push(
      issue('amount_approximate', 'amount', 'Check the exact amount before recording.')
    );
  if (amountResult.ambiguous) {
    inferenceIssues.push(
      issue(
        'amount_ambiguous',
        'amount',
        'Check the amount; this note has multiple amounts or an ambiguous separator.'
      )
    );
  } else if (!amountResult.amount) {
    inferenceIssues.push(issue('amount_missing', 'amount', 'Cavalry could not find an amount.'));
  }
  if (!transferResult && categoryResult.typo)
    inferenceIssues.push(
      issue(
        'category_typo_review',
        'categoryId',
        `Check whether ${categoryResult.category.name} matches the spelling in your note.`
      )
    );
  if (!transferResult && categoryResult.ambiguous) {
    inferenceIssues.push(
      issue('category_ambiguous', 'categoryId', 'More than one category matched this line.')
    );
  } else if (!transferResult && (!categoryResult.category || categoryResult.fallback)) {
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
  if (!transferResult && paymentResult.unavailable) {
    inferenceIssues.push(
      issue(
        'payment_unavailable',
        'primaryAccountId',
        `${paymentResult.label} does not match an account in this workbook.`
      )
    );
  } else if (!transferResult && paymentResult.missing) {
    inferenceIssues.push(
      issue('payment_unspecified', 'primaryAccountId', 'Check the payment account.')
    );
  } else if (!transferResult && paymentResult.ambiguous) {
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
    sourceLineNumbers: options.sourceLineNumbers || [Number(options.lineNumber) || 1],
    sourceContext: options.dateContext
      ? {
          date: options.dateContext.date,
          text: options.dateContext.text,
          lineNumber: options.dateContext.lineNumber
        }
      : null,
    sourceText,
    autoTransferDescription: !!transferResult,
    transferMemo: transferResult
      ? /\b(?:for|memo:|note:)\s+(.+)$/i.exec(parsingText)?.[1]?.trim() || ''
      : '',
    unsupportedIntent: unsupportedNotesIntent(parsingText),
    amount: amountResult.amount,
    currency: amountResult.currency,
    fxRateToBase: suggestedFxRate,
    date: dateResult.date,
    description,
    categoryId: asString(categoryResult.category?.id),
    categoryName: categoryResult.category?.name || 'Choose category',
    categoryColor: categoryResult.category?.color || '',
    categoryIcon: categoryResult.category?.icon || '',
    primaryAccountId: transferResult
      ? transferResult.primaryAccountId
      : asString(paymentResult.account?.id),
    secondaryAccountId: transferResult?.secondaryAccountId || '',
    paymentLabel: paymentResult.account
      ? paymentResult.label || paymentLabel(paymentResult.account)
      : paymentResult.label || 'Choose account',
    template: transferResult
      ? 'transfer'
      : resolveTemplate(categoryResult.category, paymentResult.account),
    issues: inferenceIssues,
    manuallyReviewed: false
  };
  return resolveNotesEntry(workbook, parsed, { keepInferenceIssues: true });
}

export function parseNotesText(text, workbook, options = {}) {
  const today = typeof options.today === 'function' ? options.today() : options.today;
  return prepareNotesSources(text, { today, currency: workbook?.currency || 'PHP' }).map((source) =>
    parseNotesLine(source.parseText, workbook, {
      ...options,
      ...source,
      id: `notes-line-${source.lineNumber}${source.segmentIndex ? `-${source.segmentIndex + 1}` : ''}`
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
    secondaryAccountId: asString(entry.secondaryAccountId),
    counterpartyId: asString(entry.counterpartyId),
    note:
      asString(entry.transactionNote) ||
      (entry.template === 'transfer'
        ? `Captured from Notes\n${asString(entry.sourceText)}`
        : 'Captured from Notes'),
    sourceRoute: 'notes',
    // Existing ledger matches require Notes review; repeated lines in this reviewed batch
    // remain separate transactions.
    allowDuplicate: entry.allowDuplicate !== false,
    allowCurrencyConversion: Number(entry.fxRateToBase) > 0,
    fxRateToBase: Number(entry.fxRateToBase) || 0
  };
}
