import {
  confirmRecurringReconciliationCommand,
  normalizeRecurringItemForCommand,
  normalizeRecurringKind,
  rejectRecurringReconciliationCommand
} from '@cavalry/finance-core';
import {
  buildBillsRouteBaseModel,
  buildBillsRouteModelFromBase,
  getBillsRouteBaseCacheKey
} from './bills-route-model.js';

export const BILLS_ACTIONS = Object.freeze({
  saveRecurring: 'save-recurring-item',
  archiveRecurring: 'archive-recurring-item',
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
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asString(value));
  if (!match) return '';
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? match[0] : '';
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
  const category = asArray(workbook.categories).find(
    (item) => item && item.id === payload.categoryId
  );
  const accountId = asString(payload.accountId);
  const account = accountId
    ? asArray(workbook.accounts).find((item) => item && item.id === accountId)
    : null;
  const currency = asString(payload.currency || workbook.currency).toUpperCase() || 'PHP';
  if (!name) return { error: ['recurring.name-required', 'Name is required.'] };
  if (!Number.isFinite(amount) || amount < 0)
    return { error: ['recurring.amount-invalid', 'Enter a valid amount.'] };
  if (!dueDate) return { error: ['recurring.date-invalid', 'Choose a valid due date.'] };
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
  return { name, amount, dueDate, category, account, currency };
}

function saveRecurringItem(workbook, payload, dependencies) {
  const validation = validateRecurringInput(workbook, payload);
  if (validation.error) return fail(workbook, validation.error[0], validation.error[1]);
  const recurringItemId = asString(payload.recurringItemId);
  const existing = recurringItemId
    ? asArray(workbook.recurringItems).find((item) => item && item.id === recurringItemId)
    : null;
  if (recurringItemId && !existing) {
    return fail(workbook, 'recurring.not-found', 'The recurring item no longer exists.');
  }
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
  const recurringItemId = asString(payload.recurringItemId);
  const current = asArray(workbook.recurringItems).find(
    (item) => item && item.id === recurringItemId
  );
  if (!current) return fail(workbook, 'recurring.not-found', 'Choose an existing recurring item.');
  const nextWorkbook = cloneSerializable(workbook);
  const item = nextWorkbook.recurringItems.find((entry) => entry.id === recurringItemId);
  item.isActive = false;
  return ok(nextWorkbook, [
    { type: 'recurring/item-archived', payload: { recurringItemId } },
    { type: 'close-modal' },
    { type: 'schedule-save' }
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
