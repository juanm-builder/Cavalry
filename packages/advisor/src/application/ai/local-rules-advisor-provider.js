import { createAdvisorProvider } from './advisor-provider-interface.js';
import { runInAppAdvisorTool } from './advisor-tool-registry.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function textKey(value) {
  return asString(value).toLowerCase();
}

function findMentionedItem(items, prompt) {
  const key = textKey(prompt);
  return (
    (Array.isArray(items) ? items : []).find((item) => {
      const name = textKey(item && item.name);
      const id = textKey(item && item.id);
      return (name && key.includes(name)) || (id && key.includes(id));
    }) || null
  );
}

function parseAmount(prompt) {
  const match = /(?:php|usd|\$)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i.exec(asString(prompt));
  return match ? Number(match[1].replace(/,/g, '')) : 0;
}

function parseDescription(prompt) {
  return (
    asString(prompt)
      .replace(
        /\b(add|record|create|log|please|transaction|expense|income|for|paid|payment)\b/gi,
        ' '
      )
      .replace(/(?:php|usd|\$)?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Advisor transaction draft'
  );
}

function isApplyRequest(prompt) {
  return /\b(apply|approve|confirm|post|commit)\b[\s\S]{0,80}\b(draft|drafts|change|changes|transaction|transactions)\b/i.test(
    asString(prompt)
  );
}

function isDestructiveRequest(prompt) {
  return /\b(delete|erase|wipe|remove|destroy|purge)\b[\s\S]{0,80}\b(all|everything|workbook|transactions|accounts|categories|data)\b/i.test(
    asString(prompt)
  );
}

function isRestrictedSettingsRequest(prompt) {
  return /\b(bank|payment|tax|legal|security|password|api key|apikey|secret|token|credential)\b[\s\S]{0,80}\b(setting|settings|configure|change|update|delete|disable|enable)\b/i.test(
    asString(prompt)
  );
}

function isAddTransactionRequest(prompt) {
  return /\b(add|record|create|log)\b[\s\S]{0,80}\b(transaction|expense|income|payment|purchase|spend|spent|paid)\b/i.test(
    asString(prompt)
  );
}

function buildRefusal(code, message) {
  return {
    ok: false,
    status: 'refused',
    code,
    message,
    actions: [],
    draftGroup: null
  };
}

function buildReadOnlySummary(workbook, prompt, tools) {
  const result = tools.run('read_workbook_summary', {
    workbook,
    arguments: {}
  });
  const data = result && result.data ? result.data : {};
  return {
    ok: true,
    status: 'answered',
    message:
      'Income: ' +
      String(data.income || 0) +
      '. Expense: ' +
      String(data.expense || 0) +
      '. Net: ' +
      String(data.net || 0) +
      '.',
    toolResults: [result],
    actions: [],
    promptEcho: asString(prompt)
  };
}

function buildTransactionDraft(workbook, prompt, settings, tools, services) {
  if (settings.allowDraftCreation !== true) {
    return buildRefusal(
      'draft_creation_disabled',
      'I can only prepare reviewable drafts when draft creation is enabled.'
    );
  }
  const account =
    findMentionedItem(workbook && workbook.accounts, prompt) ||
    (Array.isArray(workbook && workbook.accounts)
      ? workbook.accounts.find((item) => item && item.group === 'asset' && item.isActive !== false)
      : null);
  const category =
    findMentionedItem(workbook && workbook.categories, prompt) ||
    (Array.isArray(workbook && workbook.categories)
      ? workbook.categories.find(
          (item) => item && item.type === 'expense' && item.isActive !== false
        )
      : null);
  const amount = parseAmount(prompt);
  const result = tools.run('prepare_transaction_draft', {
    workbook,
    settings,
    services,
    arguments: {
      date: services.today || services.dateDefault || '',
      description: parseDescription(prompt),
      amount,
      direction: /income/i.test(prompt) ? 'income' : 'expense',
      accountId: account && account.id,
      categoryId: category && category.id,
      currency: workbook && workbook.currency
    }
  });
  if (!(result && result.ok)) {
    return buildRefusal('draft_creation_failed', 'I could not prepare a safe transaction draft.');
  }
  return {
    ok: true,
    status: 'draft_prepared',
    message: 'I prepared a reviewable draft. Nothing has changed in the workbook yet.',
    draftGroup: result.data.draftGroup,
    actions: [
      {
        type: 'draft_group_reference',
        draftGroupId: result.data.draftGroupId,
        reviewUrl: result.data.reviewUrl
      }
    ],
    toolResults: [result]
  };
}

export function createLocalRulesAdvisorProvider(options = {}) {
  const tools = {
    run:
      typeof options.runTool === 'function'
        ? options.runTool
        : (toolName, environment) => runInAppAdvisorTool(toolName, environment)
  };
  return createAdvisorProvider({
    id: 'local_rules',
    kind: 'local_rules',
    label: 'Local rules advisor',
    network: false,
    async run(request = {}) {
      const prompt = asString(request.prompt || request.message || request.question);
      const workbook = request.workbook || {};
      const settings = request.settings || {};
      const services = Object.assign({}, request.services || {}, {
        today: options.today || (request.services && request.services.today) || ''
      });
      if (isApplyRequest(prompt)) {
        return buildRefusal(
          'apply_refused',
          'Advisor cannot apply drafts or commit workbook changes.'
        );
      }
      if (isDestructiveRequest(prompt)) {
        return buildRefusal('delete_refused', 'Advisor cannot permanently delete workbook data.');
      }
      if (isRestrictedSettingsRequest(prompt)) {
        return buildRefusal(
          'restricted_settings_refused',
          'Advisor cannot change bank, payment, tax, legal, security, or credential settings.'
        );
      }
      if (isAddTransactionRequest(prompt)) {
        return buildTransactionDraft(workbook, prompt, settings, tools, services);
      }
      return buildReadOnlySummary(workbook, prompt, tools);
    }
  });
}
