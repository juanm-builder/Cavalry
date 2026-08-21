// Normalizes application-owned action outcomes before conversation code can describe them.
// Structured results remain the source of truth; model prose may never promote a proposal or
// failed attempt into a completed financial action.

const ACTION_LIFECYCLES = new Set([
  'requested',
  'proposed',
  'awaiting_confirmation',
  'attempted',
  'completed',
  'cancelled',
  'failed',
  'rolled_back'
]);

const COMMIT_STATUSES = new Set([
  'committed',
  'not_applicable',
  'not_attempted',
  'not_committed',
  'rolled_back',
  'unknown'
]);

const VERIFICATION_STATUSES = new Set(['verified', 'failed', 'not_attempted', 'unknown']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

const PUBLIC_ACTION_FAILURE_MESSAGE = 'Cavalry could not complete that action.';
const PUBLIC_CONFIRMATION_MESSAGE = 'Confirm this action in Cavalry before it changes your data.';

export function sanitizeCavalryAssistantPublicMessage(
  value,
  fallback = PUBLIC_ACTION_FAILURE_MESSAGE,
  maxLength = 600
) {
  const text = asText(value);
  const safeFallback = asText(fallback).slice(0, maxLength) || PUBLIC_ACTION_FAILURE_MESSAGE;
  if (!text) return safeFallback;
  if (
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ||
    /<(?:!doctype|html|head|body|script|style|iframe|object|embed|svg|[a-z][^>]*)\b[^>]*>/i.test(
      text
    ) ||
    /^\s*[\[{]/u.test(text) ||
    /(?:^|\r?\n)\s*(?:at\s+\S|traceback\b|stack(?:\s+trace)?\b)/i.test(text) ||
    /\bfile:\/\/|\/(?:Users|home|private|var|tmp)\/[^\s]+|[A-Za-z]:\\[^\s]+/i.test(text)
  ) {
    return safeFallback;
  }
  const redacted = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, 'Bearer [redacted]')
    .replace(
      /\b(api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]'
    )
    .replace(/\b(?:s[k]|r[k]|p[k])-[A-Za-z0-9_-]{8,}\b/g, '[redacted credential]')
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, '[redacted token]')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted.slice(0, maxLength) || safeFallback;
}

const PRIVATE_RESULT_FIELDS = new Set([
  'workbook',
  'raw',
  'payload',
  'debug',
  'stack',
  'detail',
  'events',
  'commandoutput',
  'logpath',
  'filepath',
  'portablehtml',
  'html',
  'contents',
  'dataurl',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
  'credential',
  'credentials',
  'clientsecret',
  'privatekey'
]);

function publicResultField(key) {
  const normalized = asText(key)
    .replace(/[\s_-]/g, '')
    .toLowerCase();
  return !(
    PRIVATE_RESULT_FIELDS.has(normalized) ||
    normalized.endsWith('logpath') ||
    normalized.endsWith('filepath') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken') ||
    normalized.endsWith('password') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('credential') ||
    normalized.endsWith('credentials') ||
    normalized.endsWith('privatekey')
  );
}

function publicWorkbookSummary(value) {
  const source = asObject(value);
  const keys = Object.keys(source);
  const allowed = new Set(['id', 'name', 'year', 'currency']);
  if (!keys.length || keys.some((key) => !allowed.has(key))) return null;
  return {
    ...(asText(source.id) ? { id: asText(source.id) } : {}),
    ...(asText(source.name) ? { name: asText(source.name) } : {}),
    ...(Number.isFinite(Number(source.year)) ? { year: Number(source.year) } : {}),
    ...(asText(source.currency) ? { currency: asText(source.currency).toUpperCase() } : {})
  };
}

function projectPublicResultValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 64 * 1024);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth >= 12 || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    const projected = value
      .slice(0, 500)
      .map((item) => projectPublicResultValue(item, depth + 1, seen));
    seen.delete(value);
    return projected;
  }
  const projected = Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (
        asText(key)
          .replace(/[\s_-]/g, '')
          .toLowerCase() === 'workbook'
      ) {
        const summary = publicWorkbookSummary(child);
        return summary ? [[key, summary]] : [];
      }
      return publicResultField(key)
        ? [[key, projectPublicResultValue(child, depth + 1, seen)]]
        : [];
    })
  );
  seen.delete(value);
  return projected;
}

function safePublicValue(value, fallback = null) {
  const projected = projectPublicResultValue(value);
  if (projected == null) return projected;
  try {
    return JSON.stringify(projected).length <= 256 * 1024 ? projected : fallback;
  } catch (_error) {
    return fallback;
  }
}

function statusLifecycle(result) {
  const explicit = asText(result.lifecycle).toLowerCase();
  if (ACTION_LIFECYCLES.has(explicit)) return explicit;
  const status = asText(result.status).toLowerCase();
  if (['confirmation_required', 'awaiting_confirmation'].includes(status)) {
    return 'awaiting_confirmation';
  }
  if (['clarification_required', 'proposal_ready', 'proposed'].includes(status)) return 'proposed';
  if (status === 'cancelled' || result.cancelled === true) return 'cancelled';
  if (status.includes('rolled_back') || status.includes('rollback')) return 'rolled_back';
  if (result.ok === true) return 'completed';
  if (result.ok === false) return 'failed';
  return 'attempted';
}

function commitStatus(result, lifecycle, access) {
  const explicit = asText(result.commitStatus || result.commit_status).toLowerCase();
  if (COMMIT_STATUSES.has(explicit)) return explicit;
  if (access === 'read') return lifecycle === 'completed' ? 'not_applicable' : 'not_attempted';
  if (lifecycle === 'rolled_back') return 'rolled_back';
  if (['requested', 'proposed', 'awaiting_confirmation', 'cancelled'].includes(lifecycle)) {
    return 'not_attempted';
  }
  if (lifecycle === 'failed') return 'not_committed';
  return 'unknown';
}

function verificationStatus(result, lifecycle, commit, access) {
  const explicit = asText(result.verificationStatus || result.verification_status).toLowerCase();
  if (VERIFICATION_STATUSES.has(explicit)) return explicit;
  if (asText(result.status).toLowerCase() === 'verification_failed') return 'failed';
  if (access === 'read' && commit === 'not_applicable' && lifecycle === 'completed') {
    return 'verified';
  }
  if (
    ['requested', 'proposed', 'awaiting_confirmation', 'cancelled', 'rolled_back'].includes(
      lifecycle
    )
  ) {
    return 'not_attempted';
  }
  if (lifecycle === 'failed' && commit !== 'committed') return 'not_attempted';
  return 'unknown';
}

function successfulNoOpWriteReceipt(receiptValue) {
  const receipt = asObject(receiptValue);
  return (
    asText(receipt.access).toLowerCase() === 'write' &&
    asText(receipt.lifecycle).toLowerCase() === 'completed' &&
    receipt.changed !== true &&
    asText(receipt.commitStatus).toLowerCase() === 'not_applicable' &&
    asText(receipt.verificationStatus).toLowerCase() === 'verified'
  );
}

export function isCavalryAssistantSuccessfulNoOpWriteReceipt(receiptValue) {
  return successfulNoOpWriteReceipt(receiptValue);
}

function durablePersistence(value) {
  const source = asObject(value);
  const status = asText(source.status).toLowerCase();
  if (source.durable !== true) return null;
  if (!['saved', 'cached', 'previously_committed'].includes(status)) return null;
  return {
    status,
    durable: true,
    ...(asText(source.savedAt || source.saved_at)
      ? { savedAt: asText(source.savedAt || source.saved_at) }
      : {}),
    ...(asText(source.revision) ? { revision: asText(source.revision) } : {})
  };
}

function safePersistence(value, access) {
  const durable = durablePersistence(value);
  if (durable) return durable;
  const source = asObject(value);
  const status = asText(source.status).toLowerCase();
  if (access === 'read' || status === 'not_required') {
    return { status: status || 'not_required', durable: source.durable === true };
  }
  return { status: 'unconfirmed', durable: false };
}

function entityFromData(data) {
  const source = asObject(data);
  const entity =
    source.transaction ||
    source.replacedTransaction ||
    source.originalTransaction ||
    source.createdTransaction ||
    source.deletedTransaction ||
    source.account ||
    source.card ||
    source.wallet ||
    source.category ||
    source.recurringItem ||
    source.counterparty ||
    source.budget ||
    source.memory ||
    source.record;
  return asObject(entity);
}

function safeError(error, fallback = PUBLIC_ACTION_FAILURE_MESSAGE) {
  const source = asObject(error);
  const projected = {
    code: asText(source.code) || 'action_failed',
    message: sanitizeCavalryAssistantPublicMessage(
      source.userMessage || source.message || error,
      fallback
    ),
    ...(asText(source.field) ? { field: asText(source.field) } : {})
  };
  ['accountId', 'accountName', 'configuredCurrency', 'transactionCurrency', 'baseCurrency'].forEach(
    (field) => {
      if (asText(source[field])) projected[field] = asText(source[field]);
    }
  );
  if (Number(source.fxRateToBase) > 0) projected.fxRateToBase = Number(source.fxRateToBase);
  ['postingCurrencies', 'affectedTransactionIds'].forEach((field) => {
    const values = asArray(source[field]).map(asText).filter(Boolean).slice(0, 100);
    if (values.length) projected[field] = values;
  });
  const accounts = asArray(source.accounts)
    .slice(0, 100)
    .map((account) => {
      const item = asObject(account);
      const safe = {
        ...(asText(item.accountId || item.id)
          ? { accountId: asText(item.accountId || item.id) }
          : {}),
        ...(asText(item.accountName || item.name)
          ? { accountName: asText(item.accountName || item.name) }
          : {}),
        ...(asText(item.accountCurrency || item.currency)
          ? { accountCurrency: asText(item.accountCurrency || item.currency).toUpperCase() }
          : {})
      };
      return Object.keys(safe).length ? safe : null;
    })
    .filter(Boolean);
  if (accounts.length) projected.accounts = accounts;
  return projected;
}

function safeConfirmation(value) {
  const source = asObject(value);
  if (source.required !== true) return null;
  const field = asText(source.field);
  const proposal = safePublicValue(source.proposal, null);
  return {
    required: true,
    ...(field && /^[a-z][a-zA-Z0-9]*$/.test(field) ? { field } : {}),
    action: sanitizeCavalryAssistantPublicMessage(source.action, 'complete this action', 300),
    message: sanitizeCavalryAssistantPublicMessage(source.message, PUBLIC_CONFIRMATION_MESSAGE),
    ...(proposal && typeof proposal === 'object' ? { proposal } : {})
  };
}

function accountReceipts(data, entity) {
  const source = asObject(data);
  const relatedTransactions = [
    ...asArray(source.replacements),
    ...asArray(source.createdTransactions)
  ];
  const candidates = [
    ...asArray(source.accounts),
    ...asArray(source.routing?.accounts),
    ...asArray(entity.accounts),
    ...asArray(entity.lines),
    ...relatedTransactions.flatMap((transaction) => [
      ...asArray(asObject(transaction).accounts),
      ...asArray(asObject(transaction).lines)
    ])
  ];
  const seen = new Set();
  return candidates
    .map((account) => {
      const item = asObject(account);
      const id = asText(item.id || item.accountId);
      const name = asText(item.name || item.accountName || item.label);
      const role = asText(item.role || item.accountRole || item.direction);
      const key = `${id}|${name}|${role}`;
      if ((!id && !name) || seen.has(key)) return null;
      seen.add(key);
      return { id, name, role };
    })
    .filter(Boolean);
}

function actionItem(value) {
  const item = asObject(value);
  const amount = Number(item.amount ?? item.planned);
  return {
    id: asText(item.id),
    label: asText(item.description || item.name || item.categoryName || item.label || item.id),
    amount: Number.isFinite(amount) ? amount : null,
    currency: asText(item.currency).toUpperCase(),
    date: asText(item.date || item.month || item.sheetName),
    accounts: accountReceipts(item, item)
  };
}

export function createCavalryAssistantActionReceipt(resultValue, metadata = {}) {
  const result = asObject(resultValue);
  const data = asObject(result.data);
  const entity = entityFromData(data);
  const lifecycle = statusLifecycle(result);
  const access = asText(metadata.access || result.access).toLowerCase() || 'write';
  const commit = commitStatus(result, lifecycle, access);
  const verification = verificationStatus(result, lifecycle, commit, access);
  const noOpWrite = successfulNoOpWriteReceipt({
    access,
    lifecycle,
    changed: result.changed === true,
    commitStatus: commit,
    verificationStatus: verification
  });
  const explicit = asObject(result.receipt);
  const amount = Number(explicit.amount ?? entity.amount ?? entity.planned ?? data.amount);
  const items = asArray(explicit.items).length
    ? asArray(explicit.items).map(actionItem)
    : [...asArray(data.replacements), ...asArray(data.createdTransactions)].map(actionItem);
  return {
    kind: 'action_receipt',
    actionId: asText(explicit.actionId || metadata.actionId),
    toolName: asText(explicit.toolName || metadata.toolName || result.toolName),
    title: asText(explicit.title || metadata.title),
    actionVerb: asText(explicit.actionVerb || metadata.actionVerb),
    access,
    lifecycle,
    commitStatus: commit,
    verificationStatus: verification,
    changed: result.changed === true,
    entity: {
      id: asText(explicit.entity?.id || entity.id || data.id),
      type: asText(explicit.entity?.type || data.entityType || metadata.entityType),
      label: asText(
        explicit.entity?.label ||
          entity.description ||
          entity.name ||
          entity.categoryName ||
          entity.label ||
          entity.id ||
          data.label
      )
    },
    amount: Number.isFinite(amount) ? amount : null,
    currency: asText(explicit.currency || entity.currency || data.currency).toUpperCase(),
    date: asText(explicit.date || entity.date || entity.month || data.date || data.month),
    accounts: accountReceipts({ ...data, accounts: explicit.accounts || data.accounts }, entity),
    items: items.filter((item) => item.id || item.label),
    warnings: asArray(result.warnings).map((warning) =>
      safeError(warning, 'Cavalry omitted an unsafe warning message.')
    ),
    errors: asArray(result.errors).map((error) => safeError(error)),
    persistence: noOpWrite
      ? { status: 'not_required', durable: true }
      : safePersistence(result.persistence, access)
  };
}

export function normalizeCavalryAssistantActionResult(resultValue, metadata = {}) {
  const rawResult = asObject(resultValue);
  const access = asText(metadata.access || rawResult.access).toLowerCase() || 'write';
  const claimedPersistence = durablePersistence(rawResult.persistence);
  const unprovenWrite =
    access === 'write' &&
    rawResult.ok === true &&
    rawResult.changed === true &&
    !(
      asText(rawResult.commitStatus || rawResult.commit_status).toLowerCase() === 'committed' &&
      asText(rawResult.verificationStatus || rawResult.verification_status).toLowerCase() ===
        'verified' &&
      claimedPersistence
    );
  const result = unprovenWrite
    ? {
        ...rawResult,
        ok: false,
        status: 'commit_unconfirmed',
        errors: asArray(rawResult.errors).concat({
          code: 'durable_commit_receipt_required',
          message:
            'Cavalry could not prove that this change was durably saved and verified. Review the affected record before relying on it.'
        })
      }
    : rawResult;
  const receipt = createCavalryAssistantActionReceipt(result, metadata);
  const confirmation = safeConfirmation(result.confirmation);
  return {
    ok: result.ok === true,
    toolName: asText(result.toolName || metadata.toolName),
    ...(asText(result.toolCallId) ? { toolCallId: asText(result.toolCallId) } : {}),
    status: asText(result.status) || (result.ok === true ? 'completed' : 'failed'),
    lifecycle: receipt.lifecycle,
    commitStatus: receipt.commitStatus,
    verificationStatus: receipt.verificationStatus,
    changed: result.changed === true,
    warnings: asArray(result.warnings).map((warning) =>
      safeError(warning, 'Cavalry omitted an unsafe warning message.')
    ),
    errors: asArray(result.errors).map((error) => safeError(error)),
    data: safePublicValue(result.data, null),
    persistence: receipt.persistence,
    ...(Object.prototype.hasOwnProperty.call(result, 'referenceData')
      ? { referenceData: safePublicValue(result.referenceData, null) }
      : {}),
    ...(confirmation ? { confirmation } : {}),
    receipt
  };
}

function quoted(value) {
  const text = asText(value);
  return text ? `“${text}”` : '';
}

function receiptDetails(receipt) {
  if (asArray(receipt.items).length) {
    return asArray(receipt.items)
      .slice(0, 8)
      .map((itemValue) => {
        const item = asObject(itemValue);
        const parts = [];
        const label = asText(item.label || item.id);
        if (label) parts.push(label);
        if (Number.isFinite(Number(item.amount))) {
          parts.push(
            `${asText(item.currency) ? `${asText(item.currency)} ` : ''}${Number(item.amount).toLocaleString()}`
          );
        }
        const accounts = asArray(item.accounts)
          .map((account) => asText(asObject(account).name || asObject(account).id))
          .filter(Boolean);
        if (accounts.length) parts.push(accounts.join(' → '));
        if (asText(item.date)) parts.push(asText(item.date));
        return parts.join(' · ');
      })
      .filter(Boolean)
      .join('; ');
  }
  const details = [];
  if (receipt.amount != null) {
    details.push(
      `${receipt.currency ? `${receipt.currency} ` : ''}${receipt.amount.toLocaleString()}`
    );
  }
  if (receipt.accounts.length) {
    const names = receipt.accounts.map((account) => account.name || account.id).filter(Boolean);
    if (names.length) details.push(names.join(' → '));
  }
  if (receipt.date) details.push(receipt.date);
  return details.join(' · ');
}

export function cavalryAssistantActionReceiptMessage(receiptValue) {
  const receipt = asObject(receiptValue);
  const lifecycle = asText(receipt.lifecycle);
  const label = quoted(asObject(receipt.entity).label || asObject(receipt.entity).id);
  const details = receiptDetails({
    ...receipt,
    accounts: asArray(receipt.accounts)
  });
  if (lifecycle === 'awaiting_confirmation') {
    return `Ready to ${asText(receipt.title).toLowerCase() || 'make this change'}. Please confirm before Cavalry changes your data.`;
  }
  if (lifecycle === 'cancelled') return 'Cancelled. Cavalry made no changes.';
  if (lifecycle === 'rolled_back') {
    return `That change could not be completed, so Cavalry kept the original record${label ? ` ${label}` : ''}.`;
  }
  if (successfulNoOpWriteReceipt(receipt)) {
    return `No change was needed${label ? ` for ${label}` : ''}. It was already current.`;
  }
  const durable = durablePersistence(receipt.persistence);
  if (receipt.commitStatus === 'committed' && receipt.verificationStatus === 'failed' && durable) {
    return `Cavalry saved the change${label ? ` to ${label}` : ''}, but could not verify every returned detail. Please review the record before relying on it.`;
  }
  if (lifecycle === 'failed') {
    const message = asText(asArray(receipt.errors)[0]?.message);
    return message || 'Cavalry could not complete that action. No change was confirmed.';
  }
  if (
    lifecycle !== 'completed' ||
    receipt.changed !== true ||
    receipt.commitStatus !== 'committed' ||
    receipt.verificationStatus !== 'verified' ||
    !durable
  ) {
    return '';
  }
  const verb = asText(receipt.actionVerb) || 'Completed';
  return `${verb}${label ? ` ${label}` : ''}${details ? ` — ${details}` : ''}.`;
}

export const CAVALRY_ASSISTANT_ACTION_LIFECYCLES = Object.freeze([...ACTION_LIFECYCLES]);
