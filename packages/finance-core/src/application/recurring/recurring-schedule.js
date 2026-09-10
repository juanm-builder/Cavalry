// Date-bounded recurring schedules and explicit month-specific exceptions.

const PATCH_FIELDS = [
  'kind',
  'name',
  'categoryId',
  'counterpartyId',
  'accountId',
  'amount',
  'currency',
  'frequency',
  'anchorDate',
  'endDate',
  'autoRenew',
  'isActive',
  'note'
];

export function normalizeRecurringDateKey(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith('0000-')) return '';
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
}

export function normalizeRecurringMonthKey(value) {
  const text = String(value ?? '').trim();
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(text) && !text.startsWith('0000-') ? text : '';
}

export function normalizeRecurringScheduleMap(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(source).flatMap(([month, patch]) => {
      if (
        !normalizeRecurringMonthKey(month) ||
        !patch ||
        typeof patch !== 'object' ||
        Array.isArray(patch)
      )
        return [];
      const clean = Object.fromEntries(
        PATCH_FIELDS.filter((field) => Object.hasOwn(patch, field)).map((field) => [
          field,
          patch[field]
        ])
      );
      return [[month, clean]];
    })
  );
}

export function getRecurringItemForMonth(item, monthKey, { includeOverride = true } = {}) {
  const month = normalizeRecurringMonthKey(monthKey);
  let result = { ...item };
  if (!month) return result;
  const changes = normalizeRecurringScheduleMap(item?.scheduleChanges);
  Object.keys(changes)
    .sort()
    .forEach((start) => {
      if (start <= month) result = { ...result, ...changes[start] };
    });
  const override = includeOverride
    ? normalizeRecurringScheduleMap(item?.monthOverrides)[month]
    : null;
  return {
    ...result,
    ...override,
    ...(item?.isActive === false ? { isActive: false } : {}),
    id: item?.id
  };
}

export function recurringScheduleBoundaryMonths(item, asOfDate) {
  const changes = normalizeRecurringScheduleMap(item?.scheduleChanges);
  const overrides = normalizeRecurringScheduleMap(item?.monthOverrides);
  const dates = [
    asOfDate,
    item?.anchorDate,
    item?.dueDate,
    item?.endDate,
    ...Object.values(changes).flatMap((patch) => [patch.anchorDate, patch.endDate]),
    ...Object.values(overrides).flatMap((patch) => [patch.anchorDate, patch.endDate])
  ];
  const boundaries = new Set([
    ...Object.keys(changes),
    ...Object.keys(overrides),
    ...dates.map((date) => normalizeRecurringDateKey(date).slice(0, 7)).filter(Boolean)
  ]);
  const months = new Set();
  for (const boundary of boundaries) {
    for (let offset = -12; offset <= 12; offset += 1) {
      const date = new Date(`${boundary}-01T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + offset);
      const month = normalizeRecurringMonthKey(date.toISOString().slice(0, 7));
      if (month) months.add(month);
    }
  }
  return [...months].sort();
}
