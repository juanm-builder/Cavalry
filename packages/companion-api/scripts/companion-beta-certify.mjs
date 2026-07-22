import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  CAVALRY_API_SCOPES,
  CAVALRY_API_STABLE_SCOPES
} from '../src/application/api/cavalry-api-authz.js';
import { exportCompanionApiAuditEvents } from '../src/application/api/companion-api-audit.js';
import { createCavalryApiController } from '../src/application/api/cavalry-api-controller.js';
import { createCavalryApiServer } from '../src/server/cavalry-api/server.js';
import { getCompanionApiRuntimeConfig } from '../src/server/cavalry-api/runtime.js';
import { COMPANION_PACKAGE_ROOT, packagePath, repoPath } from './companion-paths.mjs';

function outDir() {
  return repoPath('test-artifacts/companion-beta-certification');
}

function writeReport(report) {
  const dir = outDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(
    resolve(dir, 'report.md'),
    [
      '# Companion API Beta Certification',
      '',
      '- Generated at: `' + report.generated_at + '`',
      '- Beta status: `' + report.beta_status + '`',
      '- API mode: `' + report.api_mode + '`',
      '- Public base URL configured: `' + String(!!report.public_base_url) + '`',
      '- GPT-style HTTP simulation: `' + String(report.gpt_style_http_simulation) + '`',
      '- Custom GPT Preview tested: `' + String(report.manual_gpt_preview_tested) + '`',
      '- Custom GPT manual test ready: `' + String(report.custom_gpt_manual_test_ready) + '`',
      '- Production cloud ready: `' + String(report.production_cloud_ready) + '`',
      '',
      '## Operations',
      ...(report.operations_checked || []).map(
        (item) =>
          '- ' +
          (item.ok ? 'PASS' : 'FAIL') +
          ' `' +
          item.operationId +
          '` status `' +
          String(item.status) +
          '`'
      ),
      '',
      '## Flows',
      ...(report.flows_checked || []).map(
        (item) => '- ' + (item.ok ? 'PASS' : 'FAIL') + ' ' + item.name
      ),
      '',
      '## Limitations',
      ...(report.limitations || []).map((item) => '- ' + item),
      '',
      '## Next Steps',
      ...(report.next_steps || report.next_manual_steps || []).map((item) => '- ' + item),
      ''
    ].join('\n'),
    'utf8'
  );
}

function skipReport(reason, nextSteps = []) {
  const report = {
    generated_at: new Date().toISOString(),
    beta_status: 'skipped',
    skip_reason: reason,
    api_mode: process.env.CAVALRY_COMPANION_API_MODE || 'not_configured',
    local_base_url: '',
    public_base_url: process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL || '',
    auth_mode: 'beta_api_key',
    scopes: CAVALRY_API_STABLE_SCOPES,
    openapi_path: '',
    operations_checked: [],
    flows_checked: [],
    draft_groups_created: [],
    mutation_before_approval: false,
    review_urls_valid: false,
    audit_events: [],
    direct_mutation_endpoints_exposed: false,
    token_leak_detected: false,
    gpt_style_http_simulation: false,
    manual_gpt_preview_tested: false,
    custom_gpt_manual_test_ready: false,
    production_cloud_ready: false,
    limitations: [reason],
    next_steps: nextSteps
  };
  writeReport(report);
  console.log('Companion beta certification skipped:', reason);
  console.log(resolve(outDir(), 'report.md'));
}

function makeWorkbook() {
  return {
    id: 'wb_beta',
    name: 'Beta Certification Workbook',
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
      },
      {
        id: 'txn_food',
        date: '2026-06-20',
        template: 'expense_paid',
        description: 'Unknown coffee',
        amount: 120,
        originalCurrency: 'PHP',
        categoryId: 'office_supplies',
        primaryAccountId: 'office_cash_account',
        lines: []
      }
    ],
    recurringItems: []
  };
}

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_beta_' + String(counters[prefix]);
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
        headers: { authorization: 'Bearer ' + token }
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

function safeOperation(operation) {
  const body = operation.body || {};
  let bodySummary = null;
  if (body && body.draft_group_id) {
    bodySummary = {
      draft_group_id: body.draft_group_id,
      review_url: body.review_url,
      status: body.status,
      summary: body.summary,
      idempotency_replayed: body.idempotency_replayed === true
    };
  } else if (body && Array.isArray(body.workbooks)) {
    bodySummary = { workbook_count: body.workbooks.length };
  } else if (body && Array.isArray(body.accounts)) {
    bodySummary = { account_count: body.accounts.length };
  } else if (body && Array.isArray(body.categories)) {
    bodySummary = { category_count: body.categories.length };
  } else if (body && Array.isArray(body.transactions)) {
    bodySummary = { transaction_count: body.transactions.length, coverage: body.coverage || null };
  } else if (body && body.error) {
    bodySummary = {
      error: {
        code: body.error.code,
        message: body.error.message,
        request_id: body.error.request_id
      }
    };
  } else if (body && body.capabilities) {
    bodySummary = {
      review_required_for_all_external_writes: body.review_required_for_all_external_writes,
      draft_only: body.draft_only,
      production_cloud_ready: body.production_cloud_ready
    };
  }
  return {
    operationId: operation.operationId,
    path: operation.path,
    status: operation.status,
    ok: operation.ok,
    body: bodySummary
  };
}

function snapshotRecentBody(body) {
  return JSON.stringify(body && Array.isArray(body.transactions) ? body.transactions : []);
}

function reportFailure(message, details = {}) {
  const report = Object.assign(
    {
      generated_at: new Date().toISOString(),
      beta_status: 'failed',
      api_mode: process.env.CAVALRY_COMPANION_API_MODE || 'not_configured',
      local_base_url: '',
      public_base_url: process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL || '',
      auth_mode: 'beta_api_key',
      scopes: CAVALRY_API_STABLE_SCOPES,
      openapi_path: '',
      operations_checked: [],
      flows_checked: [],
      draft_groups_created: [],
      mutation_before_approval: false,
      review_urls_valid: false,
      direct_mutation_endpoints_exposed: false,
      token_leak_detected: false,
      gpt_style_http_simulation: false,
      manual_gpt_preview_tested: false,
      custom_gpt_manual_test_ready: false,
      production_cloud_ready: false,
      limitations: [message],
      next_steps: [
        'Run npm run beta:doctor --workspace @cavalry/companion-api and fix failed checks.'
      ]
    },
    details
  );
  writeReport(report);
  console.error('Companion beta certification failed:', message);
  console.error(resolve(outDir(), 'report.md'));
  process.exit(1);
}

const enabled = process.env.CAVALRY_COMPANION_API_ENABLED === '1';
const mode = process.env.CAVALRY_COMPANION_API_MODE || '';
const publicUrl = process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL || '';
const token = process.env.CAVALRY_COMPANION_BETA_API_KEY || '';
const tokenHash = process.env.CAVALRY_COMPANION_BETA_API_KEY_HASH || '';
const useLocalMock = process.env.CAVALRY_COMPANION_BETA_CERTIFY_USE_LOCAL_SERVER === '1';

const doctorResult = spawnSync(
  process.execPath,
  [packagePath('scripts/companion-beta-doctor.mjs')],
  {
    cwd: COMPANION_PACKAGE_ROOT,
    encoding: 'utf8',
    env: Object.assign(
      {},
      process.env,
      useLocalMock
        ? {
            NODE_ENV: 'test',
            CAVALRY_COMPANION_ALLOW_INSECURE_TUNNEL: '1'
          }
        : {},
      {
        CAVALRY_COMPANION_DOCTOR_OUT_DIR: 'test-artifacts/companion-beta-certification/doctor'
      }
    )
  }
);
if (doctorResult.status !== 0) {
  reportFailure(
    String(doctorResult.stderr || doctorResult.stdout || '').trim() ||
      'Companion beta doctor reported failed checks.'
  );
}

if (!enabled || mode !== 'beta_tunnel') {
  skipReport('Set CAVALRY_COMPANION_API_ENABLED=1 and CAVALRY_COMPANION_API_MODE=beta_tunnel.', [
    'export CAVALRY_COMPANION_API_ENABLED=1',
    'export CAVALRY_COMPANION_API_MODE=beta_tunnel'
  ]);
  process.exit(0);
}
if (!publicUrl && !useLocalMock) {
  skipReport('Set CAVALRY_COMPANION_PUBLIC_BASE_URL to your HTTPS tunnel/public URL.', [
    'export CAVALRY_COMPANION_PUBLIC_BASE_URL=https://your-tunnel.example.com',
    'npm run beta:openapi --workspace @cavalry/companion-api'
  ]);
  process.exit(0);
}
if (!token && !tokenHash) {
  skipReport(
    'Set CAVALRY_COMPANION_BETA_API_KEY or CAVALRY_COMPANION_BETA_API_KEY_HASH. A raw key is needed to run HTTP certification.',
    [
      'npm run token --workspace @cavalry/companion-api',
      'export CAVALRY_COMPANION_BETA_API_KEY=<generated-token>'
    ]
  );
  process.exit(0);
}
if (!token) {
  skipReport(
    'Only CAVALRY_COMPANION_BETA_API_KEY_HASH is configured. The runner needs the raw beta key to call the API; it will not write the key to reports.',
    ['Temporarily export CAVALRY_COMPANION_BETA_API_KEY for certification, then unset it.']
  );
  process.exit(0);
}

let server = null;
let localBaseUrl = '';
let baseUrl = publicUrl;
let workbook = null;
const operations = [];
const flows = [];
let mutationBeforeApproval = false;
try {
  if (useLocalMock) {
    workbook = makeWorkbook();
    const runtimeConfig = getCompanionApiRuntimeConfig({
      enabled: true,
      mode: 'beta_tunnel',
      publicBaseUrl: 'http://127.0.0.1:1',
      allowInsecureTunnel: true,
      allowPrivateBaseUrl: true
    });
    server = createCavalryApiServer({
      runtimeConfig,
      controller: createCavalryApiController({
        workbooks: [workbook],
        createId: makeCreateId(),
        runtimeStatus: {
          api_enabled: true,
          api_mode: 'beta_tunnel',
          bind_host: '127.0.0.1',
          public_base_url_configured: true,
          auth_required: true
        }
      }),
      authOptions: {
        betaAuthEnabled: true,
        betaApiKey: token,
        allowedWorkbookIds: ['wb_beta']
      }
    });
    localBaseUrl = await listen(server);
    baseUrl = localBaseUrl;
    process.env.CAVALRY_COMPANION_PUBLIC_BASE_URL = baseUrl;
    process.env.CAVALRY_COMPANION_ALLOW_INSECURE_TUNNEL = '1';
  }

  const openapiResult = spawnSync(
    process.execPath,
    [packagePath('scripts/companion-openapi-beta.mjs')],
    {
      cwd: COMPANION_PACKAGE_ROOT,
      encoding: 'utf8',
      env: Object.assign({}, process.env, useLocalMock ? { NODE_ENV: 'test' } : {})
    }
  );
  const openapiPath = repoPath(
    'test-artifacts/companion-beta/openapi/cavalry-gpt-actions.beta.openapi.yaml'
  );

  const missingAuth = await requestJson(baseUrl, '', 'publicApiRequiresAuth', '/v1/capabilities');
  missingAuth.ok = missingAuth.status === 401 || missingAuth.status === 403;
  operations.push(missingAuth);
  const wrongAuth = await requestJson(
    baseUrl,
    token + '-wrong',
    'wrongTokenRejected',
    '/v1/capabilities'
  );
  wrongAuth.ok = wrongAuth.status === 401 || wrongAuth.status === 403;
  operations.push(wrongAuth);
  operations.push(await requestJson(baseUrl, token, 'getCavalryCapabilities', '/v1/capabilities'));
  const workbooks = await requestJson(baseUrl, token, 'listCavalryWorkbooks', '/v1/workbooks');
  operations.push(workbooks);
  const workbookId =
    workbooks.body && Array.isArray(workbooks.body.workbooks) && workbooks.body.workbooks[0]
      ? workbooks.body.workbooks[0].workbook_id
      : 'wb_beta';
  operations.push(
    await requestJson(
      baseUrl,
      token,
      'getCavalryWorkbookSummary',
      '/v1/workbooks/' + workbookId + '/summary'
    )
  );
  operations.push(
    await requestJson(
      baseUrl,
      token,
      'listCavalryAccounts',
      '/v1/workbooks/' + workbookId + '/accounts'
    )
  );
  operations.push(
    await requestJson(
      baseUrl,
      token,
      'listCavalryCategories',
      '/v1/workbooks/' + workbookId + '/categories'
    )
  );
  const beforeRecent = await requestJson(
    baseUrl,
    token,
    'listCavalryRecentTransactionsBeforeDrafts',
    '/v1/workbooks/' + workbookId + '/transactions/recent?limit=100'
  );
  operations.push(beforeRecent);
  const created = await requestJson(
    baseUrl,
    token,
    'createCavalryTransactionDraftBatch',
    '/v1/workbooks/' + workbookId + '/drafts/transaction-batch',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'idempotency-key': 'beta-cert-1'
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
    }
  );
  operations.push(created);
  const recurring = await requestJson(
    baseUrl,
    token,
    'createCavalryRecurringItemDrafts',
    '/v1/workbooks/' + workbookId + '/drafts/recurring-items',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'idempotency-key': 'beta-cert-recurring-1'
      },
      body: JSON.stringify({
        items: [
          {
            name: 'ChatGPT Pro',
            amount: 6490,
            currency: 'PHP',
            cadence: 'monthly',
            category_hint: 'Subscriptions',
            confidence: 'high'
          },
          {
            name: 'Prepaid Subscription',
            amount: 500,
            currency: 'PHP',
            cadence: 'unknown',
            category_hint: 'Subscriptions',
            confidence: 'low'
          }
        ]
      })
    }
  );
  operations.push(recurring);
  const category = await requestJson(
    baseUrl,
    token,
    'createCavalryCategoryChangeDrafts',
    '/v1/workbooks/' + workbookId + '/drafts/category-changes',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'idempotency-key': 'beta-cert-category-1'
      },
      body: JSON.stringify({
        changes: [
          {
            transaction_match: { description: 'Unknown coffee', amount: 120 },
            suggested_category_hint: 'Office Supplies',
            reason: 'Beta certification category cleanup.'
          }
        ]
      })
    }
  );
  operations.push(category);
  const replay = await requestJson(
    baseUrl,
    token,
    'createCavalryTransactionDraftBatchReplay',
    '/v1/workbooks/' + workbookId + '/drafts/transaction-batch',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'idempotency-key': 'beta-cert-1'
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
    }
  );
  operations.push(replay);
  const unsupported = await requestJson(
    baseUrl,
    token,
    'rejectUnsupportedDirectMutationAction',
    '/v1/workbooks/' + workbookId + '/draft-groups/from-action-plan',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'idempotency-key': 'beta-cert-unsupported-1'
      },
      body: JSON.stringify({
        action_plan: {
          cavalry_action_plan_version: '1.0',
          source: 'chatgpt',
          actions: [{ type: 'delete_transaction', transaction_id: 'txn_existing' }]
        }
      })
    }
  );
  unsupported.ok =
    unsupported.status === 422 &&
    unsupported.body &&
    unsupported.body.error &&
    unsupported.body.error.code === 'unsupported_action_type';
  operations.push(unsupported);
  const noApply = await requestJson(
    baseUrl,
    token,
    'noGptApplyEndpoint',
    '/v1/workbooks/' + workbookId + '/draft-groups/dg_missing/apply',
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: '{}'
    }
  );
  noApply.ok = noApply.status === 404;
  operations.push(noApply);
  const afterRecent = await requestJson(
    baseUrl,
    token,
    'listCavalryRecentTransactionsAfterDrafts',
    '/v1/workbooks/' + workbookId + '/transactions/recent?limit=100'
  );
  operations.push(afterRecent);
  mutationBeforeApproval = workbook
    ? workbook.transactions.length !== 2 || (workbook.recurringItems || []).length !== 0
    : snapshotRecentBody(beforeRecent.body) !== snapshotRecentBody(afterRecent.body);

  flows.push({ name: 'beta OpenAPI generated and validated', ok: openapiResult.status === 0 });
  flows.push({
    name: 'review URL returned',
    ok: !!(created.body && /^cavalry:\/\/draft-groups\//.test(created.body.review_url || ''))
  });
  flows.push({
    name: 'recurring draft group created',
    ok: !!(recurring.body && /^cavalry:\/\/draft-groups\//.test(recurring.body.review_url || ''))
  });
  flows.push({
    name: 'category-change draft group created',
    ok: !!(category.body && /^cavalry:\/\/draft-groups\//.test(category.body.review_url || ''))
  });
  flows.push({
    name: 'duplicate warning returned for existing transaction',
    ok: !!(created.body && JSON.stringify(created.body).includes('possible_duplicate'))
  });
  flows.push({
    name: 'idempotency replay returned same draft group',
    ok: !!(
      created.body &&
      replay.body &&
      created.body.draft_group_id === replay.body.draft_group_id
    )
  });
  flows.push({ name: 'unsupported destructive action rejected', ok: unsupported.ok });
  flows.push({ name: 'no mutation before approval', ok: !mutationBeforeApproval });

  const safeOperations = operations.map(safeOperation);
  const draftGroupsCreated = [created, recurring, category]
    .map((operation) => operation.body && operation.body.draft_group_id)
    .filter(Boolean);
  const tokenLeakDetected =
    JSON.stringify(safeOperations).includes(token) || JSON.stringify(flows).includes(token);
  const passed =
    safeOperations.every((operation) => operation.ok) &&
    flows.every((flow) => flow.ok) &&
    !tokenLeakDetected;

  const report = {
    generated_at: new Date().toISOString(),
    beta_status: passed ? 'passed' : 'failed',
    api_mode: 'beta_tunnel',
    local_base_url: localBaseUrl,
    public_base_url: baseUrl,
    auth_mode: 'beta_api_key',
    scopes: CAVALRY_API_STABLE_SCOPES,
    openapi_path: openapiPath,
    operations_checked: safeOperations,
    flows_checked: flows,
    draft_groups_created: draftGroupsCreated,
    mutation_before_approval: mutationBeforeApproval,
    review_urls_valid: flows.find((flow) => flow.name === 'review URL returned')?.ok === true,
    audit_events: workbook
      ? exportCompanionApiAuditEvents(workbook).map((event) => ({
          request_id: event.request_id,
          operation_id: event.operation_id,
          caller_type: event.caller_type,
          draft_group_id: event.draft_group_id,
          outcome: event.outcome,
          idempotency_result: event.idempotency_result,
          duplicate_warning_count: event.duplicate_warning_count,
          validation_issue_count: event.validation_issue_count
        }))
      : [],
    direct_mutation_endpoints_exposed: false,
    token_leak_detected: tokenLeakDetected,
    gpt_style_http_simulation: true,
    manual_gpt_preview_tested: false,
    custom_gpt_manual_setup_ready: passed,
    custom_gpt_manual_test_ready: passed,
    production_cloud_ready: false,
    limitations: useLocalMock
      ? [
          'Used local mock public URL for automated certification; no real public tunnel was exercised.',
          'Custom GPT Preview tested: no. GPT-style HTTP simulation: yes.'
        ]
      : [
          'Real Custom GPT preview was not executed by this script. GPT-style HTTP simulation: yes.'
        ],
    next_steps: [
      'Import the generated beta OpenAPI YAML into a Custom GPT Action.',
      'Configure Bearer/API key auth with the beta token.',
      'Run the GPT Preview prompts from docs/integrations/companion-api-custom-gpt-beta-test.md.',
      'Fill out docs/operations/companion-api-dogfood-results-template.md after a real GPT Preview run.'
    ]
  };
  writeReport(report);
  console.log('Companion beta certification report:', resolve(outDir(), 'report.md'));
  if (report.beta_status !== 'passed') {
    process.exit(1);
  }
} finally {
  if (server) {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}
