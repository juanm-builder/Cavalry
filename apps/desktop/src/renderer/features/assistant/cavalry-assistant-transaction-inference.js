import {
  ADVISOR_FINANCE_INTENT_KINDS,
  classifyAdvisorFinanceIntent,
  extractAdvisorAmountMentions,
  inferAdvisorCategoryNameFromPrompt,
  inferAdvisorCounterpartyNameFromPrompt,
  inferAdvisorDescriptionFromPrompt
} from '@cavalry/advisor/domain/advisor/transaction-drafts.js';
import { splitAdvisorTransactionPrompts } from '@cavalry/advisor/domain/advisor/transaction-prompt-splitter.js';
import { getLedgerTransactionTemplateConfig } from '@cavalry/finance-core';
import {
  cavalryAssistantAccountResolutionError,
  resolveCavalryAssistantAccount,
  resolveCavalryAssistantTransactionAccount
} from './cavalry-assistant-entity-resolution.js';

function templateConfig(template) {
  return getLedgerTransactionTemplateConfig(asText(template));
}

function templateCategoryTypes(template) {
  return asArray(templateConfig(template).categoryTypes);
}

function templatePrimaryAccountGroups(template) {
  return asArray(templateConfig(template).primaryGroups);
}

function templateSecondaryAccountGroups(template) {
  return asArray(templateConfig(template).secondaryGroups);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(asObject(value), key);
}

function hasNonBlankArgument(args, keys) {
  return asArray(keys).some((key) => hasOwn(args, key) && !!asText(args[key]));
}

function removeBlankOptionalEntityArguments(args) {
  [
    'category',
    'categoryId',
    'primaryAccount',
    'primaryAccountId',
    'secondaryAccount',
    'secondaryAccountId',
    'counterparty',
    'counterpartyId',
    'counterpartyName'
  ].forEach((key) => {
    if (hasOwn(args, key) && !asText(args[key])) {
      delete args[key];
    }
  });
}

function textKey(value) {
  return asText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulTokens(value) {
  return textKey(value)
    .split(' ')
    .filter(
      (token) =>
        token.length > 2 &&
        ![
          'and',
          'for',
          'from',
          'into',
          'paid',
          'payment',
          'purchase',
          'the',
          'this',
          'transaction',
          'using',
          'with'
        ].includes(token)
    );
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function localArgumentText(args) {
  return [
    args.description,
    args.note,
    args.counterpartyName,
    args.category,
    args.primaryAccount,
    args.secondaryAccount
  ]
    .map(asText)
    .filter(Boolean)
    .join(' ');
}

function transactionSegmentScore(segment, args, currentDate) {
  const decision = classifyAdvisorFinanceIntent(segment, { currentDate });
  const requestedAmount = Number(args.amount) || 0;
  const requestedTemplate = asText(args.template);
  const segmentTokens = new Set(meaningfulTokens(segment));
  const descriptionTokens = meaningfulTokens(args.description);
  let score = 0;

  if (requestedAmount > 0) {
    if (Math.abs(Number(decision.amount) - requestedAmount) < 0.005) score += 30;
    else if (decision.amount > 0) score -= 30;
  }
  const descriptionKey = textKey(args.description);
  if (descriptionKey && textKey(segment).includes(descriptionKey)) score += 40;
  descriptionTokens.forEach((token) => {
    if (segmentTokens.has(token)) score += 10;
  });
  [
    args.category,
    args.categoryId,
    args.primaryAccount,
    args.primaryAccountId,
    args.secondaryAccount,
    args.secondaryAccountId,
    args.counterparty,
    args.counterpartyName
  ].forEach((reference) => {
    if (asText(reference) && textKey(segment).includes(textKey(reference))) score += 12;
  });
  if (requestedTemplate && decision.template) {
    score += requestedTemplate === decision.template ? 4 : -4;
  }
  return { segment, score };
}

function transactionActionPrefix(prompt, firstAmountStart) {
  const source = asText(prompt).slice(0, Math.max(0, firstAmountStart));
  const matches = [
    ...source.matchAll(
      /\b(?:i\s+)?(?:received|got\s+paid|was\s+paid|paid|spent|bought|purchased|charged|transferred|moved|sent)\b/gi
    )
  ];
  return asText(matches.at(-1)?.[0]) || 'I paid';
}

function transactionActionFamily(value) {
  const matches = [
    ...String(value || '').matchAll(
      /\b(?:received|got\s+paid|was\s+paid|paid|spent|bought|purchased|charged|transferred|moved|sent)\b/gi
    )
  ];
  const action = textKey(matches.at(-1)?.[0]);
  if (['received', 'got paid', 'was paid'].includes(action)) return 'income';
  if (action === 'charged') return 'card_charge';
  if (['transferred', 'moved', 'sent'].includes(action)) return 'transfer';
  if (['paid', 'spent', 'bought', 'purchased'].includes(action)) return 'expense';
  return '';
}

function transactionClauseSeparator(text, useLast = false) {
  const matches = [...String(text || '').matchAll(/\b(?:and|then|plus)\b|[;,\n]|[.!?](?=\s|$)/gi)];
  return useLast ? matches.at(-1) || null : matches[0] || null;
}

function trailingActionContext(prompt, mentions) {
  if (mentions.length < 2) return { repeated: false, changesIntent: false };
  const raw = String(prompt || '');
  const firstFamily = transactionActionFamily(raw.slice(0, mentions[0].start));
  const trailingFamily = transactionActionFamily(
    raw.slice(mentions.at(-2).end, mentions.at(-1).start)
  );
  return {
    repeated: !!trailingFamily,
    changesIntent: !!(firstFamily && trailingFamily && firstFamily !== trailingFamily)
  };
}

function sharedPostingTail(prompt, lastAmountEnd) {
  const tail = String(prompt || '').slice(Math.max(0, lastAmountEnd));
  const match =
    /\b(?:from|using|with|on|to|into|toward|towards|in)\s+(?:my\s+|the\s+)?[^,.;!?]+?(?=\s+\b(?:today|yesterday|tomorrow)\b|$)/i.exec(
      tail
    );
  return asText(match && match[0]);
}

function segmentHasPostingReference(segment, postingTail) {
  const cue = /^(?:from|using|with|on|to|into|toward|towards|in)\b/i.exec(postingTail)?.[0];
  if (!cue) return false;
  const dateValue =
    '(?:today|yesterday|tomorrow|january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec|\\d)';
  const dateGuard = /^(?:on|in)$/i.test(cue) ? `(?!${dateValue})` : '';
  return new RegExp(`\\b${escapeRegExp(cue)}\\s+(?:my\\s+|the\\s+)?${dateGuard}\\S+`, 'i').test(
    asText(segment)
  );
}

function explicitDateCuePositions(prompt) {
  const expression =
    /\b(?:today|yesterday|tomorrow|\d{4}-\d{1,2}-\d{1,2}|(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+\d{1,2}(?:,\s*\d{4})?)\b/gi;
  return [...String(prompt || '').matchAll(expression)].map((match) => match.index || 0);
}

function entityMentionSpans(workbook, prompt) {
  const spans = [];
  [
    ...asArray(workbook && workbook.accounts),
    ...asArray(workbook && workbook.categories),
    ...asArray(workbook && workbook.counterparties)
  ].forEach((item) => {
    const name = asText(item && item.name);
    if (!name || !/\d/.test(name)) return;
    const pattern = accountNamePattern(name);
    if (!pattern) return;
    const expression = new RegExp(`(?:^|\\b)${pattern}(?=\\b|$)`, 'gi');
    for (const match of String(prompt || '').matchAll(expression)) {
      spans.push({
        start: match.index || 0,
        end: (match.index || 0) + match[0].length
      });
    }
  });
  return spans;
}

function transactionAmountMentions(workbook, prompt) {
  const mentions = extractAdvisorAmountMentions(prompt);
  const entitySpans = entityMentionSpans(workbook, prompt);
  if (!entitySpans.length) return mentions;
  return mentions.filter(
    (mention) => !entitySpans.some((span) => mention.start >= span.start && mention.end <= span.end)
  );
}

function amountLocalSegments(prompt, mentions, currentDate) {
  const raw = String(prompt || '');
  const actionPrefix = transactionActionPrefix(raw, mentions[0]?.start);
  const trailingAction = trailingActionContext(raw, mentions);
  const postingTail = trailingAction.changesIntent
    ? ''
    : sharedPostingTail(raw, mentions.at(-1)?.end);
  const dateCuePositions = explicitDateCuePositions(raw);
  const sharedDate =
    dateCuePositions.length === 1 &&
    (dateCuePositions[0] < mentions[0].start ||
      (dateCuePositions[0] > mentions.at(-1).end && !trailingAction.repeated))
      ? classifyAdvisorFinanceIntent(raw, { currentDate }).date
      : '';

  return mentions.map((mention, index) => {
    const previous = mentions[index - 1];
    const next = mentions[index + 1];
    let start = 0;
    let end = raw.length;
    if (previous) {
      const between = raw.slice(previous.end, mention.start);
      const separator = transactionClauseSeparator(between, true);
      start = separator ? previous.end + separator.index + separator[0].length : mention.start;
    }
    if (next) {
      const between = raw.slice(mention.end, next.start);
      const separator = transactionClauseSeparator(between, false);
      end = separator ? mention.end + separator.index : next.start;
    }
    let segment = asText(raw.slice(start, end));
    if (
      !/\b(?:received|got\s+paid|was\s+paid|paid|spent|bought|purchased|charged|transferred|moved|sent)\b/i.test(
        segment
      )
    ) {
      segment = `${actionPrefix} ${segment}`.trim();
    }
    if (
      postingTail &&
      !textKey(segment).includes(textKey(postingTail)) &&
      !segmentHasPostingReference(segment, postingTail)
    ) {
      segment = `${segment} ${postingTail}`.trim();
    }
    const segmentDate = classifyAdvisorFinanceIntent(segment, { currentDate }).date;
    if (sharedDate && !segmentDate) segment = `${sharedDate} ${segment}`.trim();
    return segment;
  });
}

function transactionLocalQuestion(workbook, question, args, currentDate) {
  const prompt = asText(question);
  if (!prompt) return '';
  const rawAmountMentions = extractAdvisorAmountMentions(prompt);
  const amountMentions = transactionAmountMentions(workbook, prompt);
  const segments =
    amountMentions.length > 1
      ? amountLocalSegments(prompt, amountMentions, currentDate)
      : rawAmountMentions.length !== amountMentions.length
        ? [prompt]
        : splitAdvisorTransactionPrompts(prompt, { currentDate });
  if (segments.length <= 1) return prompt;
  const ranked = segments
    .map((segment) => transactionSegmentScore(segment, args, currentDate))
    .sort((left, right) => right.score - left.score);
  if (!ranked.length || ranked[0].score <= 0) return '';
  if (ranked[1] && ranked[0].score === ranked[1].score) return '';
  return ranked[0].segment;
}

function templateFromSemanticDecision(decision, requestedTemplate) {
  const requested = asText(requestedTemplate);
  if (decision.kind === ADVISOR_FINANCE_INTENT_KINDS.REFUND) {
    return 'merchant_refund';
  }
  if (decision.kind === ADVISOR_FINANCE_INTENT_KINDS.LIABILITY_PAYMENT) {
    return 'debt_payment';
  }
  if (decision.kind === ADVISOR_FINANCE_INTENT_KINDS.CARD_CHARGE) {
    return ['expense_paid', 'expense_charged', ''].includes(requested)
      ? 'expense_charged'
      : requested;
  }
  if (decision.kind === ADVISOR_FINANCE_INTENT_KINDS.TRANSFER) {
    return ['expense_paid', ''].includes(requested) ? 'transfer' : requested;
  }
  if (decision.kind === ADVISOR_FINANCE_INTENT_KINDS.INCOME) {
    return ['expense_paid', ''].includes(requested) ? 'income_received' : requested;
  }
  return requested || decision.template || 'expense_paid';
}

function userPromptHasExplicitTemplateCue(prompt, decision) {
  if (!asText(prompt) || !asText(decision && decision.template)) return false;
  if (decision.kind !== ADVISOR_FINANCE_INTENT_KINDS.PURCHASE) return true;
  return /\b(?:paid|spent|buy|bought|purchase|purchased|expense|bill)\b/i.test(prompt);
}

function activeCategories(workbook, types) {
  return asArray(workbook && workbook.categories).filter(
    (category) =>
      category &&
      category.isActive !== false &&
      (!types.length || types.includes(asText(category.type)))
  );
}

function activeAccounts(workbook, groups) {
  return asArray(workbook && workbook.accounts).filter(
    (account) =>
      account &&
      account.isActive !== false &&
      account.isSystem !== true &&
      (!groups.length || groups.includes(asText(account.group)))
  );
}

function exactEntity(items, reference) {
  const key = textKey(reference);
  if (!key) return null;
  const matches = asArray(items).filter(
    (item) => textKey(item && item.id) === key || textKey(item && item.name) === key
  );
  return matches.length === 1 ? matches[0] : null;
}

function mentionIsNegated(prompt, mentionStart) {
  const prefix = String(prompt || '').slice(Math.max(0, mentionStart - 80), mentionStart);
  return /\b(?:do\s+not|don'?t|not|never|except|excluding|without|instead\s+of|rather\s+than)\s+(?:(?:from|using|with|via|out\s+of|on|to|into|toward|towards|in|use|for|under|as)\s+)?(?:my\s+|the\s+)?$/i.test(
    prefix
  );
}

function explicitlyMentionedCategory(items, prompt) {
  const raw = String(prompt || '');
  const directMatches = asArray(items).filter((item) => {
    const name = accountNamePattern(item && item.name);
    if (!name) return false;
    const patterns = [
      new RegExp(
        `\\b(?:for|under|as|category(?:\\s+(?:is|as))?|categor(?:ize|ized)\\s+as)\\s+(?:my\\s+|the\\s+)?${name}(?:\\b|$)`,
        'gi'
      ),
      new RegExp(
        `\\b(?:use|choose|select)\\s+(?:my\\s+|the\\s+)?${name}(?:\\s+category)?(?:\\b|$)`,
        'gi'
      )
    ];
    return patterns.some((expression) =>
      [...raw.matchAll(expression)].some((match) => {
        const categoryStart =
          (match.index || 0) +
          match[0].toLowerCase().lastIndexOf(asText(item && item.name).toLowerCase());
        const trailing = raw.slice(
          (match.index || 0) + match[0].length,
          (match.index || 0) + match[0].length + 20
        );
        return (
          !mentionIsNegated(raw, Math.max(match.index || 0, categoryStart)) &&
          !/^\s+budget\b/i.test(trailing)
        );
      })
    );
  });
  const conjunctiveMatches = directMatches.length
    ? asArray(items).filter((item) => {
        if (directMatches.includes(item)) return false;
        const name = accountNamePattern(item && item.name);
        if (!name) return false;
        const expression = new RegExp(`\\b(?:and|or)\\s+${name}(?:\\b|$)`, 'gi');
        return [...raw.matchAll(expression)].some(
          (match) => !mentionIsNegated(raw, match.index || 0)
        );
      })
    : [];
  const matches = [...directMatches, ...conjunctiveMatches];
  return {
    item: matches.length === 1 ? matches[0] : null,
    ambiguous: matches.length > 1
  };
}

function accountNamePattern(name) {
  const tokens = asText(name).split(/\s+/).filter(Boolean).map(escapeRegExp);
  return tokens.length ? tokens.join('\\s+') : '';
}

function liabilityDescriptor(account) {
  return textKey([account && account.name, account && account.subtype].filter(Boolean).join(' '));
}

function isCardAccount(account) {
  return /\b(?:credit\s+card|card|visa|mastercard|amex)\b/.test(liabilityDescriptor(account));
}

function explicitlySelectedLiabilityAccount(workbook, args, prompt) {
  const resolved = resolveCavalryAssistantAccount(workbook, {
    reference: asText(args.primaryAccountId || args.primaryAccount),
    prompt,
    groups: ['liability'],
    role: 'charged'
  });
  return (
    resolved.status === 'resolved' ||
    resolved.status === 'ambiguous' ||
    /\b(?:credit\s+card|card|visa|mastercard|amex|jcb)\b/.test(textKey(prompt))
  );
}

function categoryFromRules(categories, descriptionText) {
  const key = textKey(descriptionText);
  if (!key) return null;
  const matches = [];
  categories.forEach((category) => {
    asArray(category && category.autoCategorizeRules).forEach((rule) => {
      const field = asText(rule && rule.field).toLocaleLowerCase() || 'description';
      if (field !== 'description') return;
      const value = textKey(rule && rule.value);
      if (!value) return;
      const operator = asText(rule && rule.operator).toLocaleLowerCase();
      const matched = operator === 'starts_with' ? key.startsWith(value) : key.includes(value);
      if (matched) matches.push({ category, specificity: value.length });
    });
  });
  matches.sort((left, right) => right.specificity - left.specificity);
  if (!matches.length) return null;
  const mostSpecific = matches.filter((match) => match.specificity === matches[0].specificity);
  const ids = new Set(mostSpecific.map((match) => asText(match.category && match.category.id)));
  return ids.size === 1 ? mostSpecific[0].category : null;
}

function transactionCategoryEvidenceText(prompt, categories) {
  let evidence = asText(prompt)
    .replace(
      /\b(?:after|before|while)\s+(?:checking|reviewing|viewing|opening|looking\s+(?:at|over))\b[\s\S]*$/i,
      ''
    )
    .replace(
      /\b(?:check|review|view|open|look\s+(?:at|over))(?:ing)?\s+(?:my\s+|the\s+)?[^,.;!?]{1,80}\bbudget\b/gi,
      ''
    )
    .trim();
  asArray(categories).forEach((category) => {
    const name = accountNamePattern(category && category.name);
    if (!name) return;
    evidence = evidence.replace(new RegExp(`\\b${name}\\s+budget\\b`, 'gi'), '');
  });
  return evidence.trim();
}

function transactionAccountId(workbook, transaction, template) {
  const accountById = new Map(
    asArray(workbook && workbook.accounts).map((account) => [
      asText(account && account.id),
      account
    ])
  );
  const lines = asArray(transaction && transaction.lines);
  const find = (direction, groups) =>
    lines.find((line) => {
      const account = accountById.get(asText(line && line.accountId));
      return (
        line && line.direction === direction && account && groups.includes(asText(account.group))
      );
    });
  if (template === 'income_received') return asText(find('debit', ['asset'])?.accountId);
  if (template === 'merchant_refund') {
    return asText(find('debit', ['asset', 'liability'])?.accountId);
  }
  if (template === 'expense_charged') return asText(find('credit', ['liability'])?.accountId);
  if (template === 'debt_payment' || template === 'liability_payment') {
    return asText(find('credit', ['asset'])?.accountId);
  }
  if (template === 'transfer') return asText(find('credit', ['asset', 'liability'])?.accountId);
  return asText(find('credit', ['asset'])?.accountId);
}

function transactionSecondaryAccountId(workbook, transaction, template) {
  if (!['transfer', 'debt_payment', 'liability_payment'].includes(template)) return '';
  const accountById = new Map(
    asArray(workbook && workbook.accounts).map((account) => [
      asText(account && account.id),
      account
    ])
  );
  const allowedGroups = templateSecondaryAccountGroups(template);
  const line = asArray(transaction && transaction.lines).find((candidate) => {
    const account = accountById.get(asText(candidate && candidate.accountId));
    return (
      candidate &&
      candidate.direction === 'debit' &&
      account &&
      allowedGroups.includes(asText(account.group))
    );
  });
  return asText(line && line.accountId);
}

function historicalTransactionScore(transaction, context) {
  const transactionDescription = textKey(transaction && transaction.description);
  const requestedDescription = textKey(context.description);
  const transactionTokens = new Set(meaningfulTokens(transactionDescription));
  const requestedTokens = meaningfulTokens(requestedDescription);
  let score = 0;
  if (
    context.counterpartyId &&
    asText(transaction && transaction.counterpartyId) === context.counterpartyId
  ) {
    score += 10;
  }
  if (transactionDescription && requestedDescription) {
    if (transactionDescription === requestedDescription) {
      score += 8;
    } else if (
      transactionDescription.length >= 4 &&
      requestedDescription.length >= 4 &&
      (transactionDescription.includes(requestedDescription) ||
        requestedDescription.includes(transactionDescription))
    ) {
      score += 5;
    } else if (requestedTokens.length) {
      const overlap = requestedTokens.filter((token) => transactionTokens.has(token)).length;
      const denominator = new Set([...requestedTokens, ...transactionTokens]).size || 1;
      const similarity = overlap / denominator;
      if (similarity >= 0.6) score += 4;
      else if (similarity >= 0.35) score += 2;
    }
  }
  return score;
}

function historicalWinner(workbook, context, valueForTransaction, allowedIds) {
  const totals = new Map();
  asArray(workbook && workbook.transactions).forEach((transaction) => {
    const value = asText(valueForTransaction(transaction));
    if (!value || !allowedIds.has(value)) return;
    const score = historicalTransactionScore(transaction, context);
    if (score < 4) return;
    const dateWeight = Math.max(0, Date.parse(`${asText(transaction.date)}T00:00:00Z`) || 0) / 1e15;
    totals.set(value, (totals.get(value) || 0) + score + dateWeight);
  });
  const ranked = Array.from(totals.entries()).sort((left, right) => right[1] - left[1]);
  if (!ranked.length) return '';
  if (ranked[1] && ranked[0][1] - ranked[1][1] < 1) return '';
  return ranked[0][0];
}

function resolveCounterpartyId(workbook, args, prompt = '') {
  const reference =
    asText(args.counterpartyId || args.counterparty) || asText(args.counterpartyName);
  const counterparties = asArray(workbook && workbook.counterparties);
  const explicit = exactEntity(counterparties, reference);
  if (explicit) return asText(explicit.id);
  const inferredName = inferAdvisorCounterpartyNameFromPrompt(workbook || {}, prompt);
  return asText(exactEntity(counterparties, inferredName)?.id);
}

function inferCategory(workbook, args, template, prompt, userPrompt = prompt) {
  const types = templateCategoryTypes(template);
  if (!types.length) return null;
  const categories = activeCategories(workbook, types);
  if (!categories.length) return null;

  const mentioned = explicitlyMentionedCategory(categories, userPrompt);
  if (mentioned.ambiguous) return null;
  if (mentioned.item) return { item: mentioned.item, reason: 'explicit_category_mention' };

  const userInferredName = inferAdvisorCategoryNameFromPrompt(
    workbook || {},
    transactionCategoryEvidenceText(userPrompt, categories),
    template
  );
  const userSemantic = exactEntity(categories, userInferredName);
  if (userSemantic) {
    return {
      item: userSemantic,
      reason: 'transaction_semantics',
      userAuthoritative: true
    };
  }

  const byRule = categoryFromRules(categories, asText(args.description));
  if (byRule) return { item: byRule, reason: 'category_rule' };

  const descriptiveText = [
    asText(args.description),
    asText(args.counterpartyName),
    asText(args.note),
    prompt
  ]
    .filter(Boolean)
    .join(' ');

  const counterpartyId = resolveCounterpartyId(workbook, args, prompt);
  const historicalId = historicalWinner(
    workbook,
    { counterpartyId, description: asText(args.description) || prompt },
    (transaction) => asText(transaction && transaction.categoryId),
    new Set(categories.map((category) => asText(category.id)))
  );
  if (historicalId) {
    return {
      item: categories.find((category) => asText(category.id) === historicalId),
      reason: 'transaction_history'
    };
  }

  const inferredName = inferAdvisorCategoryNameFromPrompt(
    workbook || {},
    descriptiveText,
    template
  );
  const semantic = exactEntity(categories, inferredName);
  if (semantic) return { item: semantic, reason: 'transaction_semantics' };

  const uncategorized = categories.find((category) =>
    ['uncategorized', 'uncategorised'].includes(textKey(category && category.name))
  );
  if (uncategorized) return { item: uncategorized, reason: 'uncategorized_fallback' };
  if (categories.length === 1) return { item: categories[0], reason: 'only_compatible_category' };
  return null;
}

function inferAccount(workbook, args, template, prompt, secondary = false, userPrompt = prompt) {
  const groups = secondary
    ? templateSecondaryAccountGroups(template)
    : templatePrimaryAccountGroups(template);
  if (!groups.length) return null;
  let accounts = activeAccounts(workbook, groups);
  if (!accounts.length) return null;
  const reference = secondary
    ? asText(args.secondaryAccountId || args.secondaryAccount)
    : asText(args.primaryAccountId || args.primaryAccount);
  const explicit = resolveCavalryAssistantTransactionAccount(workbook, {
    template,
    secondary,
    reference,
    prompt: userPrompt
  });
  if (explicit.status === 'resolved') {
    const reason =
      explicit.provenance === 'explicit_role'
        ? 'explicit_account_role'
        : explicit.provenance === 'explicit_mention'
          ? 'explicit_account_mention'
          : explicit.provenance || 'canonical_account_reference';
    return {
      item: explicit.account,
      reason,
      userAuthoritative: ['explicit_role', 'explicit_mention'].includes(explicit.provenance)
    };
  }
  if (explicit.status === 'ambiguous' || explicit.status === 'not_found') {
    const field = secondary ? 'secondaryAccountId' : 'primaryAccountId';
    return {
      resolution: cavalryAssistantAccountResolutionError(
        explicit,
        field,
        secondary ? 'Secondary account' : 'Primary account'
      )
    };
  }

  const counterpartyId = resolveCounterpartyId(workbook, args, prompt);
  const historicalId = historicalWinner(
    workbook,
    { counterpartyId, description: asText(args.description) || prompt },
    (transaction) =>
      secondary
        ? transactionSecondaryAccountId(workbook, transaction, template)
        : transactionAccountId(workbook, transaction, template),
    new Set(accounts.map((account) => asText(account.id)))
  );
  if (historicalId) {
    return {
      item: accounts.find((account) => asText(account.id) === historicalId),
      reason: 'transaction_history'
    };
  }
  if (accounts.length === 1 && (template !== 'expense_charged' || isCardAccount(accounts[0]))) {
    return { item: accounts[0], reason: 'only_compatible_account' };
  }
  return null;
}

function setInferred(result, field, value, reason) {
  if (value == null || value === '') return;
  result.arguments[field] = value;
  result.inferredFields[field] = { value, reason };
}

function setInferredEntityId(result, field, aliases, value, reason) {
  asArray(aliases).forEach((alias) => {
    delete result.arguments[alias];
  });
  setInferred(result, field, value, reason);
}

export function inferCavalryAssistantTransactionArguments(
  workbook,
  rawArguments = {},
  options = {}
) {
  const args = { ...asObject(rawArguments) };
  removeBlankOptionalEntityArguments(args);
  const prompt = asText(options.question);
  const currentDate = asText(options.currentDate);
  const forcedTemplate = asText(options.forcedTemplate);
  const localQuestion = transactionLocalQuestion(workbook, prompt, args, currentDate);
  const semanticPrompt = [localQuestion, localArgumentText(args)].filter(Boolean).join(' ');
  const userSemantic = classifyAdvisorFinanceIntent(localQuestion, {
    currentDate,
    defaultDateForUndated: true
  });
  const semantic = classifyAdvisorFinanceIntent(semanticPrompt, {
    currentDate,
    defaultDateForUndated: true
  });
  const result = {
    arguments: args,
    inferredFields: {},
    semanticDecision: semantic,
    localQuestion,
    resolutionIssues: []
  };

  let template = forcedTemplate
    ? forcedTemplate
    : userPromptHasExplicitTemplateCue(localQuestion, userSemantic)
      ? userSemantic.template
      : templateFromSemanticDecision(semantic, args.template);
  let templateReason = forcedTemplate ? 'capability_contract' : 'finance_intent';
  if (
    !forcedTemplate &&
    template === 'expense_paid' &&
    [
      ADVISOR_FINANCE_INTENT_KINDS.PURCHASE,
      ADVISOR_FINANCE_INTENT_KINDS.CARD_CHARGE,
      ADVISOR_FINANCE_INTENT_KINDS.UNKNOWN
    ].includes(semantic.kind) &&
    explicitlySelectedLiabilityAccount(workbook, args, localQuestion)
  ) {
    template = 'expense_charged';
    templateReason = 'liability_account_routing';
  }
  if (template !== asText(args.template)) {
    setInferred(result, 'template', template, templateReason);
  } else if (forcedTemplate) {
    result.inferredFields.template = {
      value: forcedTemplate,
      reason: 'capability_contract'
    };
  }

  if (!hasOwn(args, 'date') || !asText(args.date)) {
    setInferred(
      result,
      'date',
      semantic.date || currentDate,
      semantic.date && semantic.dateDefaulted !== true
        ? 'date_from_request'
        : 'current_date_default'
    );
  }
  if ((!hasOwn(args, 'amount') || !(Number(args.amount) > 0)) && semantic.amount > 0) {
    setInferred(result, 'amount', semantic.amount, 'amount_from_request');
  }
  if ((!hasOwn(args, 'currency') || !asText(args.currency)) && semantic.currency) {
    setInferred(result, 'currency', semantic.currency, 'currency_from_request');
  }
  if (!hasOwn(args, 'description') || !asText(args.description)) {
    setInferred(
      result,
      'description',
      inferAdvisorDescriptionFromPrompt(semanticPrompt),
      'description_from_request'
    );
  }

  const effectiveTemplate = asText(result.arguments.template) || 'expense_paid';
  const effectivePrompt = [
    semanticPrompt,
    result.arguments.description,
    result.arguments.counterpartyName,
    result.arguments.note
  ]
    .map(asText)
    .filter(Boolean)
    .join(' ');

  if (templateCategoryTypes(effectiveTemplate).length) {
    const inferred = inferCategory(
      workbook,
      result.arguments,
      effectiveTemplate,
      effectivePrompt,
      localQuestion
    );
    const argumentProvided = hasNonBlankArgument(args, ['category', 'categoryId']);
    const explicitlyRequested =
      inferred &&
      (inferred.userAuthoritative === true || inferred.reason === 'explicit_category_mention');
    if (inferred && inferred.item) {
      if (!argumentProvided || explicitlyRequested) {
        setInferredEntityId(
          result,
          'categoryId',
          ['category'],
          asText(inferred.item.id),
          inferred.reason
        );
      }
    }
  }

  {
    const inferred = inferAccount(
      workbook,
      result.arguments,
      effectiveTemplate,
      effectivePrompt,
      false,
      localQuestion
    );
    const argumentProvided = hasNonBlankArgument(args, ['primaryAccount', 'primaryAccountId']);
    const explicitlyRequested = inferred && inferred.userAuthoritative === true;
    if (inferred && inferred.resolution) result.resolutionIssues.push(inferred.resolution);
    if (inferred && inferred.item) {
      if (!argumentProvided || explicitlyRequested) {
        setInferredEntityId(
          result,
          'primaryAccountId',
          ['primaryAccount'],
          asText(inferred.item.id),
          inferred.reason
        );
      }
    }
  }

  if (templateSecondaryAccountGroups(effectiveTemplate).length) {
    const inferred = inferAccount(
      workbook,
      result.arguments,
      effectiveTemplate,
      effectivePrompt,
      true,
      localQuestion
    );
    const argumentProvided = hasNonBlankArgument(args, ['secondaryAccount', 'secondaryAccountId']);
    const explicitlyRequested = inferred && inferred.userAuthoritative === true;
    if (inferred && inferred.resolution) result.resolutionIssues.push(inferred.resolution);
    if (inferred && inferred.item) {
      const inferredId = asText(inferred.item.id);
      if (
        (!argumentProvided || explicitlyRequested) &&
        inferredId &&
        inferredId !== asText(result.arguments.primaryAccountId)
      ) {
        setInferredEntityId(
          result,
          'secondaryAccountId',
          ['secondaryAccount'],
          inferredId,
          inferred.reason
        );
      }
    }
  }

  const counterpartyReference =
    asText(result.arguments.counterpartyId || result.arguments.counterparty) ||
    asText(result.arguments.counterpartyName);
  const suppliedCounterparty = exactEntity(
    asArray(workbook && workbook.counterparties),
    counterpartyReference
  );
  if (suppliedCounterparty) {
    setInferredEntityId(
      result,
      'counterpartyId',
      ['counterparty', 'counterpartyName'],
      asText(suppliedCounterparty.id),
      'canonical_counterparty_reference'
    );
  } else if (hasOwn(result.arguments, 'counterpartyName')) {
    delete result.arguments.counterpartyName;
  }

  if (
    !hasNonBlankArgument(result.arguments, [
      'counterparty',
      'counterpartyId',
      'counterpartyName'
    ]) &&
    !['transfer', 'debt_payment', 'liability_payment', 'opening_balance'].includes(
      effectiveTemplate
    )
  ) {
    const counterpartyName = inferAdvisorCounterpartyNameFromPrompt(
      workbook || {},
      effectivePrompt
    );
    const existingCounterparty = exactEntity(
      asArray(workbook && workbook.counterparties),
      counterpartyName
    );
    if (existingCounterparty) {
      setInferredEntityId(
        result,
        'counterpartyId',
        ['counterparty', 'counterpartyName'],
        asText(existingCounterparty.id),
        'counterparty_from_request'
      );
    }
  }

  return result;
}
