// Tests for Companion API runtime configuration and beta authentication.

import { describe, expect, it } from 'vitest';

import {
  CAVALRY_API_CHECKPOINT_SCOPES,
  CAVALRY_API_SCOPES
} from '@cavalry/companion-api/application/api/cavalry-api-authz.js';
import { createCavalryApiController } from '@cavalry/companion-api/application/api/cavalry-api-controller.js';
import { authenticateCavalryApiRequest } from '@cavalry/companion-api/server/cavalry-api/auth.js';
import {
  createCavalryApiServer,
  resolveCavalryApiHost,
  startCavalryApiServer
} from '@cavalry/companion-api/server/cavalry-api/server.js';
import {
  generateCompanionBetaToken,
  hashCompanionBetaToken,
  verifyCompanionBetaToken
} from '@cavalry/companion-api/server/cavalry-api/beta-token.js';
import {
  assertCompanionRuntimeCanStart,
  getCompanionApiRuntimeConfig,
  validateCompanionPublicBaseUrl
} from '@cavalry/companion-api/server/cavalry-api/runtime.js';

function makeWorkbook() {
  return {
    id: 'wb_beta',
    name: 'Beta Workbook',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    accounts: [
      {
        id: 'office_cash_account',
        name: 'Office Cash Account',
        group: 'asset',
        currency: 'PHP',
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
      }
    ],
    transactions: []
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve('http://127.0.0.1:' + String(address.port));
    });
  });
}

describe('Companion API runtime and beta auth', () => {
  it('keeps AI action mode draft-only by default and requires explicit checkpointed enablement', () => {
    expect(getCompanionApiRuntimeConfig({ enabled: true }).aiActionMode).toBe('draft_only');
    expect(getCompanionApiRuntimeConfig({ enabled: true }).checkpointedApplyEnabled).toBe(false);
    expect(() =>
      assertCompanionRuntimeCanStart(
        getCompanionApiRuntimeConfig({
          enabled: true,
          aiActionMode: 'checkpointed_apply'
        })
      )
    ).toThrow(/CHECKPOINTED_APPLY_ENABLED/);

    const checkpointed = getCompanionApiRuntimeConfig({
      enabled: true,
      aiActionMode: 'checkpointed_apply',
      checkpointedApplyEnabled: true,
      maxCheckpointActions: 7
    });
    expect(checkpointed).toMatchObject({
      aiActionMode: 'checkpointed_apply',
      checkpointedApplyEnabled: true,
      requireCheckpoints: true,
      maxCheckpointActions: 7,
      irreversibleActionsAllowed: false
    });
  });

  it('adds checkpoint execute/read beta scopes only when explicitly enabled and never adds rollback by default', () => {
    const token = generateCompanionBetaToken();
    const hash = hashCompanionBetaToken(token);
    const req = { headers: { authorization: 'Bearer ' + token } };
    const defaultCaller = authenticateCavalryApiRequest(req, {
      betaAuthEnabled: true,
      betaApiKeyHash: hash,
      allowedWorkbookIds: ['wb_beta']
    });
    const checkpointCaller = authenticateCavalryApiRequest(req, {
      betaAuthEnabled: true,
      betaApiKeyHash: hash,
      allowedWorkbookIds: ['wb_beta'],
      checkpointScopesEnabled: true
    });

    expect(defaultCaller.scopes).not.toEqual(expect.arrayContaining(CAVALRY_API_CHECKPOINT_SCOPES));
    expect(checkpointCaller.scopes).toEqual(expect.arrayContaining(CAVALRY_API_CHECKPOINT_SCOPES));
    expect(checkpointCaller.scopes).not.toContain(CAVALRY_API_SCOPES.CHECKPOINT_ROLLBACK);
  });

  it('keeps runtime disabled by explicit default and rejects unsafe beta settings', () => {
    expect(getCompanionApiRuntimeConfig({ enabled: false }).enabled).toBe(false);
    expect(() =>
      assertCompanionRuntimeCanStart(getCompanionApiRuntimeConfig({ enabled: false }))
    ).toThrow(/disabled/i);
    expect(() =>
      resolveCavalryApiHost({ enabled: true, mode: 'local_dev', host: '0.0.0.0' })
    ).toThrow(/public bind/i);
    expect(() =>
      validateCompanionPublicBaseUrl('https://localhost', { allowPrivateBaseUrl: false })
    ).toThrow(/localhost/i);
    expect(() => validateCompanionPublicBaseUrl('https://example.com?token=abc')).toThrow(/query/i);
    expect(() => validateCompanionPublicBaseUrl('https://example.com/#frag')).toThrow(
      /query|fragment/i
    );
    expect(validateCompanionPublicBaseUrl('https://example.com/')).toBe('https://example.com');
    expect(() => validateCompanionPublicBaseUrl('https://example.com/api')).toThrow(/path/i);
    expect(() => validateCompanionPublicBaseUrl('http://example.com')).toThrow(/https/i);
    expect(
      validateCompanionPublicBaseUrl('http://example.com', { allowInsecureTunnel: true })
    ).toBe('http://example.com');
    expect(() =>
      assertCompanionRuntimeCanStart(
        getCompanionApiRuntimeConfig({
          enabled: true,
          mode: 'beta_tunnel',
          publicBaseUrl: 'https://example.com'
        })
      )
    ).toThrow(/BETA_API_KEY/i);
    expect(() => startCavalryApiServer({ enabled: true, mode: 'cloud_stub', quiet: true })).toThrow(
      /cloud_stub/i
    );
  });

  it('verifies generated beta token hashes without leaking apply scope', async () => {
    const token = generateCompanionBetaToken();
    const hash = hashCompanionBetaToken(token);
    expect(verifyCompanionBetaToken(token, { hash })).toBe(true);
    expect(verifyCompanionBetaToken(token + '-bad', { hash })).toBe(false);

    const workbook = makeWorkbook();
    const controller = createCavalryApiController({
      workbooks: [workbook],
      createId: (prefix) => prefix + '_beta',
      runtimeStatus: {
        api_enabled: true,
        api_mode: 'beta_tunnel',
        bind_host: '127.0.0.1',
        public_base_url_configured: true,
        auth_required: true
      }
    });
    const server = createCavalryApiServer({
      controller,
      runtimeConfig: getCompanionApiRuntimeConfig({
        enabled: true,
        mode: 'beta_tunnel',
        publicBaseUrl: 'http://127.0.0.1:1',
        allowInsecureTunnel: true,
        allowPrivateBaseUrl: true
      }),
      authOptions: {
        betaAuthEnabled: true,
        betaApiKeyHash: hash,
        allowedWorkbookIds: ['wb_beta'],
        scopes: [
          CAVALRY_API_SCOPES.READ_CAPABILITIES,
          CAVALRY_API_SCOPES.READ_WORKBOOKS,
          CAVALRY_API_SCOPES.DRAFT_CREATE,
          CAVALRY_API_SCOPES.DRAFT_READ,
          CAVALRY_API_SCOPES.DRAFT_APPLY
        ]
      }
    });
    const baseUrl = await listen(server);
    try {
      const missing = await fetch(baseUrl + '/v1/workbooks');
      expect(missing.status).toBe(401);
      expect(JSON.stringify(await missing.json())).not.toContain(token);

      const wrong = await fetch(baseUrl + '/v1/workbooks', {
        headers: { authorization: 'Bearer wrong-token' }
      });
      expect(wrong.status).toBe(401);

      const ok = await fetch(baseUrl + '/v1/workbooks', {
        headers: { authorization: 'Bearer ' + token }
      });
      expect(ok.status).toBe(200);

      const created = await fetch(baseUrl + '/v1/workbooks/wb_beta/drafts/transaction-batch', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
          'idempotency-key': 'beta-auth-test'
        },
        body: JSON.stringify({
          date_default: '2026-06-27',
          transactions: [
            {
              description: 'Printer paper',
              amount: 150,
              currency: 'PHP',
              direction: 'expense',
              payment_account_hint: 'Office Cash Account',
              category_hint: 'Office Supplies'
            }
          ]
        })
      });
      expect(created.status).toBe(200);
      expect(JSON.stringify(workbook.externalApiAuditEvents)).not.toContain(token);
      expect(workbook.externalApiAuditEvents[0]).toMatchObject({
        caller_type: 'beta_gpt_action',
        auth_method: 'beta_api_key'
      });
      expect(workbook.externalApiAuditEvents[0].scopes).not.toContain(
        CAVALRY_API_SCOPES.DRAFT_APPLY
      );

      const noApply = await fetch(baseUrl + '/v1/workbooks/wb_beta/draft-groups/dg_missing/apply', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token }
      });
      expect(noApply.status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
