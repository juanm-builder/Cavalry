import { INSTITUTION_CATALOG } from '@cavalry/finance-core';
import { describe, expect, it } from 'vitest';

import { INSTITUTION_LOGOS } from '../../src/renderer/shared/institution-logos.jsx';

describe('institution logos', () => {
  it('provides an offline logo for every searchable institution', () => {
    const catalogIds = INSTITUTION_CATALOG.map((institution) => institution.id).sort();
    const logoIds = Object.keys(INSTITUTION_LOGOS).sort();

    expect(logoIds).toEqual(catalogIds);
  });

  it('uses bundled vector assets for supported official institution marks', () => {
    const bundledIds = [
      'aub',
      'bdo',
      'bpi',
      'chinabank',
      'cimb',
      'eastwest',
      'gcash',
      'gotyme',
      'hsbc',
      'landbank',
      'mayabank',
      'mayawallet',
      'metrobank',
      'pnb',
      'rcbc',
      'securitybank',
      'unionbank'
    ];

    for (const institutionId of bundledIds) {
      expect(typeof INSTITUTION_LOGOS[institutionId]).toBe('string');
    }
  });

  it('provides offline badge fallbacks for the additional wallet providers', () => {
    expect(INSTITUTION_LOGOS.coinsph).toBeTruthy();
    expect(INSTITUTION_LOGOS.paymaya_business).toBeTruthy();
    expect(typeof INSTITUTION_LOGOS.coinsph).not.toBe('string');
    expect(typeof INSTITUTION_LOGOS.paymaya_business).not.toBe('string');
  });
});
