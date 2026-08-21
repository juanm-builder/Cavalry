import { validateLedgerInvariants } from '@cavalry/finance-core';

import { asArray, asObject, asText, clonePlain } from './cavalry-assistant-tool-definitions.js';
import { safeEventList } from './cavalry-assistant-tool-presenters.js';

export function toolCallParts(toolCall) {
  const source = asObject(toolCall);
  const functionShape = asObject(source.function);
  const name = asText(source.name || source.tool || source.toolName || functionShape.name);
  const rawArguments =
    source.arguments ??
    source.args ??
    source.input ??
    functionShape.arguments ??
    functionShape.input;
  if (typeof rawArguments === 'string') {
    try {
      const parsed = JSON.parse(rawArguments);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Tool arguments must be a JSON object.');
      }
      return {
        name,
        arguments: parsed,
        toolCallId: asText(source.call_id || source.id || source.toolCallId)
      };
    } catch (error) {
      return {
        name,
        arguments: {},
        toolCallId: asText(source.call_id || source.id || source.toolCallId),
        parseError: asText(error && error.message) || 'Tool arguments must be valid JSON.'
      };
    }
  }
  return {
    name,
    arguments: asObject(rawArguments),
    toolCallId: asText(source.call_id || source.id || source.toolCallId)
  };
}

export function errorItem(code, message, field = '') {
  return { code, message, ...(field ? { field } : {}) };
}

export function envelope(toolName, toolCallId, options = {}) {
  return {
    ok: options.ok !== false,
    toolName,
    ...(toolCallId ? { toolCallId } : {}),
    status: options.status || 'completed',
    changed: options.changed === true,
    data: options.data || null,
    ...(options.referenceData ? { referenceData: options.referenceData } : {}),
    warnings: asArray(options.warnings).map(normalizeIssue),
    errors: asArray(options.errors).map(normalizeIssue),
    ...(asText(options.commitStatus) ? { commitStatus: asText(options.commitStatus) } : {}),
    ...(asText(options.verificationStatus)
      ? { verificationStatus: asText(options.verificationStatus) }
      : {}),
    ...(options.persistence ? { persistence: clonePlain(options.persistence) } : {}),
    ...(options.confirmation ? { confirmation: options.confirmation } : {})
  };
}

export function normalizeIssue(issue) {
  const source = asObject(issue);
  const details = { ...asObject(source.details), ...source };
  const normalized = {
    code: asText(source.code) || 'unknown',
    message: asText(source.message) || asText(issue) || 'The action could not be completed.',
    ...(source.field ? { field: asText(source.field) } : {})
  };
  ['accountId', 'accountName', 'configuredCurrency', 'transactionCurrency', 'baseCurrency'].forEach(
    (field) => {
      if (asText(details[field])) normalized[field] = asText(details[field]);
    }
  );
  if (Number(details.fxRateToBase) > 0) {
    normalized.fxRateToBase = Number(details.fxRateToBase);
  }
  ['postingCurrencies', 'affectedTransactionIds'].forEach((field) => {
    if (Array.isArray(details[field])) normalized[field] = clonePlain(details[field]);
  });
  if (Array.isArray(details.accounts)) {
    normalized.accounts = details.accounts.map((account) => {
      const item = asObject(account);
      return {
        accountId: asText(item.accountId),
        accountName: asText(item.accountName),
        accountCurrency: asText(item.accountCurrency)
      };
    });
  }
  return normalized;
}

export function failure(environment, status, code, message, field = '') {
  return envelope(environment.toolName, environment.toolCallId, {
    ok: false,
    status,
    errors: [errorItem(code, message, field)]
  });
}

export function confirmationRequired(environment, actionLabel, options = {}) {
  return envelope(environment.toolName, environment.toolCallId, {
    ok: false,
    status: 'confirmation_required',
    data: options.data || null,
    warnings: asArray(options.warnings),
    errors: [
      errorItem(
        'confirmation_required',
        `Explicit user confirmation is required before Cavalry can ${actionLabel}.`,
        'confirmed'
      )
    ],
    confirmation: {
      required: true,
      field: 'confirmed',
      action: actionLabel,
      message: `Confirm that you want Cavalry to ${actionLabel}, then retry with confirmed set to true.`,
      ...(options.proposal ? { proposal: clonePlain(options.proposal) } : {})
    }
  });
}

export function collection(workbook, name) {
  return asArray(workbook && workbook[name]);
}

function ledgerIssueKey(issue) {
  return [issue?.code, issue?.message, issue?.detail].map(asText).join('\u0000');
}

function introducedLedgerErrors(previousWorkbook, nextWorkbook) {
  const previousErrors = new Set(
    asArray(validateLedgerInvariants(previousWorkbook).errors).map(ledgerIssueKey)
  );
  return asArray(validateLedgerInvariants(nextWorkbook).errors).filter(
    (issue) => !previousErrors.has(ledgerIssueKey(issue))
  );
}

const CURRENCY_CONVERSION_CONFIRMATION_CODES = new Set([
  'currency_conversion_confirmation_required',
  'account_currency_conversion_required',
  'account_currency_conversion_confirmation_required'
]);

function currencyConversionDisclosure(warning) {
  const source = asObject(warning);
  const transactionCurrency = asText(source.transactionCurrency).toUpperCase();
  const accountCopy = asArray(source.accounts)
    .map((account) => {
      const item = asObject(account);
      const name = asText(item.accountName) || asText(item.accountId) || 'account';
      const currency = asText(item.accountCurrency).toUpperCase();
      return currency ? `${name} (${currency})` : name;
    })
    .filter(Boolean)
    .join(', ');
  const rate = Number(source.fxRateToBase) || 0;
  return [
    asText(source.message) || 'This transaction would convert money between currencies.',
    transactionCurrency ? `Transaction currency: ${transactionCurrency}.` : '',
    accountCopy
      ? `Affected account${asArray(source.accounts).length === 1 ? '' : 's'}: ${accountCopy}.`
      : '',
    rate > 0 ? `Exchange rate: ${rate}.` : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function freezeProjectionSnapshot(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => freezeProjectionSnapshot(item, seen));
  return Object.freeze(value);
}

function projectCommandData(dataFactory, workbook, result) {
  if (typeof dataFactory !== 'function') {
    return dataFactory ? clonePlain(dataFactory) : null;
  }
  const command = clonePlain(result) || {};
  if (workbook && workbook !== result?.workbook) command.workbook = clonePlain(workbook);
  const snapshot = freezeProjectionSnapshot(command);
  return clonePlain(dataFactory(snapshot.workbook || workbook, snapshot));
}

export async function commitCommand(environment, result, reason, dataFactory) {
  if (!(result && result.ok)) {
    return envelope(environment.toolName, environment.toolCallId, {
      ok: false,
      status: 'validation_failed',
      errors: asArray(result && result.errors),
      warnings: asArray(result && result.warnings)
    });
  }
  const changed = !!(result.workbook && result.workbook !== environment.workbook);
  const conversionWarning = asArray(result.warnings).find((warning) =>
    CURRENCY_CONVERSION_CONFIRMATION_CODES.has(asText(warning && warning.code))
  );
  if (conversionWarning && asObject(environment.arguments).allowCurrencyConversion !== true) {
    const warningMessage = currencyConversionDisclosure(conversionWarning);
    const confirmationMessage =
      asText(conversionWarning.confirmMessage) || 'Confirm this currency conversion to continue.';
    return envelope(environment.toolName, environment.toolCallId, {
      ok: false,
      status: 'confirmation_required',
      changed: false,
      errors: [
        errorItem(
          asText(conversionWarning.code) || 'currency_conversion_confirmation_required',
          warningMessage,
          'allowCurrencyConversion'
        )
      ],
      warnings: [conversionWarning],
      confirmation: {
        required: true,
        field: 'allowCurrencyConversion',
        action: 'post this transaction with the disclosed currency conversion',
        message: `${warningMessage} ${confirmationMessage}`
      }
    });
  }
  const duplicateWarning = asArray(result.warnings).find(
    (warning) => asText(warning && warning.code) === 'possible_duplicate_transaction'
  );
  if (!changed && duplicateWarning) {
    return envelope(environment.toolName, environment.toolCallId, {
      ok: false,
      status: 'confirmation_required',
      errors: [
        errorItem(
          'possible_duplicate_transaction',
          asText(duplicateWarning.message) || 'Confirm the possible duplicate before posting.',
          'allowDuplicate'
        )
      ],
      warnings: [duplicateWarning],
      confirmation: {
        required: true,
        field: 'allowDuplicate',
        action: 'post a possible duplicate transaction',
        message: 'Confirm the duplicate, then retry with allowDuplicate set to true.'
      }
    });
  }
  let commitResult = null;
  if (changed) {
    const previousTransactionIds = new Set(
      collection(environment.workbook, 'transactions').map((transaction) => asText(transaction?.id))
    );
    const explicitlyCreated = new Set(
      asArray(result.createdTransactions).map((transaction) => asText(transaction?.id))
    );
    const originId = (asText(environment.toolCallId) || asText(environment.toolName) || 'action')
      .replace(/\s+/g, '_')
      .slice(0, 120);
    collection(result.workbook, 'transactions').forEach((transaction) => {
      if (
        explicitlyCreated.has(asText(transaction?.id)) ||
        !previousTransactionIds.has(asText(transaction?.id))
      ) {
        transaction.source = 'advisor';
        if (!asText(transaction.reference)) {
          transaction.reference = `advisor:companion:${originId}`;
        }
      }
    });
  }
  if (changed) {
    const integrityErrors = introducedLedgerErrors(environment.workbook, result.workbook);
    if (integrityErrors.length) {
      return envelope(environment.toolName, environment.toolCallId, {
        ok: false,
        status: 'verification_failed',
        changed: false,
        errors: integrityErrors.map((issue) =>
          errorItem(
            asText(issue?.code) || 'ledger_integrity_failed',
            `Cavalry stopped this change because it would make the ledger inconsistent: ${
              asText(issue?.message) || 'ledger validation failed.'
            }`
          )
        ),
        warnings: asArray(result.warnings)
      });
    }
  }
  let data = null;
  try {
    data = projectCommandData(dataFactory, result.workbook || environment.workbook, result);
  } catch (_projectionError) {
    return envelope(environment.toolName, environment.toolCallId, {
      ok: false,
      status: 'verification_failed',
      changed: false,
      data: { events: safeEventList(result.events) },
      warnings: asArray(result.warnings),
      commitStatus: !changed && result.idempotent === true ? 'committed' : 'not_attempted',
      verificationStatus: 'failed',
      persistence:
        !changed && result.idempotent === true
          ? { status: 'previously_committed', durable: true }
          : { status: 'not_required', durable: true },
      errors: [
        errorItem(
          'assistant_result_projection_failed',
          'Cavalry stopped this change before saving because it could not prepare a safe action result.'
        )
      ]
    });
  }
  if (changed) {
    if (typeof environment.context.commitCommandResult !== 'function') {
      return failure(
        environment,
        'context_error',
        'commit_unavailable',
        'The assistant command-result commit adapter is unavailable.'
      );
    }
    try {
      commitResult = await environment.context.commitCommandResult(result, { reason });
    } catch (error) {
      if (asText(error?.commitStatus).toLowerCase() === 'committed') {
        return envelope(environment.toolName, environment.toolCallId, {
          ok: false,
          status: 'verification_failed',
          changed: true,
          data: data || { events: safeEventList(result.events) },
          warnings: asArray(result.warnings),
          commitStatus: 'committed',
          verificationStatus: 'failed',
          persistence: clonePlain(error?.persistence),
          errors: [
            errorItem(
              asText(error?.code) || 'post_commit_verification_failed',
              asText(error?.message) ||
                'The workbook was saved, but Cavalry could not verify the updated view.'
            )
          ]
        });
      }
      return envelope(environment.toolName, environment.toolCallId, {
        ok: false,
        status: 'commit_failed',
        changed: false,
        commitStatus: 'rolled_back',
        verificationStatus: 'not_attempted',
        persistence: asObject(error?.persistence),
        errors: [
          errorItem(
            asText(error?.code) || 'commit_failed',
            asText(error?.message) || 'The workbook change could not be committed.'
          )
        ]
      });
    }
  }
  if (changed) {
    const commitStatus = asText(commitResult?.commitStatus).toLowerCase();
    const verificationStatus = asText(commitResult?.verificationStatus).toLowerCase();
    const persistence = asObject(commitResult?.persistence);
    const persistenceStatus = asText(persistence.status).toLowerCase();
    const durable = persistence.durable === true && ['saved', 'cached'].includes(persistenceStatus);
    if (commitStatus !== 'committed' || verificationStatus !== 'verified' || !durable) {
      return envelope(environment.toolName, environment.toolCallId, {
        ok: false,
        status: 'commit_unconfirmed',
        changed: true,
        commitStatus: commitStatus || 'unknown',
        verificationStatus: verificationStatus || 'unknown',
        persistence,
        warnings: asArray(result.warnings),
        errors: [
          errorItem(
            'durable_commit_receipt_required',
            'Cavalry received a changed workbook but could not prove that it was durably saved and verified. Review the workbook before relying on this action.'
          )
        ]
      });
    }
  }
  const committedWorkbook = commitResult?.workbook;
  if (
    changed &&
    typeof dataFactory === 'function' &&
    committedWorkbook &&
    committedWorkbook !== result.workbook
  ) {
    try {
      data = projectCommandData(dataFactory, committedWorkbook, {
        ...result,
        workbook: committedWorkbook
      });
    } catch (_projectionError) {
      return envelope(environment.toolName, environment.toolCallId, {
        ok: false,
        status: 'verification_failed',
        changed: true,
        data: { events: safeEventList(result.events) },
        warnings: asArray(result.warnings),
        commitStatus: 'committed',
        verificationStatus: 'failed',
        persistence: commitResult.persistence,
        errors: [
          errorItem(
            'assistant_post_commit_projection_failed',
            'The workbook was saved, but Cavalry could not prepare the verified action result. Review the workbook before retrying.'
          )
        ]
      });
    }
  }
  return envelope(environment.toolName, environment.toolCallId, {
    changed,
    data: data || { events: safeEventList(result.events) },
    warnings: asArray(result.warnings),
    commitStatus:
      asText(commitResult?.commitStatus) ||
      (result.idempotent === true ? 'committed' : 'not_applicable'),
    verificationStatus: asText(commitResult?.verificationStatus) || 'verified',
    persistence:
      commitResult?.persistence ||
      (result.idempotent === true
        ? { status: 'previously_committed', durable: true }
        : { status: changed ? 'saved' : 'not_required', durable: true })
  });
}
