import { normalizeWorkbookReviewGroups } from './review-groups.js';

export function normalizeWorkbookName(value) {
  const name = String(value || '').trim();
  return name.toLowerCase() === 'ledger grove' ? 'Cavalry' : name || 'Cavalry';
}

export function normalizeWorkbookIdentity(raw, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const uid =
    typeof options.uid === 'function'
      ? options.uid
      : (prefix) => String(prefix || 'id') + '_' + Math.random().toString(36).slice(2);
  const timestamp = now();
  const currentYear = timestamp.getFullYear();
  return {
    id: String(raw && raw.id ? raw.id : uid('workbook')),
    version: 2,
    name: normalizeWorkbookName(raw && raw.name),
    year: Number(raw && raw.year) || currentYear,
    currency:
      String(raw && raw.currency ? raw.currency : 'PHP')
        .trim()
        .toUpperCase() || 'PHP',
    createdAt: String(raw && raw.createdAt ? raw.createdAt : timestamp.toISOString()),
    updatedAt: String(raw && raw.updatedAt ? raw.updatedAt : timestamp.toISOString())
  };
}

export function normalizeWorkbookSettings(raw, options = {}) {
  const settings = raw && raw.settings ? raw.settings : {};
  return {
    usdToBaseRate: Number(settings.usdToBaseRate) || 0,
    hiddenMonthlyMetrics: Object.assign({}, settings.hiddenMonthlyMetrics || {}),
    dashboardLayout: options.dashboardLayout,
    activeAdvisorThreadId: String(settings.activeAdvisorThreadId || ''),
    subscriptionReviewDecisions: options.subscriptionReviewDecisions || {}
  };
}

export function normalizeWorkbookAdvisorDraftGroups(raw, options = {}) {
  return normalizeWorkbookReviewGroups(
    raw && (raw.advisorDraftGroups || raw.advisor_draft_groups),
    options
  );
}
