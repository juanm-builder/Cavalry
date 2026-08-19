// Confirmation bookkeeping and post-approval narration for the Cavalry assistant panel.
// Kept out of the panel component so the panel stays a view, not a rules engine.

import { getCavalryAssistantToolMetadata } from './cavalry-assistant-tools.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

export function readableToolName(toolName) {
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

export function confirmedActionEntity(toolResult) {
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

export function confirmedActionMessage(toolName, toolResult, argumentsValue = {}) {
  const normalizedToolName = asText(toolName);
  const verb =
    asText(getCavalryAssistantToolMetadata(normalizedToolName)?.actionVerb) ||
    CONFIRMED_ACTION_VERBS[normalizedToolName];
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
  if (normalizedToolName === 'save_workbook') return 'Saved.';
  return 'Done—the change was saved.';
}

export const CONFIRMATION_APPROVAL_FIELDS = Object.freeze([
  'confirmed',
  'allowDuplicate',
  'allowCurrencyConversion'
]);

export function confirmationApprovalField(confirmation) {
  const field = asText(confirmation?.field);
  return /^[a-z][a-zA-Z0-9]*$/.test(field) ? field : 'confirmed';
}

export function confirmationMessage(confirmation) {
  return (
    asText(confirmation?.message) ||
    `Confirm that you want Cavalry to ${asText(confirmation?.action) || 'continue'}.`
  );
}

export function pendingConfirmationFromResult(turnResult) {
  const toolResults = asArray(turnResult?.toolResults);
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const toolResult = asObject(toolResults[index]);
    const result = asObject(toolResult.result);
    const confirmation = asObject(result.confirmation);
    if (confirmation.required !== true) continue;
    const argumentsWithoutApproval = { ...asObject(toolResult.arguments) };
    const approvalField = confirmationApprovalField(confirmation);
    new Set([...CONFIRMATION_APPROVAL_FIELDS, approvalField]).forEach(
      (field) => delete argumentsWithoutApproval[field]
    );
    return {
      id: toolResult.callId || `${toolResult.toolName}-${index}`,
      toolName: asText(toolResult.toolName),
      arguments: argumentsWithoutApproval,
      approvalField,
      message: confirmationMessage(confirmation)
    };
  }
  return null;
}

export function chainedPendingConfirmation(toolResult, currentConfirmation, approvedArguments) {
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

export function committedToolResults(turnResult) {
  return asArray(turnResult?.toolResults).filter(
    (toolResult) => toolResult?.ok === true && toolResult?.result?.changed === true
  );
}

export function toolFailureMessage(toolResult, fallback) {
  const source = asObject(toolResult);
  const firstError = asObject(asArray(source.errors)[0]);
  return asText(source.error || firstError.message) || fallback;
}

export function isConfirmationReply(value) {
  return /^(yes|y|yes please|yep|yeah|sure|ok|okay|confirm|confirmed|confirm it|go ahead|go for it|do it|do that|proceed|approve|approve it|sounds good)(?:[.!])?$/i.test(
    asText(value)
  );
}

export function isConfirmationDecline(value) {
  return /^(no|nope|no thanks|cancel|stop|don'?t|do not|never mind|nevermind|leave it)(?:[.!])?$/i.test(
    asText(value)
  );
}

const TURN_CONTEXT_DIGEST_LIMIT = 400;

export function turnContextDigest(activities) {
  const entries = asArray(activities)
    .filter((activity) => asObject(activity).type === 'tool' && asText(asObject(activity).toolName))
    .map((activity) => {
      const source = asObject(activity);
      const status = asText(source.status) || 'completed';
      const note =
        status === 'completed'
          ? ''
          : `: ${asText(source.message).replace(/\s+/g, ' ').slice(0, 80)}`;
      return `${asText(source.toolName)} (${status}${note})`;
    });
  if (!entries.length) return '';
  const summary = `tools used — ${entries.join('; ')}`.slice(0, TURN_CONTEXT_DIGEST_LIMIT);
  return `⟦turn-context: ${summary}⟧`;
}

const NARRATION_TIMEOUT_MS = 12000;

export function narrationText(invocation) {
  const source = asObject(invocation);
  if (source.ok === false) return '';
  const unwrapped =
    source.response && typeof source.response === 'object'
      ? source.response
      : asObject(source.data).response && typeof asObject(source.data).response === 'object'
        ? asObject(source.data).response
        : invocation;
  if (typeof unwrapped === 'string') return asText(unwrapped);
  const shaped = asObject(unwrapped);
  return asText(
    shaped.text ||
      asObject(asArray(shaped.choices)[0]).message?.content ||
      (typeof source.response === 'string' ? source.response : '')
  );
}

export async function narrateConfirmedAction({
  advisor,
  settings,
  confirmation,
  toolResult,
  requestId
}) {
  try {
    if (!(advisor && typeof advisor.invoke === 'function')) return '';
    const provider = asText(settings?.provider);
    if (!['openai', 'custom'].includes(provider)) return '';
    if (provider === 'openai' && settings?.hasApiKey !== true) return '';
    const resultSource = asObject(toolResult);
    const narrationPayload = {
      action: asText(confirmation?.toolName),
      status: asText(resultSource.status),
      changed: resultSource.changed === true,
      data: resultSource.data ?? null,
      warnings: asArray(resultSource.warnings)
    };
    const invocation = await Promise.race([
      advisor.invoke('chat', {
        requestId,
        returnMessage: true,
        temperature: 0.4,
        max_tokens: 220,
        messages: [
          {
            role: 'system',
            content:
              'You are Cavalry, the in-app financial advisor. The user just approved an action and Cavalry executed it successfully. Reply with one or two short sentences confirming exactly what changed, using the real names, amounts, currencies, and dates from the tool result JSON. Add one brief next step only when it is genuinely useful. No headings, no lists, no citation markers.'
          },
          { role: 'user', content: JSON.stringify(narrationPayload) }
        ]
      }),
      new Promise((resolve) => window.setTimeout(() => resolve(null), NARRATION_TIMEOUT_MS))
    ]);
    if (!invocation) {
      advisor.invoke('cancel', { requestId }).catch(() => {});
      return '';
    }
    return narrationText(invocation);
  } catch (_error) {
    return '';
  }
}
