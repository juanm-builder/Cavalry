import { collection, errorItem } from './cavalry-assistant-command-result-support.js';
import { asArray, asText, hasOwn, textKey } from './cavalry-assistant-tool-definitions.js';
import {
  entitySuggestionLabel,
  fuzzyEntitySuggestions
} from './cavalry-assistant-entity-matching.js';

export function resolveEntity(items, reference, options = {}) {
  const ref = asText(reference);
  if (!ref) {
    return options.optional
      ? { ok: true, value: null, id: '', provided: false }
      : {
          ok: false,
          status: 'validation_failed',
          error: errorItem(
            'reference_required',
            `${options.label || 'Entity'} is required.`,
            options.field
          )
        };
  }
  const key = textKey(ref);
  const names = options.names || ['name'];
  const exactIds = options.preferId
    ? asArray(items).filter((item) => textKey(item && item.id) === key)
    : [];
  const matches = exactIds.length
    ? exactIds
    : asArray(items).filter((item) => {
        if (textKey(item && item.id) === key) return true;
        return names.some((name) => textKey(item && item[name]) === key);
      });
  if (!matches.length) {
    const suggestions = fuzzyEntitySuggestions(items, ref, names);
    return {
      ok: false,
      status: 'not_found',
      error: errorItem(
        'reference_not_found',
        `${options.label || 'Entity'} “${ref}” was not found.${
          suggestions ? ` Closest matches: ${suggestions}. Retry with the intended ID.` : ''
        }`,
        options.field
      )
    };
  }
  if (matches.length > 1) {
    const matchList = matches.slice(0, 5).map(entitySuggestionLabel).join(', ');
    return {
      ok: false,
      status: 'ambiguous_reference',
      error: errorItem(
        'ambiguous_reference',
        `${options.label || 'Entity'} “${ref}” matches more than one record: ${matchList}. Use its ID.`,
        options.field
      )
    };
  }
  return { ok: true, value: matches[0], id: asText(matches[0].id), provided: true };
}

export function firstArgument(args, keys) {
  for (const key of keys) {
    if (hasOwn(args, key)) return args[key];
  }
  return undefined;
}

export function hasAnyArgument(args, keys) {
  return keys.some((key) => hasOwn(args, key));
}

export function resolveArgument(workbook, args, options) {
  const keys = options.keys.filter((key) => hasOwn(args, key) && typeof args[key] !== 'undefined');
  const provided = keys.length > 0;
  if (!provided && options.optional) {
    return { ok: true, value: null, id: '', provided: false };
  }
  let resolved;
  for (const field of provided ? keys : [options.keys[0]]) {
    const reference = args[field];
    const candidate =
      provided && !asText(reference) && options.allowEmpty
        ? { ok: true, value: null, id: '', provided: true }
        : resolveEntity(collection(workbook, options.collection), reference, {
            optional: options.optional,
            label: options.label,
            field,
            names: options.names,
            preferId: field.endsWith('Id')
          });
    if (!candidate.ok) return candidate;
    if (resolved && resolved.id !== candidate.id) {
      return {
        ok: false,
        status: 'validation_failed',
        error: errorItem(
          'conflicting_references',
          `${options.label || 'Entity'} references identify different records. Use one exact ID.`,
          field
        )
      };
    }
    resolved = candidate;
  }
  return resolved;
}
