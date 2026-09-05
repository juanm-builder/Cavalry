import React from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import { SanitizedRichText } from '../../shared/SanitizedRichText.jsx';
import { formatUiDateTime } from '../../shared/date-format.js';
import { ADVISOR_INTENTS } from './advisor-controller.js';
import { useAdvisorController } from './useAdvisorController.js';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function advisorActionLabel(action) {
  const label = String(action?.label || action?.summary || action?.type || '').trim();
  if (!label) return 'Review draft';
  if (!/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(label)) return label;
  const readable = label
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return `Review ${readable}`;
}

function withClick(binding, callback) {
  const boundClick = binding?.onClick;
  return {
    ...(binding || {}),
    onClick(event) {
      boundClick?.(event);
      callback?.(event);
    }
  };
}

function ThreadPanel({ state, controller, actions }) {
  return (
    <aside className="advisor-thread-panel">
      <div className="advisor-thread-panel-head">
        <div>
          <strong>Chats</strong>
          <small>Workbook conversations</small>
        </div>
        <button
          className="btn btn-icon advisor-thread-new"
          type="button"
          {...withClick(actions.action('start-advisor-chat'), controller.startThread)}
          aria-label="New Advisor chat"
          title="New Advisor chat"
        >
          <Icon name="add" />
        </button>
      </div>
      <div className="advisor-thread-list">
        {state.threads.length ? (
          state.threads.map((thread) => (
            <button
              key={thread.id}
              className={`advisor-thread-row${thread.id === state.activeThreadId ? ' active' : ''}`}
              type="button"
              {...withClick(actions.action('select-advisor-thread', { threadId: thread.id }), () =>
                controller.selectThread(thread.id)
              )}
            >
              <Icon name="chat_bubble" />
              <span>
                <strong>{thread.title}</strong>
                <small>
                  {thread.rangeLabel || formatUiDateTime(thread.updatedAt) || 'Advisor chat'}
                </small>
                <em>{thread.messages.length} messages</em>
              </span>
            </button>
          ))
        ) : (
          <div className="advisor-thread-empty">No saved chats yet.</div>
        )}
      </div>
    </aside>
  );
}

function AttachmentList({ attachments, removable = false, onRemove }) {
  if (!attachments.length) return null;
  return (
    <div className={removable ? 'advisor-composer-attachments' : 'advisor-message-attachments'}>
      {attachments.map((attachment) => (
        <div key={attachment.id} className="advisor-attachment-chip">
          <span className="advisor-attachment-file-icon">
            <Icon name={attachment.kind === 'image' ? 'image' : 'description'} />
          </span>
          <span>
            <strong>{attachment.name}</strong>
            <small>{attachment.mimeType || attachment.kind}</small>
          </span>
          {removable ? (
            <button
              aria-label={`Remove ${attachment.name}`}
              className="advisor-attachment-remove"
              onClick={() => onRemove(attachment.id)}
              type="button"
            >
              <Icon name="close" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Message({ message, onSelectSource, onIntent }) {
  return (
    <article className={`advisor-message ${message.role}`}>
      <span className="advisor-message-avatar">
        <Icon name={message.role === 'user' ? 'person' : 'psychology_alt'} />
      </span>
      <div className="advisor-message-content">
        <div className="advisor-message-meta">
          <strong>{message.role === 'user' ? 'You' : 'Advisor'}</strong>
          <time dateTime={message.createdAt}>{formatUiDateTime(message.createdAt)}</time>
        </div>
        <div className="advisor-message-body">
          {message.format === 'rich' ? (
            <SanitizedRichText html={message.richText} />
          ) : (
            <p>{message.text}</p>
          )}
        </div>
        <AttachmentList attachments={message.attachments} />
        {message.references.length ? (
          <div className="advisor-source-ref-strip">
            {message.references.flatMap((reference) =>
              reference.sourceRefs.map((sourceRef) => (
                <button
                  key={`${message.id}-${sourceRef}`}
                  className="advisor-source-token"
                  onClick={() => onSelectSource(sourceRef)}
                  type="button"
                >
                  {reference.label}: {sourceRef}
                </button>
              ))
            )}
          </div>
        ) : null}
        {message.actions.length ? (
          <div className="advisor-message-actions">
            {message.actions.map((action, index) => (
              <button
                key={action.id || `${action.type}-${index}`}
                className="btn"
                onClick={() => onIntent('advisor/provider-action', action)}
                type="button"
              >
                <Icon name="rule" />
                {advisorActionLabel(action)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function SourcePanel({ state, controller }) {
  const selected =
    state.sources.find((source) => source.id === state.selectedSourceId) ||
    state.sources[0] ||
    null;
  return (
    <aside className="advisor-source-drawer">
      <div className="advisor-source-rail-head">
        <div>
          <Icon name="database" />
          <span>
            <strong>Sources</strong>
            <small>Evidence used in this chat</small>
          </span>
        </div>
        <button
          aria-label="Close sources"
          className="btn btn-icon"
          onClick={controller.toggleSourcePanel}
          type="button"
        >
          <Icon name="right_panel_close" />
        </button>
      </div>
      {state.sources.length ? (
        <>
          <div className="advisor-source-row-list">
            {state.sources.map((source) => (
              <button
                key={source.id}
                className={`advisor-source-row${source.id === state.selectedSourceId ? ' active' : ''}`}
                onClick={() => controller.selectSource(source.id)}
                type="button"
              >
                <Icon name="description" />
                <span>
                  <strong>{source.label}</strong>
                  <small>{source.id}</small>
                </span>
              </button>
            ))}
          </div>
          {selected ? (
            <section className="advisor-source-block">
              <small>{selected.kind}</small>
              <p>{selected.detail || selected.id}</p>
            </section>
          ) : null}
        </>
      ) : (
        <div className="advisor-source-empty">
          <span className="advisor-source-empty-art">
            <Icon name="travel_explore" />
          </span>
          <strong>No sources yet</strong>
          <p>Ask a workbook question to see grounded references.</p>
        </div>
      )}
    </aside>
  );
}

function AdvisorComposer({ state, controller, actions }) {
  const voice = state.voiceButton || {};
  const voiceStatus = state.voiceStatus || {};
  function submit(event) {
    event.preventDefault();
    controller.submit();
  }
  return (
    <form className="advisor-form" id="advisor-chat-form" onSubmit={submit}>
      <AttachmentList
        attachments={state.attachments}
        onRemove={controller.removeAttachment}
        removable
      />
      <div className="advisor-composer-box">
        <button
          aria-label="Add attachment"
          className="btn advisor-attach-button advisor-image-upload-button"
          disabled={state.attachments.length >= state.attachmentLimit}
          title="Upload receipt image"
          type="button"
          {...withClick(actions.action('attach-advisor-file'), () =>
            controller.emitIntent(ADVISOR_INTENTS.PICK_ATTACHMENTS, {
              accept: state.attachmentAccept,
              remaining: state.attachmentLimit - state.attachments.length
            })
          )}
        >
          <Icon name="image" />
          <span>Upload image</span>
        </button>
        <button
          aria-label={voice.ariaLabel || 'Dictate to Advisor'}
          className={`btn btn-icon advisor-voice-button ${voice.className || ''}`}
          disabled={voice.disabled === true}
          title={voice.title || 'Dictate to Advisor'}
          type="button"
          {...withClick(actions.action('toggle-advisor-voice'), () =>
            controller.emitIntent(ADVISOR_INTENTS.TOGGLE_VOICE, { status: voice.status || 'idle' })
          )}
        >
          <Icon name={voice.icon || 'mic'} />
        </button>
        <textarea
          aria-label="Ask Advisor"
          disabled={state.pending}
          onChange={(event) => controller.setComposer(event.target.value)}
          placeholder="Ask about a transaction, bill, budget, or draft"
          rows="3"
          value={state.composer}
        />
        {state.pending ? (
          <button
            aria-label="Stop thinking"
            className="btn btn-primary advisor-send-button advisor-stop-button"
            onClick={controller.cancel}
            title="Stop thinking"
            type="button"
          >
            <Icon name="stop_circle" />
            <span>Stop</span>
          </button>
        ) : (
          <button
            className="btn btn-primary advisor-send-button"
            disabled={!state.composer.trim()}
            title="Ask Advisor"
            type="submit"
          >
            <Icon name="send" />
            <span>Ask</span>
          </button>
        )}
      </div>
      {voiceStatus.visible ? (
        <div className={`advisor-voice-status ${voiceStatus.className}`} role="status">
          <Icon name={voiceStatus.icon} />
          <span>{voiceStatus.copy}</span>
          {voiceStatus.timerCopy ? <small>{voiceStatus.timerCopy}</small> : null}
        </div>
      ) : null}
      {state.error ? (
        <p className="panel-note status-bad" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function AdvisorView({ workbook, model, services, onAction, onCommandResult, onIntent }) {
  const actions = useActionBindings();
  const controller = useAdvisorController({ workbook, model, services, onCommandResult, onIntent });
  const { state } = controller;
  const workspaceClassName = [
    'advisor-workspace',
    state.threadOpen ? '' : 'advisor-thread-collapsed',
    state.sourceOpen ? 'advisor-source-open' : 'advisor-source-collapsed'
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section data-react-route="advisor">
      <section className={workspaceClassName}>
        {state.threadOpen ? (
          <ThreadPanel actions={actions} controller={controller} state={state} />
        ) : null}
        <article className="advisor-chat-card advisor-chat-card-standard advisor-chat-card-v2 advisor-chat-main">
          <div className="advisor-chat-header">
            <div>
              <h3>Advisor</h3>
              <p>{state.chatTitle}</p>
            </div>
            <div className="advisor-header-actions">
              <button
                aria-label="Toggle chats"
                className="btn btn-icon"
                title="Toggle chats"
                type="button"
                {...withClick(
                  actions.action('toggle-advisor-thread-panel'),
                  controller.toggleThreadPanel
                )}
              >
                <Icon name={state.threadOpen ? 'left_panel_close' : 'left_panel_open'} />
              </button>
              <button
                aria-label="Export active chat"
                className="btn btn-icon"
                disabled={!state.messages.length}
                onClick={() =>
                  controller.emitIntent(ADVISOR_INTENTS.EXPORT_THREAD, {
                    threadId: state.activeThreadId
                  })
                }
                title="Export active chat"
                type="button"
              >
                <Icon name="download" />
              </button>
              <button
                aria-label="Toggle sources"
                className="btn btn-icon"
                onClick={controller.toggleSourcePanel}
                title="Toggle sources"
                type="button"
              >
                <Icon name="database" />
              </button>
              <button
                aria-label="Advisor settings"
                className="btn btn-icon"
                title="Advisor settings"
                type="button"
                {...withClick(actions.navigate('settings'), () =>
                  controller.emitIntent(ADVISOR_INTENTS.OPEN_SETTINGS)
                )}
              >
                <Icon name="tune" />
              </button>
              <button
                aria-label="Clear chat"
                className="btn btn-icon"
                disabled={!state.activeThreadId}
                onClick={controller.deleteThread}
                title="Clear chat"
                type="button"
              >
                <Icon name="delete_sweep" />
              </button>
            </div>
          </div>
          <div className="advisor-message-list">
            {state.messages.length ? (
              state.messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  onIntent={controller.emitIntent}
                  onSelectSource={controller.selectSource}
                />
              ))
            ) : (
              <div className="advisor-empty-chat">
                <Icon name="chat" />
                <strong>Start a new Advisor chat</strong>
                <p>Ask about spending, budgets, bills, or the transactions behind a number.</p>
              </div>
            )}
          </div>
          {!state.messages.length ? (
            <div className="advisor-prompt-grid">
              {state.questionPresets.map((prompt) => (
                <button key={prompt} onClick={() => controller.submit(prompt)} type="button">
                  <Icon name="north_east" />
                  <span>{prompt}</span>
                </button>
              ))}
            </div>
          ) : null}
          <AdvisorComposer actions={actions} controller={controller} state={state} />
        </article>
        {state.sourceOpen ? <SourcePanel controller={controller} state={state} /> : null}
      </section>
    </section>
  );
}

export function AdvisorRoute(props) {
  const forwardIntent = props.onIntent || props.onAction;
  return (
    <ActionBindingProvider onAction={props.onAction}>
      <AdvisorView {...props} onIntent={forwardIntent} />
    </ActionBindingProvider>
  );
}
