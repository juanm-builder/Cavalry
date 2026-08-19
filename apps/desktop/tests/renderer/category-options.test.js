import { describe, expect, it } from 'vitest';

import {
  CATEGORY_ICONS,
  isSupportedCategoryIcon,
  matchCategoryIcon
} from '../../src/renderer/features/categories/category-options.js';

describe('category icon options', () => {
  it('matches common Cavalry categories deterministically', () => {
    expect(matchCategoryIcon('Groceries', 'expense')).toBe('shopping_cart');
    expect(matchCategoryIcon('Internet', 'expense')).toBe('wifi');
    expect(matchCategoryIcon('Telecommunications', 'expense')).toBe('phone_iphone');
    expect(matchCategoryIcon('Mobile Data / Telecom', 'expense')).toBe('phone_iphone');
    expect(matchCategoryIcon('Personal Care', 'expense')).toBe('favorite');
    expect(matchCategoryIcon('Bills / Utilities', 'expense')).toBe('receipt_long');
    expect(matchCategoryIcon('Medicine and doctor', 'expense')).toBe('medical_services');
    expect(matchCategoryIcon('Salary', 'income')).toBe('payments');
    expect(matchCategoryIcon('Emergency Fund', 'savings')).toBe('savings');
    expect(matchCategoryIcon('Unusual', 'expense')).toBe('category');
  });

  it('matches whole semantic terms instead of misleading substrings', () => {
    expect(matchCategoryIcon('Personal Care', 'expense')).not.toBe('directions_car');
    expect(matchCategoryIcon('Carpet Cleaning', 'expense')).not.toBe('directions_car');
    expect(matchCategoryIcon('Carpet Cleaning', 'expense')).not.toBe('pets');
    expect(matchCategoryIcon('Transportation', 'expense')).toBe('directions_car');
  });

  it('only accepts icons exposed by the category picker and assistant schema', () => {
    expect(CATEGORY_ICONS).toContain('shopping_cart');
    expect(isSupportedCategoryIcon('shopping_cart')).toBe(true);
    expect(isSupportedCategoryIcon('')).toBe(false);
    expect(isSupportedCategoryIcon('unknown_icon')).toBe(false);
    expect(
      [
        matchCategoryIcon('Telecommunications', 'expense'),
        matchCategoryIcon('Personal Care', 'expense'),
        matchCategoryIcon('Unknown', 'income')
      ].every(isSupportedCategoryIcon)
    ).toBe(true);
  });
});
