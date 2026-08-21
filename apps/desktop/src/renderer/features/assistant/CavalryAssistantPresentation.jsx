import React, { useEffect, useId, useRef, useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

import { formatUiDateTime } from '../../shared/date-format.js';
import { MarkdownText } from '../../shared/MarkdownText.jsx';
import { CavalryAssistantMark } from './CavalryAssistantMark.jsx';
import {
  cavalryAssistantActionReceiptMessage,
  isCavalryAssistantSuccessfulNoOpWriteReceipt
} from './cavalry-assistant-action-results.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

export function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

export function AssistantHeaderMenu({
  canExport,
  historyOpen,
  onExportChat,
  onOpenFeedback,
  onOpenSettings,
  onToggleHistory,
  pending
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    // Capture phase so Escape dismisses the menu before the panel-level handler
    // sees it and closes the whole assistant.
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  return (
    <div className="cavalry-assistant-header-menu" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More options"
        className={`btn btn-icon${open || historyOpen ? ' active' : ''}`}
        onClick={() => setOpen((current) => !current)}
        title="More options"
        type="button"
      >
        <Icon name="more_vert" />
      </button>
      {open ? (
        <div className="cavalry-assistant-header-menu-list" role="menu">
          <button
            aria-pressed={historyOpen}
            className={`cavalry-assistant-header-menu-item${historyOpen ? ' active' : ''}`}
            disabled={pending}
            onClick={() => {
              setOpen(false);
              onToggleHistory();
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="history" />
            Chat history
          </button>
          <button
            className="cavalry-assistant-header-menu-item"
            disabled={!canExport}
            onClick={() => {
              setOpen(false);
              onExportChat?.();
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="download" />
            Export chat
          </button>
          <button
            className="cavalry-assistant-header-menu-item"
            onClick={() => {
              setOpen(false);
              onOpenSettings?.();
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="tune" />
            Assistant settings
          </button>
          <button
            className="cavalry-assistant-header-menu-item feedback"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              onOpenFeedback?.();
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="bug_report" />
            Report a problem
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function serializeConversationMarkdown(conversation) {
  const title = asText(conversation?.title) || 'Cavalry chat';
  const lines = [`# ${title}`];
  asArray(conversation?.messages).forEach((message, messageIndex) => {
    const speaker = message?.role === 'user' ? 'You' : 'Cavalry';
    const timestamp = message?.createdAt ? ` — ${formatUiDateTime(message.createdAt)}` : '';
    const referencesByAnchor = new Map(
      asArray(message?.references)
        .map((reference) => [asText(reference?.anchor), reference])
        .filter(([anchor]) => anchor)
    );
    const footnotes = [];
    const footnoteIds = new Map();
    const messageText = asText(message?.text).replace(
      /\[source\]\((#cavalry-source-[a-z0-9_-]+)\)/gi,
      (_match, anchor) => {
        const reference = referencesByAnchor.get(anchor);
        if (!reference) return '[source]';
        let footnoteId = footnoteIds.get(anchor);
        if (!footnoteId) {
          footnoteId = `source-${messageIndex + 1}-${footnotes.length + 1}`;
          footnoteIds.set(anchor, footnoteId);
          const sourceRefs = asArray(reference?.source_refs).map(asText).filter(Boolean);
          const shownSourceRefs = sourceRefs.slice(0, 4);
          const remaining = Math.max(0, sourceRefs.length - shownSourceRefs.length);
          const label = asText(reference?.label) || 'Supporting records';
          footnotes.push(
            `[^${footnoteId}]: ${label}${
              shownSourceRefs.length ? ` — ${shownSourceRefs.join(', ')}` : ''
            }${remaining ? `, plus ${remaining} more` : ''}`
          );
        }
        return `[^${footnoteId}]`;
      }
    );
    lines.push('', `## ${speaker}${timestamp}`, '', messageText);
    const attachmentCount = asArray(message?.attachments).length;
    if (attachmentCount) {
      lines.push('', `_Attached ${attachmentCount} ${attachmentCount === 1 ? 'image' : 'images'}_`);
    }
    if (footnotes.length) lines.push('', ...footnotes);
  });
  return `${lines.join('\n')}\n`;
}

const REFERENCE_KIND_PRESENTATION = Object.freeze({
  account: { icon: 'account_balance_wallet', label: 'Account' },
  transaction: { icon: 'receipt_long', label: 'Transaction' },
  category: { icon: 'label', label: 'Category' },
  sheet: { icon: 'calendar_month', label: 'Budget month' },
  budget: { icon: 'savings', label: 'Budget' },
  budgetlineitem: { icon: 'savings', label: 'Budget' },
  bill: { icon: 'event_repeat', label: 'Bill or subscription' },
  subscription: { icon: 'subscriptions', label: 'Bill or subscription' },
  recurringitem: { icon: 'event_repeat', label: 'Bill or subscription' },
  billsubscription: { icon: 'event_repeat', label: 'Bill or subscription' },
  evidence: { icon: 'fact_check', label: 'Supporting records' }
});

function referenceKindPresentation(kind) {
  const key = asText(kind)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return REFERENCE_KIND_PRESENTATION[key] || { icon: 'link', label: 'Record' };
}

function referenceRecordKey(reference, index) {
  const sourceRefs = asArray(reference?.source_refs).map(asText).filter(Boolean);
  return sourceRefs.length
    ? sourceRefs.slice().sort().join('\u001f')
    : asText(reference?.id) || `reference-${index}`;
}

function uniqueReferenceText(values) {
  const output = [];
  const seen = new Set();
  asArray(values).forEach((value) => {
    const text = asText(value);
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    output.push(text);
  });
  return output;
}

function referenceRecords(reference) {
  const existing = asArray(reference?.detail?.records);
  if (existing.length) return existing;
  const sourceRefs = asArray(reference?.source_refs).map(asText).filter(Boolean);
  return sourceRefs.map((sourceRef) => ({
    source_ref: sourceRef,
    label: asText(reference?.label || reference?.token) || sourceRef,
    kind: asText(reference?.kind),
    detail: sourceRefs.length === 1 ? asObject(reference?.detail) : {}
  }));
}

function groupedClaimReferences(references) {
  const source = asArray(references).filter(
    (reference) => reference && typeof reference === 'object'
  );
  const buckets = new Map();
  source.forEach((reference) => {
    if (asText(reference.anchor)) return;
    const label = asText(reference.label || reference.token);
    const kind = asText(reference.kind).toLocaleLowerCase();
    if (!label || !kind) return;
    const key = `${kind}\u0000${label.toLocaleLowerCase()}`;
    const bucket = buckets.get(key) || [];
    bucket.push(reference);
    buckets.set(key, bucket);
  });
  const emitted = new Set();
  return source.flatMap((reference) => {
    if (asText(reference.anchor)) return [reference];
    const label = asText(reference.label || reference.token);
    const kind = asText(reference.kind).toLocaleLowerCase();
    const key = `${kind}\u0000${label.toLocaleLowerCase()}`;
    const bucket = buckets.get(key) || [reference];
    if (bucket.length === 1) return [reference];
    if (emitted.has(key)) return [];
    emitted.add(key);
    const sourceRefs = uniqueReferenceText(bucket.flatMap((item) => asArray(item.source_refs)));
    const records = new Map();
    bucket.flatMap(referenceRecords).forEach((record) => {
      const sourceRef = asText(record?.source_ref || record?.sourceRef);
      if (sourceRef && !records.has(sourceRef)) records.set(sourceRef, record);
    });
    return [
      {
        ...bucket[0],
        id: `claim-group:${kind}:${sourceRefs.join('|')}`,
        token: label,
        aliases: uniqueReferenceText([
          label,
          ...bucket.flatMap((item) => [item.token, ...asArray(item.aliases)])
        ]),
        source_refs: sourceRefs,
        detail: {
          ...asObject(bucket[0].detail),
          ...(kind === 'transaction' ? { transactionCount: sourceRefs.length } : {}),
          records: [...records.values()]
        }
      }
    ];
  });
}

function ActionReceipt({ receipt }) {
  const source = asObject(receipt);
  const lifecycle = asText(source.lifecycle);
  const committed = asText(source.commitStatus) === 'committed';
  const verification = asText(source.verificationStatus);
  const durable = asObject(source.persistence).durable === true;
  const verifiedDurable = committed && verification === 'verified' && durable;
  const noOpWrite = isCavalryAssistantSuccessfulNoOpWriteReceipt(source);
  const summary = cavalryAssistantActionReceiptMessage(source);
  const itemLabels = asArray(source.items)
    .map((item) => asText(asObject(item).label || asObject(item).id))
    .filter(Boolean)
    .slice(0, 4);
  const cardDetail =
    itemLabels.join(' · ') ||
    asText(asObject(source.entity).label || asObject(source.entity).id) ||
    (noOpWrite
      ? 'Already current'
      : asObject(source.persistence).durable === true
        ? 'Durable workbook change'
        : 'Structured action result');
  const stateLabel =
    lifecycle === 'rolled_back'
      ? 'Rolled back'
      : lifecycle === 'cancelled'
        ? 'Cancelled'
        : noOpWrite
          ? 'No change needed'
          : verifiedDurable
            ? 'Saved · verified'
            : committed && verification === 'verified'
              ? 'Committed · durability unverified'
              : committed && verification === 'failed'
                ? 'Saved · verification failed'
                : committed
                  ? 'Saved · verification pending'
                  : lifecycle === 'failed'
                    ? 'Failed'
                    : lifecycle.replace(/_/g, ' ');
  const iconName =
    verifiedDurable || noOpWrite
      ? 'check_circle'
      : lifecycle === 'failed' || lifecycle === 'rolled_back' || verification === 'failed'
        ? 'error'
        : 'info';
  if (!summary && !lifecycle) return null;
  return (
    <section
      aria-label="Action result"
      className={`cavalry-assistant-action-receipt ${verifiedDurable ? 'committed' : lifecycle}`}
    >
      <Icon name={iconName} />
      <span>
        <strong>{asText(source.title || source.actionVerb) || 'Action result'}</strong>
        <small>{cardDetail}</small>
      </span>
      <span className="cavalry-assistant-action-receipt-state">{stateLabel}</span>
    </section>
  );
}

function compactReferenceId(reference) {
  const sourceRef = asText(asArray(reference?.source_refs)[0]);
  const id = sourceRef.includes(':') ? sourceRef.slice(sourceRef.indexOf(':') + 1) : sourceRef;
  if (!id) return '';
  return id.length > 14 ? `…${id.slice(-10)}` : id;
}

function readableReferenceValue(value) {
  const text = asText(value).replace(/[_-]+/g, ' ');
  return text ? text.replace(/\b\w/g, (character) => character.toUpperCase()) : '';
}

function formatReferenceMoney(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  const currencyCode = asText(currency).toUpperCase() || 'PHP';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'narrowSymbol'
    }).format(amount);
  } catch (_error) {
    return `${currencyCode} ${amount.toLocaleString('en-US')}`;
  }
}

function formatReferenceDate(value) {
  // timeZone pinned so date-only strings (parsed as UTC midnight) match the
  // inline chip captions in every viewer timezone.
  return formatUiDateTime(value, {
    format: { month: 'short', day: 'numeric', year: undefined, timeZone: 'UTC' }
  });
}

function referenceDetailCopy(reference) {
  const detail = asObject(reference?.detail);
  if (reference?.kind === 'transaction') {
    const records = asArray(detail.records);
    const sourceCount = Math.max(Number(detail.sourceCount) || 0, records.length);
    if (sourceCount) {
      const dates = records
        .map((record) => asText(record?.detail?.date))
        .filter(Boolean)
        .sort();
      return [
        `${sourceCount} transactions`,
        dates.length
          ? dates[0] === dates.at(-1)
            ? formatReferenceDate(dates[0])
            : `${formatReferenceDate(dates[0])}–${formatReferenceDate(dates.at(-1))}`
          : ''
      ]
        .filter(Boolean)
        .join(' · ');
    }
    return [
      formatReferenceDate(detail.date),
      formatReferenceMoney(detail.amount, detail.currency),
      readableReferenceValue(detail.type)
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (reference?.kind === 'account') {
    return [
      asText(detail.institution),
      readableReferenceValue(detail.subtype || detail.group),
      detail.balance == null
        ? ''
        : `Balance ${formatReferenceMoney(detail.balance, detail.currency)}`
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (reference?.kind === 'category') {
    return [readableReferenceValue(detail.type), asText(detail.description)]
      .filter(Boolean)
      .join(' · ');
  }
  if (reference?.kind === 'budget') {
    return [
      asText(detail.sheetName || detail.monthKey),
      detail.planned == null
        ? ''
        : `Planned ${formatReferenceMoney(detail.planned, detail.currency)}`,
      detail.actual == null ? '' : `Actual ${formatReferenceMoney(detail.actual, detail.currency)}`
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (reference?.kind === 'sheet') {
    return [asText(detail.monthKey), asText(detail.currency).toUpperCase()]
      .filter(Boolean)
      .join(' · ');
  }
  if (reference?.kind === 'recurringItem') {
    return [
      readableReferenceValue(detail.kind),
      readableReferenceValue(detail.frequency),
      formatReferenceMoney(detail.amount, detail.currency),
      detail.dueDate ? `Due ${formatReferenceDate(detail.dueDate)}` : ''
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (reference?.kind === 'evidence') {
    const recordCount = Math.max(Number(detail.sourceCount) || 0, asArray(detail.records).length);
    return recordCount ? `${recordCount} supporting records` : '';
  }
  return '';
}

function uniqueRecordReferences(references) {
  const records = new Map();
  asArray(references).forEach((reference, index) => {
    if (!(reference && typeof reference === 'object')) return;
    const key = referenceRecordKey(reference, index);
    if (!records.has(key)) records.set(key, reference);
  });
  return [...records.entries()].map(([key, reference]) => ({ key, reference }));
}

function childRecordReferences(reference) {
  const bySourceRef = new Map(
    asArray(reference?.detail?.records)
      .map((record) => {
        const sourceRef = asText(record?.source_ref || record?.sourceRef);
        if (!sourceRef) return null;
        return [
          sourceRef,
          {
            id: sourceRef,
            token: asText(record?.label) || sourceRef,
            label: asText(record?.label) || sourceRef,
            kind: asText(record?.kind) || asText(reference?.kind),
            source_refs: [sourceRef],
            detail: asObject(record?.detail)
          }
        ];
      })
      .filter(Boolean)
  );
  return asArray(reference?.source_refs).map((sourceRef) => {
    const normalized = asText(sourceRef);
    return (
      bySourceRef.get(normalized) || {
        id: normalized,
        token: normalized,
        label: asText(reference?.label) || normalized,
        kind: asText(reference?.kind),
        source_refs: [normalized],
        detail: {}
      }
    );
  });
}

function ReferencedRecords({
  expanded,
  expandedGroupId,
  onOpenReference,
  onToggleExpanded,
  onToggleGroup,
  references
}) {
  const listId = useId();
  const records = uniqueRecordReferences(references);
  if (typeof onOpenReference !== 'function' || !records.length) return null;
  const labelCounts = records.reduce((counts, { reference }) => {
    const label = asText(reference.label || reference.token).toLocaleLowerCase();
    counts.set(label, (counts.get(label) || 0) + 1);
    return counts;
  }, new Map());

  return (
    <section aria-label="Referenced records" className="cavalry-assistant-references">
      <button
        aria-controls={expanded ? listId : undefined}
        aria-expanded={expanded}
        aria-label={`See references (${records.length})`}
        className="cavalry-assistant-references-toggle"
        onClick={onToggleExpanded}
        type="button"
      >
        <Icon name="link" />
        <span>{expanded ? 'Hide references' : 'See references'}</span>
        <span aria-hidden="true" className="cavalry-assistant-references-count">
          {records.length}
        </span>
        <Icon name="expand_more" />
      </button>
      {!expanded ? null : (
        <ul className="cavalry-assistant-reference-list" id={listId}>
          {records.map(({ key, reference }) => {
            const presentation = referenceKindPresentation(reference.kind);
            const label = asText(reference.label || reference.token) || presentation.label;
            const duplicateLabel = (labelCounts.get(label.toLocaleLowerCase()) || 0) > 1;
            const idHint = duplicateLabel ? compactReferenceId(reference) : '';
            const detail = referenceDetailCopy(reference);
            const accessibleDetail = [detail, idHint].filter(Boolean).join(', ');
            const childRecords = childRecordReferences(reference);
            const grouped = childRecords.length > 1;
            const groupId = key;
            const groupExpanded = grouped && expandedGroupId === groupId;
            return (
              <li key={key}>
                <button
                  aria-label={`Open ${presentation.label}: ${label}${
                    accessibleDetail ? `, ${accessibleDetail}` : ''
                  }`}
                  className="cavalry-assistant-reference-chip"
                  data-reference-kind={reference.kind || undefined}
                  onClick={() => (grouped ? onToggleGroup(groupId) : onOpenReference(reference))}
                  aria-expanded={grouped ? groupExpanded : undefined}
                  type="button"
                >
                  <Icon name={presentation.icon} />
                  <span>
                    <strong>{label}</strong>
                    <small>
                      {[presentation.label, detail, idHint].filter(Boolean).join(' · ')}
                    </small>
                  </span>
                  {grouped ? <Icon name={groupExpanded ? 'expand_less' : 'expand_more'} /> : null}
                </button>
                {groupExpanded ? (
                  <ul
                    aria-label={`Sources for ${label}`}
                    className="cavalry-assistant-reference-records"
                  >
                    {childRecords.map((record, recordIndex) => {
                      const childPresentation = referenceKindPresentation(record.kind);
                      return (
                        <li key={`${groupId}-${record.source_refs[0]}-${recordIndex}`}>
                          <button
                            className="cavalry-assistant-reference-record"
                            onClick={() => onOpenReference(record)}
                            type="button"
                          >
                            <Icon name={childPresentation.icon} />
                            <span>
                              <strong>{record.label}</strong>
                              <small>
                                {referenceDetailCopy(record) || childPresentation.label}
                              </small>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Message({
  message,
  activeClarificationId,
  onAnswerClarification,
  onComposeAnswer,
  onOpenReference
}) {
  const assistant = message.role === 'assistant';
  const images = asArray(message.attachments).filter(
    (attachment) => attachment?.kind === 'image' && attachment?.dataUrl
  );
  const clarification = asObject(message.clarification);
  const presentationReferences = groupedClaimReferences(message.references);
  const receipts = asArray(message.receipts).filter(
    (receipt) => receipt && typeof receipt === 'object'
  );
  const [referencesExpanded, setReferencesExpanded] = useState(false);
  const [expandedReferenceId, setExpandedReferenceId] = useState('');
  const clarificationActive =
    assistant && clarification.id && clarification.id === activeClarificationId;
  return (
    <article className={`cavalry-assistant-message ${message.role}`}>
      {assistant ? (
        <CavalryAssistantMark className="cavalry-assistant-message-avatar" />
      ) : (
        <span className="cavalry-assistant-message-avatar">
          <Icon name="person" />
        </span>
      )}
      <div className="cavalry-assistant-message-content">
        <div className="cavalry-assistant-message-meta">
          <strong>{assistant ? 'Cavalry' : 'You'}</strong>
          {message.createdAt ? (
            <time dateTime={message.createdAt}>{formatUiDateTime(message.createdAt)}</time>
          ) : null}
        </div>
        {assistant ? (
          <MarkdownText
            className="cavalry-assistant-markdown"
            onOpenReference={(reference) => {
              if (asArray(reference?.source_refs).length > 1) {
                setReferencesExpanded(true);
                setExpandedReferenceId(referenceRecordKey(reference, 0));
              } else {
                onOpenReference?.(reference);
              }
            }}
            referenceMode="claim"
            references={presentationReferences}
            text={message.text}
          />
        ) : (
          <p>{message.text}</p>
        )}
        {assistant && receipts.length ? (
          <div className="cavalry-assistant-action-receipts">
            {receipts.map((receipt, index) => (
              <ActionReceipt
                key={asText(receipt.actionId || receipt.toolName) || `receipt-${index}`}
                receipt={receipt}
              />
            ))}
          </div>
        ) : null}
        {assistant ? (
          <ReferencedRecords
            expanded={referencesExpanded}
            expandedGroupId={expandedReferenceId}
            onOpenReference={onOpenReference}
            onToggleExpanded={() => setReferencesExpanded((current) => !current)}
            onToggleGroup={(groupId) => {
              setReferencesExpanded(true);
              setExpandedReferenceId((current) => (current === groupId ? '' : groupId));
            }}
            references={presentationReferences}
          />
        ) : null}
        {images.length ? (
          <div className="cavalry-assistant-message-images" aria-label="Attached images">
            {images.map((attachment, index) => (
              <div className="cavalry-assistant-message-image" key={attachment.id || index}>
                <img
                  alt={attachment.name || `Attached image ${index + 1}`}
                  src={attachment.dataUrl}
                />
                <span>{index + 1}</span>
              </div>
            ))}
          </div>
        ) : null}
        {clarificationActive ? (
          <div className="cavalry-assistant-clarification">
            <strong>Choose an answer to continue</strong>
            {asArray(clarification.options).length ? (
              <div
                aria-label="Answer Cavalry's question"
                className="cavalry-assistant-clarification-options"
                role="group"
              >
                {clarification.options.map((option, index) => (
                  <button
                    className="cavalry-assistant-clarification-option"
                    key={option.id || `${option.label}-${index}`}
                    onClick={() => onAnswerClarification(option.label)}
                    type="button"
                  >
                    {option.label}
                    {option.description ? <small>{option.description}</small> : null}
                  </button>
                ))}
              </div>
            ) : null}
            {clarification.allowFreeText !== false ? (
              <button
                className="cavalry-assistant-clarification-option"
                onClick={onComposeAnswer}
                type="button"
              >
                Type another answer…
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ConversationHistory({ activeConversationId, conversations, onSelect }) {
  return (
    <section aria-label="Conversation history" className="cavalry-assistant-history">
      <header>
        <div>
          <h2>Chat history</h2>
          <p>Saved on this Mac for this workbook.</p>
        </div>
        <span>{conversations.length}</span>
      </header>
      {conversations.length ? (
        <div className="cavalry-assistant-history-list">
          {conversations.map((conversation) => {
            const messageCount = asArray(conversation.messages).length;
            return (
              <button
                aria-current={conversation.id === activeConversationId ? 'true' : undefined}
                aria-label={`Resume ${conversation.title}`}
                className={`cavalry-assistant-history-row${
                  conversation.id === activeConversationId ? ' active' : ''
                }`}
                key={conversation.id}
                onClick={() => onSelect(conversation.id)}
                type="button"
              >
                <span className="cavalry-assistant-history-icon">
                  <Icon name="chat_bubble" />
                </span>
                <span className="cavalry-assistant-history-copy">
                  <strong>{conversation.title}</strong>
                  <small>
                    {formatUiDateTime(conversation.updatedAt) || 'Saved conversation'} ·{' '}
                    {messageCount} {messageCount === 1 ? 'message' : 'messages'}
                  </small>
                </span>
                <Icon name="chevron_right" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="cavalry-assistant-history-empty">
          <Icon name="forum" />
          <strong>No saved chats yet</strong>
          <p>Start a conversation and it will appear here automatically.</p>
        </div>
      )}
    </section>
  );
}

export { AssistantSettings } from './CavalryAssistantSettings.jsx';
