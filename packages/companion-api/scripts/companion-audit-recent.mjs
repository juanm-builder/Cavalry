import { readFileSync } from 'node:fs';

import {
  appendCompanionApiAuditEvent,
  exportCompanionApiAuditEvents,
  summarizeCompanionApiAuditEvents
} from '../src/application/api/companion-api-audit.js';
import { createCavalryApiController } from '../src/application/api/cavalry-api-controller.js';
import { CAVALRY_API_SCOPES } from '../src/application/api/cavalry-api-authz.js';
import { asString, repoPath, writeJson, writeText } from './companion-beta-utils.mjs';

function makeWorkbook() {
  return {
    id: 'wb_audit',
    name: 'Audit Export Workbook',
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
    ]
  };
}

function loadWorkbook() {
  const path = asString(process.env.CAVALRY_COMPANION_AUDIT_WORKBOOK_JSON);
  if (!path) {
    return makeWorkbook();
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function makeCreateId() {
  const counters = {};
  return (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + '_audit_' + String(counters[prefix]);
  };
}

const workbook = loadWorkbook();
const createId = makeCreateId();
const caller = {
  user_id: 'beta-audit-user',
  caller_type: 'beta_gpt_action',
  auth_method: 'beta_api_key',
  scopes: [
    CAVALRY_API_SCOPES.READ_SUMMARY,
    CAVALRY_API_SCOPES.READ_ACCOUNTS,
    CAVALRY_API_SCOPES.DRAFT_CREATE
  ],
  allowed_workbook_ids: [workbook.id]
};
const controller = createCavalryApiController({
  workbooks: [workbook],
  createId,
  now: () => '2026-06-28T00:00:00.000Z'
});

if (
  !Array.isArray(workbook.externalApiAuditEvents) ||
  workbook.externalApiAuditEvents.length === 0
) {
  controller.getWorkbookSummary({
    caller,
    workbookId: workbook.id,
    requestId: 'req_audit_read',
    originMetadata: { origin: 'chatgpt_action' },
    authMethod: 'beta_api_key'
  });
  controller.createTransactionDraftBatch({
    caller,
    workbookId: workbook.id,
    requestId: 'req_audit_draft',
    idempotencyKey: 'audit-export-draft-1',
    originMetadata: { origin: 'chatgpt_action' },
    authMethod: 'beta_api_key',
    body: {
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
    }
  });
  try {
    controller.createDraftGroupFromActionPlan({
      caller,
      workbookId: workbook.id,
      requestId: 'req_audit_unsupported',
      idempotencyKey: 'audit-export-unsupported-1',
      originMetadata: { origin: 'chatgpt_action' },
      authMethod: 'beta_api_key',
      body: {
        action_plan: {
          cavalry_action_plan_version: '1.0',
          source: 'chatgpt',
          actions: [{ type: 'delete_transaction', transaction_id: 'txn_existing' }]
        }
      }
    });
  } catch (_error) {
    // Validation failure is intentionally represented by the audit event.
  }
  appendCompanionApiAuditEvent(workbook, {
    createId,
    request_id: 'req_audit_auth_failure',
    caller_type: 'unknown',
    user_id: 'unknown',
    workbook_id: workbook.id,
    origin: 'chatgpt_action',
    auth_method: 'missing',
    operation: 'authFailure',
    operation_id: 'authFailure',
    outcome: 'auth_failed',
    result_status: 'auth_failed'
  });
}

const events = exportCompanionApiAuditEvents(workbook);
const groups = Array.isArray(workbook.externalDraftGroups) ? workbook.externalDraftGroups : [];
const enriched = events.map((event) => {
  const group =
    groups.find((candidate) => candidate.draft_group_id === event.draft_group_id) || null;
  return Object.assign({}, event, {
    ready_count:
      Number(event.ready_count) || Number(group && group.summary && group.summary.ready) || 0,
    needs_review_count:
      Number(event.needs_review_count) ||
      Number(group && group.summary && group.summary.needs_review) ||
      0
  });
});
const summary = summarizeCompanionApiAuditEvents(workbook);
const report = {
  generated_at: new Date().toISOString(),
  source: process.env.CAVALRY_COMPANION_AUDIT_WORKBOOK_JSON
    ? 'workbook_json'
    : 'synthetic_recent_beta_flow',
  summary,
  events: enriched,
  production_cloud_ready: false
};

writeJson(repoPath('test-artifacts/companion-audit/recent.json'), report);
writeText(
  repoPath('test-artifacts/companion-audit/recent.md'),
  [
    '# Companion API Recent Audit',
    '',
    '- Generated at: `' + report.generated_at + '`',
    '- Source: `' + report.source + '`',
    '- Total events: `' + String(summary.total) + '`',
    '',
    '| Request ID | Timestamp | Caller | Operation | Workbook | Draft Group | Actions | Ready | Needs Review | Issues | Duplicates | Idempotency | Outcome | Origin |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...enriched
      .map((event) =>
        [
          event.request_id || '',
          event.timestamp || event.occurred_at || '',
          event.caller_type || '',
          event.operation_id || event.operation || '',
          event.workbook_id || '',
          event.draft_group_id || '',
          String(event.action_count || 0),
          String(event.ready_count || 0),
          String(event.needs_review_count || 0),
          String(event.validation_issue_count || 0),
          String(event.duplicate_warning_count || 0),
          event.idempotency_result || '',
          event.outcome || event.result_status || '',
          event.origin || ''
        ]
          .map((value) => String(value).replace(/\|/g, '\\|'))
          .join(' | ')
      )
      .map((row) => '| ' + row + ' |'),
    '',
    'Secrets, auth headers, raw notes, and raw action plans are omitted.',
    ''
  ].join('\n')
);

console.log('Companion audit export generated: test-artifacts/companion-audit/recent.md');
