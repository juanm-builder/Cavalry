import { BUDGET_EVENT_TYPES } from '../features/budgets/budget-controller.js';
import { DASHBOARD_EVENT_TYPES } from '../features/dashboard/dashboard-controller.js';

export const DASHBOARD_ACTIONS = new Set([
  'open-dashboard-category',
  'open-dashboard-flow',
  'open-account-history',
  'open-dashboard-account-group',
  'open-dashboard-month',
  'open-transaction-detail',
  'open-dashboard-customizer',
  'export-workbook'
]);

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

export function asString(value) {
  return String(value == null ? '' : value);
}

function asTrimmedString(value) {
  return asString(value).trim();
}

function firstSourceReference(reference) {
  if (typeof reference === 'string') return reference.trim();
  const source = asObject(reference);
  if (Array.isArray(source.source_refs)) {
    if (source.source_refs.length !== 1) return '';
    const first = source.source_refs[0];
    if (typeof first === 'string') return first.trim();
    const firstObject = asObject(first);
    return asTrimmedString(
      firstObject.ref || firstObject.reference || firstObject.value || firstObject.id
    );
  }
  return asTrimmedString(source.ref || source.reference || source.value);
}

function parseSourceReference(reference) {
  const value = firstSourceReference(reference);
  const entityMatch = /^(account|transaction|category|sheet|recurringItem):([^:]+)$/.exec(value);
  if (entityMatch) {
    try {
      const id = decodeURIComponent(entityMatch[2]);
      return id ? { ok: true, kind: entityMatch[1], id } : { ok: false };
    } catch (_error) {
      return { ok: false };
    }
  }
  const budgetMatch = /^budget:([^:]+):([^:]+)$/.exec(value);
  if (budgetMatch) {
    try {
      const sheetId = decodeURIComponent(budgetMatch[1]);
      const categoryId = decodeURIComponent(budgetMatch[2]);
      return sheetId && categoryId
        ? { ok: true, kind: 'budget', sheetId, categoryId }
        : { ok: false };
    } catch (_error) {
      return { ok: false };
    }
  }
  return { ok: false };
}

function findById(items, id) {
  return asArray(items).find((item) => asTrimmedString(item && item.id) === id) || null;
}

function findBudgetByCategory(sheet, categoryId) {
  const budgets = sheet && sheet.budgets;
  if (Array.isArray(budgets)) {
    return (
      budgets.find((budget) => asTrimmedString(budget && budget.categoryId) === categoryId) || null
    );
  }
  if (
    budgets &&
    typeof budgets === 'object' &&
    Object.prototype.hasOwnProperty.call(budgets, categoryId)
  ) {
    return { categoryId, planned: Number(budgets[categoryId]) || 0 };
  }
  return null;
}

function recurringEditorValues(item, defaultCurrency = 'PHP') {
  const source = asObject(item);
  return {
    recurringItemId: asTrimmedString(source.id),
    kind: asTrimmedString(source.kind) || 'bill',
    name: asString(source.name),
    categoryId: asTrimmedString(source.categoryId),
    accountId: asTrimmedString(source.accountId),
    amount: source.amount ?? source.planned ?? '',
    currency: asTrimmedString(source.currency || defaultCurrency).toUpperCase() || 'PHP',
    frequency: asTrimmedString(source.frequency) || 'Monthly',
    dueDate: asTrimmedString(source.anchorDate || source.dueDate),
    autoRenew: source.autoRenew === true,
    isActive: source.isActive !== false,
    note: asString(source.note)
  };
}

export function firstErrorMessage(result, fallback) {
  const error = asArray(result && result.errors)[0];
  return asString((error && error.message) || fallback);
}

export function translatedEvent(event) {
  const source = asObject(event);
  const payload = asObject(source.payload);
  if (source.type === DASHBOARD_EVENT_TYPES.navigate) {
    return { type: 'navigate', route: payload.routeId };
  }
  if (source.type === BUDGET_EVENT_TYPES.closeEditor) {
    return { type: 'close-overlay', id: payload.id || 'budget-editor' };
  }
  if (source.type === BUDGET_EVENT_TYPES.scheduleSave) {
    return { type: 'schedule-save', reason: payload.reason || 'workbook_changed' };
  }
  return event;
}

export function hasSaveEvent(events) {
  return asArray(events).some(
    (event) =>
      event && (event.type === 'schedule-save' || event.type === BUDGET_EVENT_TYPES.scheduleSave)
  );
}

export function withoutUnchangedWorkbook(result, workbook) {
  if (!(result && Object.prototype.hasOwnProperty.call(result, 'workbook'))) {
    return result;
  }
  if (result.workbook !== workbook) {
    return result;
  }
  const next = { ...result };
  delete next.workbook;
  return next;
}

export function transactionTypeForFlow(flowType) {
  if (flowType === 'inflow' || flowType === 'income') return 'income';
  if (['expense', 'outflow', 'debt', 'savings'].includes(flowType)) return 'expense';
  return 'all';
}

export function applicationStorageIntent(operation, payload) {
  return {
    type: 'application/storage-intent',
    payload: { operation, ...asObject(payload) }
  };
}

export function applicationAdvisorIntent(operation, payload) {
  return {
    type: 'application/advisor-intent',
    payload: { operation, ...asObject(payload) }
  };
}

export function applicationCloudIntent(operation, payload) {
  return {
    type: 'application/cloud-intent',
    payload: { operation, ...asObject(payload) }
  };
}

export function saveStatusLabel(save) {
  const status = asString(save && save.status);
  if (status === 'saving') return 'Saving';
  if (status === 'saved') return 'Saved';
  if (status === 'cache') return 'Saved to browser cache';
  if (status === 'dirty') return 'Unsaved changes';
  if (status === 'error') return 'Save failed';
  return 'Ready';
}

export function assistantProviderLabel(provider) {
  if (provider === 'custom') return 'Local Model';
  if (provider === 'openai') return 'OpenAI / API';
  return 'Not connected';
}

export function safeBuildModel(buildModel, workbook, viewState, fallback) {
  if (!workbook) return fallback || {};
  try {
    return buildModel(workbook, viewState);
  } catch (_error) {
    return fallback || {};
  }
}

export function createAssistantReferenceNavigator({
  workbookRef,
  transactionActionRef,
  navigate,
  reportError,
  setApplicationErrors,
  setBudgetViewState,
  setSelectedAccountId,
  setAccountReferenceRequestKey,
  setCategoryReferenceTarget,
  setBudgetReferenceTarget,
  setRecurringReferenceTarget
}) {
  return (reference) => {
    const fail = (code, message) => {
      reportError('assistant-reference', message, code);
      return { ok: false, code, error: message };
    };
    const parsed = parseSourceReference(reference);
    if (!parsed.ok) {
      return fail(
        'assistant-reference.invalid',
        'This Cavalry reference is incomplete or invalid.'
      );
    }
    const currentWorkbook = workbookRef.current;
    if (!currentWorkbook) {
      return fail(
        'assistant-reference.workbook-required',
        'Open a workbook before following Cavalry references.'
      );
    }

    if (parsed.kind === 'account') {
      if (!findById(currentWorkbook.accounts, parsed.id)) {
        return fail(
          'assistant-reference.account-not-found',
          'This referenced account is no longer available.'
        );
      }
      setSelectedAccountId(parsed.id);
      setAccountReferenceRequestKey((current) => current + 1);
      setApplicationErrors([]);
      navigate('accounts');
      return { ok: true, kind: parsed.kind, id: parsed.id, route: 'accounts' };
    }

    if (parsed.kind === 'transaction') {
      if (!findById(currentWorkbook.transactions, parsed.id)) {
        return fail(
          'assistant-reference.transaction-not-found',
          'This referenced transaction is no longer available.'
        );
      }
      transactionActionRef.current?.({
        type: 'open-transaction-detail',
        payload: { transactionId: parsed.id }
      });
      setApplicationErrors([]);
      navigate('ledger');
      return { ok: true, kind: parsed.kind, id: parsed.id, route: 'ledger' };
    }

    if (parsed.kind === 'category') {
      if (!findById(currentWorkbook.categories, parsed.id)) {
        return fail(
          'assistant-reference.category-not-found',
          'This referenced category is no longer available.'
        );
      }
      setCategoryReferenceTarget((current) => ({
        categoryId: parsed.id,
        requestKey: current.requestKey + 1,
        pending: true
      }));
      setApplicationErrors([]);
      navigate('categories');
      return { ok: true, kind: parsed.kind, id: parsed.id, route: 'categories' };
    }

    if (parsed.kind === 'sheet') {
      if (!findById(currentWorkbook.sheets, parsed.id)) {
        return fail(
          'assistant-reference.sheet-not-found',
          'This referenced budget month is no longer available.'
        );
      }
      setBudgetViewState({ sheetId: parsed.id });
      setBudgetReferenceTarget((current) => ({
        sheetId: parsed.id,
        categoryId: '',
        budget: null,
        category: null,
        requestKey: current.requestKey + 1,
        pending: true
      }));
      setApplicationErrors([]);
      navigate('budgets');
      return { ok: true, kind: parsed.kind, id: parsed.id, route: 'budgets' };
    }

    if (parsed.kind === 'budget') {
      const sheet = findById(currentWorkbook.sheets, parsed.sheetId);
      const category = findById(currentWorkbook.categories, parsed.categoryId);
      const budget = sheet ? findBudgetByCategory(sheet, parsed.categoryId) : null;
      if (!(sheet && category && budget)) {
        return fail(
          'assistant-reference.budget-not-found',
          'This referenced budget is no longer available.'
        );
      }
      setBudgetViewState({ sheetId: parsed.sheetId });
      setBudgetReferenceTarget((current) => ({
        sheetId: parsed.sheetId,
        categoryId: parsed.categoryId,
        budget: { ...budget },
        category: { ...category },
        requestKey: current.requestKey + 1,
        pending: true
      }));
      setApplicationErrors([]);
      navigate('budgets');
      return {
        ok: true,
        kind: parsed.kind,
        sheetId: parsed.sheetId,
        categoryId: parsed.categoryId,
        route: 'budgets'
      };
    }

    if (parsed.kind === 'recurringItem') {
      const item = findById(currentWorkbook.recurringItems, parsed.id);
      if (!item) {
        return fail(
          'assistant-reference.recurring-item-not-found',
          'This referenced bill or subscription is no longer available.'
        );
      }
      setRecurringReferenceTarget((current) => ({
        item: recurringEditorValues(item, currentWorkbook.currency),
        requestKey: current.requestKey + 1,
        pending: true
      }));
      setApplicationErrors([]);
      navigate('bills');
      return { ok: true, kind: parsed.kind, id: parsed.id, route: 'bills' };
    }

    return fail('assistant-reference.unsupported', 'This Cavalry reference cannot be opened.');
  };
}
