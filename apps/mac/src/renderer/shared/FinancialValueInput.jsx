import React, { useLayoutEffect, useRef, useState } from 'react';

export function sanitizeFinancialValue(value, options = {}) {
  const allowNegative = options.allowNegative !== false;
  const source = String(value == null ? '' : value).trim();
  if (!source) return '';

  const negative =
    allowNegative &&
    (/[-\u2212\u2013\u2014]/.test(source) || (/^\(.*\)$/.test(source) && /\d/.test(source)));
  const cleaned = source.replace(/[^0-9.]/g, '');
  if (!cleaned) return negative ? '-' : '';

  const [whole = '', ...decimalParts] = cleaned.split('.');
  const hasDecimal = cleaned.includes('.');
  const decimal = decimalParts.join('').slice(0, 2);
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || (hasDecimal ? '0' : '');
  return `${negative ? '-' : ''}${normalizedWhole}${hasDecimal ? `.${decimal}` : ''}`;
}

function canonicalFinancialValue(value, options = {}) {
  const raw = sanitizeFinancialValue(value, options);
  if (!raw || raw === '-') return raw;

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = '0', decimal = ''] = unsigned.split('.');
  const significantDecimal = decimal.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole || '0'}${significantDecimal ? `.${significantDecimal}` : ''}`;
}

export function formatFinancialValue(value) {
  const raw = sanitizeFinancialValue(value);
  if (!raw || raw === '-') return raw;

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = '0', decimal = ''] = unsigned.split('.');
  const groupedWhole = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${groupedWhole}.${decimal.padEnd(2, '0').slice(0, 2)}`;
}

function selectionAnchor(value, position) {
  const safePosition = Math.max(0, Math.min(Number(position) || 0, value.length));
  const decimalIndex = value.indexOf('.');
  const prefix = value.slice(0, safePosition);
  if (decimalIndex >= 0 && safePosition > decimalIndex) {
    return {
      part: 'decimal',
      digits: (value.slice(decimalIndex + 1, safePosition).match(/\d/g) || []).length
    };
  }
  return {
    part: 'whole',
    digits: (prefix.match(/\d/g) || []).length,
    afterSign: /[-\u2212\u2013\u2014]/.test(prefix)
  };
}

function positionForAnchor(value, anchor) {
  const decimalIndex = value.indexOf('.');
  if (anchor.part === 'decimal' && decimalIndex >= 0) {
    return Math.min(decimalIndex + 1 + anchor.digits, value.length);
  }

  if (!anchor.digits) return anchor.afterSign && value.startsWith('-') ? 1 : 0;
  const wholeEnd = decimalIndex >= 0 ? decimalIndex : value.length;
  let digits = 0;
  for (let index = 0; index < wholeEnd; index += 1) {
    if (/\d/.test(value[index])) digits += 1;
    if (digits === anchor.digits) return index + 1;
  }
  return wholeEnd;
}

function inputSelection(input) {
  return {
    value: input.value,
    start: input.selectionStart ?? input.value.length,
    end: input.selectionEnd ?? input.value.length
  };
}

export function FinancialValueInput({
  allowNegative = true,
  name,
  onBeforeInput,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  onMouseUp,
  onPaste,
  onPointerDown,
  onSelect,
  value,
  ...props
}) {
  const inputRef = useRef(null);
  const pendingAnchorRef = useRef(null);
  const priorSelectionRef = useRef({ value: '', start: 0, end: 0 });
  const selectAfterPointerRef = useRef(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const rawValue = sanitizeFinancialValue(value, { allowNegative });
  const displayValue = formatFinancialValue(rawValue);

  function rememberSelection(input) {
    priorSelectionRef.current = inputSelection(input);
  }

  useLayoutEffect(() => {
    const input = inputRef.current;
    const anchor = pendingAnchorRef.current;
    if (!input || !anchor || input.ownerDocument.activeElement !== input) return;
    const position = positionForAnchor(input.value, anchor);
    input.setSelectionRange(position, position);
    rememberSelection(input);
    pendingAnchorRef.current = null;
  }, [displayValue, selectionRevision]);

  return (
    <>
      <input
        {...props}
        inputMode="decimal"
        name={name ? undefined : name}
        onBeforeInput={(event) => {
          rememberSelection(event.currentTarget);
          onBeforeInput?.(event);
        }}
        onBlur={(event) => {
          selectAfterPointerRef.current = false;
          rememberSelection(event.currentTarget);
          onBlur?.(event);
        }}
        onChange={(event) => {
          const input = event.currentTarget;
          let editedValue = input.value;
          let caret = input.selectionStart ?? editedValue.length;
          const prior = priorSelectionRef.current;
          const replacedEverything =
            prior.value && prior.start === 0 && prior.end === prior.value.length;

          // Keep the fixed decimal separator from being accidentally removed by a
          // backspace, delete, or partial replacement across the separator.
          if (
            prior.value.includes('.') &&
            editedValue &&
            !editedValue.includes('.') &&
            !replacedEverything
          ) {
            editedValue = `${editedValue.slice(0, caret)}.${editedValue.slice(caret)}`;
          }

          pendingAnchorRef.current = selectionAnchor(editedValue, caret);
          const nextValue = canonicalFinancialValue(editedValue, { allowNegative });
          input.value = nextValue;
          onChange?.(event);
          setSelectionRevision((current) => current + 1);
        }}
        onFocus={(event) => {
          onFocus?.(event);
          if (!event.defaultPrevented && event.currentTarget.value) event.currentTarget.select();
          rememberSelection(event.currentTarget);
        }}
        onKeyDown={(event) => {
          rememberSelection(event.currentTarget);
          onKeyDown?.(event);
          if (event.defaultPrevented) return;

          const input = event.currentTarget;
          const start = input.selectionStart ?? 0;
          const end = input.selectionEnd ?? start;
          if (start !== end) return;
          if (event.key === 'Backspace' && start > 0 && input.value[start - 1] === '.') {
            event.preventDefault();
            input.setSelectionRange(start - 1, start - 1);
            rememberSelection(input);
          } else if (event.key === 'Delete' && input.value[start] === '.') {
            event.preventDefault();
            input.setSelectionRange(start + 1, start + 1);
            rememberSelection(input);
          }
        }}
        onMouseUp={(event) => {
          if (selectAfterPointerRef.current && event.currentTarget.value) {
            event.preventDefault();
            event.currentTarget.select();
            selectAfterPointerRef.current = false;
            rememberSelection(event.currentTarget);
          }
          onMouseUp?.(event);
        }}
        onPaste={(event) => {
          rememberSelection(event.currentTarget);
          onPaste?.(event);
        }}
        onPointerDown={(event) => {
          selectAfterPointerRef.current =
            event.currentTarget.ownerDocument.activeElement !== event.currentTarget;
          onPointerDown?.(event);
        }}
        onSelect={(event) => {
          rememberSelection(event.currentTarget);
          onSelect?.(event);
        }}
        ref={inputRef}
        type="text"
        value={displayValue}
      />
      {name ? <input name={name} type="hidden" value={rawValue} /> : null}
    </>
  );
}
