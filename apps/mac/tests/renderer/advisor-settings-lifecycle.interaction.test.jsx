import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeMinimalWorkbook } from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import { CommandExecutorProvider } from '../../src/renderer/app/CommandExecutor.jsx';
import { useFinanceApplicationController } from '../../src/renderer/app/use-finance-application-controller.js';
import { WorkbookProvider } from '../../src/renderer/app/WorkbookProvider.jsx';
import { SettingsRoute } from '../../src/renderer/features/settings/SettingsRoute.jsx';
import { createNullRendererPorts } from '../../src/renderer/platform/ports.js';

function ControllerHarness({ controllerRef }) {
  controllerRef.current = useFinanceApplicationController({ routeId: 'settings' });
  return null;
}

function renderController(advisor) {
  const controllerRef = { current: null };
  const ports = createNullRendererPorts({
    advisor,
    clock: {
      now: () => '2026-07-29T04:00:00.000Z',
      today: () => '2026-07-29'
    }
  });
  const view = render(
    <WorkbookProvider
      initialRouteId="settings"
      initialWorkbook={makeMinimalWorkbook()}
      ports={ports}
    >
      <CommandExecutorProvider>
        <ControllerHarness controllerRef={controllerRef} />
      </CommandExecutorProvider>
    </WorkbookProvider>
  );
  return { controllerRef, ...view };
}

describe('advisor Settings lifecycle', () => {
  it('keeps model fields controlled and locks connection changes during lifecycle work', () => {
    const routeModel = (localModelPath, pending = false) => ({
      activeSection: 'settings-advisor',
      summaryItems: [],
      workbook: {},
      files: {},
      counterparties: [],
      advisor: {
        providerLabel: 'Local llama.cpp',
        defaultContextWindowTokens: 32768,
        contextOptions: [{ value: 32768, label: '32K tokens' }],
        settings: {
          provider: 'custom',
          model: 'cavalry-advisor',
          localModelPath,
          mmprojPath: ''
        },
        toggle: {
          disabled: false,
          label: pending ? 'Stop Model' : 'Start Model',
          pending,
          testDisabled: pending
        }
      }
    });
    const view = render(<SettingsRoute model={routeModel('/models/old.gguf')} />);

    expect(view.container.querySelector('#settings-local-model').value).toBe('/models/old.gguf');
    expect(view.container.querySelector('#settings-advisor-provider').disabled).toBe(false);

    view.rerender(<SettingsRoute model={routeModel('/models/new.gguf', true)} />);

    expect(view.container.querySelector('#settings-local-model').value).toBe('/models/new.gguf');
    expect(view.container.querySelector('#settings-advisor-provider').disabled).toBe(true);
  });

  it('subscribes before loading and reconciles status events through getServerStatus', async () => {
    let statusListener;
    let statusFailure = false;
    let serverStatus = {
      running: false,
      starting: false,
      manageable: false,
      message: 'Local model server is stopped.'
    };
    const unsubscribe = vi.fn();
    const advisor = {
      subscribe: vi.fn((listener) => {
        statusListener = listener;
        return unsubscribe;
      }),
      invoke: vi.fn(async (method) => {
        if (method === 'getSettings') {
          return {
            ok: true,
            settings: {
              provider: 'custom',
              model: 'cavalry-advisor',
              localModelPath: '/models/qwen.gguf'
            }
          };
        }
        if (method === 'getServerStatus') {
          return statusFailure
            ? { ok: false, error: 'Status temporarily unavailable.' }
            : { ok: true, status: serverStatus };
        }
        if (method === 'getMicrophoneStatus') return {};
        return { ok: true };
      })
    };
    const { controllerRef, unmount } = renderController(advisor);

    expect(advisor.subscribe).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(controllerRef.current.routeModels.settings.advisor.toggle.label).toBe('Start Model')
    );

    serverStatus = {
      running: true,
      starting: false,
      manageable: true,
      pid: 4321,
      message: 'Local model server is running.'
    };
    act(() => {
      statusListener({ phase: 'ready', message: 'Local model server is ready.' });
    });

    await waitFor(() => {
      expect(controllerRef.current.routeModels.settings.advisor.toggle).toMatchObject({
        disabled: false,
        label: 'Stop Model',
        shouldStop: true
      });
      expect(controllerRef.current.routeModels.settings.advisor.serverLine).toContain(
        'Local model server is running.'
      );
    });

    statusFailure = true;
    act(() => {
      statusListener({ phase: 'heartbeat', message: 'Refreshing status.' });
    });
    await waitFor(() =>
      expect(
        advisor.invoke.mock.calls.filter(([method]) => method === 'getServerStatus')
      ).toHaveLength(3)
    );
    expect(controllerRef.current.routeModels.settings.advisor.toggle.label).toBe('Stop Model');

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
