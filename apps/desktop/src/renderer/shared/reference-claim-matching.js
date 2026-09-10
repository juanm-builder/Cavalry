const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
];

function escape(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function referenceMatchesClaimScope(reference, source) {
  const text = String(source || '');
  const detail = reference.detail || {};
  if (reference.kind === 'sheet') {
    const label = String(detail.sheetName || reference.label || '');
    const monthLabel = /^([a-z]+)(?:\s+\d{4})?$/i.exec(label)?.[1]?.toLowerCase();
    if (
      !monthLabel ||
      !MONTHS.some(
        (month) => month === monthLabel || month.slice(0, 3) === monthLabel || monthLabel === 'sept'
      )
    )
      return true;
    const name = escape(label);
    return Boolean(
      name &&
      new RegExp(
        `(?:\\b${name}\\s+(?:budget|sheet)\\b|\\b(?:budget|sheet)\\s+(?:for\\s+)?${name}\\b)`,
        'i'
      ).test(text)
    );
  }
  if (reference.kind !== 'budget') return true;
  if (/\b(?:not saved|no saved (?:plan|budget))\b/i.test(text)) return false;
  const monthKey = /^(\d{4})-(\d{2})$/.exec(String(detail.monthKey || ''));
  const expectedMonth = monthKey ? Number(monthKey[2]) - 1 : detail.monthIndex;
  if (!Number.isInteger(expectedMonth)) return true;
  const name = detail.categoryName || reference.label;
  const dateText = name ? text.replace(new RegExp(escape(name), 'gi'), '') : text;
  const isoMonths = [...dateText.matchAll(/\b(\d{4})-(\d{2})(?:-\d{2})?\b/g)];
  if (
    isoMonths.some(
      (match) => Number(match[2]) - 1 !== expectedMonth || (monthKey && match[1] !== monthKey[1])
    )
  )
    return false;
  const words = MONTHS.flatMap((month) => [month, month.slice(0, 3)])
    .concat('sept')
    .join('|');
  const namedMonths = [
    ...dateText.matchAll(new RegExp(`\\b(${words})\\b\\.?(?:\\s+(\\d{4}))?`, 'gi'))
  ];
  return namedMonths.every(
    (match) =>
      MONTHS.findIndex((month) => month.startsWith(match[1].toLowerCase())) === expectedMonth &&
      (!match[2] || !monthKey || match[2] === monthKey[1])
  );
}
