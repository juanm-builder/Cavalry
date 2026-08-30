import React from 'react';

import {
  COMPANION_IMAGE_ATTACHMENT_ACCEPT,
  COMPANION_IMAGE_ATTACHMENT_MAX_COUNT
} from './companion-image-attachments.js';
import { CavalryAssistantMark } from './CavalryAssistantMark.jsx';
import { AssistantSettings } from './CavalryAssistantSettings.jsx';
import {
  AssistantHeaderMenu,
  ConversationHistory,
  Icon,
  Message
} from './CavalryAssistantPresentation.jsx';
import { PANEL_DEFAULT_WIDTH } from './useCavalryAssistantPanelResize.js';

function asText(value) {
  return String(value == null ? '' : value).trim();
}

export function CavalryAssistantPanel({
  addImageFiles,
  advisor,
  applyPanelWidth,
  assistantSettingsOpen,
  attachmentNotice,
  attachments,
  beginPanelResize,
  cancel,
  cancelPanelResize,
  cancelPendingAction,
  composer,
  composerRef,
  confirmPendingAction,
  conversationState,
  conversations,
  downloads,
  draggingImages,
  endPanelResize,
  error,
  exportConversation,
  historyOpen,
  imageInputRef,
  isOpen,
  liveStatus,
  maxPanelWidth,
  messageListRef,
  messages,
  movePanelResize,
  onClose,
  onOpen,
  onOpenReference,
  onOpenSettings,
  panelWidth,
  pending,
  pendingClarification,
  pendingConfirmation,
  processingImages,
  provider,
  removeImage,
  resizePanelWithKeyboard,
  resizingPanel,
  resumeConversation,
  route,
  setAssistantSettingsOpen,
  setComposer,
  setDraggingImages,
  setHistoryOpen,
  startConversation,
  streamingText,
  submit,
  suggestions,
  voice,
  workbook
}) {
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
              disabled={pending || !messages.length || assistantSettingsOpen}
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
              onOpenSettings={() => {
                void voice.cancel();
                setHistoryOpen(false);
                setAssistantSettingsOpen(true);
              }}
              onToggleHistory={() => {
                setAssistantSettingsOpen(false);
                setHistoryOpen((current) => !current);
              }}
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
            <Icon name={assistantSettingsOpen ? 'tune' : route.icon} />
            <span>
              {assistantSettingsOpen ? 'Assistant settings' : `Working with ${route.label}`}
            </span>
            <small>
              {assistantSettingsOpen
                ? 'Local personalization'
                : workbook?.name || 'Current workbook'}
            </small>
          </div>

          {historyOpen ? (
            <ConversationHistory
              activeConversationId={conversationState.activeConversationId}
              conversations={conversations}
              onSelect={resumeConversation}
            />
          ) : null}
          {assistantSettingsOpen ? (
            <AssistantSettings
              advisor={advisor}
              onBack={() => setAssistantSettingsOpen(false)}
              onOpenConnectionSettings={() => onOpenSettings?.('settings-advisor')}
            />
          ) : null}
          <div
            className="cavalry-assistant-messages"
            hidden={historyOpen || assistantSettingsOpen}
            ref={messageListRef}
          >
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
                  <button className="btn" onClick={cancelPendingAction} type="button">
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={confirmPendingAction} type="button">
                    Confirm
                  </button>
                </div>
              </section>
            ) : null}
            {pending && streamingText ? (
              <div className="cavalry-assistant-message assistant cavalry-assistant-streaming">
                <CavalryAssistantMark className="cavalry-assistant-message-avatar" working />
                <div className="cavalry-assistant-message-content">
                  <p>{streamingText}</p>
                </div>
              </div>
            ) : null}
            {pending ? (
              <div className="cavalry-assistant-live-status" role="status">
                <span aria-hidden="true" className="cavalry-assistant-thinking-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span>{streamingText ? 'Writing…' : liveStatus || 'Working…'}</span>
              </div>
            ) : null}
          </div>

          <footer
            className="cavalry-assistant-composer-wrap"
            hidden={historyOpen || assistantSettingsOpen}
          >
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
                ? 'Pick an option or keep typing — Cavalry continues either way.'
                : 'Cavalry verifies tool results and asks before changing anything.'}
            </small>
          </footer>
        </aside>
      ) : null}
    </>
  );
}
