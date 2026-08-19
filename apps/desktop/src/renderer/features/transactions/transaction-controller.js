import { useCallback, useMemo, useState } from 'react';
import {
  deleteLedgerTransactionCommand,
  submitManualTransactionCommand,
  validateTransactionTableViewState
} from '@cavalry/finance-core';

import {
  applyCsvImportPreviewCommand,
  buildCsvFileRequestIntent,
  buildTransactionExportIntent,
  cancelCsvImportPreviewCommand,
  createCsvImportSession
} from '../import-export/import-export-controller.js';
import {
  buildTransactionComposerDraft,
  buildTransactionFeatureModel
} from './transaction-model.js';

const EMPTY_TRANSACTION_MODEL = Object.freeze({});

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const CREATE_TRANSACTION_TYPE_CHOICES = Object.freeze([
  'expense_paid',
  'income_received',
  'merchant_refund',
  'transfer'
]);
const CREATE_TRANSACTION_TEMPLATES = Object.freeze([
  ...CREATE_TRANSACTION_TYPE_CHOICES,
  'expense_charged'
]);

function createTransactionKind(template) {
  if (template === 'expense_paid' || template === 'expense_charged') return 'expense';
  if (template === 'income_received') return 'income';
  if (template === 'merchant_refund') return 'refund';
  if (template === 'transfer') return 'transfer';
  return '';
}

function isCreditCardAccount(account) {
  const subtype = asString(account && account.subtype).toLowerCase();
  const details = asObject(account && account.details);
  return !!(
    account &&
    account.group === 'liability' &&
    (['credit_card', 'card'].includes(subtype) ||
      asString(account.icon).toLowerCase() === 'credit_card' ||
      details.creditLimit != null ||
      details.cardNetwork ||
      /credit\s*card/i.test(asString(account.name)))
  );
}

function findWorkbookItem(items, id) {
  const targetId = asString(id);
  return asArray(items).find((item) => asString(item && item.id) === targetId) || null;
}

function parseAmount(value) {
  return Number(asString(value).replace(/,/g, '').trim()) || 0;
}

function composerIssue(code, field, message) {
  return { code, field, message };
}

function validateCreateComposerDetails(workbook, draft) {
  const template = asString(draft && draft.template);
  const issues = [];
  if (!CREATE_TRANSACTION_TEMPLATES.includes(template)) {
    return [
      composerIssue(
        'invalid_transaction_type',
        'template',
        'Choose Income, Expense, Refund, or Transfer.'
      )
    ];
  }

  if (!(parseAmount(draft && draft.amount) > 0)) {
    issues.push(composerIssue('invalid_amount', 'amount', 'Enter a valid amount.'));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asString(draft && draft.date))) {
    issues.push(
      composerIssue('invalid_transaction_date', 'date', 'Enter a valid transaction date.')
    );
  }

  const primaryAccount = findWorkbookItem(
    workbook && workbook.accounts,
    draft && draft.primaryAccountId
  );
  const secondaryAccount = findWorkbookItem(
    workbook && workbook.accounts,
    draft && draft.secondaryAccountId
  );
  const category = findWorkbookItem(workbook && workbook.categories, draft && draft.categoryId);

  if (template === 'income_received') {
    if (!(primaryAccount && primaryAccount.group === 'asset')) {
      issues.push(
        composerIssue(
          'invalid_income_account',
          'primaryAccountId',
          'Choose an asset account to receive the income.'
        )
      );
    }
    if (!(category && category.type === 'income')) {
      issues.push(composerIssue('invalid_income_category', 'categoryId', 'Pick an income source.'));
    }
  }

  if (template === 'merchant_refund') {
    if (!(primaryAccount && ['asset', 'liability'].includes(primaryAccount.group))) {
      issues.push(
        composerIssue(
          'invalid_refund_account',
          'primaryAccountId',
          'Choose the cash account, bank account, e-wallet, or credit card that received the refund.'
        )
      );
    }
    if (!(category && category.type === 'expense')) {
      issues.push(
        composerIssue(
          'invalid_refund_category',
          'categoryId',
          'Pick the original expense category so the refund reduces the correct spending total.'
        )
      );
    }
    if (
      asString(workbook && workbook.currency).toUpperCase() === 'PHP' &&
      asString(draft && draft.currency).toUpperCase() === 'USD' &&
      !(parseAmount(draft && draft.fxRateToBase) > 0)
    ) {
      issues.push(
        composerIssue(
          'missing_usd_refund_rate',
          'fxRateToBase',
          'Set the USD to PHP rate used for this refund.'
        )
      );
    }
  }

  if (template === 'expense_paid' || template === 'expense_charged') {
    const accountIsValid =
      template === 'expense_charged'
        ? isCreditCardAccount(primaryAccount)
        : primaryAccount && primaryAccount.group === 'asset';
    if (!accountIsValid) {
      issues.push(
        composerIssue(
          'invalid_expense_account',
          'primaryAccountId',
          template === 'expense_charged'
            ? 'Choose a credit card for this purchase.'
            : 'Choose a cash, bank, or e-wallet account to fund the payment.'
        )
      );
    }
    if (!(category && category.type === 'expense')) {
      issues.push(
        composerIssue('invalid_expense_category', 'categoryId', 'Pick an expense category.')
      );
    }
    if (
      asString(workbook && workbook.currency).toUpperCase() === 'PHP' &&
      asString(draft && draft.currency).toUpperCase() === 'USD' &&
      !(parseAmount(draft && draft.fxRateToBase) > 0)
    ) {
      issues.push(
        composerIssue(
          'missing_usd_expense_rate',
          'fxRateToBase',
          'Set a USD to PHP rate before reviewing this expense.'
        )
      );
    }
  }

  if (template === 'transfer') {
    const primaryIsBalanceAccount =
      primaryAccount && ['asset', 'liability'].includes(primaryAccount.group);
    const secondaryIsBalanceAccount =
      secondaryAccount && ['asset', 'liability'].includes(secondaryAccount.group);
    if (!(
      primaryIsBalanceAccount &&
      secondaryIsBalanceAccount &&
      primaryAccount.id !== secondaryAccount.id
    )) {
      issues.push(
        composerIssue(
          'invalid_transfer_accounts',
          'secondaryAccountId',
          'Choose two different accounts for the transfer.'
        )
      );
    }
  }

  const transactionCurrency =
    asString(draft && draft.currency).toUpperCase() ||
    asString(workbook && workbook.currency).toUpperCase() ||
    'PHP';
  const selectedBalanceAccounts = [primaryAccount, secondaryAccount].filter(
    (account) => account && ['asset', 'liability'].includes(account.group)
  );
  const requiresAccountCurrencyConversion = selectedBalanceAccounts.some(
    (account) =>
      (asString(account.currency).toUpperCase() || transactionCurrency) !== transactionCurrency
  );
  if (
    requiresAccountCurrencyConversion &&
    !(parseAmount(draft && draft.fxRateToBase) > 0) &&
    !issues.some((item) => item.code === 'missing_usd_expense_rate')
  ) {
    issues.push(
      composerIssue(
        'account_currency_conversion_rate_required',
        'fxRateToBase',
        'Enter the exchange rate used before reviewing this cross-currency transaction.'
      )
    );
  }

  return issues;
}

function controllerOutcome(state, options = {}) {
  return {
    state,
    commandResult: options.commandResult || null,
    intents: asArray(options.intents),
    handled: options.handled !== false
  };
}

export function createTransactionControllerState(initialState = {}) {
  const source = asObject(initialState);
  return {
    view: validateTransactionTableViewState({
      type: 'all',
      page: 1,
      pageSize: 12,
      sort: { key: 'date', direction: 'desc' },
      ...asObject(source.view)
    }),
    filterOpen: !!source.filterOpen,
    modal: source.modal || null,
    importSession: source.importSession || null
  };
}

function updateView(state, patch) {
  return {
    ...state,
    view: validateTransactionTableViewState({
      ...state.view,
      ...patch,
      sort: patch && patch.sort ? patch.sort : state.view.sort
    })
  };
}

function updateComposer(state, update) {
  if (!(state.modal && state.modal.type === 'composer')) {
    return state;
  }
  return {
    ...state,
    modal: {
      ...state.modal,
      draft: { ...state.modal.draft, ...update },
      errors: [],
      warnings: []
    }
  };
}

function updateComposerField(workbook, state, field, value) {
  const update = { [field]: value };
  const draft = state.modal && state.modal.type === 'composer' ? state.modal.draft : null;
  if (
    draft &&
    !draft.transactionId &&
    field === 'primaryAccountId' &&
    createTransactionKind(draft.template) === 'expense'
  ) {
    const account = findWorkbookItem(workbook && workbook.accounts, value);
    update.template = isCreditCardAccount(account) ? 'expense_charged' : 'expense_paid';
  }
  return updateComposer(state, update);
}

function getDefaultDate(services) {
  if (services && typeof services.defaultDate === 'function') {
    return asString(services.defaultDate());
  }
  return asString(services && services.defaultDate);
}

function dayNumberToIso(value) {
  const day = Number(value);
  return Number.isFinite(day) ? new Date(day * 86400000).toISOString().slice(0, 10) : '';
}

function openComposer(workbook, state, transactionId, services, preset = {}) {
  const baseDraft = buildTransactionComposerDraft(workbook, transactionId, {
    defaultDate: getDefaultDate(services)
  });
  const isEdit = !!baseDraft.transactionId;
  const source = asObject(preset);
  const presetFields = [
    'template',
    'amount',
    'currency',
    'date',
    'fxRateToBase',
    'description',
    'categoryId',
    'primaryAccountId',
    'secondaryAccountId',
    'counterpartyId',
    'note',
    'recurringItemId',
    'recurringOccurrenceDate',
    'recurringTrackingMode',
    'sourceRoute'
  ];
  const supplied = presetFields.reduce((values, field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) values[field] = source[field];
    return values;
  }, {});
  const hasPreset = !isEdit && Object.keys(supplied).length > 0;
  const draft = isEdit ? baseDraft : { ...baseDraft, ...supplied };
  return {
    ...state,
    modal: {
      type: 'composer',
      step: isEdit ? 'edit' : hasPreset ? 'details' : 'type',
      draft: isEdit || hasPreset ? draft : { ...draft, template: '' },
      errors: [],
      warnings: []
    }
  };
}

function chooseCreateTransactionType(state, template) {
  if (!(state.modal && state.modal.type === 'composer' && !state.modal.draft.transactionId)) {
    return state;
  }
  if (!CREATE_TRANSACTION_TYPE_CHOICES.includes(template)) {
    return {
      ...state,
      modal: {
        ...state.modal,
        errors: [
          composerIssue(
            'invalid_transaction_type',
            'template',
            'Choose Income, Expense, Refund, or Transfer.'
          )
        ],
        warnings: []
      }
    };
  }
  const previousTemplate = asString(state.modal.draft.template);
  const typeChanged = createTransactionKind(previousTemplate) !== createTransactionKind(template);
  const resolvedTemplate =
    !typeChanged && createTransactionKind(template) === 'expense'
      ? previousTemplate || template
      : template;
  return {
    ...state,
    modal: {
      ...state.modal,
      step: 'details',
      draft: {
        ...state.modal.draft,
        template: resolvedTemplate,
        categoryId: typeChanged ? '' : state.modal.draft.categoryId,
        primaryAccountId: typeChanged ? '' : state.modal.draft.primaryAccountId,
        secondaryAccountId:
          resolvedTemplate === 'transfer' && !typeChanged
            ? state.modal.draft.secondaryAccountId
            : '',
        description:
          typeChanged || resolvedTemplate === 'transfer' ? '' : state.modal.draft.description || ''
      },
      errors: [],
      warnings: []
    }
  };
}

function advanceCreateComposer(workbook, state) {
  if (!(state.modal && state.modal.type === 'composer' && !state.modal.draft.transactionId)) {
    return state;
  }
  const errors = validateCreateComposerDetails(workbook, state.modal.draft);
  return {
    ...state,
    modal: {
      ...state.modal,
      step: errors.length ? 'details' : 'review',
      errors,
      warnings: []
    }
  };
}

function moveCreateComposerBack(state) {
  if (!(state.modal && state.modal.type === 'composer' && !state.modal.draft.transactionId)) {
    return state;
  }
  return {
    ...state,
    modal: {
      ...state.modal,
      step: state.modal.step === 'review' ? 'details' : 'type',
      errors: [],
      warnings: []
    }
  };
}

function submitComposer(workbook, state, services, approvals = {}) {
  if (!(state.modal && state.modal.type === 'composer')) {
    return controllerOutcome(state);
  }
  const draft = state.modal.draft;
  if (!draft.transactionId && state.modal.step !== 'review') {
    return controllerOutcome(state);
  }
  const result = submitManualTransactionCommand(
    workbook,
    {
      ...draft,
      // finance-core's compatibility submit intent still names this historical
      // expense-rate field `usdExpenseRate`; keep the renderer model provider-neutral.
      usdExpenseRate: draft.fxRateToBase,
      allowDuplicate: approvals.allowDuplicate === true || draft.allowDuplicate === true,
      allowCurrencyConversion:
        approvals.allowCurrencyConversion === true || draft.allowCurrencyConversion === true
    },
    services
  );
  const changedWorkbook = result.ok && result.workbook && result.workbook !== workbook;
  if (changedWorkbook) {
    return controllerOutcome(
      {
        ...updateView(state, { page: 1 }),
        modal: null
      },
      { commandResult: result }
    );
  }
  return controllerOutcome(
    {
      ...state,
      modal: {
        ...state.modal,
        draft: {
          ...state.modal.draft,
          allowDuplicate: asArray(result.warnings).some(
            (warning) => warning?.code === 'possible_duplicate_transaction'
          ),
          allowCurrencyConversion: asArray(result.warnings).some(
            (warning) => warning?.code === 'account_currency_conversion_confirmation_required'
          )
        },
        errors: asArray(result.errors),
        warnings: asArray(result.warnings)
      }
    },
    { commandResult: result }
  );
}

export function reduceTransactionControllerAction(workbook, currentState, action, services = {}) {
  const state = createTransactionControllerState(currentState);
  const descriptor = asObject(action);
  const payload = asObject(descriptor.payload);
  switch (descriptor.type) {
    case 'set-ledger-type':
      return controllerOutcome(
        updateView(state, {
          type: payload.ledgerType || payload.value || 'all',
          page: 1
        })
      );
    case 'toggle-ledger-filter':
      return controllerOutcome({ ...state, filterOpen: !state.filterOpen });
    case 'reset-ledger-filter':
      return controllerOutcome({
        ...updateView(state, {
          type: 'all',
          accountId: '',
          categoryId: '',
          search: '',
          minAmount: '',
          maxAmount: '',
          start: '',
          end: '',
          dateRange: { start: '', end: '' },
          sort: { key: 'date', direction: 'desc' },
          page: 1
        }),
        filterOpen: false
      });
    case 'set-ledger-filter-account':
      return controllerOutcome(updateView(state, { accountId: payload.value || '', page: 1 }));
    case 'open-account-transactions':
      return controllerOutcome({
        ...updateView(state, { accountId: payload.accountId || '', page: 1 }),
        filterOpen: false
      });
    case 'set-ledger-filter-category':
      return controllerOutcome(updateView(state, { categoryId: payload.value || '', page: 1 }));
    case 'set-ledger-filter-search':
      return controllerOutcome(updateView(state, { search: payload.value || '', page: 1 }));
    case 'set-ledger-filter-min-amount':
      return controllerOutcome(updateView(state, { minAmount: payload.value || '', page: 1 }));
    case 'set-ledger-filter-max-amount':
      return controllerOutcome(updateView(state, { maxAmount: payload.value || '', page: 1 }));
    case 'set-ledger-filter-start':
      return controllerOutcome(updateView(state, { start: payload.value || '', page: 1 }));
    case 'set-ledger-filter-end':
      return controllerOutcome(updateView(state, { end: payload.value || '', page: 1 }));
    case 'set-ledger-filter-start-day':
      return controllerOutcome(
        updateView(state, { start: dayNumberToIso(payload.value), page: 1 })
      );
    case 'set-ledger-filter-end-day':
      return controllerOutcome(updateView(state, { end: dayNumberToIso(payload.value), page: 1 }));
    case 'set-ledger-sort-key':
      return controllerOutcome(
        updateView(state, {
          sort: { ...state.view.sort, key: payload.value || 'date' },
          page: 1
        })
      );
    case 'toggle-ledger-sort-direction':
      return controllerOutcome(
        updateView(state, {
          sort: {
            ...state.view.sort,
            direction: state.view.sort.direction === 'asc' ? 'desc' : 'asc'
          },
          page: 1
        })
      );
    case 'set-ledger-page-size':
      return controllerOutcome(
        updateView(state, { pageSize: Number(payload.value) || 12, page: 1 })
      );
    case 'ledger-prev-page':
      return controllerOutcome(updateView(state, { page: Math.max(1, state.view.page - 1) }));
    case 'ledger-first-page':
      return controllerOutcome(updateView(state, { page: 1 }));
    case 'ledger-next-page':
      return controllerOutcome(updateView(state, { page: state.view.page + 1 }));
    case 'open-ledger-composer':
      return controllerOutcome(openComposer(workbook, state, '', services, payload));
    case 'open-transaction-editor':
      return controllerOutcome(openComposer(workbook, state, payload.transactionId, services));
    case 'open-transaction-detail':
      return controllerOutcome({
        ...state,
        modal: { type: 'detail', transactionId: payload.transactionId }
      });
    case 'delete-transaction':
      return controllerOutcome({
        ...state,
        modal: { type: 'delete', transactionId: payload.transactionId, errors: [] }
      });
    case 'transaction-composer-change':
      return controllerOutcome(updateComposerField(workbook, state, payload.field, payload.value));
    case 'choose-transaction-type':
      return controllerOutcome(chooseCreateTransactionType(state, asString(payload.template)));
    case 'review-transaction':
      return controllerOutcome(advanceCreateComposer(workbook, state));
    case 'edit-transaction-details':
      return controllerOutcome(
        state.modal && state.modal.type === 'composer' && !state.modal.draft.transactionId
          ? {
              ...state,
              modal: { ...state.modal, step: 'details', errors: [], warnings: [] }
            }
          : state
      );
    case 'transaction-composer-back':
      return controllerOutcome(moveCreateComposerBack(state));
    case 'submit-transaction':
      return submitComposer(workbook, state, services);
    case 'confirm-duplicate-transaction':
      return submitComposer(workbook, state, services, { allowDuplicate: true });
    case 'confirm-transaction-warnings':
      return submitComposer(workbook, state, services, {
        allowDuplicate: true,
        allowCurrencyConversion: true
      });
    case 'confirm-delete-transaction': {
      const transactionId = payload.transactionId || (state.modal && state.modal.transactionId);
      const result = deleteLedgerTransactionCommand(workbook, transactionId);
      if (result.ok && result.workbook && result.workbook !== workbook) {
        return controllerOutcome({ ...state, modal: null }, { commandResult: result });
      }
      return controllerOutcome(
        {
          ...state,
          modal: state.modal ? { ...state.modal, errors: asArray(result.errors) } : null
        },
        { commandResult: result }
      );
    }
    case 'export-workbook':
      return controllerOutcome(state, {
        intents: [buildTransactionExportIntent(workbook, 'workbook-html')]
      });
    case 'export-csv-bundle':
      return controllerOutcome(state, {
        intents: [buildTransactionExportIntent(workbook, 'csv-bundle')]
      });
    case 'trigger-csv-import':
      return controllerOutcome(state, {
        intents: [buildCsvFileRequestIntent()]
      });
    case 'csv-import-preview':
      return controllerOutcome({
        ...state,
        modal: null,
        importSession: createCsvImportSession(workbook, payload)
      });
    case 'apply-csv-import-preview': {
      const result = applyCsvImportPreviewCommand(
        workbook,
        state.importSession,
        payload.options || {}
      );
      if (!result.ok) {
        return controllerOutcome(
          {
            ...state,
            importSession: state.importSession
              ? {
                  ...state.importSession,
                  error: (result.errors[0] && result.errors[0].message) || 'CSV import failed.'
                }
              : null
          },
          { commandResult: result }
        );
      }
      return controllerOutcome(
        {
          ...updateView(state, { page: 1 }),
          importSession: {
            ...state.importSession,
            result: result.importResult,
            error: ''
          }
        },
        { commandResult: result }
      );
    }
    case 'cancel-csv-import-preview': {
      const result = cancelCsvImportPreviewCommand(workbook, state.importSession);
      return controllerOutcome({ ...state, importSession: null }, { commandResult: result });
    }
    case 'close-modal':
      return controllerOutcome({
        ...state,
        modal: null,
        importSession: null
      });
    default:
      return controllerOutcome(state, { handled: false });
  }
}

export function useTransactionController({
  workbook,
  initialState,
  services,
  onCommandResult,
  onIntent,
  onUnhandledAction,
  modelEnabled = true,
  modelBuilder = buildTransactionFeatureModel,
  fallbackModel = EMPTY_TRANSACTION_MODEL
}) {
  const [state, setState] = useState(() => createTransactionControllerState(initialState));
  const model = useMemo(
    () => (modelEnabled ? modelBuilder(workbook || {}, state) : fallbackModel),
    [fallbackModel, modelBuilder, modelEnabled, state, workbook]
  );
  const onAction = useCallback(
    (action) => {
      const outcome = reduceTransactionControllerAction(workbook || {}, state, action, services);
      if (outcome.state !== state) {
        setState(outcome.state);
      }
      if (outcome.commandResult && typeof onCommandResult === 'function') {
        onCommandResult(outcome.commandResult);
      }
      if (typeof onIntent === 'function') {
        outcome.intents.forEach((intent) => onIntent(intent));
      }
      if (!outcome.handled && typeof onUnhandledAction === 'function') {
        onUnhandledAction(action);
      }
      return outcome;
    },
    [onCommandResult, onIntent, onUnhandledAction, services, state, workbook]
  );

  return {
    state,
    model,
    onAction
  };
}
