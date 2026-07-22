// Tests for the Companion API HTTP adapter.

import { afterEach, describe, expect, it } from 'vitest';

import { createCavalryApiController } from '@cavalry/companion-api/application/api/cavalry-api-controller.js';
import { createCavalryApiServer } from '@cavalry/companion-api/server/cavalry-api/server.js';

let server;

function makeWorkbook() {
  return {
    id: 'wb_1',
    name: 'The Plan',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    accounts: [
      { id: 'gcash', name: 'GCash', group: 'asset', currency: 'PHP', isActive: true },
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
        id: 'software',
        name: 'Software',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_software'
      }
    ],
    transactions: []
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

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
});

describe('Cavalry API HTTP adapter', () => {
  it('serves draft-first endpoints with dev auth enabled', async () => {
    const workbook = makeWorkbook();
    const controller = createCavalryApiController({
      workbooks: [workbook],
      createId: (prefix) => prefix + '_http',
      now: () => '2026-06-27T10:00:00.000Z'
    });
    server = createCavalryApiServer({
      controller,
      authOptions: {
        devAuthEnabled: true,
        devToken: 'dev-token',
        allowedWorkbookIds: ['wb_1']
      }
    });
    const baseUrl = await listen(server);

    const workbooks = await fetch(baseUrl + '/v1/workbooks', {
      headers: { authorization: 'Bearer dev-token' }
    });
    expect(workbooks.status).toBe(200);
    expect(await workbooks.json()).toMatchObject({
      workbooks: [{ workbook_id: 'wb_1' }]
    });

    const accounts = await fetch(baseUrl + '/v1/workbooks/wb_1/accounts?as_of_date=2026-06-30', {
      headers: { authorization: 'Bearer dev-token' }
    });
    expect(accounts.status).toBe(200);
    expect(await accounts.json()).toMatchObject({
      accounts: expect.arrayContaining([
        expect.objectContaining({
          account_id: 'gcash',
          balance_currency: 'PHP',
          balance_as_of: '2026-06-30',
          source_ref: 'account:gcash'
        })
      ])
    });

    const draft = await fetch(baseUrl + '/v1/workbooks/wb_1/drafts/transaction-batch', {
      method: 'POST',
      headers: {
        authorization: 'Bearer dev-token',
        'content-type': 'application/json',
        'idempotency-key': 'http-idem-1'
      },
      body: JSON.stringify({
        date_default: '2026-06-27',
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
    const body = await draft.json();

    expect(draft.status).toBe(200);
    expect(body).toMatchObject({
      draft_group_id: 'dg_http',
      review_url: 'cavalry://draft-groups/dg_http',
      summary: { total: 1, ready: 1 }
    });
    expect(workbook.transactions).toEqual([]);
  });

  it('does not authenticate dev requests unless dev auth is enabled', async () => {
    server = createCavalryApiServer({
      controller: createCavalryApiController({ workbooks: [makeWorkbook()] }),
      authOptions: { devAuthEnabled: false }
    });
    const baseUrl = await listen(server);
    const response = await fetch(baseUrl + '/v1/workbooks');
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toMatchObject({
      code: 'auth_required'
    });
  });
});
