import { getRecurringItemForMonth } from '@cavalry/finance-core/application/recurring/recurring-schedule.js';
import { getRecurringOccurrenceDatesForMonth } from '@cavalry/finance-core';
import { defineCavalryAssistantCapability } from '../assistant/cavalry-assistant-capability-registry.js';
import { reviewedDestructiveTarget } from '../assistant/cavalry-assistant-reviewed-target.js';
import {
  BILL_WRITE_PROPERTIES,
  asText,
  assistantBooleanProperty,
  assistantStringProperty,
  defineCavalryAssistantTool
} from '../assistant/cavalry-assistant-tool-definitions.js';
import {
  billFormDefaults,
  collection,
  commitCommand,
  confirmationRequired as baseConfirmationRequired,
  failure,
  mergeKnown,
  resolutionFailure,
  resolveArgument,
  summarizeRecurring
} from '../assistant/cavalry-assistant-tool-support.js';
import { BILLS_ACTIONS, createBillsController } from './bills-controller.js';

const scopeProperties = {
  scope: assistantStringProperty(
    'series changes the baseline tracker; month changes only the specified month; from_month changes that month and following months while preserving earlier months.',
    { enum: ['series', 'month', 'from_month'] }
  ),
  monthKey: assistantStringProperty(
    'Required YYYY-MM for month or from_month scope. Resolve relative months from the real current date, not the open workbook sheet.'
  )
};
const targetProperties = {
  bill: assistantStringProperty(
    'Bill/subscription ID or exact name. Ambiguous names require clarification.'
  ),
  recurringItemId: assistantStringProperty(
    'Stable bill/subscription ID, preferred when already resolved.'
  )
};
const confirmedProperty = assistantBooleanProperty(
  'Host-controlled approval after the user confirms the displayed proposal.'
);

function confirmationRequired(environment, action, options) {
  const result = baseConfirmationRequired(environment, action, options);
  result.confirmation = {
    ...result.confirmation,
    field: options.field || 'confirmed',
    message: options.message
  };
  result.errors = result.errors.map((error) => ({ ...error, field: options.field || 'confirmed' }));
  return result;
}

function recurringReference(
  environment,
  type,
  keys,
  label,
  { optional = false, allowEmpty = false } = {}
) {
  const args = environment.arguments;
  const provided = keys.filter((key) => Object.hasOwn(args, key));
  if (!provided.length)
    return resolveArgument(environment.workbook, args, {
      collection: type,
      keys,
      label,
      optional,
      allowEmpty
    });
  const matches = [];
  for (const key of provided) {
    const exact = key.endsWith('Id')
      ? collection(environment.workbook, type).filter(
          (item) => asText(item.id) === asText(args[key])
        )
      : [];
    const resolved =
      exact.length === 1
        ? { ok: true, provided: true, id: exact[0].id, value: exact[0] }
        : resolveArgument(
            environment.workbook,
            { [key]: args[key] },
            { collection: type, keys: [key], label, optional, allowEmpty }
          );
    if (!resolved.ok) return resolved;
    matches.push(resolved);
  }
  if (new Set(matches.map((match) => match.id)).size > 1)
    return {
      ok: false,
      status: 'validation_failed',
      error: {
        code: 'recurring.conflicting-references',
        message: `${label} ID and name point to different records. Choose one target.`
      }
    };
  return matches[0];
}

function canonicalBillReferences(environment, payload) {
  for (const [type, keys, label] of [
    ['categories', ['categoryId', 'category'], 'Category'],
    ['accounts', ['accountId', 'account'], 'Payment account']
  ]) {
    const resolved = recurringReference(environment, type, keys, label, {
      optional: true,
      allowEmpty: type === 'accounts'
    });
    if (!resolved.ok) return { error: resolutionFailure(environment, resolved) };
    if (resolved.provided) payload[keys[0]] = resolved.id;
    delete payload[keys[1]];
  }
  return { payload };
}

function target(environment) {
  return recurringReference(
    environment,
    'recurringItems',
    ['recurringItemId', 'bill'],
    'Bill or subscription'
  );
}

function scopeLabel(args) {
  return args.scope === 'month'
    ? `only for ${args.monthKey}`
    : args.scope === 'from_month'
      ? `from ${args.monthKey} onward`
      : 'for the tracker';
}

function trackerData(next, id, args = {}) {
  const item = collection(next, 'recurringItems').find((entry) => entry.id === id);
  return {
    recurringItem: summarizeRecurring(
      args.monthKey ? getRecurringItemForMonth(item, args.monthKey) : item,
      next
    ),
    scope: args.scope || 'series',
    monthKey: args.monthKey || '',
    dueDates: args.monthKey ? getRecurringOccurrenceDatesForMonth(item, args.monthKey) : [],
    trackerOnly: true,
    merchantSubscriptionChanged: false,
    message:
      'Only the Cavalry tracker changed. No merchant subscription was cancelled, renewed, or charged.'
  };
}

async function createBill(environment) {
  const args = environment.arguments;
  if (!Object.hasOwn(args, 'amount'))
    return failure(
      environment,
      'validation_failed',
      'recurring.amount-required',
      'What is the amount? Use zero only if this is explicitly a variable or free item.'
    );
  if (!asText(args.dueDate))
    return failure(
      environment,
      'validation_failed',
      'recurring.date-required',
      'What is the first due date? Use a future first date to start next month, or One-time for one month only.'
    );
  const payload = mergeKnown(
    {
      kind: 'bill',
      name: '',
      categoryId: '',
      accountId: '',
      currency: asText(environment.workbook.currency) || 'PHP',
      frequency: 'Monthly',
      autoRenew: false,
      isActive: true,
      note: ''
    },
    args,
    Object.keys(BILL_WRITE_PROPERTIES)
  );
  const prepared = canonicalBillReferences(environment, payload);
  if (prepared.error) return prepared.error;
  const result = createBillsController(environment.services).handleAction(environment.workbook, {
    type: BILLS_ACTIONS.saveRecurring,
    payload
  });
  if (!result.ok) return commitCommand(environment, result, 'assistant_bill_created');
  const duplicates = collection(environment.workbook, 'recurringItems').filter(
    (item) =>
      item.isActive !== false &&
      asText(item.name).toLocaleLowerCase() === asText(payload.name).toLocaleLowerCase()
  );
  if (duplicates.length && args.allowDuplicate !== true) {
    return confirmationRequired(
      environment,
      `create another Cavalry tracker named “${payload.name}”`,
      {
        field: 'allowDuplicate',
        message: `There is already an active tracker named “${payload.name}”. Create another for ${payload.currency} ${payload.amount}, ${payload.frequency}, starting ${payload.dueDate}? This creates a tracker only.`,
        proposal: { arguments: payload },
        data: { existing: duplicates.map(summarizeRecurring) }
      }
    );
  }
  return commitCommand(environment, result, 'assistant_bill_created', (next, command) => {
    const id = command.events.find((event) => event.type === 'recurring/item-created')?.payload
      ?.recurringItemId;
    return trackerData(next, id);
  });
}

async function updateBill(environment) {
  const resolved = target(environment);
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  const args = environment.arguments;
  const editableFields = Object.keys(BILL_WRITE_PROPERTIES).filter((field) =>
    Object.hasOwn(args, field)
  );
  if (!editableFields.length)
    return failure(
      environment,
      'validation_failed',
      'recurring.change-required',
      'Specify what should change for this tracker.'
    );
  const current = args.monthKey
    ? getRecurringItemForMonth(resolved.value, args.monthKey, {
        includeOverride: args.scope !== 'from_month'
      })
    : resolved.value;
  const payload = mergeKnown(
    billFormDefaults(current, environment.workbook),
    args,
    Object.keys(BILL_WRITE_PROPERTIES)
  );
  payload.recurringItemId = resolved.id;
  payload.scope = args.scope || 'series';
  payload.monthKey = args.monthKey || '';
  payload.changedFields = editableFields;
  const prepared = canonicalBillReferences(environment, payload);
  if (prepared.error) return prepared.error;
  const result = createBillsController(environment.services).handleAction(environment.workbook, {
    type: BILLS_ACTIONS.saveRecurring,
    payload
  });
  if (!result.ok) return commitCommand(environment, result, 'assistant_bill_updated');
  if (args.isActive === false) {
    const canonical = {
      ...args,
      recurringItemId: resolved.id,
      scope: payload.scope,
      ...(payload.monthKey ? { monthKey: payload.monthKey } : {})
    };
    delete canonical.bill;
    if (editableFields.some((field) => ['account', 'accountId'].includes(field))) {
      canonical.accountId = payload.accountId;
      delete canonical.account;
    }
    if (editableFields.some((field) => ['category', 'categoryId'].includes(field))) {
      canonical.categoryId = payload.categoryId;
      delete canonical.category;
    }
    const review = reviewedDestructiveTarget(
      environment,
      `stop tracking “${resolved.value.name}” ${scopeLabel(payload)}`,
      canonical,
      { recurringItem: resolved.value, scope: payload.scope, monthKey: payload.monthKey },
      { recurringItem: summarizeRecurring(resolved.value) },
      {
        confirmationRequired,
        message: `Stop tracking “${resolved.value.name}” ${scopeLabel(payload)} in Cavalry? This does not cancel the subscription with its merchant.`
      }
    );
    if (review) return review;
  }
  return commitCommand(environment, result, 'assistant_bill_updated', (next) =>
    trackerData(next, resolved.id, payload)
  );
}

async function archiveBill(environment) {
  const resolved = target(environment);
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  const args = {
    recurringItemId: resolved.id,
    scope: environment.arguments.scope || 'series',
    ...(environment.arguments.monthKey ? { monthKey: environment.arguments.monthKey } : {})
  };
  const result = createBillsController(environment.services).handleAction(environment.workbook, {
    type: BILLS_ACTIONS.archiveRecurring,
    payload: args
  });
  if (!result.ok) return commitCommand(environment, result, 'assistant_bill_archived');
  const review = reviewedDestructiveTarget(
    environment,
    `remove “${resolved.value.name}” ${scopeLabel(args)} from Cavalry tracking`,
    args,
    { recurringItem: resolved.value, scope: args.scope, monthKey: args.monthKey || '' },
    { recurringItem: summarizeRecurring(resolved.value) },
    {
      confirmationRequired,
      message: `Remove “${resolved.value.name}” ${scopeLabel(args)} from Cavalry tracking? Recorded payments stay unchanged. You must cancel any real subscription with its merchant separately.`
    }
  );
  if (review) return review;
  return commitCommand(environment, result, 'assistant_bill_archived', (next) =>
    trackerData(next, resolved.id, args)
  );
}

function tool(
  name,
  description,
  properties,
  required,
  execute,
  actionVerb,
  approvalField = 'confirmed'
) {
  return {
    definition: defineCavalryAssistantTool(
      name,
      description,
      {
        ...properties,
        ...(name !== 'create_bill'
          ? {
              expectedTargetState: assistantStringProperty(
                'Host-captured target state for the reviewed action.'
              )
            }
          : {}),
        [approvalField]: confirmedProperty
      },
      required
    ),
    execute,
    access: 'write',
    actionVerb,
    present(result, environment) {
      const item = result.data?.recurringItem;
      if (!result.ok || !item || result.changed !== true) return null;
      const scope = result.data.scope;
      const period =
        scope === 'month'
          ? ` for ${result.data.monthKey} only (other months unchanged)`
          : scope === 'from_month'
            ? ` from ${result.data.monthKey} onward (earlier months unchanged)`
            : '';
      const account = collection(environment.workbook, 'accounts').find(
        (entry) => entry.id === item.accountId
      );
      return {
        actionVerb: `${name === 'archive_bill' ? 'Stopped Cavalry tracking' : `${actionVerb} Cavalry tracker`}${period}`,
        date: [
          item.frequency,
          result.data.dueDates?.length
            ? `due ${result.data.dueDates.join(', ')}`
            : item.anchorDate
              ? `first due ${item.anchorDate}`
              : '',
          item.endDate ? `through ${item.endDate}` : ''
        ]
          .filter(Boolean)
          .join('; '),
        accounts: account ? [{ id: account.id, name: account.name, role: 'payment' }] : []
      };
    },
    approvalFields: [approvalField],
    hostInputFields: name === 'create_bill' ? [] : ['expectedTargetState'],
    confirmation: { mode: name === 'archive_bill' ? 'always' : 'conditional' },
    entityRequirements: [
      {
        type: 'recurring_item',
        role: name === 'create_bill' ? 'new' : 'target',
        ambiguity: 'clarify'
      }
    ]
  };
}

export default defineCavalryAssistantCapability({
  id: 'recurring.trackers',
  title: 'Bills and subscriptions',
  version: '1.0.0',
  description: 'Maintain local bill and subscription schedules with explicit month boundaries.',
  inputValidation: 'structure',
  instructions:
    'These tools change Cavalry tracking only, never merchant subscriptions or actual payments. A request to change an expected charge, price, due amount or schedule uses update_bill; it NEVER implies payment. Use pay_bill only for a reported paid/prepaid/charged item or an explicit request to record an actual payment. A future charge date is not proof of payment. Create with the user’s first due date; future starts must not create earlier obligations. For this month only use One-time or an explicit endDate. Before an ambiguous edit/remove, clarify whether it is one month, that month onward, or the baseline series. Use scope month/from_month and a concrete YYYY-MM monthKey for targeted changes. Do not silently use the open sheet as the current calendar month. Ask for missing amount, category, or first due date instead of inventing them. Preserve unrelated fields and use exact IDs from clarification results.',
  tools: [
    tool(
      'create_bill',
      'Create a validated Cavalry bill/subscription tracker with an explicit amount, active category and first due date. One-time is for one month only; endDate is inclusive. This does not subscribe or pay a merchant.',
      BILL_WRITE_PROPERTIES,
      ['name', 'amount', 'category', 'dueDate'],
      createBill,
      'Created',
      'allowDuplicate'
    ),
    tool(
      'update_bill',
      'Partially update a Cavalry tracker. Specify month scope for only one month, from_month for future changes, or series for the baseline. Preserve unspecified fields. Deactivation requires confirmation; no merchant changes are made.',
      { ...targetProperties, ...BILL_WRITE_PROPERTIES, ...scopeProperties },
      [],
      updateBill,
      'Updated'
    ),
    tool(
      'archive_bill',
      'Remove a Cavalry tracker from view, skip only one month, or stop future tracking from a month. Confirmation is required. This does not cancel the merchant subscription or delete recorded payments.',
      { ...targetProperties, ...scopeProperties },
      [],
      archiveBill,
      'Stopped tracking'
    )
  ]
});
