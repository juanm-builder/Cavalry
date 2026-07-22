import React from 'react';

import { formatUiDateTime } from './date-format.js';

function safeLinkTarget(value) {
  const target = String(value || '').trim();
  return /^(?:https?:|mailto:|#|\/)/i.test(target) ? target : '';
}

function referenceIdentity(reference, index) {
  const sourceRefs = Array.isArray(reference?.source_refs)
    ? reference.source_refs.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  return sourceRefs.length
    ? sourceRefs.slice().sort().join('\u001f')
    : String(reference?.id || `reference-${index}`);
}

function referenceAliasKey(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase();
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function referenceKindLabel(kind) {
  const key = String(kind || '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return (
    {
      account: 'Account',
      transaction: 'Transaction',
      category: 'Category',
      sheet: 'Budget month',
      budget: 'Budget',
      recurringitem: 'Bill or subscription',
      evidence: 'Supporting records'
    }[key] || 'Record'
  );
}

function isWordCharacter(value) {
  return Boolean(value) && /[\p{L}\p{N}_]/u.test(value);
}

function hasReferenceBoundaries(text, start, length) {
  const first = text[start];
  const last = text[start + length - 1];
  const before = text[start - 1];
  const after = text[start + length];
  return (
    (!isWordCharacter(first) || !isWordCharacter(before)) &&
    (!isWordCharacter(last) || !isWordCharacter(after))
  );
}

function findReferenceMatch(text, alias, cursor) {
  const pattern = alias.text.split(/\s+/).map(regexEscape).join('\\s+');
  let matcher;
  try {
    matcher = new RegExp(pattern, 'giu');
  } catch (_error) {
    return null;
  }
  matcher.lastIndex = cursor;
  let match = matcher.exec(text);
  while (match) {
    if (hasReferenceBoundaries(text, match.index, match[0].length)) {
      return { index: match.index, length: match[0].length };
    }
    if (!match[0].length) matcher.lastIndex += 1;
    match = matcher.exec(text);
  }
  return null;
}

function prepareReferenceAliases(references, onOpenReference) {
  if (typeof onOpenReference !== 'function' || !Array.isArray(references)) return [];
  const aliases = new Map();

  references.forEach((reference, referenceIndex) => {
    if (!(reference && typeof reference === 'object')) return;
    if (String(reference.anchor || '').trim()) return;
    const identity = referenceIdentity(reference, referenceIndex);
    const candidates = [reference.token].concat(
      Array.isArray(reference.aliases) ? reference.aliases : []
    );
    const seen = new Set();
    candidates.forEach((candidate) => {
      const text = String(candidate || '').trim();
      const key = referenceAliasKey(text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const entry = aliases.get(key) || { key, text, references: new Map() };
      entry.references.set(identity, reference);
      aliases.set(key, entry);
    });
  });

  return [...aliases.values()]
    .filter((entry) => entry.references.size === 1)
    .map((entry) => ({
      ...entry,
      reference: entry.references.values().next().value
    }))
    .sort((left, right) => right.text.length - left.text.length);
}

function anchoredReference(references, anchor) {
  const target = String(anchor || '').trim();
  if (!target || !Array.isArray(references)) return null;
  return (
    references.find(
      (reference) =>
        reference &&
        typeof reference === 'object' &&
        String(reference.anchor || '').trim() === target
    ) || null
  );
}

function captionText(value) {
  return String(value == null ? '' : value).trim();
}

function captionDetail(reference) {
  const detail = reference?.detail;
  return detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
}

function isoCaptionDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(captionText(value));
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function shortCaptionDate(iso) {
  if (!iso) return '';
  return formatUiDateTime(iso, {
    format: { month: 'short', day: 'numeric', year: undefined, timeZone: 'UTC' }
  });
}

function monthYearCaption(iso) {
  if (!iso) return '';
  return formatUiDateTime(iso, {
    format: { month: 'short', day: undefined, year: 'numeric', timeZone: 'UTC' }
  });
}

function captionMoney(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  const currencyCode = captionText(currency).toUpperCase() || 'PHP';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'narrowSymbol'
    }).format(value);
  } catch (_error) {
    return `${currencyCode} ${value.toLocaleString('en-US')}`;
  }
}

function truncateCaption(value, limit = 24) {
  const text = captionText(value);
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function captionRecords(detail) {
  return Array.isArray(detail.records) ? detail.records : [];
}

function captionSourceCount(reference, detail) {
  const sourceRefs = Array.isArray(reference?.source_refs) ? reference.source_refs : [];
  return Math.max(
    sourceRefs.filter((value) => captionText(value)).length,
    captionRecords(detail).length,
    Number(detail.sourceCount) || 0,
    Number(detail.transactionCount) || 0,
    1
  );
}

function uniqueRecordDetailValue(detail, key) {
  const values = new Set(
    [
      captionText(detail[key]),
      ...captionRecords(detail).map((record) => captionText(record?.detail?.[key]))
    ].filter(Boolean)
  );
  return values.size === 1 ? values.values().next().value : '';
}

function dateSpanCaption(dates, count, noun) {
  const firstIso = dates[0];
  const lastIso = dates.at(-1);
  if (count === 1) {
    const single = shortCaptionDate(firstIso);
    return { text: single, spoken: single };
  }
  if (firstIso === lastIso) {
    const day = shortCaptionDate(firstIso);
    return { text: `${day} ×${count}`, spoken: `${count} ${noun} on ${day}` };
  }
  const sameYear = firstIso.slice(0, 4) === lastIso.slice(0, 4);
  const first = sameYear ? shortCaptionDate(firstIso) : monthYearCaption(firstIso);
  const last = sameYear ? shortCaptionDate(lastIso) : monthYearCaption(lastIso);
  return { text: `${first}–${last}`, spoken: `${first} to ${last}` };
}

function sourceReferenceCaption(reference) {
  const detail = captionDetail(reference);
  const records = captionRecords(detail);
  const count = captionSourceCount(reference, detail);
  const kind = captionText(reference?.kind);
  const plain = (text) => ({ text, spoken: text });

  if (kind === 'transaction' || kind === 'evidence') {
    const noun = kind === 'evidence' ? 'records' : 'transactions';
    const recordDates = records
      .map((record) => isoCaptionDate(record?.detail?.date))
      .filter(Boolean);
    const dates = [
      ...new Set([isoCaptionDate(detail.date), ...recordDates].filter(Boolean))
    ].sort();
    // Date captions must describe every counted record, or they overclaim.
    const datesCoverCount = records.length ? recordDates.length === count : count === 1;
    if (dates.length && datesCoverCount) return dateSpanCaption(dates, count, noun);
    if (count > 1) return plain(`${count} ${noun}`);
    if (kind === 'transaction') {
      const amount = records.length === 1 ? records[0]?.detail : detail;
      const money = captionMoney(
        detail.amount ?? amount?.amount,
        captionText(detail.currency) || captionText(amount?.currency)
      );
      return plain(money || 'transaction');
    }
    return plain('records');
  }
  if (kind === 'recurringItem') {
    const recurringKind = uniqueRecordDetailValue(detail, 'kind').toLocaleLowerCase();
    const word = recurringKind === 'bill' || recurringKind === 'subscription' ? recurringKind : '';
    if (count > 1) return plain(`${count} ${word ? `${word}s` : 'recurring'}`);
    return plain(word || 'recurring');
  }
  if (kind === 'account') return plain(count > 1 ? `${count} accounts` : 'account');
  if (kind === 'category') return plain(count > 1 ? `${count} categories` : 'category');
  if (kind === 'budget' || kind === 'sheet') {
    const sheetName =
      uniqueRecordDetailValue(detail, 'sheetName') ||
      (kind === 'sheet' && count === 1 ? captionText(reference?.label) : '');
    if (sheetName) return plain(truncateCaption(`${sheetName} budget`));
    if (count > 1) return plain(kind === 'sheet' ? `${count} budget months` : `${count} budgets`);
    return plain('budget');
  }
  return plain('source');
}

function SourceReferenceButton({ reference, onOpenReference, keyValue }) {
  const sourceCount = Array.isArray(reference?.source_refs) ? reference.source_refs.length : 0;
  const label = String(reference?.label || 'Supporting records').trim();
  const caption = sourceReferenceCaption(reference);
  const text = caption.text || 'source';
  const captionAddsDetail =
    text !== 'source' && text.toLocaleLowerCase() !== label.toLocaleLowerCase();
  return (
    <button
      aria-label={`Open ${sourceCount > 1 ? `${sourceCount} sources` : 'source'}: ${label}${
        captionAddsDetail ? `, ${caption.spoken}` : ''
      }`}
      className="markdown-source-reference"
      data-reference-kind={reference?.kind || undefined}
      key={keyValue}
      onClick={() => onOpenReference(reference)}
      title={`Open ${label}${captionAddsDetail ? ` — ${text}` : ''}`}
      type="button"
    >
      {text}
    </button>
  );
}

function renderReferenceText(source, keyPrefix, options) {
  const text = String(source || '');
  if (options.referenceMode === 'claim') return text;
  const aliases = options.referenceAliases || [];
  if (!text || !aliases.length) return text;
  const output = [];
  let cursor = 0;
  let outputIndex = 0;

  while (cursor < text.length) {
    let selected = null;
    let selectedIndex = text.length;

    aliases.forEach((alias) => {
      const match = findReferenceMatch(text, alias, cursor);
      const matchIndex = match?.index ?? -1;
      if (
        matchIndex >= 0 &&
        (matchIndex < selectedIndex ||
          (matchIndex === selectedIndex && alias.text.length > (selected?.text.length || 0)))
      ) {
        selected = { ...alias, matchLength: match.length };
        selectedIndex = matchIndex;
      }
    });

    if (!selected) {
      output.push(text.slice(cursor));
      break;
    }
    if (selectedIndex > cursor) output.push(text.slice(cursor, selectedIndex));
    const visibleText = text.slice(selectedIndex, selectedIndex + selected.matchLength);
    output.push(
      <button
        aria-label={`Open ${referenceKindLabel(selected.reference.kind)}: ${
          selected.reference.label || visibleText
        }`}
        className="markdown-reference"
        data-reference-kind={selected.reference.kind || undefined}
        key={`${keyPrefix}-reference-${outputIndex}`}
        onClick={() => options.onOpenReference(selected.reference)}
        title={`Open ${selected.reference.label || visibleText}`}
        type="button"
      >
        {visibleText}
      </button>
    );
    outputIndex += 1;
    cursor = selectedIndex + selected.matchLength;
  }

  return output;
}

function renderInline(source, keyPrefix = 'inline', options = {}) {
  const text = String(source || '');
  const tokenPattern =
    /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|`[^`\n]+?`|\[[^\]\n]+\]\([^\s)]+\)|\*[^*\n]+?\*|_[^_\n]+?_)/g;
  const output = [];
  let cursor = 0;
  let match = tokenPattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      output.push(
        renderReferenceText(text.slice(cursor, match.index), `${keyPrefix}-${cursor}`, options)
      );
    }
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith('**') || token.startsWith('__')) {
      output.push(
        <strong key={key}>{renderInline(token.slice(2, -2), `${key}-strong`, options)}</strong>
      );
    } else if (token.startsWith('~~')) {
      output.push(<s key={key}>{renderInline(token.slice(2, -2), `${key}-strike`, options)}</s>);
    } else if (token.startsWith('`')) {
      output.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const separator = token.lastIndexOf('](');
      const label = token.slice(1, separator);
      const href = safeLinkTarget(token.slice(separator + 2, -1));
      const citation = anchoredReference(options.references, href);
      output.push(
        citation && typeof options.onOpenReference === 'function' ? (
          <SourceReferenceButton
            key={key}
            keyValue={key}
            onOpenReference={options.onOpenReference}
            reference={citation}
          />
        ) : href ? (
          <a href={href} key={key} rel="noopener noreferrer" target="_blank">
            {renderInline(label, `${key}-link`, { ...options, referenceAliases: [] })}
          </a>
        ) : (
          token
        )
      );
    } else {
      output.push(<em key={key}>{renderInline(token.slice(1, -1), `${key}-em`, options)}</em>);
    }

    cursor = match.index + token.length;
    match = tokenPattern.exec(text);
  }

  if (cursor < text.length) {
    output.push(renderReferenceText(text.slice(cursor), `${keyPrefix}-${cursor}`, options));
  }
  return output;
}

function referencesForClaim(source, options) {
  const text = String(source || '');
  const references = new Map();
  (options.referenceAliases || []).forEach((alias) => {
    if (!findReferenceMatch(text, alias, 0)) return;
    references.set(referenceIdentity(alias.reference, references.size), alias.reference);
  });
  return [...references.values()];
}

function renderClaimSources(source, keyPrefix, options) {
  if (options.referenceMode !== 'claim' || typeof options.onOpenReference !== 'function') {
    return null;
  }
  const references = referencesForClaim(source, options);
  if (!references.length) return null;
  return (
    <span className="markdown-claim-sources" key={`${keyPrefix}-sources`}>
      {references.map((reference, index) => (
        <SourceReferenceButton
          key={`${keyPrefix}-source-${referenceIdentity(reference, index)}`}
          keyValue={`${keyPrefix}-source-${referenceIdentity(reference, index)}`}
          onOpenReference={options.onOpenReference}
          reference={reference}
        />
      ))}
    </span>
  );
}

function listLine(line) {
  const match = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/.exec(line);
  if (!match) return null;
  return {
    indent: match[1].replace(/\t/g, '    ').length,
    ordered: /^\d/.test(match[2]),
    text: match[3]
  };
}

function blockStart(line) {
  return (
    /^\s*$/.test(line) ||
    /^ {0,3}#{1,6}\s+/.test(line) ||
    /^ {0,3}```/.test(line) ||
    /^ {0,3}>\s?/.test(line) ||
    /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^ {0,3}\|.*\|/.test(line) ||
    Boolean(listLine(line))
  );
}

const TABLE_MAX_COLUMNS = 24;
const TABLE_MAX_ROWS = 400;

function splitTableRow(line) {
  const trimmed = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  const cells = [];
  let current = '';
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === '\\' && trimmed[index + 1] === '|') {
      current += '|';
      index += 1;
    } else if (character === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function tableSeparatorAlignments(line) {
  if (!/^ {0,3}[\s|:-]+$/.test(line) || !line.includes('|')) return null;
  const alignments = [];
  for (const cell of splitTableRow(line)) {
    const marks = /^(:?)-+(:?)$/.exec(cell);
    if (!marks) return null;
    alignments.push(marks[1] && marks[2] ? 'center' : marks[2] ? 'right' : marks[1] ? 'left' : '');
  }
  return alignments;
}

function tableStart(lines, index) {
  const line = lines[index] || '';
  if (!line.includes('|')) return false;
  const alignments = tableSeparatorAlignments(lines[index + 1] || '');
  if (!alignments || alignments.length > TABLE_MAX_COLUMNS) return false;
  return splitTableRow(line).length === alignments.length;
}

function tableRow(line) {
  // A body row is a pipe-led line, or a pipe-containing line that no other block claims.
  return line.includes('|') && (/^ {0,3}\|/.test(line) || !blockStart(line));
}

function parseTable(lines, start, keyPrefix, options) {
  if (!tableStart(lines, start)) return null;
  const alignments = tableSeparatorAlignments(lines[start + 1]);
  const headerCells = splitTableRow(lines[start]);

  const rows = [];
  let index = start + 2;
  while (
    index < lines.length &&
    rows.length < TABLE_MAX_ROWS &&
    !/^\s*$/.test(lines[index]) &&
    tableRow(lines[index])
  ) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  const key = `${keyPrefix}-${start}`;
  return {
    element: (
      <div className="markdown-table-wrap" key={key}>
        <table className="markdown-table">
          <thead>
            <tr>
              {headerCells.map((cell, cellIndex) => (
                <th data-align={alignments[cellIndex] || undefined} key={`${key}-h-${cellIndex}`}>
                  {renderInline(cell, `${key}-h-${cellIndex}`, options)}
                </th>
              ))}
            </tr>
          </thead>
          {rows.length ? (
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${key}-r-${rowIndex}`}>
                  {headerCells.map((_cell, cellIndex) => {
                    const cell = row[cellIndex] || '';
                    const rowText = row.slice(0, headerCells.length).join(' ');
                    return (
                      <td
                        data-align={alignments[cellIndex] || undefined}
                        key={`${key}-r-${rowIndex}-${cellIndex}`}
                      >
                        {renderInline(cell, `${key}-r-${rowIndex}-${cellIndex}`, options)}
                        {cellIndex === headerCells.length - 1
                          ? renderClaimSources(rowText, `${key}-r-${rowIndex}`, options)
                          : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ) : null}
        </table>
      </div>
    ),
    nextIndex: index
  };
}

function parseList(lines, start, keyPrefix, options) {
  const first = listLine(lines[start]);
  const baseIndent = first.indent;
  const ordered = first.ordered;
  const items = [];
  let index = start;

  while (index < lines.length) {
    const current = listLine(lines[index]);
    if (!current || current.indent !== baseIndent || current.ordered !== ordered) break;

    const item = { text: current.text, children: [] };
    index += 1;

    while (index < lines.length) {
      const next = listLine(lines[index]);
      if (next && next.indent > baseIndent) {
        const nested = parseList(lines, index, `${keyPrefix}-${items.length}-nested`, options);
        item.children.push(nested.element);
        index = nested.nextIndex;
        continue;
      }
      if (next || /^\s*$/.test(lines[index]) || blockStart(lines[index])) break;
      if (tableStart(lines, index)) break;
      item.text += ` ${lines[index].trim()}`;
      index += 1;
    }

    items.push(item);
    if (/^\s*$/.test(lines[index] || '')) break;
  }

  const List = ordered ? 'ol' : 'ul';
  return {
    element: (
      <List className="markdown-list" key={`${keyPrefix}-${start}`}>
        {items.map((item, itemIndex) => (
          <li key={`${keyPrefix}-${start}-${itemIndex}`}>
            {renderInline(item.text, `${keyPrefix}-${start}-${itemIndex}-text`, options)}
            {renderClaimSources(item.text, `${keyPrefix}-${start}-${itemIndex}-text`, options)}
            {item.children}
          </li>
        ))}
      </List>
    ),
    nextIndex: index
  };
}

export function renderMarkdown(text, options = {}) {
  const renderOptions = {
    ...options,
    referenceAliases:
      options.referenceAliases ||
      prepareReferenceAliases(options.references, options.onOpenReference)
  };
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*$/.test(line)) {
      index += 1;
      continue;
    }

    const fence = /^ {0,3}```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^ {0,3}```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre className="markdown-code-block" key={`code-${index}`}>
          <code className={fence[1] ? `language-${fence[1]}` : undefined}>{code.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const Heading = `h${heading[1].length}`;
      blocks.push(
        <Heading className="markdown-heading" key={`heading-${index}`}>
          {renderInline(heading[2], `heading-${index}`, renderOptions)}
        </Heading>
      );
      index += 1;
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^ {0,3}>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^ {0,3}>\s?/, ''));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`}>
          {renderMarkdown(quote.join('\n'), renderOptions)}
        </blockquote>
      );
      continue;
    }

    if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }

    if (listLine(line)) {
      const list = parseList(lines, index, 'list', renderOptions);
      blocks.push(list.element);
      index = list.nextIndex;
      continue;
    }

    if (line.includes('|')) {
      const table = parseTable(lines, index, 'table', renderOptions);
      if (table) {
        blocks.push(table.element);
        index = table.nextIndex;
        continue;
      }
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && !blockStart(lines[index]) && !tableStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`}>
        {renderInline(paragraph.join(' '), `paragraph-${index}`, renderOptions)}
        {renderClaimSources(paragraph.join(' '), `paragraph-${index}`, renderOptions)}
      </p>
    );
  }

  return blocks;
}

export function MarkdownText({
  text,
  references,
  onOpenReference,
  referenceMode = 'inline',
  as: Root = 'div',
  ...props
}) {
  return (
    <Root {...props}>{renderMarkdown(text, { references, onOpenReference, referenceMode })}</Root>
  );
}
