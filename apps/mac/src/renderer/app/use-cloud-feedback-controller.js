import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

const FEEDBACK_KINDS = new Set(['bug', 'feedback']);
const FEEDBACK_SOURCES = new Set(['assistant', 'settings']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeAttachment(value) {
  const source = asObject(value);
  const id = asString(source.id);
  if (!id) return null;
  return {
    id,
    fileName: asString(source.fileName || source.file_name || source.name) || 'Screenshot',
    mimeType: asString(source.mimeType || source.mime_type),
    sizeBytes: Math.max(
      0,
      Number(source.sizeBytes || source.size_bytes || source.byteSize || source.byte_size) || 0
    )
  };
}

export function normalizeFeedbackReport(value) {
  const source = asObject(value);
  const id = asString(source.id);
  if (!id) return null;
  const kind = asString(source.kind);
  return {
    id,
    kind: FEEDBACK_KINDS.has(kind) ? kind : 'feedback',
    description: asString(source.description),
    status: asString(source.status) || 'received',
    source: asString(source.source),
    context: asObject(source.context),
    createdAt: asString(source.createdAt || source.created_at),
    updatedAt: asString(source.updatedAt || source.updated_at),
    attachment: normalizeAttachment(source.attachment)
  };
}

function publicCloudState(value) {
  const source = asObject(value);
  const user = asObject(source.user);
  const configured = source.configured === true;
  const sessionGeneration = Math.max(0, Number(source.sessionGeneration) || 0);
  const userId = asString(user.id);
  const signedIn =
    configured && (source.status === 'signed_in' || source.status === 'authenticated') && !!userId;
  return {
    configured,
    signedIn,
    sessionGeneration,
    sessionKey: `${signedIn ? userId : 'signed-out'}:${sessionGeneration}`,
    status: asString(source.status) || (configured ? 'signed_out' : 'unconfigured'),
    userId
  };
}

function resultError(result, fallback) {
  const source = asObject(result);
  return asString(
    (typeof source.error === 'string' ? source.error : asObject(source.error).message) || fallback
  );
}

function sessionChangedFailure() {
  return {
    ok: false,
    code: 'cloud_session_changed',
    error: 'Your Cavalry Cloud session changed. Try again.'
  };
}

function resultMatchesSession(result, cloudState) {
  return (
    asString(result && result.userId) === cloudState.userId &&
    Number(result && result.sessionGeneration) === cloudState.sessionGeneration
  );
}

function normalizeSubmission(value) {
  const source = asObject(value);
  const kind = asString(source.kind);
  const context = asObject(source.context);
  const attachment = asObject(source.attachment);
  return {
    clientRequestId: asString(source.clientRequestId || source.client_request_id).slice(0, 64),
    kind: FEEDBACK_KINDS.has(kind) ? kind : 'feedback',
    description: asString(source.description),
    source: FEEDBACK_SOURCES.has(asString(source.source)) ? asString(source.source) : 'settings',
    context: {
      routeId: asString(context.routeId || context.route_id).slice(0, 64)
    },
    ...(asString(attachment.dataUrl || attachment.data_url)
      ? {
          attachment: {
            filename: asString(
              attachment.fileName || attachment.file_name || attachment.filename || attachment.name
            ).slice(0, 180),
            mimeType: asString(attachment.mimeType || attachment.mime_type).slice(0, 80),
            dataUrl: asString(attachment.dataUrl || attachment.data_url),
            width: Math.max(0, Math.round(Number(attachment.width) || 0)),
            height: Math.max(0, Math.round(Number(attachment.height) || 0))
          }
        }
      : {})
  };
}

export function useCloudFeedbackController({ cloud, feedback } = {}) {
  const [reports, setReports] = useState([]);
  const [reportsSessionKey, setReportsSessionKey] = useState('');
  const [uiState, setUiState] = useState({
    sessionKey: '',
    error: '',
    errorOperation: '',
    notice: '',
    pendingOperation: '',
    loaded: false,
    warning: false
  });
  const loadedSessionRef = useRef('');
  const reportsRef = useRef([]);
  const cloudState = publicCloudState(cloud);
  const activeSessionRef = useRef({
    key: cloudState.sessionKey,
    userId: cloudState.signedIn ? cloudState.userId : ''
  });

  useLayoutEffect(() => {
    const activeSession = activeSessionRef.current;
    if (activeSession.key === cloudState.sessionKey) return;
    activeSessionRef.current = {
      key: cloudState.sessionKey,
      userId: cloudState.signedIn ? cloudState.userId : ''
    };
    loadedSessionRef.current = '';
    reportsRef.current = [];
  }, [cloudState.sessionKey, cloudState.signedIn, cloudState.userId]);

  const invoke = useCallback(
    async (operation, payload = {}) => {
      if (!(feedback && typeof feedback.invoke === 'function')) {
        return { ok: false, unavailable: true, error: 'Cloud feedback is unavailable.' };
      }
      try {
        return (await feedback.invoke(operation, payload)) || { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : 'The feedback request failed.'
        };
      }
    },
    [feedback]
  );

  const refresh = useCallback(async () => {
    const currentCloud = publicCloudState(cloud);
    if (!currentCloud.signedIn) {
      loadedSessionRef.current = '';
      reportsRef.current = [];
      return { ok: false, code: 'not_signed_in', error: 'Sign in to Cavalry Cloud first.' };
    }
    const activeSession = activeSessionRef.current;
    if (activeSession.key !== currentCloud.sessionKey) return sessionChangedFailure();
    setUiState((current) => ({
      ...current,
      sessionKey: currentCloud.sessionKey,
      error: '',
      errorOperation: '',
      notice: '',
      pendingOperation: 'list',
      warning: false
    }));
    const result = await invoke('list', {
      expectedSessionGeneration: currentCloud.sessionGeneration,
      expectedUserId: currentCloud.userId
    });
    if (
      activeSessionRef.current !== activeSession ||
      activeSessionRef.current.key !== currentCloud.sessionKey
    ) {
      return sessionChangedFailure();
    }
    if (result && result.ok && !resultMatchesSession(result, currentCloud)) {
      return sessionChangedFailure();
    }
    if (!(result && result.ok)) {
      const error = resultError(result, 'Your feedback reports could not be loaded.');
      setUiState((current) => ({
        ...current,
        sessionKey: currentCloud.sessionKey,
        error,
        errorOperation: 'list',
        notice: '',
        pendingOperation: '',
        loaded: true,
        warning: false
      }));
      return { ...(result || {}), ok: false, error };
    }
    const nextReports = asArray(result.reports).map(normalizeFeedbackReport).filter(Boolean);
    loadedSessionRef.current = currentCloud.sessionKey;
    reportsRef.current = nextReports;
    setReports(nextReports);
    setReportsSessionKey(currentCloud.sessionKey);
    setUiState((current) => ({
      ...current,
      sessionKey: currentCloud.sessionKey,
      error: '',
      errorOperation: '',
      notice:
        current.sessionKey === currentCloud.sessionKey && current.loaded
          ? 'Feedback reports refreshed.'
          : '',
      pendingOperation: '',
      loaded: true,
      warning: false
    }));
    return { ...result, reports: nextReports };
  }, [cloud, invoke]);

  const ensureLoaded = useCallback(() => {
    const currentCloud = publicCloudState(cloud);
    if (currentCloud.signedIn && loadedSessionRef.current !== currentCloud.sessionKey) {
      return refresh();
    }
    return Promise.resolve({
      ok: currentCloud.signedIn,
      reports:
        currentCloud.signedIn && loadedSessionRef.current === currentCloud.sessionKey
          ? reportsRef.current
          : []
    });
  }, [cloud, refresh]);

  const submit = useCallback(
    async (payload) => {
      const currentCloud = publicCloudState(cloud);
      if (!currentCloud.signedIn) {
        return { ok: false, code: 'not_signed_in', error: 'Sign in to Cavalry Cloud first.' };
      }
      const submission = normalizeSubmission(payload);
      if (!submission.description) {
        return { ok: false, code: 'description_required', error: 'Describe what happened.' };
      }
      const activeSession = activeSessionRef.current;
      if (activeSession.key !== currentCloud.sessionKey) return sessionChangedFailure();
      setUiState((current) => ({
        ...current,
        sessionKey: currentCloud.sessionKey,
        error: '',
        errorOperation: '',
        notice: '',
        pendingOperation: 'submit',
        warning: false
      }));
      const result = await invoke('submit', {
        ...submission,
        expectedSessionGeneration: currentCloud.sessionGeneration,
        expectedUserId: currentCloud.userId
      });
      if (
        activeSessionRef.current !== activeSession ||
        activeSessionRef.current.key !== currentCloud.sessionKey
      ) {
        return sessionChangedFailure();
      }
      if (result && result.ok && !resultMatchesSession(result, currentCloud)) {
        return sessionChangedFailure();
      }
      if (!(result && result.ok)) {
        const error = resultError(result, 'Your report could not be sent.');
        setUiState((current) => ({
          ...current,
          sessionKey: currentCloud.sessionKey,
          error,
          errorOperation: 'submit',
          notice: '',
          pendingOperation: '',
          loaded: current.sessionKey === currentCloud.sessionKey && current.loaded,
          warning: false
        }));
        return { ...(result || {}), ok: false, error };
      }
      const report = normalizeFeedbackReport(result.report);
      if (report) {
        const nextReports = [report, ...reportsRef.current.filter((item) => item.id !== report.id)];
        reportsRef.current = nextReports;
        setReports(nextReports);
        setReportsSessionKey(currentCloud.sessionKey);
      }
      const warning = asString(result.warning);
      setUiState({
        sessionKey: currentCloud.sessionKey,
        error: '',
        errorOperation: '',
        notice: warning || 'Report sent and synced with Cavalry Cloud.',
        pendingOperation: '',
        loaded: true,
        warning: !!warning
      });
      loadedSessionRef.current = currentCloud.sessionKey;
      return { ...result, ...(report ? { report } : {}) };
    },
    [cloud, invoke]
  );

  const downloadAttachment = useCallback(
    async ({ attachmentId, reportId } = {}) => {
      const currentCloud = publicCloudState(cloud);
      if (!currentCloud.signedIn) {
        return { ok: false, code: 'not_signed_in', error: 'Sign in to Cavalry Cloud first.' };
      }
      const activeSession = activeSessionRef.current;
      if (activeSession.key !== currentCloud.sessionKey) return sessionChangedFailure();
      void reportId;
      const result = await invoke('download', {
        attachmentId: asString(attachmentId),
        expectedSessionGeneration: currentCloud.sessionGeneration,
        expectedUserId: currentCloud.userId
      });
      if (
        activeSessionRef.current !== activeSession ||
        activeSessionRef.current.key !== currentCloud.sessionKey
      ) {
        return sessionChangedFailure();
      }
      if (result && result.ok && !resultMatchesSession(result, currentCloud)) {
        return sessionChangedFailure();
      }
      if (!(result && result.ok)) {
        return {
          ...(result || {}),
          ok: false,
          error: resultError(result, 'The attached image could not be loaded.')
        };
      }
      const attachment = asObject(result.attachment);
      return {
        ...result,
        attachment: {
          id: asString(attachment.id),
          fileName: asString(attachment.fileName || attachment.name) || 'Screenshot',
          mimeType: asString(attachment.mimeType),
          sizeBytes: Math.max(0, Number(attachment.sizeBytes || attachment.byteSize) || 0),
          dataUrl: asString(attachment.dataUrl)
        }
      };
    },
    [cloud, invoke]
  );

  const dismissMessage = useCallback(() => {
    setUiState((current) =>
      current.sessionKey === cloudState.sessionKey
        ? { ...current, error: '', errorOperation: '', notice: '', warning: false }
        : current
    );
  }, [cloudState.sessionKey]);

  const model = useMemo(() => {
    const ownsReports = cloudState.signedIn && reportsSessionKey === cloudState.sessionKey;
    const ownsUiState = cloudState.signedIn && uiState.sessionKey === cloudState.sessionKey;
    return {
      ...cloudState,
      reports: ownsReports ? reports : [],
      error: ownsUiState ? uiState.error : '',
      reportsError: ownsUiState && uiState.errorOperation === 'list' ? uiState.error : '',
      submitError: ownsUiState && uiState.errorOperation === 'submit' ? uiState.error : '',
      notice: ownsUiState ? uiState.notice : '',
      pendingOperation: ownsUiState ? uiState.pendingOperation : '',
      loaded: ownsUiState ? uiState.loaded : false,
      warning: ownsUiState ? uiState.warning : false
    };
  }, [cloudState, reports, reportsSessionKey, uiState]);

  return {
    dismissMessage,
    downloadAttachment,
    ensureLoaded,
    model,
    refresh,
    submit
  };
}
