import { parseNotesAmount, parseNotesDate } from './notes-value-parser.js';

function cleanLine(text) {
  return text
    .trim()
    .replace(/^(?:[-*]\s+|•\s*|\d+[.)]\s+)/, '')
    .replace(/^\[ \]\s*/, 'unpaid ')
    .replace(/^\[x\]\s*/i, '')
    .trim();
}

function isDateHeading(text, today) {
  const result = parseNotesDate(text, today);
  if (!result.explicit) return null;
  const remainder = result.matchedTexts
    .reduce((value, phrase) => value.replace(phrase, ''), text)
    .replace(
      /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|date)\b/gi,
      ''
    )
    .replace(/[\s,:#–—-]/g, '');
  return remainder ? null : result;
}

export function notesSourceLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line, index) => ({ lineNumber: index + 1, text: line.trim() }))
    .filter((line) => line.text);
}

// Segment only explicit boundaries. Uncertain prose stays in the original note, not a guessed ledger row.
export function prepareNotesSources(text, { today = '', currency = 'PHP' } = {}) {
  const sources = [];
  let dateContext = null;
  let pending = null;
  const lines = String(text || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const clean = cleanLine(raw);
    if (!clean) {
      pending = null;
      continue;
    }
    const heading = isDateHeading(clean, today);
    if (heading) {
      dateContext = { ...heading, text: raw.trim(), lineNumber: index + 1 };
      pending = null;
      continue;
    }
    if (
      /^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(?:20\d{2})\s*:?$/i.test(
        clean
      )
    ) {
      dateContext = { date: '', ambiguous: true, text: raw.trim(), lineNumber: index + 1 };
      pending = null;
      continue;
    }
    if (
      /^(?:#{1,6}\s|(?:expenses?|income|spending|purchases?|notes?|shopping list)\s*:*$)/i.test(
        clean
      ) ||
      /^(?:grand\s+total|subtotal|total|balance|remaining|budget|limit)\s*(?::|=|[-–—]|[₱$€£\d])/i.test(
        clean
      ) ||
      /^(?:todo|to-do|reminder|remember|note to self)\b/i.test(clean)
    ) {
      pending = null;
      continue;
    }
    const previous = sources[sources.length - 1];
    const continuation =
      /^(?:actually|correction|corrected|instead|make that|not|amount|cost|price|paid\s+(?:with|via|using)|payment(?:\s+method)?|account|date|description|merchant|note)\s*[:=-]?\s+/i.test(
        clean
      ) || /^(?:cash|gcash|maya|credit\s*card|debit(?:\s*card)?|bank)\s*$/i.test(clean);
    if (previous && pending === previous && continuation) {
      previous.sourceText += `\n${raw}`;
      previous.parseText += ` ${clean.replace(/^(?:amount|cost|price|payment(?:\s+method)?|account|date|description|merchant|note)\s*[:=]\s*/i, '')}`;
      previous.sourceLineNumbers.push(index + 1);
      continue;
    }
    const pieces = clean.split(/\s*;\s*/).filter(Boolean);
    for (let part = 0; part < pieces.length; part += 1) {
      const piece = pieces[part];
      const date = parseNotesDate(piece, today);
      const withoutDate = date.matchedTexts.reduce(
        (value, phrase) => value.replace(phrase, ' '),
        piece
      );
      const amount = parseNotesAmount(withoutDate, currency);
      const hasAmount =
        amount.matchedTexts.length > 0 ||
        /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|kay)\b/i.test(
          piece
        );
      // A merchant/purpose on one line followed by an amount is one note, not two transactions.
      if (
        hasAmount &&
        pending?.hasAmount === false &&
        sources[sources.length - 1] === pending &&
        part === 0
      ) {
        pending.sourceText += `\n${raw}`;
        pending.parseText += ` ${piece}`;
        pending.sourceLineNumbers.push(index + 1);
        pending.hasAmount = true;
        continue;
      }
      const next = cleanLine(lines[index + 1] || '');
      const possibleContinuation =
        /^(?:amount|cost|price|paid|payment|account|date)\b/i.test(next) ||
        parseNotesAmount(next, currency).matchedTexts.length > 0;
      if (!hasAmount && !possibleContinuation) {
        pending = null;
        continue;
      }
      const source = {
        lineNumber: index + 1,
        sourceLineNumbers: [index + 1],
        sourceText: pieces.length === 1 ? raw.trim() : piece,
        parseText: piece,
        dateContext,
        hasAmount,
        segmentIndex: part
      };
      sources.push(source);
      pending = source;
    }
  }
  return sources;
}
