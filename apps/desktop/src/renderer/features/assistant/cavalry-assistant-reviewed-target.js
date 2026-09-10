import { asText } from './cavalry-assistant-tool-definitions.js';
import { confirmationRequired, failure } from './cavalry-assistant-command-result-support.js';

export function reviewedDestructiveTarget(
  environment,
  action,
  canonicalArguments,
  target,
  data,
  options = {}
) {
  const fingerprint = JSON.stringify({
    workbookId: asText(environment.workbook.id),
    currency: asText(environment.workbook.currency),
    ...target
  });
  const expected = asText(environment.arguments.expectedTargetState);
  if (environment.arguments.confirmed !== true || !expected) {
    const confirm = options.confirmationRequired || confirmationRequired;
    return confirm(environment, action, {
      ...(options.message ? { message: options.message } : {}),
      data,
      proposal: { arguments: { ...canonicalArguments, expectedTargetState: fingerprint } }
    });
  }
  if (expected !== fingerprint) {
    return failure(
      environment,
      'conflict',
      'confirmation_target_changed',
      'The reviewed target changed. Review the current record and prepare this action again; nothing was changed.',
      'expectedTargetState'
    );
  }
  return null;
}
