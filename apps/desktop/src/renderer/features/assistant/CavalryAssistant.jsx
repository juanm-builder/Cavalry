import React, { useEffect, useMemo, useRef, useState } from 'react';

import { getRouteById } from '../../app/routes.js';
import {
  COMPANION_IMAGE_ATTACHMENT_MAX_COUNT,
  processCompanionImageAttachments
} from './companion-image-attachments.js';
import { getCavalryAssistantToolDefinitions } from './cavalry-assistant-tools.js';
import {
  createCavalryAssistantConversationState,
  getCavalryAssistantConversationStorageKey,
  loadCavalryAssistantConversationState,
  saveCavalryAssistantConversationState,
  selectCavalryAssistantConversation,
  startNewCavalryAssistantConversation,
  updateActiveCavalryAssistantConversation
} from './cavalry-assistant-conversations.js';
import { runCavalryAssistantTurn } from './cavalry-assistant-runtime.js';
import { assistantVisibleText } from './cavalry-assistant-runtime-content.js';
import {
  cavalryAssistantActionReceiptMessage,
  isCavalryAssistantSuccessfulNoOpWriteReceipt
} from './cavalry-assistant-action-results.js';
import { buildCavalryAssistantWorkspaceSnapshot } from './cavalry-assistant-workspace-snapshot.js';
import {
  chainedPendingConfirmation,
  committedToolResults,
  confirmationReplayArguments,
  isConfirmationDecline,
  isConfirmationReply,
  pendingConfirmationFromResult,
  readableToolName,
  toolFailureMessage
} from './cavalry-assistant-confirmations.js';
import { CavalryAssistantPanel } from './CavalryAssistantPanel.jsx';
import { serializeConversationMarkdown } from './CavalryAssistantPresentation.jsx';
import { useCavalryAssistantPanelResize } from './useCavalryAssistantPanelResize.js';
import { useCompanionVoice } from './useCompanionVoice.js';

export { CavalryAssistantMark } from './CavalryAssistantMark.jsx';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function unexpectedFailureMessage(error, fallback) {
  return asText(error?.userMessage).slice(0, 600) || fallback;
}

function structuredFailureMessage(value, fallback) {
  const source = asObject(value);
  const raw = asText(source.userMessage || source.error);
  if (
    !raw ||
    /<(?:!doctype|html|head|body|script|style)\b/i.test(raw) ||
    /^\s*(?:HTTP\/\d|[\[{])/i.test(raw) ||
    /\r?\n\s*(?:at\b|stack(?:\s+trace)?\b|traceback\b)/i.test(raw)
  ) {
    return fallback;
  }
  return raw
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 600);
}

const UNVERIFIED_COMMIT_MESSAGE =
  'Cavalry received a committed action result without a verified durable receipt. Review the affected record before relying on it.';

function actionReceipts(toolResults) {
  return asArray(toolResults)
    .map((toolResult) => asObject(toolResult?.result).receipt)
    .filter((receipt) => receipt && typeof receipt === 'object');
}

function isDurablyVerifiedReceipt(receiptValue) {
  const receipt = asObject(receiptValue);
  return (
    asText(receipt.lifecycle) === 'completed' &&
    asText(receipt.commitStatus) === 'committed' &&
    asText(receipt.verificationStatus) === 'verified' &&
    asObject(receipt.persistence).durable === true
  );
}

function receiptSummary(receipts) {
  return asArray(receipts)
    .map((receipt) => {
      const deterministic = asText(cavalryAssistantActionReceiptMessage(receipt));
      if (isDurablyVerifiedReceipt(receipt)) {
        return deterministic || 'Cavalry verified that the change was durably saved.';
      }
      if (deterministic) return deterministic;
      if (asText(receipt?.commitStatus) === 'committed') return UNVERIFIED_COMMIT_MESSAGE;
      return 'Cavalry could not confirm that this action completed. Review the affected record before relying on it.';
    })
    .map(asText)
    .filter(Boolean)
    .join('\n\n');
}

function isWriteOutcomeReceipt(receiptValue) {
  const receipt = asObject(receiptValue);
  const commitStatus = asText(receipt.commitStatus);
  return (
    asText(receipt.access) === 'write' ||
    receipt.changed === true ||
    (commitStatus && commitStatus !== 'not_applicable')
  );
}

function providerPresentation(settings = {}) {
  if (settings.provider === 'custom') {
    return {
      label: settings.model || 'Local model',
      tone: 'good',
      icon: 'memory',
      connected: true
    };
  }
  if (settings.provider === 'openai') {
    const connected = settings.hasApiKey === true;
    return {
      label: connected ? settings.model || 'API model' : 'Add API key',
      tone: connected ? 'good' : 'warn',
      icon: 'cloud',
      connected
    };
  }
  return {
    label: 'Connect a model',
    tone: 'warn',
    icon: 'link_off',
    connected: false
  };
}

const ROUTE_PROMPTS = Object.freeze({
  dashboard: [
    'Where is my money going?',
    'What should I pay attention to?',
    'Show my financial position'
  ],
  ledger: [
    'Find my largest expenses',
    'Record a new transaction',
    'Check for duplicate transactions'
  ],
  budgets: [
    'How am I doing this month?',
    'Create or update a budget',
    'Which category is over plan?'
  ],
  accounts: ['Show my account balances', 'Create a new account', 'Which account changed most?'],
  bills: ['What bills are due next?', 'Add a subscription', 'Review my recurring costs'],
  categories: ['Show category spending', 'Create a category', 'Find categories I no longer use'],
  settings: ['Help me connect a model', 'Save my workbook', 'Check my workspace setup']
});
const EMPTY_MESSAGES = Object.freeze([]);

export function CavalryAssistant({
  activeRouteId,
  advisor,
  conversationStorage,
  createId,
  downloads,
  executeTool,
  isOpen,
  onClose,
  onOpen,
  onOpenReference,
  onOpenSettings,
  settings = {},
  today,
  workbook
}) {
  const fallbackIdSequenceRef = useRef(0);
  const makeId = (prefix) =>
    typeof createId === 'function'
      ? createId(prefix)
      : `${prefix}_${++fallbackIdSequenceRef.current}`;
  const now = () => new Date().toISOString();
  const conversationScopeKey = getCavalryAssistantConversationStorageKey(workbook);
  const [conversationState, setConversationState] = useState(() =>
    createCavalryAssistantConversationState(workbook)
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false);
  const [composer, setComposer] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [attachmentNotice, setAttachmentNotice] = useState('');
  const [processingImages, setProcessingImages] = useState(false);
  const [draggingImages, setDraggingImages] = useState(false);
  const [pending, setPending] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [pendingClarification, setPendingClarification] = useState(null);
  const [error, setError] = useState('');
  const [liveStatus, setLiveStatus] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const {
    applyPanelWidth,
    beginPanelResize,
    cancelPanelResize,
    endPanelResize,
    maxPanelWidth,
    movePanelResize,
    panelWidth,
    resizePanelWithKeyboard,
    resizingPanel
  } = useCavalryAssistantPanelResize(conversationStorage);
  const composerRef = useRef(null);
  const imageInputRef = useRef(null);
  const imagePreparationVersionRef = useRef(0);
  const assistantWasOpenRef = useRef(isOpen);
  const messageListRef = useRef(null);
  const requestIdRef = useRef('');
  const requestAbortRef = useRef(null);
  const requestVersionRef = useRef(0);
  const streamBufferRef = useRef({ requestId: '', rawText: '' });
  const conversationScopeRef = useRef(conversationScopeKey);
  const loadedConversationScopeRef = useRef('');
  const conversationStateRef = useRef(conversationState);
  const route = getRouteById(activeRouteId);
  const provider = providerPresentation(settings);
  const suggestions = ROUTE_PROMPTS[route.id] || ROUTE_PROMPTS.dashboard;
  const activeConversation = conversationState.conversations.find(
    (conversation) => conversation.id === conversationState.activeConversationId
  );
  const messages = activeConversation?.messages || EMPTY_MESSAGES;
  const conversations = useMemo(
    () =>
      conversationState.conversations
        .slice()
        .sort((left, right) => asText(right.updatedAt).localeCompare(asText(left.updatedAt))),
    [conversationState.conversations]
  );
  const setMessages = (updater) =>
    setConversationState((current) =>
      updateActiveCavalryAssistantConversation(current, updater, {
        createId: makeId,
        now
      })
    );
  const voice = useCompanionVoice({
    advisor,
    createId: makeId,
    disabled: pending || processingImages,
    disabledReason: pending
      ? 'Wait for the current Companion response before starting voice input.'
      : processingImages
        ? 'Wait for the selected images to finish processing.'
        : '',
    onTranscript: () => composerRef.current?.focus(),
    setComposer,
    settings
  });
  const cancelVoice = voice.cancel;
  const history = useMemo(
    () =>
      messages.map(({ role, text, attachments: messageAttachments }) => ({
        role,
        content: text,
        images: asArray(messageAttachments)
      })),
    [messages]
  );

  useEffect(() => {
    conversationStateRef.current = conversationState;
  }, [conversationState]);

  useEffect(() => {
    const scopeChanged = conversationScopeRef.current !== conversationScopeKey;
    if (!scopeChanged && (!isOpen || loadedConversationScopeRef.current === conversationScopeKey)) {
      return;
    }
    if (
      scopeChanged &&
      loadedConversationScopeRef.current === conversationStateRef.current.scopeKey
    ) {
      saveCavalryAssistantConversationState(conversationStateRef.current, {
        storage: conversationStorage
      });
    }
    conversationScopeRef.current = conversationScopeKey;
    imagePreparationVersionRef.current += 1;
    setProcessingImages(false);
    if (imageInputRef.current) imageInputRef.current.value = '';
    requestAbortRef.current?.abort();
    requestVersionRef.current += 1;
    loadedConversationScopeRef.current = isOpen ? conversationScopeKey : '';
    setConversationState(
      isOpen
        ? loadCavalryAssistantConversationState(workbook, { storage: conversationStorage })
        : createCavalryAssistantConversationState(workbook)
    );
    setHistoryOpen(false);
    setAssistantSettingsOpen(false);
    setComposer('');
    setAttachments([]);
    setAttachmentNotice('');
    setPending(false);
    setPendingConfirmation(null);
    setPendingClarification(null);
    setError('');
    setLiveStatus('');
    setStreamingText('');
    streamBufferRef.current = { requestId: '', rawText: '' };
  }, [conversationScopeKey, conversationStorage, isOpen, workbook]);

  useEffect(() => {
    if (loadedConversationScopeRef.current !== conversationState.scopeKey) return undefined;
    const persistenceTimer = window.setTimeout(() => {
      saveCavalryAssistantConversationState(conversationState, {
        storage: conversationStorage
      });
    }, 150);
    return () => window.clearTimeout(persistenceTimer);
  }, [conversationState, conversationStorage]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const focusTimer = window.setTimeout(() => composerRef.current?.focus(), 30);
    return () => window.clearTimeout(focusTimer);
  }, [isOpen]);

  useEffect(() => {
    if (assistantWasOpenRef.current && !isOpen) void cancelVoice();
    assistantWasOpenRef.current = isOpen;
  }, [cancelVoice, isOpen]);

  useEffect(() => {
    messageListRef.current?.scrollTo?.({
      top: messageListRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [assistantSettingsOpen, historyOpen, messages, pending, liveStatus]);

  useEffect(() => {
    if (!(advisor && typeof advisor.subscribe === 'function')) return undefined;
    return advisor.subscribe((status) => {
      const requestId = asText(status?.requestId);
      // A status without the exact active id is stale or belongs to another assistant request.
      if (!requestId || requestId !== requestIdRef.current) return;
      const phase = asText(status?.phase);
      if (phase === 'stream') {
        const delta = String(status?.delta ?? '');
        const current = streamBufferRef.current;
        const segment = Number(status?.segment) || 0;
        if (!delta && status?.reset === true) {
          streamBufferRef.current = { requestId, rawText: '', segment };
          setStreamingText('');
          return;
        }
        if (!delta) return;
        const rawText =
          current.requestId === requestId && current.segment === segment && status?.reset !== true
            ? `${current.rawText}${delta}`.slice(0, 64 * 1024)
            : delta.slice(0, 64 * 1024);
        streamBufferRef.current = { requestId, rawText, segment };
        setStreamingText(assistantVisibleText(rawText).slice(0, 8000));
        return;
      }
      // Each provider invocation starts a fresh ephemeral stream. Tool-call preambles and
      // partial failures never become transcript messages.
      if (phase === 'request') {
        streamBufferRef.current = { requestId, rawText: '' };
        setStreamingText('');
      }
      setLiveStatus(asText(status?.message));
    });
  }, [advisor]);

  useEffect(
    () => () => {
      requestAbortRef.current?.abort();
      imagePreparationVersionRef.current += 1;
      if (loadedConversationScopeRef.current === conversationStateRef.current.scopeKey) {
        saveCavalryAssistantConversationState(conversationStateRef.current, {
          storage: conversationStorage
        });
      }
    },
    [conversationStorage]
  );

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        if (isOpen) onClose?.();
        else onOpen?.();
      } else if (event.key === 'Escape' && isOpen) {
        if (assistantSettingsOpen) setAssistantSettingsOpen(false);
        else onClose?.();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [assistantSettingsOpen, isOpen, onClose, onOpen]);

  async function addImageFiles(files) {
    if (processingImages || pending || !files?.length) return;
    const version = ++imagePreparationVersionRef.current;
    setProcessingImages(true);
    setAttachmentNotice('Preparing images…');
    setError('');
    try {
      const result = await processCompanionImageAttachments(files, {
        createId: makeId,
        existingAttachments: attachments
      });
      if (version !== imagePreparationVersionRef.current) return;
      if (result.attachments.length) {
        setAttachments((current) =>
          current.concat(result.attachments).slice(0, COMPANION_IMAGE_ATTACHMENT_MAX_COUNT)
        );
      }
      if (result.errors.length) {
        const extra = result.errors.length > 1 ? ` (+${result.errors.length - 1} more)` : '';
        setError(`${result.errors[0].message}${extra}`);
      }
      setAttachmentNotice(
        result.attachments.length
          ? `${result.attachments.length} ${result.attachments.length === 1 ? 'image' : 'images'} ready${result.warnings.length ? '; some originals could not be resized' : ''}.`
          : ''
      );
    } catch (imageError) {
      if (version !== imagePreparationVersionRef.current) return;
      setError(asText(imageError?.message) || 'The selected images could not be prepared.');
      setAttachmentNotice('');
    } finally {
      if (version === imagePreparationVersionRef.current) {
        setProcessingImages(false);
        if (imageInputRef.current) imageInputRef.current.value = '';
      }
    }
  }

  function removeImage(attachmentId) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    setAttachmentNotice('');
  }

  async function submit(questionOverride = '') {
    const question = asText(questionOverride || composer);
    const selectedAttachments = attachments.slice();
    if ((!question && !selectedAttachments.length) || pending || processingImages) return;
    if (!questionOverride && !selectedAttachments.length && pendingConfirmation) {
      if (isConfirmationReply(question)) {
        setComposer('');
        await confirmPendingAction();
        return;
      }
      if (isConfirmationDecline(question)) {
        setComposer('');
        setPendingConfirmation(null);
        setMessages((current) =>
          current.concat(
            {
              id: makeId('assistant_message'),
              role: 'user',
              text: question,
              createdAt: now()
            },
            {
              id: makeId('assistant_message'),
              role: 'assistant',
              text: 'Okay — I left it alone. Nothing changed.',
              createdAt: now()
            }
          )
        );
        return;
      }
    }
    setPendingClarification(null);
    const version = ++requestVersionRef.current;
    const requestId = makeId('assistant_request');
    const abortController = new AbortController();
    requestIdRef.current = requestId;
    requestAbortRef.current = abortController;
    streamBufferRef.current = { requestId, rawText: '' };
    const userMessage = {
      id: makeId('assistant_message'),
      role: 'user',
      text:
        question ||
        `Attached ${selectedAttachments.length} ${selectedAttachments.length === 1 ? 'image' : 'images'} for review.`,
      attachments: selectedAttachments,
      createdAt: now()
    };
    setMessages((current) => current.concat(userMessage));
    setComposer('');
    setAttachments([]);
    setAttachmentNotice('');
    setError('');
    setPending(true);
    setStreamingText('');
    setLiveStatus(provider.connected ? 'Thinking…' : 'A model connection is required.');
    try {
      const todayValue = typeof today === 'function' ? today() : today;
      const workspaceSnapshot = buildCavalryAssistantWorkspaceSnapshot(workbook, {
        today: todayValue
      });
      const result = await runCavalryAssistantTurn({
        activeRouteId: route.id,
        advisor,
        createId: makeId,
        executeTool,
        history,
        maxIterations: 16,
        pendingConfirmationMessage: pendingConfirmation ? pendingConfirmation.message : '',
        question,
        images: selectedAttachments,
        requestId,
        signal: abortController.signal,
        settings,
        today: todayValue,
        tools: getCavalryAssistantToolDefinitions({
          activeRouteId: route.id,
          advisor,
          question,
          settings,
          workbook
        }),
        workspaceSnapshot
      });
      if (version !== requestVersionRef.current) return;
      const confirmation = pendingConfirmationFromResult(result);
      const committedResults = committedToolResults(result);
      const receipts = actionReceipts(result?.toolResults);
      const writeOutcomeReceipts = receipts.filter(isWriteOutcomeReceipt);
      const hasWriteOutcome = committedResults.length > 0 || writeOutcomeReceipts.length > 0;
      const deterministicSummary = receiptSummary(writeOutcomeReceipts);
      const confirmationTerminalText = [
        deterministicSummary,
        'This action needs your confirmation. If you leave or reload this chat, ask Cavalry to prepare it again before confirming.'
      ]
        .map(asText)
        .filter(Boolean)
        .join('\n\n');
      const toolActivities = asArray(result?.activities).filter(
        (activity) => activity.type === 'tool'
      );
      streamBufferRef.current = { requestId, rawText: '' };
      setStreamingText('');
      if (confirmation) setPendingConfirmation(confirmation);
      if (!(result && result.ok)) {
        const failure = structuredFailureMessage(
          result,
          'Cavalry could not complete that request.'
        );
        if (!result?.cancelled && !confirmation) setError(failure);
        const terminalText = confirmation
          ? confirmationTerminalText
          : hasWriteOutcome
            ? [
                deterministicSummary || UNVERIFIED_COMMIT_MESSAGE,
                result?.cancelled
                  ? 'The request then stopped. No further actions were run.'
                  : 'The remaining reply could not be completed.'
              ].join('\n\n')
            : result?.cancelled
              ? 'Stopped. No completed change was confirmed.'
              : failure;
        setMessages((current) =>
          current.concat({
            id: makeId('assistant_message'),
            role: 'assistant',
            text: terminalText,
            ...(receipts.length ? { receipts } : {}),
            activities: toolActivities,
            createdAt: now()
          })
        );
        return;
      }
      const assistantMessageId = makeId('assistant_message');
      const clarification = asObject(result.clarification);
      setMessages((current) =>
        current.concat({
          id: assistantMessageId,
          role: 'assistant',
          text:
            (confirmation
              ? confirmationTerminalText
              : hasWriteOutcome
                ? deterministicSummary || UNVERIFIED_COMMIT_MESSAGE
                : asText(result.text)) ||
            'Cavalry could not produce a user-facing answer for that request.',
          ...(receipts.length ? { receipts } : {}),
          references: asArray(result.references),
          activities: toolActivities,
          ...(clarification.id ? { clarification } : {}),
          createdAt: now()
        })
      );
      if (clarification.id) {
        setPendingClarification({ ...clarification, messageId: assistantMessageId });
      }
    } catch (turnError) {
      if (version === requestVersionRef.current) {
        const failureMessage = unexpectedFailureMessage(
          turnError,
          'Cavalry could not complete that request.'
        );
        if (!abortController.signal.aborted) {
          setError(failureMessage);
        }
        setMessages((current) =>
          current.concat({
            id: makeId('assistant_message'),
            role: 'assistant',
            text: abortController.signal.aborted
              ? 'Stopped. No completed change was confirmed.'
              : failureMessage,
            createdAt: now()
          })
        );
      }
    } finally {
      if (version === requestVersionRef.current) {
        setPending(false);
        setLiveStatus('');
        setStreamingText('');
        streamBufferRef.current = { requestId: '', rawText: '' };
        requestIdRef.current = '';
        if (requestAbortRef.current === abortController) requestAbortRef.current = null;
      }
    }
  }

  async function confirmPendingAction() {
    const confirmation = pendingConfirmation;
    if (!confirmation || pending || typeof executeTool !== 'function') return;
    const version = ++requestVersionRef.current;
    const requestId = makeId('assistant_confirmation');
    const abortController = new AbortController();
    requestIdRef.current = requestId;
    requestAbortRef.current = abortController;
    streamBufferRef.current = { requestId, rawText: '' };
    setPending(true);
    setError('');
    setLiveStatus('Applying your confirmed action…');
    setMessages((current) =>
      current.concat({
        id: makeId('assistant_message'),
        role: 'user',
        text: `Confirm: ${confirmation.message}`,
        createdAt: now()
      })
    );
    try {
      const approvedArguments = confirmationReplayArguments(confirmation);
      const toolResult = await executeTool(confirmation.toolName, approvedArguments, {
        approvedByUser: true,
        callId: confirmation.id,
        ...(confirmation.proposal ? { proposal: confirmation.proposal } : {}),
        requestId,
        signal: abortController.signal
      });
      if (version !== requestVersionRef.current) return;
      const receipt = asObject(asObject(toolResult).receipt);
      const deterministicMessage = cavalryAssistantActionReceiptMessage(receipt);
      if (!(toolResult && toolResult.ok)) {
        if (asText(receipt.commitStatus) === 'committed') {
          setPendingConfirmation(null);
          const committedMessage = receiptSummary([receipt]) || UNVERIFIED_COMMIT_MESSAGE;
          setError(committedMessage);
          setMessages((current) =>
            current.concat({
              id: makeId('assistant_message'),
              role: 'assistant',
              text: committedMessage,
              receipts: [receipt],
              createdAt: now()
            })
          );
          return;
        }
        const nextConfirmation = chainedPendingConfirmation(
          toolResult,
          confirmation,
          approvedArguments
        );
        if (nextConfirmation) {
          setPendingConfirmation(nextConfirmation);
          setMessages((current) =>
            current.concat({
              id: makeId('assistant_message'),
              role: 'assistant',
              text: 'A second confirmation is required before Cavalry can continue. If you leave or reload this chat, ask Cavalry to prepare it again before confirming.',
              createdAt: now()
            })
          );
          return;
        }
        setPendingConfirmation(null);
        const failureMessage =
          asText(deterministicMessage) ||
          toolFailureMessage(
            toolResult,
            `${readableToolName(confirmation.toolName)} did not complete. No change was confirmed.`
          );
        setError(failureMessage);
        setMessages((current) =>
          current.concat({
            id: makeId('assistant_message'),
            role: 'assistant',
            text: failureMessage,
            ...(Object.keys(receipt).length ? { receipts: [receipt] } : {}),
            createdAt: now()
          })
        );
        return;
      }
      setPendingConfirmation(null);
      if (
        !isDurablyVerifiedReceipt(receipt) &&
        !isCavalryAssistantSuccessfulNoOpWriteReceipt(receipt)
      ) {
        const verificationMessage =
          'Cavalry could not verify that the confirmed change was durably saved. Review the affected record before relying on it.';
        setError(verificationMessage);
        setMessages((current) =>
          current.concat({
            id: makeId('assistant_message'),
            role: 'assistant',
            text: verificationMessage,
            ...(Object.keys(receipt).length ? { receipts: [receipt] } : {}),
            createdAt: now()
          })
        );
        return;
      }
      setMessages((current) =>
        current.concat({
          id: makeId('assistant_message'),
          role: 'assistant',
          text: asText(deterministicMessage) || 'The confirmed change was saved and verified.',
          ...(Object.keys(receipt).length ? { receipts: [receipt] } : {}),
          createdAt: now()
        })
      );
    } catch (confirmationError) {
      if (version === requestVersionRef.current) {
        setPendingConfirmation(null);
        const failureMessage = abortController.signal.aborted
          ? 'Stopped. No completed change was confirmed.'
          : unexpectedFailureMessage(
              confirmationError,
              `${readableToolName(confirmation.toolName)} did not complete. No change was confirmed.`
            );
        if (!abortController.signal.aborted) setError(failureMessage);
        setMessages((current) =>
          current.concat({
            id: makeId('assistant_message'),
            role: 'assistant',
            text: failureMessage,
            createdAt: now()
          })
        );
      }
    } finally {
      if (version === requestVersionRef.current) {
        setPending(false);
        setLiveStatus('');
        setStreamingText('');
        streamBufferRef.current = { requestId: '', rawText: '' };
        requestIdRef.current = '';
        if (requestAbortRef.current === abortController) requestAbortRef.current = null;
      }
    }
  }

  async function cancel() {
    const requestId = requestIdRef.current;
    requestAbortRef.current?.abort();
    streamBufferRef.current = { requestId: '', rawText: '' };
    setStreamingText('');
    setLiveStatus('Stopping…');
    setError('');
    if (requestId && advisor && typeof advisor.invoke === 'function') {
      await advisor.invoke('cancel', { requestId }).catch(() => {});
    }
  }

  function cancelPendingAction() {
    if (!pendingConfirmation || pending) return;
    setPendingConfirmation(null);
    setError('');
    setMessages((current) =>
      current.concat({
        id: makeId('assistant_message'),
        role: 'assistant',
        text: 'Cancelled. No changes were made.',
        createdAt: now()
      })
    );
  }

  function clearConversationDraft() {
    void voice.cancel();
    imagePreparationVersionRef.current += 1;
    setProcessingImages(false);
    if (imageInputRef.current) imageInputRef.current.value = '';
    setComposer('');
    setAttachments([]);
    setAttachmentNotice('');
    setError('');
    setPendingConfirmation(null);
    setPendingClarification(null);
  }

  function startConversation() {
    if (pending) return;
    clearConversationDraft();
    setConversationState((current) => startNewCavalryAssistantConversation(current));
    setHistoryOpen(false);
    setAssistantSettingsOpen(false);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function resumeConversation(conversationId) {
    if (pending) return;
    clearConversationDraft();
    setConversationState((current) => selectCavalryAssistantConversation(current, conversationId));
    setHistoryOpen(false);
    setAssistantSettingsOpen(false);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  async function exportConversation() {
    if (!downloads || !messages.length) return;
    const title = asText(activeConversation?.title) || 'Cavalry chat';
    const slug =
      title
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'cavalry-chat';
    try {
      const result = await downloads.save({
        suggestedName: `${slug}.md`,
        mimeType: 'text/markdown;charset=utf-8',
        contents: serializeConversationMarkdown(activeConversation)
      });
      if (result && result.ok === false && !result.canceled) {
        setError(asText(result.error) || 'The chat export could not be saved.');
      }
    } catch (exportError) {
      setError(asText(exportError?.message) || 'The chat export could not be saved.');
    }
  }

  return (
    <CavalryAssistantPanel
      addImageFiles={addImageFiles}
      advisor={advisor}
      applyPanelWidth={applyPanelWidth}
      assistantSettingsOpen={assistantSettingsOpen}
      attachmentNotice={attachmentNotice}
      attachments={attachments}
      beginPanelResize={beginPanelResize}
      cancel={cancel}
      cancelPanelResize={cancelPanelResize}
      cancelPendingAction={cancelPendingAction}
      composer={composer}
      composerRef={composerRef}
      confirmPendingAction={confirmPendingAction}
      conversationState={conversationState}
      conversations={conversations}
      downloads={downloads}
      draggingImages={draggingImages}
      endPanelResize={endPanelResize}
      error={error}
      exportConversation={exportConversation}
      historyOpen={historyOpen}
      imageInputRef={imageInputRef}
      isOpen={isOpen}
      liveStatus={liveStatus}
      maxPanelWidth={maxPanelWidth}
      messageListRef={messageListRef}
      messages={messages}
      movePanelResize={movePanelResize}
      onClose={onClose}
      onOpen={onOpen}
      onOpenReference={onOpenReference}
      onOpenSettings={onOpenSettings}
      panelWidth={panelWidth}
      pending={pending}
      pendingClarification={pendingClarification}
      pendingConfirmation={pendingConfirmation}
      processingImages={processingImages}
      provider={provider}
      removeImage={removeImage}
      resizePanelWithKeyboard={resizePanelWithKeyboard}
      resizingPanel={resizingPanel}
      resumeConversation={resumeConversation}
      route={route}
      setAssistantSettingsOpen={setAssistantSettingsOpen}
      setComposer={setComposer}
      setDraggingImages={setDraggingImages}
      setHistoryOpen={setHistoryOpen}
      startConversation={startConversation}
      streamingText={streamingText}
      submit={submit}
      suggestions={suggestions}
      voice={voice}
      workbook={workbook}
    />
  );
}
