import { generateKeyPairSync, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createAppStoreConnectToken,
  decodeProfileContent,
  selectBundleId,
  selectDeveloperIdCertificate,
  selectMatchingProfile
} from '../../tools/release/prepare-mac-profile.mjs';

const now = Date.parse('2026-08-30T08:00:00Z');
const future = '2027-08-30T08:00:00Z';

describe('Mac Developer ID provisioning profile preparation', () => {
  it('creates a short-lived ES256 App Store Connect token', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const token = createAppStoreConnectToken({
      keyId: 'ABCDEFGHIJ',
      issuerId: '01234567-89ab-cdef-0123-456789abcdef',
      privateKey,
      now
    });
    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toMatchObject({
      alg: 'ES256',
      kid: 'ABCDEFGHIJ'
    });
    expect(claims).toMatchObject({
      iss: '01234567-89ab-cdef-0123-456789abcdef',
      aud: 'appstoreconnect-v1'
    });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(605);
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url')
      )
    ).toBe(true);
  });

  it('selects only the exact bundle ID and matching active release certificate', () => {
    const bundle = selectBundleId([
      { id: 'bundle-1', attributes: { identifier: 'com.juanmbuilder.cavalry.mac' } }
    ]);
    const certificate = selectDeveloperIdCertificate(
      [
        {
          id: 'certificate-1',
          attributes: {
            certificateType: 'DEVELOPER_ID_APPLICATION_G2',
            activated: true,
            expirationDate: future,
            serialNumber: '00:AB:CD:12'
          }
        }
      ],
      'ABCD12',
      now
    );

    expect(bundle.id).toBe('bundle-1');
    expect(certificate.id).toBe('certificate-1');
  });

  it('rejects ambiguous bundle IDs and nonmatching certificates', () => {
    expect(() => selectBundleId([])).toThrow(/exactly one registered bundle ID/i);
    expect(() =>
      selectDeveloperIdCertificate(
        [
          {
            id: 'certificate-1',
            attributes: {
              certificateType: 'DEVELOPER_ID_APPLICATION',
              activated: true,
              expirationDate: future,
              serialNumber: 'A1'
            }
          }
        ],
        'B2',
        now
      )
    ).toThrow(/matching the release certificate/i);
  });

  it('reuses only an active direct-distribution profile for the same bundle and certificate', () => {
    const content = Buffer.alloc(300, 7).toString('base64');
    const profile = selectMatchingProfile(
      [
        {
          id: 'profile-1',
          attributes: {
            profileType: 'MAC_APP_DIRECT',
            profileState: 'ACTIVE',
            expirationDate: future,
            profileContent: content
          },
          relationships: {
            bundleId: { data: { id: 'bundle-1', type: 'bundleIds' } },
            certificates: { data: [{ id: 'certificate-1', type: 'certificates' }] }
          }
        }
      ],
      'bundle-1',
      'certificate-1',
      now
    );

    expect(profile?.id).toBe('profile-1');
    expect(decodeProfileContent(profile.attributes.profileContent)).toEqual(Buffer.alloc(300, 7));
  });

  it('rejects malformed or implausibly small profile payloads', () => {
    expect(() => decodeProfileContent('not-base64!')).toThrow(/invalid/i);
    expect(() => decodeProfileContent(Buffer.from('small').toString('base64'))).toThrow(/small/i);
  });
});
