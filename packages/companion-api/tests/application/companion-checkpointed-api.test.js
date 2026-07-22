// Tests for explicitly enabled checkpointed Companion API behavior.

import { afterEach, describe, expect, it } from 'vitest';

import { CAVALRY_API_SCOPES } from '@cavalry/companion-api/application/api/cavalry-api-authz.js';
import { createCavalryApiController } from '@cavalry/companion-api/application/api/cavalry-api-controller.js';
import { createCavalryApiServer } from '@cavalry/companion-api/server/cavalry-api/server.js';
import {
  generateCompanionBetaToken,
  hashCompanionBetaToken
} from '@cavalry/companion-api/server/cavalry-api/beta-token.js';
import {
  getCompanionApiRuntimeConfig,
  getCompanionRuntimeStatus
} from '@cavalry/companion-api/server/cavalry-api/runtime.js';

let server;

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_api_' + String(counters[prefix]);
  };
}

function makeWorkbook() {
  return {
    id: 'wb_checkpoint',
    name: 'Checkpoint Workbook',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    currentDate: '2026-06-28',
    accounts: [{ id: 'gcash', name: 'GCash', group: 'asset', currency: 'PHP', isActive: true }],
    categories: [
      {
        id: 'personal',
        name: 'Personal',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_personal'
      }
    ],
    transactions: [],
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

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(baseUrl + path, options);
  let body = null;
  try {
    body = await response.json();
  } catch (_error) {
    body = null;
  }
  return { response, body };
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
});

describe('checkpointed Companion API', () => {
  it('keeps checkpointed execution disabled unless runtime opts in', () => {
    const controller = createCavalryApiController({ workbooks: [makeWorkbook()] });
    expect(
      controller.getCapabilities({
        caller: {
          user_id: 'user_1',
          scopes: [CAVALRY_API_SCOPES.READ_CAPABILITIES],
          allowed_workbook_ids: ['wb_checkpoint']
        }
      })
    ).toMatchObject({
      capabilities: { execute_checkpointed_action_plans: false },
      ai_action_mode: 'draft_only',
      checkpointed_apply_enabled: false
    });
    expect(() =>
      controller.executeCheckpointedActionPlan({
        caller: {
          user_id: 'user_1',
          scopes: [CAVALRY_API_SCOPES.CHECKPOINT_EXECUTE],
          allowed_workbook_ids: ['wb_checkpoint']
        },
        workbookId: 'wb_checkpoint',
        body: { actions: [] }
      })
    ).toThrow(/Checkpointed AI actions are not enabled/);
  });

  it('does not grant checkpoint scopes to beta GPT tokens by default', async () => {
    const token = generateCompanionBetaToken();
    const runtimeConfig = getCompanionApiRuntimeConfig({
      enabled: true,
      mode: 'beta_tunnel',
      publicBaseUrl: 'http://127.0.0.1:1',
      allowInsecureTunnel: true,
      allowPrivateBaseUrl: true,
      aiActionMode: 'checkpointed_apply',
      checkpointedApplyEnabled: true
    });
    const workbook = makeWorkbook();
    const controller = createCavalryApiController({
      workbooks: [workbook],
      runtimeStatus: getCompanionRuntimeStatus(runtimeConfig)
    });
    server = createCavalryApiServer({
      controller,
      runtimeConfig,
      authOptions: {
        betaAuthEnabled: true,
        betaApiKeyHash: hashCompanionBetaToken(token),
        allowedWorkbookIds: ['wb_checkpoint']
      }
    });
    const baseUrl = await listen(server);
    const { response, body } = await requestJson(
      baseUrl,
      '/v1/workbooks/wb_checkpoint/checkpointed-action-plans/execute',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
          'idempotency-key': 'checkpoint-default-denied'
        },
        body: JSON.stringify({ actions: [] })
      }
    );

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('scope_denied');
  });

  it('executes checkpointed plans only with explicit checkpoint scopes and still denies rollback execution', async () => {
    const token = generateCompanionBetaToken();
    const runtimeConfig = getCompanionApiRuntimeConfig({
      enabled: true,
      mode: 'beta_tunnel',
      publicBaseUrl: 'http://127.0.0.1:1',
      allowInsecureTunnel: true,
      allowPrivateBaseUrl: true,
      aiActionMode: 'checkpointed_apply',
      checkpointedApplyEnabled: true,
      maxCheckpointActions: 5
    });
    const workbook = makeWorkbook();
    const controller = createCavalryApiController({
      workbooks: [workbook],
      runtimeStatus: getCompanionRuntimeStatus(runtimeConfig),
      createId: makeCreateId(),
      now: () => '2026-06-28T01:00:00.000Z'
    });
    server = createCavalryApiServer({
      controller,
      runtimeConfig,
      authOptions: {
        betaAuthEnabled: true,
        betaApiKeyHash: hashCompanionBetaToken(token),
        allowedWorkbookIds: ['wb_checkpoint'],
        checkpointScopesEnabled: true
      }
    });
    const baseUrl = await listen(server);
    const authHeaders = {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json'
    };
    const created = await requestJson(
      baseUrl,
      '/v1/workbooks/wb_checkpoint/checkpointed-action-plans/execute',
      {
        method: 'POST',
        headers: Object.assign({}, authHeaders, { 'idempotency-key': 'checkpoint-api-created' }),
        body: JSON.stringify({
          source_prompt: 'Add coffee.',
          action_plan: {
            date_default: '2026-06-28',
            actions: [
              {
                id: 'coffee',
                type: 'create_transaction',
                description: 'Coffee',
                amount: 90,
                direction: 'expense',
                payment_account_hint: 'GCash',
                category_hint: 'Personal'
              }
            ]
          }
        })
      }
    );

    expect(created.response.status).toBe(200);
    expect(created.body).toMatchObject({
      status: 'applied_with_checkpoint',
      checkpoint_review_url: 'cavalry://checkpoints/cp_api_1'
    });
    expect(workbook.transactions).toHaveLength(1);

    const list = await requestJson(baseUrl, '/v1/workbooks/wb_checkpoint/checkpoints', {
      headers: { authorization: 'Bearer ' + token }
    });
    expect(list.response.status).toBe(200);
    expect(list.body.checkpoints[0]).toMatchObject({
      header:
        'ChatGPT applied reversible changes in Cavalry. Nothing was permanently deleted. Review the checkpoint and undo anything that does not look right.',
      checkpoint_id: created.body.checkpoint_id
    });

    const preview = await requestJson(
      baseUrl,
      '/v1/workbooks/wb_checkpoint/checkpoints/' + created.body.checkpoint_id + '/rollback-preview',
      {
        method: 'POST',
        headers: authHeaders,
        body: '{}'
      }
    );
    expect(preview.response.status).toBe(200);
    expect(preview.body).toMatchObject({ status: 'rolled_back', conflicted_changes: [] });

    const rollback = await requestJson(
      baseUrl,
      '/v1/workbooks/wb_checkpoint/checkpoints/' + created.body.checkpoint_id + '/rollback',
      {
        method: 'POST',
        headers: authHeaders,
        body: '{}'
      }
    );
    expect(rollback.response.status).toBe(403);
    expect(rollback.body.error.code).toBe('scope_denied');
  });
});
