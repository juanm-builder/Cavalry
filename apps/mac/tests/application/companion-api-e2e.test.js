import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import { CAVALRY_API_SCOPES } from '@cavalry/companion-api/application/api/cavalry-api-authz.js';
import { createCloudReadinessInterfaces } from '@cavalry/companion-api/application/api/cloud-readiness-interfaces.js';
import { exportCompanionApiAuditEvents } from '@cavalry/companion-api/application/api/companion-api-audit.js';
import { createCavalryApiController } from '@cavalry/companion-api/application/api/cavalry-api-controller.js';
import { toSafeApiError } from '@cavalry/companion-api/application/api/cavalry-api-errors.js';
import {
  applyExternalDraftGroup,
  rejectExternalDraftGroup
} from '@cavalry/action-review/application/drafts/external-draft-service.js';
import {
  getDraftGroupIdFromReviewUrl,
  reviewUrlHasSensitiveData,
  validateDraftGroupReviewUrl
} from '@cavalry/action-review/application/drafts/review-url.js';
import {
  createCavalryApiServer,
  resolveCavalryApiHost,
  startCavalryApiServer
} from '@cavalry/companion-api/server/cavalry-api/server.js';

const require = createRequire(import.meta.url);
const { getCavalryDeepLinkCommand } = require('../../src/main/deep-link.cjs');

let server;

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_e2e_' + String(counters[prefix]);
  };
}

function makeWorkbook() {
  return {
    id: 'wb_1',
    name: 'The Plan',
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
      },
      { id: 'cash', name: 'Cash', group: 'asset', currency: 'PHP', isActive: true }
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
      },
      {
        id: 'subscriptions',
        name: 'Subscriptions',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_subscriptions'
      },
      {
        id: 'transport',
        name: 'Transport',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_transport'
      },
      { id: 'food', name: 'Food', type: 'expense', isActive: true, linkedAccountId: 'expense_food' }
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
      },
      {
        id: 'txn_food',
        date: '2026-06-20',
        template: 'expense_paid',
        description: 'Unknown store',
        amount: 120,
        originalCurrency: 'PHP',
        categoryId: 'office_supplies',
        primaryAccountId: 'cash',
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
  return fetch(
    baseUrl + path,
    Object.assign(
      {
        headers: {
          authorization: 'Bearer dev-token'
        }
      },
      options
    )
  );
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
});

describe('Companion API e2e certification path', () => {
  it('serves GPT-facing reads, creates review drafts, opens review links, and applies only through Cavalry-side confirmation', async () => {
    const workbook = makeWorkbook();
    const createId = makeCreateId();
    const controller = createCavalryApiController({
      workbooks: [workbook],
      createId,
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

    const capabilities = await apiFetch(baseUrl, '/v1/capabilities');
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({
      review_required_for_all_external_writes: true,
      capabilities: { apply_drafts_from_chatgpt: false }
    });

    const summary = await apiFetch(
      baseUrl,
      '/v1/workbooks/wb_1/summary?start_date=2026-06-01&end_date=2026-06-30'
    );
    expect(summary.status).toBe(200);
    expect((await summary.json()).totals).toHaveProperty('consumption_spending');

    expect((await apiFetch(baseUrl, '/v1/workbooks/wb_1/accounts')).status).toBe(200);
    expect((await apiFetch(baseUrl, '/v1/workbooks/wb_1/categories')).status).toBe(200);
    expect(
      (await apiFetch(baseUrl, '/v1/workbooks/wb_1/transactions/recent?limit=10')).status
    ).toBe(200);

    const beforeTransactionCount = workbook.transactions.length;
    const created = await apiFetch(baseUrl, '/v1/workbooks/wb_1/drafts/transaction-batch', {
      method: 'POST',
      headers: {
        authorization: 'Bearer dev-token',
        'content-type': 'application/json',
        'idempotency-key': 'e2e-create-1'
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
    const createdBody = await created.json();
    expect(created.status).toBe(200);
    expect(workbook.transactions).toHaveLength(beforeTransactionCount);
    expect(workbook.externalDraftGroups).toHaveLength(1);
    expect(workbook.aiDrafts).toHaveLength(1);
    expect(workbook.advisorDraftGroups).toHaveLength(1);

    const reviewUrl = createdBody.review_url;
    expect(reviewUrl).toBe('cavalry://draft-groups/' + createdBody.draft_group_id);
    expect(reviewUrlHasSensitiveData(reviewUrl)).toBe(false);
    expect(getDraftGroupIdFromReviewUrl(reviewUrl + '?ignored=true')).toBe(
      createdBody.draft_group_id
    );
    expect(validateDraftGroupReviewUrl({ workbook, reviewUrl, userId: 'dev-user' })).toMatchObject({
      ok: true
    });
    expect(getCavalryDeepLinkCommand(reviewUrl)).toEqual({
      type: 'open-draft-group',
      draftGroupId: createdBody.draft_group_id
    });

    const fetchedDraftGroup = await apiFetch(
      baseUrl,
      '/v1/workbooks/wb_1/draft-groups/' + createdBody.draft_group_id
    );
    expect(fetchedDraftGroup.status).toBe(200);
    expect((await fetchedDraftGroup.json()).draft_group_id).toBe(createdBody.draft_group_id);

    const forbiddenApply = await apiFetch(
      baseUrl,
      '/v1/workbooks/wb_1/draft-groups/' + createdBody.draft_group_id + '/apply',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer dev-token',
          'content-type': 'application/json'
        },
        body: '{}'
      }
    );
    expect(forbiddenApply.status).toBe(404);

    const applied = applyExternalDraftGroup({
      workbook,
      draftGroupId: createdBody.draft_group_id,
      confirmedByUser: true,
      caller: {
        user_id: 'dev-user',
        subject_type: 'user',
        scopes: [CAVALRY_API_SCOPES.DRAFT_APPLY],
        allowed_workbook_ids: ['wb_1']
      },
      createId
    });
    expect(applied.status).toBe('applied');
    expect(workbook.transactions.length).toBe(beforeTransactionCount + 1);

    const recurring = await apiFetch(baseUrl, '/v1/workbooks/wb_1/drafts/recurring-items', {
      method: 'POST',
      headers: {
        authorization: 'Bearer dev-token',
        'content-type': 'application/json',
        'idempotency-key': 'e2e-recurring-1'
      },
      body: JSON.stringify({
        items: [
          { name: 'ChatGPT Pro', amount: 6490, cadence: 'monthly', category_hint: 'Subscriptions' }
        ]
      })
    });
    const recurringBody = await recurring.json();
    const rejected = rejectExternalDraftGroup({
      workbook,
      draftGroupId: recurringBody.draft_group_id,
      caller: {
        user_id: 'dev-user',
        subject_type: 'user',
        scopes: [CAVALRY_API_SCOPES.DRAFT_APPLY]
      },
      createId
    });
    expect(rejected.status).toBe('rejected');

    const audit = exportCompanionApiAuditEvents(workbook);
    expect(audit.some((event) => event.request_fingerprint)).toBe(false);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          request_id: expect.stringMatching(/^req_/),
          caller_type: 'local_dev_api',
          workbook_id: 'wb_1',
          operation_id: 'createTransactionDraftBatch',
          action_count: 1,
          draft_group_id: createdBody.draft_group_id,
          idempotency_result: 'created',
          outcome: 'success'
        })
      ])
    );
  });

  it('fails closed for auth, scope, workbook, payload, host, and malformed review URL cases', async () => {
    const workbook = makeWorkbook();
    server = createCavalryApiServer({
      controller: createCavalryApiController({ workbooks: [workbook] }),
      authOptions: {
        devAuthEnabled: true,
        devToken: 'dev-token',
        allowedWorkbookIds: ['wb_1'],
        scopes: [CAVALRY_API_SCOPES.READ_CAPABILITIES]
      },
      maxBodyBytes: 64
    });
    const baseUrl = await listen(server);

    const missingAuth = await fetch(baseUrl + '/v1/workbooks');
    expect(missingAuth.status).toBe(401);
    expect((await missingAuth.json()).error.code).toBe('auth_required');

    const scopeDenied = await apiFetch(baseUrl, '/v1/workbooks');
    expect(scopeDenied.status).toBe(403);
    expect((await scopeDenied.json()).error.code).toBe('scope_denied');

    const tooLarge = await apiFetch(baseUrl, '/v1/workbooks/wb_1/drafts/transaction-batch', {
      method: 'POST',
      headers: {
        authorization: 'Bearer dev-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        transactions: [
          {
            description: 'This body intentionally exceeds the tiny test limit',
            amount: 1,
            currency: 'PHP',
            direction: 'expense'
          }
        ]
      })
    });
    expect(tooLarge.status).toBe(413);
    expect((await tooLarge.json()).error.code).toBe('payload_too_large');

    expect(
      validateDraftGroupReviewUrl({ workbook, reviewUrl: 'cavalry://draft-groups/nope' })
    ).toMatchObject({
      ok: false,
      code: 'draft_group_not_found'
    });
    expect(
      validateDraftGroupReviewUrl({
        workbook: {
          id: 'wb_other',
          externalDraftGroups: [{ draft_group_id: 'dg_cross', workbook_id: 'wb_1' }]
        },
        reviewUrl: 'cavalry://draft-groups/dg_cross'
      })
    ).toMatchObject({
      ok: false,
      code: 'cross_workbook_review_url'
    });
    expect(
      validateDraftGroupReviewUrl({ workbook, reviewUrl: 'https://example.com/dg_1' })
    ).toMatchObject({
      ok: false,
      code: 'malformed_review_url'
    });
    expect(reviewUrlHasSensitiveData('cavalry://draft-groups/dg_1?token=secret')).toBe(true);
    expect(getCavalryDeepLinkCommand('cavalry://transactions/txn_1')).toBe(null);

    expect(() => resolveCavalryApiHost({ host: '0.0.0.0' })).toThrow();
    expect(() => startCavalryApiServer({ enabled: false, quiet: true })).toThrow();
    expect(toSafeApiError(new Error('boom'), 'req_x').body.error.code).toBe('server_error');

    const cloudInterfaces = createCloudReadinessInterfaces();
    await expect(cloudInterfaces.authProvider.introspectToken()).rejects.toThrow(
      /not implemented/i
    );
  });
});
