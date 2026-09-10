const MONTH_FIELDS = [
  'monthKey',
  'amount',
  'currency',
  'scheduledTotal',
  'dueDates',
  'scheduleStatus',
  'frequency',
  'isActive',
  'accountId',
  'categoryId'
];

export function recurringScheduleDetails(source) {
  if (!/^\d{4}-\d{2}$/.test(String(source?.monthKey || ''))) return {};
  const schedule = Object.fromEntries(
    MONTH_FIELDS.filter((field) => source[field] !== undefined).map((field) => [
      field,
      structuredClone(source[field])
    ])
  );
  return { schedules: [schedule] };
}

export function mergeRecurringDetails(previous, next) {
  const schedules = [...(previous.schedules || []), ...(next.schedules || [])];
  if (!schedules.length) return { ...previous, ...next };
  const byMonth = new Map(schedules.map((schedule) => [schedule.monthKey, schedule]));
  const merged = {
    ...previous,
    ...next,
    schedules: [...byMonth.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey))
  };
  if (byMonth.size > 1) {
    // One tracker identity can have different facts in different months. A scalar would
    // misleadingly make the last month's amount/status appear to apply to the whole series.
    for (const field of [...MONTH_FIELDS, 'dueDate']) delete merged[field];
  }
  return merged;
}
