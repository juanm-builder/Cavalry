import { advisorTransactionFieldLabel } from '../../domain/advisor/transaction-drafts.js';

function asString(value) {
  return String(value || '').trim();
}

function formatAmount(fields = {}) {
  const amount = Number(fields.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return '';
  }
  const currency = asString(fields.currency).toUpperCase();
  return (currency ? currency + ' ' : '') + String(amount);
}

function getAction(blocked) {
  return blocked && blocked.action && typeof blocked.action === 'object' ? blocked.action : {};
}

function getFields(blocked) {
  const action = getAction(blocked);
  return action.fields && typeof action.fields === 'object' ? action.fields : {};
}

export function summarizeAdvisorPartialTransactionCandidate(blocked, index = 0) {
  const item = blocked && typeof blocked === 'object' ? blocked : {};
  const action = getAction(item);
  const fields = getFields(item);
  const known = [
    asString(fields.date) ? 'date: ' + asString(fields.date) : '',
    asString(fields.description) ? 'description: ' + asString(fields.description) : '',
    asString(fields.counterpartyName) ? 'merchant: ' + asString(fields.counterpartyName) : '',
    formatAmount(fields) ? 'amount: ' + formatAmount(fields) : '',
    asString(fields.primaryAccountName)
      ? advisorTransactionFieldLabel('primaryAccountId', action.template) +
        ': ' +
        asString(fields.primaryAccountName)
      : '',
    asString(fields.categoryName) ? 'category: ' + asString(fields.categoryName) : ''
  ].filter(Boolean);
  const missing = (Array.isArray(action.missingFields) ? action.missingFields : [])
    .map((field) => advisorTransactionFieldLabel(field, action.template))
    .filter(Boolean);
  return {
    label: 'Candidate ' + String(index + 1),
    known,
    missing,
    reason: asString(item.reason)
  };
}

export function buildAdvisorPartialTransactionRecovery({ blockedItems, diagnostic, note } = {}) {
  const items = (Array.isArray(blockedItems) ? blockedItems : [])
    .map(summarizeAdvisorPartialTransactionCandidate)
    .filter((item) => item.known.length || item.missing.length || item.reason);
  const lines = [
    'I could read part of the attached image, but I need a little more before I can show a reviewable transaction draft. Nothing changed yet.'
  ];
  if (items.length) {
    lines.push('');
    lines.push('What I could read:');
    items.slice(0, 4).forEach((item) => {
      lines.push(
        '- ' +
          item.label +
          ': ' +
          (item.known.length ? item.known.join('; ') : 'some details were visible')
      );
      if (item.missing.length) {
        lines.push('  Still needed: ' + item.missing.join(', ') + '.');
      } else if (item.reason) {
        lines.push('  Review issue: ' + item.reason.replace(/[.]+$/g, '') + '.');
      }
    });
  }
  const diagnosticReason = asString(note) || asString(diagnostic && diagnostic.reason);
  if (diagnosticReason) {
    lines.push('');
    lines.push('Advisor note: ' + diagnosticReason);
  }
  return lines.join('\n');
}
