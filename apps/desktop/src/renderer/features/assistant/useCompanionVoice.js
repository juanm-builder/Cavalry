import { useCallback, useEffect, useRef, useState } from 'react';

export const COMPANION_VOICE_MAX_RECORDING_MS = 60_000;
export const COMPANION_VOICE_TIMER_TICK_MS = 500;
export const COMPANION_VOICE_MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const COMPANION_VOICE_TRANSCRIPTION_PROMPT =
  "Transcribe the user's voice message accurately. Preserve names, amounts, dates, punctuation, and the user's language.";
export const COMPANION_VOICE_MIME_TYPE_CANDIDATES = Object.freeze([
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg'
]);

const INITIAL_VOICE_STATE = Object.freeze({
  status: 'idle',
  error: '',
  permission: null,
  elapsedMs: 0,
  lastTranscript: ''
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function stopMediaStream(stream) {
  if (!(stream && typeof stream.getTracks === 'function')) return;
  stream.getTracks().forEach((track) => {
    if (track && typeof track.stop === 'function') track.stop();
  });
}

function runtimeValue(environment, key) {
  const source = asObject(environment);
  if (source[key]) return source[key];
  if (source.window && source.window[key]) return source.window[key];
  if (typeof globalThis !== 'undefined' && globalThis[key]) return globalThis[key];
  if (typeof globalThis !== 'undefined' && globalThis.window && globalThis.window[key]) {
    return globalThis.window[key];
  }
  return null;
}

function runtimeNavigator(environment) {
  const source = asObject(environment);
  if (source.navigator) return source.navigator;
  return typeof navigator !== 'undefined' ? navigator : null;
}

function runtimeNow(environment) {
  const source = asObject(environment);
  return typeof source.now === 'function' ? Number(source.now()) || 0 : Date.now();
}

function voiceErrorMessage(error, fallback = 'Voice input failed.') {
  const source = asObject(error);
  return asText(source.message || source.error || error) || fallback;
}

function makePermissionError(permission, fallback) {
  const source = asObject(permission);
  const error = new Error(
    asText(source.message || source.error) || fallback || 'Microphone access was denied.'
  );
  error.companionVoicePermission = source;
  return error;
}

function hasProviderTranscription(settings) {
  const source = asObject(settings);
  const provider = asText(source.provider).toLowerCase();
  return ['openai', 'custom'].includes(provider) && source.hasApiKey === true;
}

function providerAvailabilityMessage(settings) {
  const source = asObject(settings);
  const provider = asText(source.provider).toLowerCase();
  if (['openai', 'custom'].includes(provider) && source.hasApiKey !== true) {
    return 'Save an OpenAI API key in Assistant settings to use voice input.';
  }
  if (provider === 'local') {
    return 'Choose a local model or API provider and save an OpenAI API key to use voice input.';
  }
  return 'Connect a model and save an OpenAI API key to use voice input.';
}

export function normalizeCompanionMicrophonePermission(result) {
  const outer = asObject(result);
  const nested = asObject(outer.status);
  const source = Object.keys(nested).length ? { ...outer, ...nested } : outer;
  const status = asText(source.status || (source.granted === true ? 'granted' : 'unknown'))
    .toLowerCase()
    .replace(/_/g, '-');
  const granted = source.granted === true || status === 'granted';
  const denied = source.needsSystemSettings === true || ['denied', 'restricted'].includes(status);
  return {
    ok: outer.ok !== false && source.ok !== false,
    status,
    granted,
    requestable: source.requestable !== false,
    needsSystemSettings: denied,
    needsRestart: source.needsRestart === true,
    message: asText(source.message || source.error || outer.error)
  };
}

export function chooseCompanionVoiceMimeType(MediaRecorderConstructor) {
  if (!(
    MediaRecorderConstructor && typeof MediaRecorderConstructor.isTypeSupported === 'function'
  )) {
    return '';
  }
  return (
    COMPANION_VOICE_MIME_TYPE_CANDIDATES.find((mimeType) =>
      MediaRecorderConstructor.isTypeSupported(mimeType)
    ) || ''
  );
}

export function mergeCompanionVoiceTranscript(currentValue, transcript) {
  const current = String(currentValue == null ? '' : currentValue).replace(/\s+$/g, '');
  const cleanTranscript = String(transcript == null ? '' : transcript)
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanTranscript) return current;
  return current.trim() ? `${current} ${cleanTranscript}` : cleanTranscript;
}

function blobToBase64(blob, environment) {
  const FileReaderConstructor = runtimeValue(environment, 'FileReader');
  if (typeof FileReaderConstructor === 'function') {
    return new Promise((resolve, reject) => {
      const reader = new FileReaderConstructor();
      reader.onerror = () => reject(new Error('Unable to read the voice recording.'));
      reader.onloadend = () => {
        const value = String(reader.result || '');
        const commaIndex = value.indexOf(',');
        resolve(commaIndex >= 0 ? value.slice(commaIndex + 1) : value);
      };
      reader.readAsDataURL(blob);
    });
  }
  if (blob && typeof blob.arrayBuffer === 'function' && typeof btoa === 'function') {
    return blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      return btoa(binary);
    });
  }
  return Promise.reject(new Error('Unable to read the voice recording.'));
}

function useLatest(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function useCompanionVoice({
  advisor,
  createId,
  disabled = false,
  disabledReason = '',
  environment,
  onTranscript,
  setComposer,
  settings = {}
} = {}) {
  const [voice, setVoice] = useState(INITIAL_VOICE_STATE);
  const advisorRef = useLatest(advisor);
  const createIdRef = useLatest(createId);
  const environmentRef = useLatest(environment);
  const onTranscriptRef = useLatest(onTranscript);
  const setComposerRef = useLatest(setComposer);
  const disposedRef = useRef(false);
  const statusRef = useRef('idle');
  const sessionVersionRef = useRef(0);
  const requestIdRef = useRef('');
  const fallbackIdRef = useRef(0);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const recordingStartedAtRef = useRef(0);
  const stopTimerRef = useRef(null);
  const tickTimerRef = useRef(null);

  const updateVoice = useCallback((patch) => {
    if (disposedRef.current) return;
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      statusRef.current = patch.status;
    }
    setVoice((current) => ({ ...current, ...patch }));
  }, []);

  const clearTimers = useCallback(() => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    stopTimerRef.current = null;
    tickTimerRef.current = null;
  }, []);

  const releaseCapture = useCallback(
    ({ stopRecorder = false } = {}) => {
      clearTimers();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      chunksRef.current = [];
      recordingStartedAtRef.current = 0;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (
          stopRecorder &&
          recorder.state &&
          recorder.state !== 'inactive' &&
          typeof recorder.stop === 'function'
        ) {
          try {
            recorder.stop();
          } catch (_error) {
            // The stream and handlers are still released below.
          }
        }
      }
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    },
    [clearTimers]
  );

  const makeRequestId = useCallback(() => {
    if (typeof createIdRef.current === 'function') {
      const supplied = asText(createIdRef.current('companion_voice'));
      if (supplied) return supplied;
    }
    fallbackIdRef.current += 1;
    return `companion_voice_${Date.now().toString(36)}_${fallbackIdRef.current.toString(36)}`;
  }, [createIdRef]);

  const isCurrentSession = useCallback(
    (version) => !disposedRef.current && version === sessionVersionRef.current,
    []
  );

  const processRecording = useCallback(
    async (chunks, mimeType, version) => {
      if (!isCurrentSession(version)) return { ok: false, cancelled: true };
      if (!chunks.length) {
        updateVoice({ status: 'error', error: 'No voice input was captured.', elapsedMs: 0 });
        return { ok: false, error: 'No voice input was captured.' };
      }
      const BlobConstructor = runtimeValue(environmentRef.current, 'Blob');
      if (typeof BlobConstructor !== 'function') {
        updateVoice({
          status: 'error',
          error: 'Voice recording is unavailable in this runtime.',
          elapsedMs: 0
        });
        return { ok: false, error: 'Voice recording is unavailable in this runtime.' };
      }
      const blob = new BlobConstructor(chunks, { type: mimeType || 'audio/webm' });
      if (!blob.size) {
        updateVoice({ status: 'error', error: 'No voice input was captured.', elapsedMs: 0 });
        return { ok: false, error: 'No voice input was captured.' };
      }
      if (blob.size > COMPANION_VOICE_MAX_AUDIO_BYTES) {
        updateVoice({
          status: 'error',
          error: 'That voice recording is too large to transcribe.',
          elapsedMs: 0
        });
        return { ok: false, error: 'That voice recording is too large to transcribe.' };
      }

      const requestId = makeRequestId();
      requestIdRef.current = requestId;
      updateVoice({ status: 'transcribing', error: '' });
      try {
        const audioBase64 = await blobToBase64(blob, environmentRef.current);
        if (!isCurrentSession(version) || requestIdRef.current !== requestId) {
          return { ok: false, cancelled: true };
        }
        const bridge = advisorRef.current;
        if (!(bridge && typeof bridge.invoke === 'function')) {
          throw new Error('Voice transcription is unavailable in this runtime.');
        }
        const result = await bridge.invoke('transcribeAudio', {
          requestId,
          audioBase64,
          mimeType: blob.type || mimeType || 'audio/webm',
          prompt: COMPANION_VOICE_TRANSCRIPTION_PROMPT
        });
        if (!isCurrentSession(version) || requestIdRef.current !== requestId) {
          return { ok: false, cancelled: true };
        }
        if (!(result && result.ok && asText(result.text))) {
          throw new Error(asText(result && result.error) || 'Voice transcription failed.');
        }
        const transcript = asText(result.text);
        if (typeof setComposerRef.current === 'function') {
          setComposerRef.current((current) => mergeCompanionVoiceTranscript(current, transcript));
        }
        if (typeof onTranscriptRef.current === 'function') {
          onTranscriptRef.current(transcript);
        }
        requestIdRef.current = '';
        updateVoice({
          status: 'idle',
          error: '',
          elapsedMs: 0,
          lastTranscript: transcript
        });
        return { ok: true, text: transcript, requestId };
      } catch (error) {
        if (!isCurrentSession(version) || requestIdRef.current !== requestId) {
          return { ok: false, cancelled: true };
        }
        requestIdRef.current = '';
        const message = voiceErrorMessage(error, 'Voice transcription failed.');
        updateVoice({ status: 'error', error: message, elapsedMs: 0 });
        return { ok: false, error: message, requestId };
      }
    },
    [
      advisorRef,
      environmentRef,
      isCurrentSession,
      makeRequestId,
      onTranscriptRef,
      setComposerRef,
      updateVoice
    ]
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!(
      recorder &&
      recorder.state &&
      recorder.state !== 'inactive' &&
      typeof recorder.stop === 'function'
    )) {
      return false;
    }
    clearTimers();
    const startedAt = recordingStartedAtRef.current;
    const elapsedMs = startedAt
      ? Math.min(
          COMPANION_VOICE_MAX_RECORDING_MS,
          Math.max(0, runtimeNow(environmentRef.current) - startedAt)
        )
      : 0;
    updateVoice({ status: 'transcribing', elapsedMs });
    try {
      recorder.stop();
      return true;
    } catch (error) {
      sessionVersionRef.current += 1;
      releaseCapture({ stopRecorder: true });
      updateVoice({
        status: 'error',
        error: voiceErrorMessage(error, 'Voice recording failed.'),
        elapsedMs: 0
      });
      return false;
    }
  }, [clearTimers, environmentRef, releaseCapture, updateVoice]);

  const cancelInternal = useCallback(
    ({ updateState = true } = {}) => {
      sessionVersionRef.current += 1;
      const requestId = requestIdRef.current;
      requestIdRef.current = '';
      releaseCapture({ stopRecorder: true });
      if (updateState) {
        updateVoice({ status: 'idle', error: '', elapsedMs: 0 });
      } else {
        statusRef.current = 'idle';
      }
      const bridge = advisorRef.current;
      if (requestId && bridge && typeof bridge.invoke === 'function') {
        return Promise.resolve(bridge.invoke('cancel', { requestId })).catch(() => ({
          ok: false,
          requestId
        }));
      }
      return Promise.resolve({ ok: true, requestId });
    },
    [advisorRef, releaseCapture, updateVoice]
  );

  const cancel = useCallback(() => cancelInternal({ updateState: true }), [cancelInternal]);

  const start = useCallback(async () => {
    if (disabled) {
      const message = asText(disabledReason) || 'Voice input is currently unavailable.';
      updateVoice({ status: 'error', error: message, elapsedMs: 0 });
      return { ok: false, error: message };
    }
    if (!hasProviderTranscription(settings)) {
      const message = providerAvailabilityMessage(settings);
      updateVoice({ status: 'error', error: message, elapsedMs: 0 });
      return { ok: false, error: message };
    }
    if (['requesting_permission', 'recording', 'transcribing'].includes(statusRef.current)) {
      return { ok: false, busy: true };
    }
    const bridge = advisorRef.current;
    const currentEnvironment = environmentRef.current;
    const mediaNavigator = runtimeNavigator(currentEnvironment);
    const MediaRecorderConstructor = runtimeValue(currentEnvironment, 'MediaRecorder');
    if (!(bridge && typeof bridge.invoke === 'function')) {
      const message = 'Voice transcription is unavailable in this runtime.';
      updateVoice({ status: 'error', error: message, elapsedMs: 0 });
      return { ok: false, error: message };
    }
    if (!(
      mediaNavigator &&
      mediaNavigator.mediaDevices &&
      typeof mediaNavigator.mediaDevices.getUserMedia === 'function' &&
      typeof MediaRecorderConstructor === 'function'
    )) {
      const message = 'Voice recording is unavailable in this runtime.';
      updateVoice({ status: 'error', error: message, elapsedMs: 0 });
      return { ok: false, error: message };
    }

    const version = ++sessionVersionRef.current;
    updateVoice({
      status: 'requesting_permission',
      error: '',
      permission: null,
      elapsedMs: 0
    });
    try {
      let permission = normalizeCompanionMicrophonePermission(
        await bridge.invoke('getMicrophoneStatus')
      );
      if (!isCurrentSession(version)) return { ok: false, cancelled: true };
      updateVoice({ permission });
      if (!permission.ok) {
        throw makePermissionError(permission, 'Microphone access is unavailable.');
      }
      if (
        permission.needsSystemSettings ||
        ['denied', 'restricted'].includes(permission.status) ||
        (!permission.granted && permission.requestable === false)
      ) {
        throw makePermissionError(permission, 'Microphone access was denied.');
      }
      if (!permission.granted) {
        permission = normalizeCompanionMicrophonePermission(
          await bridge.invoke('requestMicrophoneAccess')
        );
        if (!isCurrentSession(version)) return { ok: false, cancelled: true };
        updateVoice({ permission });
        if (!permission.ok || !permission.granted) {
          throw makePermissionError(permission, 'Microphone access was denied.');
        }
      }

      const stream = await mediaNavigator.mediaDevices.getUserMedia({ audio: true });
      if (!isCurrentSession(version)) {
        stopMediaStream(stream);
        return { ok: false, cancelled: true };
      }
      const mimeType = chooseCompanionVoiceMimeType(MediaRecorderConstructor);
      const recorder = mimeType
        ? new MediaRecorderConstructor(stream, { mimeType })
        : new MediaRecorderConstructor(stream);
      const chunks = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = chunks;
      recorder.ondataavailable = (event) => {
        if (event && event.data && event.data.size) chunks.push(event.data);
      };
      recorder.onerror = (event) => {
        if (!isCurrentSession(version)) return;
        sessionVersionRef.current += 1;
        releaseCapture({ stopRecorder: true });
        updateVoice({
          status: 'error',
          error: voiceErrorMessage(event && event.error, 'Voice recording failed.'),
          elapsedMs: 0
        });
      };
      recorder.onstop = () => {
        const capturedChunks = chunks.slice();
        const capturedMimeType = recorder.mimeType || mimeType || 'audio/webm';
        clearTimers();
        if (recorderRef.current === recorder) recorderRef.current = null;
        chunksRef.current = [];
        recordingStartedAtRef.current = 0;
        stopMediaStream(stream);
        if (streamRef.current === stream) streamRef.current = null;
        if (!isCurrentSession(version)) return;
        void processRecording(capturedChunks, capturedMimeType, version);
      };
      recorder.start();
      if (!isCurrentSession(version)) {
        releaseCapture({ stopRecorder: true });
        return { ok: false, cancelled: true };
      }
      const startedAt = runtimeNow(currentEnvironment);
      recordingStartedAtRef.current = startedAt;
      updateVoice({ status: 'recording', error: '', elapsedMs: 0 });
      tickTimerRef.current = setInterval(() => {
        if (!isCurrentSession(version)) return;
        updateVoice({
          elapsedMs: Math.min(
            COMPANION_VOICE_MAX_RECORDING_MS,
            Math.max(0, runtimeNow(environmentRef.current) - startedAt)
          )
        });
      }, COMPANION_VOICE_TIMER_TICK_MS);
      stopTimerRef.current = setTimeout(() => {
        if (isCurrentSession(version)) stop();
      }, COMPANION_VOICE_MAX_RECORDING_MS);
      return { ok: true, status: 'recording', mimeType };
    } catch (error) {
      if (!isCurrentSession(version)) return { ok: false, cancelled: true };
      releaseCapture({ stopRecorder: true });
      const permission = asObject(error && error.companionVoicePermission);
      const message = voiceErrorMessage(error, 'Voice input failed.');
      updateVoice({
        status: 'error',
        error: message,
        ...(Object.keys(permission).length ? { permission } : {}),
        elapsedMs: 0
      });
      return { ok: false, error: message, permission };
    }
  }, [
    advisorRef,
    clearTimers,
    disabled,
    disabledReason,
    environmentRef,
    isCurrentSession,
    processRecording,
    releaseCapture,
    settings,
    stop,
    updateVoice
  ]);

  const toggle = useCallback(() => {
    if (statusRef.current === 'recording') {
      return Promise.resolve({ ok: stop(), status: 'transcribing' });
    }
    if (['requesting_permission', 'transcribing'].includes(statusRef.current)) {
      return Promise.resolve({ ok: false, busy: true });
    }
    return start();
  }, [start, stop]);

  const openMicrophoneSettings = useCallback(async () => {
    const bridge = advisorRef.current;
    if (!(bridge && typeof bridge.invoke === 'function')) {
      const message = 'System microphone settings are unavailable in this runtime.';
      updateVoice({ status: 'error', error: message });
      return { ok: false, error: message };
    }
    try {
      const result = await bridge.invoke('openMicrophoneSettings');
      if (!(result && result.ok)) {
        const message =
          asText(result && (result.error || result.message)) ||
          'System microphone settings could not be opened.';
        updateVoice({ status: 'error', error: message });
        return { ...asObject(result), ok: false, error: message };
      }
      return result;
    } catch (error) {
      const message = voiceErrorMessage(error, 'System microphone settings could not be opened.');
      updateVoice({ status: 'error', error: message });
      return { ok: false, error: message };
    }
  }, [advisorRef, updateVoice]);

  const clearError = useCallback(() => {
    if (statusRef.current === 'error') updateVoice({ status: 'idle', error: '' });
  }, [updateVoice]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      sessionVersionRef.current += 1;
      void cancelInternal({ updateState: false });
    };
  }, [cancelInternal]);

  const mediaNavigator = runtimeNavigator(environment);
  const MediaRecorderConstructor = runtimeValue(environment, 'MediaRecorder');
  const recordingSupported = !!(
    mediaNavigator &&
    mediaNavigator.mediaDevices &&
    typeof mediaNavigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorderConstructor === 'function'
  );
  const providerSupported = hasProviderTranscription(settings);
  const bridgeSupported = !!(advisor && typeof advisor.invoke === 'function');
  const available = !disabled && providerSupported && recordingSupported && bridgeSupported;
  const availabilityMessage = disabled
    ? asText(disabledReason) || 'Voice input is currently unavailable.'
    : !providerSupported
      ? providerAvailabilityMessage(settings)
      : !recordingSupported
        ? 'Voice recording is unavailable in this runtime.'
        : !bridgeSupported
          ? 'Voice transcription is unavailable in this runtime.'
          : '';
  const isRecording = voice.status === 'recording';
  const isBusy = ['requesting_permission', 'transcribing'].includes(voice.status);
  const canOpenMicrophoneSettings = !!(
    voice.permission &&
    (voice.permission.needsSystemSettings ||
      ['denied', 'restricted'].includes(voice.permission.status))
  );
  const statusMessage =
    voice.status === 'requesting_permission'
      ? 'Requesting microphone access…'
      : voice.status === 'recording'
        ? 'Listening… select the microphone again to stop.'
        : voice.status === 'transcribing'
          ? 'Transcribing voice input…'
          : voice.status === 'error'
            ? voice.error
            : '';
  const elapsedSeconds = Math.floor(Math.max(0, voice.elapsedMs) / 1000);

  return {
    ...voice,
    available,
    availabilityMessage,
    isBusy,
    isRecording,
    canOpenMicrophoneSettings,
    statusMessage,
    timerCopy: isRecording ? `${elapsedSeconds}s / 60s` : '',
    button: {
      icon: isRecording ? 'stop_circle' : isBusy ? 'hourglass_top' : 'mic',
      title: isRecording
        ? 'Stop voice input'
        : available
          ? 'Start voice input'
          : availabilityMessage,
      ariaLabel: isRecording ? 'Stop voice input' : 'Start voice input',
      disabled: isRecording ? false : isBusy || !available,
      className: isRecording ? 'is-recording' : voice.status === 'error' ? 'has-error' : ''
    },
    start,
    stop,
    toggle,
    cancel,
    clearError,
    openMicrophoneSettings
  };
}
