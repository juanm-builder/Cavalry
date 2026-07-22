function asString(value) {
  return String(value == null ? '' : value).trim();
}

function isBlankRow(cells) {
  return cells.every((cell) => asString(cell) === '');
}

function makeIssue(severity, code, message, detail = {}) {
  return Object.assign({ severity, code, message }, detail);
}

export function normalizeCsvHeader(value) {
  return asString(value)
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseCsvNumber(value) {
  const raw = asString(value);
  if (!raw) {
    return NaN;
  }
  const isParentheticalNegative = /^\(.*\)$/.test(raw);
  const cleaned = raw
    .replace(/^\((.*)\)$/, '$1')
    .replace(/,/g, '')
    .replace(/[^0-9.+-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '+' || cleaned === '.') {
    return NaN;
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  return isParentheticalNegative ? -Math.abs(numeric) : numeric;
}

export function parseCsv(text, options = {}) {
  const source = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  const parsedRows = [];
  const errors = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldStartedWithQuote = false;
  let rowStartLine = 1;
  let fieldStartLine = 1;
  let lineNumber = 1;

  function pushField() {
    row.push(field);
    field = '';
    fieldStartedWithQuote = false;
    fieldStartLine = lineNumber;
  }

  function pushRow() {
    pushField();
    parsedRows.push({
      lineNumber: rowStartLine,
      cells: row
    });
    row = [];
    rowStartLine = lineNumber + 1;
    fieldStartLine = rowStartLine;
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\r') {
          if (next === '\n') {
            index += 1;
          }
          field += '\n';
          lineNumber += 1;
        } else {
          field += char;
          if (char === '\n') {
            lineNumber += 1;
          }
        }
      }
      continue;
    }

    if (char === '"') {
      if (field === '') {
        inQuotes = true;
        fieldStartedWithQuote = true;
        fieldStartLine = lineNumber;
      } else {
        field += char;
        if (fieldStartedWithQuote) {
          errors.push(
            makeIssue('warning', 'stray_quote', 'Unexpected quote after a quoted CSV field.', {
              lineNumber
            })
          );
        }
      }
    } else if (char === ',') {
      pushField();
    } else if (char === '\r' || char === '\n') {
      pushRow();
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      lineNumber += 1;
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    errors.push(
      makeIssue('error', 'unclosed_quote', 'A quoted CSV field was not closed.', {
        lineNumber: fieldStartLine
      })
    );
  }
  if (source.length > 0 || field || row.length) {
    pushRow();
  }

  const meaningfulRows =
    options.keepBlankRows === true
      ? parsedRows
      : parsedRows.filter((item) => !isBlankRow(item.cells));
  if (!meaningfulRows.length) {
    return {
      ok: false,
      headers: [],
      normalizedHeaders: [],
      rows: [],
      errors: errors.concat(makeIssue('error', 'empty_csv', 'CSV input is empty.'))
    };
  }

  const headerRow = meaningfulRows[0];
  const headers = headerRow.cells.map((cell) => asString(cell));
  const normalizedHeaders = headers.map(normalizeCsvHeader);
  const seenHeaders = new Set();
  normalizedHeaders.forEach((header, index) => {
    if (!header) {
      errors.push(
        makeIssue('error', 'blank_header', 'CSV headers must not be blank.', {
          columnIndex: index
        })
      );
      return;
    }
    if (seenHeaders.has(header)) {
      errors.push(
        makeIssue('error', 'duplicate_header', 'CSV headers must be unique after normalization.', {
          header,
          columnIndex: index
        })
      );
    }
    seenHeaders.add(header);
  });

  const rows = meaningfulRows.slice(1).map((item) => {
    const values = {};
    const issues = [];
    normalizedHeaders.forEach((header, index) => {
      values[header] = item.cells[index] == null ? '' : item.cells[index];
    });
    if (item.cells.length > normalizedHeaders.length) {
      issues.push(
        makeIssue('warning', 'extra_columns', 'CSV row has more cells than the header row.', {
          lineNumber: item.lineNumber
        })
      );
    }
    if (item.cells.length < normalizedHeaders.length) {
      issues.push(
        makeIssue('warning', 'missing_columns', 'CSV row has fewer cells than the header row.', {
          lineNumber: item.lineNumber
        })
      );
    }
    return {
      lineNumber: item.lineNumber,
      cells: item.cells,
      values,
      issues
    };
  });

  return {
    ok: !errors.some((issue) => issue.severity === 'error'),
    headers,
    normalizedHeaders,
    rows,
    errors
  };
}

export function getCsvValue(row, columnName) {
  if (!(row && row.values)) {
    return '';
  }
  const key = normalizeCsvHeader(columnName);
  return row.values[key] == null ? '' : row.values[key];
}
