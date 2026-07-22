function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPortableWorkbookHtml(workbook) {
  const sourceWorkbook = workbook || {};
  const payload = JSON.stringify(sourceWorkbook, null, 2).replace(/</g, '\\u003c');
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Cavalry Workbook Export</title><style>body{font-family:"Courier New",monospace;background:#0b0b0b;color:#f3f3f3;padding:32px;line-height:1.6}main{max-width:860px;margin:0 auto}pre{background:#151515;border:1px solid #2a2a2a;border-radius:12px;padding:12px;white-space:pre-wrap}p{color:#b9b9b9}</style></head><body><main><h1>Cavalry Workbook Export</h1><p>Import this file back into Cavalry from Settings.</p><pre>Workbook: ' +
    escapeHtml(sourceWorkbook.name) +
    '\nYear: ' +
    escapeHtml(String(sourceWorkbook.year || '')) +
    '\nAccounts: ' +
    escapeHtml(String((sourceWorkbook.accounts || []).length)) +
    '\nTransactions: ' +
    escapeHtml(String((sourceWorkbook.transactions || []).length)) +
    '</pre><script id="ledger-grove-export" type="application/json">' +
    payload +
    '</script></main></body></html>'
  );
}

export function parsePortableWorkbookText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('The selected file is empty.');
  }
  if (trimmed[0] === '{') {
    return JSON.parse(trimmed);
  }
  const match = trimmed.match(
    /<script id=["']ledger-grove-export["'] type=["']application\/json["']>([\s\S]*?)<\/script>/i
  );
  if (!match) {
    throw new Error('This file does not contain a Cavalry workbook payload.');
  }
  return JSON.parse(match[1]);
}
