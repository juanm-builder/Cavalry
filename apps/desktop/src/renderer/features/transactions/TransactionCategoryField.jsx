import React from 'react';

import { PrivateValue } from '../../shared/PrivateValue.jsx';
import { useActionBindings } from '../../shared/action-binding.jsx';
import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { CategorizedSelect } from '../../shared/CategorizedSelect.jsx';
import { FinancialValueInput } from '../../shared/FinancialValueInput.jsx';
import { CATEGORY_ACTIONS } from '../categories/category-controller.js';
import { formatTransactionMoney } from './transaction-row-presentation.js';

export function TransactionCategoryField({
  draft,
  options,
  label = 'Category',
  placeholder = 'Choose category',
  categoryType = 'expense',
  className = 'field'
}) {
  const actions = useActionBindings();
  const onCreateCategory = (payload) => actions.dispatch(CATEGORY_ACTIONS.CREATE, payload);
  const canSplit = ['expense_paid', 'expense_charged'].includes(draft.template);
  const splits = canSplit && Array.isArray(draft.categorySplits) ? draft.categorySplits : [];
  const setSplits = (value) =>
    actions.dispatch('transaction-composer-change', { field: 'categorySplits', value });

  if (!splits.length) {
    return (
      <div className={className}>
        <PrivateValue as="label" htmlFor="transaction-category">
          {label}
        </PrivateValue>
        <CategorizedSelect
          aria-label={label}
          createCategoryType={categoryType}
          id="transaction-category"
          onCreateCategory={onCreateCategory}
          options={options}
          placeholder={placeholder}
          value={draft.categoryId || ''}
          {...actions.change('transaction-composer-change', { field: 'categoryId' })}
        />
        {canSplit ? (
          <button
            className="transaction-split-link"
            onClick={() =>
              setSplits([
                { categoryId: draft.categoryId || '', amount: '' },
                { categoryId: '', amount: '' }
              ])
            }
            type="button"
          >
            Split by category
          </button>
        ) : null}
      </div>
    );
  }

  const unassignedCents =
    Math.round(Number(draft.amount || 0) * 100) -
    splits.reduce((sum, split) => sum + Math.round(Number(split.amount || 0) * 100), 0);
  const update = (index, field, value) =>
    setSplits(splits.map((split, i) => (i === index ? { ...split, [field]: value } : split)));

  return (
    <fieldset className="transaction-splits">
      <legend>Category split</legend>
      {splits.map((split, index) => (
        <div className="transaction-split-row" key={index}>
          <div className={className}>
            <label htmlFor={`split-category-${index}`}>Category {index + 1}</label>
            <CategorizedSelect
              aria-label={`Category ${index + 1}`}
              createCategoryType="expense"
              id={`split-category-${index}`}
              onCreateCategory={onCreateCategory}
              onValueChange={(value) => update(index, 'categoryId', value)}
              options={options.filter(
                (option) =>
                  option.type === 'expense' &&
                  !splits.some((other, i) => i !== index && other.categoryId === option.value)
              )}
              placeholder="Choose category"
              value={split.categoryId || ''}
            />
          </div>
          <div className={className}>
            <label htmlFor={`split-amount-${index}`}>Amount</label>
            <FinancialValueInput
              allowNegative={false}
              aria-label={`Amount for category ${index + 1}`}
              id={`split-amount-${index}`}
              onChange={(event) => update(index, 'amount', event.currentTarget.value)}
              value={split.amount ?? ''}
            />
          </div>
          {splits.length > 2 ? (
            <button
              aria-label={`Remove category ${index + 1}`}
              className="btn btn-icon"
              onClick={() => setSplits(splits.filter((_, i) => i !== index))}
              type="button"
            >
              <CavalryIcon name="close" />
            </button>
          ) : null}
        </div>
      ))}
      <div className="transaction-split-actions">
        <button
          className="transaction-split-link"
          onClick={() =>
            setSplits([
              ...splits,
              { categoryId: '', amount: unassignedCents > 0 ? unassignedCents / 100 : '' }
            ])
          }
          type="button"
        >
          Add category
        </button>
        <button className="transaction-split-link" onClick={() => setSplits([])} type="button">
          Use one category
        </button>
      </div>
      <PrivateValue as="small" aria-live="polite" className={unassignedCents < 0 ? 'bad' : ''}>
        {unassignedCents === 0 && Number(draft.amount) > 0
          ? 'Matches the receipt total'
          : `${formatTransactionMoney(Math.abs(unassignedCents) / 100, draft.currency)} ${unassignedCents < 0 ? 'over the receipt total' : 'left to assign'}`}
      </PrivateValue>
    </fieldset>
  );
}
