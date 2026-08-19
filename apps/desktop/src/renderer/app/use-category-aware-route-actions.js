import { useCallback } from 'react';

import {
  CATEGORY_ACTIONS,
  executeCategoryCommand
} from '../features/categories/category-controller.js';
import {
  asObject,
  DASHBOARD_ACTIONS,
  firstErrorMessage
} from './finance-application-controller-helpers.js';

export function useCategoryAwareRouteActions({
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
}) {
  const createInlineCategory = useCallback(
    (action) => {
      const result = executeCategoryCommand(workbookRef.current, action, featureServices);
      handleFeatureCommandResult(result, 'category');
      if (result?.ok && result.workbook) workbookRef.current = result.workbook;
      return result;
    },
    [featureServices, handleFeatureCommandResult, workbookRef]
  );

  const handleBudgetAction = useCallback(
    (action) => {
      notifyAction(action);
      if (action && action.type === 'close-budget-editor') {
        closeOverlay('budget-editor');
        return { ok: true, handled: true, events: [] };
      }
      if (action && action.type === CATEGORY_ACTIONS.CREATE) {
        return createInlineCategory(action);
      }
      const result = budgetController.handleAction(action, {
        workbook: workbookRef.current,
        viewState: budgetViewState
      });
      return processControllerResult(result, 'budget');
    },
    [
      budgetController,
      budgetViewState,
      closeOverlay,
      createInlineCategory,
      notifyAction,
      processControllerResult,
      workbookRef
    ]
  );

  const handleBillsAction = useCallback(
    (action) => {
      notifyAction(action);
      if (action && action.type === 'close-modal') {
        return { ok: true, handled: true, events: [], warnings: [], errors: [] };
      }
      if (action && action.type === CATEGORY_ACTIONS.CREATE) {
        return createInlineCategory(action);
      }
      const result = billsController.handleAction(workbookRef.current, action, {
        viewState: billsViewState
      });
      if (result && result.ok) {
        setBillsViewState((current) => ({ ...current, error: '', notice: '' }));
      } else {
        setBillsViewState((current) => ({
          ...current,
          error: firstErrorMessage(result, 'The recurring action could not be completed.'),
          notice: ''
        }));
      }
      return processControllerResult({ ...result, handled: true }, 'bills');
    },
    [
      billsController,
      billsViewState,
      createInlineCategory,
      notifyAction,
      processControllerResult,
      setBillsViewState,
      workbookRef
    ]
  );

  const handleDraftCategoryCreate = useCallback(
    (payload) => {
      const action = { type: CATEGORY_ACTIONS.CREATE, payload: asObject(payload) };
      notifyAction(action);
      return createInlineCategory(action);
    },
    [createInlineCategory, notifyAction]
  );

  const handleTransactionAction = useCallback(
    (action) => {
      notifyAction(action);
      if (action && action.type === 'route/navigate') {
        navigate(action.payload && action.payload.routeId);
        return { ok: true, handled: true };
      }
      if (action && DASHBOARD_ACTIONS.has(action.type)) {
        return runDashboardAction(action, false);
      }
      if (action && action.type === CATEGORY_ACTIONS.CREATE) {
        return createInlineCategory(action);
      }
      return transaction.onAction(action);
    },
    [createInlineCategory, navigate, notifyAction, runDashboardAction, transaction]
  );

  return {
    handleBillsAction,
    handleBudgetAction,
    handleDraftCategoryCreate,
    handleTransactionAction
  };
}
