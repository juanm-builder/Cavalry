import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CAVALRY_API_SCOPES } from '../src/application/api/cavalry-api-authz.js';
import { createCavalryApiController } from '../src/application/api/cavalry-api-controller.js';
import { createCavalryApiServer } from '../src/server/cavalry-api/server.js';
import { COMPANION_PACKAGE_ROOT, repoPath, resolvePackageInput } from './companion-paths.mjs';

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_cert_' + String(counters[prefix]);
  };
}

function makeWorkbook() {
  return {
    id: 'wb_cert',
    name: 'Certification Workbook',
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
      { id: 'food', name: 'Food', type: 'expense', isActive: true, linkedAccountId: 'expense_food' }
    ],
    transactions: [
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
    sheets: [{ id: 'sheet_cert', budgets: [] }]
  };
}

function runNodeScript(scriptPath) {
  const result = spawnSync(process.execPath, [resolvePackageInput(scriptPath)], {
    cwd: COMPANION_PACKAGE_ROOT,
    encoding: 'utf8'
  });
  return {
    command: 'node ' + scriptPath,
    status: result.status,
    ok: result.status === 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim()
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

async function requestJson(baseUrl, operationId, path, options = {}) {
  const response = await fetch(
    baseUrl + path,
    Object.assign(
      {
        headers: {
          authorization: 'Bearer cert-token'
        }
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

function markdownReport(report) {
  const lines = [
    '# Cavalry Companion GPT Action Certification',
    '',
    '- Generated at: `' + report.generated_at + '`',
    '- Local/dev GPT Action ready: `' + String(report.local_dev_ready) + '`',
    '- Production cloud hosting ready: `' + String(report.production_cloud_ready) + '`',
    '- Production note: ' + report.production_note,
    '',
    '## Static Checks',
    ''
  ];
  report.static_checks.forEach((check) => {
    lines.push('- ' + (check.ok ? 'PASS' : 'FAIL') + ' `' + check.command + '`');
  });
  lines.push('', '## Exercised Operations', '');
  report.operations.forEach((operation) => {
    lines.push(
      '- ' +
        (operation.ok ? 'PASS' : 'FAIL') +
        ' `' +
        operation.operationId +
        '` status `' +
        String(operation.status) +
        '`'
    );
  });
  lines.push('', '## Safety Assertions', '');
  report.safety_assertions.forEach((assertion) => {
    lines.push('- ' + (assertion.ok ? 'PASS' : 'FAIL') + ' ' + assertion.name);
  });
  lines.push('');
  return lines.join('\n');
}

const staticChecks = [
  runNodeScript('scripts/validate-openapi.mjs'),
  runNodeScript('scripts/openapi-action-sanity.mjs')
];

const workbook = makeWorkbook();
const createId = makeCreateId();
const beforeCoreCounts = {
  transactions: workbook.transactions.length,
  recurringItems: workbook.recurringItems.length
};
const controller = createCavalryApiController({
  workbooks: [workbook],
  createId,
  now: () => '2026-06-27T10:00:00.000Z'
});
const server = createCavalryApiServer({
  controller,
  authOptions: {
    devAuthEnabled: true,
    devToken: 'cert-token',
    allowedWorkbookIds: ['wb_cert'],
    scopes: [
      CAVALRY_API_SCOPES.READ_CAPABILITIES,
      CAVALRY_API_SCOPES.READ_WORKBOOKS,
      CAVALRY_API_SCOPES.READ_SUMMARY,
      CAVALRY_API_SCOPES.READ_ACCOUNTS,
      CAVALRY_API_SCOPES.READ_CATEGORIES,
      CAVALRY_API_SCOPES.READ_TRANSACTIONS_RECENT,
      CAVALRY_API_SCOPES.DRAFT_CREATE,
      CAVALRY_API_SCOPES.DRAFT_READ
    ]
  }
});

const operations = [];
let baseUrl = '';
try {
  baseUrl = await listen(server);
  operations.push(await requestJson(baseUrl, 'getCavalryCapabilities', '/v1/capabilities'));
  operations.push(await requestJson(baseUrl, 'listCavalryWorkbooks', '/v1/workbooks'));
  operations.push(
    await requestJson(
      baseUrl,
      'getCavalryWorkbookSummary',
      '/v1/workbooks/wb_cert/summary?start_date=2026-06-01&end_date=2026-06-30'
    )
  );
  operations.push(
    await requestJson(baseUrl, 'listCavalryAccounts', '/v1/workbooks/wb_cert/accounts')
  );
  operations.push(
    await requestJson(baseUrl, 'listCavalryCategories', '/v1/workbooks/wb_cert/categories')
  );
  operations.push(
    await requestJson(
      baseUrl,
      'listCavalryRecentTransactions',
      '/v1/workbooks/wb_cert/transactions/recent?limit=10'
    )
  );

  const actionPlan = await requestJson(
    baseUrl,
    'createCavalryDraftGroupFromActionPlan',
    '/v1/workbooks/wb_cert/draft-groups/from-action-plan',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer cert-token',
        'content-type': 'application/json',
        'idempotency-key': 'cert-action-plan-1'
      },
      body: JSON.stringify({
        action_plan: {
          cavalry_action_plan_version: '1.0',
          source: 'chatgpt',
          date_default: '2026-06-27',
          currency_default: 'PHP',
          actions: [
            {
              type: 'create_transaction',
              description: 'OpenAI API credits',
              amount: 15,
              currency: 'USD',
              direction: 'expense',
              payment_account_hint: 'Credit Card',
              category_hint: 'Software'
            }
          ]
        }
      })
    }
  );
  operations.push(actionPlan);
  if (actionPlan.body && actionPlan.body.draft_group_id) {
    operations.push(
      await requestJson(
        baseUrl,
        'getCavalryDraftGroup',
        '/v1/workbooks/wb_cert/draft-groups/' + actionPlan.body.draft_group_id
      )
    );
  }

  operations.push(
    await requestJson(
      baseUrl,
      'createCavalryTransactionDraftBatch',
      '/v1/workbooks/wb_cert/drafts/transaction-batch',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer cert-token',
          'content-type': 'application/json',
          'idempotency-key': 'cert-transaction-1'
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
    )
  );
  operations.push(
    await requestJson(
      baseUrl,
      'createCavalryTransactionDraftBatchReplay',
      '/v1/workbooks/wb_cert/drafts/transaction-batch',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer cert-token',
          'content-type': 'application/json',
          'idempotency-key': 'cert-transaction-1'
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
    )
  );
  const conflict = await requestJson(
    baseUrl,
    'createCavalryTransactionDraftBatchConflict',
    '/v1/workbooks/wb_cert/drafts/transaction-batch',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer cert-token',
        'content-type': 'application/json',
        'idempotency-key': 'cert-transaction-1'
      },
      body: JSON.stringify({
        date_default: '2026-06-27',
        transactions: [
          {
            description: 'Printer paper',
            amount: 151,
            currency: 'PHP',
            direction: 'expense',
            payment_account_hint: 'Office Cash Account',
            category_hint: 'Office Supplies'
          }
        ]
      })
    }
  );
  conflict.ok =
    conflict.status === 409 &&
    conflict.body &&
    conflict.body.error &&
    conflict.body.error.code === 'idempotency_conflict';
  operations.push(conflict);

  const unsupported = await requestJson(
    baseUrl,
    'rejectUnsupportedDirectMutationAction',
    '/v1/workbooks/wb_cert/draft-groups/from-action-plan',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer cert-token',
        'content-type': 'application/json',
        'idempotency-key': 'cert-unsupported-1'
      },
      body: JSON.stringify({
        action_plan: {
          cavalry_action_plan_version: '1.0',
          source: 'chatgpt',
          actions: [{ type: 'delete_transaction', transaction_id: 'txn_food' }]
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

  operations.push(
    await requestJson(
      baseUrl,
      'createCavalryRecurringItemDrafts',
      '/v1/workbooks/wb_cert/drafts/recurring-items',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer cert-token',
          'content-type': 'application/json',
          'idempotency-key': 'cert-recurring-1'
        },
        body: JSON.stringify({
          items: [
            {
              name: 'ChatGPT Pro',
              amount: 6490,
              currency: 'PHP',
              cadence: 'monthly',
              category_hint: 'Subscriptions'
            }
          ]
        })
      }
    )
  );
  operations.push(
    await requestJson(
      baseUrl,
      'createCavalryCategoryChangeDrafts',
      '/v1/workbooks/wb_cert/drafts/category-changes',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer cert-token',
          'content-type': 'application/json',
          'idempotency-key': 'cert-category-1'
        },
        body: JSON.stringify({
          changes: [
            {
              transaction_id: 'txn_food',
              suggested_category_hint: 'Food',
              reason: 'Certification cleanup.'
            }
          ]
        })
      }
    )
  );
  const noApply = await requestJson(
    baseUrl,
    'noGptApplyEndpoint',
    '/v1/workbooks/wb_cert/draft-groups/dg_missing/apply',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer cert-token',
        'content-type': 'application/json'
      },
      body: '{}'
    }
  );
  noApply.ok = noApply.status === 404;
  operations.push(noApply);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const safetyAssertions = [
  {
    name: 'Draft creation did not mutate transactions',
    ok: workbook.transactions.length === beforeCoreCounts.transactions
  },
  {
    name: 'Draft creation did not mutate recurring items',
    ok: workbook.recurringItems.length === beforeCoreCounts.recurringItems
  },
  {
    name: 'Review URLs were generated for draft groups',
    ok: (workbook.externalDraftGroups || []).every((group) =>
      /^cavalry:\/\/draft-groups\/[A-Za-z0-9._:-]+$/.test(group.review_url || '')
    )
  },
  {
    name: 'Audit events were written without raw action plans',
    ok:
      (workbook.externalApiAuditEvents || []).length > 0 &&
      !(workbook.externalApiAuditEvents || []).some(
        (event) =>
          event.raw_action_plan || event.raw_request_body || event.token || event.access_token
      )
  }
];

const report = {
  generated_at: new Date().toISOString(),
  base_url: baseUrl,
  local_dev_ready:
    staticChecks.every((check) => check.ok) &&
    operations.every((operation) => operation.ok) &&
    safetyAssertions.every((assertion) => assertion.ok),
  production_cloud_ready: false,
  production_note:
    'Ready for local/dev GPT Action certification. Production cloud hosting still requires real OAuth, durable stores, hosted HTTPS, and deployment operations.',
  static_checks: staticChecks,
  operations,
  safety_assertions: safetyAssertions,
  draft_group_count: (workbook.externalDraftGroups || []).length,
  audit_event_count: (workbook.externalApiAuditEvents || []).length
};

const outDir = repoPath('test-artifacts/companion-gpt-action-certification');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
writeFileSync(resolve(outDir, 'report.md'), markdownReport(report), 'utf8');

if (!report.local_dev_ready) {
  console.error(
    'Companion GPT Action certification failed. See test-artifacts/companion-gpt-action-certification/report.md'
  );
  process.exit(1);
}

console.log('Companion GPT Action certification passed:', resolve(outDir, 'report.md'));
