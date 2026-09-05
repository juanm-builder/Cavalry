import { roundMoney } from '@cavalry/finance-core';
import { buildSettingsRouteModel } from './settings-route-model.js';

export const SETTINGS_ACTIONS = Object.freeze({
  updateRate: 'settings/rate-update',
  renameWorkbook: 'settings/workbook-rename',
  addCounterparty: 'settings/counterparty-add',
  archiveCounterparty: 'settings/counterparty-archive',
  persistenceFailed: 'settings/persistence-failed'
});

const COUNTERPARTY_KINDS = new Set(['employer', 'family', 'client', 'merchant', 'biller', 'other']);
const ADVISOR_PROVIDERS = new Set(['local', 'openai', 'custom']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function ok(workbook, events = [], warnings = []) {
  return {
    ok: true,
    workbook,
    events: cloneSerializable(events),
    warnings: cloneSerializable(warnings),
    errors: []
  };
}

function fail(workbook, code, message) {
  return {
    ok: false,
    workbook,
    events: [],
    warnings: [],
    errors: [{ code, message }]
  };
}

function defaultStorageIntent(operation, payload) {
  return {
    type: `storage/${operation}-requested`,
    payload: cloneSerializable(payload),
    failureAction: {
      type: SETTINGS_ACTIONS.persistenceFailed,
      payload: { operation }
    }
  };
}

function defaultAdvisorIntent(operation, payload) {
  return {
    type: `advisor/${operation}-requested`,
    payload: cloneSerializable(payload)
  };
}

function defaultCloudIntent(operation, payload) {
  return {
    type: `cloud/${operation}-requested`,
    payload: cloneSerializable(payload)
  };
}

function getIdFactory(dependencies) {
  if (typeof dependencies.createId === 'function') {
    return dependencies.createId;
  }
  if (dependencies.ids && typeof dependencies.ids.create === 'function') {
    return dependencies.ids.create;
  }
  return null;
}

function createCounterpartyId(workbook, dependencies) {
  const createId = getIdFactory(dependencies);
  const existing = new Set(
    asArray(workbook && workbook.counterparties).map((item) => asString(item && item.id))
  );
  if (createId) {
    let candidate = asString(createId('counterparty'));
    while (!candidate || existing.has(candidate)) {
      candidate = asString(createId('counterparty'));
    }
    return candidate;
  }
  let index = existing.size + 1;
  let candidate = `counterparty_${index}`;
  while (existing.has(candidate)) {
    candidate = `counterparty_${++index}`;
  }
  return candidate;
}

function updateRate(workbook, payload) {
  const value = Number(payload.usdRate ?? payload.value);
  if (!Number.isFinite(value) || value <= 0) {
    return fail(
      workbook,
      'settings.rate.invalid',
      'Enter a USD conversion rate greater than zero.'
    );
  }
  const nextWorkbook = cloneSerializable(workbook);
  nextWorkbook.settings = asObject(nextWorkbook.settings);
  nextWorkbook.settings.usdToBaseRate = roundMoney(value);
  return ok(nextWorkbook, [
    {
      type: 'settings/rate-updated',
      payload: { usdToBaseRate: nextWorkbook.settings.usdToBaseRate }
    },
    { type: 'schedule-save' }
  ]);
}

function renameWorkbook(workbook, payload) {
  const name = asString(payload.name);
  if (!name) {
    return fail(workbook, 'settings.workbook.name-required', 'Enter a workbook name.');
  }
  if (name.length > 120) {
    return fail(
      workbook,
      'settings.workbook.name-too-long',
      'Keep the workbook name under 120 characters.'
    );
  }
  if (name === asString(workbook.name)) {
    return ok(workbook);
  }
  const nextWorkbook = cloneSerializable(workbook);
  nextWorkbook.name = name;
  return ok(nextWorkbook, [
    { type: 'settings/workbook-renamed', payload: { name } },
    { type: 'schedule-save' }
  ]);
}

function addCounterparty(workbook, payload, dependencies) {
  const name = asString(payload.name);
  if (!name) {
    return fail(workbook, 'settings.counterparty.name-required', 'Counterparty name is required.');
  }
  const duplicate = asArray(workbook.counterparties).some((counterparty) => {
    return (
      counterparty &&
      counterparty.isActive !== false &&
      asString(counterparty.name).toLowerCase() === name.toLowerCase()
    );
  });
  if (duplicate) {
    return fail(
      workbook,
      'settings.counterparty.duplicate',
      'An active counterparty already uses that name.'
    );
  }
  const nextWorkbook = cloneSerializable(workbook);
  nextWorkbook.counterparties = asArray(nextWorkbook.counterparties);
  const counterparty = {
    id: createCounterpartyId(nextWorkbook, dependencies),
    name,
    kind: COUNTERPARTY_KINDS.has(payload.kind) ? payload.kind : 'other',
    note: asString(payload.note),
    isActive: true
  };
  nextWorkbook.counterparties.push(counterparty);
  return ok(nextWorkbook, [
    { type: 'settings/counterparty-created', payload: { counterpartyId: counterparty.id } },
    { type: 'schedule-save' }
  ]);
}

function archiveCounterparty(workbook, payload) {
  const counterpartyId = asString(payload.counterpartyId);
  const current = asArray(workbook.counterparties).find(
    (item) => asString(item && item.id) === counterpartyId
  );
  if (!current) {
    return fail(
      workbook,
      'settings.counterparty.not-found',
      'Choose an existing counterparty to archive.'
    );
  }
  const nextWorkbook = cloneSerializable(workbook);
  const counterparty = nextWorkbook.counterparties.find((item) => item.id === counterpartyId);
  counterparty.isActive = false;
  return ok(nextWorkbook, [
    { type: 'settings/counterparty-archived', payload: { counterpartyId } },
    { type: 'schedule-save' }
  ]);
}

function normalizeAdvisorPayload(payload) {
  const source = asObject(payload);
  const provider = ADVISOR_PROVIDERS.has(source.provider) ? source.provider : 'local';
  const normalized = {
    provider,
    apiMode:
      provider === 'openai'
        ? 'responses'
        : source.apiMode === 'responses'
          ? 'responses'
          : 'chat_completions',
    endpoint: asString(source.endpoint),
    model: asString(source.model),
    localModelPath: asString(source.localModelPath),
    mmprojPath: asString(source.mmprojPath),
    contextWindowTokens: Math.max(0, Math.round(Number(source.contextWindowTokens) || 0))
  };
  const apiKey = asString(source.apiKey);
  if (apiKey && !/^\*+$/.test(apiKey)) {
    normalized.apiKey = apiKey;
  }
  return normalized;
}

function createIntentResult(workbook, factory, operation, payload) {
  const event = factory(operation, payload);
  if (!event || typeof event !== 'object' || !asString(event.type)) {
    return fail(
      workbook,
      'settings.intent.invalid',
      `The ${operation} intent adapter returned an invalid event.`
    );
  }
  return ok(workbook, [event]);
}

export function createSettingsController(dependencies = {}) {
  const storageIntent =
    typeof dependencies.storageIntent === 'function'
      ? dependencies.storageIntent
      : defaultStorageIntent;
  const advisorIntent =
    typeof dependencies.advisorIntent === 'function'
      ? dependencies.advisorIntent
      : defaultAdvisorIntent;
  const cloudIntent =
    typeof dependencies.cloudIntent === 'function' ? dependencies.cloudIntent : defaultCloudIntent;

  return {
    buildModel(workbook, viewState = {}, runtime = {}) {
      return buildSettingsRouteModel(workbook, viewState, runtime);
    },
    handleAction(workbook, action) {
      if (!workbook || typeof workbook !== 'object' || Array.isArray(workbook)) {
        return fail(
          workbook,
          'settings.workbook-required',
          'Open a workbook before changing settings.'
        );
      }
      const type = asString(action && action.type);
      const payload = asObject(action && action.payload);
      try {
        if ([SETTINGS_ACTIONS.updateRate, 'update-usd-rate', 'save-usd-rate'].includes(type)) {
          return updateRate(workbook, payload);
        }
        if ([SETTINGS_ACTIONS.renameWorkbook, 'rename-workbook'].includes(type)) {
          return renameWorkbook(workbook, payload);
        }
        if ([SETTINGS_ACTIONS.addCounterparty, 'add-counterparty'].includes(type)) {
          return addCounterparty(workbook, payload, dependencies);
        }
        if ([SETTINGS_ACTIONS.archiveCounterparty, 'archive-counterparty'].includes(type)) {
          return archiveCounterparty(workbook, payload);
        }
        if (type === SETTINGS_ACTIONS.persistenceFailed) {
          return fail(
            workbook,
            asString(payload.code) || 'settings.persistence.failed',
            asString(payload.message || payload.error) ||
              `The ${asString(payload.operation) || 'file'} operation failed.`
          );
        }

        const storageOperations = {
          'open-workbook-file': 'open',
          'refresh-workbook-recovery': 'recovery-list',
          'open-workbook-recovery': 'recovery-open',
          'run-file-autosave': 'save',
          'choose-autosave-file': 'save-as',
          'reveal-workbook-file': 'reveal',
          'clear-autosave-file': 'forget',
          'export-workbook': 'export-workbook',
          'export-csv-bundle': 'export-csv',
          'trigger-csv-import': 'import-csv',
          'exit-workbook': 'exit'
        };
        if (storageOperations[type]) {
          return createIntentResult(workbook, storageIntent, storageOperations[type], {
            workbookId: asString(workbook.id),
            suggestedName: asString(workbook.name) || 'Cavalry Workbook',
            ...(type === 'open-workbook-recovery' ? { id: asString(payload.id) } : {})
          });
        }

        const cloudOperations = {
          'connect-icloud': 'connect',
          'select-icloud-account': 'select-account',
          'pause-icloud-sync': 'disconnect',
          'resume-icloud-sync': 'connect',
          'sign-out-icloud': 'sign-out',
          'cancel-icloud-sign-in': 'cancel-sign-in',
          'disconnect-icloud': 'disconnect',
          'refresh-cloud-workbooks': 'refresh',
          'retry-cloud-sync-state': 'retry-sync-state',
          'set-cloud-autosave': 'set-auto-sync',
          'upload-current-workbook': 'upload',
          'keep-local-cloud-workbook': 'keep-local',
          'reconcile-cloud-workbook': 'reconcile',
          'open-cloud-workbook': 'open',
          'delete-cloud-workbook': 'delete'
        };
        if (cloudOperations[type]) {
          const cloudPayload = {
            workbookId: asString(payload.workbookId),
            ...(type === 'select-icloud-account' ? { source: asString(payload.source) } : {}),
            ...(type === 'set-cloud-autosave'
              ? { enabled: payload.enabled === true || payload.checked === true }
              : {}),
            ...(type === 'reconcile-cloud-workbook'
              ? {
                  choices: Array.isArray(payload.choices) ? payload.choices : [],
                  conflictNoticeId: asString(payload.conflictNoticeId)
                }
              : {})
          };
          return createIntentResult(workbook, cloudIntent, cloudOperations[type], cloudPayload);
        }

        if (type === 'set-advisor-provider') {
          const provider = ADVISOR_PROVIDERS.has(payload.value) ? payload.value : '';
          if (!provider) {
            return fail(
              workbook,
              'settings.advisor.provider-invalid',
              'Choose a supported assistant connection.'
            );
          }
          return createIntentResult(workbook, advisorIntent, 'provider-change', { provider });
        }
        if (type === 'clear-mmproj') {
          return createIntentResult(workbook, advisorIntent, 'vision-projector-clear', {});
        }
        const advisorOperations = {
          'save-advisor-settings': 'settings-save',
          'toggle-advisor-server': 'server-toggle',
          'test-advisor-connection': 'connection-test',
          'choose-local-model': 'model-choose',
          'choose-mmproj': 'vision-projector-choose',
          'request-advisor-microphone-access': 'microphone-request',
          'open-advisor-microphone-settings': 'microphone-settings-open',
          'refresh-advisor-microphone-status': 'microphone-status-refresh',
          'open-share-summary': 'summary-open'
        };
        if (advisorOperations[type]) {
          return createIntentResult(
            workbook,
            advisorIntent,
            advisorOperations[type],
            type === 'open-share-summary'
              ? { workbookId: asString(workbook.id) }
              : normalizeAdvisorPayload(payload)
          );
        }
        return fail(
          workbook,
          'settings.action-unsupported',
          `Unsupported settings action "${type || 'empty'}".`
        );
      } catch (error) {
        return fail(
          workbook,
          'settings.action-failed',
          asString(error && error.message) || 'The settings action could not be prepared.'
        );
      }
    }
  };
}
