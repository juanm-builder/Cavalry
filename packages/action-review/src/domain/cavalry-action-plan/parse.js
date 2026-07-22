import { createValidationIssue } from './issues.js';
import { normalizeCavalryActionPlan } from './normalize.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function extractCavalryActionPlanJsonText(input) {
  const text = asString(input);
  if (!text) {
    return '';
  }
  if (text[0] === '{' || text[0] === '[') {
    return text;
  }
  const fenced = /```(?:json|cavalryplan|cavalry-action-plan)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    return text.slice(firstObject, lastObject + 1).trim();
  }
  return text;
}

export function parseCavalryActionPlan(input, options = {}) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const normalized = normalizeCavalryActionPlan(input, options);
    return {
      ok: normalized.issues.every((issue) => issue.severity !== 'blocked'),
      plan: normalized.plan,
      issues: normalized.issues,
      raw: input
    };
  }
  const jsonText = extractCavalryActionPlanJsonText(input);
  if (!jsonText) {
    return {
      ok: false,
      plan: null,
      issues: [
        createValidationIssue(
          'invalid_json',
          'Action plan text is empty or does not contain JSON.',
          {
            severity: 'blocked'
          }
        )
      ],
      raw: ''
    };
  }
  try {
    const parsed = JSON.parse(jsonText);
    const normalized = normalizeCavalryActionPlan(parsed, options);
    return {
      ok: normalized.issues.every((issue) => issue.severity !== 'blocked'),
      plan: normalized.plan,
      issues: normalized.issues,
      raw: parsed
    };
  } catch (error) {
    return {
      ok: false,
      plan: null,
      issues: [
        createValidationIssue(
          'invalid_json',
          error && error.message ? error.message : 'Action plan JSON could not be parsed.',
          {
            severity: 'blocked'
          }
        )
      ],
      raw: jsonText
    };
  }
}
