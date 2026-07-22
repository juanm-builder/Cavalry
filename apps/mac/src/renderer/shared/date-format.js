export function formatUiDateTime(value, options = {}) {
  const source = String(value == null ? '' : value).trim();
  if (!source) return '';
  const timestamp = Date.parse(source);
  if (!Number.isFinite(timestamp)) return source;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(source);
  try {
    return new Intl.DateTimeFormat(options.locale || 'en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...(isDateOnly ? {} : { hour: 'numeric', minute: '2-digit' }),
      ...options.format
    }).format(new Date(timestamp));
  } catch (_error) {
    return source;
  }
}
