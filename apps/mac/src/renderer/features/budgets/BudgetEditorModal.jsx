import React, { useEffect, useState } from 'react';

import { useActionBindings } from '../../shared/action-binding.jsx';
import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { FinancialValueInput } from '../../shared/FinancialValueInput.jsx';

function BudgetEditorForm({ editor, categories }) {
  const actions = useActionBindings();
  const closeEditor = actions.action('close-budget-editor');
  const closeEditorOnClick = closeEditor.onClick;
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') closeEditorOnClick?.(event);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [closeEditorOnClick]);
  const initialCategoryId = String(
    (editor && editor.categoryId) || (categories[0] && categories[0].id) || ''
  );
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const selectedCategory = categories.find((category) => category.id === categoryId) || null;
  const [planned, setPlanned] = useState(
    String(
      editor && typeof editor.planned !== 'undefined'
        ? editor.planned
        : (selectedCategory && selectedCategory.planned) || ''
    )
  );
  const [createdAt, setCreatedAt] = useState(
    String((editor && (editor.createdAt || editor.currentDate)) || '')
  );

  const sheetId = String(editor.sheetId || '');
  const rangeStart = String(editor.rangeStart || '');
  const rangeEnd = String(editor.rangeEnd || '');
  const budgetMonth = (() => {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(rangeStart);
    if (!match) return 'Current month';
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
      new Date(Number(match[1]), Number(match[2]) - 1, 1)
    );
  })();
  const numericPlanned = Number(planned);
  const canArchive = Number(selectedCategory && selectedCategory.planned) > 0;

  return (
    <div
      className="modal-backdrop budget-editor-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && closeEditorOnClick?.(event)}
      role="presentation"
    >
      <section
        aria-label="Budget editor"
        aria-modal="true"
        className="modal panel budget-editor-drawer"
        role="dialog"
      >
        <div className="panel-header">
          <div>
            <div className="badge">
              <span className="material-symbols-rounded">pie_chart</span>Budget
            </div>
            <h3>{canArchive ? 'Edit Budget' : 'Add Budget'}</h3>
            <p>Set the planned amount and when this budget was created.</p>
          </div>
          <button
            className="btn btn-icon"
            type="button"
            aria-label="Close budget editor"
            {...closeEditor}
          >
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>
        <div className="stack-list">
          <label className="field">
            <span>Category</span>
            <CategorizedSelect
              aria-label="Budget category"
              options={categories}
              value={categoryId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextCategory = categories.find((category) => category.id === nextId);
                setCategoryId(nextId);
                setPlanned(String((nextCategory && nextCategory.planned) || ''));
                setCreatedAt(
                  String((nextCategory && nextCategory.createdAt) || editor.currentDate || '')
                );
              }}
            />
          </label>
          <label className="field">
            <span>Planned amount</span>
            <FinancialValueInput
              allowNegative={false}
              aria-label="Planned amount"
              min="0.01"
              onChange={(event) => setPlanned(event.target.value)}
              value={planned}
            />
          </label>
          <label className="field">
            <span>Budget Month</span>
            <input aria-label="Budget month" readOnly value={budgetMonth} />
          </label>
          <label className="field">
            <span>Date Created</span>
            <input aria-label="Budget date created" readOnly type="date" value={createdAt} />
          </label>
          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              aria-label="Budget notes"
              placeholder="Add a note for this budget..."
              rows="3"
            />
          </label>
        </div>
        <div className="modal-actions">
          {canArchive ? (
            <button
              className="btn btn-danger"
              type="button"
              {...actions.action('archive-budget', { sheetId, categoryId })}
            >
              Archive Budget
            </button>
          ) : null}
          <button className="btn" type="button" {...closeEditor}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={
              (!sheetId && !rangeStart) || !categoryId || !(numericPlanned > 0) || !createdAt
            }
            type="button"
            {...actions.action('save-budget', {
              sheetId,
              categoryId,
              planned: numericPlanned,
              createdAt,
              rangeStart,
              rangeEnd
            })}
          >
            Save Budget
          </button>
        </div>
      </section>
    </div>
  );
}

export function BudgetEditorModal({ editor, categories = [] }) {
  if (!editor) return null;
  const editorKey = [editor.sheetId, editor.categoryId, editor.planned].join(':');
  return <BudgetEditorForm key={editorKey} editor={editor} categories={categories} />;
}
