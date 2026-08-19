import { normalizeCavalryAssistantReferences } from './cavalry-assistant-references.js';

const STORAGE_PREFIX = 'cavalry.assistant.conversations.v1.';
const STORAGE_VERSION = 2;
const ACTIVITY_STORAGE_SUFFIX = '.activity.v1';
const TITLE_LIMIT = 48;
const MAX_STORED_CONVERSATIONS = 24;
const MAX_STORED_MESSAGES_PER_CONVERSATION = 160;
const FALLBACK_STORED_CONVERSATIONS = 8;
const FALLBACK_STORED_MESSAGES_PER_CONVERSATION = 80;

export const CAVALRY_ASSISTANT_CONVERSATIONS_EVENT = 'cavalry-assistant-conversations-changed';

function notifyConversationsChanged(scopeKey, hasUserMessage) {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      const detail = { scopeKey: asText(scopeKey), hasUserMessage: hasUserMessage === true };
      if (typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent(CAVALRY_ASSISTANT_CONVERSATIONS_EVENT, { detail }));
      } else {
        const event = new Event(CAVALRY_ASSISTANT_CONVERSATIONS_EVENT);
        event.detail = detail;
        window.dispatchEvent(event);
      }
    }
  } catch (_error) {
    // Listeners are an enhancement; a blocked event must never break saving.
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function plain(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return fallback;
  }
}

function encodeScope(value) {
  return encodeURIComponent(asText(value) || 'workbook');
}

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_error) {
    return null;
  }
}

function normalizeAttachment(attachment, index, options = {}) {
  const source = asObject(attachment);
  const dataUrl = asText(source.dataUrl);
  const includeImageData = options.includeImageData !== false;
  const hasImageData = dataUrl.startsWith('data:image/');
  return {
    ...plain(source, {}),
    id: asText(source.id) || `assistant_attachment_${index + 1}`,
    name: asText(source.name || source.filename) || `Image ${index + 1}`,
    kind: asText(source.kind) || 'image',
    dataUrl: includeImageData && hasImageData ? dataUrl : '',
    ...(hasImageData && !includeImageData ? { storageUnavailable: true } : {})
  };
}

function normalizeMessage(message, index, options = {}) {
  const source = asObject(message);
  const role = source.role === 'user' ? 'user' : 'assistant';
  return {
    ...plain(source, {}),
    id: asText(source.id) || `assistant_message_${index + 1}`,
    role,
    text: asText(source.text || source.content),
    createdAt: asText(source.createdAt || source.created_at),
    attachments: asArray(source.attachments).map((attachment, attachmentIndex) =>
      normalizeAttachment(attachment, attachmentIndex, options)
    ),
    activities: plain(asArray(source.activities), []),
    references: normalizeCavalryAssistantReferences(source.references)
  };
}

export function getCavalryAssistantConversationTitle(messages = []) {
  const firstQuestion = asArray(messages).find(
    (message) => message?.role === 'user' && asText(message?.text || message?.content)
  );
  const text = asText(firstQuestion?.text || firstQuestion?.content).replace(/\s+/g, ' ');
  if (!text) return 'New chat';
  return text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT - 1).trimEnd()}…` : text;
}

function normalizeConversation(conversation, index, options = {}) {
  const source = asObject(conversation);
  const messages = asArray(source.messages).map((message, messageIndex) =>
    normalizeMessage(message, messageIndex, options)
  );
  const createdAt = asText(source.createdAt || source.created_at || messages[0]?.createdAt);
  const updatedAt = asText(
    source.updatedAt || source.updated_at || messages.at(-1)?.createdAt || createdAt
  );
  return {
    id: asText(source.id) || `assistant_conversation_${index + 1}`,
    title: asText(source.title) || getCavalryAssistantConversationTitle(messages),
    createdAt,
    updatedAt,
    messages
  };
}

export function getCavalryAssistantConversationScope(workbook = {}) {
  const source = asObject(workbook);
  const workbookId = asText(source.id);
  if (workbookId) return `workbook-${encodeScope(workbookId)}`;
  return `workbook-${encodeScope(
    [source.name, source.year, source.createdAt || source.created_at].map(asText).join('|')
  )}`;
}

export function getCavalryAssistantConversationStorageKey(workbook = {}) {
  return `${STORAGE_PREFIX}${getCavalryAssistantConversationScope(workbook)}`;
}

export function getCavalryAssistantConversationActivityStorageKey(workbook = {}) {
  return `${getCavalryAssistantConversationStorageKey(workbook)}${ACTIVITY_STORAGE_SUFFIX}`;
}

export function createCavalryAssistantConversationState(workbook = {}) {
  return {
    scopeKey: getCavalryAssistantConversationStorageKey(workbook),
    activeConversationId: '',
    conversations: []
  };
}

function normalizeState(source, workbook) {
  const raw = asObject(source);
  const conversations = asArray(raw.conversations).map((conversation, index) =>
    normalizeConversation(conversation, index, { includeImageData: false })
  );
  const hasActiveConversation = Object.prototype.hasOwnProperty.call(raw, 'activeConversationId');
  const requestedActiveId = asText(raw.activeConversationId);
  const activeConversationId = conversations.some(
    (conversation) => conversation.id === requestedActiveId
  )
    ? requestedActiveId
    : hasActiveConversation
      ? ''
      : conversations[0]?.id || '';
  return {
    scopeKey: getCavalryAssistantConversationStorageKey(workbook),
    activeConversationId,
    conversations
  };
}

function legacyWorkbookState(workbook) {
  const source = asObject(workbook);
  const conversations = asArray(source.advisorThreads).map(normalizeConversation);
  if (!conversations.length) return null;
  const activeConversationId = asText(source.settings?.activeAdvisorThreadId);
  return {
    conversations,
    ...(activeConversationId ? { activeConversationId } : {})
  };
}

function mergeConversationStates(localState, legacyState) {
  if (!legacyState?.conversations?.length) return localState;
  const legacyById = new Map(
    legacyState.conversations.map((conversation) => [conversation.id, conversation])
  );
  const conversations = localState.conversations.map((localConversation) => {
    const legacyConversation = legacyById.get(localConversation.id);
    if (!legacyConversation) return localConversation;
    legacyById.delete(localConversation.id);
    const messageIds = new Set(localConversation.messages.map((message) => message.id));
    const messages = localConversation.messages.concat(
      legacyConversation.messages.filter((message) => !messageIds.has(message.id))
    );
    return {
      ...legacyConversation,
      ...localConversation,
      title:
        localConversation.title === 'New chat' ? legacyConversation.title : localConversation.title,
      createdAt: localConversation.createdAt || legacyConversation.createdAt,
      updatedAt: [localConversation.updatedAt, legacyConversation.updatedAt].sort().at(-1) || '',
      messages
    };
  });
  return {
    ...localState,
    conversations: conversations.concat([...legacyById.values()])
  };
}

export function loadCavalryAssistantConversationState(workbook = {}, options = {}) {
  const storage = options.storage || defaultStorage();
  const empty = createCavalryAssistantConversationState(workbook);
  const legacy = legacyWorkbookState(workbook);
  if (storage && typeof storage.getItem === 'function') {
    try {
      const serialized = storage.getItem(empty.scopeKey);
      if (serialized) {
        const localState = normalizeState(JSON.parse(serialized), workbook);
        const legacyState = legacy ? normalizeState(legacy, workbook) : null;
        return mergeConversationStates(localState, legacyState);
      }
    } catch (_error) {
      // A damaged or inaccessible local entry must not prevent the assistant from opening.
    }
  }
  return legacy ? normalizeState(legacy, workbook) : empty;
}

function stateHasUserMessage(state) {
  return asArray(state?.conversations).some((conversation) =>
    asArray(conversation.messages).some((message) => message?.role === 'user')
  );
}

function compactConversations(state, limits = {}) {
  const conversationLimit = limits.conversationLimit || MAX_STORED_CONVERSATIONS;
  const messageLimit = limits.messageLimit || MAX_STORED_MESSAGES_PER_CONVERSATION;
  const source = asArray(state?.conversations);
  const activeConversationId = asText(state?.activeConversationId);
  const newest = source
    .slice()
    .sort((left, right) => asText(right?.updatedAt).localeCompare(asText(left?.updatedAt)));
  const retained = newest.slice(0, conversationLimit);
  const active = source.find((conversation) => asText(conversation?.id) === activeConversationId);
  if (active && !retained.some((conversation) => conversation === active)) {
    retained[retained.length ? retained.length - 1 : 0] = active;
  }
  const retainedIds = new Set(retained.map((conversation) => asText(conversation?.id)));
  return source
    .filter((conversation) => retainedIds.has(asText(conversation?.id)))
    .map((conversation) => ({
      ...conversation,
      messages: asArray(conversation.messages)
        .slice(-messageLimit)
        .map((message) => ({
          ...message,
          references: normalizeCavalryAssistantReferences(message.references),
          attachments: asArray(message.attachments).map((attachment) => ({
            ...attachment,
            dataUrl: '',
            ...(attachment?.dataUrl ? { storageUnavailable: true } : {})
          }))
        }))
    }));
}

function stateForStorage(state, limits) {
  const conversations = compactConversations(state, limits);
  return {
    version: STORAGE_VERSION,
    activeConversationId: asText(state?.activeConversationId),
    conversations
  };
}

export function saveCavalryAssistantConversationState(state, options = {}) {
  const storage = options.storage || defaultStorage();
  if (!storage || typeof storage.setItem !== 'function' || !asText(state?.scopeKey)) {
    return { ok: false, reason: 'unavailable' };
  }
  const hasUserMessage = stateHasUserMessage(state);
  const activityKey = `${state.scopeKey}${ACTIVITY_STORAGE_SUFFIX}`;
  const sourceConversations = asArray(state?.conversations);
  const hasEmbeddedImageData = sourceConversations.some((conversation) =>
    asArray(conversation.messages).some((message) =>
      asArray(message.attachments).some((attachment) => Boolean(attachment?.dataUrl))
    )
  );
  const wasCompacted =
    sourceConversations.length > MAX_STORED_CONVERSATIONS ||
    sourceConversations.some(
      (conversation) => asArray(conversation.messages).length > MAX_STORED_MESSAGES_PER_CONVERSATION
    );
  try {
    storage.setItem(state.scopeKey, JSON.stringify(stateForStorage(state)));
    try {
      storage.setItem(activityKey, hasUserMessage ? '1' : '0');
    } catch (_error) {
      // Conversation persistence remains authoritative if the tiny activity hint is blocked.
    }
    notifyConversationsChanged(state.scopeKey, hasUserMessage);
    return { ok: true, degraded: hasEmbeddedImageData || wasCompacted };
  } catch (_error) {
    try {
      storage.setItem(
        state.scopeKey,
        JSON.stringify(
          stateForStorage(state, {
            conversationLimit: FALLBACK_STORED_CONVERSATIONS,
            messageLimit: FALLBACK_STORED_MESSAGES_PER_CONVERSATION
          })
        )
      );
      try {
        storage.setItem(activityKey, hasUserMessage ? '1' : '0');
      } catch (_activityError) {
        // See the primary persistence path above.
      }
      notifyConversationsChanged(state.scopeKey, hasUserMessage);
      return { ok: true, degraded: true };
    } catch (error) {
      return { ok: false, reason: 'write_failed', error: asText(error?.message) };
    }
  }
}

export function hasCavalryAssistantConversationActivity(workbook = {}, options = {}) {
  const legacyHasUserMessage = asArray(workbook?.advisorThreads).some((conversation) =>
    asArray(conversation?.messages).some((message) => message?.role === 'user')
  );
  if (legacyHasUserMessage) return true;
  const storage = options.storage || defaultStorage();
  if (!storage || typeof storage.getItem !== 'function') return false;
  try {
    return storage.getItem(getCavalryAssistantConversationActivityStorageKey(workbook)) === '1';
  } catch (_error) {
    return false;
  }
}

function uniqueConversationId(conversations, createId) {
  const used = new Set(asArray(conversations).map((conversation) => conversation.id));
  const supplied = typeof createId === 'function' ? asText(createId('assistant_conversation')) : '';
  const base = supplied || `assistant_conversation_${Date.now().toString(36)}`;
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export function updateActiveCavalryAssistantConversation(state, updater, options = {}) {
  const current = asObject(state);
  const conversations = asArray(current.conversations);
  const now =
    typeof options.now === 'function'
      ? asText(options.now())
      : asText(options.now) || new Date().toISOString();
  let activeConversationId = asText(current.activeConversationId);
  let active = conversations.find((conversation) => conversation.id === activeConversationId);
  const currentMessages = asArray(active?.messages);
  const updatedMessages = asArray(
    typeof updater === 'function' ? updater(currentMessages) : updater
  );
  const nextMessages = updatedMessages.map((message, index) =>
    message === currentMessages[index] ? message : normalizeMessage(message, index)
  );

  if (!active && !nextMessages.length) return current;
  if (!active) {
    activeConversationId = uniqueConversationId(conversations, options.createId);
    active = {
      id: activeConversationId,
      title: 'New chat',
      createdAt: asText(nextMessages[0]?.createdAt) || now,
      updatedAt: now,
      messages: []
    };
  }

  const updatedConversation = {
    ...active,
    title: getCavalryAssistantConversationTitle(nextMessages),
    updatedAt: asText(nextMessages.at(-1)?.createdAt) || now,
    messages: nextMessages
  };
  const nextConversations = conversations.some(
    (conversation) => conversation.id === activeConversationId
  )
    ? conversations.map((conversation) =>
        conversation.id === activeConversationId ? updatedConversation : conversation
      )
    : conversations.concat(updatedConversation);
  return {
    ...current,
    activeConversationId,
    conversations: nextConversations
  };
}

export function startNewCavalryAssistantConversation(state) {
  return { ...state, activeConversationId: '' };
}

export function selectCavalryAssistantConversation(state, conversationId) {
  const id = asText(conversationId);
  if (!asArray(state?.conversations).some((conversation) => conversation.id === id)) return state;
  return { ...state, activeConversationId: id };
}
