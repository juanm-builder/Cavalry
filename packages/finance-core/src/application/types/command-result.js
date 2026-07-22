// @ts-check

/**
 * @typedef {{ type: string, [key: string]: unknown }} DomainEvent
 *
 * @typedef {{ code?: string, message?: string, [key: string]: unknown }} CommandWarning
 *
 * @typedef {{ code?: string, message?: string, [key: string]: unknown }} CommandError
 *
 * @template [Workbook=unknown]
 * @typedef {{
 *   ok: boolean,
 *   workbook?: Workbook,
 *   events: DomainEvent[],
 *   warnings: CommandWarning[],
 *   errors: CommandError[]
 * }} CommandResult
 */

export {};

export function cloneWorkbook(workbook) {
  if (workbook == null) return workbook;
  if (typeof structuredClone === 'function') return structuredClone(workbook);
  return JSON.parse(JSON.stringify(workbook));
}

export function commandOk(workbook, extra = {}) {
  return Object.assign(
    {
      ok: true,
      workbook,
      events: [],
      warnings: [],
      errors: []
    },
    extra
  );
}

export function commandError(workbook, error, extra = {}) {
  return Object.assign(
    {
      ok: false,
      workbook,
      events: [],
      warnings: [],
      errors: error ? [error] : []
    },
    extra
  );
}
