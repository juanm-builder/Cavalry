import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BUDGET_EVENT_TYPES,
  createBudgetController
} from '../features/budgets/budget-controller.js';
import {
  createDashboardController,
  DASHBOARD_EVENT_TYPES
} from '../features/dashboard/dashboard-controller.js';
import { buildTransactionExportIntent } from '../features/import-export/import-export-controller.js';
import { createBillsController } from '../features/recurring/bills-controller.js';
import { createSettingsController } from '../features/settings/settings-controller.js';
import { useTransactionController } from '../features/transactions/transaction-controller.js';
import { executeCavalryAssistantTool } from '../features/assistant/cavalry-assistant-tools.js';
import { useCloudWorkbookController } from './use-cloud-workbook-controller.js';
import {
  createAdvisorOperationCoordinator,
  createAdvisorRuntimeProvider,
  createAdvisorServices,
  executeAdvisorApplicationIntent,
  executeAdvisorViewIntent
} from './advisor-application-adapter.js';
import { useCommandExecutor } from './CommandExecutor.jsx';
import { useWorkbookSession } from './WorkbookProvider.jsx';
import { commitAssistantCommandResultDurably } from './assistant-command-commit.js';
import { useAdvisorRuntimeState } from './use-advisor-runtime-state.js';
import { useCategoryAwareRouteActions } from './use-category-aware-route-actions.js';
import {
  applicationAdvisorIntent,
  applicationCloudIntent,
  applicationStorageIntent,
  asArray,
  asObject,
  asString,
  assistantProviderLabel,
  createAssistantReferenceNavigator,
  DASHBOARD_ACTIONS,
  firstErrorMessage,
  hasSaveEvent,
  saveStatusLabel,
  transactionTypeForFlow,
  translatedEvent,
  withoutUnchangedWorkbook
} from './finance-application-controller-helpers.js';
import { useRouteModels } from './use-active-finance-route-models.js';

const EMPTY_ROUTE_MODELS = Object.freeze({});

export function useFinanceApplicationController({
  routeId,
  routeModels = EMPTY_ROUTE_MODELS,
  routeModelBuilders = EMPTY_ROUTE_MODELS,
  onAction
} = {}) {
  const {
    state,
    ports,
    navigate,
    openOverlay,
    closeOverlay,
    openWorkbook,
    saveWorkbook,
    saveWorkbookAs,
    setWorkbook
  } = useWorkbookSession();
  const { executeCommandResult } = useCommandExecutor();
  const workbook = state.workbook;
  const activeRouteId = asString(routeId || state.routeId || 'dashboard');
  const workbookRef = useRef(workbook);
  const transactionActionRef = useRef(null);
  const [advisorOperations] = useState(() => createAdvisorOperationCoordinator());
  useEffect(() => {
    workbookRef.current = workbook;
  }, [workbook]);

  const [dashboardViewState] = useState({});
  const [budgetViewState, setBudgetViewState] = useState({});
  const [billsViewState, setBillsViewState] = useState({
    filterKind: 'all',
    status: 'all',
    sort: 'dueDate',
    page: 1,
    rowsPerPage: 10
  });
  const [settingsViewState, setSettingsViewState] = useState({});
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountReferenceRequestKey, setAccountReferenceRequestKey] = useState(0);
  const [categoryReferenceTarget, setCategoryReferenceTarget] = useState({
    categoryId: '',
    requestKey: 0,
    pending: false
  });
  const [budgetReferenceTarget, setBudgetReferenceTarget] = useState({
    sheetId: '',
    categoryId: '',
    budget: null,
    category: null,
    requestKey: 0,
    pending: false
  });
  const [recurringReferenceTarget, setRecurringReferenceTarget] = useState({
    item: null,
    requestKey: 0,
    pending: false
  });
  const [accountCreateRequestId, setAccountCreateRequestId] = useState(0);
  const [selectedDraftKey, setSelectedDraftKey] = useState('');
  const [selectedCheckpointId, setSelectedCheckpointId] = useState('');
  const [applicationErrors, setApplicationErrors] = useState([]);

  const cloud = useCloudWorkbookController({
    cloud: ports.cloud,
    feedback: ports.feedback,
    workbook,
    browserCache: ports.browserCache,
    workbookStorage: ports.workbookStorage,
    saveStatus: state.save.status,
    localSaveSequence: state.save.localSaveSequence,
    saveWorkbook,
    setWorkbook,
    navigate
  });
  const executeCloudOperation = cloud.execute;
  const cloudModel = cloud.model;
  useAdvisorRuntimeState(ports.advisor, setSettingsViewState);

  const dashboardController = useMemo(
    () => createDashboardController({ clock: ports.clock }),
    [ports.clock]
  );
  const budgetController = useMemo(
    () => createBudgetController({ clock: ports.clock, createId: ports.ids.create }),
    [ports.clock, ports.ids.create]
  );
  const billsController = useMemo(
    () =>
      createBillsController({
        clock: ports.clock,
        createId: ports.ids.create,
        advisorIntent: applicationAdvisorIntent
      }),
    [ports.clock, ports.ids.create]
  );
  const settingsController = useMemo(
    () =>
      createSettingsController({
        createId: ports.ids.create,
        storageIntent: applicationStorageIntent,
        advisorIntent: applicationAdvisorIntent,
        cloudIntent: applicationCloudIntent
      }),
    [ports.ids.create]
  );
  const advisorRuntimeProvider = useMemo(() => {
    return createAdvisorRuntimeProvider({
      advisor: ports.advisor,
      createId: ports.ids.create,
      settings: settingsViewState.advisorSettings
    });
  }, [ports.advisor, ports.ids, settingsViewState.advisorSettings]);
  const featureServices = useMemo(
    () => ({
      createId: ports.ids.create,
      now: ports.clock.now,
      today: ports.clock.today,
      defaultDate: ports.clock.today,
      transactionBuilderServices: {
        createId: ports.ids.create
      }
    }),
    [ports.clock.now, ports.clock.today, ports.ids.create]
  );
  const advisorServices = useMemo(
    () => createAdvisorServices(featureServices, advisorRuntimeProvider),
    [advisorRuntimeProvider, featureServices]
  );

  const notifyAction = useCallback(
    (action) => {
      if (typeof onAction === 'function') onAction(action);
    },
    [onAction]
  );

  const reportError = useCallback((scope, message, code = '') => {
    const error = {
      code: code || `${scope}.failed`,
      message: asString(message || 'The requested action could not be completed.'),
      scope
    };
    setApplicationErrors((current) => current.concat(error).slice(-3));
    return error;
  }, []);
  const dismissError = useCallback((index) => {
    setApplicationErrors((current) => current.filter((_error, itemIndex) => itemIndex !== index));
  }, []);

  const openAssistantReference = useCallback(
    (reference) =>
      createAssistantReferenceNavigator({
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
      })(reference),
    [navigate, reportError]
  );

  const consumeCategoryReferenceTarget = useCallback((requestKey) => {
    setCategoryReferenceTarget((current) =>
      current.pending && current.requestKey === requestKey
        ? { ...current, pending: false }
        : current
    );
  }, []);
  const consumeBudgetReferenceTarget = useCallback((requestKey) => {
    setBudgetReferenceTarget((current) =>
      current.pending && current.requestKey === requestKey
        ? { ...current, pending: false }
        : current
    );
  }, []);
  const consumeRecurringReferenceTarget = useCallback((requestKey) => {
    setRecurringReferenceTarget((current) =>
      current.pending && current.requestKey === requestKey
        ? { ...current, pending: false }
        : current
    );
  }, []);

  const applyCommandResult = useCallback(
    (result, options = {}) => {
      if (!(result && result.ok)) {
        return result;
      }
      const currentWorkbook = workbookRef.current;
      const workbookChanged =
        Object.prototype.hasOwnProperty.call(result, 'workbook') &&
        result.workbook &&
        result.workbook !== currentWorkbook;
      let events = asArray(result.events).map(translatedEvent);
      if (options.saveMutation && workbookChanged && !hasSaveEvent(events)) {
        events = events.concat({
          type: 'schedule-save',
          reason: options.reason || 'workbook_changed'
        });
      }
      const prepared = withoutUnchangedWorkbook({ ...result, events }, currentWorkbook);
      return executeCommandResult(prepared);
    },
    [executeCommandResult]
  );

  const handleFeatureCommandResult = useCallback(
    (result, scope) => {
      if (result && result.ok) {
        setApplicationErrors([]);
        return applyCommandResult(result, { saveMutation: true, reason: `${scope}_changed` });
      }
      // Account, category, and transaction routes retain their local modal error.
      return result;
    },
    [applyCommandResult]
  );

  const saveDownload = useCallback(
    async (payload, scope = 'download') => {
      try {
        const result = await ports.downloads.save(payload);
        if (result && result.ok === false && !result.canceled) {
          reportError(
            scope,
            result.error || 'The export could not be saved.',
            `${scope}.save_failed`
          );
        }
        return result;
      } catch (error) {
        reportError(scope, error && error.message, `${scope}.save_failed`);
        return { ok: false, error: error && error.message ? error.message : String(error) };
      }
    },
    [ports.downloads, reportError]
  );

  const handleTransactionIntent = useCallback(
    async (intent) => {
      const source = asObject(intent);
      const payload = asObject(source.payload);
      if (source.type === 'import/file-requested') {
        try {
          const result = await ports.filePicker.openText(payload);
          if (result && result.ok) {
            transactionActionRef.current?.({
              type: 'csv-import-preview',
              payload: {
                fileName: result.fileName || 'transactions.csv',
                text: result.text || ''
              }
            });
          } else if (result && !result.canceled && result.error) {
            reportError('transaction-import', result.error, 'transaction-import.open_failed');
          }
          return result;
        } catch (error) {
          reportError(
            'transaction-import',
            error && error.message,
            'transaction-import.open_failed'
          );
          return { ok: false, error: error && error.message ? error.message : String(error) };
        }
      }
      if (source.type === 'export/requested' && payload.kind === 'csv-bundle') {
        const prefix = asString(payload.suggestedName || 'cavalry-csv').replace(/-csv$/, '');
        const results = [];
        for (const [fileName, contents] of Object.entries(asObject(payload.files))) {
          results.push(
            await saveDownload(
              {
                suggestedName: `${prefix}-${fileName}`,
                mimeType: 'text/csv;charset=utf-8',
                contents
              },
              'transaction-export'
            )
          );
        }
        return { ok: results.every((result) => result && result.ok !== false), results };
      }
      if (source.type === 'export/requested') {
        return saveDownload(payload, 'workbook-export');
      }
      return { ok: false, unsupported: true };
    },
    [ports.filePicker, reportError, saveDownload]
  );

  const executeStorageIntent = useCallback(
    async (payload) => {
      const operation = asString(payload && payload.operation);
      const currentWorkbook = workbookRef.current;
      const fail = (message) => {
        const copy = asString(message || `The ${operation || 'storage'} operation failed.`);
        setSettingsViewState((current) => ({
          ...current,
          error: copy,
          feedbackSection: 'settings-files',
          notice: ''
        }));
        reportError('settings-storage', copy, `settings-storage.${operation || 'unknown'}-failed`);
        return { ok: false, error: copy };
      };
      try {
        let result;
        if (operation === 'open') {
          result = await openWorkbook();
          if (result && result.status === 'error') return fail(result.error);
        } else if (operation === 'save') {
          result = await saveWorkbook(currentWorkbook);
        } else if (operation === 'save-as') {
          result = await saveWorkbookAs(
            currentWorkbook,
            `${asString(payload.suggestedName || (currentWorkbook && currentWorkbook.name) || 'cavalry-workbook')}.html`
          );
        } else if (operation === 'reveal') {
          result = await ports.workbookStorage.reveal();
        } else if (operation === 'forget') {
          result = await ports.workbookStorage.forget();
        } else if (operation === 'export-workbook' && currentWorkbook) {
          result = await handleTransactionIntent(
            buildTransactionExportIntent(currentWorkbook, 'workbook-html')
          );
        } else if (operation === 'export-csv' && currentWorkbook) {
          result = await handleTransactionIntent(
            buildTransactionExportIntent(currentWorkbook, 'csv-bundle')
          );
        } else if (operation === 'import-csv') {
          result = await handleTransactionIntent({
            type: 'import/file-requested',
            payload: { kind: 'transactions-csv', accept: '.csv,text/csv' }
          });
          if (result && result.ok) navigate('ledger');
        } else if (operation === 'exit') {
          await Promise.allSettled([ports.browserCache.clear(), ports.workbookStorage.forget()]);
          setWorkbook(null, { source: 'exit', markDirty: false });
          result = { ok: true };
        } else {
          return fail(`The ${operation || 'requested'} operation is unavailable in this runtime.`);
        }
        if (result && result.canceled) return result;
        if (result && (result.ok === false || result.status === 'error')) {
          return fail(result.error);
        }
        setSettingsViewState((current) => ({
          ...current,
          error: '',
          feedbackSection: 'settings-files',
          notice: `${operation || 'Storage'} completed.`
        }));
        return result || { ok: true };
      } catch (error) {
        return fail(error && error.message);
      }
    },
    [
      handleTransactionIntent,
      navigate,
      openWorkbook,
      ports.browserCache,
      ports.workbookStorage,
      reportError,
      saveWorkbook,
      saveWorkbookAs,
      setWorkbook
    ]
  );

  const executeAdvisorIntent = useCallback(
    (payload) =>
      executeAdvisorApplicationIntent(payload, {
        advisor: ports.advisor,
        advisorOperations,
        navigate,
        reportError,
        setBillsViewState,
        setSettingsViewState
      }),
    [advisorOperations, navigate, ports.advisor, reportError]
  );

  const transaction = useTransactionController({
    workbook: workbook || {},
    services: featureServices,
    onCommandResult: (result) => handleFeatureCommandResult(result, 'transaction'),
    onIntent: handleTransactionIntent,
    modelEnabled: activeRouteId === 'ledger',
    modelBuilder: routeModelBuilders.transactions,
    fallbackModel: routeModels.transactions || EMPTY_ROUTE_MODELS
  });
  useEffect(() => {
    transactionActionRef.current = transaction.onAction;
  }, [transaction.onAction]);

  const handleAdvisorIntent = useCallback(
    (intent) =>
      executeAdvisorViewIntent(intent, {
        advisor: ports.advisor,
        filePicker: ports.filePicker,
        getWorkbook: () => workbookRef.current,
        navigate,
        saveDownload,
        setSelectedDraftKey
      }),
    [navigate, ports.advisor, ports.filePicker, saveDownload]
  );

  const handleApplicationEvent = useCallback(
    (event) => {
      const source = asObject(event);
      const payload = asObject(source.payload);
      if (source.type === 'application/storage-intent') {
        executeStorageIntent(payload);
      } else if (source.type === 'application/advisor-intent') {
        executeAdvisorIntent(payload);
      } else if (source.type === 'application/cloud-intent') {
        executeCloudOperation(payload.operation, payload);
      } else if (source.type === 'bills/view-state-change-requested') {
        setBillsViewState((current) => ({ ...current, ...asObject(payload.patch) }));
      } else if (source.type === BUDGET_EVENT_TYPES.viewStateChange) {
        setBudgetViewState((current) => ({
          ...current,
          sheetId: '',
          range: asObject(payload.range)
        }));
      } else if (source.type === DASHBOARD_EVENT_TYPES.categoryDrilldown) {
        transactionActionRef.current?.({
          type: 'set-ledger-filter-category',
          payload: { value: payload.categoryId || '' }
        });
        navigate('ledger');
      } else if (source.type === DASHBOARD_EVENT_TYPES.flowDrilldown) {
        transactionActionRef.current?.({
          type: 'set-ledger-type',
          payload: { ledgerType: transactionTypeForFlow(payload.flowType) }
        });
        navigate('ledger');
      } else if (source.type === DASHBOARD_EVENT_TYPES.accountDrilldown) {
        setSelectedAccountId(payload.accountId || '');
        navigate('accounts');
      } else if (source.type === DASHBOARD_EVENT_TYPES.accountGroupDrilldown) {
        navigate('accounts');
      } else if (source.type === DASHBOARD_EVENT_TYPES.monthDrilldown) {
        setBudgetViewState({
          sheetId: payload.sheetId || '',
          range: {
            start: payload.rangeStart || '',
            end: payload.rangeEnd || ''
          }
        });
        navigate('budgets');
      } else if (
        source.type === DASHBOARD_EVENT_TYPES.transactionDetail ||
        source.type === BUDGET_EVENT_TYPES.transactionDetail
      ) {
        transactionActionRef.current?.({
          type: 'open-transaction-detail',
          payload: { transactionId: payload.transactionId || '' }
        });
        navigate('ledger');
      } else if (source.type === DASHBOARD_EVENT_TYPES.customization) {
        openOverlay({
          id: 'dashboard-customizer',
          type: 'dashboard-customizer',
          model: payload
        });
      } else if (source.type === DASHBOARD_EVENT_TYPES.exportWorkbook && workbookRef.current) {
        handleTransactionIntent(buildTransactionExportIntent(workbookRef.current, 'workbook-html'));
      } else if (source.type === BUDGET_EVENT_TYPES.addBudget) {
        openOverlay({
          id: 'budget-editor',
          type: 'budget-editor',
          model: {
            sheetId: payload.sheetId || '',
            categoryId: payload.categoryId || '',
            planned: payload.planned || '',
            createdAt: payload.createdAt || payload.currentDate || '',
            currentDate: payload.currentDate || '',
            rangeStart: payload.rangeStart || '',
            rangeEnd: payload.rangeEnd || ''
          }
        });
      } else if (source.type === 'recurring/payment-requested') {
        transactionActionRef.current?.({ type: 'open-ledger-composer', payload });
        navigate('ledger');
      }
    },
    [
      executeCloudOperation,
      executeAdvisorIntent,
      executeStorageIntent,
      handleTransactionIntent,
      navigate,
      openOverlay
    ]
  );

  const processControllerResult = useCallback(
    (result, scope) => {
      if (!(result && result.handled)) return result;
      if (!result.ok) {
        reportError(
          scope,
          firstErrorMessage(result, 'The action could not be completed.'),
          asArray(result.errors)[0]?.code
        );
        return result;
      }
      setApplicationErrors([]);
      asArray(result.events).forEach(handleApplicationEvent);
      return applyCommandResult(result, {
        saveMutation: ['budget', 'bills', 'settings'].includes(scope),
        reason: `${scope}_changed`
      });
    },
    [applyCommandResult, handleApplicationEvent, reportError]
  );

  const commitAssistantCommandResult = useCallback(
    async (result, options = {}) => {
      if (!(result && result.ok)) {
        if (asArray(result?.errors).length) {
          reportError(
            'assistant',
            firstErrorMessage(result, 'Cavalry could not complete that action.'),
            result.errors[0]?.code
          );
        }
        return result;
      }
      setApplicationErrors([]);
      try {
        return await commitAssistantCommandResultDurably({
          result,
          currentWorkbook: workbookRef.current,
          saveWorkbook,
          isSaveEvent: (event) => hasSaveEvent([translatedEvent(event)]),
          applyCommandResult: (committedResult) =>
            applyCommandResult(committedResult, {
              saveMutation: false,
              reason: options.reason || 'assistant_changed'
            }),
          updateCurrentWorkbook(nextWorkbook) {
            // The durable write completed before the state swap, so later tool calls in this turn
            // can treat this exact workbook as committed rather than merely proposed.
            workbookRef.current = nextWorkbook;
          }
        });
      } catch (error) {
        const message = asString(error?.message) || 'The workbook change could not be saved.';
        reportError('assistant', message, asString(error?.code) || 'assistant.persistence_failed');
        throw error;
      }
    },
    [applyCommandResult, reportError, saveWorkbook]
  );

  const executeAssistantTool = useCallback(
    (name, args = {}, metadata = {}) => {
      const suppliedArguments = asObject(args);
      if (metadata.signal?.aborted) {
        return {
          ok: false,
          status: 'cancelled',
          changed: false,
          errors: [{ code: 'assistant_cancelled', message: 'Cavalry request was cancelled.' }]
        };
      }
      return executeCavalryAssistantTool(
        {
          id: metadata.callId,
          name,
          arguments: suppliedArguments
        },
        {
          getWorkbook: () => workbookRef.current,
          services: featureServices,
          advisor: ports.advisor,
          commitCommandResult: commitAssistantCommandResult,
          navigate,
          saveWorkbook,
          question: asString(metadata.question),
          today: asString(metadata.today),
          activeRouteId: asString(metadata.activeRouteId),
          approvedByUser: metadata.approvedByUser === true
        }
      );
    },
    [commitAssistantCommandResult, featureServices, navigate, ports.advisor, saveWorkbook]
  );

  const openAssistantSettings = useCallback(
    (sectionId = 'settings-advisor') => {
      setSettingsViewState((current) => ({
        ...current,
        activeSection: sectionId,
        activeSectionKey: Number(current.activeSectionKey || 0) + 1
      }));
      navigate('settings');
    },
    [navigate]
  );

  const runDashboardAction = useCallback(
    (action, shouldNotify = true) => {
      if (shouldNotify) notifyAction(action);
      const result = dashboardController.handleAction(action, {
        workbook: workbookRef.current,
        viewState: dashboardViewState
      });
      return processControllerResult(result, 'dashboard');
    },
    [dashboardController, dashboardViewState, notifyAction, processControllerResult]
  );

  const handleDashboardAction = useCallback(
    (action) => runDashboardAction(action, true),
    [runDashboardAction]
  );

  const handleSettingsAction = useCallback(
    (action) => {
      notifyAction(action);
      const requestedServerAction = asString(action?.payload?.serverAction);
      if (
        action?.type === 'toggle-advisor-server' &&
        ['start', 'stop'].includes(requestedServerAction)
      ) {
        const advisorPayload = { ...asObject(action.payload) };
        delete advisorPayload.serverAction;
        return executeAdvisorIntent({
          ...advisorPayload,
          operation: requestedServerAction === 'stop' ? 'server-stop' : 'server-start'
        });
      }
      const result = settingsController.handleAction(workbookRef.current, action);
      if (result && result.ok) {
        setSettingsViewState((current) => ({ ...current, error: '' }));
      } else {
        setSettingsViewState((current) => ({
          ...current,
          error: firstErrorMessage(result, 'The settings action could not be completed.'),
          feedbackSection:
            action?.type === 'set-advisor-provider' ? 'settings-advisor' : 'settings-general',
          notice: ''
        }));
      }
      return processControllerResult({ ...result, handled: true }, 'settings');
    },
    [executeAdvisorIntent, notifyAction, processControllerResult, settingsController]
  );

  const handleDraftCommandResult = useCallback(
    (result) => {
      if (result && result.ok) setApplicationErrors([]);
      else if (result && asArray(result.errors).length) {
        reportError(
          'draft-review',
          firstErrorMessage(result, 'The draft action could not be completed.'),
          result.errors[0].code
        );
      }
      return handleFeatureCommandResult(result, 'draft-review');
    },
    [handleFeatureCommandResult, reportError]
  );

  const {
    handleBillsAction,
    handleBudgetAction,
    handleDraftCategoryCreate,
    handleTransactionAction
  } = useCategoryAwareRouteActions({
    billsController,
    billsViewState,
    budgetController,
    budgetViewState,
    closeOverlay,
    featureServices,
    handleFeatureCommandResult,
    navigate,
    notifyAction,
    processControllerResult,
    runDashboardAction,
    setBillsViewState,
    transaction,
    workbookRef
  });

  const handleAdvisorCommandResult = useCallback(
    (result) => {
      if (result && result.ok) setApplicationErrors([]);
      else if (result && asArray(result.errors).length) {
        reportError(
          'advisor',
          firstErrorMessage(result, 'Cavalry could not complete the request.'),
          result.errors[0].code
        );
      }
      return handleFeatureCommandResult(result, 'advisor');
    },
    [handleFeatureCommandResult, reportError]
  );

  const handleAccountAction = useCallback(
    (action) => {
      notifyAction(action);
      if (action && action.type === 'route/navigate') {
        navigate(action.payload && action.payload.routeId);
      } else if (action && action.type === 'open-account-create') {
        setAccountCreateRequestId((current) => current + 1);
      } else if (action && action.type === 'open-account-transactions') {
        transactionActionRef.current?.(action);
        navigate('ledger');
      } else if (action && DASHBOARD_ACTIONS.has(action.type)) {
        runDashboardAction(action, false);
      }
    },
    [navigate, notifyAction, runDashboardAction]
  );
  const handleAccountCreateRequest = useCallback(() => setAccountCreateRequestId(0), []);

  const handleCategoryAction = handleAccountAction;

  const handleFallbackAction = useCallback(
    (action) => {
      if (action && action.type === 'route/navigate') {
        navigate(action.payload && action.payload.routeId);
      }
      notifyAction(action);
    },
    [navigate, notifyAction]
  );

  useEffect(() => {
    let cancelled = false;
    const composerOverlay = state.overlays.find(
      (overlay) => overlay.type === 'transaction-composer'
    );
    if (composerOverlay) {
      transactionActionRef.current?.({
        type: 'open-ledger-composer',
        payload: composerOverlay.model || {}
      });
      closeOverlay(composerOverlay.id);
    }
    const draftOverlay = state.overlays.find((overlay) => overlay.type === 'draft-group-selection');
    if (draftOverlay) {
      const draftGroupId = asString(draftOverlay.model && draftOverlay.model.draftGroupId);
      queueMicrotask(() => {
        if (cancelled) return;
        if (draftGroupId) setSelectedDraftKey(`external:${draftGroupId}`);
        closeOverlay(draftOverlay.id);
      });
    }
    const checkpointOverlay = state.overlays.find(
      (overlay) => overlay.type === 'checkpoint-selection'
    );
    if (checkpointOverlay) {
      const checkpointId = asString(
        checkpointOverlay.model && checkpointOverlay.model.checkpointId
      );
      queueMicrotask(() => {
        if (cancelled) return;
        setSelectedCheckpointId(checkpointId);
        closeOverlay(checkpointOverlay.id);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [closeOverlay, state.overlays]);

  const { billsModel, budgetModel, dashboardContext, dashboardModel } = useRouteModels({
    activeRouteId,
    billsController,
    billsViewState,
    budgetController,
    budgetEditor: state.overlays.find((overlay) => overlay.type === 'budget-editor'),
    budgetViewState,
    dashboardController,
    dashboardViewState,
    ports,
    routeModelBuilders,
    routeModels,
    workbook
  });
  const settingsModel = useMemo(() => {
    if (activeRouteId !== 'settings') return routeModels.settings || {};
    if (!workbook) return routeModels.settings || {};
    try {
      const workbookSettings = asObject(workbook.settings);
      const buildModel = routeModelBuilders.settings || settingsController.buildModel;
      return buildModel(workbook, settingsViewState, {
        saveStatusLabel: saveStatusLabel(state.save),
        lastSavedAt: state.save.lastSavedAt,
        visibleRangeLabel: dashboardContext.periodLabel || '',
        fileAutosave: {
          status: state.save.status,
          detail: state.save.status === 'cache' ? 'Browser cache' : 'Native workbook storage'
        },
        canSaveFileNow: typeof ports.workbookStorage.save === 'function',
        canRevealFile: typeof ports.workbookStorage.reveal === 'function',
        canChooseAutosaveFile: typeof ports.workbookStorage.saveAs === 'function',
        health: {
          errors: state.errors,
          warnings: state.warnings,
          notices: []
        },
        advisorSettings: {
          ...asObject(workbookSettings.advisor),
          ...asObject(settingsViewState.advisorSettings)
        },
        advisorProviderLabel: assistantProviderLabel(
          asString(
            asObject(settingsViewState.advisorSettings).provider ||
              asObject(workbookSettings.advisor).provider
          )
        ),
        advisorStatus: settingsViewState.notice || '',
        advisorConnection: settingsViewState.advisorConnection || '',
        advisorServerStatus: asObject(settingsViewState.advisorServerStatus),
        advisorServerToggleState: asObject(settingsViewState.advisorServerToggleState),
        advisorServerDetail: settingsViewState.advisorServerDetail || '',
        advisorMicrophone: asObject(settingsViewState.advisorMicrophone),
        cloud: cloudModel,
        activeSection: asString(settingsViewState.activeSection),
        activeSectionKey: asString(settingsViewState.activeSectionKey),
        contextWindowTokenOptions: [4096, 8192, 16384, 32768],
        localAdvisorModel: 'cavalry-advisor',
        localAdvisorEndpoint: 'http://127.0.0.1:8080/v1/chat/completions',
        openAiModelPlaceholder: 'gpt-5.4-mini',
        openAiEndpoint: 'https://api.openai.com/v1/chat/completions',
        openAiResponsesEndpoint: 'https://api.openai.com/v1/responses',
        error: settingsViewState.error || '',
        notice: settingsViewState.notice || ''
      });
    } catch (_error) {
      return routeModels.settings || {};
    }
  }, [
    activeRouteId,
    cloudModel,
    dashboardContext.periodLabel,
    ports.workbookStorage,
    routeModelBuilders.settings,
    routeModels.settings,
    settingsController,
    settingsViewState,
    state.errors,
    state.save,
    state.warnings,
    workbook
  ]);
  const liveRouteModels = useMemo(
    () => ({
      ...routeModels,
      dashboard: dashboardModel,
      budgets: budgetModel,
      bills: billsModel,
      settings: settingsModel,
      advisor: routeModels.advisor || {},
      aiDrafts: routeModels.aiDrafts || routeModels['ai-drafts'] || {},
      transactions: workbook ? transaction.model : routeModels.transactions || transaction.model
    }),
    [
      billsModel,
      budgetModel,
      dashboardModel,
      routeModels,
      settingsModel,
      transaction.model,
      workbook
    ]
  );
  const routeProps = useMemo(
    () => ({
      dashboard: {
        model: dashboardModel,
        onAction: handleDashboardAction
      },
      budgets: {
        model: budgetModel,
        initialTargetSheetId: budgetReferenceTarget.sheetId,
        initialTargetCategoryId: budgetReferenceTarget.categoryId,
        initialTargetBudget: budgetReferenceTarget.budget,
        initialTargetCategory: budgetReferenceTarget.category,
        targetRequestKey: budgetReferenceTarget.pending ? budgetReferenceTarget.requestKey : 0,
        onTargetHandled: consumeBudgetReferenceTarget,
        onAction: handleBudgetAction
      },
      bills: {
        model: billsModel,
        initialTargetRecurringItem: recurringReferenceTarget.item,
        targetRequestKey: recurringReferenceTarget.pending
          ? recurringReferenceTarget.requestKey
          : 0,
        onTargetHandled: consumeRecurringReferenceTarget,
        onAction: handleBillsAction
      },
      settings: {
        instanceKey: settingsModel.activeSectionKey || 'settings',
        feedback: cloud.feedback,
        model: settingsModel,
        onAction: handleSettingsAction
      },
      advisor: {
        workbook,
        model: liveRouteModels.advisor,
        services: advisorServices,
        onCommandResult: handleAdvisorCommandResult,
        onIntent: handleAdvisorIntent,
        onAction: notifyAction
      },
      aiDrafts: {
        key: `${selectedDraftKey || 'drafts'}:${selectedCheckpointId || 'checkpoints'}`,
        workbook,
        services: featureServices,
        initialSelectedKey: selectedDraftKey,
        initialSelectedCheckpointId: selectedCheckpointId,
        onAction: notifyAction,
        onCreateCategory: handleDraftCategoryCreate,
        onCommandResult: handleDraftCommandResult
      },
      accounts: {
        key: `${selectedAccountId || 'accounts'}:${accountReferenceRequestKey}`,
        workbook,
        services: featureServices,
        createRequestId: accountCreateRequestId,
        onCreateRequestHandled: handleAccountCreateRequest,
        initialSelectedAccountId: selectedAccountId,
        asOfDate: ports.clock.today(),
        asOfLabel: dashboardContext.periodLabel || ports.clock.today(),
        onAction: handleAccountAction,
        onCommandResult: (result) => handleFeatureCommandResult(result, 'account')
      },
      categories: {
        workbook,
        services: featureServices,
        initialTargetCategoryId: categoryReferenceTarget.categoryId,
        targetRequestKey: categoryReferenceTarget.pending ? categoryReferenceTarget.requestKey : 0,
        onTargetHandled: consumeCategoryReferenceTarget,
        periodLabel: dashboardContext.periodLabel || 'Current workbook',
        rangeStart: (dashboardContext.range && dashboardContext.range.start) || '',
        rangeEnd: (dashboardContext.range && dashboardContext.range.end) || '',
        onAction: handleCategoryAction,
        onCommandResult: (result) => handleFeatureCommandResult(result, 'category')
      },
      transactions: {
        model: workbook ? transaction.model : liveRouteModels.transactions,
        onAction: handleTransactionAction
      }
    }),
    [
      budgetModel,
      budgetReferenceTarget,
      billsModel,
      cloud.feedback,
      recurringReferenceTarget,
      categoryReferenceTarget,
      consumeBudgetReferenceTarget,
      consumeCategoryReferenceTarget,
      consumeRecurringReferenceTarget,
      dashboardContext,
      dashboardModel,
      featureServices,
      handleAccountAction,
      handleAccountCreateRequest,
      handleBudgetAction,
      handleBillsAction,
      handleCategoryAction,
      handleDashboardAction,
      handleFeatureCommandResult,
      handleAdvisorCommandResult,
      handleAdvisorIntent,
      handleDraftCommandResult,
      handleDraftCategoryCreate,
      handleTransactionAction,
      liveRouteModels.advisor,
      liveRouteModels.transactions,
      ports.clock,
      accountCreateRequestId,
      accountReferenceRequestKey,
      selectedAccountId,
      selectedCheckpointId,
      selectedDraftKey,
      settingsModel,
      handleSettingsAction,
      advisorServices,
      notifyAction,
      transaction.model,
      workbook
    ]
  );
  return {
    errors: applicationErrors,
    dismissError,
    routeModels: liveRouteModels,
    routeProps,
    handleFallbackAction,
    handleAccountAction,
    handleBudgetAction,
    handleTransactionAction,
    cloud: {
      execute: executeCloudOperation,
      model: cloudModel
    },
    assistant: {
      executeTool: executeAssistantTool,
      openReference: openAssistantReference,
      openSettings: openAssistantSettings,
      settings: {
        ...asObject(asObject(workbook?.settings).advisor),
        ...asObject(settingsViewState.advisorSettings)
      }
    }
  };
}
