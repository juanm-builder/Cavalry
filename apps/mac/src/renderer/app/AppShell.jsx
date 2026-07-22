// Hosts workbook state and command-result plumbing for the migrated React routes.

import React, { useEffect, useMemo, useState } from 'react';
import { createWorkbook } from '@cavalry/finance-core';

import { ApplicationFrame } from '../shell/ApplicationFrame.jsx';
import { WorkbookStartupScreen } from '../shell/WorkbookStartupScreen.jsx';
import { AppRouter } from './AppRouter.jsx';
import { CommandExecutorProvider } from './CommandExecutor.jsx';
import { useFinanceApplicationController } from './use-finance-application-controller.js';
import { useWorkbookSession, WorkbookProvider } from './WorkbookProvider.jsx';
import { DEFAULT_ROUTE_ID } from './routes.js';
import { HYDRATION_STATUS } from './workbook-session-reducer.js';
import { AppearanceProvider } from './AppearanceProvider.jsx';
import { CavalryAssistant } from '../features/assistant/CavalryAssistant.jsx';
import { GuidedTourModal } from '../features/onboarding/GuidedTourModal.jsx';
import { SetupChecklistPanel } from '../features/onboarding/SetupChecklist.jsx';
import { WelcomeModal } from '../features/onboarding/WelcomeModal.jsx';
import {
  buildSetupChecklist,
  hasAssistantConversation,
  isAssistantConnected
} from '../features/onboarding/setup-checklist-model.js';
import {
  useAssistantActivitySignal,
  useOnboarding
} from '../features/onboarding/use-onboarding.js';
import { WELCOME_STATES } from './onboarding-preferences.js';
import { useAutoUpdate } from './use-auto-update.js';

function NoticeStack({ errors = [], onDismissError }) {
  if (!errors.length) return null;
  return (
    <div className="notice-stack" aria-label="Workbook notices">
      {errors.map((error, index) => (
        <section className="app-notice bad" key={`error-${error.code || index}`} role="alert">
          <span aria-hidden="true" className="material-symbols-rounded">
            error
          </span>
          <div>
            <strong>Something went wrong</strong>
            <p>{error.message || String(error)}</p>
          </div>
          <button aria-label="Dismiss error" onClick={() => onDismissError?.(index)} type="button">
            <span aria-hidden="true" className="material-symbols-rounded">
              close
            </span>
          </button>
        </section>
      ))}
    </div>
  );
}

function SessionContent({ routeId, routeModels, onAction }) {
  const {
    state,
    dispatch,
    navigate,
    openWorkbook,
    openRecentWorkbook,
    ports,
    recentWorkbooks,
    saveWorkbook,
    setWorkbook
  } = useWorkbookSession();
  const application = useFinanceApplicationController({
    routeId: state.routeId,
    routeModels,
    onAction
  });
  const autoUpdate = useAutoUpdate(ports.updates);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const onboarding = useOnboarding();
  const assistantActivitySignal = useAssistantActivitySignal();
  const [checklistOpen, setChecklistOpen] = useState(false);
  // Session state, not persisted: the tour opens every time a workbook is created.
  const [tourOpen, setTourOpen] = useState(false);
  const assistantConnected = isAssistantConnected(application.assistant.settings);
  const assistantAsked = useMemo(() => {
    // The signal bumps when assistant conversations persist, forcing a re-read.
    void assistantActivitySignal;
    return hasAssistantConversation(state.workbook);
  }, [state.workbook, assistantActivitySignal]);
  const checklist = useMemo(
    () =>
      buildSetupChecklist({
        workbook: state.workbook,
        assistantConnected,
        assistantAsked
      }),
    [state.workbook, assistantConnected, assistantAsked]
  );
  const handleAction = application.handleFallbackAction;
  const openSetupGuide = () => {
    onboarding.setChecklistDismissed(false);
    setChecklistOpen(true);
  };
  const handleChecklistAction = (itemId) => {
    setChecklistOpen(false);
    if (itemId === 'account') {
      navigate('accounts');
      application.handleAccountAction({ type: 'open-account-create', payload: {} });
    } else if (itemId === 'transaction') {
      navigate('ledger');
      application.handleTransactionAction({ type: 'open-ledger-composer', payload: {} });
    } else if (itemId === 'budget') {
      navigate('budgets');
      application.handleBudgetAction({ type: 'open-simple-budget', payload: {} });
    } else if (itemId === 'assistant-connect') {
      application.assistant.openSettings();
    } else if (itemId === 'assistant-ask') {
      setAssistantOpen(true);
    } else {
      navigate('dashboard');
    }
  };
  const openAssistantReference = (reference) => {
    const navigationReference =
      typeof reference === 'string'
        ? reference
        : {
            source_refs: Array.isArray(reference?.source_refs)
              ? reference.source_refs.filter((sourceRef) => typeof sourceRef === 'string')
              : []
          };
    const result = application.assistant.openReference?.(navigationReference) || {
      ok: false,
      error: 'This referenced record cannot be opened.'
    };
    if (result.ok) {
      const keepAssistantOpen =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(min-width: 1380px)').matches;
      if (!keepAssistantOpen) {
        setAssistantOpen(false);
        if (['account', 'sheet'].includes(result.kind) && typeof document !== 'undefined') {
          const focusDestination = () => {
            const selector =
              result.kind === 'account'
                ? '[data-react-route="accounts"] .account-detail-card'
                : '[data-react-route="budgets"] h1';
            const target = document.querySelector(selector);
            if (!target) return;
            if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
            target.focus({ preventScroll: false });
          };
          if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => window.requestAnimationFrame(focusDestination));
          } else {
            window.setTimeout(focusDestination, 0);
          }
        }
      }
    }
    return result;
  };
  useEffect(() => {
    dispatch({ type: 'route/navigated', routeId });
  }, [dispatch, routeId]);

  if ([HYDRATION_STATUS.IDLE, HYDRATION_STATUS.LOADING].includes(state.hydration.status)) {
    return <WorkbookStartupScreen status="loading" />;
  }
  if (state.hydration.status === HYDRATION_STATUS.ERROR) {
    return (
      <WorkbookStartupScreen
        status="error"
        error={state.hydration.error}
        onOpen={openWorkbook}
        onRetry={openWorkbook}
      />
    );
  }
  if (state.hydration.status === HYDRATION_STATUS.EMPTY) {
    return (
      <>
        <WorkbookStartupScreen
          defaultName="My Cavalry Workbook"
          defaultYear={ports.clock.today().slice(0, 4)}
          cloud={application.cloud.model}
          onCloudAction={application.cloud.execute}
          onOpen={openWorkbook}
          onOpenRecent={openRecentWorkbook}
          recentWorkbooks={recentWorkbooks}
          onCreate={(options) => {
            const workbook = createWorkbook(options, {
              now: ports.clock.now,
              createId: ports.ids.create
            });
            setWorkbook(workbook, { source: 'created' });
            navigate('dashboard');
            saveWorkbook(workbook);
            setTourOpen(true);
          }}
        />
        {onboarding.state.welcome === WELCOME_STATES.PENDING ? (
          <WelcomeModal
            onDismiss={onboarding.markWelcomeSeen}
            onGetStarted={() => {
              onboarding.markWelcomeSeen();
              window.setTimeout(() => document.getElementById('workbook-name')?.focus(), 0);
            }}
          />
        ) : null}
      </>
    );
  }
  const pendingDraftCount = Array.isArray(state.workbook && state.workbook.aiDrafts)
    ? state.workbook.aiDrafts.filter(
        (draft) => !['confirmed', 'rejected', 'applied'].includes(draft && draft.status)
      ).length
    : 0;
  return (
    <ApplicationFrame
      workbook={state.workbook}
      activeRouteId={state.routeId}
      save={state.save}
      pendingDraftCount={pendingDraftCount}
      update={autoUpdate}
      onNavigate={navigate}
      onAskAssistant={() => setAssistantOpen(true)}
      onAddTransaction={() => {
        navigate('ledger');
        application.handleTransactionAction({ type: 'open-ledger-composer', payload: {} });
      }}
      onAddAccount={() => {
        navigate('accounts');
        application.handleAccountAction({ type: 'open-account-create', payload: {} });
      }}
      onOpenSetupGuide={openSetupGuide}
      setupProgress={
        onboarding.state.checklistDismissed
          ? null
          : { completedCount: checklist.completedCount, totalCount: checklist.totalCount }
      }
    >
      <NoticeStack
        errors={[...state.errors, ...application.errors]}
        onDismissError={(index) => {
          if (index < state.errors.length) dispatch({ type: 'error/dismissed', index });
          else application.dismissError(index - state.errors.length);
        }}
      />
      <AppRouter
        routeId={state.routeId}
        routeModels={application.routeModels}
        routeProps={application.routeProps}
        onAction={handleAction}
      />
      <CavalryAssistant
        activeRouteId={state.routeId}
        advisor={ports.advisor}
        createId={ports.ids.create}
        downloads={ports.downloads}
        executeTool={application.assistant.executeTool}
        isOpen={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onOpen={() => setAssistantOpen(true)}
        onOpenReference={openAssistantReference}
        onOpenSettings={() => {
          application.assistant.openSettings();
          setAssistantOpen(false);
        }}
        settings={application.assistant.settings}
        today={ports.clock.today}
        workbook={state.workbook}
      />
      {tourOpen ? (
        <GuidedTourModal
          onComplete={() => {
            setTourOpen(false);
            openSetupGuide();
          }}
          onSkip={() => setTourOpen(false)}
        />
      ) : null}
      {checklistOpen ? (
        <SetupChecklistPanel
          checklist={checklist}
          onClose={() => setChecklistOpen(false)}
          onDismiss={() => {
            onboarding.setChecklistDismissed(true);
            setChecklistOpen(false);
          }}
          onItemAction={handleChecklistAction}
        />
      ) : null}
    </ApplicationFrame>
  );
}

export function AppShell({
  initialWorkbook = null,
  initialSaveStatus = 'idle',
  routeId = DEFAULT_ROUTE_ID,
  routeModels = {},
  ports,
  autoHydrate = false,
  onEvent,
  onEffect,
  onAction,
  appearanceStorage
}) {
  return (
    <AppearanceProvider storage={appearanceStorage}>
      <WorkbookProvider
        initialWorkbook={initialWorkbook}
        initialSaveStatus={initialSaveStatus}
        initialRouteId={routeId}
        ports={ports}
        autoHydrate={autoHydrate}
      >
        <CommandExecutorProvider onEvent={onEvent} onEffect={onEffect}>
          <div data-renderer-shell="app-shell">
            <SessionContent routeId={routeId} routeModels={routeModels} onAction={onAction} />
          </div>
        </CommandExecutorProvider>
      </WorkbookProvider>
    </AppearanceProvider>
  );
}
