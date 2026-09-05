import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  createCloudKitWebApi,
  appleAuthenticationUrl
} = require('../../src/host/cloudkit-web-api.cjs');

describe('CloudKit web session requests', () => {
  it('serializes requests and persists rotated header tokens before their next use', async () => {
    const session = { token: 'initial' };
    const order = [];
    const api = createCloudKitWebApi({
      apiToken: 'public',
      session,
      persistSession: async (value) => {
        await Promise.resolve();
        order.push(`persist:${value.token}`);
      },
      fetch: async (url) => {
        const token = new URL(url).searchParams.get('ckWebAuthToken');
        order.push(`fetch:${token}`);
        return new Response('{}', {
          headers: { 'x-apple-cloudkit-web-auth-token': token === 'initial' ? 'second' : 'third' }
        });
      }
    });
    await Promise.all([api('users/current'), api('users/current')]);
    expect(order).toEqual(['fetch:initial', 'persist:second', 'fetch:second', 'persist:third']);
  });

  it('fails closed when a rotated session cannot be saved and never exposes the token in errors', async () => {
    const session = { token: 'private-original' };
    const api = createCloudKitWebApi({
      apiToken: 'public',
      session,
      persistSession: async () => {
        throw new Error('private-next');
      },
      fetch: async () =>
        new Response('{}', { headers: { 'x-apple-cloudkit-session': 'private-next' } })
    });
    await expect(api('users/current')).rejects.toMatchObject({ code: 'cloud_session_save_failed' });
    expect(session.token).toBe('');
  });

  it('rejects untrusted sign-in URLs and oversized JSON before buffering it', async () => {
    expect(appleAuthenticationUrl('https://idmsa.apple.com.evil.example/login')).toBe('');
    const credentialedUrl = new URL('https://idmsa.apple.com/login');
    credentialedUrl.username = 'test-user';
    credentialedUrl.password = 'test-password';
    expect(appleAuthenticationUrl(credentialedUrl.href)).toBe('');
    const persistSession = vi.fn();
    const api = createCloudKitWebApi({
      apiToken: 'public',
      session: {},
      persistSession,
      fetch: async () =>
        new Response('{}', { headers: { 'content-length': String(9 * 1024 * 1024) } })
    });
    await expect(api('users/current')).rejects.toMatchObject({ code: 'invalid_cloudkit_response' });
  });
});
