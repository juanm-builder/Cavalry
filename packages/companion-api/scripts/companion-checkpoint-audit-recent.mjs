import { exportCheckpointAuditEvents } from '@cavalry/action-review/application/checkpoints/checkpoint-audit.js';
import { executeCheckpointedActionPlan } from '@cavalry/action-review/application/ai-actions/checkpointed-action-executor.js';
import { CAVALRY_API_SCOPES } from '../src/application/api/cavalry-api-authz.js';
import { repoPath, writeJson, writeText } from './companion-beta-utils.mjs';

function makeWorkbook() {
  return {
    id: 'wb_checkpoint_audit',
    name: 'Checkpoint Audit Workbook',
    currency: 'PHP',
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
      { id: 'office_supplies', name: 'Office Supplies', type: 'expense', isActive: true }
    ],
    transactions: []
  };
}

const workbook = makeWorkbook();
const caller = {
  user_id: 'checkpoint-audit-user',
  caller_type: 'beta_gpt_action',
  auth_method: 'beta_api_key',
  scopes: [CAVALRY_API_SCOPES.CHECKPOINT_EXECUTE, CAVALRY_API_SCOPES.CHECKPOINT_READ],
  allowed_workbook_ids: [workbook.id]
};

executeCheckpointedActionPlan({
  workbook,
  workbookId: workbook.id,
  actionPlan: {
    cavalry_action_plan_version: '1.0',
    source: 'chatgpt',
    date_default: '2026-06-28',
    currency_default: 'PHP',
    actions: [
      {
        id: 'audit_txn',
        type: 'create_transaction',
        description: 'Audit Printer paper',
        amount: 150,
        currency: 'PHP',
        direction: 'expense',
        payment_account_hint: 'Office Cash Account',
        category_hint: 'Office Supplies'
      },
      { id: 'audit_blocked', type: 'delete_all_transactions' }
    ]
  },
  callerContext: caller,
  executionMode: 'checkpointed_apply',
  idempotencyKey: 'checkpoint-audit-1',
  requestId: 'req_checkpoint_audit'
});

const events = exportCheckpointAuditEvents(workbook);
const report = {
  generated_at: new Date().toISOString(),
  events,
  checkpoint_count: (workbook.checkpoints || []).length,
  production_cloud_ready: false
};

writeJson(repoPath('test-artifacts/companion-checkpoint-audit/recent.json'), report);
writeText(
  repoPath('test-artifacts/companion-checkpoint-audit/recent.md'),
  [
    '# Companion Checkpoint Audit',
    '',
    '- Generated at: `' + report.generated_at + '`',
    '- Checkpoints: `' + String(report.checkpoint_count) + '`',
    '',
    '| Event | Request ID | Checkpoint | Operation | Applied | Blocked | Conflicts | Outcome |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...events.map(
      (event) =>
        '| ' +
        [
          event.event_type,
          event.request_id,
          event.checkpoint_id,
          event.operation_id,
          event.applied_count,
          event.blocked_count,
          event.conflict_count,
          event.outcome
        ]
          .map((value) => String(value || '').replace(/\|/g, '\\|'))
          .join(' | ') +
        ' |'
    ),
    '',
    'Tokens, auth headers, raw action plans, and raw request bodies are omitted.',
    ''
  ].join('\n')
);

console.log(
  'Companion checkpoint audit export generated: test-artifacts/companion-checkpoint-audit/recent.md'
);
