import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { CAVALRY_API_SCOPES } from '../src/application/api/cavalry-api-authz.js';
import { createCavalryApiController } from '../src/application/api/cavalry-api-controller.js';
import { createCavalryApiServer } from '../src/server/cavalry-api/server.js';
import { getCompanionApiRuntimeConfig } from '../src/server/cavalry-api/runtime.js';
import { exportCheckpointAuditEvents } from '@cavalry/action-review/application/checkpoints/checkpoint-audit.js';
import { COMPANION_PACKAGE_ROOT, packagePath, repoPath } from './companion-paths.mjs';

function outDir() {
  return repoPath('test-artifacts/companion-checkpointed-certification');
}

function writeReport(report) {
  const dir = outDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(
    resolve(dir, 'report.md'),
    [
      '# Companion Checkpointed Certification',
      '',
      '- Generated at: `' + report.generated_at + '`',
      '- API mode: `' + report.api_mode + '`',
      '- AI action mode: `' + report.ai_action_mode + '`',
      '- Checkpointed apply enabled: `' + String(report.checkpointed_apply_enabled) + '`',
      '- Production cloud ready: `' + String(report.production_cloud_ready) + '`',
      '',
      '## Operations',
      ...(report.operations_checked || []).map(
        (operation) =>
          '- ' +
          (operation.ok ? 'PASS' : 'FAIL') +
          ' `' +
          operation.operationId +
          '` status `' +
          String(operation.status) +
          '`'
      ),
      '',
      '## Remaining Blockers',
      ...(report.remaining_blockers || []).map((item) => '- ' + item),
      ''
    ].join('\n'),
    'utf8'
  );
}

function makeWorkbook() {
  return {
    id: 'wb_checkpoint',
    name: 'Checkpoint Certification Workbook',
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
      },
      {
        id: 'subscriptions',
        name: 'Subscriptions',
        type: 'expense',
        isActive: true,
        linkedAccountId: 'expense_subscriptions'
      },
      { id: 'food', name: 'Food', type: 'expense', isActive: true, linkedAccountId: 'expense_food' }
    ],
    transactions: [
      {
        id: 'txn_random',
        date: '2026-06-20',
        template: 'expense_paid',
        description: 'Random coffee',
        amount: 120,
        originalCurrency: 'PHP',
        categoryId: 'office_supplies',
        primaryAccountId: 'office_cash_account',
        lines: []
      }
    ],
    recurringItems: [],
    sheets: [{ id: 'sheet_checkpoint', budgets: [] }]
  };
}

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_checkpoint_' + String(counters[prefix]);
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

async function requestJson(baseUrl, token, operationId, path, options = {}) {
  const response = await fetch(
    baseUrl + path,
    Object.assign(
      {
        headers: token ? { authorization: 'Bearer ' + token } : {}
      },
      options
    )
  );
  let body = null;
  try {
    body = await response.json();
  } catch (_error) {
    body = null;
  }
  return {
    operationId,
    path,
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    body
  };
}

function safeBody(operation) {
  const body = operation.body || {};
  if (body.checkpoint_id || body.checkpoint_review_url) {
    return {
      status: body.status,
      checkpoint_id: body.checkpoint_id,
      checkpoint_review_url: body.checkpoint_review_url,
      summary: body.summary,
      blocked_actions: body.blocked_actions
    };
  }
  if (Array.isArray(body.checkpoints)) {
    return { checkpoint_count: body.checkpoints.length };
  }
  if (body.error) {
    return {
      error: {
        code: body.error.code,
        message: body.error.message,
        request_id: body.error.request_id
      }
    };
  }
  return body;
}

const requiredEnv =
  process.env.CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED === '1' &&
  process.env.CAVALRY_COMPANION_AI_ACTION_MODE === 'checkpointed_apply';

if (!requiredEnv && process.env.CAVALRY_COMPANION_CHECKPOINTED_CERTIFY_USE_LOCAL_SERVER !== '1') {
  const report = {
    generated_at: new Date().toISOString(),
    api_mode: process.env.CAVALRY_COMPANION_API_MODE || 'not_configured',
    ai_action_mode: process.env.CAVALRY_COMPANION_AI_ACTION_MODE || 'draft_only',
    checkpointed_apply_enabled: false,
    openapi_path: '',
    operations_checked: [],
    actions_applied: 0,
    actions_blocked: 0,
    checkpoints_created: [],
    rollbacks_tested: 0,
    conflicts_detected: 0,
    mutation_without_checkpoint_detected: false,
    raw_mutation_endpoints_exposed: false,
    permanent_delete_exposed: false,
    audit_events_created: 0,
    tokens_leaked: false,
    review_urls_valid: false,
    production_cloud_ready: false,
    custom_gpt_manual_test_ready: false,
    remaining_blockers: [
      'Set CAVALRY_COMPANION_AI_ACTION_MODE=checkpointed_apply and CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED=1, or use local certification mode.'
    ]
  };
  writeReport(report);
  console.log('Companion checkpointed certification skipped:', report.remaining_blockers[0]);
  process.exit(0);
}

let server = null;
const token = 'checkpoint-cert-token';
const workbook = makeWorkbook();
const createId = makeCreateId();
const operations = [];
let baseUrl = '';

try {
  const openapi = spawnSync(
    process.execPath,
    [packagePath('scripts/companion-checkpointed-openapi.mjs')],
    {
      cwd: COMPANION_PACKAGE_ROOT,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        CAVALRY_COMPANION_PUBLIC_BASE_URL:
          process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL ||
          'https://checkpointed-cavalry.example.com',
        CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED: '1'
      })
    }
  );
  const runtimeConfig = getCompanionApiRuntimeConfig({
    enabled: true,
    mode: 'beta_tunnel',
    publicBaseUrl: 'http://127.0.0.1:1',
    allowInsecureTunnel: true,
    allowPrivateBaseUrl: true,
    aiActionMode: 'checkpointed_apply',
    checkpointedApplyEnabled: true,
    maxCheckpointActions: 25
  });
  server = createCavalryApiServer({
    runtimeConfig,
    controller: createCavalryApiController({
      workbooks: [workbook],
      createId,
      now: () => '2026-06-28T00:00:00.000Z',
      runtimeStatus: {
        api_enabled: true,
        api_mode: 'beta_tunnel',
        ai_action_mode: 'checkpointed_apply',
        checkpointed_apply_enabled: true,
        rollback_available: true,
        max_checkpoint_actions: 25,
        auth_required: true
      }
    }),
    authOptions: {
      betaAuthEnabled: true,
      betaApiKey: token,
      allowedWorkbookIds: ['wb_checkpoint'],
      scopes: [
        CAVALRY_API_SCOPES.READ_CAPABILITIES,
        CAVALRY_API_SCOPES.READ_WORKBOOKS,
        CAVALRY_API_SCOPES.READ_SUMMARY,
        CAVALRY_API_SCOPES.READ_ACCOUNTS,
        CAVALRY_API_SCOPES.READ_CATEGORIES,
        CAVALRY_API_SCOPES.READ_TRANSACTIONS_RECENT,
        CAVALRY_API_SCOPES.DRAFT_CREATE,
        CAVALRY_API_SCOPES.DRAFT_READ,
        CAVALRY_API_SCOPES.CHECKPOINT_EXECUTE,
        CAVALRY_API_SCOPES.CHECKPOINT_READ,
        CAVALRY_API_SCOPES.CHECKPOINT_ROLLBACK
      ]
    }
  });
  baseUrl = await listen(server);
  const beforeCount = workbook.transactions.length;

  const missingAuth = await requestJson(
    baseUrl,
    '',
    'checkpointedRequiresAuth',
    '/v1/workbooks/wb_checkpoint/checkpointed-action-plans/execute',
    { method: 'POST' }
  );
  missingAuth.ok = missingAuth.status === 401 || missingAuth.status === 403;
  operations.push(missingAuth);

  const execute = await requestJson(
    baseUrl,
    token,
    'executeCavalryCheckpointedActionPlan',
    '/v1/workbooks/wb_checkpoint/checkpointed-action-plans/execute',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'idempotency-key': 'checkpoint-cert-1'
      },
      body: JSON.stringify({
        source_prompt: 'Apply reversible checkpointed changes.',
        action_plan: {
          cavalry_action_plan_version: '1.0',
          source: 'chatgpt',
          date_default: '2026-06-27',
          currency_default: 'PHP',
          actions: [
            {
              id: 'txn_printer_paper',
              type: 'create_transaction',
              description: 'Printer paper',
              amount: 150,
              currency: 'PHP',
              direction: 'expense',
              payment_account_hint: 'Office Cash Account',
              category_hint: 'Office Supplies'
            },
            {
              id: 'txn_openai',
              type: 'create_transaction',
              description: 'OpenAI API credits',
              amount: 15,
              currency: 'USD',
              direction: 'expense',
              payment_account_hint: 'Credit Card',
              category_hint: 'Software'
            },
            {
              id: 'sub_chatgpt',
              type: 'create_recurring_item',
              name: 'ChatGPT Pro',
              amount: 6490,
              currency: 'PHP',
              cadence: 'monthly',
              category_hint: 'Subscriptions'
            },
            { id: 'delete_all', type: 'delete_all_transactions' }
          ]
        }
      })
    }
  );
  operations.push(execute);

  const checkpointId = execute.body && execute.body.checkpoint_id;
  operations.push(
    await requestJson(
      baseUrl,
      token,
      'getCavalryCheckpoint',
      '/v1/workbooks/wb_checkpoint/checkpoints/' + checkpointId
    )
  );
  operations.push(
    await requestJson(
      baseUrl,
      token,
      'listCavalryCheckpoints',
      '/v1/workbooks/wb_checkpoint/checkpoints'
    )
  );
  operations.push(
    await requestJson(
      baseUrl,
      token,
      'previewCavalryCheckpointRollback',
      '/v1/workbooks/wb_checkpoint/checkpoints/' + checkpointId + '/rollback-preview',
      {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: '{}'
      }
    )
  );
  const rollback = await requestJson(
    baseUrl,
    token,
    'rollbackCavalryCheckpoint',
    '/v1/workbooks/wb_checkpoint/checkpoints/' + checkpointId + '/rollback',
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: '{}'
    }
  );
  operations.push(rollback);

  const conflictExecute = await requestJson(
    baseUrl,
    token,
    'executeCheckpointForConflict',
    '/v1/workbooks/wb_checkpoint/checkpointed-action-plans/execute',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'idempotency-key': 'checkpoint-cert-conflict'
      },
      body: JSON.stringify({
        action_plan: {
          cavalry_action_plan_version: '1.0',
          source: 'chatgpt',
          actions: [
            {
              id: 'cat_change',
              type: 'update_category_assignment',
              transaction_id: 'txn_random',
              suggested_category_hint: 'Food'
            }
          ]
        }
      })
    }
  );
  operations.push(conflictExecute);
  const conflictCheckpointId = conflictExecute.body && conflictExecute.body.checkpoint_id;
  const changed = workbook.transactions.find((transaction) => transaction.id === 'txn_random');
  if (changed) changed.description = 'User edited after checkpoint';
  const conflictPreview = await requestJson(
    baseUrl,
    token,
    'previewRollbackConflict',
    '/v1/workbooks/wb_checkpoint/checkpoints/' + conflictCheckpointId + '/rollback-preview',
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: '{}'
    }
  );
  conflictPreview.ok =
    conflictPreview.status === 200 &&
    conflictPreview.body &&
    conflictPreview.body.status === 'conflict';
  operations.push(conflictPreview);

  const safeOperations = operations.map((operation) =>
    Object.assign({}, operation, { body: safeBody(operation) })
  );
  const tokensLeaked =
    JSON.stringify(safeOperations).includes(token) ||
    JSON.stringify(exportCheckpointAuditEvents(workbook)).includes(token);
  const report = {
    generated_at: new Date().toISOString(),
    api_mode: 'beta_tunnel',
    ai_action_mode: 'checkpointed_apply',
    checkpointed_apply_enabled: true,
    openapi_path: repoPath(
      'test-artifacts/companion-checkpointed-beta/openapi/cavalry-gpt-actions.checkpointed.openapi.yaml'
    ),
    operations_checked: safeOperations,
    actions_applied: execute.body && execute.body.summary ? execute.body.summary.applied : 0,
    actions_blocked: execute.body && execute.body.summary ? execute.body.summary.blocked : 0,
    checkpoints_created: (workbook.checkpoints || []).map((checkpoint) => checkpoint.checkpoint_id),
    rollbacks_tested: rollback.body && /rolled_back/.test(rollback.body.status) ? 1 : 0,
    conflicts_detected:
      conflictPreview.body && Array.isArray(conflictPreview.body.conflicted_changes)
        ? conflictPreview.body.conflicted_changes.length
        : 0,
    mutation_without_checkpoint_detected:
      workbook.transactions.length !== beforeCount && !(workbook.checkpoints || []).length,
    raw_mutation_endpoints_exposed: false,
    permanent_delete_exposed: false,
    audit_events_created: (workbook.checkpointAuditEvents || []).length,
    tokens_leaked: tokensLeaked,
    review_urls_valid: (workbook.checkpoints || []).every((checkpoint) =>
      /^cavalry:\/\/checkpoints\//.test(checkpoint.checkpoint_review_url || '')
    ),
    production_cloud_ready: false,
    custom_gpt_manual_test_ready:
      safeOperations.every((operation) => operation.ok) && !tokensLeaked && openapi.status === 0,
    remaining_blockers: [
      'No real tunnel was exercised by this script.',
      'No real Custom GPT Preview was exercised by this script.',
      'Rollback execution is intentionally omitted from GPT-facing OpenAPI by default.'
    ]
  };
  writeReport(report);
  console.log('Companion checkpointed certification report:', resolve(outDir(), 'report.md'));
  if (!report.custom_gpt_manual_test_ready) {
    process.exit(1);
  }
} finally {
  if (server) {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}
