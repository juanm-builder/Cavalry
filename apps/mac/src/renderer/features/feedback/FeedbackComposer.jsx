import React, { useEffect, useRef, useState } from 'react';

import {
  FEEDBACK_IMAGE_ACCEPT,
  prepareFeedbackImageAttachment
} from './feedback-image-attachment.js';

const DESCRIPTION_MAX_LENGTH = 10000;

export function createFeedbackClientRequestId(cryptoObject = globalThis.crypto) {
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    return cryptoObject.randomUUID().toLowerCase();
  }
  if (!(cryptoObject && typeof cryptoObject.getRandomValues === 'function')) {
    throw new Error('Secure request identifiers are unavailable.');
  }
  const bytes = cryptoObject.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function Icon({ name }) {
  return (
    <span aria-hidden="true" className="material-symbols-rounded">
      {name}
    </span>
  );
}

function cloudGateCopy(feedback) {
  if (feedback.status === 'initializing' || feedback.status === 'signing_in') {
    return {
      icon: 'progress_activity',
      title: 'Connecting to Cavalry Cloud',
      detail: 'You can send this report as soon as your Cloud session is ready.',
      canOpenAccount: false
    };
  }
  if (!feedback.configured || feedback.status === 'unconfigured') {
    return {
      icon: 'cloud_off',
      title: 'Cloud feedback is unavailable',
      detail: 'Reports cannot be sent or synced from this build.',
      canOpenAccount: false
    };
  }
  if (feedback.status === 'unavailable' || feedback.status === 'error') {
    return {
      icon: 'cloud_off',
      title: 'Cavalry Cloud is unavailable',
      detail: 'Reports cannot be sent or synced until Cavalry Cloud reconnects.',
      canOpenAccount: false
    };
  }
  return {
    icon: 'login',
    title: 'Sign in to send feedback',
    detail: 'Cloud reports are private and available across your signed-in Cavalry devices.',
    canOpenAccount: true
  };
}

export function FeedbackCloudGate({ feedback = {}, onOpenAccountSettings }) {
  const copy = cloudGateCopy(feedback);
  return (
    <div className="feedback-cloud-gate" role="note">
      <span className="feedback-cloud-gate-icon">
        <Icon name={copy.icon} />
      </span>
      <div>
        <strong>{copy.title}</strong>
        <p>{copy.detail}</p>
      </div>
      {copy.canOpenAccount ? (
        <button className="btn" onClick={onOpenAccountSettings} type="button">
          Open Account settings
        </button>
      ) : null}
    </div>
  );
}

export function FeedbackComposer({
  compact = false,
  createId,
  feedback = {},
  onOpenAccountSettings,
  onSubmit,
  onSubmitted,
  routeId = '',
  source = 'settings'
}) {
  const [kind, setKind] = useState('bug');
  const [description, setDescription] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [localError, setLocalError] = useState('');
  const [preparingImage, setPreparingImage] = useState(false);
  const inputRef = useRef(null);
  const clientRequestIdRef = useRef('');
  const pending = feedback.pendingOperation === 'submit' || preparingImage;

  useEffect(() => {
    clientRequestIdRef.current = '';
  }, [routeId, source]);

  if (!feedback.signedIn) {
    return <FeedbackCloudGate feedback={feedback} onOpenAccountSettings={onOpenAccountSettings} />;
  }

  const chooseImage = async (file) => {
    if (!file || pending) return;
    setPreparingImage(true);
    setLocalError('');
    try {
      const prepared = await prepareFeedbackImageAttachment(file, { createId });
      if (!prepared.ok) {
        setLocalError(prepared.error?.message || 'The selected image could not be attached.');
        return;
      }
      setAttachment(prepared.attachment);
      clientRequestIdRef.current = '';
    } catch (error) {
      setLocalError(error?.message || 'The selected image could not be attached.');
    } finally {
      setPreparingImage(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setLocalError('Describe what happened.');
      return;
    }
    setLocalError('');
    try {
      if (!clientRequestIdRef.current) {
        clientRequestIdRef.current = createFeedbackClientRequestId();
      }
    } catch (error) {
      setLocalError(error?.message || 'This feedback request could not be identified.');
      return;
    }
    const result = await onSubmit?.({
      clientRequestId: clientRequestIdRef.current,
      kind,
      description: trimmedDescription,
      source,
      context: { routeId },
      ...(attachment ? { attachment } : {})
    });
    if (!(result && result.ok)) {
      setLocalError(result?.error || 'Your report could not be sent.');
      return;
    }
    clientRequestIdRef.current = '';
    setDescription('');
    setAttachment(null);
    onSubmitted?.(result);
  };

  return (
    <form className={`feedback-composer${compact ? ' compact' : ''}`} onSubmit={submit}>
      <fieldset className="feedback-kind-fieldset" disabled={pending}>
        <legend>What are you sharing?</legend>
        <div aria-label="Feedback type" className="feedback-kind-control" role="group">
          <button
            aria-pressed={kind === 'bug'}
            className={kind === 'bug' ? 'active' : ''}
            onClick={() => {
              clientRequestIdRef.current = '';
              setKind('bug');
            }}
            type="button"
          >
            <Icon name="bug_report" />
            Bug
          </button>
          <button
            aria-pressed={kind === 'feedback'}
            className={kind === 'feedback' ? 'active' : ''}
            onClick={() => {
              clientRequestIdRef.current = '';
              setKind('feedback');
            }}
            type="button"
          >
            <Icon name="lightbulb" />
            Feedback
          </button>
        </div>
      </fieldset>

      <div className="field feedback-description-field">
        <label htmlFor={`feedback-description-${source}`}>Description</label>
        <textarea
          autoFocus={compact}
          disabled={pending}
          id={`feedback-description-${source}`}
          maxLength={DESCRIPTION_MAX_LENGTH}
          onChange={(event) => {
            clientRequestIdRef.current = '';
            setDescription(event.target.value);
          }}
          placeholder={
            kind === 'bug'
              ? 'What happened, and what did you expect instead?'
              : 'What would make Cavalry work better for you?'
          }
          required
          rows={compact ? 5 : 6}
          value={description}
        />
        <small>
          {description.length.toLocaleString()} / {DESCRIPTION_MAX_LENGTH.toLocaleString()}
        </small>
      </div>

      <input
        accept={FEEDBACK_IMAGE_ACCEPT}
        aria-label="Choose feedback image"
        disabled={pending}
        hidden
        onChange={(event) => void chooseImage(event.target.files?.[0])}
        ref={inputRef}
        type="file"
      />
      {attachment ? (
        <div className="feedback-attachment-preview">
          <img alt="" src={attachment.dataUrl} />
          <div>
            <strong>{attachment.filename || attachment.name || 'Screenshot'}</strong>
            <small>Ready to upload with this report</small>
          </div>
          <button
            aria-label="Remove feedback image"
            className="btn btn-icon"
            disabled={pending}
            onClick={() => {
              clientRequestIdRef.current = '';
              setAttachment(null);
            }}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      ) : (
        <button
          className="btn feedback-attachment-button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          <Icon name="add_photo_alternate" />
          {preparingImage ? 'Preparing image…' : 'Attach screenshot'}
          <small>Optional · PNG or JPEG · up to 8 MB</small>
        </button>
      )}

      {localError || feedback.submitError ? (
        <div className="feedback-message bad" role="alert">
          <Icon name="error" />
          <span>{localError || feedback.submitError}</span>
        </div>
      ) : null}

      <div className="feedback-composer-actions">
        <span>
          <Icon name="lock" />
          Private to your Cavalry Cloud account
        </span>
        <button className="btn btn-primary" disabled={pending || !description.trim()} type="submit">
          <Icon name={pending ? 'progress_activity' : 'send'} />
          {feedback.pendingOperation === 'submit' ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </form>
  );
}
