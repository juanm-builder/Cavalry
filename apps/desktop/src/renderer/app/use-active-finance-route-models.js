import { useMemo } from 'react';

import { buildDashboardRouteContext } from '../features/dashboard/dashboard-route-model.js';
import { safeBuildModel } from './finance-application-controller-helpers.js';

export function useRouteModels({
  activeRouteId,
  billsController,
  billsViewState,
  budgetController,
  budgetEditor,
  budgetViewState,
  dashboardController,
  dashboardViewState,
  ports,
  routeModelBuilders,
  routeModels,
  workbook
}) {
  const dashboardContext = useMemo(() => {
    if (!workbook) return routeModels.dashboard || {};
    try {
      return buildDashboardRouteContext(workbook, dashboardViewState, { clock: ports.clock });
    } catch (_error) {
      return routeModels.dashboard || {};
    }
  }, [dashboardViewState, ports.clock, routeModels.dashboard, workbook]);
  const dashboardModel = useMemo(() => {
    if (activeRouteId !== 'dashboard') return routeModels.dashboard || {};
    return safeBuildModel(
      routeModelBuilders.dashboard || dashboardController.buildModel,
      workbook,
      dashboardViewState,
      routeModels.dashboard
    );
  }, [
    activeRouteId,
    dashboardController,
    dashboardViewState,
    routeModelBuilders.dashboard,
    routeModels.dashboard,
    workbook
  ]);
  const budgetBaseModel = useMemo(() => {
    if (activeRouteId !== 'budgets') return routeModels.budgets || {};
    return safeBuildModel(
      routeModelBuilders.budgets || budgetController.buildModel,
      workbook,
      budgetViewState,
      routeModels.budgets
    );
  }, [
    activeRouteId,
    budgetController,
    budgetViewState,
    routeModelBuilders.budgets,
    routeModels.budgets,
    workbook
  ]);
  const budgetModel = useMemo(
    () => ({
      ...budgetBaseModel,
      editor: budgetEditor ? budgetEditor.model : null
    }),
    [budgetBaseModel, budgetEditor]
  );
  const billsModel = useMemo(() => {
    if (activeRouteId !== 'bills') return routeModels.bills || {};
    return safeBuildModel(
      routeModelBuilders.bills || billsController.buildModel,
      workbook,
      billsViewState,
      routeModels.bills
    );
  }, [
    activeRouteId,
    billsController,
    billsViewState,
    routeModelBuilders.bills,
    routeModels.bills,
    workbook
  ]);

  return { billsModel, budgetModel, dashboardContext, dashboardModel };
}
