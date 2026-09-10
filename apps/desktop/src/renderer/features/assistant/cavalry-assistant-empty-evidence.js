// Verifies that a zero-result statement preserves the complete searched scope.
function asText(value) {
  return String(value == null ? '' : value).trim();
}
function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export const MONTH_INDEX = Object.freeze({
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
});
export const MONTH_WORD = Object.keys(MONTH_INDEX).join('|');

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asText(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateKey(year, monthName, day) {
  return `${year}-${String(MONTH_INDEX[monthName.toLowerCase()] + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function exactNamedSearchWindow(text, range) {
  const iso = /^(\d{4}-\d{2}-\d{2})\s*(?:through|to|until|and|[-–—])\s*(\d{4}-\d{2}-\d{2})$/i.exec(
    text
  );
  if (iso) return iso[1] === range.start && iso[2] === range.end;
  const named = new RegExp(
    `^(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\s*(?:through|to|until|and|[-–—])\\s*(?:(${MONTH_WORD})\\.?\\s+)?(\\d{1,2})(?:,?\\s+(\\d{4}))?$`,
    'i'
  ).exec(text);
  if (!named) return false;
  const startYear = named[3] || named[6] || range.start.slice(0, 4);
  const endYear = named[6] || named[3] || startYear;
  return (
    dateKey(startYear, named[1], named[2]) === range.start &&
    dateKey(endYear, named[4] || named[1], named[5]) === range.end
  );
}

function namedEmptySearchSupportsClaim(calculation, claim) {
  const filters = asObject(calculation.filters);
  const expectedFilters = [
    'query',
    'type',
    'accountId',
    'categoryId',
    'start',
    'end',
    'minAmount',
    'maxAmount'
  ];
  if (
    calculation.transactionCount !== 0 ||
    calculation.recordPreviewCount !== 0 ||
    calculation.recordPreviewOmitted !== 0 ||
    expectedFilters.some((field) => !hasOwn(filters, field)) ||
    Object.keys(filters).some((field) => !expectedFilters.includes(field)) ||
    filters.type !== 'all' ||
    filters.accountId !== '' ||
    filters.categoryId !== '' ||
    filters.minAmount !== null ||
    filters.maxAmount !== null ||
    !validDate(filters.start) ||
    !validDate(filters.end) ||
    filters.start > filters.end
  )
    return false;
  const query = asText(filters.query);
  if (!query || !/[a-z]/i.test(query)) return false;
  const name = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const records = '(?:payments?|transactions?|charges?|expenses?)';
  const claimPattern = new RegExp(
    `^No\\s+(?:["“]?${name}["”]?\\s+${records}\\s+(?:(?:is|are|was|were)\\s+)?(?:recorded|found)|recorded\\s+${records}\\s+for\\s+["“]?${name}["”]?|${records}\\s+(?:(?:is|are|was|were)\\s+)?(?:recorded|found)\\s+for\\s+(?:the\\s+exact\\s+text\\s+)?["“]?${name}["”]?)(?:\\s+in\\s+Cavalry)?\\s+(?:from|for|between)\\s+(.+)$`,
    'i'
  );
  const match = claimPattern.exec(
    asText(claim)
      .replace(/[*_~`]/g, '')
      .replace(/^[-+]\s+/, '')
      .replace(/[.!?]+$/, '')
      .trim()
  );
  return Boolean(match && exactNamedSearchWindow(match[1], filters));
}

export function emptyQuerySupportsClaim(evidenceSet, claim) {
  const calculation = asObject(evidenceSet.calculation);
  if (calculation.operation === 'filtered_transaction_totals') {
    return namedEmptySearchSupportsClaim(calculation, claim);
  }
  const range = asObject(calculation.range);
  const filters = asObject(calculation.filters);
  if (
    calculation.operation !== 'grouped_spending_totals' ||
    calculation.type !== 'expense' ||
    !hasOwn(filters, 'accountId') ||
    !hasOwn(filters, 'categoryId') ||
    Object.values(filters).some((value) => value !== '') ||
    calculation.transactionCount !== 0 ||
    calculation.matchedTransactionCount !== 0 ||
    calculation.unresolvedTransactionCount !== 0 ||
    calculation.groupCount !== 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(asText(range.start)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(asText(range.end)) ||
    range.start > range.end ||
    !/\b(?:zero|nothing|no)\b/i.test(claim) ||
    !/\b(?:recorded|records?|spending|transactions?|expenses?|charges?)\b/i.test(claim)
  )
    return false;

  let supported = true;
  let explicitWindow = false;
  let namesMonth = false;
  const isoDates = new Set();
  const startMonth = Number(range.start.slice(5, 7)) - 1;
  const endMonth = Number(range.end.slice(5, 7)) - 1;
  let remaining = claim.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => {
    if (date < range.start || date > range.end) supported = false;
    isoDates.add(date);
    return '';
  });
  remaining = remaining.replace(
    new RegExp(
      `\\b(${MONTH_WORD})\\b\\.?(?:\\s+(\\d{1,2})(?:\\s*[-–—]\\s*(\\d{1,2}))?(?:,?\\s+(\\d{4}))?)?`,
      'gi'
    ),
    (_date, monthName, firstDay, lastDay, explicitYear) => {
      namesMonth = true;
      const month = MONTH_INDEX[monthName.toLowerCase()];
      if (month !== startMonth || month !== endMonth) supported = false;
      const year = explicitYear || range.start.slice(0, 4);
      if (year !== range.start.slice(0, 4) || year !== range.end.slice(0, 4)) supported = false;
      if (firstDay) {
        const datePrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
        const first = datePrefix + String(firstDay).padStart(2, '0');
        const last = datePrefix + String(lastDay || firstDay).padStart(2, '0');
        if (first < range.start || last > range.end || first > last) supported = false;
        if (first === range.start && last === range.end) explicitWindow = true;
      }
      return '';
    }
  );
  // Empty query evidence proves no matching rows, never a positive amount or count. Dates
  // above are checked against the searched window before excluding them from this check.
  const rangeEnd = new Date(`${range.end}T00:00:00Z`);
  const lastDay = new Date(
    Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const completeMonth =
    range.start.endsWith('-01') &&
    startMonth === endMonth &&
    range.start.slice(0, 4) === range.end.slice(0, 4) &&
    Number(range.end.slice(8)) === lastDay;
  explicitWindow ||= isoDates.has(range.start) && isoDates.has(range.end);
  return supported && (explicitWindow || (completeMonth && namesMonth)) && !/[1-9]/.test(remaining);
}
