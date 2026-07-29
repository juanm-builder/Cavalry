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

function normalizedCategoryType(value) {
  const type = asString(value).toLowerCase();
  return ['income', 'savings', 'debt'].includes(type) ? type : 'expense';
}

function categoryTypeLabel(value) {
  const type = normalizedCategoryType(value);
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

function normalizedCategoryTypes(values, fallback) {
  const types = [
    ...new Set((Array.isArray(values) ? values : []).map(normalizedCategoryType).filter(Boolean))
  ];
  return types.length ? types : [normalizedCategoryType(fallback)];
}

function createdCategoryFromResult(result, payload) {
  if (!(result && result.ok)) return null;
  const categoryId =
    asString(result.category?.id || result.createdCategory?.id) ||
    asString(
      (Array.isArray(result.events) ? result.events : []).find(
        (event) => event?.type === 'category.created'
      )?.categoryId
    );
  if (!categoryId) return null;
  const category =
    result.createdCategory ||
    result.category ||
    (Array.isArray(result.workbook?.categories)
      ? result.workbook.categories.find((item) => asString(item?.id) === categoryId)
      : null) ||
    {};
  return {
    ...category,
    id: categoryId,
    value: categoryId,
    name: asString(category.name || payload.name),
    label: asString(category.name || payload.name),
    type: normalizedCategoryType(category.type || payload.type)
  };
}

function InlineCategoryCreateDialog({
  categoryType,
  categoryTypes,
  createLabel,
  onCancel,
  onCreate,
  parentLabel
}) {
  const inputId = useId();
  const typeInputId = `${inputId}-type`;
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const allowedTypes = normalizedCategoryTypes(categoryTypes, categoryType);
  const [type, setType] = useState(() =>
    allowedTypes.includes(normalizedCategoryType(categoryType))
      ? normalizedCategoryType(categoryType)
      : allowedTypes[0]
  );

  useEffect(() => {
    const closeBeforeParent = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', closeBeforeParent, true);
    return () => document.removeEventListener('keydown', closeBeforeParent, true);
  }, [onCancel]);

  return createPortal(
    <div
      className="categorized-select-create-backdrop"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
      role="presentation"
    >
      <section
        aria-label={createLabel}
        aria-modal="true"
        className="categorized-select-create-dialog"
        role="dialog"
      >
        <header>
          <span aria-hidden="true" className="material-symbols-rounded">
            new_label
          </span>
          <div>
            <h2>{createLabel}</h2>
            <p>
              Add a {categoryTypeLabel(type).toLowerCase()} category without leaving{' '}
              {parentLabel.toLowerCase()}.
            </p>
          </div>
        </header>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const trimmedName = name.trim();
            if (!trimmedName || submitting) return;
            setSubmitting(true);
            setError('');
            try {
              const result = await onCreate({
                name: trimmedName,
                postingAccountName: trimmedName,
                type
              });
              if (!(result && result.ok)) {
                setError(
                  result?.errors?.[0]?.message || 'The category could not be created. Try again.'
                );
              }
            } catch (createError) {
              setError(createError?.message || 'The category could not be created. Try again.');
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <label htmlFor={inputId}>Category name</label>
          <input
            autoFocus
            disabled={submitting}
            id={inputId}
            maxLength="30"
            onChange={(event) => setName(event.target.value)}
            placeholder={type === 'income' ? 'e.g. Freelance income' : 'e.g. Trip fund'}
            required
            value={name}
          />
          {allowedTypes.length > 1 ? (
            <>
              <label htmlFor={typeInputId}>Category type</label>
              <select
                disabled={submitting}
                id={typeInputId}
                onChange={(event) => setType(normalizedCategoryType(event.target.value))}
                value={type}
              >
                {allowedTypes.map((option) => (
                  <option key={option} value={option}>
                    {categoryTypeLabel(option)}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <small>
            This will be available in every category dropdown. You can add rules and customize it
            later in Categories.
          </small>
          {error ? (
            <div className="categorized-select-create-error" role="alert">
              {error}
            </div>
          ) : null}
          <footer>
            <button disabled={submitting} onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!name.trim() || submitting} type="submit">
              {submitting ? 'Creating…' : 'Create & select'}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  );
}

export function CategorizedSelect({
  'aria-label': ariaLabel = 'Category',
  clearLabel = '',
  createCategoryType = 'expense',
  createCategoryTypes,
  createLabel = 'Create new category',
  disabled = false,
  id,
  name,
  onChange,
  onCreateCategory,
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
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const [creating, setCreating] = useState(false);
  const [createdOptions, setCreatedOptions] = useState([]);
  const allowedCreateTypes = useMemo(
    () => normalizedCategoryTypes(createCategoryTypes, createCategoryType),
    [createCategoryType, createCategoryTypes]
  );
  const normalized = useMemo(() => {
    const provided = normalizeOptions(options);
    const providedIds = new Set(provided.map((option) => option.value));
    const matchingCreated = createdOptions.filter(
      (option) =>
        allowedCreateTypes.includes(normalizedCategoryType(option.type)) &&
        !providedIds.has(asString(option.value || option.id))
    );
    return [...provided, ...normalizeOptions(matchingCreated)];
  }, [allowedCreateTypes, createdOptions, options]);
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

  const closeCreator = () => {
    setCreating(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const createCategory = async (payload) => {
    const result = await onCreateCategory?.(payload);
    const category = createdCategoryFromResult(result, payload);
    if (!category) return result;
    setCreatedOptions((current) => [
      ...current.filter((option) => asString(option.value || option.id) !== category.value),
      category
    ]);
    closeCreator();
    selectValue(category.value);
    return result;
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
          {typeof onCreateCategory === 'function' ? (
            <button
              aria-selected="false"
              className="categorized-select-create-option"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
              role="option"
              type="button"
            >
              <span aria-hidden="true" className="material-symbols-rounded">
                add_circle
              </span>
              <span>{createLabel}</span>
              <span aria-hidden="true" className="material-symbols-rounded">
                arrow_forward
              </span>
            </button>
          ) : null}
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
        ref={triggerRef}
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
      {creating ? (
        <InlineCategoryCreateDialog
          categoryType={createCategoryType}
          categoryTypes={allowedCreateTypes}
          createLabel={createLabel}
          onCancel={closeCreator}
          onCreate={createCategory}
          parentLabel={ariaLabel}
        />
      ) : null}
    </div>
  );
}
