function normalizeVoiceStatus(status) {
  return String(status || 'idle');
}

function renderString(value) {
  return String(value == null ? '' : value);
}

export function getAdvisorVoiceStatusCopy(options = {}) {
  const status = normalizeVoiceStatus(options.status);
  if (status === 'requesting_permission') {
    return 'Requesting microphone access...';
  }
  if (status === 'recording') {
    return 'Listening... tap the mic to stop.';
  }
  if (status === 'transcribing') {
    return 'Transcribing voice input...';
  }
  if (status === 'error') {
    return options.error || 'Voice input failed.';
  }
  return '';
}

export function buildAdvisorVoiceButtonViewModel(options = {}) {
  const status = normalizeVoiceStatus(options.status);
  const availability =
    options.availability && typeof options.availability === 'object' ? options.availability : {};
  const isRecording = status === 'recording';
  const isBusy = status === 'requesting_permission' || status === 'transcribing';
  const title = isRecording
    ? 'Stop voice input'
    : status === 'transcribing'
      ? 'Transcribing voice input'
      : availability.available
        ? 'Dictate to Advisor'
        : availability.message;
  return {
    status,
    icon: isRecording ? 'stop_circle' : status === 'transcribing' ? 'hourglass_top' : 'mic',
    title,
    ariaLabel: title,
    disabled: isBusy || (!isRecording && !availability.available),
    className: status === 'error' ? 'has-error' : status === 'recording' ? 'is-recording' : ''
  };
}

export function buildAdvisorVoiceStatusViewModel(options = {}) {
  const status = normalizeVoiceStatus(options.status);
  const copy = typeof options.copy === 'string' ? options.copy : getAdvisorVoiceStatusCopy(options);
  const permission =
    options.permission && typeof options.permission === 'object' ? options.permission : null;
  const canOpenMicrophoneSettings =
    status === 'error' &&
    !!(permission && permission.needsSystemSettings) &&
    options.canOpenMicrophoneSettings === true;
  if (!copy) {
    return {
      visible: false,
      status,
      className: status,
      icon: '',
      copy: '',
      timerCopy: '',
      settingsAction: null
    };
  }
  return {
    visible: true,
    status,
    className: status,
    icon:
      status === 'error' ? 'error' : status === 'recording' ? 'radio_button_checked' : 'graphic_eq',
    copy,
    timerCopy: status === 'recording' ? renderString(options.timerCopy) : '',
    settingsAction: canOpenMicrophoneSettings ? true : null
  };
}
