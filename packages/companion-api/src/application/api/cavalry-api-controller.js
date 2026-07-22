import { classifyAdvisorTransactionSemantics } from '@cavalry/advisor/domain/advisor/financial-semantics.js';
import { buildAdvisorAccountSnapshotPacket } from '@cavalry/advisor/domain/advisor/packets.js';
import { roundMoney } from '@cavalry/finance-core/domain/money.js';
import {
  createCategoryChangeDraftGroup,
  createExternalDraftGroupFromActionPlan,
  createRecurringItemDraftGroup,
  createTransactionBatchDraftGroup
} from '@cavalry/action-review/application/drafts/external-draft-service.js';
import { findExternalDraftGroup } from '@cavalry/action-review/application/drafts/draft-group-model.js';
import { executeCheckpointedActionPlan } from '@cavalry/action-review/application/ai-actions/checkpointed-action-executor.js';
import {
  listCheckpoints as listWorkbookCheckpoints,
  getCheckpoint as getWorkbookCheckpoint
} from '@cavalry/action-review/application/checkpoints/checkpoint-service.js';
import { projectCheckpointForReview } from '@cavalry/action-review/application/checkpoints/checkpoint-review-projection.js';
import {
  previewRollback,
  rollbackCheckpoint as executeRollbackCheckpoint
} from '@cavalry/action-review/application/checkpoints/rollback-service.js';
import { CAVALRY_API_SCOPES, assertScope, assertWorkbookScope } from './cavalry-api-authz.js';
import { appendCompanionApiAuditEvent } from './companion-api-audit.js';
import { CavalryApiError } from './cavalry-api-errors.js';
import {
  COMPANION_MUTATION_KINDS,
  assertCompanionMutationAllowed
} from './companion-mutation-gate-service.js';
import { createExternalCallerContext } from './external-caller-context.js';
import {
  serializeAccount,
  serializeCategory,
  serializeDraftGroup,
  serializeWorkbookSummary
} from './cavalry-api-serializers.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function parseDate(value) {
  const raw = asString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function dateInRange(date, start, end) {
  const key = asString(date);
  if (start && key < start) return false;
  if (end && key > end) return false;
  return true;
}

function inferDirection(transaction) {
  const template = asString(transaction && transaction.template);
  if (template === 'income_received') return 'income';
  if (template === 'transfer') return 'transfer';
  if (template === 'debt_payment' || template === 'liability_payment') return 'debt_payment';
  if (template === 'expense_paid' || template === 'expense_charged') return 'expense';
  return 'unknown';
}

function getCategoryName(workbook, categoryId) {
  const category = (workbook.categories || []).find((item) => item.id === categoryId) || null;
  return category ? category.name : '';
}

function getAccountName(workbook, accountId) {
  const account = (workbook.accounts || []).find((item) => item.id === accountId) || null;
  return account ? account.name : '';
}

function getPrimaryAccountId(transaction) {
  if (transaction && transaction.primaryAccountId) return transaction.primaryAccountId;
  const lines = Array.isArray(transaction && transaction.lines) ? transaction.lines : [];
  const credit = lines.find((line) => line.direction === 'credit') || lines[0] || null;
  return credit ? credit.accountId : '';
}

function sortNewestFirst(transactions) {
  return transactions
    .slice()
    .sort(
      (a, b) =>
        asString(b.date).localeCompare(asString(a.date)) ||
        asString(b.id).localeCompare(asString(a.id))
    );
}

function filterTransactions(workbook, query = {}) {
  const start = parseDate(query.start_date || query.startDate);
  const end = parseDate(query.end_date || query.endDate);
  return (workbook.transactions || []).filter((transaction) =>
    dateInRange(transaction.date, start, end)
  );
}

function buildWorkbookReadSummary(workbook, query = {}) {
  const transactions = filterTransactions(workbook, query);
  const accountSnapshot = buildAdvisorAccountSnapshotPacket(workbook, {
    asOfDate: parseDate(query.as_of_date || query.asOfDate || query.end_date || query.endDate)
  });
  const totals = {
    income: 0,
    consumption_spending: 0,
    debt_payments: 0,
    transfers: 0,
    total_outflow: 0,
    net_cash_flow: 0
  };
  const categories = {};
  transactions.forEach((transaction) => {
    const amount = roundMoney(transaction.amount || transaction.baseAmount || 0);
    const direction = inferDirection(transaction);
    if (direction === 'income') {
      totals.income = roundMoney(totals.income + amount);
      totals.net_cash_flow = roundMoney(totals.net_cash_flow + amount);
      return;
    }
    if (direction === 'transfer') {
      totals.transfers = roundMoney(totals.transfers + amount);
      return;
    }
    if (direction === 'debt_payment') {
      totals.debt_payments = roundMoney(totals.debt_payments + amount);
    } else {
      totals.consumption_spending = roundMoney(totals.consumption_spending + amount);
    }
    totals.total_outflow = roundMoney(totals.total_outflow + amount);
    totals.net_cash_flow = roundMoney(totals.net_cash_flow - amount);
    const categoryName = getCategoryName(workbook, transaction.categoryId) || 'Uncategorized';
    categories[categoryName] = roundMoney((categories[categoryName] || 0) + amount);
  });
  const topCategories = Object.keys(categories)
    .map((name) => ({
      display_name: name,
      amount: categories[name],
      currency: workbook.currency || 'PHP'
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
  return {
    workbook: serializeWorkbookSummary(workbook),
    date_range: {
      start_date: parseDate(query.start_date || query.startDate) || null,
      end_date: parseDate(query.end_date || query.endDate) || null
    },
    totals: Object.assign({ currency: workbook.currency || 'PHP' }, totals),
    top_categories: topCategories,
    budgets_vs_actual: [],
    recurring_candidates: [],
    account_snapshot: accountSnapshot,
    data_quality_notes: transactions.length ? [] : ['No transactions matched the requested range.'],
    definitions: {
      consumption_spending:
        'Expense transactions, excluding transfers and debt-principal payments.',
      total_outflow: 'Consumption spending plus debt payments in the selected range.',
      net_cash_flow: 'Income minus total outflow, excluding internal transfers.'
    }
  };
}

function serializeRecentTransaction(workbook, transaction) {
  const semantics = classifyAdvisorTransactionSemantics(workbook, transaction);
  return {
    transaction_id: asString(transaction.id),
    date: asString(transaction.date),
    description: asString(transaction.description),
    amount: roundMoney(transaction.amount || transaction.baseAmount || 0),
    currency: asString(
      transaction.originalCurrency || transaction.currency || workbook.currency || 'PHP'
    ),
    direction: inferDirection(transaction),
    account_display: getAccountName(workbook, getPrimaryAccountId(transaction)),
    category_display: getCategoryName(workbook, transaction.categoryId),
    semantic_class: semantics.economicFlow,
    recurrence_hint: semantics.recurrence
  };
}

export function createMemoryWorkbookStore(workbooks = []) {
  const byId = new Map(
    (Array.isArray(workbooks) ? workbooks : []).map((workbook) => [asString(workbook.id), workbook])
  );
  return {
    listWorkbooks(caller) {
      const allowed = Array.isArray(caller && caller.allowed_workbook_ids)
        ? caller.allowed_workbook_ids.map(asString)
        : [];
      return Array.from(byId.values()).filter(
        (workbook) => !allowed.length || allowed.includes(asString(workbook.id))
      );
    },
    getWorkbook(workbookId) {
      return byId.get(asString(workbookId)) || null;
    },
    saveWorkbook(workbook) {
      byId.set(asString(workbook && workbook.id), workbook);
      return workbook;
    }
  };
}

function requireWorkbook(store, workbookId) {
  const workbook = store.getWorkbook(workbookId);
  if (!workbook) {
    throw new CavalryApiError('external_ref_not_found', 'Workbook was not found.', {
      status: 404
    });
  }
  return workbook;
}

function makeRequestId(createId) {
  return typeof createId === 'function'
    ? createId('req')
    : 'req_' + Math.random().toString(36).slice(2, 10);
}

export function createCavalryApiController(options = {}) {
  const workbookStore = options.workbookStore || createMemoryWorkbookStore(options.workbooks || []);
  const createId = typeof options.createId === 'function' ? options.createId : undefined;
  const now = typeof options.now === 'function' ? options.now : undefined;
  const runtimeStatus = options.runtimeStatus || {};
  const rateState = new Map();
  const rateLimits = Object.assign(
    {
      requestsPerMinute: 120,
      draftGroupsPerHour: 60
    },
    options.rateLimits || {}
  );

  function getTimeMs() {
    const value = now ? Date.parse(now()) : Date.now();
    return Number.isFinite(value) ? value : Date.now();
  }

  function assertRateLimit(caller, bucket = 'read') {
    const userId = asString(caller && caller.user_id) || 'anonymous';
    const key = userId + ':' + bucket;
    const current = getTimeMs();
    const record = rateState.get(key) || {
      minuteStart: current,
      minuteCount: 0,
      hourStart: current,
      draftCount: 0
    };
    if (current - record.minuteStart >= 60000) {
      record.minuteStart = current;
      record.minuteCount = 0;
    }
    if (current - record.hourStart >= 3600000) {
      record.hourStart = current;
      record.draftCount = 0;
    }
    record.minuteCount += 1;
    if (record.minuteCount > rateLimits.requestsPerMinute) {
      rateState.set(key, record);
      throw new CavalryApiError(
        'rate_limited',
        'Too many Cavalry API requests. Try again shortly.',
        {
          status: 429
        }
      );
    }
    if (bucket === 'draft') {
      record.draftCount += 1;
      if (record.draftCount > rateLimits.draftGroupsPerHour) {
        rateState.set(key, record);
        throw new CavalryApiError(
          'rate_limited',
          'Too many draft groups were created recently. Try again later.',
          {
            status: 429
          }
        );
      }
    }
    rateState.set(key, record);
  }

  function draftContext(input = {}, operation) {
    const originMetadata = Object.assign(
      {
        origin: input.origin || 'local_dev_api',
        provider: 'chatgpt',
        userAgent: input.userAgent,
        requestIpHash: input.requestIpHash,
        requestId: input.requestId
      },
      input.originMetadata || {}
    );
    if (input.origin && typeof input.origin === 'string') {
      originMetadata.origin = input.origin;
    }
    const callerContext = createExternalCallerContext({
      caller: input.caller,
      callerType:
        input.caller &&
        (input.caller.callerType || input.caller.caller_type || input.caller.subject_type),
      workbookId: input.workbook && input.workbook.id,
      origin: originMetadata.origin,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      authMethod:
        input.authMethod || (input.caller && (input.caller.authMethod || input.caller.auth_method))
    });
    return {
      workbook: input.workbook,
      caller: callerContext,
      origin: originMetadata,
      idempotencyKey: input.idempotencyKey,
      createId,
      now,
      operation
    };
  }

  function recordReadAudit({
    workbook,
    caller,
    operation,
    requestId,
    originMetadata,
    authMethod,
    resultStatus = 'success',
    elapsedMs
  } = {}) {
    if (!workbook) {
      return null;
    }
    return appendCompanionApiAuditEvent(workbook, {
      createId,
      request_id: requestId,
      caller_type: caller && (caller.callerType || caller.caller_type || caller.subject_type),
      user_id: caller && (caller.userId || caller.user_id),
      workbook_id: workbook.id,
      origin: originMetadata && originMetadata.origin,
      auth_method: authMethod || (caller && (caller.authMethod || caller.auth_method)),
      operation,
      operation_id: operation,
      scopes: caller && caller.scopes,
      action_count: 0,
      idempotency_result: 'none',
      outcome: resultStatus,
      result_status: resultStatus,
      elapsed_ms: elapsedMs,
      public_origin:
        originMetadata && originMetadata.origin === 'chatgpt_action' ? 'chatgpt_action' : '',
      local_origin:
        originMetadata && originMetadata.origin === 'local_dev_api' ? 'local_dev_api' : ''
    });
  }

  return {
    getCapabilities({ caller } = {}) {
      assertScope(caller, CAVALRY_API_SCOPES.READ_CAPABILITIES);
      assertRateLimit(caller, 'read');
      return {
        api_version: '1.0',
        capabilities: {
          read_summary: true,
          read_recent_transactions: true,
          create_transaction_drafts: true,
          create_recurring_item_drafts: true,
          create_category_change_drafts: true,
          apply_drafts_from_chatgpt: false,
          execute_checkpointed_action_plans: runtimeStatus.checkpointed_apply_enabled === true
        },
        supported_action_plan_versions: ['1.0'],
        review_required_for_all_external_writes: true,
        api_enabled: runtimeStatus.api_enabled !== false,
        api_mode: runtimeStatus.api_mode || 'local_dev',
        bind_host: runtimeStatus.bind_host || '127.0.0.1',
        public_base_url_configured: runtimeStatus.public_base_url_configured === true,
        auth_required: runtimeStatus.auth_required !== false,
        ai_action_mode: runtimeStatus.ai_action_mode || 'draft_only',
        checkpointed_apply_enabled: runtimeStatus.checkpointed_apply_enabled === true,
        draft_only_available: runtimeStatus.draft_only_available !== false,
        rollback_available: runtimeStatus.rollback_available === true,
        irreversible_actions_allowed: false,
        max_checkpoint_actions: Number(runtimeStatus.max_checkpoint_actions) || 25,
        draft_only: true,
        production_cloud_ready: false,
        manual_import_available: true,
        review_url_scheme: runtimeStatus.review_url_scheme || 'cavalry://draft-groups/{id}',
        direct_mutation_endpoints_exposed: false
      };
    },

    listWorkbooks({ caller } = {}) {
      assertScope(caller, CAVALRY_API_SCOPES.READ_WORKBOOKS);
      assertRateLimit(caller, 'read');
      return {
        workbooks: workbookStore.listWorkbooks(caller).map(serializeWorkbookSummary)
      };
    },

    getWorkbookSummary({ caller, workbookId, query, requestId, originMetadata, authMethod } = {}) {
      assertWorkbookScope(caller, workbookId, CAVALRY_API_SCOPES.READ_SUMMARY);
      assertRateLimit(caller, 'read');
      const workbook = requireWorkbook(workbookStore, workbookId);
      recordReadAudit({
        workbook,
        caller,
        operation: 'getCavalryWorkbookSummary',
        requestId,
        originMetadata,
        authMethod
      });
      return buildWorkbookReadSummary(workbook, query || {});
    },

    listAccounts({ caller, workbookId, query, requestId, originMetadata, authMethod } = {}) {
      assertWorkbookScope(caller, workbookId, CAVALRY_API_SCOPES.READ_ACCOUNTS);
      assertRateLimit(caller, 'read');
      const workbook = requireWorkbook(workbookStore, workbookId);
      const snapshot = buildAdvisorAccountSnapshotPacket(workbook, {
        asOfDate: parseDate(query && (query.as_of_date || query.asOfDate))
      });
      const rowsById = new Map(
        (snapshot.accounts || []).map((row) => [asString(row.account_id), row])
      );
      recordReadAudit({
        workbook,
        caller,
        operation: 'listCavalryAccounts',
        requestId,
        originMetadata,
        authMethod
      });
      return {
        accounts: (workbook.accounts || []).map((account) =>
          serializeAccount(account, rowsById.get(asString(account && account.id)) || {})
        )
      };
    },

    listCategories({ caller, workbookId, requestId, originMetadata, authMethod } = {}) {
      assertWorkbookScope(caller, workbookId, CAVALRY_API_SCOPES.READ_CATEGORIES);
      assertRateLimit(caller, 'read');
      const workbook = requireWorkbook(workbookStore, workbookId);
      recordReadAudit({
        workbook,
        caller,
        operation: 'listCavalryCategories',
        requestId,
        originMetadata,
        authMethod
      });
      return {
        categories: (workbook.categories || []).map(serializeCategory)
      };
    },

    listRecentTransactions({
      caller,
      workbookId,
      query,
      requestId,
      originMetadata,
      authMethod
    } = {}) {
      assertWorkbookScope(caller, workbookId, CAVALRY_API_SCOPES.READ_TRANSACTIONS_RECENT);
      assertRateLimit(caller, 'read');
      const workbook = requireWorkbook(workbookStore, workbookId);
      const requestedLimit = Math.max(1, Math.min(100, Number(query && query.limit) || 50));
      const filtered = sortNewestFirst(filterTransactions(workbook, query || {}));
      recordReadAudit({
        workbook,
        caller,
        operation: 'listCavalryRecentTransactions',
        requestId,
        originMetadata,
        authMethod
      });
      return {
        transactions: filtered
          .slice(0, requestedLimit)
          .map((transaction) => serializeRecentTransaction(workbook, transaction)),
        coverage: {
          returned: Math.min(filtered.length, requestedLimit),
          omitted: Math.max(0, filtered.length - requestedLimit),
          limit: requestedLimit
        }
      };
    },

    createDraftGroupFromActionPlan(input = {}) {
      assertWorkbookScope(input.caller, input.workbookId, CAVALRY_API_SCOPES.DRAFT_CREATE);
      assertCompanionMutationAllowed(runtimeStatus, COMPANION_MUTATION_KINDS.DRAFT_GROUP_CREATE);
      assertRateLimit(input.caller, 'draft');
      const workbook = requireWorkbook(workbookStore, input.workbookId);
      const group = createExternalDraftGroupFromActionPlan(
        Object.assign(
          draftContext(Object.assign({}, input, { workbook }), 'createDraftGroupFromActionPlan'),
          {
            actionPlan: input.body && input.body.action_plan ? input.body.action_plan : input.body
          }
        )
      );
      workbookStore.saveWorkbook(workbook);
      return serializeDraftGroup(group);
    },

    createTransactionDraftBatch(input = {}) {
      assertWorkbookScope(input.caller, input.workbookId, CAVALRY_API_SCOPES.DRAFT_CREATE);
      assertCompanionMutationAllowed(runtimeStatus, COMPANION_MUTATION_KINDS.DRAFT_GROUP_CREATE);
      assertRateLimit(input.caller, 'draft');
      const workbook = requireWorkbook(workbookStore, input.workbookId);
      const group = createTransactionBatchDraftGroup(
        Object.assign(
          draftContext(Object.assign({}, input, { workbook }), 'createTransactionDraftBatch'),
          {
            request: input.body || {}
          }
        )
      );
      workbookStore.saveWorkbook(workbook);
      return serializeDraftGroup(group);
    },

    createRecurringItemDrafts(input = {}) {
      assertWorkbookScope(input.caller, input.workbookId, CAVALRY_API_SCOPES.DRAFT_CREATE);
      assertCompanionMutationAllowed(runtimeStatus, COMPANION_MUTATION_KINDS.DRAFT_GROUP_CREATE);
      assertRateLimit(input.caller, 'draft');
      const workbook = requireWorkbook(workbookStore, input.workbookId);
      const group = createRecurringItemDraftGroup(
        Object.assign(
          draftContext(Object.assign({}, input, { workbook }), 'createRecurringItemDrafts'),
          {
            request: input.body || {}
          }
        )
      );
      workbookStore.saveWorkbook(workbook);
      return serializeDraftGroup(group);
    },

    createCategoryChangeDrafts(input = {}) {
      assertWorkbookScope(input.caller, input.workbookId, CAVALRY_API_SCOPES.DRAFT_CREATE);
      assertCompanionMutationAllowed(runtimeStatus, COMPANION_MUTATION_KINDS.DRAFT_GROUP_CREATE);
      assertRateLimit(input.caller, 'draft');
      const workbook = requireWorkbook(workbookStore, input.workbookId);
      const group = createCategoryChangeDraftGroup(
        Object.assign(
          draftContext(Object.assign({}, input, { workbook }), 'createCategoryChangeDrafts'),
          {
            request: input.body || {}
          }
        )
      );
      workbookStore.saveWorkbook(workbook);
      return serializeDraftGroup(group);
    },

    getDraftGroup({
      caller,
      workbookId,
      draftGroupId,
      requestId,
      originMetadata,
      authMethod
    } = {}) {
      assertWorkbookScope(caller, workbookId, CAVALRY_API_SCOPES.DRAFT_READ);
      assertRateLimit(caller, 'read');
      const workbook = requireWorkbook(workbookStore, workbookId);
      const group = findExternalDraftGroup(workbook, draftGroupId);
      if (!group) {
        throw new CavalryApiError('external_ref_not_found', 'Draft group was not found.', {
          status: 404
        });
      }
      recordReadAudit({
        workbook,
        caller,
        operation: 'getCavalryDraftGroup',
        requestId,
        originMetadata,
        authMethod
      });
      return serializeDraftGroup(group);
    },

    executeCheckpointedActionPlan(input = {}) {
      assertWorkbookScope(input.caller, input.workbookId, CAVALRY_API_SCOPES.CHECKPOINT_EXECUTE);
      assertCompanionMutationAllowed(
        runtimeStatus,
        COMPANION_MUTATION_KINDS.CHECKPOINTED_ACTION_EXECUTE
      );
      assertRateLimit(input.caller, 'draft');
      const workbook = requireWorkbook(workbookStore, input.workbookId);
      const result = executeCheckpointedActionPlan({
        workbook,
        workbookId: input.workbookId,
        actionPlan: input.body && input.body.action_plan ? input.body.action_plan : input.body,
        callerContext: input.caller,
        executionMode: 'checkpointed_apply',
        sourcePrompt: input.body && (input.body.source_prompt || input.body.sourcePrompt),
        idempotencyKey: input.idempotencyKey,
        dryRun: input.body && input.body.dry_run === true,
        maxActions: Number(runtimeStatus.max_checkpoint_actions) || 25,
        createId,
        now,
        requestId: input.requestId
      });
      workbookStore.saveWorkbook(workbook);
      return result;
    },

    listCheckpoints({ caller, workbookId, query } = {}) {
      assertWorkbookScope(caller, workbookId, CAVALRY_API_SCOPES.CHECKPOINT_READ);
      assertRateLimit(caller, 'read');
      const workbook = requireWorkbook(workbookStore, workbookId);
      return {
        checkpoints: listWorkbookCheckpoints(workbook, {
          limit: Number(query && query.limit) || 50
        }).map(projectCheckpointForReview)
      };
    },

    getCheckpoint({ caller, workbookId, checkpointId } = {}) {
      assertWorkbookScope(caller, workbookId, CAVALRY_API_SCOPES.CHECKPOINT_READ);
      assertRateLimit(caller, 'read');
      const workbook = requireWorkbook(workbookStore, workbookId);
      const checkpoint = getWorkbookCheckpoint(workbook, checkpointId);
      if (!checkpoint) {
        throw new CavalryApiError('checkpoint_not_found', 'Checkpoint was not found.', {
          status: 404
        });
      }
      return projectCheckpointForReview(checkpoint);
    },

    previewCheckpointRollback({ caller, workbookId, checkpointId, body } = {}) {
      assertWorkbookScope(caller, workbookId, CAVALRY_API_SCOPES.CHECKPOINT_READ);
      assertRateLimit(caller, 'read');
      const workbook = requireWorkbook(workbookStore, workbookId);
      return previewRollback({
        workbook,
        checkpointId,
        changeIds: body && body.change_ids
      });
    },

    rollbackCheckpoint({ caller, workbookId, checkpointId, body } = {}) {
      assertWorkbookScope(caller, workbookId, CAVALRY_API_SCOPES.CHECKPOINT_ROLLBACK);
      assertCompanionMutationAllowed(runtimeStatus, COMPANION_MUTATION_KINDS.CHECKPOINT_ROLLBACK);
      assertRateLimit(caller, 'draft');
      const workbook = requireWorkbook(workbookStore, workbookId);
      const result = executeRollbackCheckpoint({
        workbook,
        checkpointId,
        changeIds: body && body.change_ids,
        conflictPolicy: (body && body.conflict_policy) || 'safe_only',
        caller,
        createId,
        now
      });
      workbookStore.saveWorkbook(workbook);
      return result;
    },

    makeRequestId() {
      return makeRequestId(createId);
    }
  };
}
