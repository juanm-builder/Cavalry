import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useActionBindings } from '../../shared/action-binding.jsx';
import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { FinancialValueInput } from '../../shared/FinancialValueInput.jsx';
import { CATEGORY_ACTIONS } from '../categories/category-controller.js';

const BUDGET_CATEGORY_TYPES = Object.freeze(['expense', 'savings', 'debt', 'income']);

const PLAN_COPY = Object.freeze({
  expense: {
    amountLabel: 'Spending limit',
    description: 'Choose a category and the amount you want available this month.'
  },
  savings: {
    amountLabel: 'Savings target',
    description: 'Choose a savings goal and the amount you want to set aside this month.'
  },
  debt: {
    amountLabel: 'Debt payment target',
    description: 'Choose a debt category and the principal you want to pay down this month.'
  },
  income: {
    amountLabel: 'Expected income',
    description: 'Choose an income category and the amount you expect this month.'
  }
});

function renderInBody(content) {
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

function BudgetEditorForm({ editor, categories }) {
  const actions = useActionBindings();
  const closeEditor = actions.action('close-budget-editor');
  const closeEditorOnClick = closeEditor.onClick;
  const dialogRef = useRef(null);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') closeEditorOnClick?.(event);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [closeEditorOnClick]);

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

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
  const [note, setNote] = useState(String((editor && editor.note) || ''));

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
  const categoryType = String((selectedCategory && selectedCategory.type) || 'expense');
  const copy = PLAN_COPY[categoryType] || PLAN_COPY.expense;

  return renderInBody(
    <div
      className="modal-backdrop budget-editor-backdrop"
      data-modal-backdrop="true"
      onMouseDown={(event) => event.target === event.currentTarget && closeEditorOnClick?.(event)}
      role="presentation"
    >
      <section
        aria-label="Budget editor"
        aria-modal="true"
        className="modal panel budget-editor-drawer"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="panel-header budget-editor-header">
          <div>
            <div className="badge">
              <span className="material-symbols-rounded">calendar_month</span>
              {budgetMonth}
            </div>
            <h3>{canArchive ? 'Edit Monthly Plan' : 'Add to Monthly Plan'}</h3>
            <p>{copy.description}</p>
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

        <div className="budget-editor-body">
          <div className="budget-editor-fields">
            <label className="field budget-editor-category-field">
              <span>Category</span>
              <CategorizedSelect
                aria-label="Budget category"
                createCategoryType="expense"
                createCategoryTypes={BUDGET_CATEGORY_TYPES}
                onCreateCategory={(payload) => actions.dispatch(CATEGORY_ACTIONS.CREATE, payload)}
                options={categories}
                value={categoryId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const nextCategory = categories.find((category) => category.id === nextId);
                  setCategoryId(nextId);
                  if (nextCategory) {
                    setPlanned(String(nextCategory.planned || ''));
                    setCreatedAt(String(nextCategory.createdAt || editor.currentDate || ''));
                    setNote(String(nextCategory.note || ''));
                  }
                }}
              />
            </label>

            <label className="field budget-editor-amount-field">
              <span>{copy.amountLabel}</span>
              <FinancialValueInput
                allowNegative={false}
                aria-label="Planned amount"
                min="0.01"
                onChange={(event) => setPlanned(event.target.value)}
                value={planned}
              />
            </label>

            <label className="field budget-editor-notes-field">
              <span>
                Note <small>(optional)</small>
              </span>
              <textarea
                aria-label="Budget notes"
                onChange={(event) => setNote(event.target.value)}
                placeholder="For example: keep dining lower while saving for Taiwan"
                rows="3"
                value={note}
              />
            </label>
          </div>
        </div>

        <div className="modal-actions budget-editor-actions">
          {canArchive ? (
            <button
              className="btn btn-danger budget-editor-remove"
              aria-label="Archive Budget"
              type="button"
              {...actions.action('archive-budget', { sheetId, categoryId })}
            >
              Remove
            </button>
          ) : null}
          <span className="budget-editor-action-spacer" />
          <button className="btn" type="button" {...closeEditor}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            aria-label="Save Budget"
            disabled={
              (!sheetId && !rangeStart) || !categoryId || !(numericPlanned > 0) || !createdAt
            }
            type="button"
            {...actions.action('save-budget', {
              sheetId,
              categoryId,
              planned: numericPlanned,
              createdAt,
              ...(note.trim() ? { note: note.trim() } : {}),
              rangeStart,
              rangeEnd
            })}
          >
            Save
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
