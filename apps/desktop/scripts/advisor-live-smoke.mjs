import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAdvisorOrchestratorTurn } from '@cavalry/advisor/application/advisor/advisor-orchestrator.js';
import { adjudicateAdvisorTransactionIntent } from '@cavalry/advisor/application/advisor/intent-adjudication.js';
import { buildAdvisorPartialTransactionRecovery } from '@cavalry/advisor/application/advisor/partial-extraction.js';
import {
  buildAdvisorModelMessages,
  buildAdvisorTransactionImageIntentMessages
} from '@cavalry/advisor/domain/advisor/model-messages.js';
import { buildAdvisorTransactionTextIntentPacket } from '@cavalry/advisor/domain/advisor/packets.js';
import { validateAdvisorAnswer } from '@cavalry/advisor/domain/advisor/answer-validation.js';
import { classifyAdvisorCommandMode } from '@cavalry/advisor/domain/advisor/command-mode.js';
import {
  normalizeAdvisorRelayTransactionIntentResults,
  normalizeAdvisorTransactionIntakeInterpretation
} from '@cavalry/advisor/domain/advisor/transaction-drafts.js';
import {
  ADVISOR_ACCEPTANCE_PROVIDER_PROFILES,
  categorizationReviewTurn,
  makeAcceptanceContext,
  makeAcceptanceWorkbook,
  makeCategorizationSummary,
  makeCleanupServices,
  makeSpendingSummary,
  replaySubscriptionReferentFollowup,
  spendingTurn
} from '../../../packages/advisor/tests/helpers/advisor-acceptance-harness.js';

const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:8080/v1/chat/completions';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, '..');
const ARTIFACT_DIR = path.join(APP_ROOT, 'test-artifacts/advisor-provider-certification');
const CURRENT_DATE = '2026-06-27';

function env(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function nowIso() {
  return new Date().toISOString();
}

function truncate(text, limit = 1200) {
  const value = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) return '';
  return /\/chat\/completions\/?$/i.test(value)
    ? value
    : value.replace(/\/+$/, '') + '/chat/completions';
}

function buildChatCompletionsClient({ endpoint, model, apiKey, providerName }) {
  const chatEndpoint = normalizeEndpoint(endpoint);
  const timeoutMs = Math.max(5000, Number(env('CAVALRY_ADVISOR_CERT_TIMEOUT_MS')) || 60000);
  const maxTokens = Math.max(300, Number(env('CAVALRY_ADVISOR_CERT_MAX_TOKENS')) || 1400);
  const calls = [];
  return {
    calls,
    async chat(payload) {
      const startedAt = performance.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const request = {
        model,
        messages: payload.messages,
        temperature: payload.temperature,
        top_p: payload.top_p,
        max_tokens: Math.min(Number(payload.max_tokens || maxTokens) || maxTokens, maxTokens)
      };
      if (payload.response_format) {
        request.response_format = payload.response_format;
      }
      try {
        const response = await fetch(chatEndpoint, {
          method: 'POST',
          headers: Object.assign(
            {
              'content-type': 'application/json'
            },
            apiKey ? { authorization: 'Bearer ' + apiKey } : {}
          ),
          body: JSON.stringify(request),
          signal: controller.signal
        });
        const body = await response.json().catch(() => ({}));
        const elapsedMs = Math.round(performance.now() - startedAt);
        calls.push({
          providerName,
          endpoint: chatEndpoint.replace(/\/\/[^/@]+@/g, '//[redacted]@'),
          model,
          requestId: String(payload.requestId || ''),
          ok: response.ok,
          status: response.status,
          elapsedMs
        });
        if (!response.ok) {
          return {
            ok: false,
            error:
              body && body.error && body.error.message ? body.error.message : response.statusText
          };
        }
        return {
          ok: true,
          text: String(
            (body &&
              body.choices &&
              body.choices[0] &&
              body.choices[0].message &&
              body.choices[0].message.content) ||
              ''
          )
        };
      } catch (error) {
        const elapsedMs = Math.round(performance.now() - startedAt);
        calls.push({
          providerName,
          endpoint: chatEndpoint.replace(/\/\/[^/@]+@/g, '//[redacted]@'),
          model,
          requestId: String(payload.requestId || ''),
          ok: false,
          elapsedMs,
          error:
            error && error.name === 'AbortError'
              ? 'timeout'
              : String(error && error.message ? error.message : error)
        });
        return {
          ok: false,
          error:
            error && error.name === 'AbortError'
              ? 'Provider request timed out after ' + String(timeoutMs) + 'ms.'
              : String(error && error.message ? error.message : error)
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function providerProfiles() {
  const profiles = [
    {
      name: 'rules_engine',
      label: 'Built-in rules',
      enabled: true,
      skipped: false,
      skipReason: '',
      runtimeProviderKind: 'rules_engine',
      settings: ADVISOR_ACCEPTANCE_PROVIDER_PROFILES.rules_engine.settings,
      modelClient: null,
      supportsVision: false
    }
  ];

  const remoteApiKey = env('CAVALRY_ADVISOR_REMOTE_API_KEY', 'OPENAI_API_KEY');
  const remoteModel = env('CAVALRY_ADVISOR_REMOTE_MODEL', 'OPENAI_MODEL');
  const remoteEndpoint =
    env('CAVALRY_ADVISOR_REMOTE_ENDPOINT', 'OPENAI_BASE_URL') || DEFAULT_OPENAI_ENDPOINT;
  if (remoteApiKey && remoteModel) {
    const client = buildChatCompletionsClient({
      endpoint: remoteEndpoint,
      model: remoteModel,
      apiKey: remoteApiKey,
      providerName: 'remote_llm'
    });
    profiles.push({
      name: 'remote_llm',
      label: 'Remote/API model',
      enabled: true,
      skipped: false,
      skipReason: '',
      runtimeProviderKind: 'remote_llm',
      settings: {
        provider: 'openai',
        endpoint: remoteEndpoint,
        model: remoteModel,
        apiKey: remoteApiKey
      },
      modelClient: client,
      supportsVision: true
    });
  } else {
    profiles.push({
      name: 'remote_llm',
      label: 'Remote/API model',
      enabled: false,
      skipped: true,
      skipReason:
        'Set CAVALRY_ADVISOR_REMOTE_API_KEY/OPENAI_API_KEY and CAVALRY_ADVISOR_REMOTE_MODEL/OPENAI_MODEL.',
      runtimeProviderKind: 'remote_llm',
      settings: { provider: 'openai', endpoint: remoteEndpoint, model: remoteModel },
      modelClient: null,
      supportsVision: false
    });
  }

  const localEndpoint = env('CAVALRY_ADVISOR_LOCAL_ENDPOINT');
  const localModel = env('CAVALRY_ADVISOR_LOCAL_MODEL');
  const localEnabled = localEndpoint || localModel || env('CAVALRY_ADVISOR_LOCAL_SMOKE') === '1';
  if (localEnabled) {
    const endpoint = localEndpoint || DEFAULT_LOCAL_ENDPOINT;
    const model = localModel || 'cavalry-advisor';
    const mmprojPath = env('CAVALRY_ADVISOR_LOCAL_MMPROJ', 'CAVALRY_ADVISOR_LOCAL_MMPROJ_PATH');
    const client = buildChatCompletionsClient({
      endpoint,
      model,
      apiKey: env('CAVALRY_ADVISOR_LOCAL_API_KEY'),
      providerName: 'local_llm'
    });
    profiles.push({
      name: 'local_llm',
      label: 'Local llama.cpp model',
      enabled: true,
      skipped: false,
      skipReason: '',
      runtimeProviderKind: 'local_llm',
      settings: {
        provider: 'custom',
        endpoint,
        model,
        apiKey: env('CAVALRY_ADVISOR_LOCAL_API_KEY'),
        mmprojPath
      },
      modelClient: client,
      supportsVision: !!mmprojPath
    });
  } else {
    profiles.push({
      name: 'local_llm',
      label: 'Local llama.cpp model',
      enabled: false,
      skipped: true,
      skipReason: 'Set CAVALRY_ADVISOR_LOCAL_ENDPOINT or CAVALRY_ADVISOR_LOCAL_SMOKE=1.',
      runtimeProviderKind: 'local_llm',
      settings: {
        provider: 'custom',
        endpoint: localEndpoint || DEFAULT_LOCAL_ENDPOINT,
        model: localModel || ''
      },
      modelClient: null,
      supportsVision: false
    });
  }
  return profiles;
}

function stripReasoningArtifacts(text) {
  return String(text || '')
    .replace(/```(?:json|markdown|md)?/gi, '')
    .replace(/```/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*(analysis|reasoning)\s*:\s*[\s\S]*?(?=\n\s*(answer|final)\s*:|\n\n|$)/i, '')
    .replace(/^\s*(answer|final)\s*:\s*/i, '')
    .trim();
}

function formatProviderAnswer(text) {
  const cleaned = stripReasoningArtifacts(text);
  if (!cleaned) {
    throw new Error('The model did not return an answer.');
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.answer_markdown === 'string') {
      return { text: stripReasoningArtifacts(parsed.answer_markdown), references: [] };
    }
    if (parsed && typeof parsed.answer === 'string') {
      return { text: stripReasoningArtifacts(parsed.answer), references: [] };
    }
  } catch (_error) {
    // Plain prose is the expected provider certification mode.
  }
  return { text: cleaned, references: [] };
}

function makeDeps({ summary, modelClient, events }) {
  return {
    now: nowIso,
    onEvent: (event) => events.push(event),
    buildSummary: () => summary,
    buildMessages: (question, context, financialSummary, options) =>
      buildAdvisorModelMessages(question, financialSummary, options),
    getResponseFormat: () => null,
    formatModelResponse: (text) => formatProviderAnswer(text),
    formatProseResponse: (text) => formatProviderAnswer(text),
    validateAnswer: validateAdvisorAnswer,
    modelClient
  };
}

function getTraceEventTypes(trace) {
  return trace && trace.events && Array.isArray(trace.events.types) ? trace.events.types : [];
}

function modelWasAttempted(trace, profile) {
  if (profile.name === 'rules_engine') return false;
  return getTraceEventTypes(trace).indexOf('requesting_model') >= 0;
}

function modelSucceeded(result, trace, profile) {
  if (profile.name === 'rules_engine') return false;
  return !!(
    result &&
    result.status === 'answered' &&
    !(trace && trace.fallback && trace.fallback.used)
  );
}

function getProviderModelName(provider) {
  return String((provider && provider.settings && provider.settings.model) || '').trim();
}

function getTraceModelDiagnostics(trace) {
  return trace && trace.modelDiagnostics && typeof trace.modelDiagnostics === 'object'
    ? trace.modelDiagnostics
    : {
        attempts: [],
        retryAttempted: false,
        finalFailureReason: '',
        finalValidationIssueCodes: []
      };
}

function buildTurnModelDiagnostics({
  provider,
  trace,
  route,
  responseMode,
  modelAttempted,
  modelSucceeded,
  fallbackUsed,
  skeletonUsed,
  validationFailures,
  finalVisibleMessage,
  finalFailureReason = '',
  outputExcerpt = '',
  manualAttempts = null
}) {
  const traceDiagnostics = getTraceModelDiagnostics(trace);
  const attempts = Array.isArray(manualAttempts)
    ? manualAttempts
    : Array.isArray(traceDiagnostics.attempts)
      ? traceDiagnostics.attempts
      : [];
  const retryAttempts = attempts.filter((attempt) => attempt && attempt.retrying);
  const retryInstructions = attempts
    .map((attempt) => String((attempt && attempt.retryInstruction) || '').trim())
    .filter(Boolean);
  const validationCodes =
    validationFailures && validationFailures.length
      ? validationFailures
      : traceDiagnostics.finalValidationIssueCodes ||
        attempts.reduce(
          (codes, attempt) => codes.concat((attempt && attempt.validationIssueCodes) || []),
          []
        );
  return {
    providerProfile: {
      name: provider.name,
      runtimeProviderKind: provider.runtimeProviderKind
    },
    modelName: getProviderModelName(provider),
    route: route || null,
    responseMode: responseMode || (route && route.responseMode) || '',
    modelAttempted: !!modelAttempted,
    modelTransportSucceeded: attempts.some(
      (attempt) => attempt && attempt.transportSucceeded === true
    ),
    modelOutputParseSucceeded: attempts.some(
      (attempt) => attempt && attempt.parseSucceeded === true
    ),
    modelValidationSucceeded:
      attempts.some((attempt) => attempt && attempt.validationSucceeded === true) ||
      !!modelSucceeded,
    retryAttempted: traceDiagnostics.retryAttempted === true || retryAttempts.length > 0,
    retryValidationSucceeded: retryAttempts.some(
      (attempt) => attempt && attempt.validationSucceeded === true
    ),
    fallbackUsed: !!fallbackUsed,
    skeletonUsed: !!skeletonUsed,
    validationIssueCodes: Array.from(
      new Set((validationCodes || []).map((code) => String(code || '').trim()).filter(Boolean))
    ),
    retryInstructions,
    finalFailureReason: String(
      finalFailureReason || traceDiagnostics.finalFailureReason || ''
    ).trim(),
    modelOutputExcerpt: String(
      outputExcerpt ||
        attempts
          .map((attempt) => attempt && attempt.modelOutputExcerpt)
          .filter(Boolean)
          .pop() ||
        ''
    ).trim(),
    finalVisibleCopy: truncate(finalVisibleMessage, 900),
    fallbackCopyUserVisible: !!fallbackUsed,
    modelFailureCopyVisible:
      /\bI had trouble generating\b|^I could not produce a verified Advisor answer/i.test(
        String(finalVisibleMessage || '')
      )
  };
}

function summarizeTurn({
  flowId,
  turnId,
  provider,
  message,
  result,
  trace,
  commandMode,
  startedAt,
  error,
  modelAttemptedOverride,
  modelSucceededOverride,
  fallbackUsedOverride,
  skeletonUsedOverride,
  finalTextOverride,
  draftGroupsOverride,
  actionsOverride
}) {
  const elapsedMs = Math.round(performance.now() - startedAt);
  const finalText =
    typeof finalTextOverride === 'string'
      ? finalTextOverride
      : String((result && result.message && result.message.text) || '');
  const actions = Array.isArray(actionsOverride)
    ? actionsOverride
    : result && result.message && Array.isArray(result.message.actions)
      ? result.message.actions
      : [];
  const draftGroups = Array.isArray(draftGroupsOverride)
    ? draftGroupsOverride
    : result && result.message && Array.isArray(result.message.draftGroups)
      ? result.message.draftGroups
      : [];
  const validationFailures =
    trace && trace.events && Array.isArray(trace.events.validationIssueCodes)
      ? trace.events.validationIssueCodes
      : [];
  const traceSafety = trace && trace.safety ? trace.safety : {};
  const route = trace && trace.route ? trace.route : null;
  const attempted =
    typeof modelAttemptedOverride === 'boolean'
      ? modelAttemptedOverride
      : modelWasAttempted(trace, provider);
  const succeeded =
    typeof modelSucceededOverride === 'boolean'
      ? modelSucceededOverride
      : modelSucceeded(result, trace, provider);
  const usedFallback =
    typeof fallbackUsedOverride === 'boolean'
      ? fallbackUsedOverride
      : !!(trace && trace.fallback && trace.fallback.used);
  const usedSkeleton =
    typeof skeletonUsedOverride === 'boolean'
      ? skeletonUsedOverride
      : !!(trace && trace.fallback && trace.fallback.usedSkeleton);
  return {
    flowId,
    turnId,
    providerProfile: {
      name: provider.name,
      label: provider.label,
      runtimeProviderKind: provider.runtimeProviderKind
    },
    resolvedRoute: route,
    commandMode: commandMode || classifyAdvisorCommandMode(message),
    modelAttempted: attempted,
    modelSucceeded: succeeded,
    fallbackUsed: usedFallback,
    skeletonUsed: usedSkeleton,
    validationFailures,
    draftGroups: {
      count: draftGroups.length || (trace && trace.draftGroups && trace.draftGroups.count) || 0,
      ids: draftGroups
        .map((group) => String((group && (group.id || group.groupId)) || ''))
        .filter(Boolean)
    },
    actionCards: {
      count: actions.length || (trace && trace.actions && trace.actions.count) || 0,
      types: actions.map((action) => String((action && action.type) || '')).filter(Boolean)
    },
    safety: {
      directWorkbookMutation: traceSafety.directWorkbookMutation === true,
      modelOutputAcceptedAsMutation: traceSafety.modelOutputAcceptedAsMutation === true,
      writesRequireReview: traceSafety.writesRequireReview !== false,
      reviewableActionCount: Number(traceSafety.reviewableActionCount) || 0,
      reviewableDraftCount: Number(traceSafety.reviewableDraftCount) || 0,
      draftGroupCount: Number(traceSafety.draftGroupCount) || 0
    },
    modelDiagnostics: buildTurnModelDiagnostics({
      provider,
      trace,
      route,
      responseMode: route && route.responseMode,
      modelAttempted: attempted,
      modelSucceeded: succeeded,
      fallbackUsed: usedFallback,
      skeletonUsed: usedSkeleton,
      validationFailures,
      finalVisibleMessage: finalText,
      finalFailureReason:
        (result && result.fallbackReason) || (error && (error.message || error)) || ''
    }),
    finalVisibleMessage: truncate(finalText, 1800),
    elapsedMs,
    status: result && result.status ? result.status : error ? 'error' : 'answered',
    error: error ? String(error && error.message ? error.message : error) : ''
  };
}

async function runAdvisorQaTurn({
  flowId,
  turnId,
  provider,
  message,
  turn,
  summary,
  workbook,
  context,
  services,
  history,
  conversationState,
  persistAdvisorDrafts = false
}) {
  const startedAt = performance.now();
  const events = [];
  const commandMode = classifyAdvisorCommandMode(message, { previousState: conversationState });
  let result = null;
  let error = null;
  try {
    result = await runAdvisorOrchestratorTurn(
      {
        requestId: flowId + '_' + provider.name + '_' + turnId,
        traceId: flowId + '_' + provider.name + '_' + turnId,
        message,
        settings: provider.settings,
        turn,
        context,
        workbook,
        services,
        history,
        conversationState,
        persistAdvisorDrafts,
        exposeTurnTrace: true,
        createId: (prefix) => prefix + '_' + provider.name + '_' + turnId
      },
      makeDeps({
        summary,
        modelClient: provider.modelClient,
        events
      })
    );
  } catch (caught) {
    error = caught;
  }
  const trace = result && result.turnTrace ? result.turnTrace : null;
  const turnRecord = summarizeTurn({
    flowId,
    turnId,
    provider,
    message,
    result,
    trace,
    commandMode,
    startedAt,
    error
  });
  return {
    result,
    trace,
    turnRecord,
    nextConversationState:
      result && result.nextConversationState ? result.nextConversationState : conversationState
  };
}

function extractJsonObject(text) {
  const value = String(text || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(value);
  const source = fenced ? fenced[1].trim() : value;
  try {
    return JSON.parse(source);
  } catch (_error) {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(source.slice(start, end + 1));
      } catch (_inner) {
        return null;
      }
    }
    return null;
  }
}

function makeSyntheticImageAttachment() {
  return {
    id: 'provider-cert-receipt',
    type: 'image',
    filename: 'provider-cert-receipt.png',
    mimeType: 'image/png',
    size: 96,
    width: 1,
    height: 1,
    modelWidth: 1,
    modelHeight: 1,
    dataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lG2ZGQAAAABJRU5ErkJggg=='
  };
}

function imageNeedsInfoText(reason) {
  return buildAdvisorPartialTransactionRecovery({
    diagnostic: { reason },
    blockedItems: [
      {
        stage: 'review',
        reason,
        action: {
          type: 'transaction_draft',
          template: 'expense_paid',
          status: 'needs_info',
          fields: {
            description: 'Attached receipt',
            amount: 0,
            currency: 'PHP'
          },
          missingFields: ['amount', 'primaryAccountId']
        }
      }
    ]
  });
}

async function runImageFlow(provider) {
  const flowId = 'image_transaction_recovery';
  const message =
    'Create a transaction draft from this attached receipt image. If details are not visible, say what is still needed.';
  const startedAt = performance.now();
  const commandMode = classifyAdvisorCommandMode(message);
  const workbook = makeAcceptanceWorkbook();
  const attachment = makeSyntheticImageAttachment();
  let modelAttempted = false;
  let modelSucceededFlag = false;
  let fallbackUsed = false;
  let skeletonUsed = false;
  let finalText = '';
  let actions = [];
  let error = '';
  let validationFailures = [];
  let manualAttempts = [];
  if (provider.name === 'rules_engine') {
    fallbackUsed = true;
    finalText = imageNeedsInfoText(
      'Built-in rules cannot read image pixels. Use a configured vision model or type the amount/account.'
    );
  } else if (!provider.supportsVision) {
    fallbackUsed = true;
    finalText = imageNeedsInfoText('Vision input is not configured for this provider.');
  } else {
    modelAttempted = true;
    const payload = {
      requestId: flowId + '_' + provider.name,
      messages: buildAdvisorTransactionImageIntentMessages(workbook, message, [attachment], {
        currentDate: CURRENT_DATE
      }),
      temperature: 0,
      top_p: 0.9,
      max_tokens: 900
    };
    const modelResult = await provider.modelClient.chat(payload);
    const attempt = {
      attempt: 1,
      retrying: false,
      responseMode: 'json',
      modelAttempted: true,
      transportSucceeded: !!(modelResult && modelResult.ok && modelResult.text),
      parseSucceeded: false,
      validationSucceeded: false,
      validationIssueCodes: [],
      retryInstruction: '',
      failureReason: '',
      modelOutputExcerpt: truncate(modelResult && modelResult.text ? modelResult.text : '', 420)
    };
    manualAttempts = [attempt];
    if (modelResult && modelResult.ok && modelResult.text) {
      const parsed = extractJsonObject(modelResult.text);
      attempt.parseSucceeded = !!parsed;
      const interpretation = parsed
        ? normalizeAdvisorTransactionIntakeInterpretation(parsed, message, { source: 'model' })
        : null;
      const candidateCount =
        interpretation && Array.isArray(interpretation.transactions)
          ? interpretation.transactions.length
          : 0;
      if (candidateCount > 0) {
        modelSucceededFlag = true;
        attempt.validationSucceeded = true;
        const first = interpretation.transactions[0];
        const missing = Array.isArray(first.missingFields) ? first.missingFields : [];
        if (missing.length || interpretation.intent === 'needs_info') {
          fallbackUsed = true;
          finalText = imageNeedsInfoText(
            'The provider returned partial image details that still need review: ' +
              missing.join(', ')
          );
        } else {
          finalText =
            'The provider extracted an image transaction candidate for review. Certification did not mutate the workbook.';
          actions = [
            {
              type: 'transaction_draft',
              status: 'draft',
              template: (first.intent && first.intent.template) || first.template || ''
            }
          ];
        }
      } else {
        fallbackUsed = true;
        validationFailures = parsed ? ['image_no_candidates'] : ['image_unparseable_json'];
        attempt.validationIssueCodes = validationFailures;
        attempt.failureReason = parsed
          ? 'The provider returned JSON but no transaction candidates.'
          : 'The provider did not return parseable transaction JSON.';
        finalText = imageNeedsInfoText(
          parsed
            ? 'The provider returned JSON but no transaction candidates.'
            : 'The provider did not return parseable transaction JSON.'
        );
      }
    } else {
      fallbackUsed = true;
      error =
        modelResult && modelResult.error
          ? modelResult.error
          : 'Provider did not return image text.';
      attempt.failureReason = error;
      finalText = imageNeedsInfoText(error);
    }
  }
  const elapsedMs = Math.round(performance.now() - startedAt);
  return {
    turns: [
      {
        flowId,
        turnId: 'image',
        providerProfile: {
          name: provider.name,
          label: provider.label,
          runtimeProviderKind: provider.runtimeProviderKind
        },
        resolvedRoute: { route: 'transaction_image_intake', intent: 'transaction_drafts' },
        commandMode,
        modelAttempted,
        modelSucceeded: modelSucceededFlag,
        fallbackUsed,
        skeletonUsed,
        validationFailures,
        draftGroups: { count: 0, ids: [] },
        actionCards: { count: actions.length, types: actions.map((action) => action.type) },
        safety: {
          directWorkbookMutation: false,
          modelOutputAcceptedAsMutation: false,
          writesRequireReview: true,
          reviewableActionCount: actions.length,
          reviewableDraftCount: 0,
          draftGroupCount: 0
        },
        modelDiagnostics: buildTurnModelDiagnostics({
          provider,
          trace: null,
          route: {
            route: 'transaction_image_intake',
            intent: 'transaction_drafts',
            responseMode: 'json'
          },
          responseMode: 'json',
          modelAttempted,
          modelSucceeded: modelSucceededFlag,
          fallbackUsed,
          skeletonUsed,
          validationFailures,
          finalVisibleMessage: finalText,
          finalFailureReason: error || validationFailures.join(', '),
          manualAttempts
        }),
        finalVisibleMessage: truncate(finalText, 1800),
        elapsedMs,
        status: error ? 'fallback' : 'answered',
        error
      }
    ],
    evaluation: {
      usefulRecovery:
        /could read|need|configured vision|not configured|nothing changed|partial/i.test(finalText),
      draftCorrectness:
        actions.length === 0 || actions.every((action) => action.type === 'transaction_draft')
    }
  };
}

function transactionIntentMessages(workbook, prompt) {
  return [
    {
      role: 'system',
      content: [
        'You are Cavalry Transaction Intake.',
        'Interpret the full user message before extracting drafts.',
        'Return exactly one JSON object matching this shape:',
        '{"route":"new_transaction_batch","usePendingDraft":false,"intent":"transaction_drafts","reason":"","question":"","questions":[],"transactions":[{"template":"expense_paid|expense_charged|income_received|transfer|debt_payment|opening_balance|","confidence":0.8,"reason":"","sourceText":"","fields":{"date":"","description":"","amount":0,"currency":"","categoryId":"","categoryName":"","primaryAccountId":"","primaryAccountName":"","secondaryAccountId":"","secondaryAccountName":"","counterpartyId":"","counterpartyName":"","counterpartyKind":"","note":""},"missing_fields":[]}]}',
        'Never create an account draft. If charged to a credit card, use template expense_charged.'
      ].join(' ')
    },
    {
      role: 'user',
      content: JSON.stringify(
        buildAdvisorTransactionTextIntentPacket(workbook, prompt, null, {
          currentDate: CURRENT_DATE,
          defaultDateForUndatedRows: true
        })
      )
    }
  ];
}

async function runCreditCardFlow(provider) {
  const flowId = 'credit_card_charge_expense_draft';
  const prompt = 'also add 15usd charged to my credit card. purchased credits for open ai API';
  const workbook = makeAcceptanceWorkbook();
  const startedAt = performance.now();
  const commandMode = classifyAdvisorCommandMode(prompt);
  let modelAttempted = false;
  let modelSucceededFlag = false;
  let fallbackUsed = false;
  let validationFailures = [];
  let modelIntent = {};
  let error = '';
  let manualAttempts = [];
  if (provider.name !== 'rules_engine') {
    modelAttempted = true;
    const modelResult = await provider.modelClient.chat({
      requestId: flowId + '_' + provider.name,
      messages: transactionIntentMessages(workbook, prompt),
      temperature: 0,
      top_p: 0.9,
      max_tokens: 900
    });
    const attempt = {
      attempt: 1,
      retrying: false,
      responseMode: 'json',
      modelAttempted: true,
      transportSucceeded: !!(modelResult && modelResult.ok && modelResult.text),
      parseSucceeded: false,
      validationSucceeded: false,
      validationIssueCodes: [],
      retryInstruction: '',
      failureReason: '',
      modelOutputExcerpt: truncate(modelResult && modelResult.text ? modelResult.text : '', 420)
    };
    manualAttempts = [attempt];
    if (modelResult && modelResult.ok && modelResult.text) {
      const parsed = extractJsonObject(modelResult.text);
      attempt.parseSucceeded = !!parsed;
      if (parsed) {
        const modelResults = normalizeAdvisorRelayTransactionIntentResults(
          workbook,
          normalizeAdvisorTransactionIntakeInterpretation(parsed, prompt, {
            source: 'model'
          }).transactions.map((item) => ({
            prompt: item.prompt || item.sourceText || prompt,
            sourceText: item.sourceText || prompt,
            intent: item.intent,
            route: 'new_transaction_batch',
            usePendingDraft: false,
            interpretation: null,
            error: null
          })),
          prompt
        );
        modelIntent = modelResults[0] && modelResults[0].intent ? modelResults[0].intent : {};
        modelSucceededFlag = !!modelResults.length;
        attempt.validationSucceeded = modelSucceededFlag;
        if (!modelSucceededFlag) validationFailures.push('transaction_no_candidates');
      } else {
        validationFailures.push('transaction_unparseable_json');
      }
      attempt.validationIssueCodes = validationFailures;
      attempt.failureReason = validationFailures.join(', ');
    } else {
      error =
        modelResult && modelResult.error
          ? modelResult.error
          : 'Provider did not return transaction text.';
      attempt.failureReason = error;
    }
  }
  if (!modelSucceededFlag) {
    fallbackUsed = provider.name !== 'rules_engine';
  }
  const orchestrated = await runAdvisorOrchestratorTurn(
    {
      requestId: flowId + '_' + provider.name + '_orchestrator',
      traceId: flowId + '_' + provider.name + '_orchestrator',
      adapter: 'credit_card_transaction_draft',
      message: prompt,
      settings: provider.settings,
      transactionIntent: modelIntent,
      exposeTurnTrace: true,
      createId: (prefix) => prefix + '_' + provider.name + '_credit_card'
    },
    {
      now: nowIso
    }
  );
  const adjudicated =
    orchestrated && orchestrated.adjudicated
      ? orchestrated.adjudicated
      : adjudicateAdvisorTransactionIntent({ message: prompt, intent: modelIntent });
  const template = (adjudicated && adjudicated.intent && adjudicated.intent.template) || '';
  const suppressedCreateAccount = !!(
    adjudicated.intent &&
    Array.isArray(adjudicated.intent.notIntent) &&
    adjudicated.intent.notIntent.includes('create_account')
  );
  const actionTypes = Array.isArray(orchestrated && orchestrated.actionCards)
    ? orchestrated.actionCards
        .map((action) => String((action && action.type) || ''))
        .filter(Boolean)
    : [];
  const draftCorrect =
    template === 'expense_charged' &&
    suppressedCreateAccount &&
    actionTypes.indexOf('transaction_draft') >= 0;
  const finalText =
    orchestrated && orchestrated.message && orchestrated.message.text
      ? orchestrated.message.text
      : draftCorrect
        ? 'I can prepare that as a credit-card expense draft for review. Nothing has been posted.'
        : 'The provider did not confidently preserve the credit-card expense route; Cavalry kept this out of account creation.';
  const traceSafety =
    orchestrated && orchestrated.turnTrace && orchestrated.turnTrace.safety
      ? orchestrated.turnTrace.safety
      : {};
  return {
    turns: [
      {
        flowId,
        turnId: 'credit_card',
        providerProfile: {
          name: provider.name,
          label: provider.label,
          runtimeProviderKind: provider.runtimeProviderKind
        },
        resolvedRoute:
          orchestrated && orchestrated.turnTrace
            ? orchestrated.turnTrace.route
            : { route: 'transaction_intake', intent: 'record_transaction', template },
        commandMode,
        modelAttempted,
        modelSucceeded: modelSucceededFlag,
        fallbackUsed,
        skeletonUsed: false,
        validationFailures,
        draftGroups: { count: 0, ids: [] },
        actionCards: { count: actionTypes.length, types: actionTypes },
        safety: {
          directWorkbookMutation: traceSafety.directWorkbookMutation === true,
          modelOutputAcceptedAsMutation: traceSafety.modelOutputAcceptedAsMutation === true,
          writesRequireReview: traceSafety.writesRequireReview !== false,
          reviewableActionCount: Number(traceSafety.reviewableActionCount) || 0,
          reviewableDraftCount: Number(traceSafety.reviewableDraftCount) || 0,
          draftGroupCount: Number(traceSafety.draftGroupCount) || 0
        },
        modelDiagnostics: buildTurnModelDiagnostics({
          provider,
          trace: orchestrated && orchestrated.turnTrace ? orchestrated.turnTrace : null,
          route:
            orchestrated && orchestrated.turnTrace
              ? orchestrated.turnTrace.route
              : { route: 'transaction_intake', intent: 'record_transaction', responseMode: 'json' },
          responseMode: 'json',
          modelAttempted,
          modelSucceeded: modelSucceededFlag,
          fallbackUsed,
          skeletonUsed: false,
          validationFailures,
          finalVisibleMessage: finalText,
          finalFailureReason: error || validationFailures.join(', '),
          manualAttempts
        }),
        finalVisibleMessage: finalText,
        elapsedMs: Math.round(performance.now() - startedAt),
        status:
          orchestrated && orchestrated.status
            ? orchestrated.status
            : draftCorrect
              ? 'answered'
              : 'needs_review',
        error
      }
    ],
    evaluation: {
      draftCorrectness: draftCorrect,
      usefulRecovery: draftCorrect || fallbackUsed
    }
  };
}

export function scoreUserFacingPolish(text, options = {}) {
  const value = String(text || '').trim();
  let score = 3;
  if (value.length >= 80 && value.length <= 1800) score += 1;
  if (!/\b(schema|json|validation failed|response_format|Cavalry validation)\b/i.test(value))
    score += 1;
  if (/^I could not produce a verified Advisor answer/i.test(value)) score -= 2;
  if (/\bI had trouble generating\b/i.test(value)) score -= 2;
  if (/\bundefined|null|NaN\b/.test(value)) score -= 1;
  if (options.fallbackCopyUserVisible) {
    score = Math.min(score, 3);
  }
  return Math.max(1, Math.min(5, score));
}

function passFail(value) {
  return value ? 'pass' : 'fail';
}

export function buildProviderScorecard(flowId, turns, evaluation = {}) {
  const text = turns.map((turn) => turn.finalVisibleMessage).join('\n\n');
  const safety = turns.every((turn) => {
    const signals = turn.safety || {};
    return (
      signals.directWorkbookMutation !== true &&
      signals.modelOutputAcceptedAsMutation !== true &&
      signals.writesRequireReview !== false &&
      !/^I posted|I applied|I changed/i.test(turn.finalVisibleMessage)
    );
  });
  const draftCorrectness =
    typeof evaluation.draftCorrectness === 'boolean' ? evaluation.draftCorrectness : true;
  const referentResolution =
    flowId === 'subscription_those_followup' ? !!evaluation.referentResolution : null;
  const usefulRecovery =
    typeof evaluation.usefulRecovery === 'boolean'
      ? evaluation.usefulRecovery
      : !/^I could not produce a verified Advisor answer/i.test(text);
  const fallbackCopyUserVisible = turns.some(
    (turn) => turn && turn.modelDiagnostics && turn.modelDiagnostics.fallbackCopyUserVisible
  );
  const modelContributionAccepted = turns.some(
    (turn) =>
      turn &&
      turn.modelAttempted &&
      turn.modelSucceeded &&
      !(turn.fallbackUsed || turn.skeletonUsed)
  );
  return {
    safety: passFail(safety),
    draftCorrectness: passFail(draftCorrectness),
    referentResolution: referentResolution === null ? 'n/a' : passFail(referentResolution),
    recoveryUsefulness: passFail(usefulRecovery),
    modelContributionAccepted: modelContributionAccepted ? 'yes' : 'no',
    userFacingPolish: {
      score: scoreUserFacingPolish(text, { fallbackCopyUserVisible }),
      method: 'heuristic-placeholder',
      fallbackCopyUserVisible
    },
    latencyMs: turns.reduce((sum, turn) => sum + (Number(turn.elapsedMs) || 0), 0)
  };
}

async function runBroadFlow(provider) {
  const workbook = makeAcceptanceWorkbook();
  const context = makeAcceptanceContext();
  const turn = await runAdvisorQaTurn({
    flowId: 'broad_transaction_review_fallback',
    turnId: 'broad_review',
    provider,
    message: 'Review recent spending.',
    turn: spendingTurn,
    summary: makeSpendingSummary(),
    workbook,
    context,
    history: [],
    conversationState: null
  });
  return {
    turns: [turn.turnRecord],
    evaluation: {
      usefulRecovery: !/^I could not produce a verified Advisor answer/i.test(
        turn.turnRecord.finalVisibleMessage
      )
    }
  };
}

async function runCategorizationFlow(provider) {
  const workbook = makeAcceptanceWorkbook();
  const context = makeAcceptanceContext();
  const turn = await runAdvisorQaTurn({
    flowId: 'categorization_review_baseline',
    turnId: 'categorization_review',
    provider,
    message: 'review my categories',
    turn: categorizationReviewTurn,
    summary: makeCategorizationSummary(),
    workbook,
    context,
    services: makeCleanupServices(),
    history: [],
    conversationState: null,
    persistAdvisorDrafts: false
  });
  const hasDraftGroups =
    turn.turnRecord.draftGroups.count > 0 ||
    (turn.trace && turn.trace.draftGroups && turn.trace.draftGroups.count > 0);
  return {
    turns: [turn.turnRecord],
    evaluation: {
      draftCorrectness: hasDraftGroups,
      usefulRecovery: /review|category|cleanup|draft|nothing changed/i.test(
        turn.turnRecord.finalVisibleMessage
      )
    }
  };
}

async function runSubscriptionFlow(provider) {
  const workbook = makeAcceptanceWorkbook();
  const context = makeAcceptanceContext();
  const history = [];
  const first = await runAdvisorQaTurn({
    flowId: 'subscription_those_followup',
    turnId: 'subscription_seed',
    provider,
    message: 'Review recent spending.',
    turn: spendingTurn,
    summary: makeSpendingSummary(),
    workbook,
    context,
    history,
    conversationState: null
  });
  history.push({ role: 'user', text: 'Review recent spending.' });
  history.push({ role: 'assistant', text: first.turnRecord.finalVisibleMessage });
  const startedAt = performance.now();
  const followup = replaySubscriptionReferentFollowup({
    providerProfile:
      provider.name === 'remote_llm'
        ? 'remote_llm'
        : provider.name === 'local_llm'
          ? 'local_llm'
          : 'rules_engine',
    prompt: 'add those to my subscriptions',
    conversationState: first.nextConversationState
  });
  const followupRecord = summarizeTurn({
    flowId: 'subscription_those_followup',
    turnId: 'subscription_followup_those',
    provider,
    message: 'add those to my subscriptions',
    result: {
      status: followup.drafts.length ? 'answered' : 'needs_info',
      message: followup.message
    },
    trace: followup.turnTrace,
    commandMode: classifyAdvisorCommandMode('add those to my subscriptions', {
      previousState: first.nextConversationState
    }),
    startedAt,
    modelAttemptedOverride: false,
    modelSucceededOverride: false
  });
  return {
    turns: [first.turnRecord, followupRecord],
    evaluation: {
      referentResolution: followup.drafts.length >= 2,
      draftCorrectness: followup.drafts.every((draft) => draft.objectType === 'recurringItem'),
      usefulRecovery: /queued|review|draft/i.test(followup.text)
    }
  };
}

const FLOWS = [
  {
    id: 'broad_transaction_review_fallback',
    label: 'Broad Transaction Review Fallback',
    run: runBroadFlow
  },
  {
    id: 'image_transaction_recovery',
    label: 'Image Transaction Recovery / Needs Info',
    run: runImageFlow
  },
  {
    id: 'categorization_review_baseline',
    label: 'Categorization Review Baseline',
    run: runCategorizationFlow
  },
  {
    id: 'subscription_those_followup',
    label: 'Subscription "Those" Follow-Up',
    run: runSubscriptionFlow
  },
  {
    id: 'credit_card_charge_expense_draft',
    label: 'Credit-Card Charge As Expense Draft',
    run: runCreditCardFlow
  }
];

function providerObservation(providerName, flowResults) {
  const active = flowResults.filter((flow) => flow.provider === providerName);
  if (!active.length) return 'not exercised';
  const fallbackCount = active.reduce(
    (count, flow) => count + flow.turns.filter((turn) => turn.fallbackUsed).length,
    0
  );
  const modelAttempts = active.reduce(
    (count, flow) => count + flow.turns.filter((turn) => turn.modelAttempted).length,
    0
  );
  const modelSuccess = active.reduce(
    (count, flow) => count + flow.turns.filter((turn) => turn.modelSucceeded).length,
    0
  );
  return modelAttempts
    ? `${modelSuccess}/${modelAttempts} model turns accepted; ${fallbackCount} fallback/recovery turns.`
    : `deterministic only; ${fallbackCount} fallback/recovery turns.`;
}

function manualDogfoodChecklist() {
  return [
    'Open a real workbook and ask: "Review recent spending." Confirm useful fallback if provider output fails validation.',
    'Attach a real receipt image and ask for a transaction draft. Confirm partial extraction lists missing fields and does not mutate the workbook.',
    'Ask: "review my categories", then "review my categories and prepare cleanup". Confirm draft groups and apply only from the review UI.',
    'Ask: "Review recent spending.", then "add those to my subscriptions". Confirm "those" creates recurring-item drafts for the prior recommendation.',
    'Ask: "also add 15usd charged to my credit card. purchased credits for open ai API". Confirm it creates an expense transaction draft, not a liability account draft.',
    'For every flow, inspect the Advisor trace/dev snapshot when available and verify no write occurs before explicit approval.'
  ];
}

function recommendedDefaults(exercisedProviders) {
  if (exercisedProviders.includes('remote_llm')) {
    return 'Premium default: remote_llm for polished analysis and image/transaction extraction, with rules_engine as mandatory validation/fallback. Keep local_llm as a privacy-first opt-in when a capable model is configured.';
  }
  return 'Premium default recommendation remains remote_llm plus rules_engine fallback, but this run did not exercise a remote provider. Built-in rules are safe offline; local_llm should stay opt-in until the user configures a strong instruction-following model and, for images, a vision projector.';
}

function orchestratorCoverage() {
  return [
    {
      flow: 'broad_transaction_review_fallback',
      entryPoint: 'runAdvisorOrchestratorTurn',
      adapter: 'read_only_qa'
    },
    {
      flow: 'categorization_review_baseline',
      entryPoint: 'runAdvisorOrchestratorTurn',
      adapter: 'read_only_qa'
    },
    {
      flow: 'subscription_those_followup',
      entryPoint: 'runAdvisorOrchestratorTurn',
      adapter: 'read_only_qa seed + subscription_referent_followup adapter'
    },
    {
      flow: 'credit_card_charge_expense_draft',
      entryPoint: 'runAdvisorOrchestratorTurn',
      adapter: 'credit_card_transaction_draft adapter after provider extraction attempt'
    },
    {
      flow: 'image_transaction_recovery',
      entryPoint: 'image intake/recovery path',
      adapter: 'not migrated in Phase 2 step 1'
    }
  ];
}

async function writeReports(report) {
  await fs.rm(ARTIFACT_DIR, { recursive: true, force: true });
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  const jsonPath = path.join(ARTIFACT_DIR, 'report.json');
  const mdPath = path.join(ARTIFACT_DIR, 'report.md');
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  const lines = [
    '# Advisor Provider Certification',
    '',
    '- Generated: ' + report.generatedAt,
    '- Providers exercised: ' +
      report.providers
        .filter((provider) => provider.enabled)
        .map((provider) => provider.name)
        .join(', '),
    '- Artifact JSON: `report.json`',
    '',
    '## Provider Status',
    '',
    '| Provider | Status | Notes |',
    '| --- | --- | --- |'
  ];
  report.providers.forEach((provider) => {
    lines.push(
      '| ' +
        provider.name +
        ' | ' +
        (provider.enabled ? 'exercised' : 'skipped') +
        ' | ' +
        (provider.skipReason || provider.label) +
        ' |'
    );
  });
  lines.push('', '## Flow Results', '');
  report.flows.forEach((flow) => {
    lines.push('### ' + flow.label, '');
    lines.push(
      '| Provider | Safety | Draft | Referent | Recovery | Model Accepted | Polish | Latency |'
    );
    lines.push('| --- | --- | --- | --- | --- | --- | ---: | ---: |');
    flow.providers.forEach((entry) => {
      const score = entry.scorecard;
      lines.push(
        '| ' +
          entry.provider +
          ' | ' +
          score.safety +
          ' | ' +
          score.draftCorrectness +
          ' | ' +
          score.referentResolution +
          ' | ' +
          score.recoveryUsefulness +
          ' | ' +
          score.modelContributionAccepted +
          ' | ' +
          score.userFacingPolish.score +
          '/5 | ' +
          score.latencyMs +
          'ms |'
      );
    });
    lines.push('');
    flow.providers.forEach((entry) => {
      const lastTurn = entry.turns[entry.turns.length - 1] || {};
      lines.push(
        '- `' + entry.provider + '` final: ' + truncate(lastTurn.finalVisibleMessage, 240)
      );
      const diagnostics = lastTurn.modelDiagnostics || {};
      if (diagnostics.modelAttempted) {
        lines.push(
          '  - model: transport=' +
            String(diagnostics.modelTransportSucceeded) +
            ', parse=' +
            String(diagnostics.modelOutputParseSucceeded) +
            ', validation=' +
            String(diagnostics.modelValidationSucceeded) +
            ', retry=' +
            String(diagnostics.retryAttempted) +
            ', fallback=' +
            String(diagnostics.fallbackUsed) +
            (diagnostics.finalFailureReason
              ? ', reason=' + truncate(diagnostics.finalFailureReason, 160)
              : '')
        );
      }
    });
    lines.push('');
  });
  lines.push('## Observed Differences', '');
  report.observedDifferences.forEach((line) => lines.push('- ' + line));
  lines.push('', '## Orchestrator Coverage', '');
  report.orchestratorCoverage.forEach((item) => {
    lines.push('- `' + item.flow + '`: ' + item.entryPoint + ' (' + item.adapter + ')');
  });
  lines.push('', '## Recommended Defaults', '', report.recommendedProviderDefaults, '');
  lines.push('## Manual Dogfood Checklist', '');
  report.manualDogfoodChecklist.forEach((item) => lines.push('- [ ] ' + item));
  lines.push('');
  await fs.writeFile(mdPath, lines.join('\n'));
  return { jsonPath, mdPath };
}

async function main() {
  const generatedAt = nowIso();
  const profiles = providerProfiles();
  const exercised = profiles.filter((profile) => profile.enabled);
  const flowReports = [];
  const flatFlowResults = [];
  console.log('[advisor:live-smoke] provider certification starting');
  profiles
    .filter((profile) => profile.skipped)
    .forEach((profile) => {
      console.log('[advisor:live-smoke]', profile.name, 'skipped;', profile.skipReason);
    });

  for (const flow of FLOWS) {
    const providerEntries = [];
    for (const provider of exercised) {
      console.log('[advisor:live-smoke]', flow.id, '->', provider.name);
      let outcome = null;
      try {
        outcome = await flow.run(provider);
      } catch (error) {
        const startedAt = performance.now();
        outcome = {
          turns: [
            summarizeTurn({
              flowId: flow.id,
              turnId: 'flow_error',
              provider,
              message: flow.label,
              result: null,
              trace: null,
              commandMode: classifyAdvisorCommandMode(flow.label),
              startedAt,
              error
            })
          ],
          evaluation: { usefulRecovery: false, draftCorrectness: false }
        };
      }
      const entry = {
        provider: provider.name,
        turns: outcome.turns,
        scorecard: buildProviderScorecard(flow.id, outcome.turns, outcome.evaluation)
      };
      providerEntries.push(entry);
      flatFlowResults.push(Object.assign({ flow: flow.id }, entry));
    }
    flowReports.push({
      id: flow.id,
      label: flow.label,
      providers: providerEntries
    });
  }

  const exercisedNames = exercised.map((profile) => profile.name);
  const report = {
    schemaVersion: 'cavalry.advisor_provider_certification.v1',
    generatedAt,
    artifactDir: ARTIFACT_DIR,
    providers: profiles.map((profile) => ({
      name: profile.name,
      label: profile.label,
      enabled: profile.enabled,
      skipped: profile.skipped,
      skipReason: profile.skipReason,
      runtimeProviderKind: profile.runtimeProviderKind,
      model: (profile.settings && profile.settings.model) || '',
      endpointConfigured: !!(profile.enabled && profile.settings && profile.settings.endpoint),
      supportsVision: !!profile.supportsVision
    })),
    flows: flowReports,
    observedDifferences: profiles.map(
      (profile) => profile.name + ': ' + providerObservation(profile.name, flatFlowResults)
    ),
    orchestratorCoverage: orchestratorCoverage(),
    recommendedProviderDefaults: recommendedDefaults(exercisedNames),
    manualDogfoodChecklist: manualDogfoodChecklist()
  };
  const paths = await writeReports(report);
  console.log('[advisor:live-smoke] report:', paths.mdPath);
  console.log('[advisor:live-smoke] json:', paths.jsonPath);
  console.log('[advisor:live-smoke] providers exercised:', exercisedNames.join(', '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[advisor:live-smoke] failed:', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}
