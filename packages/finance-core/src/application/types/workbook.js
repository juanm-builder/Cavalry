// @ts-check

/**
 * @typedef {{ id?: string, name?: string, type?: string, institution?: string, institutionId?: string, details?: Record<string, string | number>, archived?: boolean, [key: string]: unknown }} WorkbookAccount
 *
 * @typedef {{ id?: string, name?: string, type?: string, icon?: string, color?: string, description?: string, archived?: boolean, [key: string]: unknown }} WorkbookCategory
 *
 * @typedef {{
 *   id?: string,
 *   date?: string,
 *   description?: string,
 *   amount?: number,
 *   accountId?: string,
 *   categoryId?: string,
 *   lines?: Array<Record<string, unknown>>,
 *   [key: string]: unknown
 * }} WorkbookTransaction
 *
 * @typedef {{
 *   id?: string,
 *   name?: string,
 *   currency?: string,
 *   accounts?: WorkbookAccount[],
 *   categories?: WorkbookCategory[],
 *   transactions?: WorkbookTransaction[],
 *   budgets?: Array<Record<string, unknown>>,
 *   recurringItems?: Array<Record<string, unknown>>,
 *   settings?: Record<string, unknown>,
 *   [key: string]: unknown
 * }} CavalryWorkbook
 */

export {};
