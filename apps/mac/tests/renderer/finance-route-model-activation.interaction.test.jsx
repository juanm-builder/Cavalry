import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeMinimalWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import { CommandExecutorProvider } from '../../src/renderer/app/CommandExecutor.jsx';
import { useFinanceApplicationController } from '../../src/renderer/app/use-finance-application-controller.js';
import { useWorkbookSession, WorkbookProvider } from '../../src/renderer/app/WorkbookProvider.jsx';
import { createNullRendererPorts } from '../../src/renderer/platform/ports.js';

function ControllerHarness({ builders, sessionRef }) {
  useFinanceApplicationController({ routeModelBuilders: builders });
  sessionRef.current = useWorkbookSession();
  return null;
}

function renderController(initialRouteId, builders) {
  const sessionRef = { current: null };
  const ports = createNullRendererPorts({
    clock: {
      now: () => '2026-07-10T08:00:00.000Z',
      today: () => '2026-07-10'
    }
  });
  render(
    <WorkbookProvider
      initialRouteId={initialRouteId}
      initialWorkbook={makeMinimalWorkbook()}
      ports={ports}
    >
      <CommandExecutorProvider>
        <ControllerHarness builders={builders} sessionRef={sessionRef} />
      </CommandExecutorProvider>
    </WorkbookProvider>
  );
  return sessionRef;
}

describe('finance route model activation', () => {
  it('invokes expensive model builders only while their route is active', () => {
    const builders = {
      dashboard: vi.fn(() => ({})),
      budgets: vi.fn(() => ({})),
      bills: vi.fn(() => ({})),
      settings: vi.fn(() => ({})),
      transactions: vi.fn(() => ({}))
    };
    const sessionRef = renderController('dashboard', builders);

    expect(builders.dashboard).toHaveBeenCalledTimes(1);
    expect(builders.budgets).not.toHaveBeenCalled();
    expect(builders.bills).not.toHaveBeenCalled();
    expect(builders.settings).not.toHaveBeenCalled();
    expect(builders.transactions).not.toHaveBeenCalled();

    act(() => sessionRef.current.navigate('ledger'));

    expect(builders.dashboard).toHaveBeenCalledTimes(1);
    expect(builders.transactions).toHaveBeenCalledTimes(1);
    expect(builders.budgets).not.toHaveBeenCalled();
    expect(builders.bills).not.toHaveBeenCalled();
    expect(builders.settings).not.toHaveBeenCalled();

    act(() => sessionRef.current.navigate('bills'));

    expect(builders.dashboard).toHaveBeenCalledTimes(1);
    expect(builders.transactions).toHaveBeenCalledTimes(1);
    expect(builders.bills).toHaveBeenCalledTimes(1);
    expect(builders.budgets).not.toHaveBeenCalled();
    expect(builders.settings).not.toHaveBeenCalled();
  });

  it('does not invoke any expensive route model builder for self-contained routes', () => {
    const builders = {
      dashboard: vi.fn(() => ({})),
      budgets: vi.fn(() => ({})),
      bills: vi.fn(() => ({})),
      settings: vi.fn(() => ({})),
      transactions: vi.fn(() => ({}))
    };

    renderController('accounts', builders);

    Object.values(builders).forEach((builder) => expect(builder).not.toHaveBeenCalled());
  });
});
