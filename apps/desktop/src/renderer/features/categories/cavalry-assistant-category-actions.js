import { CATEGORY_ACTIONS, executeCategoryCommand } from './category-controller.js';
import { matchCategoryIcon } from './category-options.js';

import {
  CATEGORY_CUSTOMIZATION_PROPERTIES,
  asArray,
  asText,
  hasOwn
} from '../assistant/cavalry-assistant-tool-definitions.js';
import {
  collection,
  commitCommand,
  confirmationRequired,
  envelope,
  errorItem,
  mergeKnown,
  resolutionFailure,
  resolveArgument,
  safeEventList,
  summarizeCategory
} from '../assistant/cavalry-assistant-tool-support.js';

async function readPersistedWorkbook(environment, fallbackWorkbook) {
  try {
    const workbook = await environment.context.getWorkbook();
    return workbook && typeof workbook === 'object'
      ? { ok: true, workbook }
      : {
          ok: false,
          workbook: fallbackWorkbook,
          message: 'The updated workbook could not be read back for verification.'
        };
  } catch (error) {
    return {
      ok: false,
      workbook: fallbackWorkbook,
      message:
        asText(error?.message) || 'The updated workbook could not be read back for verification.'
    };
  }
}

function verificationFailure(response, code, message, data) {
  return {
    ...response,
    ok: false,
    status: 'verification_failed',
    data,
    errors: [errorItem(code, message, 'icon')]
  };
}

export async function createCategoryTool(environment) {
  const args = environment.arguments;
  const name = asText(args.name);
  const type = asText(args.type) || 'expense';
  const payload = mergeKnown(
    {
      name,
      type,
      postingAccountName: asText(args.postingAccountName || args.name),
      icon: matchCategoryIcon(name, type)
    },
    args,
    Object.keys(CATEGORY_CUSTOMIZATION_PROPERTIES)
  );
  const result = executeCategoryCommand(
    environment.workbook,
    {
      type: CATEGORY_ACTIONS.CREATE,
      payload
    },
    environment.services
  );
  const response = await commitCommand(
    environment,
    result,
    'assistant_category_created',
    (next, command) => {
      const id = asText(
        command.events.find((event) => event.type === 'category.created')?.categoryId
      );
      return {
        category: summarizeCategory(
          collection(next, 'categories').find((item) => item.id === id),
          next
        )
      };
    }
  );
  if (!(response.ok && response.changed)) return response;
  const readBack = await readPersistedWorkbook(environment, result.workbook);
  const categoryId = asText(
    asArray(result.events).find((event) => event.type === 'category.created')?.categoryId
  );
  const category = summarizeCategory(
    collection(readBack.workbook, 'categories').find((item) => asText(item.id) === categoryId),
    readBack.workbook
  );
  const data = { ...response.data, category, requestedIcon: asText(payload.icon) };
  if (!readBack.ok || !category || category.icon !== asText(payload.icon)) {
    return verificationFailure(
      response,
      'category_icon_verification_failed',
      readBack.ok
        ? `Category “${name}” was saved, but its persisted icon is “${category?.icon || '(empty)'}” instead of “${asText(payload.icon)}”.`
        : readBack.message,
      { ...data, iconVerified: false }
    );
  }
  return { ...response, data: { ...data, iconVerified: true } };
}

export async function categoryCommand(environment, actionType, reason, options = {}) {
  const resolved = resolveArgument(environment.workbook, environment.arguments, {
    collection: 'categories',
    keys: ['categoryId', 'category'],
    label: 'Category'
  });
  if (!resolved.ok) return resolutionFailure(environment, resolved);
  if (options.confirmed && environment.arguments.confirmed !== true) {
    return confirmationRequired(environment, `${options.actionLabel} “${resolved.value.name}”`);
  }
  const payload = {
    categoryId: resolved.id,
    ...(hasOwn(environment.arguments, 'name') ? { name: environment.arguments.name } : {}),
    ...(hasOwn(environment.arguments, 'linkedAccountName')
      ? { linkedAccountName: environment.arguments.linkedAccountName }
      : {}),
    ...Object.fromEntries(
      Object.keys(CATEGORY_CUSTOMIZATION_PROPERTIES)
        .filter((field) => hasOwn(environment.arguments, field))
        .map((field) => [field, environment.arguments[field]])
    )
  };
  const result = executeCategoryCommand(
    environment.workbook,
    { type: actionType, payload },
    environment.services
  );
  const response = await commitCommand(environment, result, reason, (next) => ({
    category: summarizeCategory(
      collection(next, 'categories').find((item) => item.id === resolved.id),
      next
    ),
    events: safeEventList(result.events)
  }));
  const shouldVerifyIcon = hasOwn(environment.arguments, 'icon');
  if (!(response.ok && response.changed && shouldVerifyIcon)) return response;
  const readBack = await readPersistedWorkbook(environment, result.workbook);
  const category = summarizeCategory(
    collection(readBack.workbook, 'categories').find((item) => item.id === resolved.id),
    readBack.workbook
  );
  const requestedIcon = asText(environment.arguments.icon);
  const data = {
    ...response.data,
    category,
    requestedIcon
  };
  if (!readBack.ok || !category || category.icon !== requestedIcon) {
    return verificationFailure(
      response,
      'category_icon_verification_failed',
      readBack.ok
        ? `Category “${asText(resolved.value.name)}” was saved, but its persisted icon is “${
            category?.icon || '(empty)'
          }” instead of “${requestedIcon}”.`
        : readBack.message,
      { ...data, iconVerified: false }
    );
  }
  return {
    ...response,
    data: { ...data, iconVerified: true }
  };
}

export async function autoAssignCategoryIcons(environment) {
  const args = environment.arguments;
  const includeHidden = asText(args.scope) === 'all';
  const includeSystem = args.includeSystem !== false;
  const candidates = collection(environment.workbook, 'categories').filter(
    (category) =>
      (includeHidden || category.isActive !== false) &&
      (includeSystem || category.isSystem !== true)
  );
  let workbook = environment.workbook;
  const events = [];
  const requestedUpdates = [];
  for (const sourceCategory of candidates) {
    const category = collection(workbook, 'categories').find(
      (item) => asText(item.id) === asText(sourceCategory.id)
    );
    const icon = matchCategoryIcon(category?.name, category?.type);
    if (category?.icon === icon) continue;
    const result = executeCategoryCommand(
      workbook,
      {
        type: CATEGORY_ACTIONS.UPDATE,
        payload: { categoryId: asText(category?.id), icon }
      },
      environment.services
    );
    if (!result.ok) {
      const cause = asArray(result.errors)[0];
      const categoryName = asText(category?.name) || '(unnamed category)';
      const categoryId = asText(category?.id);
      return envelope(environment.toolName, environment.toolCallId, {
        ok: false,
        status: 'validation_failed',
        errors: [
          errorItem(
            'category_icon_assignment_failed',
            `Could not assign “${icon}” to “${categoryName}”${
              categoryId ? ` (${categoryId})` : ''
            }: ${asText(cause?.message) || 'the category could not be updated.'}`,
            'icon'
          )
        ],
        warnings: result.warnings
      });
    }
    workbook = result.workbook;
    events.push(...asArray(result.events));
    requestedUpdates.push({
      categoryId: asText(category?.id),
      name: asText(category?.name),
      previousIcon: asText(category?.icon),
      requestedIcon: icon
    });
  }
  const buildData = (next) => {
    const updates = requestedUpdates.map((requested) => {
      const persisted = collection(next, 'categories').find(
        (category) => asText(category.id) === requested.categoryId
      );
      const icon = asText(persisted?.icon);
      return {
        ...requested,
        name: asText(persisted?.name) || requested.name,
        icon,
        verified: Boolean(persisted) && icon === requested.requestedIcon
      };
    });
    return {
      scope: includeHidden ? 'all' : 'active',
      updatedCount: updates.length,
      verifiedCount: updates.filter((update) => update.verified).length,
      updates,
      categories: candidates.map((category) =>
        summarizeCategory(
          collection(next, 'categories').find((item) => asText(item.id) === asText(category.id)),
          next
        )
      )
    };
  };
  const response = await commitCommand(
    environment,
    { ok: true, workbook, events, warnings: [], errors: [] },
    'assistant_category_icons_auto_assigned',
    buildData
  );
  if (!(response.ok && response.changed)) return response;
  const readBack = await readPersistedWorkbook(environment, workbook);
  const data = buildData(readBack.workbook);
  const unverified = data.updates.filter((update) => !update.verified);
  if (!readBack.ok || unverified.length) {
    const names = unverified.map((update) => `“${update.name}”`).join(', ');
    return verificationFailure(
      response,
      'category_icon_bulk_verification_failed',
      readBack.ok
        ? `The persisted icon could not be verified for ${names || 'one or more categories'}. Review the returned icon values and retry those categories.`
        : readBack.message,
      data
    );
  }
  return { ...response, data };
}
