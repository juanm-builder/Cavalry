import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { CavalryIcon } from './CavalryIcon.jsx';

/*
 * Cavalry's dropdown.
 *
 * Native <select> menus are drawn by the OS: they ignore the skin, and in
 * WKWebView they also ignore padding on the closed control, which slid field
 * text underneath any leading icon. This renders the trigger and the menu
 * ourselves so every dropdown reads like the category picker — leading icon,
 * optional group headings, a right-aligned detail column, and a check on the
 * current choice.
 *
 * It reuses the `categorized-select-*` class names on purpose: those rules are
 * already the app's dropdown design, so sharing them keeps one visual source
 * of truth. `cavalry-select` marks the generic variant for the few additions
 * it needs.
 */

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeOptions(options) {
  return (Array.isArray(options) ? options : [])
    .map((option) => {
      if (option == null) return null;
      const value = asString(option.value ?? option.id);
      const label = asString(option.label ?? option.name) || value;
      if (!label) return null;
      return {
        ...option,
        value,
        label,
        icon: asString(option.icon),
        meta: asString(option.meta),
        group: asString(option.group),
        disabled: option.disabled === true
      };
    })
    .filter(Boolean);
}

function groupOptions(options) {
  // Groups keep the order they first appear in, so callers control sequencing
  // by ordering their options rather than matching a fixed taxonomy.
  const order = [];
  const byGroup = new Map();
  for (const option of options) {
    if (!byGroup.has(option.group)) {
      byGroup.set(option.group, []);
      order.push(option.group);
    }
    byGroup.get(option.group).push(option);
  }
  return order.map((group) => ({ group, options: byGroup.get(group) }));
}

export function CavalrySelect({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className = '',
  disabled = false,
  id,
  leadingIcon = '',
  name,
  onChange,
  options = [],
  placeholder = 'Choose an option',
  showLeadingIcon = true,
  value = '',
  ...rest
}) {
  const generatedId = useId();
  const controlId = id || `cavalry-select-${generatedId.replace(/:/g, '')}`;
  const listboxId = `${controlId}-listbox`;
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const typeaheadRef = useRef({ query: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const [activeIndex, setActiveIndex] = useState(-1);

  const normalized = useMemo(() => normalizeOptions(options), [options]);
  const grouped = useMemo(() => groupOptions(normalized), [normalized]);
  const selectedValue = asString(value);
  const selected = normalized.find((option) => option.value === selectedValue) || null;
  const selectableIndexes = normalized
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((index) => index >= 0);
  const hasIcons = showLeadingIcon && (leadingIcon || normalized.some((option) => option.icon));

  const positionMenu = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 12;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openAbove = availableBelow < 240 && availableAbove > availableBelow;
    const maxHeight = Math.max(
      180,
      Math.min(420, openAbove ? availableAbove - 8 : availableBelow - 8)
    );
    setMenuStyle({
      left: `${Math.max(viewportPadding, rect.left)}px`,
      top: openAbove ? 'auto' : `${rect.bottom + 7}px`,
      bottom: openAbove ? `${window.innerHeight - rect.top + 7}px` : 'auto',
      width: `${Math.min(Math.max(rect.width, 240), window.innerWidth - viewportPadding * 2)}px`,
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

  // Opening highlights the current choice so arrow keys continue from there.
  function openMenu() {
    const current = normalized.findIndex((option) => option.value === selectedValue);
    setActiveIndex(current >= 0 ? current : (selectableIndexes[0] ?? -1));
    setOpen(true);
  }

  function commit(nextValue) {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
    if (nextValue === selectedValue) return;
    // Shaped like a change event so existing `actions.change(...)` bindings,
    // which read currentTarget.value, keep working unchanged.
    onChange?.({
      target: { value: nextValue, name: name || '' },
      currentTarget: { value: nextValue, name: name || '' }
    });
  }

  function moveActive(offset) {
    if (!selectableIndexes.length) return;
    const position = selectableIndexes.indexOf(activeIndex);
    const nextPosition =
      position < 0
        ? offset > 0
          ? 0
          : selectableIndexes.length - 1
        : (position + offset + selectableIndexes.length) % selectableIndexes.length;
    setActiveIndex(selectableIndexes[nextPosition]);
  }

  // `timeStamp` comes off the keyboard event so the component stays pure.
  function typeahead(character, timeStamp) {
    const state = typeaheadRef.current;
    state.query = timeStamp - state.at > 800 ? character : state.query + character;
    state.at = timeStamp;
    const query = state.query.toLowerCase();
    const match = normalized.findIndex(
      (option) => !option.disabled && option.label.toLowerCase().startsWith(query)
    );
    if (match >= 0) setActiveIndex(match);
  }

  function onTriggerKeyDown(event) {
    if (event.key === 'Escape') {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      setActiveIndex(
        event.key === 'Home'
          ? selectableIndexes[0]
          : selectableIndexes[selectableIndexes.length - 1]
      );
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const option = normalized[activeIndex];
      if (option && !option.disabled) commit(option.value);
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (!open) openMenu();
      typeahead(event.key, event.timeStamp);
    }
  }

  const menu = open
    ? createPortal(
        <div
          aria-label={ariaLabel ? `${ariaLabel} options` : undefined}
          className={`categorized-select-menu cavalry-select-menu${hasIcons ? '' : ' is-plain'}`}
          id={listboxId}
          ref={menuRef}
          role="listbox"
          style={menuStyle}
        >
          {normalized.length ? (
            grouped.map((entry) => (
              <section
                aria-label={entry.group || undefined}
                className="categorized-select-group"
                key={entry.group || '__ungrouped'}
                role="group"
              >
                {entry.group ? (
                  <div className="categorized-select-group-label">{entry.group}</div>
                ) : null}
                {entry.options.map((option) => {
                  const index = normalized.indexOf(option);
                  const isSelected = option.value === selectedValue;
                  return (
                    <button
                      aria-label={option.meta ? `${option.label} — ${option.meta}` : option.label}
                      aria-selected={isSelected}
                      className={`${isSelected ? 'selected' : ''}${
                        index === activeIndex ? ' is-active' : ''
                      }`}
                      disabled={option.disabled}
                      key={option.value || option.label}
                      onClick={() => commit(option.value)}
                      onMouseEnter={() => setActiveIndex(index)}
                      role="option"
                      type="button"
                    >
                      {hasIcons ? (
                        <CavalryIcon name={option.icon || leadingIcon || 'circle'} />
                      ) : null}
                      <span className="cavalry-select-option-label">{option.label}</span>
                      <small className="cavalry-select-option-meta">{option.meta}</small>
                      {isSelected ? (
                        <CavalryIcon className="categorized-select-check" name="check" />
                      ) : (
                        <span aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </section>
            ))
          ) : (
            <p className="cavalry-select-empty">Nothing to choose from yet.</p>
          )}
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`categorized-select cavalry-select ${className}`.trim()} ref={rootRef}>
      <button
        {...rest}
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={`categorized-select-trigger cavalry-select-trigger${
          hasIcons ? '' : ' is-plain'
        }`}
        disabled={disabled}
        id={controlId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        {hasIcons ? (
          <CavalryIcon
            className="categorized-select-leading"
            name={selected?.icon || leadingIcon || 'circle'}
          />
        ) : null}
        <span className={selected ? '' : 'placeholder'}>{selected?.label || placeholder}</span>
        <small className="cavalry-select-trigger-meta">{selected?.meta || ''}</small>
        <CavalryIcon className="categorized-select-chevron" name="expand_more" />
      </button>
      {name ? <input name={name} type="hidden" value={selectedValue} /> : null}
      {menu}
    </div>
  );
}

/*
 * Form-driven variant.
 *
 * A few settings forms read their values back through FormData rather than
 * React state, the way an uncontrolled <select> works. This keeps the value
 * locally and publishes it through the hidden input the base component
 * already renders.
 */
export function UncontrolledCavalrySelect({ defaultValue = '', name, onChange, ...props }) {
  const [value, setValue] = useState(String(defaultValue ?? ''));
  return (
    <CavalrySelect
      {...props}
      name={name}
      onChange={(event) => {
        setValue(event.currentTarget.value);
        onChange?.(event);
      }}
      value={value}
    />
  );
}

export default CavalrySelect;
