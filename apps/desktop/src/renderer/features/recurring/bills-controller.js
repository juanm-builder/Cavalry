import {
  confirmRecurringReconciliationCommand,
  getRecurringOccurrenceDatesForMonth,
  normalizeRecurringItemForCommand,
  normalizeRecurringKind,
  rejectRecurringReconciliationCommand
} from '@cavalry/finance-core';
import {
  normalizeRecurringDateKey,
  normalizeRecurringMonthKey,
  normalizeRecurringScheduleMap
} from '@cavalry/finance-core/application/recurring/recurring-schedule.js';
import {
  buildBillsRouteBaseModel,
  buildBillsRouteModelFromBase,
  getBillsRouteBaseCacheKey
} from './bills-route-model.js';

export const BILLS_ACTIONS = Object.freeze({
  saveRecurring: 'save-recurring-item',
  archiveRecurring: 'archive-recurring-item',
  restoreRecurring: 'restore-recurring-item',
  scan: 'scan-subscription-review',
  confirmMatch: 'confirm-recurring-transaction-match',
  rejectMatch: 'reject-recurring-transaction-match',
  undoMatch: 'undo-recurring-transaction-match'
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function ok(workbook, events = [], warnings = []) {
  return {
    ok: true,
    workbook,
    events: cloneSerializable(events),
    warnings: cloneSerializable(warnings),
    errors: []
  };
}

function fail(workbook, code, message) {
  return {
    ok: false,
    workbook,
    events: [],
    warnings: [],
    errors: [{ code, message }]
  };
}

function normalizeDateKey(value) {
  return normalizeRecurringDateKey(value);
}

function getIdFactory(dependencies) {
  if (typeof dependencies.createId === 'function') return dependencies.createId;
  if (dependencies.ids && typeof dependencies.ids.create === 'function')
    return dependencies.ids.create;
  return null;
}

function createRecurringId(workbook, dependencies) {
  const existing = new Set(
    asArray(workbook.recurringItems).map((item) => asString(item && item.id))
  );
  const createId = getIdFactory(dependencies);
  if (createId) {
    let candidate = asString(createId('recurring'));
    while (!candidate || existing.has(candidate)) candidate = asString(createId('recurring'));
    return candidate;
  }
  let index = existing.size + 1;
  let candidate = `recurring_${index}`;
  while (existing.has(candidate)) candidate = `recurring_${++index}`;
  return candidate;
}

function validateRecurringInput(workbook, payload) {
  const name = asString(payload.name);
  const amount = Number(payload.amount ?? payload.planned);
  const dueDate = normalizeDateKey(payload.dueDate || payload.anchorDate);
  const endDate = normalizeDateKey(payload.endDate);
  const category = asArray(workbook.categories).find(
    (item) => item && item.id === payload.categoryId
  );
  const accountId = asString(payload.accountId);
  const account = accountId
    ? asArray(workbook.accounts).find((item) => item && item.id === accountId)
    : null;
  const currency = asString(payload.currency || workbook.currency).toUpperCase() || 'PHP';
  if (!name) return { error: ['recurring.name-required', 'Name is required.'] };
  if (
    !asString(payload.amount ?? payload.planned) ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    (amount > 0 && amount < 0.01) ||
    !Number.isSafeInteger(Math.round(amount * 100))
  )
    return { error: ['recurring.amount-invalid', 'Enter a valid amount.'] };
  if (payload.kind && !['bill', 'subscription'].includes(payload.kind))
    return { error: ['recurring.kind-invalid', 'Choose bill or subscription.'] };
  if (!/^[A-Z]{3}$/.test(currency))
    return { error: ['recurring.currency-invalid', 'Use a three-letter currency code.'] };
  if (!dueDate) return { error: ['recurring.date-invalid', 'Choose a valid due date.'] };
  if (asString(payload.endDate) && (!endDate || endDate < dueDate)) {
    return {
      error: [
        'recurring.end-date-invalid',
        'The end date must be a real date on or after the first due date.'
      ]
    };
  }
  if (
    payload.frequency &&
    !/^(?:weekly|every 2 weeks|every two weeks|biweekly|monthly|quarterly|yearly|annual|annually|one-time|one time|once)$/i.test(
      asString(payload.frequency)
    )
  ) {
    return {
      error: [
        'recurring.frequency-invalid',
        'Choose Weekly, Every 2 Weeks, Monthly, Quarterly, Yearly, or One-time.'
      ]
    };
  }
  if (!(category && ['expense', 'debt'].includes(category.type) && category.isActive !== false)) {
    return { error: ['recurring.category-invalid', 'Pick an active expense or debt category.'] };
  }
  if (category.type === 'debt' && payload.kind === 'subscription') {
    return {
      error: [
        'recurring.debt-subscription-invalid',
        'Track a card statement or loan payment as a bill, not a subscription.'
      ]
    };
  }
  if (
    accountId &&
    !(account && ['asset', 'liability'].includes(account.group) && account.isActive !== false)
  ) {
    return {
      error: ['recurring.account-invalid', 'Pick an active asset or liability payment account.']
    };
  }
  if (category.type === 'debt' && !(account && account.group === 'liability')) {
    return {
      error: [
        'recurring.liability-account-required',
        'Choose the credit card or liability this recurring bill will settle.'
      ]
    };
  }
  if (
    currency === 'USD' &&
    asString(workbook.currency).toUpperCase() === 'PHP' &&
    !(Number(workbook.settings && workbook.settings.usdToBaseRate) > 0)
  ) {
    return {
      error: [
        'recurring.exchange-rate-required',
        'Set a USD to PHP rate before tracking USD bills.'
      ]
    };
  }
  return { name, amount, dueDate, endDate, category, account, currency };
}

function recurringScope(payload) {
  const scope = asString(payload.scope) || 'series';
  const monthKey = normalizeRecurringMonthKey(payload.monthKey);
  if (!['series', 'month', 'from_month'].includes(scope))
    return {
      error: [
        'recurring.scope-invalid',
        'Choose series, month, or from_month for this tracker change.'
      ]
    };
  if (scope === 'series' && asString(payload.monthKey))
    return {
      error: [
        'recurring.scope-required',
        'Choose month or from_month when targeting a specific month.'
      ]
    };
  if (scope !== 'series' && !monthKey)
    return { error: ['recurring.month-required', 'Choose a concrete month in YYYY-MM format.'] };
  return { scope, monthKey };
}

function withoutFutureFields(schedule, monthKey, fields) {
  return Object.fromEntries(
    Object.entries(normalizeRecurringScheduleMap(schedule)).flatMap(([month, patch]) => {
      const nextPatch = { ...patch };
      if (month >= monthKey) fields.forEach((field) => delete nextPatch[field]);
      return Object.keys(nextPatch).length ? [[month, nextPatch]] : [];
    })
  );
}

function saveScopedRecurringItem(workbook, existing, normalized, payload, target) {
  if (existing.isActive === false)
    return fail(
      workbook,
      'recurring.inactive',
      'Restore the tracker before changing an individual month.'
    );
  const fields = asArray(payload.changedFields).length
    ? payload.changedFields
    : Object.keys(payload);
  const changed = new Set(
    fields.map(
      (field) =>
        ({ dueDate: 'anchorDate', category: 'categoryId', account: 'accountId' })[field] || field
    )
  );
  if (
    target.scope === 'month' &&
    ['frequency', 'endDate', 'autoRenew'].some((field) => changed.has(field))
  ) {
    return fail(
      workbook,
      'recurring.month-schedule-invalid',
      'A single-month change can adjust its amount, due date, account, category, name, note, or skipped status. Change the series to adjust cadence or its end date.'
    );
  }
  const occurrences = getRecurringOccurrenceDatesForMonth(existing, target.monthKey);
  const restoringSkippedMonth =
    changed.has('isActive') &&
    payload.isActive === true &&
    existing.monthOverrides?.[target.monthKey]?.isActive === false;
  if (target.scope === 'month' && !occurrences.length && !restoringSkippedMonth)
    return fail(
      workbook,
      'recurring.month-not-scheduled',
      'This tracker has no scheduled occurrence in that month.'
    );
  if (changed.has('anchorDate') && normalized.anchorDate.slice(0, 7) !== target.monthKey)
    return fail(
      workbook,
      'recurring.month-date-mismatch',
      'The changed due date must fall in the selected month.'
    );
  if (target.scope === 'month' && changed.has('anchorDate') && occurrences.length > 1)
    return fail(
      workbook,
      'recurring.multiple-occurrences',
      'This month has several scheduled charges. Change their amount together, or specify a series schedule change instead of replacing several due dates with one.'
    );
  const mapKey = target.scope === 'month' ? 'monthOverrides' : 'scheduleChanges';
  const patch = Object.fromEntries(
    Object.entries(normalized).filter(
      ([field]) =>
        changed.has(field) &&
        !['id', 'monthOverrides', 'scheduleChanges', 'createdFromTransactionId'].includes(field)
    )
  );
  if (!Object.keys(patch).length)
    return fail(
      workbook,
      'recurring.change-required',
      'Specify what should change for this tracker.'
    );
  const next = cloneSerializable(workbook);
  const item = next.recurringItems.find((entry) => entry.id === existing.id);
  if (target.scope === 'from_month') {
    const replacedFields = Object.keys(patch);
    item.scheduleChanges = withoutFutureFields(
      item.scheduleChanges,
      target.monthKey,
      replacedFields
    );
    item.monthOverrides = withoutFutureFields(item.monthOverrides, target.monthKey, replacedFields);
  }
  item[mapKey] = {
    ...normalizeRecurringScheduleMap(item[mapKey]),
    [target.monthKey]: { ...normalizeRecurringScheduleMap(item[mapKey])[target.monthKey], ...patch }
  };
  return ok(next, [
    { type: 'recurring/item-updated', payload: { recurringItemId: existing.id, ...target } },
    { type: 'schedule-save' }
  ]);
}

function saveRecurringItem(workbook, payload, dependencies) {
  const target = recurringScope(payload);
  if (target.error) return fail(workbook, ...target.error);
  const validation = validateRecurringInput(workbook, payload);
  if (validation.error) return fail(workbook, validation.error[0], validation.error[1]);
  const recurringItemId = asString(payload.recurringItemId);
  const existing = recurringItemId
    ? asArray(workbook.recurringItems).find((item) => item && item.id === recurringItemId)
    : null;
  if (recurringItemId && !existing) {
    return fail(workbook, 'recurring.not-found', 'The recurring item no longer exists.');
  }
  if (!existing && target.scope !== 'series')
    return fail(
      workbook,
      'recurring.create-scope-invalid',
      'Set the first due date and optional end date when creating a tracker. Use One-time for this month only.'
    );
  const nextWorkbook = cloneSerializable(workbook);
  nextWorkbook.recurringItems = asArray(nextWorkbook.recurringItems);
  const index = existing
    ? nextWorkbook.recurringItems.findIndex((item) => item.id === recurringItemId)
    : nextWorkbook.recurringItems.length;
  const normalized = normalizeRecurringItemForCommand(
    {
      ...existing,
      id: existing ? recurringItemId : createRecurringId(nextWorkbook, dependencies),
      kind: normalizeRecurringKind(payload.kind),
      name: validation.name,
      categoryId: validation.category.id,
      counterpartyId: asString(payload.counterpartyId || (existing && existing.counterpartyId)),
      accountId: validation.account ? validation.account.id : '',
      amount: validation.amount,
      currency: validation.currency,
      frequency: asString(payload.frequency) || 'Monthly',
      anchorDate: validation.dueDate,
      endDate: Object.hasOwn(payload, 'endDate') ? validation.endDate : asString(existing?.endDate),
      autoRenew: payload.autoRenew === true,
      isActive: payload.isActive !== false,
      note: asString(payload.note),
      createdFromTransactionId: asString(existing && existing.createdFromTransactionId)
    },
    index,
    nextWorkbook.currency,
    {
      createId: getIdFactory(dependencies) || undefined,
      defaultDate: validation.dueDate
    }
  );
  if (existing && target.scope !== 'series')
    return saveScopedRecurringItem(workbook, existing, normalized, payload, target);
  if (existing) nextWorkbook.recurringItems[index] = normalized;
  else nextWorkbook.recurringItems.push(normalized);
  return ok(nextWorkbook, [
    {
      type: existing ? 'recurring/item-updated' : 'recurring/item-created',
      payload: { recurringItemId: normalized.id }
    },
    { type: 'close-modal' },
    { type: 'schedule-save' }
  ]);
}

function archiveRecurringItem(workbook, payload) {
  const target = recurringScope(payload);
  if (target.error) return fail(workbook, ...target.error);
  const recurringItemId = asString(payload.recurringItemId);
  const current = asArray(workbook.recurringItems).find(
    (item) => item && item.id === recurringItemId
  );
  if (!current) return fail(workbook, 'recurring.not-found', 'Choose an existing recurring item.');
  if (
    target.scope === 'month' &&
    !getRecurringOccurrenceDatesForMonth(current, target.monthKey).length
  )
    return fail(
      workbook,
      'recurring.month-not-scheduled',
      'This tracker has no scheduled occurrence in that month.'
    );
  const nextWorkbook = cloneSerializable(workbook);
  const item = nextWorkbook.recurringItems.find((entry) => entry.id === recurringItemId);
  if (target.scope === 'series') item.isActive = false;
  else if (target.scope === 'month')
    item.monthOverrides = {
      ...normalizeRecurringScheduleMap(item.monthOverrides),
      [target.monthKey]: {
        ...normalizeRecurringScheduleMap(item.monthOverrides)[target.monthKey],
        isActive: false
      }
    };
  else {
    item.scheduleChanges = {
      ...withoutFutureFields(item.scheduleChanges, target.monthKey, ['isActive']),
      [target.monthKey]: {
        ...normalizeRecurringScheduleMap(item.scheduleChanges)[target.monthKey],
        isActive: false
      }
    };
    // A prior one-month restoration must not reopen a tracker after this stop date.
    item.monthOverrides = withoutFutureFields(item.monthOverrides, target.monthKey, ['isActive']);
  }
  return ok(nextWorkbook, [
    { type: 'recurring/item-archived', payload: { recurringItemId, ...target } },
    { type: 'close-modal' },
    { type: 'schedule-save' }
  ]);
}

function restoreRecurringItem(workbook, payload) {
  const recurringItemId = asString(payload.recurringItemId);
  const current = asArray(workbook.recurringItems).find(
    (item) => item && item.id === recurringItemId
  );
  if (!current) return fail(workbook, 'recurring.not-found', 'Choose an existing recurring item.');
  const nextWorkbook = cloneSerializable(workbook);
  const item = nextWorkbook.recurringItems.find((entry) => entry.id === recurringItemId);
  item.isActive = true;
  return ok(nextWorkbook, [
    { type: 'recurring/item-restored', payload: { recurringItemId } },
    { type: 'schedule-save' },
    { type: 'render' }
  ]);
}

function decideRecurringMatch(workbook, payload, decision, dependencies) {
  const services = {
    createId: getIdFactory(dependencies) || undefined,
    now:
      dependencies && dependencies.clock && typeof dependencies.clock.now === 'function'
        ? dependencies.clock.now
        : dependencies && dependencies.now
  };
  const command =
    decision === 'matched'
      ? confirmRecurringReconciliationCommand(
          workbook,
          { ...payload, decision, method: 'manual' },
          services
        )
      : rejectRecurringReconciliationCommand(
          workbook,
          { ...payload, decision, method: 'manual' },
          services
        );
  if (!command.ok) {
    return fail(
      workbook,
      asString(command.error && command.error.code) || 'recurring.reconciliation-failed',
      asString(command.error && command.error.message) ||
        'The transaction match could not be saved.'
    );
  }
  return ok(command.workbook, [
    {
      type:
        decision === 'matched'
          ? 'recurring/reconciliation-confirmed'
          : 'recurring/reconciliation-rejected',
      payload: {
        recurringItemId: asString(payload.recurringItemId),
        occurrenceDate: asString(payload.occurrenceDate),
        transactionId: asString(payload.transactionId)
      }
    },
    { type: 'schedule-save' },
    { type: 'render' }
  ]);
}

function defaultAdvisorIntent(operation, payload) {
  return {
    type: `advisor/${operation}-requested`,
    payload: cloneSerializable(payload)
  };
}

function viewStateEvent(patch) {
  return {
    type: 'bills/view-state-change-requested',
    payload: { patch: cloneSerializable(patch) }
  };
}

export function createBillsController(dependencies = {}) {
  const advisorIntent =
    typeof dependencies.advisorIntent === 'function'
      ? dependencies.advisorIntent
      : defaultAdvisorIntent;
  const modelDependencies = {
    clock: dependencies.clock,
    currentDate: dependencies.currentDate
  };
  const buildBaseModel =
    typeof dependencies.buildBaseModel === 'function'
      ? dependencies.buildBaseModel
      : buildBillsRouteBaseModel;
  const buildModelFromBase =
    typeof dependencies.buildModelFromBase === 'function'
      ? dependencies.buildModelFromBase
      : buildBillsRouteModelFromBase;
  let cachedBaseModel = null;
  let cachedWorkbook = null;
  let cachedBaseKey = '';
  return {
    buildModel(workbook, viewState = {}) {
      const baseKey = getBillsRouteBaseCacheKey(viewState, modelDependencies);
      if (cachedWorkbook !== workbook || cachedBaseKey !== baseKey) {
        cachedBaseModel = buildBaseModel(workbook, viewState, modelDependencies);
        cachedWorkbook = workbook;
        cachedBaseKey = baseKey;
      }
      return buildModelFromBase(workbook, cachedBaseModel, viewState);
    },
    handleAction(workbook, action, context = {}) {
      if (!workbook || typeof workbook !== 'object' || Array.isArray(workbook)) {
        return fail(
          workbook,
          'recurring.workbook-required',
          'Open a workbook before changing recurring items.'
        );
      }
      const type = asString(action && action.type);
      const payload = asObject(action && action.payload);
      const viewState = asObject(context.viewState);
      try {
        if ([BILLS_ACTIONS.saveRecurring, 'recurring/create', 'recurring/update'].includes(type)) {
          return saveRecurringItem(workbook, payload, dependencies);
        }
        if ([BILLS_ACTIONS.archiveRecurring, 'recurring/archive'].includes(type)) {
          return archiveRecurringItem(workbook, payload);
        }
        if ([BILLS_ACTIONS.restoreRecurring, 'recurring/restore'].includes(type)) {
          return restoreRecurringItem(workbook, payload);
        }
        if (type === BILLS_ACTIONS.confirmMatch) {
          return decideRecurringMatch(workbook, payload, 'matched', dependencies);
        }
        if (type === BILLS_ACTIONS.rejectMatch || type === BILLS_ACTIONS.undoMatch) {
          return decideRecurringMatch(workbook, payload, 'rejected', dependencies);
        }
        if (type === BILLS_ACTIONS.scan) {
          const event = advisorIntent('recurring-scan', {
            workbookId: asString(workbook.id),
            sheetId: asString(payload.sheetId || viewState.sheetId),
            includeIgnored: payload.includeIgnored === true
          });
          return event && asString(event.type)
            ? ok(workbook, [event])
            : fail(
                workbook,
                'recurring.scan-intent-invalid',
                'The Advisor scan adapter returned an invalid event.'
              );
        }
        if (type === 'set-bills-sheet')
          return ok(workbook, [viewStateEvent({ sheetId: asString(payload.value), page: 1 })]);
        if (type === 'set-bills-kind')
          return ok(workbook, [
            viewStateEvent({ filterKind: asString(payload.billsKind), page: 1 })
          ]);
        if (type === 'set-bills-status')
          return ok(workbook, [viewStateEvent({ status: asString(payload.billsStatus), page: 1 })]);
        if (type === 'set-bills-sort')
          return ok(workbook, [viewStateEvent({ sort: asString(payload.value), page: 1 })]);
        if (type === 'set-bills-rows-per-page')
          return ok(workbook, [
            viewStateEvent({ rowsPerPage: Number(payload.value) || 10, page: 1 })
          ]);
        if (type === 'toggle-bills-filter')
          return ok(workbook, [viewStateEvent({ filterOpen: !viewState.filterOpen })]);
        if (type === 'reset-bills-filter') {
          return ok(workbook, [
            viewStateEvent({
              accountId: '',
              categoryId: '',
              status: 'all',
              date: '',
              search: '',
              page: 1
            })
          ]);
        }
        if (type === 'apply-bills-filter') {
          return ok(workbook, [
            viewStateEvent({
              accountId: asString(payload.accountId),
              categoryId: asString(payload.categoryId),
              status: asString(payload.status) || 'all',
              date: asString(payload.date),
              search: asString(payload.search),
              page: 1
            })
          ]);
        }
        if (type === 'bills-prev-page')
          return ok(workbook, [
            viewStateEvent({ page: Math.max(1, Number(payload.page || viewState.page) - 1) })
          ]);
        if (type === 'bills-first-page') return ok(workbook, [viewStateEvent({ page: 1 })]);
        if (type === 'bills-next-page')
          return ok(workbook, [
            viewStateEvent({ page: Math.max(1, Number(payload.page || viewState.page || 1) + 1) })
          ]);
        if (type === 'open-bill-subscription') {
          return ok(workbook, [
            { type: 'recurring/editor-requested', payload: cloneSerializable(payload) }
          ]);
        }
        if (type === 'pay-bill-row') {
          return ok(workbook, [
            { type: 'recurring/payment-requested', payload: cloneSerializable(payload) }
          ]);
        }
        if (type === 'open-transaction-detail') {
          return ok(workbook, [
            {
              type: 'transactions/detail-requested',
              payload: { transactionId: asString(payload.transactionId) }
            }
          ]);
        }
        return fail(
          workbook,
          'recurring.action-unsupported',
          `Unsupported recurring action "${type || 'empty'}".`
        );
      } catch (error) {
        return fail(
          workbook,
          'recurring.action-failed',
          asString(error && error.message) || 'The recurring action could not be completed.'
        );
      }
    }
  };
}
