import { parseCavalryActionPlan } from '../../domain/cavalry-action-plan/parse.js';
import { validateCavalryActionPlan } from '../../domain/cavalry-action-plan/validate.js';
import { createExternalDraftGroupFromActionPlan } from '../drafts/external-draft-service.js';

export function parseChatGptActionPlanImport(input, options = {}) {
  const parsed = parseCavalryActionPlan(input, {
    source: 'manual',
    dateDefault: options.dateDefault,
    currencyDefault: options.currencyDefault,
    timezone: options.timezone
  });
  if (!parsed.plan) {
    return parsed;
  }
  const validation = validateCavalryActionPlan(parsed.plan, {
    workbookId: options.workbookId,
    supportedCurrencies: options.supportedCurrencies
  });
  return {
    ok: parsed.ok && validation.ok,
    plan: parsed.plan,
    issues: (parsed.issues || []).concat(validation.issues || []),
    raw: parsed.raw
  };
}

export function importChatGptActionPlanAsDraftGroup({
  workbook,
  input,
  caller = { user_id: 'manual-import', scopes: ['cavalry.draft.create'], allowed_workbook_ids: [] },
  idempotencyKey,
  createId,
  now
} = {}) {
  return createExternalDraftGroupFromActionPlan({
    workbook,
    actionPlan: input,
    caller,
    origin: {
      origin: 'manual_action_plan_import',
      provider: 'chatgpt'
    },
    idempotencyKey,
    operation: 'manualActionPlanImport',
    createId,
    now
  });
}
