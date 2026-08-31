import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppearanceProvider } from '../../src/renderer/app/AppearanceProvider.jsx';
import { BillsRoute } from '../../src/renderer/features/recurring/BillsRoute.jsx';
import { createBillsController } from '../../src/renderer/features/recurring/bills-controller.js';
import { ACCOUNT_STORAGE_KEY } from '../../src/renderer/features/settings/account-preferences.js';
import { SettingsRoute } from '../../src/renderer/features/settings/SettingsRoute.jsx';
import {
  cloneFixture,
  makeIncomeAndExpenseWorkbook
} from '@cavalry/finance-core/test-fixtures/core-workbook-fixtures.js';
import { chooseOption } from './select-helpers.js';

const TODAY = '2026-06-15';

function makeWorkbook() {
  const workbook = cloneFixture(makeIncomeAndExpenseWorkbook());
  workbook.sheets = [
    { id: 'sheet-june', name: 'June', monthIndex: 5, budgets: [], budgetLineItems: [] }
  ];
  workbook.recurringItems = [];
  return workbook;
}

function makeSettingsModel(overrides = {}) {
  return {
    summaryItems: [],
    workbook: { name: 'The Plan', currency: 'PHP', usdRate: '58', details: [] },
    advisor: { settings: { provider: 'local' }, microphone: {} },
    files: {
      canSaveFileNow: true,
      canRevealFile: true,
      canChooseAutosaveFile: true,
      canClearFile: true
    },
    counterparties: [],
    health: { tone: 'good', label: 'Clear', issues: [] },
    feedback: {},
    ...overrides
  };
}

async function fillRecurringForm(user, values = {}) {
  await user.type(screen.getByLabelText('Recurring name'), values.name || 'Phone Plan');
  await user.clear(screen.getByLabelText('Recurring amount'));
  await user.type(screen.getByLabelText('Recurring amount'), String(values.amount || 599));
  fireEvent.change(screen.getByLabelText('Recurring due date'), {
    target: { value: values.dueDate || '2026-06-20' }
  });
  await user.click(screen.getByRole('combobox', { name: 'Recurring category' }));
  const categoryLabel = values.categoryId === 'food' ? 'Food' : 'Subscriptions';
  await user.click(screen.getByRole('option', { name: categoryLabel }));
  await chooseOption(
    user,
    screen.getByLabelText('Recurring payment account'),
    values.accountLabel || 'Bank'
  );
}

describe('Settings and Bills interactions', () => {
  it('lets the Mac resolve changes reported by an iPhone', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn(async () => ({ ok: true }));
    render(
      <SettingsRoute
        model={makeSettingsModel({
          activeSection: 'settings-account',
          cloud: {
            configured: true,
            status: 'signed_in',
            user: { id: 'icloud-owner', name: 'iCloud' },
            pendingCount: 0,
            current: {
              workbookId: 'workbook-plan',
              linked: true,
              conflict: false,
              status: 'synced',
              conflictNotice: {
                id: 'conflict-iphone-1',
                sourceDevice: 'iPhone',
                resolutionAvailable: true,
                report: {
                  version: 1,
                  workbookId: 'workbook-plan',
                  workbookName: 'The Plan',
                  conflictCount: 1,
                  omittedCount: 0,
                  entries: [
                    {
                      key: 'tx-1',
                      path: 'transactions["tx-1"]',
                      section: 'Transactions',
                      title: 'Groceries',
                      message: 'Both copies changed this item differently.',
                      local: {
                        label: 'This iPhone',
                        action: 'edited',
                        details: [{ label: 'Amount', before: 'PHP 500', after: 'PHP 650' }]
                      },
                      remote: {
                        label: 'iCloud copy',
                        action: 'edited',
                        details: [{ label: 'Amount', before: 'PHP 500', after: 'PHP 700' }]
                      }
                    }
                  ]
                }
              }
            },
            workbooks: []
          }
        })}
        onAction={onAction}
      />
    );

    expect(screen.getByText('1 decision needed')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Review Changes' }));
    expect(screen.getByText('Groceries')).not.toBeNull();
    expect(screen.getByText('Groceries · PHP 650')).not.toBeNull();
    expect(screen.getByText('Groceries · PHP 700')).not.toBeNull();
    expect(screen.getAllByText('Was PHP 500')).toHaveLength(2);
    await user.click(screen.getByRole('radio', { name: 'Use iCloud copy for Groceries' }));
    await user.click(screen.getByRole('button', { name: 'Apply Resolution' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Resolution' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'reconcile-cloud-workbook',
      payload: {
        conflictNoticeId: 'conflict-iphone-1',
        choices: [{ path: 'transactions["tx-1"]', side: 'remote' }]
      }
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Confirm Resolution' })).toBeNull()
    );
  });

  it('lets the Mac choose and confirm one side for every locally owned clash', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SettingsRoute
        model={makeSettingsModel({
          activeSection: 'settings-account',
          cloud: {
            configured: true,
            status: 'signed_in',
            user: { id: 'icloud-owner', name: 'iCloud' },
            pendingCount: 0,
            current: {
              workbookId: 'workbook-plan',
              linked: true,
              conflict: true,
              status: 'conflict',
              conflictNotice: {
                id: 'conflict-mac-1',
                sourceDevice: 'Mac',
                resolutionAvailable: true,
                remoteRevision: 9,
                report: {
                  version: 1,
                  workbookId: 'workbook-plan',
                  conflictCount: 1,
                  omittedCount: 0,
                  entries: [
                    {
                      key: 'tx-1',
                      path: 'transactions["tx-1"]',
                      section: 'Transactions',
                      title: 'Groceries',
                      local: {
                        label: 'This Mac',
                        action: 'edited',
                        details: [{ label: 'Amount', before: 'PHP 500', after: 'PHP 650' }]
                      },
                      remote: {
                        label: 'iCloud copy',
                        action: 'edited',
                        details: [{ label: 'Amount', before: 'PHP 500', after: 'PHP 700' }]
                      }
                    }
                  ]
                }
              }
            },
            workbooks: []
          }
        })}
        onAction={onAction}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Review Changes' }));
    const apply = screen.getByRole('button', { name: 'Apply Resolution' });
    expect(apply.disabled).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Use iCloud copy for Groceries' }));
    expect(screen.getByRole('button', { name: 'Apply Resolution' }).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Apply Resolution' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Resolution' }));

    expect(onAction).toHaveBeenLastCalledWith({
      type: 'reconcile-cloud-workbook',
      payload: {
        conflictNoticeId: 'conflict-mac-1',
        choices: [{ path: 'transactions["tx-1"]', side: 'remote' }]
      }
    });
  });

  it('never offers a destructive choice for a legacy internal-only review', () => {
    render(
      <SettingsRoute
        model={makeSettingsModel({
          activeSection: 'settings-account',
          cloud: {
            configured: true,
            status: 'signed_in',
            user: { id: 'icloud-owner', name: 'iCloud' },
            pendingCount: 0,
            current: {
              workbookId: 'workbook-plan',
              linked: true,
              conflict: true,
              status: 'conflict',
              conflictNotice: {
                id: 'legacy-internal-review',
                sourceDevice: 'iPhone',
                resolutionAvailable: true,
                remoteRevision: 9,
                report: {
                  version: 1,
                  workbookId: 'workbook-plan',
                  conflictCount: 2,
                  omittedCount: 0,
                  entries: [
                    {
                      key: 'settings',
                      path: 'settings',
                      section: 'Workbook',
                      title: 'Settings',
                      local: { label: 'This iPhone', action: 'different', details: [] },
                      remote: { label: 'iCloud copy', action: 'different', details: [] }
                    },
                    {
                      key: 'updated-at',
                      path: 'updatedAt',
                      section: 'Workbook',
                      title: 'Updated At',
                      local: { label: 'This iPhone', action: 'different', details: [] },
                      remote: { label: 'iCloud copy', action: 'different', details: [] }
                    }
                  ]
                }
              }
            },
            workbooks: []
          }
        })}
        onAction={vi.fn()}
      />
    );

    expect(screen.getAllByText('Updating details').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Cavalry is refreshing this review so it shows only real workbook changes.')
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Review Changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep Mac Copy' })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('reviews several clashes one at a time and preserves every choice', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SettingsRoute
        model={makeSettingsModel({
          activeSection: 'settings-account',
          cloud: {
            configured: true,
            status: 'signed_in',
            user: { id: 'icloud-owner', name: 'iCloud' },
            pendingCount: 0,
            current: {
              workbookId: 'workbook-plan',
              linked: true,
              conflict: true,
              status: 'conflict',
              conflictNotice: {
                id: 'conflict-mac-many',
                sourceDevice: 'Mac',
                resolutionAvailable: true,
                remoteRevision: 10,
                report: {
                  version: 1,
                  workbookId: 'workbook-plan',
                  workbookName: 'Main Plan',
                  conflictCount: 3,
                  omittedCount: 0,
                  entries: [
                    {
                      key: 'opening',
                      path: 'transactions["opening"]',
                      section: 'Transactions',
                      title: 'Cash opening balance',
                      local: {
                        label: 'This Mac',
                        action: 'deleted',
                        details: [
                          {
                            label: 'Description',
                            before: 'Cash opening balance',
                            after: 'None'
                          },
                          { label: 'Amount', before: 'PHP 600,000', after: 'None' }
                        ]
                      },
                      remote: {
                        label: 'iCloud copy',
                        action: 'unchanged',
                        details: [
                          {
                            label: 'Description',
                            before: 'Cash opening balance',
                            after: 'Cash opening balance'
                          },
                          { label: 'Amount', before: 'PHP 600,000', after: 'PHP 600,000' },
                          { label: 'Date', before: 'Apr 1, 2026', after: 'Apr 1, 2026' }
                        ]
                      }
                    },
                    {
                      key: 'groceries',
                      path: 'transactions["groceries"]',
                      section: 'Transactions',
                      title: 'Grocery delivery',
                      local: {
                        label: 'This Mac',
                        action: 'edited',
                        details: [{ label: 'Amount', before: 'PHP 1,000', after: 'PHP 1,200' }]
                      },
                      remote: {
                        label: 'iCloud copy',
                        action: 'edited',
                        details: [{ label: 'Amount', before: 'PHP 1,000', after: 'PHP 1,500' }]
                      }
                    },
                    {
                      key: 'salary',
                      path: 'transactions["salary"]',
                      section: 'Transactions',
                      title: 'Salary deposit',
                      local: {
                        label: 'This Mac',
                        action: 'unchanged',
                        details: [{ label: 'Amount', before: 'PHP 80,000', after: 'PHP 80,000' }]
                      },
                      remote: {
                        label: 'iCloud copy',
                        action: 'deleted',
                        details: [{ label: 'Amount', before: 'PHP 80,000', after: 'None' }]
                      }
                    }
                  ]
                }
              }
            },
            workbooks: []
          }
        })}
        onAction={onAction}
      />
    );

    expect(screen.getByText('3 decisions needed')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Review Changes' }));
    expect(screen.getByText('Keep this transaction?')).not.toBeNull();
    expect(screen.getByText('Up next')).not.toBeNull();
    expect(screen.getByText('0 of 3 decisions made')).not.toBeNull();

    await user.click(
      screen.getByRole('radio', { name: 'Use iCloud copy for Cash opening balance' })
    );
    const groceryRow = screen
      .getByText('Grocery delivery')
      .closest('.settings-cloud-conflict-queue-row');
    await user.click(within(groceryRow).getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Which version should Cavalry keep?')).not.toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Use This Mac for Grocery delivery' }));

    const salaryRow = screen
      .getByText('Salary deposit')
      .closest('.settings-cloud-conflict-queue-row');
    await user.click(within(salaryRow).getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('radio', { name: 'Use iCloud copy for Salary deposit' }));

    expect(screen.getByText('3 of 3 decisions made')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Apply Resolution' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Resolution' }));

    expect(onAction).toHaveBeenLastCalledWith({
      type: 'reconcile-cloud-workbook',
      payload: {
        conflictNoticeId: 'conflict-mac-many',
        choices: [
          { path: 'transactions["opening"]', side: 'remote' },
          { path: 'transactions["groceries"]', side: 'local' },
          { path: 'transactions["salary"]', side: 'remote' }
        ]
      }
    });
  });

  it('shows only the selected settings section', async () => {
    const user = userEvent.setup();
    render(<SettingsRoute model={makeSettingsModel()} />);

    expect(document.getElementById('settings-general').hidden).toBe(false);
    expect(document.getElementById('settings-appearance').hidden).toBe(true);

    await user.click(screen.getByRole('tab', { name: /Appearance/ }));

    expect(document.getElementById('settings-appearance').hidden).toBe(false);
    expect(document.getElementById('settings-general').hidden).toBe(true);
    expect(screen.getByRole('heading', { name: 'Color theme', level: 3 })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Appearance', level: 2 })).toBeNull();
  });

  it('supports keyboard navigation between labeled settings panels', async () => {
    const user = userEvent.setup();
    render(<SettingsRoute model={makeSettingsModel()} />);

    const workbookTab = screen.getByRole('tab', { name: /Workbook/ });
    workbookTab.focus();
    await user.keyboard('{ArrowRight}');

    const appearanceTab = screen.getByRole('tab', { name: /Appearance/ });
    expect(appearanceTab.getAttribute('aria-selected')).toBe('true');
    expect(appearanceTab.getAttribute('aria-controls')).toBe('settings-appearance');
    expect(document.getElementById('settings-appearance').hidden).toBe(false);
    expect(screen.getByRole('tabpanel', { name: /Appearance/ })).not.toBeNull();
  });

  it('locks a saved API key until the remove control is used', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SettingsRoute
        model={makeSettingsModel({
          activeSection: 'settings-advisor',
          advisor: {
            providerLabel: 'OpenAI / API',
            apiKeyPlaceholder: 'OpenAI API key',
            modelPlaceholder: 'gpt-5.4-mini',
            endpointPlaceholder: 'https://api.openai.com/v1/responses',
            settings: {
              provider: 'openai',
              apiMode: 'responses',
              model: 'gpt-5.4-mini',
              endpoint: 'https://api.openai.com/v1/responses',
              hasApiKey: true,
              apiKeyPreview: '********1234'
            },
            microphone: {}
          }
        })}
        onAction={onAction}
      />
    );

    const apiKey = screen.getByLabelText('OpenAI key');
    expect(apiKey.disabled).toBe(true);
    expect(apiKey.value).toBe('********1234');

    await user.click(screen.getByRole('button', { name: 'Remove saved OpenAI key' }));
    const unlockedApiKey = screen.getByLabelText('OpenAI key');
    expect(unlockedApiKey.disabled).toBe(false);
    expect(unlockedApiKey.value).toBe('');
    await user.type(unlockedApiKey, 'sk-replacement');
    await user.click(screen.getByRole('button', { name: 'Save Assistant' }));

    expect(onAction).toHaveBeenLastCalledWith({
      type: 'save-advisor-settings',
      payload: expect.objectContaining({ apiKey: 'sk-replacement' })
    });
  });

  it('keeps model test feedback inside the Assistant tab without duplicating it', () => {
    render(
      <SettingsRoute
        model={makeSettingsModel({
          activeSection: 'settings-advisor',
          advisor: {
            providerLabel: 'OpenAI / API',
            settings: { provider: 'openai', model: 'gpt-5.4-mini' },
            statusLine: 'Settings: Model test passed.',
            connectionLine: 'Model test: Model test passed.',
            microphone: {}
          },
          feedback: {
            notice: 'Model test passed.',
            section: 'settings-advisor'
          }
        })}
      />
    );

    const assistantPanel = screen.getByRole('tabpanel', { name: /Assistant/ });
    expect(within(assistantPanel).getByText('Model test: Model test passed.')).not.toBeNull();
    expect(within(assistantPanel).getAllByText(/Model test passed/)).toHaveLength(1);
    expect(document.querySelector('.settings-shell > .settings-feedback')).toBeNull();
  });

  it('applies and persists a custom flat color palette', async () => {
    const user = userEvent.setup();
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    render(
      <AppearanceProvider storage={storage}>
        <SettingsRoute model={makeSettingsModel()} />
      </AppearanceProvider>
    );

    await user.click(screen.getByRole('tab', { name: /Appearance/ }));
    await user.click(screen.getByRole('button', { name: /Custom/ }));

    const backgroundColor = screen.getByLabelText('Background color');
    expect(backgroundColor.value).toBe('#101114');
    fireEvent.change(backgroundColor, { target: { value: '#223344' } });

    expect(document.documentElement.dataset.theme).toBe('custom');
    expect(document.documentElement.style.getPropertyValue('--custom-background')).toBe('#223344');
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)[1])).toMatchObject({
      theme: 'custom',
      customPalette: { background: '#223344' }
    });
  });

  it('submits settings rate/counterparty forms and file intents explicitly', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { container } = render(<SettingsRoute model={makeSettingsModel()} onAction={onAction} />);

    const rateInput = container.querySelector('input[name="usdRate"]');
    await user.clear(rateInput);
    await user.type(rateInput, '59.25');
    await user.click(screen.getByRole('button', { name: 'Update Rate' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'update-usd-rate',
      payload: { usdRate: '59.25' }
    });

    await user.type(container.querySelector('#counterparty-form input[name="name"]'), 'Globe');
    await chooseOption(user, screen.getByRole('combobox', { name: 'Type' }), 'Biller');
    await user.type(container.querySelector('#counterparty-form input[name="note"]'), 'Internet');
    await user.click(
      within(container.querySelector('#counterparty-form')).getByRole('button', { name: /Add/ })
    );
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'add-counterparty',
      payload: { name: 'Globe', kind: 'biller', note: 'Internet' }
    });

    const workbookNameInput = container.querySelector('#settings-workbook-name');
    await user.clear(workbookNameInput);
    await user.type(workbookNameInput, 'Household Plan');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'rename-workbook',
      payload: { name: 'Household Plan' }
    });

    await user.click(screen.getByRole('tab', { name: /Files & Data/ }));
    await user.click(screen.getByRole('button', { name: /Save Now/ }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'run-file-autosave', payload: {} });
  });

  it('saves the local account profile from the Account tab', async () => {
    const user = userEvent.setup();
    const stored = new Map();
    const fakeStorage = {
      getItem: (key) => (stored.has(key) ? stored.get(key) : null),
      setItem: (key, value) => stored.set(key, String(value)),
      removeItem: (key) => stored.delete(key)
    };
    const originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, value: fakeStorage });
    try {
      const { container } = render(<SettingsRoute model={makeSettingsModel()} />);

      await user.click(screen.getByRole('tab', { name: /Account/ }));
      await user.type(container.querySelector('#settings-account-name'), 'Alex Example');
      await user.type(container.querySelector('#settings-account-email'), 'alex@example.com');
      await user.click(screen.getByRole('button', { name: /Save Profile/ }));

      expect(JSON.parse(stored.get(ACCOUNT_STORAGE_KEY))).toEqual({
        name: 'Alex Example',
        email: 'alex@example.com'
      });
      expect(screen.getByText('Profile saved on this Mac.')).not.toBeNull();
    } finally {
      if (originalStorage) {
        Object.defineProperty(window, 'localStorage', originalStorage);
      } else {
        delete window.localStorage;
      }
    }
  });

  it('dispatches cloud workbook actions and confirms removal', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { container } = render(
      <SettingsRoute
        model={makeSettingsModel({
          activeSection: 'settings-account',
          cloud: {
            configured: true,
            status: 'signed_in',
            user: { id: 'user-1', name: 'Alex Example', email: 'alex@example.com' },
            current: {
              workbookId: 'workbook-current',
              linked: true,
              status: 'synced',
              cloudUpdatedAt: '2026-07-20T04:00:00.000Z'
            },
            workbooks: [
              {
                id: 'workbook-current',
                name: 'The Plan',
                year: 2026,
                currency: 'PHP',
                revision: 2,
                updatedAt: '2026-07-20T04:00:00.000Z'
              },
              {
                id: 'workbook-business',
                name: 'Business',
                year: 2026,
                currency: 'USD',
                revision: 1,
                updatedAt: '2026-07-19T04:00:00.000Z'
              }
            ]
          }
        })}
        onAction={onAction}
      />
    );

    const identityCard = screen.getByRole('heading', { name: 'iCloud Sync' }).closest('section');
    expect(within(identityCard).getByText('Your workbooks stay in sync')).not.toBeNull();
    expect(within(identityCard).queryByText(/CKSyncEngine/)).toBeNull();
    expect(within(identityCard).queryByRole('button')).toBeNull();

    const libraryCard = screen
      .getByRole('heading', { name: 'iCloud Workbooks' })
      .closest('section');
    expect(within(libraryCard).getAllByText('The Plan')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Sync Changes' })).toHaveLength(1);
    await user.click(within(libraryCard).getByRole('button', { name: 'Sync Changes' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'upload-current-workbook', payload: {} });

    await user.click(screen.getByRole('button', { name: 'Delete The Plan from iCloud' }));
    expect(onAction).not.toHaveBeenCalledWith({
      type: 'delete-cloud-workbook',
      payload: { workbookId: 'workbook-current' }
    });
    expect(
      screen.getByText('Deletes only the iCloud version. This workbook stays saved on this Mac.')
    ).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Confirm Delete from iCloud' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'delete-cloud-workbook',
      payload: { workbookId: 'workbook-current' }
    });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Open Business from iCloud' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'open-cloud-workbook',
      payload: { workbookId: 'workbook-business' }
    });

    await user.click(screen.getByRole('button', { name: 'Delete Business from iCloud' }));
    expect(onAction).not.toHaveBeenCalledWith({
      type: 'delete-cloud-workbook',
      payload: { workbookId: 'workbook-business' }
    });
    await user.click(
      screen.getByRole('button', { name: 'Confirm deletion of Business from iCloud' })
    );
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'delete-cloud-workbook',
      payload: { workbookId: 'workbook-business' }
    });
  });

  it('lets the user manually add the open Mac workbook to iCloud', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SettingsRoute
        model={makeSettingsModel({
          activeSection: 'settings-account',
          cloud: {
            configured: true,
            status: 'signed_in',
            user: { id: 'user-1', name: 'iCloud' },
            current: {
              workbookId: 'workbook-plan',
              linked: false,
              conflict: false,
              status: 'local_only'
            },
            workbooks: []
          }
        })}
        onAction={onAction}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add to iCloud' }));

    expect(onAction).toHaveBeenCalledWith({
      type: 'upload-current-workbook',
      payload: {}
    });
  });

  it('recreates a missing iCloud workbook without offering an unavailable copy', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn(async () => ({ ok: true }));
    render(
      <SettingsRoute
        model={makeSettingsModel({
          activeSection: 'settings-account',
          cloud: {
            configured: true,
            status: 'signed_in',
            user: { id: 'user-1', name: 'iCloud' },
            current: {
              workbookId: 'workbook-plan',
              linked: false,
              conflict: true,
              status: 'conflict'
            },
            workbooks: []
          }
        })}
        onAction={onAction}
      />
    );

    expect(screen.getByText('Not in iCloud')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Use iCloud Version/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete .* from iCloud/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add Mac Version to iCloud' }));
    expect(onAction).not.toHaveBeenCalled();
    expect(
      screen.getByText('Adds this Mac version to iCloud so it is available on your Apple devices.')
    ).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Confirm Add to iCloud' }));

    expect(onAction).toHaveBeenCalledWith({
      type: 'keep-local-cloud-workbook',
      payload: {}
    });
  });

  it('uses plain version choices before replacing either side of a conflict', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn(async () => ({ ok: true }));
    render(
      <SettingsRoute
        model={makeSettingsModel({
          activeSection: 'settings-account',
          cloud: {
            configured: true,
            status: 'signed_in',
            user: { id: 'user-1', name: 'iCloud' },
            current: {
              workbookId: 'workbook-plan',
              linked: true,
              conflict: true,
              status: 'conflict'
            },
            workbooks: [{ id: 'workbook-plan', name: 'The Plan', revision: 7 }]
          }
        })}
        onAction={onAction}
      />
    );

    expect(screen.queryByText('Review iCloud Copy')).toBeNull();
    expect(screen.queryByText('Keep Mac Copy')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Use iCloud version of The Plan' }));
    expect(onAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm Use iCloud Version' }));
    expect(onAction).toHaveBeenCalledWith({
      type: 'open-cloud-workbook',
      payload: { workbookId: 'workbook-plan' }
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Use Mac Version' })).not.toBeNull()
    );
    await user.click(screen.getByRole('button', { name: 'Use Mac Version' }));
    expect(
      screen.getByText('Replaces the iCloud version with this Mac version on your Apple devices.')
    ).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Confirm Use Mac Version' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'keep-local-cloud-workbook',
      payload: {}
    });
  });

  it('shows form validation, submits recurring data, and supports cancel', async () => {
    const user = userEvent.setup();
    const workbook = makeWorkbook();
    const controller = createBillsController({
      currentDate: TODAY,
      createId: () => 'recurring-phone'
    });
    const model = controller.buildModel(workbook, { sheetId: 'sheet-june' });
    const onAction = vi.fn(() => ({ ok: true, events: [], warnings: [], errors: [] }));
    render(<BillsRoute model={model} onAction={onAction} />);

    await user.click(screen.getByRole('button', { name: 'Create bill or subscription' }));
    await user.click(screen.getByRole('button', { name: 'Save Bill' }));
    expect(screen.getByRole('alert').textContent).toContain('Name is required.');
    expect(onAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'save-recurring-item' })
    );

    await fillRecurringForm(user);
    expect(screen.getByLabelText('Recurring amount').value).toBe('599.00');
    await user.click(screen.getByRole('button', { name: 'Save Bill' }));
    expect(onAction).toHaveBeenLastCalledWith({
      type: 'save-recurring-item',
      payload: expect.objectContaining({
        name: 'Phone Plan',
        amount: 599,
        categoryId: 'subscriptions',
        accountId: 'bank',
        dueDate: '2026-06-20'
      })
    });
    expect(screen.queryByRole('dialog', { name: 'Add bill or subscription' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Create bill or subscription' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'close-modal', payload: {} });
  });

  it('keeps the editor open and renders controller/persistence errors', async () => {
    const user = userEvent.setup();
    const controller = createBillsController({ currentDate: TODAY });
    const model = controller.buildModel(makeWorkbook(), { sheetId: 'sheet-june' });
    const onAction = vi.fn((action) =>
      action.type === 'save-recurring-item'
        ? { ok: false, errors: [{ message: 'Workbook persistence failed.' }] }
        : { ok: true, errors: [] }
    );
    render(<BillsRoute model={model} onAction={onAction} />);

    await user.click(screen.getByRole('button', { name: 'Create bill or subscription' }));
    await fillRecurringForm(user);
    await user.click(screen.getByRole('button', { name: 'Save Bill' }));

    expect(screen.getByRole('alert').textContent).toContain('Workbook persistence failed.');
    expect(screen.getByRole('dialog', { name: 'Add bill or subscription' })).not.toBeNull();
  });

  it('rerenders a created recurring item from the controller result and archives it', async () => {
    const user = userEvent.setup();
    let workbook = makeWorkbook();
    const original = workbook;
    const controller = createBillsController({
      currentDate: TODAY,
      createId: () => 'recurring-phone'
    });
    const onAction = vi.fn((action) => {
      const result = controller.handleAction(workbook, action, {
        viewState: { sheetId: 'sheet-june' }
      });
      if (result.ok && result.workbook !== workbook) workbook = result.workbook;
      return result;
    });
    const rendered = render(
      <BillsRoute
        model={controller.buildModel(workbook, { sheetId: 'sheet-june' })}
        onAction={onAction}
      />
    );

    const created = controller.handleAction(workbook, {
      type: 'save-recurring-item',
      payload: {
        kind: 'bill',
        name: 'Phone Plan',
        categoryId: 'subscriptions',
        accountId: 'bank',
        amount: 599,
        currency: 'PHP',
        frequency: 'Monthly',
        dueDate: '2026-06-20',
        isActive: true
      }
    });
    expect(created.ok).toBe(true);
    expect(created.workbook).not.toBe(original);
    workbook = created.workbook;

    rendered.rerender(
      <BillsRoute
        model={controller.buildModel(workbook, { sheetId: 'sheet-june' })}
        onAction={onAction}
      />
    );
    expect(screen.getAllByText('Phone Plan').length).toBeGreaterThan(0);

    await user.click(rendered.container.querySelector('summary[aria-label="Bill actions"]'));
    await user.click(screen.getByRole('button', { name: 'Archive recurring item' }));
    const dialog = screen.getByRole('dialog', { name: 'Archive recurring item' });
    await user.click(within(dialog).getByRole('button', { name: /Archive/ }));
    expect(workbook.recurringItems.find((item) => item.id === 'recurring-phone').isActive).toBe(
      false
    );
  });

  it('renders route-level persistence failures without HTML injection', () => {
    render(
      <SettingsRoute
        model={makeSettingsModel({ feedback: { error: '<script>failed</script>' } })}
      />
    );

    expect(screen.getByRole('alert').textContent).toContain('<script>failed</script>');
    expect(document.querySelector('script')).toBeNull();
  });
});
