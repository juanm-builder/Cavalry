const MAX_CACHED_CURRENCIES = 32;
const currencyFormatters = new Map();

// Registers format many values with the same currency and presentation rules.
// Keep the cache bounded because imported workbooks supply the currency codes.
export function formatCurrencyAmount(amount, currency) {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    if (currencyFormatters.size >= MAX_CACHED_CURRENCIES) {
      currencyFormatters.delete(currencyFormatters.keys().next().value);
    }
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}
