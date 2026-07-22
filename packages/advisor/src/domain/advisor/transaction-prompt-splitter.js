import {
  ADVISOR_TRANSACTION_BATCH_LIMIT,
  extractAdvisorAmountMentions,
  parseAdvisorDateFromText
} from './transaction-drafts.js';

function segmentHasActivity(text) {
  const raw = String(text || '').toLowerCase();
  const hasActivity =
    /\b(paid|charged|spent|received|buy|used|bought|purchase|prepaid|load|transferred|transfer|moved|move|sent|send|gave|give|handed|salary|income|opening balance)\b/.test(
      raw
    );
  const hasMoneyEvent = /\b(money|payment|pay|request|expense|bill|transaction|purchase)\b/.test(
    raw
  );
  return hasActivity && (extractAdvisorAmountMentions(raw).length > 0 || hasMoneyEvent);
}

function promptDatePrefix(prompt, options) {
  const raw = String(prompt || '');
  if (/\btoday\b/i.test(raw)) return 'today ';
  if (/\byesterday\b/i.test(raw)) return 'yesterday ';
  const explicit = parseAdvisorDateFromText(raw, options);
  return explicit ? `${explicit} ` : '';
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanSharedClause(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:my|the|a|an)\s+/i, '')
    .replace(/\b(?:all\s+)?(?:today|yesterday)\b.*$/i, '')
    .replace(/\b(?:because|where|when)\b.*$/i, '')
    .replace(/[,.!?;:]+$/g, '')
    .trim();
}

function cleanAmountPurpose(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:and|plus|then)\s+/i, '')
    .replace(/^\s*(?:is|was|for|to|=|,)\s+/i, '')
    .replace(/\s+(?:and|plus|then)\s*$/i, '')
    .replace(/\b(?:all\s+)?(?:today|yesterday)\b.*$/i, '')
    .replace(/[,.!?;:]+$/g, '')
    .trim();
}

function amountListSourceText(raw) {
  const compact = String(raw || '')
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = compact
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const transactionSentence = sentences.find(
    (sentence) =>
      extractAdvisorAmountMentions(sentence).length > 1 &&
      /\b(paid|charged|spent|received|buy|used|bought|purchase|prepaid|load|transferred|transfer|moved|move|sent|send|salary|income|opening balance)\b/i.test(
        sentence
      )
  );
  return (
    transactionSentence ||
    sentences.find((sentence) => extractAdvisorAmountMentions(sentence).length > 1) ||
    sentences[0] ||
    compact
  ).trim();
}

function hasExplicitTotalCue(text) {
  return /\b(total|combined|altogether|all together|overall|in total|sum of|summed|one transaction|single transaction)\b/i.test(
    String(text || '')
  );
}

function sharedTransferContext(raw) {
  const text = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  const sourceMatch =
    /\bfrom\s+(?:my\s+)?([^,.;]+?)(?=,|\s+(?:to|into)\s+|\s+(?:i\s+)?(?:transferred|transfer|moved|move|sent|send)\b|$)/i.exec(
      text
    );
  const destinationMatch =
    /\b(?:to|into)\s+(?:my\s+)?([^,.;]+?)(?=\s+(?:and\s+[0-9]|today|yesterday|all\s+today|because|where|when|the\s+[0-9])\b|[.!?]|$)/i.exec(
      text
    );
  return {
    source: cleanSharedClause(sourceMatch && sourceMatch[1]),
    destination: cleanSharedClause(destinationMatch && destinationMatch[1])
  };
}

function amountPurpose(raw, sourceText, mention, index, mentions) {
  const detailText = String(raw || '').slice(String(sourceText || '').length);
  const otherAmounts = mentions
    .filter((_item, itemIndex) => itemIndex !== index)
    .map((item) => escapeRegex(item.numberText))
    .join('|');
  if (detailText && mention && mention.numberText) {
    const lookahead = otherAmounts
      ? `(?=(?:,?\\s*(?:and\\s+)?(?:the\\s+)?(?:${otherAmounts})\\b)|[.!?]|$)`
      : '(?=[.!?]|$)';
    const detailRegex = new RegExp(
      `(?:^|[\\s,.;])(?:and\\s+)?(?:the\\s+)?${escapeRegex(mention.numberText)}(?:\\s*(?:pesos?|php))?\\s*(?:is|was|for|to|=|,)?\\s+([\\s\\S]{1,140}?)${lookahead}`,
      'i'
    );
    const detailMatch = detailRegex.exec(detailText);
    const cleanedDetail = cleanAmountPurpose(detailMatch && detailMatch[1]);
    if (cleanedDetail) {
      return cleanedDetail;
    }
  }
  const next = mentions[index + 1];
  return cleanAmountPurpose(
    String(sourceText || '').slice(mention.end, next ? next.start : undefined)
  );
}

function actionPrefix(sourceText) {
  const firstMention = extractAdvisorAmountMentions(sourceText)[0];
  const beforeFirstAmount = String(sourceText || '').slice(
    0,
    Math.max(0, (firstMention && firstMention.start) || 0)
  );
  const match =
    /\b(?:i\s+)?(?:also\s+)?(paid|spent|bought|purchased|received|got charged|was charged|charged|transferred|transfer|move|moved|send|sent|gave|give|handed)\b/i.exec(
      beforeFirstAmount
    );
  if (!match) return 'I paid';
  const phrase = match[0].replace(/\s+/g, ' ').trim();
  return /^i\b/i.test(phrase)
    ? phrase.replace(/^i\b/i, 'I')
    : phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function sharedFundingTail(sourceText, lastAmountEnd) {
  const tail = String(sourceText || '').slice(lastAmountEnd || 0);
  const match =
    /\b(?:from|using|with|charged to|charged on|on)\s+(?:my\s+)?[^,.;]+?(?=$|[,.!?])/i.exec(tail);
  return match && match[0] ? cleanSharedClause(match[0]) : '';
}

function splitAmountListPrompts(prompt, options) {
  const raw = String(prompt || '').trim();
  const sourceText = amountListSourceText(raw);
  if (!sourceText || hasExplicitTotalCue(sourceText) || hasExplicitTotalCue(raw)) {
    return [];
  }
  const mentions = extractAdvisorAmountMentions(sourceText);
  if (mentions.length < 2 || mentions.length > 8 || !segmentHasActivity(sourceText)) {
    return [];
  }
  if (new Set(mentions.map((mention) => String(mention.amount))).size === 1) {
    return [];
  }
  const datePrefix = promptDatePrefix(raw, options);
  const transferLike = /\b(transferred|transfer|moved|move)\b/i.test(sourceText);
  const transferContext = transferLike
    ? sharedTransferContext(sourceText)
    : { source: '', destination: '' };
  const hasPerAmountTransferTargets =
    transferLike &&
    mentions.some((mention, index) =>
      /\b(to|into)\b/i.test(
        sourceText.slice(mention.end, mentions[index + 1] ? mentions[index + 1].start : undefined)
      )
    );
  if (
    transferLike &&
    (transferContext.source || transferContext.destination) &&
    !(hasPerAmountTransferTargets && !transferContext.source)
  ) {
    return mentions.map((mention, index) => {
      const purpose = amountPurpose(raw, sourceText, mention, index, mentions);
      let segment = `I transferred ${String(mention.amount)} pesos`;
      if (transferContext.source) segment += ` from ${transferContext.source}`;
      if (transferContext.destination) segment += ` to ${transferContext.destination}`;
      if (purpose) segment += ` for ${purpose}`;
      return datePrefix && !parseAdvisorDateFromText(segment, options)
        ? datePrefix + segment
        : segment;
    });
  }
  const prefix = actionPrefix(sourceText);
  const fundingTail = sharedFundingTail(sourceText, mentions.at(-1).end);
  return mentions.map((mention, index) => {
    const next = mentions[index + 1];
    const fragment = sourceText
      .slice(mention.start, next ? next.start : undefined)
      .replace(/\s+/g, ' ')
      .replace(/\s+(?:and|plus|then)\s*$/i, '')
      .replace(/[,.!?;:]+$/g, '')
      .trim();
    let segment = `${prefix} ${fragment}`.replace(/\s+/g, ' ').trim();
    if (fundingTail && !/\b(from|using|with|charged to|charged on|on)\b/i.test(segment)) {
      segment += ` ${fundingTail}`;
    }
    return datePrefix && !parseAdvisorDateFromText(segment, options)
      ? datePrefix + segment
      : segment;
  });
}

export function splitAdvisorTransactionPrompts(prompt, options = {}) {
  const raw = String(prompt || '').trim();
  if (!raw) {
    return [];
  }
  const datePrefix = promptDatePrefix(raw, options);
  const withBreaks = raw
    .replace(/\r/g, '\n')
    .replace(
      /\s+(?:and|plus|then)\s+(?=(?:i\s+)?(?:also\s+)?(?:paid|got charged|was charged|charged|spent|received|used|buy|bought|purchased|transferred|transfer|moved|move|sent|send|gave|give|handed)\b)/gi,
      '\n'
    )
    .replace(
      /\s+(?=(?:i\s+)?also\s+(?:paid|got charged|was charged|charged|spent|received|used|buy|bought|purchased|transferred|transfer|moved|move|sent|send|gave|give|handed)\b)/gi,
      '\n'
    );
  const segments = withBreaks
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*]\s*)?/, '').trim())
    .filter(segmentHasActivity)
    .map((line) =>
      datePrefix && !parseAdvisorDateFromText(line, options) ? datePrefix + line : line
    );
  const unique = segments.filter((segment, index, list) => list.indexOf(segment) === index);
  if (unique.length > 1) {
    const expanded = [];
    unique.forEach((segment) => {
      const amountSegments = splitAmountListPrompts(segment, options);
      (amountSegments.length > 1 ? amountSegments : [segment]).forEach((item) => {
        if (!expanded.includes(item)) expanded.push(item);
      });
    });
    return expanded.slice(0, ADVISOR_TRANSACTION_BATCH_LIMIT);
  }
  const amountSegments = splitAmountListPrompts(raw, options);
  return amountSegments.length > 1
    ? amountSegments.slice(0, ADVISOR_TRANSACTION_BATCH_LIMIT)
    : [raw];
}
