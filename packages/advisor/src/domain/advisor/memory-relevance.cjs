// Provider-neutral memory retrieval. Keep chat lookups and injected context consistent.
'use strict';

const STOP_WORDS = new Set(
  (
    'about after again all also am an and any are as at be before but can could did do does ' +
    'for from had has have how i im in into is it items its just know known list me memories ' +
    'memory my of on or our please recall remember remembered saved say show so some tell ' +
    'that the their them then there these they this those to told us was we were what when ' +
    'where which who will with would you your'
  ).split(' ')
);

const WORD_FORMS = new Map([
  ['goals', 'goal'],
  ['priorities', 'priority'],
  ['targets', 'target'],
  ['preferences', 'preference'],
  ['replies', 'reply'],
  ['answers', 'answer'],
  ['expenses', 'expense'],
  ['debts', 'debt'],
  ['loans', 'loan'],
  ['budgets', 'budget'],
  ['savings', 'saving'],
  ['parents', 'parent']
]);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function hasMemoryRecallIntent(value) {
  const question = text(value);
  return (
    /\b(?:show|list|review|read|check|search|find)\b.*\b(?:memory|memories|remembered|preferences?)\b/i.test(
      question
    ) ||
    /\b(?:what|which)\b.*\b(?:memory|memories|remember|remembered|preferences?)\b/i.test(
      question
    ) ||
    /\b(?:what|how much)\s+(?:do|did)\s+you\s+(?:remember|recall)\b/i.test(question) ||
    /\b(?:what|how much)\s+(?:do|did)\s+you\s+know\s+about\s+(?:me|my|our)\b/i.test(question) ||
    /\b(?:do|can)\s+you\s+(?:still\s+)?(?:remember|recall)\b/i.test(question) ||
    /\b(?:what\s+(?:have|had|did)\s+i\s+(?:told|tell)|have\s+i\s+told\s+you)\b/i.test(question) ||
    /^(?:please\s+)?recall\b/i.test(question)
  );
}

function memoryWords(value) {
  const source = text(value).toLocaleLowerCase();
  const words = new Set(
    (source.match(/[\p{L}\p{N}]{2,}/gu) || [])
      .filter((word) => !STOP_WORDS.has(word))
      .map((word) => WORD_FORMS.get(word) || word)
  );
  // A small, explicit vocabulary helps small/local models without a second model call.
  const concepts = [
    ['goal', /\b(?:goals?|priorities|priority|targets?|trying to achieve)\b/],
    [
      'emergency_fund',
      /\b(?:emergency (?:fund|savings)|rainy day|financial (?:cushion|buffer)|safety net)\b/
    ],
    [
      'reply_style',
      /\b(?:concise|brief|brevity|short|detailed|lengthy)\b.*\b(?:answers?|replies|responses?|explanations?)\b|\b(?:answer|reply|respond)\b.*\b(?:concisely|briefly|detail)\b|\b(?:communication|reply|response|answer) style\b/
    ],
    ['identity_name', /\b(?:my name|your name|call me|i am called|i'm called|i’m called)\b/],
    [
      'family_support',
      /\b(?:support|help|send money|provide for)\b.*\b(?:parents?|family|mother|father|mom|mum|dad)\b|\b(?:family|parental) support\b/
    ]
  ];
  for (const [concept, pattern] of concepts) {
    if (pattern.test(source)) words.add(`concept:${concept}`);
  }
  return words;
}

function isBroadMemoryRecall(value) {
  const question = text(value);
  if (!hasMemoryRecallIntent(question)) return false;
  return (
    /\b(?:about me|about myself|who i am)\b/i.test(question) || memoryWords(question).size === 0
  );
}

function isCoreMemory(value) {
  return (
    /\b(?:my name is|call me|prefers? to be called|user(?:'s)? name|my pronouns|my timezone|respond in|answer in|use [A-Z]{3}\b|keep (?:answers|replies|responses)|always (?:answer|respond|use))\b/i.test(
      text(value)
    ) ||
    /\b(?:i prefer|prefers?|wants?|please use|use)\b.*\b(?:concise|brief|detailed|short|plain[- ]english|plain language|simple language)\b/i.test(
      text(value)
    )
  );
}

function financialBackgroundRelevant(query, itemText) {
  return (
    /\b(?:financially|finances|financial (?:plan|position|situation|health)|money|afford|spend|spending|save|saving|savings|budget|accounts?|cash|net worth|focus on|prioriti[sz]e)\b/i.test(
      text(query)
    ) &&
    /\b(?:priorit(?:y|ies)|goals?|emergency fund|belongs? to (?:the )?business|business money|company cash|personal (?:spending|cash|money))\b/i.test(
      text(itemText)
    )
  );
}

function memoryOverlap(queryWords, itemText, tags = []) {
  const itemWords = memoryWords(`${text(itemText)} ${tags.join(' ')}`);
  const tagWords = memoryWords(tags.join(' '));
  let overlap = 0;
  queryWords.forEach((word) => {
    if (itemWords.has(word)) overlap += tagWords.has(word) ? 3 : 1;
  });
  return overlap;
}

function rankMemoryItems(items, query = '') {
  const queryWords = memoryWords(query);
  const broad = isBroadMemoryRecall(query);
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      item,
      index,
      core: item.scope === 'always' || isCoreMemory(item.text),
      overlap: memoryOverlap(queryWords, item.text, item.tags || [])
    }))
    .filter(
      (entry) =>
        broad ||
        entry.core ||
        entry.overlap > 0 ||
        financialBackgroundRelevant(
          query,
          `${entry.item.text} ${(entry.item.tags || []).join(' ')}`
        )
    )
    .sort((left, right) => {
      if (left.core !== right.core) return left.core ? -1 : 1;
      if (left.overlap !== right.overlap) return right.overlap - left.overlap;
      return (
        text(right.item.updatedAt).localeCompare(text(left.item.updatedAt)) ||
        left.index - right.index
      );
    })
    .map((entry) => entry.item);
}

function rankMemoryBlocks(content, query = '') {
  const queryWords = memoryWords(query);
  const broad = isBroadMemoryRecall(query);
  return text(content)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => ({ block, index, overlap: memoryOverlap(queryWords, block) }))
    .filter(
      (entry) =>
        broad ||
        isCoreMemory(entry.block) ||
        /\bi prefer\b/i.test(entry.block) ||
        entry.overlap > 0 ||
        financialBackgroundRelevant(query, entry.block)
    )
    .sort((left, right) => right.overlap - left.overlap || left.index - right.index)
    .map((entry) => entry.block);
}

module.exports = { hasMemoryRecallIntent, isBroadMemoryRecall, rankMemoryBlocks, rankMemoryItems };
