import { describe, expect, it } from 'vitest';
import {
  INSTITUTION_CATALOG,
  findInstitutionById,
  matchedFormerName,
  resolveInstitution,
  searchInstitutions
} from '@cavalry/finance-core/domain/institutions/institution-catalog.js';
import { normalizeAccount } from '@cavalry/finance-core/application/accounts/account-management-service.js';

describe('institution catalog', () => {
  it('has unique ids and complete entries', () => {
    const ids = new Set();
    INSTITUTION_CATALOG.forEach((institution) => {
      expect(ids.has(institution.id)).toBe(false);
      ids.add(institution.id);
      expect(institution.name).toBeTruthy();
      expect(institution.shortName).toBeTruthy();
      expect(institution.monogram.length).toBeGreaterThanOrEqual(2);
      expect(institution.monogram.length).toBeLessThanOrEqual(4);
      expect(institution.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['bank', 'digital_bank', 'e_wallet']).toContain(institution.type);
    });
  });

  it('finds institutions by id', () => {
    expect(findInstitutionById('rcbc')?.shortName).toBe('RCBC');
    expect(findInstitutionById('  rcbc  ')?.id).toBe('rcbc');
    expect(findInstitutionById('unknown-bank')).toBeNull();
    expect(findInstitutionById('')).toBeNull();
  });

  it('resolves exact names, aliases, and former names regardless of case and punctuation', () => {
    expect(resolveInstitution('RCBC')?.id).toBe('rcbc');
    expect(resolveInstitution('rizal commercial banking corporation')?.id).toBe('rcbc');
    expect(resolveInstitution('B.P.I.')?.id).toBe('bpi');
    expect(resolveInstitution('Banco de Oro')?.id).toBe('bdo');
    expect(resolveInstitution('SeaBank')?.id).toBe('maribank');
    expect(resolveInstitution('PayMaya')?.id).toBe('mayawallet');
    expect(resolveInstitution('Coins PH')?.id).toBe('coinsph');
    expect(resolveInstitution('PayMaya Business')?.id).toBe('paymaya_business');
    expect(resolveInstitution('Maya Business')?.id).toBe('paymaya_business');
    expect(resolveInstitution('My Rural Cooperative Bank')).toBeNull();
    expect(resolveInstitution('')).toBeNull();
  });

  it('does not resolve loose partial text', () => {
    expect(resolveInstitution('BPI Savings Account')).toBeNull();
    expect(resolveInstitution('Security')).toBeNull();
  });

  it('ranks search results with short-name matches first', () => {
    const results = searchInstitutions('rcbc');
    expect(results[0]?.id).toBe('rcbc');
    expect(searchInstitutions('rizal')[0]?.id).toBe('rcbc');
    const bankOfCommerce = searchInstitutions('bank of commerce');
    expect(bankOfCommerce[0]?.id).toBe('bankcom');
  });

  it('surfaces former brandings in search with a matched former name', () => {
    const results = searchInstitutions('seabank');
    expect(results[0]?.id).toBe('maribank');
    expect(matchedFormerName(results[0], 'seabank')).toBe('SeaBank');
    expect(matchedFormerName(findInstitutionById('rcbc'), 'rcbc')).toBe('');
  });

  it('filters by institution type and caps results', () => {
    const wallets = searchInstitutions('', { types: ['e_wallet'] });
    expect(wallets.length).toBeGreaterThan(0);
    expect(wallets.every((item) => item.type === 'e_wallet')).toBe(true);
    expect(searchInstitutions('bank', { limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  it('finds the additional wallet providers without changing the PayMaya alias', () => {
    expect(searchInstitutions('coins.ph', { types: ['e_wallet'] })[0]?.id).toBe('coinsph');
    expect(searchInstitutions('paymaya business', { types: ['e_wallet'] })[0]?.id).toBe(
      'paymaya_business'
    );
    expect(resolveInstitution('PayMaya')?.id).toBe('mayawallet');
  });
});

describe('account institution linking', () => {
  it('links accounts whose free-text institution matches the catalog', () => {
    const account = normalizeAccount({ name: 'Emergency Fund', institution: 'seabank' });
    expect(account.institutionId).toBe('maribank');
    expect(account.institution).toBe('seabank');
  });

  it('fills the display name from an explicit institution id', () => {
    const account = normalizeAccount({ name: 'Payroll', institutionId: 'bpi' });
    expect(account.institutionId).toBe('bpi');
    expect(account.institution).toBe('BPI');
  });

  it('keeps unknown institutions as free text without a link', () => {
    const account = normalizeAccount({ name: 'Coop', institution: 'My Rural Cooperative Bank' });
    expect(account.institutionId).toBe('');
    expect(account.institution).toBe('My Rural Cooperative Bank');
  });

  it('ignores invalid institution ids and falls back to text resolution', () => {
    const account = normalizeAccount({
      name: 'Savings',
      institution: 'RCBC',
      institutionId: 'not-a-real-bank'
    });
    expect(account.institutionId).toBe('rcbc');
  });
});
