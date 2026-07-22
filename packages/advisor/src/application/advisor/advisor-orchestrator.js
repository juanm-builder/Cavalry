import { runAdvisorTurn } from './run-advisor-turn.js';
import { buildAdvisorTurnTrace } from './advisor-turn-trace.js';
import {
  resolveAdvisorReferents,
  shouldApplySubscriptionRecommendation
} from './referent-resolution.js';
import {
  adjudicateAdvisorTransactionIntent,
  advisorPromptLooksLikeCreditCardExpense
} from './intent-adjudication.js';
import { isAdvisorQaRoute } from './route-registry.js';

export const ADVISOR_ORCHESTRATOR_VERSION = 'cavalry.advisor_orchestrator.v1';

function asString(value) {
  return String(value || '').trim();
}

function clonePlain(value) {
  if (!(value && typeof value === 'object')) {
    return value || null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return Array.isArray(value) ? value.slice() : Object.assign({}, value);
  }
}

function callIfFunction(fn, ...args) {
  return typeof fn === 'function' ? fn(...args) : undefined;
}

function getDependency(input, dependencies, name) {
  const adapters =
    input && input.adapters && typeof input.adapters === 'object' ? input.adapters : {};
  return adapters[name] || dependencies[name];
}

function createId(input, dependencies, prefix) {
  const idFactory = input.createId || dependencies.createId;
  return typeof idFactory === 'function'
    ? idFactory(prefix)
    : prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function getNow(input, dependencies) {
  return callIfFunction(dependencies.now) || callIfFunction(input.now) || new Date().toISOString();
}

function getSettings(input) {
  return input.settings || {};
}

function getProvider(settings) {
  return asString(settings && settings.provider) || 'local';
}

function getAdapterKind(input) {
  return asString(input.orchestratorAdapter || input.adapter || input.flow || input.commandAdapter);
}

function isReadOnlyQaInput(input) {
  const turn = input && input.turn ? input.turn : null;
  return !!(turn && isAdvisorQaRoute(turn.targetIntent || turn.intent));
}

function normalizeMessage(message, fallbackTrace) {
  const source = message && typeof message === 'object' ? message : {};
  const normalized = Object.assign({}, source, {
    text: asString(source.text),
    references: Array.isArray(source.references) ? source.references.slice() : [],
    actions: Array.isArray(source.actions) ? source.actions.slice() : [],
    draftGroups: Array.isArray(source.draftGroups) ? source.draftGroups.slice() : [],
    turnTrace: source.turnTrace || fallbackTrace || null
  });
  if (!Array.isArray(normalized.actions)) {
    normalized.actions = [];
  }
  if (!Array.isArray(normalized.draftGroups)) {
    normalized.draftGroups = [];
  }
  return normalized;
}

function annotateTurnTrace(turnTrace, adapterKind) {
  if (!(turnTrace && typeof turnTrace === 'object')) {
    return null;
  }
  return Object.assign({}, clonePlain(turnTrace), {
    orchestrator: {
      version: ADVISOR_ORCHESTRATOR_VERSION,
      entryPoint: 'runAdvisorOrchestratorTurn',
      adapter: asString(adapterKind) || 'run_advisor_turn'
    }
  });
}

function isSafeFallbackUsed(turnTrace, result) {
  return (
    !!(result && result.safeFallbackUsed) ||
    !!(turnTrace && turnTrace.fallback && turnTrace.fallback.used)
  );
}

function normalizeOrchestratorResult(result, options = {}) {
  const adapterKind = asString(options.adapterKind);
  const rawTrace = result && (result.turnTrace || (result.message && result.message.turnTrace));
  const turnTrace = annotateTurnTrace(rawTrace, adapterKind);
  const message = normalizeMessage(result && result.message, turnTrace);
  if (turnTrace && message.turnTrace !== turnTrace) {
    message.turnTrace = turnTrace;
  }
  const draftGroups =
    Array.isArray(result && result.draftGroups) && result.draftGroups.length
      ? result.draftGroups
      : message.draftGroups;
  const statePatch = Object.assign({}, result && result.statePatch ? result.statePatch : {});
  if (
    result &&
    result.nextConversationState &&
    !Object.prototype.hasOwnProperty.call(statePatch, 'conversationState')
  ) {
    statePatch.conversationState = result.nextConversationState;
  }
  return Object.assign({}, result || {}, {
    message,
    actionCards: Array.isArray(result && result.actionCards) ? result.actionCards : message.actions,
    draftGroups: Array.isArray(draftGroups) ? draftGroups : [],
    statePatch,
    turnTrace,
    safeFallbackUsed: isSafeFallbackUsed(turnTrace, result)
  });
}

function buildRecurringDraftsFromReferents({ items, input, dependencies }) {
  return items.map((item, index) => {
    const id = createId(input, dependencies, 'advisor_recurring_draft');
    return {
      id,
      status: 'pending',
      operation: 'create',
      objectType: 'recurringItem',
      title: 'Track ' + asString(item.name || item.label || 'Recurring Charge'),
      summary: 'Create a recurring-item tracker from the previous Advisor recommendation.',
      proposed: {
        kind: item.kind === 'subscription' ? 'subscription' : 'bill',
        name: asString(item.name || item.label || 'Recurring Charge'),
        categoryId: asString(item.categoryId),
        counterpartyId: asString(item.counterpartyId),
        accountId: asString(item.accountId),
        amount: Number(item.amount) || 0,
        currency: asString(item.currency).toUpperCase(),
        frequency: asString(item.frequency) || 'Monthly',
        anchorDate: asString(item.anchorDate),
        sourceTransactionIds: Array.isArray(item.transactionIds) ? item.transactionIds.slice() : []
      },
      sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.slice() : [],
      confidence: Math.max(0.5, Math.min(1, Number(item.confidence || 0.75) || 0.75)),
      reason:
        asString(item.reason) ||
        'Advisor previously recommended reviewing this as a subscription or recurring charge.',
      order: index
    };
  });
}

function buildAiDraftActionsFromDrafts(drafts, input, dependencies) {
  return (Array.isArray(drafts) ? drafts : [])
    .map((draft) => ({
      id: createId(input, dependencies, 'advisor_ai_draft_action'),
      type: 'ai_draft_reference',
      aiDraftId: asString(draft && draft.id),
      title: asString(draft && draft.title) || 'AI Draft',
      summary: asString(draft && draft.summary),
      status: asString(draft && draft.status) || 'pending'
    }))
    .filter((action) => action.aiDraftId);
}

function buildAdapterTrace({
  input,
  dependencies,
  status,
  adapterKind,
  routeIntent,
  targetIntent,
  events,
  actions,
  preparedDrafts,
  blockedDraftCandidates,
  message,
  responseMode
}) {
  const settings = getSettings(input);
  return buildAdvisorTurnTrace({
    requestId: asString(input.requestId) || createId(input, dependencies, 'advisor_request'),
    traceId: asString(input.traceId) || createId(input, dependencies, 'advisor_trace'),
    status,
    provider: getProvider(settings),
    settings,
    responseMode: responseMode || (getProvider(settings) === 'local' ? 'rules' : 'prose'),
    route: {
      route: 'legacy_adapter',
      intent: routeIntent || adapterKind
    },
    turn: {
      intent: targetIntent || routeIntent || adapterKind,
      targetIntent: targetIntent || routeIntent || adapterKind
    },
    events,
    actions,
    preparedDrafts,
    blockedDraftCandidates,
    nextConversationState: input.conversationState || null,
    message,
    directWorkbookMutation: false,
    modelOutputAcceptedAsMutation: false
  });
}

async function runSubscriptionReferentAdapter(input = {}, dependencies = {}) {
  const prompt = asString(input.message || input.question || input.prompt);
  const conversationState = input.conversationState || {};
  const resolved = resolveAdvisorReferents(prompt, conversationState);
  const shouldApply = shouldApplySubscriptionRecommendation(prompt, conversationState);
  const events = [
    {
      type: shouldApply && resolved.resolved ? 'referent_resolved' : 'referent_unresolved',
      at: getNow(input, dependencies),
      metadata: {
        targetIntent: 'create_recurring_item',
        adapter: 'subscription_referent_followup'
      }
    }
  ];
  let drafts = [];
  let actions = [];
  let blocked = [];
  let text = '';
  if (shouldApply && resolved.resolved && resolved.items.length) {
    const createRecurringDrafts = getDependency(input, dependencies, 'createRecurringDrafts');
    const adapterResult = createRecurringDrafts
      ? await createRecurringDrafts({
          prompt,
          resolved,
          items: resolved.items,
          workbook: input.workbook || null,
          context: input.context || {},
          conversationState,
          input
        })
      : {
          drafts: buildRecurringDraftsFromReferents({ items: resolved.items, input, dependencies })
        };
    drafts = Array.isArray(adapterResult && adapterResult.drafts) ? adapterResult.drafts : [];
    blocked = Array.isArray(adapterResult && adapterResult.blocked) ? adapterResult.blocked : [];
    actions =
      Array.isArray(adapterResult && adapterResult.actions) && adapterResult.actions.length
        ? adapterResult.actions
        : buildAiDraftActionsFromDrafts(drafts, input, dependencies);
    text =
      asString(adapterResult && adapterResult.messageText) ||
      (drafts.length
        ? 'I queued reviewable recurring-item drafts from the previous recommendation. Review them before applying anything.'
        : 'I found the previous subscription recommendation, but I could not queue a safe recurring-item draft from it. Nothing changed.');
  } else {
    text =
      'I could not resolve that follow-up to a previous subscription recommendation. Nothing changed.';
  }
  const status = drafts.length ? 'answered' : 'needs_info';
  const message = {
    text,
    references: [],
    actions,
    draftGroups: []
  };
  const turnTrace = buildAdapterTrace({
    input,
    dependencies,
    status,
    adapterKind: 'subscription_referent_followup',
    routeIntent: 'subscription_referent_followup',
    targetIntent: 'create_recurring_item',
    events,
    actions,
    preparedDrafts: drafts,
    blockedDraftCandidates: blocked,
    message
  });
  return normalizeOrchestratorResult(
    {
      status,
      requestId: asString(input.requestId),
      traceId: asString(input.traceId),
      adapter: 'subscription_referent_followup',
      resolved,
      preparedDrafts: drafts,
      blockedDraftCandidates: blocked,
      message,
      nextConversationState: conversationState,
      turnTrace
    },
    { adapterKind: 'subscription_referent_followup' }
  );
}

function buildDefaultCreditCardAction(input, dependencies, adjudicated) {
  const intent = adjudicated && adjudicated.intent ? adjudicated.intent : {};
  const template = asString(intent.template) || 'expense_charged';
  return {
    id: createId(input, dependencies, 'advisor_transaction_action'),
    type: 'transaction_draft',
    status: 'needs_info',
    template,
    fields: Object.assign({}, intent.fields || {}),
    missingFields:
      template === 'debt_payment' || template === 'liability_payment'
        ? ['primaryAccountId', 'secondaryAccountId', 'categoryId']
        : ['primaryAccountId', 'categoryId'],
    confidence: Math.max(0.72, Number(intent.confidence || 0) || 0.72),
    reason: asString(intent.reason) || 'Finance language describes a transaction draft for review.'
  };
}

async function runCreditCardTransactionAdapter(input = {}, dependencies = {}) {
  const prompt = asString(input.message || input.question || input.prompt);
  const suppliedIntent = input.transactionIntent || input.intent || {};
  const adjudicated = adjudicateAdvisorTransactionIntent({
    message: prompt,
    intent: suppliedIntent
  });
  const changed = !!(adjudicated && adjudicated.changed);
  const events = [
    {
      type: 'transaction_intent_adjudicated',
      at: getNow(input, dependencies),
      metadata: {
        targetIntent: 'record_transaction',
        adapter: 'credit_card_transaction_draft',
        changed,
        template: (adjudicated && adjudicated.intent && adjudicated.intent.template) || ''
      }
    }
  ];
  const defaultAction = buildDefaultCreditCardAction(input, dependencies, adjudicated);
  let actions = changed ? [defaultAction] : [];
  let blocked = [];
  let text = changed
    ? 'I can prepare that as a transaction draft for review. Nothing has been posted.'
    : 'I could not safely identify that as a transaction draft. Nothing changed.';
  let adapterStatus = changed ? 'needs_info' : 'needs_info';
  const prepareTransactionDraft = getDependency(
    input,
    dependencies,
    'prepareCreditCardTransactionDraft'
  );
  if (changed && prepareTransactionDraft) {
    const adapterResult = await prepareTransactionDraft({
      prompt,
      adjudicated,
      action: defaultAction,
      workbook: input.workbook || null,
      context: input.context || {},
      input
    });
    if (Array.isArray(adapterResult && adapterResult.actions)) {
      actions = adapterResult.actions;
    } else if (adapterResult && adapterResult.action) {
      actions = [adapterResult.action];
    }
    blocked = Array.isArray(adapterResult && adapterResult.blockedItems)
      ? adapterResult.blockedItems
      : Array.isArray(adapterResult && adapterResult.blocked)
        ? adapterResult.blocked
        : [];
    text = asString(adapterResult && adapterResult.messageText) || text;
    adapterStatus = asString(adapterResult && adapterResult.status) || adapterStatus;
  }
  const message = {
    text,
    references: [],
    actions,
    draftGroups: []
  };
  const turnTrace = buildAdapterTrace({
    input,
    dependencies,
    status: adapterStatus,
    adapterKind: 'credit_card_transaction_draft',
    routeIntent: 'transaction_intake',
    targetIntent: 'record_transaction',
    events,
    actions,
    preparedDrafts: [],
    blockedDraftCandidates: blocked,
    message
  });
  return normalizeOrchestratorResult(
    {
      status: adapterStatus,
      requestId: asString(input.requestId),
      traceId: asString(input.traceId),
      adapter: 'credit_card_transaction_draft',
      adjudicated,
      message,
      turnTrace
    },
    { adapterKind: 'credit_card_transaction_draft' }
  );
}

async function runLegacyAdapter(input = {}, dependencies = {}) {
  const adapter = getDependency(input, dependencies, 'legacyAdapter');
  if (typeof adapter !== 'function') {
    return null;
  }
  const result = await adapter(input);
  return normalizeOrchestratorResult(result, {
    adapterKind: getAdapterKind(input) || 'legacy_adapter'
  });
}

export async function runAdvisorOrchestratorTurn(input = {}, dependencies = {}) {
  const mergedDependencies = Object.assign({}, dependencies, input.dependencies || {});
  const adapterKind = getAdapterKind(input);
  if (
    adapterKind === 'subscription_referent_followup' ||
    adapterKind === 'subscription_referent' ||
    adapterKind === 'create_recurring_item_draft'
  ) {
    return runSubscriptionReferentAdapter(input, mergedDependencies);
  }
  if (
    adapterKind === 'credit_card_transaction_draft' ||
    adapterKind === 'credit_card_charge_expense_draft'
  ) {
    return runCreditCardTransactionAdapter(input, mergedDependencies);
  }
  if (adapterKind === 'legacy_adapter') {
    const legacyResult = await runLegacyAdapter(input, mergedDependencies);
    if (legacyResult) {
      return legacyResult;
    }
  }
  if (isReadOnlyQaInput(input) || !adapterKind) {
    const result = await runAdvisorTurn(input, mergedDependencies);
    return normalizeOrchestratorResult(result, {
      adapterKind: isReadOnlyQaInput(input) ? 'read_only_qa' : 'run_advisor_turn'
    });
  }
  if (advisorPromptLooksLikeCreditCardExpense(input.message || input.question || input.prompt)) {
    return runCreditCardTransactionAdapter(
      Object.assign({}, input, {
        adapter: 'credit_card_transaction_draft'
      }),
      mergedDependencies
    );
  }
  const legacyResult = await runLegacyAdapter(input, mergedDependencies);
  if (legacyResult) {
    return legacyResult;
  }
  const result = await runAdvisorTurn(input, mergedDependencies);
  return normalizeOrchestratorResult(result, { adapterKind: 'run_advisor_turn' });
}
