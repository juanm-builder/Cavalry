export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeCurrency(value) {
  return (
    String(value || 'PHP')
      .trim()
      .toUpperCase() || 'PHP'
  );
}

export function formatMoney(value, currency = 'PHP') {
  try {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: normalizeCurrency(currency),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  } catch (_error) {
    return `${(Number(value) || 0).toFixed(2)} ${normalizeCurrency(currency)}`;
  }
}

export function formatPercent(value) {
  const number = Number(value) || 0;
  return `${Number.isInteger(number) ? number : number.toFixed(1)}%`;
}
