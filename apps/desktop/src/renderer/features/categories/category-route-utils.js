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
