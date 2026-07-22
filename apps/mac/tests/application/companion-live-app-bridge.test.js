import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import { createLiveCompanionWorkbookStore } from '@cavalry/companion-api/server/cavalry-api/live-workbook-store.js';
import { createCavalryApiServer } from '@cavalry/companion-api/server/cavalry-api/server.js';
import { getCompanionApiRuntimeConfig } from '@cavalry/companion-api/server/cavalry-api/runtime.js';

const require = createRequire(import.meta.url);
const { getCavalryDeepLinkCommand } = require('../../src/main/deep-link.cjs');

let server;

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_live_' + String(counters[prefix]);
  };
}

function makeOpenWorkbookFixture() {
  return {
    id: 'wb_live',
    name: 'Live App Workbook',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    accounts: [
      {
        id: 'office_cash_account',
        name: 'Office Cash Account',
        group: 'asset',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'credit_card',
        name: 'Credit Card',
        group: 'liability',
        currency: 'USD',
        isActive: true
      }
    ],
    categories: [
      {
        id: 'office_supplies',
        name: 'Office Supplies',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_office_supplies'
      },
      {
        id: 'software',
        name: 'Software',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_software'
      }
    ],
    transactions: [
      {
        id: 'txn_existing',
        date: '2026-06-27',
        template: 'expense_paid',
        description: 'Printer paper',
        amount: 150,
        originalCurrency: 'PHP',
        categoryId: 'office_supplies',
        primaryAccountId: 'office_cash_account',
        lines: []
      }
    ],
    recurringItems: [],
    sheets: [{ id: 'sheet_june', budgets: [] }]
  };
}

function listen(app) {
  return new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', () => {
      app.off('error', reject);
      const address = app.address();
      resolve('http://127.0.0.1:' + String(address.port));
    });
  });
}

async function apiFetch(baseUrl, path, options = {}) {
  const response = await fetch(
    baseUrl + path,
    Object.assign(
      {
        headers: { authorization: 'Bearer live-dev-token' }
      },
      options
    )
  );
  return {
    response,
    body: await response.json()
  };
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
});

describe('Companion live app bridge', () => {
  it('serves the currently open workbook and persists draft groups into the UI-visible draft store', async () => {
    let openWorkbook = makeOpenWorkbookFixture();
    const savedWorkbooks = [];
    const workbookStore = createLiveCompanionWorkbookStore({
      getWorkbook: () => openWorkbook,
      saveWorkbook: (workbook) => {
        openWorkbook = workbook;
        savedWorkbooks.push(workbook);
        return workbook;
      }
    });
    const runtimeConfig = getCompanionApiRuntimeConfig({
      enabled: true,
      mode: 'local_dev',
      aiActionMode: 'draft_only',
      authRequired: true
    });
    server = createCavalryApiServer({
      runtimeConfig,
      workbookStore,
      createId: makeCreateId(),
      now: () => '2026-06-28T02:00:00.000Z',
      authOptions: {
        devAuthEnabled: true,
        devToken: 'live-dev-token',
        allowedWorkbookIds: ['wb_live']
      }
    });
    const baseUrl = await listen(server);

    const workbooks = await apiFetch(baseUrl, '/v1/workbooks');
    expect(workbooks.response.status).toBe(200);
    expect(workbooks.body.workbooks).toEqual([
      expect.objectContaining({ workbook_id: 'wb_live', name: 'Live App Workbook' })
    ]);

    const accounts = await apiFetch(baseUrl, '/v1/workbooks/wb_live/accounts');
    const categories = await apiFetch(baseUrl, '/v1/workbooks/wb_live/categories');
    const recent = await apiFetch(baseUrl, '/v1/workbooks/wb_live/transactions/recent?limit=5');
    expect(accounts.body.accounts.map((account) => account.display_name)).toContain(
      'Office Cash Account'
    );
    expect(categories.body.categories.map((category) => category.display_name)).toContain(
      'Software'
    );
    expect(recent.body.transactions[0]).toMatchObject({ transaction_id: 'txn_existing' });

    const beforeTransactionCount = openWorkbook.transactions.length;
    const created = await apiFetch(baseUrl, '/v1/workbooks/wb_live/drafts/transaction-batch', {
      method: 'POST',
      headers: {
        authorization: 'Bearer live-dev-token',
        'content-type': 'application/json',
        'idempotency-key': 'live-bridge-draft-1'
      },
      body: JSON.stringify({
        date_default: '2026-06-28',
        transactions: [
          {
            description: 'OpenAI API credits',
            amount: 15,
            currency: 'USD',
            direction: 'expense',
            payment_account_hint: 'Credit Card',
            category_hint: 'Software'
          }
        ]
      })
    });

    expect(created.response.status).toBe(200);
    expect(savedWorkbooks).toHaveLength(1);
    expect(openWorkbook.transactions).toHaveLength(beforeTransactionCount);
    expect(openWorkbook.externalDraftGroups).toHaveLength(1);
    expect(openWorkbook.aiDrafts).toHaveLength(1);
    expect(openWorkbook.advisorDraftGroups).toHaveLength(1);
    expect(openWorkbook.aiDrafts[0]).toMatchObject({
      source: expect.objectContaining({
        type: 'external_api',
        externalDraftGroupId: created.body.draft_group_id
      })
    });
    expect(getCavalryDeepLinkCommand(created.body.review_url)).toEqual({
      type: 'open-draft-group',
      draftGroupId: created.body.draft_group_id
    });
  });
});
