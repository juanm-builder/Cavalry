import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const GROUP_ORDER = [
  'Payments & Debt',
  'Everyday Expenses',
  'Lifestyle',
  'Savings & Goals',
  'Income',
  'Other'
];

function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function getCategoryPresentation(option = {}) {
  const label = asString(option.label || option.name) || 'Category';
  const type = asString(option.type).toLowerCase();
  const name = label.toLowerCase();
  if (type === 'income') return { group: 'Income', icon: 'payments' };
  if (type === 'savings') return { group: 'Savings & Goals', icon: 'savings' };
  if (
    type === 'debt' ||
    /(credit|card payment|debt|loan|tax|withholding|mortgage payment)/.test(name)
  ) {
    return {
      group: 'Payments & Debt',
      icon: /tax|withholding/.test(name) ? 'receipt' : 'credit_card'
    };
  }
  if (/(food|grocery|dining|meal)/.test(name)) {
    return { group: 'Everyday Expenses', icon: 'restaurant' };
  }
  if (/(transport|commute|fuel|parking|ride|bus|train)/.test(name)) {
    return { group: 'Everyday Expenses', icon: 'directions_car' };
  }
  if (/(subscription|utility|electric|water|internet|phone|rent|housing)/.test(name)) {
    return { group: 'Everyday Expenses', icon: 'receipt_long' };
  }
  if (
    /(leisure|lifestyle|personal care|shopping|electronic|entertainment|travel|random|other)/.test(
      name
    )
  ) {
    return { group: 'Lifestyle', icon: /personal care/.test(name) ? 'favorite' : 'shopping_bag' };
  }
  if (type === 'expense' || !type) return { group: 'Everyday Expenses', icon: 'category' };
  return { group: 'Other', icon: 'category' };
}

function normalizeOptions(options) {
  return (Array.isArray(options) ? options : [])
    .map((option) => {
      const value = asString(option && (option.value ?? option.id));
      const label = asString(option && (option.label ?? option.name));
      if (!value || !label) return null;
      const presentation = getCategoryPresentation(option);
      return {
        ...option,
        value,
        label,
        ...presentation,
        icon: asString(option.icon) || presentation.icon
      };
    })
    .filter(Boolean);
}

export function CategorizedSelect({
  'aria-label': ariaLabel = 'Category',
  clearLabel = '',
  disabled = false,
  id,
  name,
  onChange,
  onValueChange,
  options = [],
  placeholder = 'Select category',
  value = ''
}) {
  const generatedId = useId();
  const controlId = id || `category-select-${generatedId.replace(/:/g, '')}`;
  const listboxId = `${controlId}-listbox`;
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const normalized = useMemo(() => normalizeOptions(options), [options]);
  const selected = normalized.find((option) => option.value === asString(value)) || null;
  const selectedIndex = Math.max(
    0,
    normalized.findIndex((option) => option.value === selected?.value)
  );
  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        options: normalized.filter((option) => option.group === group)
      })).filter((entry) => entry.options.length),
    [normalized]
  );

  const positionMenu = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 12;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openAbove = availableBelow < 260 && availableAbove > availableBelow;
    const maxHeight = Math.max(
      180,
      Math.min(420, openAbove ? availableAbove - 8 : availableBelow - 8)
    );
    setMenuStyle({
      left: `${Math.max(viewportPadding, rect.left)}px`,
      top: openAbove ? 'auto' : `${rect.bottom + 7}px`,
      bottom: openAbove ? `${window.innerHeight - rect.top + 7}px` : 'auto',
      width: `${Math.min(rect.width, window.innerWidth - viewportPadding * 2)}px`,
      maxHeight: `${maxHeight}px`
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    positionMenu();
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const reposition = () => positionMenu();
    document.addEventListener('mousedown', closeOutside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  const selectValue = (nextValue) => {
    onValueChange?.(nextValue);
    onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue } });
    setOpen(false);
  };

  const moveSelection = (offset) => {
    if (!normalized.length) return;
    const nextIndex = (selectedIndex + offset + normalized.length) % normalized.length;
    selectValue(normalized[nextIndex].value);
  };

  const menu = open
    ? createPortal(
        <div
          aria-label={`${ariaLabel} options`}
          className="categorized-select-menu"
          id={listboxId}
          ref={menuRef}
          role="listbox"
          style={menuStyle}
        >
          {clearLabel ? (
            <button
              aria-selected={!asString(value)}
              className={`categorized-select-clear${!asString(value) ? ' selected' : ''}`}
              onClick={() => selectValue('')}
              role="option"
              type="button"
            >
              <span aria-hidden="true" className="material-symbols-rounded">
                select_all
              </span>
              <span>{clearLabel}</span>
              {!asString(value) ? (
                <span
                  aria-hidden="true"
                  className="material-symbols-rounded categorized-select-check"
                >
                  check
                </span>
              ) : null}
            </button>
          ) : null}
          {grouped.map((entry) => (
            <section
              aria-label={entry.group}
              className="categorized-select-group"
              key={entry.group}
              role="group"
            >
              <div className="categorized-select-group-label">{entry.group}</div>
              {entry.options.map((option) => (
                <button
                  aria-selected={option.value === asString(value)}
                  className={option.value === asString(value) ? 'selected' : ''}
                  key={option.value}
                  onClick={() => selectValue(option.value)}
                  role="option"
                  type="button"
                >
                  <span aria-hidden="true" className="material-symbols-rounded">
                    {option.icon}
                  </span>
                  <span>{option.label}</span>
                  {option.value === asString(value) ? (
                    <span
                      aria-hidden="true"
                      className="material-symbols-rounded categorized-select-check"
                    >
                      check
                    </span>
                  ) : null}
                </button>
              ))}
            </section>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <div className="categorized-select" ref={rootRef}>
      <button
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="categorized-select-trigger"
        disabled={disabled}
        id={controlId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            open ? moveSelection(1) : setOpen(true);
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            open ? moveSelection(-1) : setOpen(true);
          }
        }}
        role="combobox"
        type="button"
      >
        <span aria-hidden="true" className="material-symbols-rounded categorized-select-leading">
          {selected?.icon || 'category'}
        </span>
        <span className={selected ? '' : 'placeholder'}>{selected?.label || placeholder}</span>
        <span aria-hidden="true" className="material-symbols-rounded categorized-select-chevron">
          expand_more
        </span>
      </button>
      {name ? <input name={name} type="hidden" value={asString(value)} /> : null}
      {menu}
    </div>
  );
}
