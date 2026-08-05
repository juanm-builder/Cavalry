import { describe, expect, it, vi } from 'vitest';

import {
  createAccountDeletionHandler,
  exchangeAndRevokeAppleCode,
  resolveSupabaseAdminKey
} from '../../../../supabase/functions/_shared/account-deletion-core.mjs';

function deletionRequest(body, token = 'user-access-token') {
  return new Request('https://example.supabase.co/functions/v1/delete-cavalry-account', {
    method: 'POST',
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

function dependencies(overrides = {}) {
  return {
    authenticate: vi.fn(async () => ({ id: 'user-1', identities: [] })),
    deleteUser: vi.fn(async () => undefined),
    listAttachmentPaths: vi.fn(async () => []),
    logError: vi.fn(),
    removeAttachmentPaths: vi.fn(async () => undefined),
    revokeAppleAuthorization: vi.fn(async () => undefined),
    ...overrides
  };
}

describe('Cavalry Cloud account-deletion Edge Function', () => {
  it('requires a verified caller and an explicit destructive confirmation', async () => {
    const adapter = dependencies();
    const handle = createAccountDeletionHandler(adapter);

    const unauthenticated = await handle(deletionRequest({ confirmation: 'DELETE' }, ''));
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'authentication_required' });

    const unconfirmed = await handle(deletionRequest({ confirmation: 'not-delete' }));
    expect(unconfirmed.status).toBe(400);
    await expect(unconfirmed.json()).resolves.toEqual({
      error: 'deletion_confirmation_required'
    });
    expect(adapter.deleteUser).not.toHaveBeenCalled();
  });

  it('deletes an Apple-backed account and requests manual revocation when the code is missing', async () => {
    const adapter = dependencies({
      authenticate: vi.fn(async () => ({
        id: 'user-1',
        identities: [{ provider: 'apple', identity_data: { sub: 'apple-subject' } }]
      }))
    });
    const handle = createAccountDeletionHandler(adapter);

    const missingCode = await handle(deletionRequest({ confirmation: 'DELETE' }));
    expect(missingCode.status).toBe(200);
    await expect(missingCode.json()).resolves.toEqual({
      deleted: true,
      manualAppleRevocationRequired: true
    });
    expect(adapter.revokeAppleAuthorization).not.toHaveBeenCalled();
    expect(adapter.removeAttachmentPaths).toHaveBeenCalledWith([]);
    expect(adapter.deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('does not let Apple revocation failure block confirmed account deletion', async () => {
    const adapter = dependencies({
      authenticate: vi.fn(async () => ({
        id: 'user-1',
        identities: [{ provider: 'apple', identity_data: { sub: 'apple-subject' } }]
      })),
      revokeAppleAuthorization: vi.fn(async () => {
        throw new Error('apple_identity_mismatch');
      })
    });
    const handle = createAccountDeletionHandler(adapter);

    const rejected = await handle(
      deletionRequest({ confirmation: 'DELETE', appleAuthorizationCode: 'fresh-code' })
    );
    expect(rejected.status).toBe(200);
    await expect(rejected.json()).resolves.toEqual({
      deleted: true,
      manualAppleRevocationRequired: true
    });
    expect(adapter.revokeAppleAuthorization).toHaveBeenCalledWith('fresh-code', 'apple-subject');
    expect(adapter.removeAttachmentPaths).toHaveBeenCalledWith([]);
    expect(adapter.deleteUser).toHaveBeenCalledWith('user-1');
    expect(adapter.logError).toHaveBeenCalledWith(
      'apple_token_revocation_failed',
      expect.any(Error)
    );
  });

  it('deletes the account when Apple metadata lacks a verified subject', async () => {
    const adapter = dependencies({
      authenticate: vi.fn(async () => ({
        id: 'user-1',
        app_metadata: { providers: ['google', 'apple'] }
      }))
    });
    const response = await createAccountDeletionHandler(adapter)(
      deletionRequest({ confirmation: 'DELETE', appleAuthorizationCode: 'fresh-code' })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      manualAppleRevocationRequired: true
    });
    expect(adapter.revokeAppleAuthorization).not.toHaveBeenCalled();
    expect(adapter.deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('reports that Apple revocation completed when a fresh code succeeds', async () => {
    const adapter = dependencies({
      authenticate: vi.fn(async () => ({
        id: 'user-1',
        identities: [{ provider: 'apple', identity_data: { sub: 'apple-subject' } }]
      }))
    });
    const response = await createAccountDeletionHandler(adapter)(
      deletionRequest({ confirmation: 'DELETE', appleAuthorizationCode: 'fresh-code' })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      manualAppleRevocationRequired: false
    });
    expect(adapter.revokeAppleAuthorization).toHaveBeenCalledWith('fresh-code', 'apple-subject');
  });

  it('does not delete the Auth user when private attachment cleanup fails', async () => {
    const adapter = dependencies({
      listAttachmentPaths: vi.fn(async () => ['user-1/report/image.png']),
      removeAttachmentPaths: vi.fn(async () => {
        throw new Error('storage unavailable');
      })
    });
    const response = await createAccountDeletionHandler(adapter)(
      deletionRequest({ confirmation: 'DELETE' })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'account_data_deletion_failed' });
    expect(adapter.deleteUser).not.toHaveBeenCalled();
  });

  it('removes only owner-prefixed objects before deleting a Google-only user', async () => {
    const order = [];
    const adapter = dependencies({
      listAttachmentPaths: vi.fn(async () => [
        'user-1/report/image.png',
        'user-2/report/foreign.png',
        '',
        null
      ]),
      removeAttachmentPaths: vi.fn(async (paths) => {
        order.push(['storage', paths]);
      }),
      deleteUser: vi.fn(async (userId) => {
        order.push(['auth', userId]);
      })
    });
    const response = await createAccountDeletionHandler(adapter)(
      deletionRequest({ confirmation: 'DELETE' })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      manualAppleRevocationRequired: false
    });
    expect(adapter.revokeAppleAuthorization).not.toHaveBeenCalled();
    expect(order).toEqual([
      ['storage', ['user-1/report/image.png']],
      ['auth', 'user-1']
    ]);
  });
});

describe('Supabase Edge Function admin-key resolution', () => {
  it('prefers the default Supabase secret key over the legacy service-role key', () => {
    const values = {
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_current' }),
      SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role-key'
    };

    expect(resolveSupabaseAdminKey((name) => values[name])).toBe('sb_secret_current');
  });

  it('falls back to the legacy key when the secret-key map is unavailable or invalid', () => {
    const legacy = 'legacy-service-role-key';

    expect(
      resolveSupabaseAdminKey((name) => (name === 'SUPABASE_SECRET_KEYS' ? '{not-json' : legacy))
    ).toBe(legacy);
    expect(
      resolveSupabaseAdminKey((name) =>
        name === 'SUPABASE_SECRET_KEYS' ? JSON.stringify({ secondary: 'sb_secret_other' }) : legacy
      )
    ).toBe(legacy);
  });
});

describe('Apple authorization-code revocation', () => {
  function appleTokenResponse(body, ok = true) {
    return { ok, json: vi.fn(async () => body) };
  }

  it('rejects a token whose verified subject is not the linked identity', async () => {
    const fetch = vi.fn(async () =>
      appleTokenResponse({ id_token: 'apple-id-token', refresh_token: 'refresh-token' })
    );
    await expect(
      exchangeAndRevokeAppleCode(
        {
          fetch,
          clientId: 'com.builder.cavalry.ios',
          clientSecret: 'client-secret',
          verifyIdToken: vi.fn(async () => ({ sub: 'different-subject' }))
        },
        'authorization-code',
        'expected-subject'
      )
    ).rejects.toThrow('apple_identity_mismatch');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('exchanges and revokes the refresh token, and fails closed if revoke is rejected', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        appleTokenResponse({ id_token: 'apple-id-token', refresh_token: 'refresh-token' })
      )
      .mockResolvedValueOnce(appleTokenResponse(null, false));
    await expect(
      exchangeAndRevokeAppleCode(
        {
          fetch,
          clientId: 'com.builder.cavalry.ios',
          clientSecret: 'client-secret',
          verifyIdToken: vi.fn(async () => ({ sub: 'expected-subject' }))
        },
        'authorization-code',
        'expected-subject'
      )
    ).rejects.toThrow('apple_token_revocation_failed');
    const revokeOptions = fetch.mock.calls[1][1];
    expect(String(revokeOptions.body)).toContain('token=refresh-token');
    expect(String(revokeOptions.body)).toContain('token_type_hint=refresh_token');
  });
});
