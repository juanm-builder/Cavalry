const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_PATTERN =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const day = '(\\d{1,2})(?:st|nd|rd|th)?';
const namedDatePattern = new RegExp(
  `\\b(?:(${MONTH_PATTERN})\\.?\\s*${day}|${day}\\s*(${MONTH_PATTERN})\\.?)(?:,?\\s+(20\\d{2}))?\\b`,
  'gi'
);

export function validNotesDate(value) {
  const date = String(value || '');
  const time = Date.parse(`${date}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === date
  );
}

function dateString(year, month, date) {
  return `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

export function parseNotesDate(source, today) {
  const defaultDate = validNotesDate(today) ? today : new Date().toISOString().slice(0, 10);
  const matches = [];
  for (const match of source.matchAll(/\b(20\d{2}-\d{1,2}-\d{1,2})\b/g)) {
    const [year, month, date] = match[1].split('-');
    matches.push({ date: dateString(year, month, date), matchedText: match[0] });
  }
  for (const match of source.matchAll(namedDatePattern)) {
    const month = MONTHS.indexOf((match[1] || match[4]).toLowerCase().slice(0, 3)) + 1;
    matches.push({
      date: dateString(match[5] || defaultDate.slice(0, 4), month, match[2] || match[3]),
      matchedText: match[0]
    });
  }
  for (const match of source.matchAll(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}|\d{2}))?\b/g)) {
    if (matches.some((item) => item.matchedText.includes(match[0]))) continue;
    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = match[3]
      ? match[3].length === 2
        ? `20${match[3]}`
        : match[3]
      : defaultDate.slice(0, 4);
    const ambiguous = a <= 12 && b <= 12 && a !== b;
    matches.push({
      date: ambiguous ? '' : dateString(year, a > 12 ? b : a, a > 12 ? a : b),
      matchedText: match[0],
      ambiguous
    });
  }
  for (const match of source.matchAll(/\b(day before yesterday|yesterday|today|tomorrow)\b/gi)) {
    const offset = { 'day before yesterday': -2, yesterday: -1, today: 0, tomorrow: 1 }[
      match[0].toLowerCase()
    ];
    matches.push({
      date: new Date(Date.parse(`${defaultDate}T00:00:00Z`) + offset * 86400000)
        .toISOString()
        .slice(0, 10),
      matchedText: match[0]
    });
  }
  const dates = new Set(matches.map((match) => match.date));
  const unsupported =
    /\b(?:(?:last|next|this)\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d+\s+days?\s+ago)\b/i.exec(
      source
    );
  return {
    date: dates.size > 1 || unsupported ? '' : (matches[0]?.date ?? defaultDate),
    matchedText: matches.map((match) => match.matchedText).join(' | '),
    matchedTexts: matches.map((match) => match.matchedText),
    explicit: matches.length > 0 || !!unsupported,
    ambiguous: dates.size > 1 || matches.some((match) => match.ambiguous) || !!unsupported,
    future: matches.some((match) => match.date > defaultDate)
  };
}

const CURRENCY_CODES = {
  '₱': 'PHP',
  php: 'PHP',
  peso: 'PHP',
  pesos: 'PHP',
  $: 'USD',
  us$: 'USD',
  usd: 'USD',
  '€': 'EUR',
  eur: 'EUR',
  '£': 'GBP',
  gbp: 'GBP'
};
const amountPattern =
  /(?<![\p{L}\d])(?:(₱|PHP|US\$|USD|\$|€|EUR|£|GBP)\s*)?([+-]?\d+(?:[.,]\d+)*)([km])?(?:\s*(PHP|USD|EUR|GBP|pesos?))?(?![\p{L}\d])/giu;

function numericAmount(value) {
  const unsigned = value.replace(/^[+-]/, '');
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(unsigned) || /^\d+(?:\.\d{1,2})?$/.test(unsigned))
    return Number(unsigned.replace(/,/g, ''));
  if (/^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(unsigned) || /^\d+,\d{2}$/.test(unsigned))
    return Number(unsigned.replace(/\./g, '').replace(',', '.'));
  return NaN;
}

const NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};
const WORD_AMOUNT = new RegExp(
  `\\b(?:${Object.keys(NUMBER_WORDS).join('|')})(?:[ -]+(?:${Object.keys(NUMBER_WORDS).join('|')}|hundred|thousand|million|kay|and))*\\b`,
  'gi'
);
function wordAmount(value) {
  let total = 0;
  let group = 0;
  for (const word of value.toLowerCase().split(/[ -]+/)) {
    if (word === 'and') continue;
    if (word === 'hundred') group = (group || 1) * 100;
    else if (['thousand', 'kay', 'million'].includes(word)) {
      total += (group || 1) * (word === 'million' ? 1000000 : 1000);
      group = 0;
    } else group += NUMBER_WORDS[word];
  }
  return total + group;
}

export function parseNotesAmount(source, workbookCurrency = 'PHP') {
  const candidates = [];
  for (const match of source.matchAll(amountPattern)) {
    const after = source.slice(match.index + match[0].length);
    const before = source.slice(0, match.index);
    const explicit = !!(match[1] || match[4]);
    if (
      !explicit &&
      ((/^\s*(?:x\b|cups?\b|coffees?\b|items?\b|pcs?\b|pieces?\b|people\b|persons?\b|tickets?\b|lit(?:er|re)s?\b|kg\b)/i.test(
        after
      ) &&
        /(?:[₱$€£]|\b(?:PHP|USD|EUR|GBP)\b)\s*\d/i.test(after)) ||
        /(?:\b(?:ref(?:erence)?|order|invoice|account|card)\s*(?:no\.?|number|#)?\s*|#)\s*$/i.test(
          before
        ))
    )
      continue;
    const numeric = numericAmount(match[2]);
    const multiplier =
      match[3]?.toLowerCase() === 'k' ? 1000 : match[3]?.toLowerCase() === 'm' ? 1000000 : 1;
    const prefixCurrency = CURRENCY_CODES[match[1]?.toLowerCase()];
    const suffixCurrency = CURRENCY_CODES[match[4]?.toLowerCase()];
    candidates.push({
      amount: numeric * multiplier,
      currency: prefixCurrency || suffixCurrency || workbookCurrency,
      matchedText: match[0].trim(),
      signed: /^[+-]/.test(match[2]) || (/\(\s*$/.test(before) && /^\s*\)/.test(after)),
      invalid:
        !Number.isFinite(numeric) ||
        !!(prefixCurrency && suffixCurrency && prefixCurrency !== suffixCurrency)
    });
  }
  if (!candidates.length) {
    for (const match of source.matchAll(WORD_AMOUNT)) {
      if (
        /^\s*(?:cups?|coffees?|items?|people|tickets?)\b/i.test(
          source.slice(match.index + match[0].length)
        )
      )
        continue;
      candidates.push({
        amount: wordAmount(match[0]),
        currency: workbookCurrency,
        matchedText: match[0],
        signed: false,
        invalid: false
      });
    }
  }
  const chosen = candidates[0];
  const ambiguous = candidates.length > 1;
  return {
    amount: chosen && !chosen.invalid && !chosen.signed && !ambiguous ? chosen.amount : 0,
    currency: chosen?.currency || workbookCurrency,
    matchedText: chosen?.matchedText || '',
    matchedTexts: candidates.map((candidate) => candidate.matchedText),
    ambiguous,
    invalid: candidates.some((candidate) => candidate.invalid),
    signed: candidates.some((candidate) => candidate.signed),
    approximate: /(?:\b(?:about|around|roughly|approx(?:imately)?|maybe)\b|~|\?)/i.test(source)
  };
}

export function unsupportedNotesIntent(source) {
  if (
    /\b(?:every\s+(?:day|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monthly|weekly|yearly|annually|recurring|set\s+up\s+(?:a\s+)?(?:bill|subscription))\b/i.test(
      source
    )
  )
    return 'recurring';
  if (
    /\b(?:transfer(?:red)?|mov(?:e|ed)|(?:paid|pay|payment)\s+(?:(?:my|the)\s+)?(?:credit\s*card|loan|debt)|repay(?:ment|ing|ed)?|refund(?:ed)?|reimburs(?:e|ed|ement)|borrow(?:ed)?|lent|withdraw(?:al|n)?|deposit(?:ed)?\s+(?:to|from))\b/i.test(
      source
    )
  )
    return 'transfer_or_refund';
  return '';
}

export function notesIntentIssues(source) {
  const issues = [];
  if (
    /\b(?:actually|correction|corrected|instead|not\s+\d|(?:should|meant)\s+(?:be|to)|cancel(?:led)?|void(?:ed)?)\b|(?:→|->|~~)/i.test(
      source
    )
  )
    issues.push({
      code: 'correction_review',
      field: 'review',
      message: 'Check the correction before recording this note.'
    });
  if (
    /\b(?:unpaid|not\s+(?:yet\s+)?paid|owe|owing|due|remind(?:er)?|to\s+buy|need\s+to|want\s+to|will\s+(?:buy|pay)|budget(?:ed)?|goal|target|planned?|estimate)\b/i.test(
      source
    )
  )
    issues.push({
      code: 'transaction_intent_review',
      field: 'review',
      message: 'Check whether this happened; plans and unpaid reminders should stay in your notes.'
    });
  return issues;
}
