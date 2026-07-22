import { buildBudgetSummary } from '@cavalry/finance-core/application/budgets/budget-service.js';
import { createLocalDraftGroup } from '@cavalry/action-review/application/drafts/draft-group-service.js';
import { buildIncomeExpenseBreakdown } from '@cavalry/finance-core/application/reports/reporting-service.js';
import { buildTransactionTableView } from '@cavalry/finance-core/application/transactions/transaction-table-service.js';

export const IN_APP_ADVISOR_TOOL_REGISTRY_VERSION = 'cavalry.in_app_advisor.tools.v1';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function roundAmount(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function findByNameOrId(items, value) {
  const key = asString(value).toLowerCase();
  if (!key) {
    return null;
  }
  return (
    asArray(items).find((item) => {
      return (
        asString(item && item.id).toLowerCase() === key ||
        asString(item && item.name).toLowerCase() === key
      );
    }) || null
  );
}

function makeEnvelope(toolName, data, options = {}) {
  return {
    toolResultVersion: IN_APP_ADVISOR_TOOL_REGISTRY_VERSION,
    toolName,
    ok: options.ok !== false,
    authorization: options.authorization || 'read_only',
    data,
    sourceRefs: asArray(options.sourceRefs),
    limitations: asArray(options.limitations)
  };
}

function readWorkbookSummary({ workbook, arguments: args = {} }) {
  const breakdown = buildIncomeExpenseBreakdown(workbook, {
    start: args.start || args.startDate,
    end: args.end || args.endDate
  });
  return makeEnvelope(
    'read_workbook_summary',
    {
      currency: breakdown.currency,
      income: breakdown.income,
      expense: breakdown.expense,
      outflow: breakdown.outflow,
      net: breakdown.net,
      transferCount: breakdown.transferCount
    },
    {
      sourceRefs: workbook && workbook.id ? ['workbook:' + workbook.id] : [],
      limitations: breakdown.limitations
    }
  );
}

function searchTransactions({ workbook, arguments: args = {} }) {
  const view = buildTransactionTableView(workbook, {
    search: args.search || args.query || '',
    type: args.type || 'all',
    accountId: args.accountId || '',
    categoryId: args.categoryId || '',
    start: args.start || '',
    end: args.end || '',
    page: 1,
    pageSize: Math.min(25, Math.max(1, Number(args.limit) || 10))
  });
  return makeEnvelope(
    'search_transactions',
    {
      rows: view.rows.map((row) => ({
        id: row.id,
        date: row.date,
        description: row.description,
        amount: row.amount,
        baseAmount: row.baseAmount,
        type: row.type,
        categoryName: row.categoryName,
        accountNames: row.accountNames
      })),
      totalRows: view.totalRows
    },
    {
      sourceRefs: view.rows.map((row) => 'transaction:' + row.id)
    }
  );
}

function readBudgetSummary({ workbook, arguments: args = {} }) {
  const sheet =
    asArray(workbook && workbook.sheets).find(
      (item) => asString(item && item.id) === asString(args.sheetId)
    ) ||
    asArray(workbook && workbook.sheets)[0] ||
    null;
  if (!sheet) {
    return makeEnvelope(
      'read_budget_summary',
      {
        rows: [],
        totals: {}
      },
      {
        limitations: ['no_budget_sheet']
      }
    );
  }
  const summary = buildBudgetSummary(workbook, sheet);
  return makeEnvelope('read_budget_summary', summary, {
    sourceRefs: ['sheet:' + summary.sheetId]
  });
}

function prepareTransactionDraft({ workbook, arguments: args = {}, settings = {}, services = {} }) {
  if (settings.allowDraftCreation !== true) {
    return makeEnvelope(
      'prepare_transaction_draft',
      {
        draftGroup: null
      },
      {
        ok: false,
        authorization: 'creates_draft',
        limitations: ['draft_creation_disabled']
      }
    );
  }
  const account = findByNameOrId(
    workbook && workbook.accounts,
    args.paymentAccountId || args.accountId || args.account || args.paymentAccount
  );
  const category = findByNameOrId(
    workbook && workbook.categories,
    args.categoryId || args.category
  );
  const amount = roundAmount(args.amount);
  const draft = {
    type: 'transaction',
    status:
      account && category && amount > 0 && asString(args.date) && asString(args.description)
        ? 'ready'
        : 'needs_info',
    title: asString(args.description) || 'Transaction draft',
    display_summary: [
      asString(args.description),
      amount ? String(amount) : '',
      category && category.name
    ]
      .filter(Boolean)
      .join(' - '),
    proposed_values: {
      date: asString(args.date),
      description: asString(args.description),
      amount,
      currency:
        asString(args.currency).toUpperCase() ||
        asString(workbook && workbook.currency).toUpperCase() ||
        'PHP',
      direction: asString(args.direction || 'expense'),
      template: asString(args.direction) === 'income' ? 'income_received' : 'expense_paid',
      payment_account_id: account ? account.id : asString(args.paymentAccountId || args.accountId),
      payment_account_display: account
        ? account.name
        : asString(args.account || args.paymentAccount),
      payment_account_group: account ? account.group : '',
      category_id: category ? category.id : asString(args.categoryId),
      category_display: category ? category.name : asString(args.category),
      notes: asString(args.notes)
    },
    validation_issues:
      account && category && amount > 0
        ? []
        : [
            {
              code: 'missing_required_field',
              severity: 'error',
              message: 'Transaction draft needs amount, account, category, date, and description.'
            }
          ]
  };
  const group = createLocalDraftGroup({
    workbook,
    title: 'In-app Advisor transaction draft',
    drafts: [draft],
    origin: {
      origin: 'local_dev_api',
      provider: 'in_app_local_rules'
    },
    createId: services.createId,
    now: services.now
  });
  return makeEnvelope(
    'prepare_transaction_draft',
    {
      draftGroup: group,
      draftGroupId: group.draft_group_id,
      reviewUrl: group.review_url
    },
    {
      authorization: 'creates_draft',
      sourceRefs: ['draft-group:' + group.draft_group_id]
    }
  );
}

export const IN_APP_ADVISOR_TOOL_REGISTRY = Object.freeze({
  read_workbook_summary: Object.freeze({
    name: 'read_workbook_summary',
    authorization: 'read_only',
    run: readWorkbookSummary
  }),
  search_transactions: Object.freeze({
    name: 'search_transactions',
    authorization: 'read_only',
    run: searchTransactions
  }),
  read_budget_summary: Object.freeze({
    name: 'read_budget_summary',
    authorization: 'read_only',
    run: readBudgetSummary
  }),
  prepare_transaction_draft: Object.freeze({
    name: 'prepare_transaction_draft',
    authorization: 'creates_draft',
    run: prepareTransactionDraft
  })
});

export function listInAppAdvisorTools(options = {}) {
  return Object.values(IN_APP_ADVISOR_TOOL_REGISTRY)
    .filter((tool) => {
      return options.includeDraftTools === true || tool.authorization === 'read_only';
    })
    .map((tool) => ({
      name: tool.name,
      authorization: tool.authorization
    }));
}

export function getInAppAdvisorTool(name) {
  return IN_APP_ADVISOR_TOOL_REGISTRY[asString(name)] || null;
}

export function runInAppAdvisorTool(toolName, environment = {}) {
  const tool = getInAppAdvisorTool(toolName);
  if (!tool) {
    return makeEnvelope(toolName, null, {
      ok: false,
      limitations: ['unsupported_tool']
    });
  }
  return tool.run(environment);
}
