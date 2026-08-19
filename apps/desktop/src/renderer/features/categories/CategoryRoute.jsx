import React, { useEffect, useMemo, useRef, useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import {
  buildCategoriesFeatureModel,
  CATEGORY_ACTIONS,
  executeCategoryCommand
} from './category-controller.js';
import { CATEGORY_COLORS, CATEGORY_ICONS } from './category-options.js';
import { asArray, normalizeCurrency } from './category-route-utils.js';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';
import { useCollectionViewPreference } from '../../shared/use-collection-view-preference.js';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function withClick(binding, callback) {
  const boundClick = binding?.onClick;
  return {
    ...(binding || {}),
    onClick(event) {
      boundClick?.(event);
      callback?.(event);
    }
  };
}

function formatMoney(value, currency = 'PHP') {
  try {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: normalizeCurrency(currency),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  } catch (_error) {
    return `${(Number(value) || 0).toFixed(2)} ${normalizeCurrency(currency)}`;
  }
}

function formatPercent(value) {
  const number = Number(value) || 0;
  return `${Number.isInteger(number) ? number : number.toFixed(1)}%`;
}

function ActionMenu({ children }) {
  return (
    <details className="category-action-menu">
      <summary aria-label="Category actions" title="Category actions">
        <Icon name="more_vert" />
      </summary>
      <div className="category-action-popover">{children}</div>
    </details>
  );
}

function MenuButton({ icon, title, binding, onClick, danger = false }) {
  return (
    <button
      aria-label={title}
      className={danger ? 'danger' : ''}
      title={title}
      type="button"
      {...withClick(binding, onClick)}
    >
      <Icon name={icon} />
      <span>{title}</span>
    </button>
  );
}

function CategoryCard({ row, currency, actions, onOpenModal, isTarget = false, targetRef }) {
  const payload = { categoryId: row.id };
  const canRename = !row.isSystem && row.canRename !== false;
  const canToggle = !row.isSystem && row.canToggleActive !== false;
  const canDelete = !row.isSystem && row.canDelete !== false;
  const canLink = !row.isSystem && row.canLink !== false;
  const style = {
    '--category-color': row.color || '#499eee',
    '--category-progress': `${row.percent}%`
  };
  const activitySign = row.amountTone === 'good' ? '+' : row.amountTone === 'bad' ? '−' : '';

  return (
    <article
      aria-label={`${row.name} category`}
      className={`category-card${row.isArchived ? ' is-archived' : ''}${isTarget ? ' is-reference-target' : ''}`}
      data-category-id={row.id}
      data-category-row={row.name}
      ref={isTarget ? targetRef : undefined}
      style={style}
      tabIndex={isTarget ? -1 : undefined}
    >
      <div className="category-card-visual">
        <span className="category-card-icon">
          <Icon name={row.icon || 'category'} />
        </span>
      </div>
      <div className="category-card-body">
        <div className="category-card-title-row">
          <div>
            <strong>{row.name}</strong>
            {row.isArchived ? <span className="category-archived-badge">Hidden</span> : null}
          </div>
          {canRename || canToggle || canDelete || canLink ? (
            <ActionMenu>
              {canRename ? (
                <MenuButton
                  binding={actions.action('open-category-editor', payload)}
                  icon="edit"
                  onClick={() => onOpenModal('edit', row)}
                  title="Edit category"
                />
              ) : null}
              {canLink ? (
                <MenuButton
                  binding={actions.action('open-category-link', payload)}
                  icon="link"
                  onClick={() => onOpenModal('link', row)}
                  title="Edit linked account"
                />
              ) : null}
              {canToggle ? (
                <MenuButton
                  binding={actions.action('toggle-category-active', {
                    ...payload,
                    nextActive: row.isArchived
                  })}
                  icon={row.isArchived ? 'visibility' : 'visibility_off'}
                  onClick={() => onOpenModal(row.isArchived ? 'restore' : 'hide', row)}
                  title={row.isArchived ? 'Restore category' : 'Hide category'}
                />
              ) : null}
              {canDelete ? (
                <MenuButton
                  danger
                  binding={actions.action('open-category-delete', payload)}
                  icon="delete"
                  onClick={() => onOpenModal('delete', row)}
                  title="Delete category"
                />
              ) : null}
            </ActionMenu>
          ) : (
            <span className="category-system-badge">System</span>
          )}
        </div>
        <b className={`category-card-amount ${row.amountTone || 'neutral'}`}>
          {activitySign}
          {formatMoney(Math.abs(Number(row.spent) || 0), currency)}
        </b>
        <div className="category-progress" aria-label={`${formatPercent(row.percent)} of activity`}>
          <span />
        </div>
        <span className="category-card-share">
          {row.activityLabel || 'Activity'} · {formatPercent(row.percent)} of activity
        </span>
        <div className="category-card-foot">
          <span>
            {row.transactionCount || 0} transaction{row.transactionCount === 1 ? '' : 's'}
          </span>
          <span>{row.typeLabel}</span>
        </div>
      </div>
    </article>
  );
}

function MoreCategoriesCard({ rows, expanded, onToggle }) {
  const preview = rows.slice(0, 4);
  return (
    <button
      aria-expanded={expanded}
      className="category-card category-more-card"
      onClick={onToggle}
      type="button"
    >
      <div className="category-card-visual">
        <span className="category-card-icon">
          <Icon name="more_horiz" />
        </span>
      </div>
      <div className="category-more-copy">
        <strong>{expanded ? 'Show fewer' : `+ ${rows.length} more`}</strong>
        <span>{expanded ? 'Collapse categories' : 'View all categories'}</span>
      </div>
      {!expanded ? (
        <div className="category-more-preview" aria-hidden="true">
          {preview.map((row) => (
            <span key={row.id} style={{ '--preview-color': row.color }}>
              <Icon name={row.icon || 'category'} />
            </span>
          ))}
          {rows.length > 4 ? <small>+{rows.length - 4}</small> : null}
        </div>
      ) : null}
    </button>
  );
}

function CreateCategoryCard({ actions, onOpenModal }) {
  return (
    <button
      aria-label="Create category"
      className="category-card category-create-card"
      type="button"
      {...withClick(actions.action('open-category-creator'), () => onOpenModal('create'))}
    >
      <div className="category-create-card-visual">
        <span className="category-create-card-icon">
          <Icon name="add" />
        </span>
      </div>
      <div className="category-create-card-copy">
        <strong>Create category</strong>
        <small>Add a new way to organize transactions</small>
      </div>
    </button>
  );
}

function CategoryGallery({
  rows,
  currency,
  actions,
  onOpenModal,
  expanded,
  onToggleExpanded,
  targetCategoryId = '',
  targetRef
}) {
  if (!rows.length) {
    return (
      <div className="category-empty-state">
        <span>
          <Icon name="category" />
        </span>
        <strong>No visible categories</strong>
        <p>Create a category or adjust your filters to see it here.</p>
        <CreateCategoryCard actions={actions} onOpenModal={onOpenModal} />
      </div>
    );
  }
  const shouldDisplaceFirst = !expanded && rows.length > 7;
  const visibleRows = expanded ? rows : shouldDisplaceFirst ? rows.slice(1, 7) : rows.slice(0, 7);
  const overflowRows =
    rows.length > 7 ? (shouldDisplaceFirst ? [rows[0], ...rows.slice(7)] : rows.slice(7)) : [];
  return (
    <div className="category-gallery">
      <CreateCategoryCard actions={actions} onOpenModal={onOpenModal} />
      {visibleRows.map((row) => (
        <CategoryCard
          key={row.id}
          actions={actions}
          currency={currency}
          isTarget={row.id === targetCategoryId}
          onOpenModal={onOpenModal}
          row={row}
          targetRef={targetRef}
        />
      ))}
      {overflowRows.length ? (
        <MoreCategoriesCard expanded={expanded} onToggle={onToggleExpanded} rows={overflowRows} />
      ) : null}
    </div>
  );
}

function ModalFrame({ title, eyebrow = '', error, children, onCancel, className = '' }) {
  const dismiss = useModalDismiss(onCancel);
  return (
    <div className="modal-backdrop" onMouseDown={dismiss}>
      <section
        aria-labelledby="category-modal-title"
        aria-modal="true"
        className={`modal-card category-modal ${className}`}
        role="dialog"
      >
        <header className="category-modal-header">
          {className.includes('category-create-details') ? (
            <Icon className="category-modal-back-mark" name="arrow_back" />
          ) : null}
          <div>
            {eyebrow ? <span>{eyebrow}</span> : null}
            <h2 id="category-modal-title">{title}</h2>
          </div>
          <button
            aria-label="Close"
            className="category-modal-close"
            onClick={onCancel}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>
        {error ? (
          <div className="category-modal-error" role="alert">
            {error}
          </div>
        ) : null}
        {children}
      </section>
    </div>
  );
}

function CategoryPreview({ name, icon, color, onChange }) {
  return (
    <div className="category-create-preview" style={{ '--category-color': color }}>
      <span className="category-preview-icon">
        <Icon name={icon} />
      </span>
      <strong>{name || 'New Category'}</strong>
      {onChange ? (
        <button onClick={onChange} type="button">
          Change
        </button>
      ) : null}
    </div>
  );
}

function CategoryCreationPreview({ name, icon, color, currency, type }) {
  return (
    <section className="category-live-preview" style={{ '--category-color': color }}>
      <div className="category-live-preview-heading">
        <span>Preview</span>
        <small>Updates as you customize</small>
      </div>
      <div className="category-live-preview-card">
        <span className="category-live-preview-icon">
          <Icon name={icon} />
        </span>
        <div>
          <strong>{name.trim() || 'Your category'}</strong>
          <b>{formatMoney(0, currency)}</b>
        </div>
        <span className="category-live-preview-type">
          {type.charAt(0).toUpperCase() + type.slice(1)}
        </span>
        <div className="category-live-preview-progress">
          <span />
        </div>
        <small>0 transactions</small>
      </div>
    </section>
  );
}

function CategoryFormModal({
  category = null,
  currency,
  plannerBuckets,
  error,
  onCancel,
  onSubmit
}) {
  const isEdit = Boolean(category?.id);
  const [step, setStep] = useState(1);
  const [name, setName] = useState(category?.name || '');
  const [icon, setIcon] = useState(category?.icon || CATEGORY_ICONS[0]);
  const [color, setColor] = useState(category?.color || CATEGORY_COLORS[1]);
  const [description, setDescription] = useState(category?.description || '');
  const [type, setType] = useState(category?.type || 'expense');
  const [plannerBucketId, setPlannerBucketId] = useState(
    category?.plannerBucketId || plannerBuckets[0]?.id || ''
  );
  const [postingAccountName, setPostingAccountName] = useState(category?.linkedAccountName || '');
  const [rules, setRules] = useState([
    ...(asArray(category?.autoCategorizeRules).length
      ? asArray(category.autoCategorizeRules).map((rule, index) => ({
          id: index + 1,
          field: rule.field || 'description',
          operator: rule.operator || 'contains',
          value: rule.value || ''
        }))
      : [{ id: 1, field: 'description', operator: 'contains', value: '' }])
  ]);

  function continueToDetails(event) {
    event.preventDefault();
    if (!name.trim()) return;
    if (!postingAccountName) setPostingAccountName(name.trim());
    setStep(2);
  }

  function submit(event) {
    event.preventDefault();
    onSubmit({
      ...(isEdit ? { categoryId: category.id } : {}),
      name: name.trim(),
      icon,
      color,
      description: description.trim(),
      type,
      currency,
      plannerBucketId,
      postingAccountName: postingAccountName.trim() || name.trim(),
      autoCategorizeRules: rules
    });
  }

  function updateRule(id, patch) {
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }

  if (step === 1) {
    return (
      <ModalFrame
        className="category-create-modal category-create-start"
        error={error}
        eyebrow={isEdit ? 'Update the details any time.' : 'Let’s make it yours.'}
        onCancel={onCancel}
        title={isEdit ? 'Edit category' : 'Create a new category'}
      >
        <form onSubmit={continueToDetails}>
          <label className="category-field-label" htmlFor="category-name">
            Category name
          </label>
          <div className="category-name-input">
            <input
              autoFocus
              id="category-name"
              maxLength={30}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g., Coffee"
              required
              value={name}
            />
            <small>{name.length}/30</small>
          </div>

          <CategoryCreationPreview
            color={color}
            currency={currency}
            icon={icon}
            name={name}
            type={type}
          />

          <fieldset className="category-choice-fieldset">
            <legend>Choose an icon</legend>
            <div className="category-icon-picker">
              {CATEGORY_ICONS.map((option) => (
                <label key={option} className={icon === option ? 'selected' : ''}>
                  <input
                    aria-label={option.replaceAll('_', ' ')}
                    checked={icon === option}
                    name="category-icon"
                    onChange={() => setIcon(option)}
                    type="radio"
                    value={option}
                  />
                  <Icon name={option} />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="category-choice-fieldset">
            <legend>Pick a color</legend>
            <div className="category-color-picker">
              {CATEGORY_COLORS.map((option) => (
                <label
                  key={option}
                  className={color === option ? 'selected' : ''}
                  style={{ '--picker-color': option }}
                >
                  <input
                    aria-label={`Color ${option}`}
                    checked={color === option}
                    name="category-color"
                    onChange={() => setColor(option)}
                    type="radio"
                    value={option}
                  />
                  <span />
                </label>
              ))}
            </div>
          </fieldset>

          <button className="category-primary-action" type="submit">
            Next <Icon name="arrow_forward" />
          </button>
        </form>
      </ModalFrame>
    );
  }

  return (
    <ModalFrame
      className="category-create-modal category-create-details"
      error={error}
      onCancel={onCancel}
      title={isEdit ? 'Edit Category' : 'New Category'}
    >
      <form onSubmit={submit}>
        <CategoryPreview color={color} icon={icon} name={name} onChange={() => setStep(1)} />
        <section className="category-customize-section">
          <h3>Customize your category</h3>
          <p>Add details and rules to make it work for you.</p>

          <label className="category-field-label" htmlFor="category-group">
            Group <span>(optional)</span>
          </label>
          <select
            id="category-group"
            onChange={(event) => setPlannerBucketId(event.target.value)}
            value={plannerBucketId}
          >
            <option value="">Unassigned</option>
            {plannerBuckets.map((bucket) => (
              <option key={bucket.id} value={bucket.id}>
                {bucket.name}
              </option>
            ))}
          </select>

          <label className="category-field-label" htmlFor="category-description">
            Description <span>(optional)</span>
          </label>
          <div className="category-description-input">
            <input
              id="category-description"
              maxLength={80}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="e.g., Coffee shops, drinks, and related treats"
              value={description}
            />
            <small>{description.length}/80</small>
          </div>

          <div className="category-rules-heading">
            <span>
              Auto-categorize using rules <em>(optional)</em>
            </span>
            <Icon name="info" />
          </div>
          <div className="category-rule-list">
            {rules.map((rule) => (
              <div className="category-rule-row" key={rule.id}>
                <select
                  aria-label="Rule condition"
                  onChange={(event) => updateRule(rule.id, { operator: event.target.value })}
                  value={rule.operator}
                >
                  <option value="contains">Description contains</option>
                  <option value="starts_with">Description starts with</option>
                  <option value="equals">Description equals</option>
                </select>
                <input
                  aria-label="Rule value"
                  onChange={(event) => updateRule(rule.id, { value: event.target.value })}
                  placeholder="e.g., starbucks"
                  value={rule.value}
                />
                <button
                  aria-label="Remove rule"
                  disabled={rules.length === 1}
                  onClick={() =>
                    setRules((current) => current.filter((item) => item.id !== rule.id))
                  }
                  type="button"
                >
                  <Icon name="close" />
                </button>
              </div>
            ))}
          </div>
          <button
            className="category-add-rule"
            onClick={() =>
              setRules((current) => [
                ...current,
                { id: Date.now(), field: 'description', operator: 'contains', value: '' }
              ])
            }
            type="button"
          >
            <Icon name="add" /> Add another rule
          </button>

          <fieldset className={`category-type-fieldset${isEdit ? ' is-readonly' : ''}`}>
            <legend>Show in reports as</legend>
            {isEdit ? (
              <div className="category-type-readonly">
                <Icon
                  name={
                    {
                      expense: 'south_west',
                      income: 'north_east',
                      savings: 'savings',
                      debt: 'credit_card'
                    }[type] || 'category'
                  }
                />
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </div>
            ) : (
              <div>
                <label className={type === 'expense' ? 'selected expense' : 'expense'}>
                  <input
                    checked={type === 'expense'}
                    name="category-type"
                    onChange={() => setType('expense')}
                    type="radio"
                    value="expense"
                  />
                  <Icon name="south_west" /> Expense
                </label>
                <label className={type === 'income' ? 'selected income' : 'income'}>
                  <input
                    checked={type === 'income'}
                    name="category-type"
                    onChange={() => setType('income')}
                    type="radio"
                    value="income"
                  />
                  <Icon name="north_east" /> Income
                </label>
              </div>
            )}
            {isEdit ? <small>Report type can’t be changed after creation.</small> : null}
          </fieldset>

          {!isEdit ? (
            <details className="category-advanced-options">
              <summary>
                Advanced options <Icon name="expand_more" />
              </summary>
              <label className="category-field-label" htmlFor="category-linked-account">
                Linked account name
              </label>
              <input
                id="category-linked-account"
                onChange={(event) => setPostingAccountName(event.target.value)}
                placeholder={name}
                value={postingAccountName}
              />
            </details>
          ) : null}
        </section>
        <footer className="category-create-footer">
          <button className="category-secondary-action" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="category-primary-action" type="submit">
            <Icon name="check" /> {isEdit ? 'Save Changes' : 'Create Category'}
          </button>
        </footer>
      </form>
    </ModalFrame>
  );
}

function CategorySuccessModal({ category, plannerBucketName, onCancel, onAddAnother }) {
  return (
    <ModalFrame className="category-success-modal" onCancel={onCancel} title="Category created">
      <div className="category-celebration" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <span>
          <Icon name="celebration" />
        </span>
      </div>
      <h3>All set!</h3>
      <p>“{category.name}” is ready to go.</p>
      <div className="category-success-summary" style={{ '--category-color': category.color }}>
        <span>
          <Icon name={category.icon} />
        </span>
        <div>
          <strong>{category.name}</strong>
          <small>
            {plannerBucketName || 'Unassigned'} ·{' '}
            {category.type === 'income' ? 'Income' : 'Expense'}
          </small>
        </div>
      </div>
      <div className="category-success-tip">
        <strong>Tip:</strong> Add transactions to see insights and trends here.
        <svg aria-hidden="true" viewBox="0 0 280 70">
          <path d="M2 45 L32 13 L68 54 L94 60 L127 36 L158 42 L190 22 L221 41 L250 10 L278 34" />
          <circle cx="32" cy="13" r="3" />
          <circle cx="190" cy="22" r="3" />
          <circle cx="250" cy="10" r="3" />
          <circle cx="278" cy="34" r="3" />
        </svg>
      </div>
      <div className="category-success-actions">
        <button className="category-primary-action" onClick={onCancel} type="button">
          View Categories
        </button>
        <button onClick={onAddAnother} type="button">
          Add another category
        </button>
      </div>
    </ModalFrame>
  );
}

function LinkedAccountModal({ category, error, onCancel, onSubmit }) {
  const [postingAccountName, setPostingAccountName] = useState(
    category?.linkedAccountName || category?.name || ''
  );
  function submit(event) {
    event.preventDefault();
    onSubmit({ categoryId: category.id, linkedAccountName: postingAccountName });
  }
  return (
    <ModalFrame
      className="category-simple-modal"
      error={error}
      onCancel={onCancel}
      title="Edit Linked Account"
    >
      <form onSubmit={submit}>
        <label className="category-field-label" htmlFor="category-linked-account">
          Linked Account Name
        </label>
        <input
          id="category-linked-account"
          onChange={(event) => setPostingAccountName(event.target.value)}
          required
          value={postingAccountName}
        />
        <div className="category-create-footer">
          <button className="category-secondary-action" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="category-primary-action" type="submit">
            Save Linked Account
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

function CategoryConfirmationModal({ mode, category, error, onCancel, onConfirm }) {
  const content = {
    hide: {
      title: 'Hide Category',
      button: 'Hide Category',
      copy: 'The category stays in historical reports but is removed from new entry choices.'
    },
    restore: {
      title: 'Restore Category',
      button: 'Restore Category',
      copy: 'The category becomes available for new transactions again.'
    },
    delete: {
      title: 'Delete Category',
      button: 'Delete Category',
      copy: category?.hasReferences
        ? 'This category is referenced and cannot be deleted. Hide it to preserve financial history.'
        : 'This unused category will be permanently deleted.'
    }
  }[mode];
  return (
    <ModalFrame
      className="category-simple-modal"
      error={error}
      onCancel={onCancel}
      title={content.title}
    >
      <div className="category-confirm-copy">
        <strong>{category?.name}</strong>
        <p>{content.copy}</p>
      </div>
      <div className="category-create-footer">
        <button className="category-secondary-action" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="category-primary-action" onClick={onConfirm} type="button">
          {content.button}
        </button>
      </div>
    </ModalFrame>
  );
}

function CategoryRouteController({
  model,
  workbook,
  onAction,
  onCommandResult,
  commandExecutor,
  services,
  initialShowHidden = false,
  initialTargetCategoryId = '',
  targetRequestKey = 0,
  onTargetHandled,
  periodLabel = '',
  rangeStart = '',
  rangeEnd = '',
  viewPreferenceStorage
}) {
  const actions = useActionBindings();
  const [showHidden, setShowHidden] = useState(() =>
    Boolean(model?.showHidden || initialShowHidden)
  );
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState('type');
  const [view, setView] = useCollectionViewPreference('categories', viewPreferenceStorage);
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState(null);
  const [referenceTargetId, setReferenceTargetId] = useState('');
  const targetRef = useRef(null);
  const focusedTargetRequest = useRef(0);
  const resolvedModel = useMemo(
    () =>
      workbook
        ? buildCategoriesFeatureModel(workbook, { showHidden, periodLabel, rangeStart, rangeEnd })
        : model || {},
    [model, periodLabel, rangeEnd, rangeStart, showHidden, workbook]
  );
  const plannerBuckets = asArray(workbook?.plannerBuckets).map((bucket) => ({
    id: bucket.id,
    name: bucket.name || bucket.id
  }));
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = asArray(resolvedModel.categoryRows).filter((row) => {
      if (!showHidden && row.isArchived) return false;
      return (
        !query ||
        [row.name, row.description, row.typeLabel, row.linkedAccountName].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(query)
        )
      );
    });
    return [...filtered].sort((left, right) => {
      if (groupBy === 'spending')
        return right.spent - left.spent || left.name.localeCompare(right.name);
      if (groupBy === 'name') return left.name.localeCompare(right.name);
      return left.typeLabel.localeCompare(right.typeLabel) || right.spent - left.spent;
    });
  }, [groupBy, resolvedModel.categoryRows, search, showHidden]);

  useEffect(() => {
    if (!initialTargetCategoryId || !targetRequestKey) return;
    const targetCategory =
      asArray(workbook?.categories).find(
        (category) => String(category?.id || '') === initialTargetCategoryId
      ) ||
      asArray(model?.categoryRows).find(
        (category) => String(category?.id || '') === initialTargetCategoryId
      );
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setReferenceTargetId(initialTargetCategoryId);
      setSearch('');
      setExpanded(true);
      if (targetCategory?.isActive === false || targetCategory?.isArchived === true) {
        setShowHidden(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [initialTargetCategoryId, model?.categoryRows, targetRequestKey, workbook?.categories]);

  useEffect(() => {
    if (
      !initialTargetCategoryId ||
      !targetRequestKey ||
      focusedTargetRequest.current === targetRequestKey ||
      !targetRef.current
    ) {
      return;
    }
    focusedTargetRequest.current = targetRequestKey;
    targetRef.current.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    targetRef.current.focus({ preventScroll: true });
    onTargetHandled?.(targetRequestKey);
  }, [
    expanded,
    initialTargetCategoryId,
    onTargetHandled,
    referenceTargetId,
    rows,
    showHidden,
    targetRequestKey
  ]);

  function openModal(kind, category = null) {
    setModal({ kind, category, error: '' });
  }

  function runCommand(action) {
    onAction?.(action);
    if (!workbook) {
      setModal(null);
      return;
    }
    const executor =
      typeof commandExecutor === 'function' ? commandExecutor : executeCategoryCommand;
    const result = executor(workbook, action, services);
    if (result?.ok) {
      if (action.type === CATEGORY_ACTIONS.CREATE) {
        const categoryId = result.events?.find(
          (event) => event.type === 'category.created'
        )?.categoryId;
        const created =
          asArray(result.workbook?.categories).find((item) => item.id === categoryId) ||
          action.payload;
        setModal({ kind: 'success', category: created, error: '' });
      } else setModal(null);
    } else {
      setModal((current) => ({
        ...current,
        error: result?.errors?.[0]?.message || 'The category change could not be completed.'
      }));
    }
    onCommandResult?.(result);
  }

  const toggleBinding = actions.change('toggle-hidden-categories');
  const boundToggle = toggleBinding.onChange;
  const rawCategory = modal?.category?.id
    ? asArray(workbook?.categories).find((category) => category.id === modal.category.id)
    : null;
  const editorCategory = modal?.category
    ? {
        ...modal.category,
        ...rawCategory,
        linkedAccountName: modal.category.linkedAccountName || ''
      }
    : null;
  const successBucket = plannerBuckets.find(
    (bucket) => bucket.id === modal?.category?.plannerBucketId
  )?.name;

  return (
    <section className={`categories-route categories-view-${view}`} data-react-route="categories">
      <header className="categories-header">
        <div>
          <h1>Categories</h1>
        </div>
        <div className="categories-header-actions">
          <label className="categories-group-select">
            <span>Group by</span>
            <select
              aria-label="Group categories by"
              onChange={(event) => setGroupBy(event.target.value)}
              value={groupBy}
            >
              <option value="type">Type</option>
              <option value="spending">Spending</option>
              <option value="name">Name</option>
            </select>
            <Icon name="expand_more" />
          </label>
          <div className="categories-view-toggle" aria-label="Category view" role="group">
            <button
              aria-label="Grid view"
              aria-pressed={view === 'grid'}
              className={view === 'grid' ? 'active' : ''}
              onClick={() => setView('grid')}
              type="button"
            >
              <Icon name="grid_view" />
            </button>
            <button
              aria-label="List view"
              aria-pressed={view === 'list'}
              className={view === 'list' ? 'active' : ''}
              onClick={() => setView('list')}
              type="button"
            >
              <Icon name="view_list" />
            </button>
          </div>
        </div>
      </header>

      <div className="categories-utility-bar">
        <label className="categories-search">
          <Icon name="search" />
          <input
            aria-label="Search categories"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search categories"
            type="search"
            value={search}
          />
        </label>
        <strong className="categories-count">
          {rows.length} categor{rows.length === 1 ? 'y' : 'ies'}
        </strong>
        <label className="categories-hidden-toggle">
          <input
            checked={showHidden}
            type="checkbox"
            {...toggleBinding}
            onChange={(event) => {
              boundToggle?.(event);
              setShowHidden(event.currentTarget.checked);
            }}
          />
          <span /> Show hidden
        </label>
      </div>

      <CategoryGallery
        actions={actions}
        currency={resolvedModel.currency || 'PHP'}
        expanded={expanded}
        onOpenModal={openModal}
        onToggleExpanded={() => setExpanded((current) => !current)}
        rows={rows}
        targetCategoryId={referenceTargetId}
        targetRef={targetRef}
      />

      {modal?.kind === 'create' ? (
        <CategoryFormModal
          currency={resolvedModel.currency || 'PHP'}
          error={modal.error}
          onCancel={() => setModal(null)}
          onSubmit={(payload) => runCommand({ type: CATEGORY_ACTIONS.CREATE, payload })}
          plannerBuckets={plannerBuckets}
        />
      ) : null}
      {modal?.kind === 'edit' ? (
        <CategoryFormModal
          key={`edit-${editorCategory?.id}`}
          category={editorCategory}
          currency={resolvedModel.currency || 'PHP'}
          error={modal.error}
          onCancel={() => setModal(null)}
          onSubmit={(payload) => runCommand({ type: CATEGORY_ACTIONS.RENAME, payload })}
          plannerBuckets={plannerBuckets}
        />
      ) : null}
      {modal?.kind === 'success' ? (
        <CategorySuccessModal
          category={modal.category}
          onAddAnother={() => openModal('create')}
          onCancel={() => setModal(null)}
          plannerBucketName={successBucket}
        />
      ) : null}
      {modal?.kind === 'link' ? (
        <LinkedAccountModal
          key={`link-${editorCategory?.id}`}
          category={editorCategory}
          error={modal.error}
          onCancel={() => setModal(null)}
          onSubmit={(payload) => runCommand({ type: CATEGORY_ACTIONS.LINK, payload })}
        />
      ) : null}
      {modal && ['hide', 'restore', 'delete'].includes(modal.kind) ? (
        <CategoryConfirmationModal
          category={modal.category}
          error={modal.error}
          mode={modal.kind}
          onCancel={() => setModal(null)}
          onConfirm={() =>
            runCommand({
              type: {
                hide: CATEGORY_ACTIONS.HIDE,
                restore: CATEGORY_ACTIONS.RESTORE,
                delete: CATEGORY_ACTIONS.DELETE
              }[modal.kind],
              payload: { categoryId: modal.category.id }
            })
          }
        />
      ) : null}
    </section>
  );
}

export function CategoryRoute(props) {
  return (
    <ActionBindingProvider onAction={props.onAction}>
      <CategoryRouteController {...props} />
    </ActionBindingProvider>
  );
}
