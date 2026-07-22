function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asLegacyId(value) {
  return String(value == null ? '' : value);
}

function parseNumericInput(value) {
  return (
    Number(
      String(value || '')
        .replace(/,/g, '')
        .trim()
    ) || 0
  );
}

function todayISO() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function getWorkbookCurrency(workbook) {
  return asString(workbook && workbook.currency).toUpperCase() || 'PHP';
}

function getRawValue(rawInput, key, fallback = '') {
  if (!rawInput || typeof rawInput !== 'object') {
    return fallback;
  }
  return Object.prototype.hasOwnProperty.call(rawInput, key) ? rawInput[key] : fallback;
}

export function getTransactionComposerDefaults(workbook, options = {}) {
  return {
    template: 'expense_paid',
    amount: 0,
    currency: getWorkbookCurrency(workbook),
    date: asString(options.defaultDate) || todayISO(),
    fxRateToBase: 0,
    description: '',
    categoryId: '',
    primaryAccountId: '',
    secondaryAccountId: '',
    counterpartyId: '',
    counterpartyName: '',
    counterpartyKind: 'other',
    note: '',
    recurringItemId: ''
  };
}

export function normalizeTransactionComposerInput(rawInput, workbook, options = {}) {
  const defaults = getTransactionComposerDefaults(workbook, options);
  const rawFxRate = getRawValue(
    rawInput,
    'fxRateToBase',
    getRawValue(rawInput, 'usdExpenseRate', defaults.fxRateToBase)
  );
  const rawCounterpartyKind = asString(
    getRawValue(rawInput, 'counterpartyKind', defaults.counterpartyKind)
  ).toLowerCase();
  return {
    template: String(getRawValue(rawInput, 'template', defaults.template) || defaults.template),
    amount: Number(getRawValue(rawInput, 'amount', defaults.amount) || 0) || 0,
    currency: String(
      getRawValue(rawInput, 'currency', defaults.currency) || defaults.currency
    ).toUpperCase(),
    date: String(getRawValue(rawInput, 'date', defaults.date) || defaults.date),
    fxRateToBase: parseNumericInput(rawFxRate),
    description: asString(getRawValue(rawInput, 'description', defaults.description)),
    categoryId: asLegacyId(getRawValue(rawInput, 'categoryId', defaults.categoryId)),
    primaryAccountId: asLegacyId(
      getRawValue(rawInput, 'primaryAccountId', defaults.primaryAccountId)
    ),
    secondaryAccountId: asLegacyId(
      getRawValue(rawInput, 'secondaryAccountId', defaults.secondaryAccountId)
    ),
    counterpartyId: asLegacyId(getRawValue(rawInput, 'counterpartyId', defaults.counterpartyId)),
    counterpartyName: asString(
      getRawValue(rawInput, 'counterpartyName', defaults.counterpartyName)
    ),
    counterpartyKind: rawCounterpartyKind || defaults.counterpartyKind,
    note: asString(getRawValue(rawInput, 'note', defaults.note)),
    recurringItemId: asString(getRawValue(rawInput, 'recurringItemId', defaults.recurringItemId))
  };
}

export function buildTransactionComposerValidationModel(input, workbook, options = {}) {
  const normalized = normalizeTransactionComposerInput(input, workbook, options);
  const isUsdExpenseRateRequired =
    getWorkbookCurrency(workbook) === 'PHP' &&
    normalized.currency === 'USD' &&
    (normalized.template === 'expense_paid' || normalized.template === 'expense_charged');
  const issues = [];

  if (!(normalized.amount > 0)) {
    issues.push({
      code: 'invalid_amount',
      field: 'amount',
      message: 'Enter a valid amount.'
    });
  }
  if (isUsdExpenseRateRequired && !(normalized.fxRateToBase > 0)) {
    issues.push({
      code: 'missing_usd_expense_rate',
      field: 'usdExpenseRate',
      message: 'Set a USD to PHP rate before posting this USD expense.'
    });
  }

  return {
    input: normalized,
    issues,
    valid: issues.length === 0,
    isUsdExpenseRateRequired,
    hasUsdExpenseRate: normalized.fxRateToBase > 0
  };
}
