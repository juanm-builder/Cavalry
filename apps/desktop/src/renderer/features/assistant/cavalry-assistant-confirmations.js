// Confirmation bookkeeping and deterministic post-approval state for the Cavalry assistant panel.
// Kept out of the panel component so the panel stays a view, not a rules engine.

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function plain(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return fallback;
  }
}

export function readableToolName(toolName) {
  return asText(toolName)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function confirmationApprovalField(confirmation) {
  const field = asText(confirmation?.field || confirmation?.approvalField);
  return /^[a-z][a-zA-Z0-9]*$/.test(field) ? field : '';
}

export function confirmationMessage(confirmation) {
  return (
    asText(confirmation?.message) ||
    `Confirm that you want Cavalry to ${asText(confirmation?.action) || 'continue'}.`
  );
}

export function pendingConfirmationsFromResult(turnResult) {
  const toolResults = asArray(turnResult?.toolResults);
  const pending = [];
  for (let index = 0; index < toolResults.length; index += 1) {
    const toolResult = asObject(toolResults[index]);
    const result = asObject(toolResult.result);
    const confirmation = asObject(result.confirmation);
    if (confirmation.required !== true) continue;
    const proposalSource = asObject(confirmation.proposal);
    const proposal = Object.keys(proposalSource).length ? plain(proposalSource, null) : null;
    const proposalArguments = asObject(
      proposal && (proposal.arguments || proposal.input || proposal.parameters)
    );
    const canonicalArguments = Object.keys(proposalArguments).length
      ? proposalArguments
      : proposal && Object.keys(proposal).length
        ? proposal
        : asObject(toolResult.arguments);
    const argumentsWithoutApproval = { ...canonicalArguments };
    const approvalField = confirmationApprovalField(confirmation);
    if (!approvalField) continue;
    delete argumentsWithoutApproval[approvalField];
    pending.push({
      id: toolResult.callId || `${toolResult.toolName}-${index}`,
      toolName: asText(toolResult.toolName),
      arguments: argumentsWithoutApproval,
      ...(proposal ? { proposal } : {}),
      approvalField,
      message: confirmationMessage(confirmation)
    });
  }
  return pending;
}

export function pendingConfirmationFromResult(turnResult) {
  return pendingConfirmationsFromResult(turnResult)[0] || null;
}

export function chainedPendingConfirmation(toolResult, currentConfirmation, approvedArguments) {
  const result = asObject(toolResult);
  const confirmation = asObject(result.confirmation);
  if (confirmation.required !== true) return null;
  const approvalField = confirmationApprovalField(confirmation);
  if (!approvalField) return null;
  if (
    approvalField === currentConfirmation.approvalField &&
    approvedArguments[approvalField] === true
  ) {
    return null;
  }
  const proposalSource = asObject(confirmation.proposal);
  const proposal = Object.keys(proposalSource).length ? plain(proposalSource, null) : null;
  const proposalArguments = asObject(
    proposal && (proposal.arguments || proposal.input || proposal.parameters)
  );
  const replayArguments = {
    ...approvedArguments,
    ...(Object.keys(proposalArguments).length
      ? proposalArguments
      : proposal && Object.keys(proposal).length
        ? proposal
        : {})
  };
  delete replayArguments[approvalField];
  return {
    id: asText(result.toolCallId) || currentConfirmation.id,
    ...(currentConfirmation.messageId ? { messageId: currentConfirmation.messageId } : {}),
    ...(currentConfirmation.origin ? { origin: plain(currentConfirmation.origin, {}) } : {}),
    toolName: currentConfirmation.toolName,
    arguments: replayArguments,
    ...(proposal ? { proposal } : {}),
    approvalField,
    message: confirmationMessage(confirmation)
  };
}

export function confirmationReplayArguments(confirmation) {
  const source = asObject(confirmation);
  const proposal = asObject(source.proposal);
  const nested = asObject(proposal.arguments || proposal.input || proposal.parameters);
  const canonical = Object.keys(nested).length
    ? nested
    : Object.keys(proposal).length
      ? proposal
      : asObject(source.arguments);
  const approved = { ...plain(canonical, {}) };
  const approvalField = confirmationApprovalField({ field: source.approvalField });
  if (approvalField) approved[approvalField] = true;
  return approved;
}

export function committedToolResults(turnResult) {
  return asArray(turnResult?.toolResults).filter((toolResult) => {
    const result = asObject(toolResult?.result);
    const receipt = asObject(result.receipt);
    return (
      asText(result.commitStatus) === 'committed' || asText(receipt.commitStatus) === 'committed'
    );
  });
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

export function pendingConfirmationAnswer(context, normalizeResult) {
  const confirmation = pendingConfirmationFromResult({ toolResults: context.toolResults });
  if (!confirmation) return null;
  // The host already supplied the reviewable proposal and the panel renders its receipt.
  // Another provider call cannot approve it, and only delays showing the confirmation.
  return {
    ...normalizeResult({
      ok: true,
      text: confirmation.message,
      activities: context.activities,
      toolResults: context.toolResults
    }),
    status: 'confirmation_required'
  };
}
