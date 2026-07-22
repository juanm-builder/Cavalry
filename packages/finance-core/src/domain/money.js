export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function normalizeDateKey(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? match[0] : '';
}
