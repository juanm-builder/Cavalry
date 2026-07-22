import { advisorProvider } from '@cavalry/advisor';
import {
  buildAdvisorVoiceButtonViewModel,
  buildAdvisorVoiceStatusViewModel
} from '@cavalry/advisor/application/advisor/advisor-panel-view-model-service.js';
import { hydrateAdvisorWorkbook } from '@cavalry/advisor/application/advisor/advisor-workbook-hydration.js';
import { createLocalRulesAdvisorProvider } from '@cavalry/advisor/application/ai/local-rules-advisor-provider.js';
import {
  cloneWorkbook,
  commandError,
  commandOk
} from '@cavalry/finance-core/application/types/command-result.js';

export const ADVISOR_INTENTS = Object.freeze({
  PICK_ATTACHMENTS: 'advisor/attachments-pick',
  REMOVE_ATTACHMENT: 'advisor/attachment-remove',
  TOGGLE_VOICE: 'advisor/voice-toggle',
  EXPORT_THREAD: 'advisor/thread-export',
  OPEN_SETTINGS: 'advisor/settings-open',
  COPY_MESSAGE: 'advisor/message-copy',
  OPEN_SOURCE: 'advisor/source-open',
  CANCEL_REQUEST: 'advisor/request-cancel'
});

const DEFAULT_PROMPTS = Object.freeze([
  'Review recent spending',
  'Check budget pressure',
  'Find transactions to clean up',
  'Which bills should I review?'
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function plain(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return null;
  }
}

function makePorts(workbook, services = {}) {
  const counters = {};
  const timestamp =
    typeof services.now === 'function'
      ? asText(services.now())
      : asText(services.now) || '1970-01-01T00:00:00.000Z';
  return {
    now: () => timestamp,
    timestamp,
    today:
      typeof services.today === 'function'
        ? services.today()
        : asText(services.today) || `${Number(workbook?.year) || 1970}-01-01`,
    createId:
      typeof services.createId === 'function'
        ? services.createId
        : (prefix = 'id') => {
            counters[prefix] = (counters[prefix] || 0) + 1;
            return `${prefix}_${counters[prefix]}`;
          }
  };
}

function normalizeAttachment(attachment, index) {
  const source = asObject(attachment);
  return {
    id: asText(source.id) || `attachment_${index + 1}`,
    name: asText(source.name || source.fileName) || `Attachment ${index + 1}`,
    kind: asText(source.kind || source.type) || 'document',
    mimeType: asText(source.mimeType || source.mime_type),
    size: Math.max(0, Number(source.size || source.bytes) || 0),
    status: asText(source.status) || 'ready',
    previewUrl: asText(source.previewUrl || source.preview_url)
  };
}

function normalizeMessage(message, index) {
  const source = asObject(message);
  const format = source.format === 'rich' || source.richText ? 'rich' : 'plain';
  return {
    id: asText(source.id) || `message_${index + 1}`,
    role: source.role === 'user' ? 'user' : 'assistant',
    text: asText(source.text || source.content),
    format,
    richText: format === 'rich' ? asText(source.richText || source.text || source.content) : '',
    createdAt: asText(source.createdAt || source.created_at),
    references: asArray(source.references).map((reference, referenceIndex) => ({
      id: asText(reference?.id || reference?.token) || `reference_${referenceIndex + 1}`,
      label: asText(reference?.label || reference?.token) || 'Source',
      sourceRefs: asArray(reference?.source_refs || reference?.sourceRefs)
        .map(asText)
        .filter(Boolean)
    })),
    attachments: asArray(source.attachments).map(normalizeAttachment),
    actions: plain(asArray(source.actions)) || []
  };
}

function normalizeThread(thread, index) {
  const source = asObject(thread);
  const messages = asArray(source.messages).map(normalizeMessage);
  return {
    id: asText(source.id) || `thread_${index + 1}`,
    title: asText(source.title) || 'New chat',
    createdAt: asText(source.createdAt || source.created_at),
    updatedAt: asText(source.updatedAt || source.updated_at) || messages.at(-1)?.createdAt || '',
    rangeLabel: asText(source.rangeLabel || source.range_label),
    messages
  };
}

function collectSources(messages, modelSources) {
  const sources = [];
  const seen = new Set();
  function add(source) {
    const id = asText(source?.id || source?.sourceRef || source?.source_ref);
    if (!id || seen.has(id)) return;
    seen.add(id);
    sources.push({
      id,
      label: asText(source?.label || source?.title) || id,
      detail: asText(source?.detail || source?.description),
      kind: asText(source?.kind || source?.type) || 'workbook'
    });
  }
  asArray(modelSources).forEach(add);
  asArray(messages).forEach((message) => {
    asArray(message.references).forEach((reference) => {
      asArray(reference.sourceRefs).forEach((sourceRef) =>
        add({ id: sourceRef, label: reference.label })
      );
    });
  });
  return sources;
}

export function buildAdvisorFeatureModel(workbook, options = {}) {
  const inputModel = asObject(options.model);
  const sourceWorkbook = workbook
    ? hydrateAdvisorWorkbook(workbook, { createId: options.createId, now: options.now })
    : {
        settings: { activeAdvisorThreadId: asText(inputModel.activeThreadId) },
        advisorThreads: asArray(inputModel.threads)
      };
  const threads = asArray(sourceWorkbook.advisorThreads)
    .map(normalizeThread)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const requestedThreadId = asText(
    options.activeThreadId ||
      inputModel.activeThreadId ||
      sourceWorkbook.settings?.activeAdvisorThreadId
  );
  const activeThread =
    threads.find((thread) => thread.id === requestedThreadId) || threads[0] || null;
  const messages = activeThread?.messages || asArray(inputModel.messages).map(normalizeMessage);
  const sources = collectSources(messages, inputModel.sources);
  const voice = asObject(inputModel.voice);
  return {
    threads,
    activeThreadId: activeThread?.id || '',
    activeThread,
    messages,
    chatTitle: activeThread?.title || inputModel.chatTitle || 'New chat',
    sources,
    selectedSourceId: sources.some((source) => source.id === options.selectedSourceId)
      ? options.selectedSourceId
      : sources[0]?.id || '',
    composer: asText(options.composer ?? inputModel.composer ?? inputModel.chatDraft),
    attachments: asArray(options.attachments ?? inputModel.attachments).map(normalizeAttachment),
    pending: options.pending === true,
    error: asText(options.error),
    threadOpen: options.threadOpen ?? inputModel.threadOpen ?? true,
    sourceOpen: options.sourceOpen ?? inputModel.sourceOpen ?? sources.length > 0,
    questionPresets: asArray(inputModel.questionPresets).length
      ? inputModel.questionPresets.map(asText).filter(Boolean)
      : DEFAULT_PROMPTS.slice(),
    attachmentAccept:
      asText(inputModel.attachmentAccept) ||
      '.png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.txt,.csv,.xls,.xlsx',
    attachmentLimit: Math.max(1, Number(inputModel.attachmentLimit) || 6),
    voiceButton: buildAdvisorVoiceButtonViewModel({
      status: voice.status,
      availability: voice.availability || {
        available: false,
        message: 'Voice input uses the app voice adapter.'
      }
    }),
    voiceStatus: buildAdvisorVoiceStatusViewModel({
      status: voice.status,
      error: voice.error,
      copy: voice.copy,
      timerCopy: voice.timerCopy,
      permission: voice.permission,
      canOpenMicrophoneSettings: voice.canOpenMicrophoneSettings
    })
  };
}

function getThreadTitle(prompt) {
  const text = asText(prompt).replace(/\s+/g, ' ');
  return text.length > 48 ? `${text.slice(0, 45).trim()}...` : text || 'New chat';
}

function copyDraftCollections(target, providerWorkbook) {
  [
    'externalDraftGroups',
    'externalDraftAuditEvents',
    'externalDraftIdempotencyRecords',
    'aiDrafts',
    'advisorDraftGroups'
  ].forEach((key) => {
    if (Array.isArray(providerWorkbook?.[key])) target[key] = plain(providerWorkbook[key]) || [];
  });
}

async function invokeProvider(provider, request) {
  return advisorProvider.runAdvisorProvider(provider, request);
}

export async function runAdvisorTurn(workbook, input = {}, services = {}) {
  const question = asText(input.question);
  if (!question) {
    return commandError(workbook, {
      code: 'advisor.question_required',
      message: 'Ask a question before sending.'
    });
  }
  if (!workbook || typeof workbook !== 'object') {
    return commandError(workbook, {
      code: 'advisor.workbook_required',
      message: 'Open a workbook before asking Advisor.'
    });
  }

  const ports = makePorts(workbook, services);
  const nextWorkbook = hydrateAdvisorWorkbook(cloneWorkbook(workbook), {
    createId: ports.createId,
    now: ports.now
  });
  nextWorkbook.settings = { ...(nextWorkbook.settings || {}) };
  nextWorkbook.advisorThreads = asArray(nextWorkbook.advisorThreads);
  let thread = nextWorkbook.advisorThreads.find((item) => item.id === input.threadId) || null;
  if (!thread) {
    thread = {
      id: ports.createId('advisor_thread'),
      title: getThreadTitle(question),
      createdAt: ports.timestamp,
      updatedAt: ports.timestamp,
      rangeLabel: asText(input.rangeLabel),
      messages: [],
      conversationState: null
    };
    nextWorkbook.advisorThreads.push(thread);
  }
  nextWorkbook.settings.activeAdvisorThreadId = thread.id;
  const attachments = asArray(input.attachments).map(normalizeAttachment);
  const userMessage = {
    id: ports.createId('advisor_message'),
    role: 'user',
    text: question,
    format: 'plain',
    createdAt: ports.timestamp,
    references: [],
    actions: [],
    attachments
  };
  thread.messages = asArray(thread.messages).concat(userMessage);
  thread.updatedAt = ports.timestamp;

  const explicitSettings = input.settings || services.settings;
  const settings = explicitSettings || {
    enabled: true,
    provider: 'local_rules',
    allowDraftCreation: false
  };
  const builtIn = createLocalRulesAdvisorProvider({ today: ports.today });
  const requestedProvider = input.provider || services.provider || builtIn;
  let providerResult;
  let usedFallback = false;
  const warnings = [];

  async function run(provider) {
    const providerWorkbook = cloneWorkbook(nextWorkbook);
    const result = await invokeProvider(provider, {
      prompt: question,
      workbook: providerWorkbook,
      settings,
      services: { ...services, createId: ports.createId, today: ports.today, now: ports.now },
      attachments
    });
    if (result?.status === 'draft_prepared' || result?.draftGroup) {
      copyDraftCollections(nextWorkbook, providerWorkbook);
    }
    return result;
  }

  try {
    providerResult = await run(requestedProvider);
    if (
      providerResult?.ok === false &&
      requestedProvider !== builtIn &&
      settings.enabled !== false
    ) {
      usedFallback = true;
      providerResult = await run(builtIn);
    }
  } catch (error) {
    if (requestedProvider !== builtIn && settings.enabled !== false) {
      usedFallback = true;
      try {
        providerResult = await run(builtIn);
      } catch (_fallbackError) {
        providerResult = null;
      }
    }
    if (!providerResult) {
      warnings.push({
        code: 'advisor.provider_failed',
        message: asText(error?.message) || 'The selected Advisor provider failed.'
      });
    }
  }

  if (usedFallback) {
    warnings.push({
      code: 'advisor.provider_fallback',
      message: 'The selected provider failed, so Cavalry used its safe built-in Advisor.'
    });
  }
  const providerMessage = asText(providerResult?.message);
  const assistantText =
    providerMessage ||
    'Advisor could not complete that request safely. Your workbook was not changed.';
  const sourceRefs = asArray(providerResult?.sourceRefs || providerResult?.source_refs)
    .map(asText)
    .filter(Boolean);
  const assistantMessage = {
    id: ports.createId('advisor_message'),
    role: 'assistant',
    text: assistantText,
    format: providerResult?.format === 'rich' || providerResult?.richText ? 'rich' : 'plain',
    richText: asText(providerResult?.richText),
    createdAt: ports.timestamp,
    references: sourceRefs.length
      ? [{ id: ports.createId('advisor_reference'), label: 'Workbook sources', sourceRefs }]
      : [],
    actions: plain(asArray(providerResult?.actions)) || [],
    attachments: []
  };
  thread.messages.push(assistantMessage);
  thread.updatedAt = ports.timestamp;
  const intents = asArray(providerResult?.actions).map((action) => ({
    type: 'advisor/provider-action',
    payload: plain(action) || {}
  }));
  return commandOk(nextWorkbook, {
    events: [
      {
        type: providerResult ? 'advisor.turn.completed' : 'advisor.turn.failed',
        threadId: thread.id,
        messageId: assistantMessage.id,
        providerStatus: providerResult?.status || 'failed'
      }
    ],
    warnings,
    threadId: thread.id,
    assistantMessage,
    intents
  });
}

export function deleteAdvisorThread(workbook, threadId) {
  if (!workbook) {
    return commandError(workbook, {
      code: 'advisor.workbook_required',
      message: 'Open a workbook first.'
    });
  }
  const nextWorkbook = cloneWorkbook(workbook);
  const before = asArray(nextWorkbook.advisorThreads).length;
  nextWorkbook.advisorThreads = asArray(nextWorkbook.advisorThreads).filter(
    (thread) => thread?.id !== threadId
  );
  if (nextWorkbook.advisorThreads.length === before) {
    return commandError(workbook, {
      code: 'advisor.thread_not_found',
      message: 'Advisor thread was not found.'
    });
  }
  nextWorkbook.settings = { ...(nextWorkbook.settings || {}) };
  nextWorkbook.settings.activeAdvisorThreadId = nextWorkbook.advisorThreads[0]?.id || '';
  return commandOk(nextWorkbook, {
    events: [{ type: 'advisor.thread.deleted', threadId }]
  });
}
