import { roundMoney } from '../../domain/money.js';
import {
  normalizeRecurringFrequency,
  normalizeRecurringKind
} from './recurring-analysis-service.js';
import { normalizeRecurringItemForCommand } from './recurring-command-service.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getCategoryById(workbook, categoryId) {
  const id = asString(categoryId);
  return (
    asArray(workbook && workbook.categories).find(
      (category) => asString(category && category.id) === id
    ) || null
  );
}

function isBillLikeCategory(category, name) {
  const source = `${asString(category && category.name)} ${asString(name)}`;
  return /bill|subscription|subscript|rent|utility|utilities|electric|water|internet|phone|insurance|netflix|spotify|icloud|prime|gym|membership|dues/i.test(
    source
  );
}

function inferBillKind(category, name) {
  const source = `${asString(category && category.name)} ${asString(name)}`.toLowerCase();
  return /subscription|subscript|netflix|spotify|prime|icloud|membership|dues/.test(source)
    ? 'subscription'
    : 'bill';
}

function recurringItemSignature(item) {
  return [
    normalizeRecurringKind(item && item.kind),
    asString(item && item.categoryId),
    asString(item && item.name).toLowerCase(),
    asString(item && item.accountId),
    normalizeRecurringFrequency(item && item.frequency).toLowerCase(),
    asString(item && item.currency).toUpperCase(),
    String(
      roundMoney(
        Number(item && typeof item.amount !== 'undefined' ? item.amount : item && item.planned) || 0
      )
    )
  ].join('|');
}

function slug(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
}

function makeLegacyRecurringItemId(sheet, item, itemIndex, options) {
  const fallback =
    typeof options.createId === 'function'
      ? options.createId('legacy_bill', itemIndex)
      : `legacy_bill_${itemIndex}`;
  return `recurring_${slug(`${asString(sheet && sheet.id) || 'sheet'}_${asString(item && item.id) || fallback}`)}`;
}

function getMigrationDefaultDate(workbook, sheet, options) {
  const supplied = typeof options.today === 'function' ? options.today() : options.today;
  const today = asString(supplied) || new Date().toISOString().slice(0, 10);
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7)) - 1;
  const year = Number(workbook && workbook.year) || currentYear;
  const monthIndex = Number(sheet && sheet.monthIndex) || 0;
  if (year === currentYear && monthIndex === currentMonth) {
    return today;
  }
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-01`;
}

export function shouldMigrateLegacyRecurringLineItem(item, category) {
  if (!(item && category && category.type === 'expense') || item.isActive === false) {
    return false;
  }
  const name = asString(item.name).toLowerCase();
  const note = asString(item.note).toLowerCase();
  if (name === 'general plan' && note === 'created from category planned amount') {
    return false;
  }
  return (
    item.isRecurringBill === true ||
    asString(item.kind).toLowerCase() === 'subscription' ||
    !!asString(item.dueDate) ||
    !!asString(item.paymentMethod) ||
    !!asString(item.accountId) ||
    isBillLikeCategory(category, item.name)
  );
}

// This mutates the already-cloned workbook being normalized and reports what compatibility work occurred.
export function migrateLegacyRecurringLineItems(workbook, options = {}) {
  if (!workbook || !Array.isArray(workbook.sheets)) {
    return { workbook, created: 0, linked: 0 };
  }
  workbook.recurringItems = asArray(workbook.recurringItems);
  const byId = new Map();
  const bySignature = new Map();
  workbook.recurringItems.forEach((item) => {
    if (asString(item && item.id)) {
      byId.set(asString(item.id), item);
    }
    bySignature.set(recurringItemSignature(item), item);
  });

  let created = 0;
  let linked = 0;
  workbook.sheets.forEach((sheet) => {
    asArray(sheet && sheet.budgetLineItems).forEach((item, itemIndex) => {
      const category = getCategoryById(workbook, item && item.categoryId);
      if (!shouldMigrateLegacyRecurringLineItem(item, category)) {
        return;
      }
      const signatureSource = {
        kind: item.kind || inferBillKind(category, item.name),
        categoryId: item.categoryId,
        name: item.name || category.name || 'Recurring item',
        accountId: item.accountId || '',
        amount: Number(item.planned) || 0,
        currency: item.currency || workbook.currency,
        frequency: item.frequency || 'Monthly'
      };
      const signature = recurringItemSignature(signatureSource);
      let recurringItem =
        byId.get(asString(item.recurringItemId)) || bySignature.get(signature) || null;
      if (!recurringItem) {
        const defaultDate = getMigrationDefaultDate(workbook, sheet, options);
        recurringItem = normalizeRecurringItemForCommand(
          {
            id: makeLegacyRecurringItemId(sheet, item, itemIndex, options),
            kind: signatureSource.kind,
            name: signatureSource.name,
            categoryId: signatureSource.categoryId,
            accountId: signatureSource.accountId,
            amount: signatureSource.amount,
            currency: signatureSource.currency,
            frequency: signatureSource.frequency,
            anchorDate: item.dueDate || defaultDate,
            autoRenew:
              item.autoRenew === true || asString(item.kind).toLowerCase() === 'subscription',
            isActive: item.isActive !== false,
            note: item.note || ''
          },
          workbook.recurringItems.length,
          workbook.currency,
          { defaultDate }
        );
        workbook.recurringItems.push(recurringItem);
        byId.set(recurringItem.id, recurringItem);
        bySignature.set(signature, recurringItem);
        created += 1;
      }
      if (item.recurringItemId !== recurringItem.id) {
        item.recurringItemId = recurringItem.id;
        linked += 1;
      }
    });
  });
  return { workbook, created, linked };
}
