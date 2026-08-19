import { useCallback, useReducer, useRef } from 'react';

import {
  ADVISOR_INTENTS,
  buildAdvisorFeatureModel,
  deleteAdvisorThread,
  runAdvisorTurn
} from './advisor-controller.js';

function reducer(state, action) {
  switch (action.type) {
    case 'composer/changed':
      return { ...state, composer: action.value, error: '' };
    case 'attachments/added':
      return {
        ...state,
        attachments: state.attachments.concat(action.attachments).slice(0, state.attachmentLimit)
      };
    case 'attachment/removed':
      return {
        ...state,
        attachments: state.attachments.filter((attachment) => attachment.id !== action.id)
      };
    case 'thread/selected': {
      const thread = state.threads.find((item) => item.id === action.threadId) || null;
      return {
        ...state,
        activeThreadId: thread?.id || '',
        activeThread: thread,
        messages: thread?.messages || [],
        selectedSourceId: '',
        composer: '',
        attachments: []
      };
    }
    case 'thread/new':
      return {
        ...state,
        activeThreadId: '',
        activeThread: null,
        messages: [],
        selectedSourceId: '',
        composer: '',
        attachments: [],
        error: ''
      };
    case 'thread/deleted':
      return action.model;
    case 'source/selected':
      return { ...state, selectedSourceId: action.sourceId, sourceOpen: true };
    case 'thread-panel/toggled':
      return { ...state, threadOpen: !state.threadOpen };
    case 'source-panel/toggled':
      return { ...state, sourceOpen: !state.sourceOpen };
    case 'request/started':
      return { ...state, pending: true, error: '' };
    case 'request/completed':
      return {
        ...action.model,
        pending: false,
        composer: '',
        attachments: [],
        threadOpen: state.threadOpen,
        sourceOpen: state.sourceOpen
      };
    case 'request/failed':
      return { ...state, pending: false, error: action.error };
    case 'request/cancelled':
      return { ...state, pending: false, error: '' };
    default:
      return state;
  }
}

export function useAdvisorController({
  workbook,
  model,
  services = {},
  onCommandResult,
  onIntent
}) {
  const [state, dispatch] = useReducer(reducer, { workbook, model }, (input) =>
    buildAdvisorFeatureModel(input.workbook, { model: input.model })
  );
  const requestVersion = useRef(0);

  const emitIntent = useCallback(
    (type, payload = {}) => {
      onIntent?.({ type, payload });
    },
    [onIntent]
  );

  const submit = useCallback(
    async (questionOverride = '') => {
      const question = String(questionOverride || state.composer || '').trim();
      if (!question || state.pending) return null;
      const version = ++requestVersion.current;
      dispatch({ type: 'request/started' });
      const result = await runAdvisorTurn(
        workbook,
        {
          question,
          threadId: state.activeThreadId,
          attachments: state.attachments,
          settings: services.settings,
          provider: services.provider
        },
        services
      );
      if (version !== requestVersion.current) return result;
      if (result.ok) {
        dispatch({
          type: 'request/completed',
          model: buildAdvisorFeatureModel(result.workbook, { model })
        });
      } else {
        dispatch({
          type: 'request/failed',
          error: result.errors?.[0]?.message || 'Advisor could not complete the request.'
        });
      }
      onCommandResult?.(result);
      return result;
    },
    [
      model,
      onCommandResult,
      services,
      state.activeThreadId,
      state.attachments,
      state.composer,
      state.pending,
      workbook
    ]
  );

  const cancel = useCallback(() => {
    requestVersion.current += 1;
    dispatch({ type: 'request/cancelled' });
    emitIntent(ADVISOR_INTENTS.CANCEL_REQUEST, { threadId: state.activeThreadId });
  }, [emitIntent, state.activeThreadId]);

  const deleteThread = useCallback(() => {
    if (!state.activeThreadId) return null;
    const result = deleteAdvisorThread(workbook, state.activeThreadId);
    if (result.ok)
      dispatch({
        type: 'thread/deleted',
        model: buildAdvisorFeatureModel(result.workbook, { model })
      });
    onCommandResult?.(result);
    return result;
  }, [model, onCommandResult, state.activeThreadId, workbook]);

  return {
    state,
    setComposer: (value) => dispatch({ type: 'composer/changed', value }),
    addAttachments: (attachments) => dispatch({ type: 'attachments/added', attachments }),
    removeAttachment: (id) => {
      dispatch({ type: 'attachment/removed', id });
      emitIntent(ADVISOR_INTENTS.REMOVE_ATTACHMENT, { attachmentId: id });
    },
    selectThread: (threadId) => dispatch({ type: 'thread/selected', threadId }),
    startThread: () => dispatch({ type: 'thread/new' }),
    deleteThread,
    selectSource: (sourceId) => dispatch({ type: 'source/selected', sourceId }),
    toggleThreadPanel: () => dispatch({ type: 'thread-panel/toggled' }),
    toggleSourcePanel: () => dispatch({ type: 'source-panel/toggled' }),
    submit,
    cancel,
    emitIntent
  };
}
