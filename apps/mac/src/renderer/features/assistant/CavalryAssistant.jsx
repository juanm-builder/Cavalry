import React, { useEffect, useMemo, useRef, useState } from 'react';

import { getRouteById } from '../../app/routes.js';
import {
  COMPANION_IMAGE_ATTACHMENT_ACCEPT,
  COMPANION_IMAGE_ATTACHMENT_MAX_COUNT,
  processCompanionImageAttachments
} from './companion-image-attachments.js';
import {
  getCavalryAssistantToolDefinitions,
  CAVALRY_ASSISTANT_TOOLS
} from './cavalry-assistant-tools.js';
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
import { CavalryAssistantMark } from './CavalryAssistantMark.jsx';
import {
  AssistantHeaderMenu,
  ConversationHistory,
  Icon,
  Message,
  serializeConversationMarkdown
} from './CavalryAssistantPresentation.jsx';
import {
  PANEL_DEFAULT_WIDTH,
  useCavalryAssistantPanelResize
} from './useCavalryAssistantPanelResize.js';
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

function readableToolName(toolName) {
  return asText(toolName)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

const CONFIRMED_ACTION_VERBS = Object.freeze({
  create_transaction: 'Recorded',
  update_transaction: 'Updated',
  delete_transaction: 'Deleted',
  create_account: 'Created',
  update_account: 'Updated',
  archive_account: 'Archived',
  restore_account: 'Restored',
  retire_account: 'Retired',
  delete_account: 'Deleted',
  create_category: 'Created',
  update_category: 'Updated',
  rename_category: 'Renamed',
  update_category_linked_account: 'Updated',
  archive_category: 'Archived',
  restore_category: 'Restored',
  delete_category: 'Deleted',
  set_budget: 'Saved',
  archive_budget: 'Removed',
  create_bill: 'Created',
  update_bill: 'Updated',
  pay_bill: 'Recorded payment for',
  archive_bill: 'Archived',
  create_counterparty: 'Created',
  archive_counterparty: 'Archived',
  set_exchange_rate: 'Updated'
});

function confirmedActionEntity(toolResult) {
  const data = asObject(toolResult?.data);
  return asObject(
    data.transaction ||
      data.deletedTransaction ||
      data.account ||
      data.category ||
      data.recurringItem ||
      data.counterparty ||
      data.budget
  );
}

function confirmedActionMessage(toolName, toolResult, argumentsValue = {}) {
  const verb = CONFIRMED_ACTION_VERBS[asText(toolName)];
  const entity = confirmedActionEntity(toolResult);
  const argumentsSource = asObject(argumentsValue);
  const label = asText(
    entity.description ||
      entity.name ||
      entity.categoryName ||
      entity.sheetName ||
      entity.id ||
      entity.categoryId ||
      argumentsSource.description ||
      argumentsSource.transaction ||
      argumentsSource.account ||
      argumentsSource.category ||
      argumentsSource.bill ||
      argumentsSource.counterparty
  );
  if (verb && label) return `${verb} “${label}”.`;
  if (asText(toolName) === 'save_workbook') return 'Saved.';
  return 'Done—the change was saved.';
}

const CONFIRMATION_APPROVAL_FIELDS = Object.freeze([
  'confirmed',
  'allowDuplicate',
  'allowCurrencyConversion'
]);

function confirmationApprovalField(confirmation) {
  const field = asText(confirmation?.field);
  return CONFIRMATION_APPROVAL_FIELDS.includes(field) ? field : 'confirmed';
}

function confirmationMessage(confirmation) {
  return (
    asText(confirmation?.message) ||
    `Confirm that you want Cavalry to ${asText(confirmation?.action) || 'continue'}.`
  );
}

function pendingConfirmationFromResult(turnResult) {
  const toolResults = asArray(turnResult?.toolResults);
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const toolResult = asObject(toolResults[index]);
    const result = asObject(toolResult.result);
    const confirmation = asObject(result.confirmation);
    if (confirmation.required !== true) continue;
    const argumentsWithoutApproval = { ...asObject(toolResult.arguments) };
    CONFIRMATION_APPROVAL_FIELDS.forEach((field) => delete argumentsWithoutApproval[field]);
    return {
      id: toolResult.callId || `${toolResult.toolName}-${index}`,
      toolName: asText(toolResult.toolName),
      arguments: argumentsWithoutApproval,
      approvalField: confirmationApprovalField(confirmation),
      message: confirmationMessage(confirmation)
    };
  }
  return null;
}

function chainedPendingConfirmation(toolResult, currentConfirmation, approvedArguments) {
  const result = asObject(toolResult);
  const confirmation = asObject(result.confirmation);
  if (confirmation.required !== true) return null;
  const approvalField = confirmationApprovalField(confirmation);
  if (
    approvalField === currentConfirmation.approvalField &&
    approvedArguments[approvalField] === true
  ) {
    return null;
  }
  const replayArguments = { ...approvedArguments };
  delete replayArguments[approvalField];
  return {
    id: asText(result.toolCallId) || currentConfirmation.id,
    toolName: currentConfirmation.toolName,
    arguments: replayArguments,
    approvalField,
    message: confirmationMessage(confirmation)
  };
}

function committedToolResults(turnResult) {
  return asArray(turnResult?.toolResults).filter(
    (toolResult) => toolResult?.ok === true && toolResult?.result?.changed === true
  );
}

function toolFailureMessage(toolResult, fallback) {
  const source = asObject(toolResult);
  const firstError = asObject(asArray(source.errors)[0]);
  return asText(source.error || firstError.message) || fallback;
}

function isConfirmationReply(value) {
  return /^(yes|y|confirm|confirmed|go ahead|do it|proceed|approve)(?:[.!])?$/i.test(asText(value));
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
  const assistantWasOpenRef = useRef(isOpen);
  const messageListRef = useRef(null);
  const requestIdRef = useRef('');
  const requestAbortRef = useRef(null);
  const requestVersionRef = useRef(0);
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
    requestAbortRef.current?.abort();
    requestVersionRef.current += 1;
    loadedConversationScopeRef.current = isOpen ? conversationScopeKey : '';
    setConversationState(
      isOpen
        ? loadCavalryAssistantConversationState(workbook, { storage: conversationStorage })
        : createCavalryAssistantConversationState(workbook)
    );
    setHistoryOpen(false);
    setComposer('');
    setAttachments([]);
    setAttachmentNotice('');
    setPending(false);
    setPendingConfirmation(null);
    setPendingClarification(null);
    setError('');
    setLiveStatus('');
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
  }, [historyOpen, messages, pending, liveStatus]);

  useEffect(() => {
    if (!(advisor && typeof advisor.subscribe === 'function')) return undefined;
    return advisor.subscribe((status) => {
      const requestId = asText(status?.requestId);
      if (requestId && requestIdRef.current && requestId !== requestIdRef.current) return;
      setLiveStatus(asText(status?.message));
    });
  }, [advisor]);

  useEffect(
    () => () => {
      requestAbortRef.current?.abort();
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
        onClose?.();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [isOpen, onClose, onOpen]);

  async function addImageFiles(files) {
    if (processingImages || pending || !files?.length) return;
    setProcessingImages(true);
    setAttachmentNotice('Preparing images…');
    setError('');
    try {
      const result = await processCompanionImageAttachments(files, {
        createId: makeId,
        existingAttachments: attachments
      });
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
      setError(asText(imageError?.message) || 'The selected images could not be prepared.');
      setAttachmentNotice('');
    } finally {
      setProcessingImages(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
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
    if (
      !questionOverride &&
      !selectedAttachments.length &&
      pendingConfirmation &&
      isConfirmationReply(question)
    ) {
      setComposer('');
      await confirmPendingAction();
      return;
    }
    setPendingConfirmation(null);
    setPendingClarification(null);
    const version = ++requestVersionRef.current;
    const requestId = makeId('assistant_request');
    const abortController = new AbortController();
    requestIdRef.current = requestId;
    requestAbortRef.current = abortController;
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
    setLiveStatus(provider.connected ? 'Thinking…' : 'A model connection is required.');
    try {
      const result = await runCavalryAssistantTurn({
        activeRouteId: route.id,
        advisor,
        createId: makeId,
        executeTool,
        history,
        maxIterations: 10,
        question,
        images: selectedAttachments,
        requestId,
        signal: abortController.signal,
        settings,
        today: typeof today === 'function' ? today() : today,
        tools:
          typeof getCavalryAssistantToolDefinitions === 'function'
            ? getCavalryAssistantToolDefinitions()
            : CAVALRY_ASSISTANT_TOOLS
      });
      if (version !== requestVersionRef.current) return;
      const confirmation = pendingConfirmationFromResult(result);
      const committedResults = committedToolResults(result);
      const toolActivities = asArray(result?.activities).filter(
        (activity) => activity.type === 'tool'
      );
      if (confirmation) setPendingConfirmation(confirmation);
      if (!(result && result.ok)) {
        if (committedResults.length || confirmation || result?.cancelled) {
          setMessages((current) =>
            current.concat({
              id: makeId('assistant_message'),
              role: 'assistant',
              text: result?.cancelled
                ? committedResults.length
                  ? `${committedResults.length === 1 ? 'A workbook change completed' : `${committedResults.length} workbook changes completed`} before the request stopped. The ${committedResults.length === 1 ? 'change was' : 'changes were'} saved; review the action result before retrying.`
                  : 'Stopped. No further actions were run.'
                : committedResults.length
                  ? `${committedResults.length === 1 ? 'A workbook change was' : `${committedResults.length} workbook changes were`} completed and saved, but the model could not finish its reply. Review the action result before retrying.`
                  : 'This action is waiting for your confirmation.',
              activities: toolActivities,
              createdAt: now()
            })
          );
        }
        if (!result?.cancelled) {
          setError(asText(result?.error) || 'Cavalry could not complete that request.');
        }
        return;
      }
      const assistantMessageId = makeId('assistant_message');
      const clarification = asObject(result.clarification);
      setMessages((current) =>
        current.concat({
          id: assistantMessageId,
          role: 'assistant',
          text: asText(result.text) || 'Done.',
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
        setError(asText(turnError?.message) || 'Cavalry could not complete that request.');
      }
    } finally {
      if (version === requestVersionRef.current) {
        setPending(false);
        setLiveStatus('');
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
      const approvedArguments = {
        ...confirmation.arguments,
        [confirmation.approvalField]: true
      };
      const toolResult = await executeTool(confirmation.toolName, approvedArguments, {
        approvedByUser: true,
        callId: confirmation.id,
        requestId,
        signal: abortController.signal
      });
      if (version !== requestVersionRef.current) return;
      if (!(toolResult && toolResult.ok)) {
        const nextConfirmation = chainedPendingConfirmation(
          toolResult,
          confirmation,
          approvedArguments
        );
        if (nextConfirmation) {
          setPendingConfirmation(nextConfirmation);
          return;
        }
        setError(
          toolFailureMessage(
            toolResult,
            `${readableToolName(confirmation.toolName)} did not complete.`
          )
        );
        return;
      }
      setPendingConfirmation(null);
      setMessages((current) =>
        current.concat({
          id: makeId('assistant_message'),
          role: 'assistant',
          text: confirmedActionMessage(confirmation.toolName, toolResult, approvedArguments),
          createdAt: now()
        })
      );
    } catch (confirmationError) {
      if (version === requestVersionRef.current) {
        setError(
          asText(confirmationError?.message) ||
            `${readableToolName(confirmation.toolName)} did not complete.`
        );
      }
    } finally {
      if (version === requestVersionRef.current) {
        setPending(false);
        setLiveStatus('');
        requestIdRef.current = '';
        if (requestAbortRef.current === abortController) requestAbortRef.current = null;
      }
    }
  }

  async function cancel() {
    const requestId = requestIdRef.current;
    requestAbortRef.current?.abort();
    setLiveStatus('Stopping…');
    setError('');
    if (requestId && advisor && typeof advisor.invoke === 'function') {
      await advisor.invoke('cancel', { requestId }).catch(() => {});
    }
  }

  function clearConversationDraft() {
    void voice.cancel();
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
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function resumeConversation(conversationId) {
    if (pending) return;
    clearConversationDraft();
    setConversationState((current) => selectCavalryAssistantConversation(current, conversationId));
    setHistoryOpen(false);
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
    <>
      <button
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close Cavalry assistant' : 'Ask Cavalry'}
        className={`cavalry-assistant-launcher${isOpen ? ' open' : ''}${pending ? ' working' : ''}`}
        onClick={isOpen ? onClose : onOpen}
        title="Ask Cavalry (⌘J)"
        type="button"
      >
        <CavalryAssistantMark working={pending} />
        {error ? <span aria-hidden="true" className="cavalry-assistant-launcher-alert" /> : null}
      </button>
      {isOpen ? (
        <aside
          aria-label="Cavalry assistant"
          className={`cavalry-assistant-panel${draggingImages ? ' dragging-images' : ''}`}
          onDragEnter={(event) => {
            if (Array.from(event.dataTransfer?.types || []).includes('Files')) {
              event.preventDefault();
              setDraggingImages(true);
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setDraggingImages(false);
          }}
          onDragOver={(event) => {
            if (Array.from(event.dataTransfer?.types || []).includes('Files')) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDraggingImages(false);
            void addImageFiles(Array.from(event.dataTransfer?.files || []));
          }}
          role="dialog"
          style={{ '--cavalry-assistant-panel-width': `${panelWidth}px` }}
        >
          <div
            aria-label="Resize the assistant panel"
            aria-orientation="vertical"
            aria-valuemax={maxPanelWidth}
            aria-valuemin={PANEL_DEFAULT_WIDTH}
            aria-valuenow={panelWidth}
            className={`cavalry-assistant-resize-handle${resizingPanel ? ' active' : ''}`}
            onDoubleClick={() => applyPanelWidth(PANEL_DEFAULT_WIDTH)}
            onKeyDown={resizePanelWithKeyboard}
            onPointerCancel={cancelPanelResize}
            onPointerDown={beginPanelResize}
            onPointerMove={movePanelResize}
            onPointerUp={endPanelResize}
            role="separator"
            tabIndex={0}
            title="Drag to resize · double-click to reset"
          />
          <header className="cavalry-assistant-header">
            <CavalryAssistantMark className="cavalry-assistant-header-mark" working={pending} />
            <div className="cavalry-assistant-header-copy">
              <strong>Cavalry</strong>
              <span className={`cavalry-assistant-provider ${provider.tone}`}>
                <Icon name={provider.icon} />
                {provider.label}
              </span>
            </div>
            <button
              aria-label="New conversation"
              className="btn btn-icon"
              disabled={pending || !messages.length}
              onClick={startConversation}
              title="New conversation"
              type="button"
            >
              <Icon name="add_comment" />
            </button>
            <AssistantHeaderMenu
              canExport={Boolean(downloads) && messages.length > 0 && !pending}
              historyOpen={historyOpen}
              onExportChat={exportConversation}
              onOpenSettings={onOpenSettings}
              onToggleHistory={() => setHistoryOpen((current) => !current)}
              pending={pending}
            />
            <button
              aria-label="Close Cavalry assistant"
              className="btn btn-icon"
              onClick={onClose}
              title="Close"
              type="button"
            >
              <Icon name="close" />
            </button>
          </header>

          <div className="cavalry-assistant-context-bar">
            <Icon name={route.icon} />
            <span>Working with {route.label}</span>
            <small>{workbook?.name || 'Current workbook'}</small>
          </div>

          {historyOpen ? (
            <ConversationHistory
              activeConversationId={conversationState.activeConversationId}
              conversations={conversations}
              onSelect={resumeConversation}
            />
          ) : null}
          <div className="cavalry-assistant-messages" hidden={historyOpen} ref={messageListRef}>
            {messages.length ? (
              messages.map((message) => (
                <Message
                  activeClarificationId={pendingClarification?.id || ''}
                  key={message.id}
                  message={message}
                  onAnswerClarification={(answer) => submit(answer)}
                  onComposeAnswer={() => composerRef.current?.focus()}
                  onOpenReference={onOpenReference}
                />
              ))
            ) : (
              <div className="cavalry-assistant-empty">
                <CavalryAssistantMark className="cavalry-assistant-empty-mark" />
                <h2>What do you want to do?</h2>
                <p>Ask anything about this workbook.</p>
                <div className="cavalry-assistant-suggestions">
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} onClick={() => submit(suggestion)} type="button">
                      <span>{suggestion}</span>
                      <Icon name="north_east" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {pendingConfirmation && !pending ? (
              <section
                aria-label="Confirm Cavalry action"
                className="cavalry-assistant-confirmation"
              >
                <Icon name="warning" />
                <div>
                  <strong>Confirm this action</strong>
                  <p>{pendingConfirmation.message}</p>
                </div>
                <div className="cavalry-assistant-confirmation-actions">
                  <button
                    className="btn"
                    onClick={() => setPendingConfirmation(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={confirmPendingAction} type="button">
                    Confirm
                  </button>
                </div>
              </section>
            ) : null}
            {pending ? (
              <div className="cavalry-assistant-live-status" role="status">
                <span aria-hidden="true" className="cavalry-assistant-thinking-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span>{liveStatus || 'Working…'}</span>
              </div>
            ) : null}
          </div>

          <footer className="cavalry-assistant-composer-wrap" hidden={historyOpen}>
            {draggingImages ? (
              <div className="cavalry-assistant-drop-overlay">Drop images to attach them</div>
            ) : null}
            {error ? (
              <div className="cavalry-assistant-error" role="alert">
                <Icon name="error" />
                <span>{error}</span>
                {!provider.connected ? (
                  <button onClick={onOpenSettings} type="button">
                    Open settings
                  </button>
                ) : null}
              </div>
            ) : null}
            {attachments.length ? (
              <div className="cavalry-assistant-composer-images" aria-label="Images ready to send">
                {attachments.map((attachment, index) => (
                  <div className="cavalry-assistant-composer-image" key={attachment.id}>
                    <img alt={attachment.name || `Image ${index + 1}`} src={attachment.dataUrl} />
                    <button
                      aria-label={`Remove ${attachment.name || `image ${index + 1}`}`}
                      onClick={() => removeImage(attachment.id)}
                      type="button"
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {processingImages || attachmentNotice ? (
              <div className="cavalry-assistant-attachment-summary" role="status">
                <Icon name={processingImages ? 'progress_activity' : 'imagesmode'} />
                <span>
                  {processingImages
                    ? 'Preparing images…'
                    : `${attachments.length}/${COMPANION_IMAGE_ATTACHMENT_MAX_COUNT} attached. ${attachmentNotice}`}
                </span>
              </div>
            ) : null}
            {voice.statusMessage ? (
              <div className={`cavalry-assistant-voice-status ${voice.status}`} role="status">
                <Icon name={voice.isRecording ? 'graphic_eq' : 'mic'} />
                <span>
                  {voice.statusMessage} {voice.timerCopy}
                </span>
                {voice.canOpenMicrophoneSettings ? (
                  <button onClick={voice.openMicrophoneSettings} type="button">
                    Open settings
                  </button>
                ) : null}
              </div>
            ) : null}
            <form
              className="cavalry-assistant-composer"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <input
                accept={COMPANION_IMAGE_ATTACHMENT_ACCEPT}
                aria-label="Choose images"
                hidden
                multiple
                onChange={(event) => void addImageFiles(Array.from(event.target.files || []))}
                ref={imageInputRef}
                type="file"
              />
              <textarea
                aria-label="Message Cavalry"
                disabled={pending || processingImages}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={
                  pendingClarification
                    ? 'Answer Cavalry’s question…'
                    : attachments.length
                      ? 'Ask about these images…'
                      : 'Ask or tell Cavalry what to do…'
                }
                ref={composerRef}
                rows="2"
                value={composer}
              />
              <div className="cavalry-assistant-composer-actions">
                <button
                  aria-label="Attach images"
                  className="btn btn-icon"
                  disabled={
                    pending ||
                    processingImages ||
                    attachments.length >= COMPANION_IMAGE_ATTACHMENT_MAX_COUNT
                  }
                  onClick={() => imageInputRef.current?.click()}
                  title={`Attach up to ${COMPANION_IMAGE_ATTACHMENT_MAX_COUNT} images`}
                  type="button"
                >
                  <Icon name="add_photo_alternate" />
                </button>
                <button
                  aria-label={voice.button.ariaLabel}
                  className={`btn btn-icon${voice.isRecording ? ' recording' : ''}`}
                  disabled={voice.button.disabled}
                  onClick={voice.toggle}
                  title={voice.button.title}
                  type="button"
                >
                  <Icon name={voice.button.icon} />
                </button>
                {pending ? (
                  <button
                    aria-label="Stop Cavalry"
                    className="btn btn-icon"
                    onClick={cancel}
                    type="button"
                  >
                    <Icon name="stop" />
                  </button>
                ) : (
                  <button
                    aria-label="Send message"
                    className="btn btn-primary btn-icon"
                    disabled={
                      (!asText(composer) && !attachments.length) ||
                      processingImages ||
                      voice.isBusy ||
                      voice.isRecording
                    }
                    type="submit"
                  >
                    <Icon name="arrow_upward" />
                  </button>
                )}
              </div>
            </form>
            <small>
              {pendingClarification
                ? 'Answer the question so Cavalry can continue without guessing.'
                : 'Cavalry checks tool results before reporting a change.'}
            </small>
          </footer>
        </aside>
      ) : null}
    </>
  );
}
