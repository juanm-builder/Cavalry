import { createClient } from 'npm:@supabase/supabase-js@2.112.0';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';

import {
  createAccountDeletionHandler,
  exchangeAndRevokeAppleCode,
  resolveSupabaseAdminKey
} from '../_shared/account-deletion-core.mjs';

const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const FEEDBACK_BUCKET = 'feedback-attachments';

function environment(name: string) {
  return String(Deno.env.get(name) || '').trim();
}

function configurationError() {
  return Response.json(
    { error: 'account_deletion_not_configured' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  );
}

Deno.serve(async (request) => {
  const supabaseUrl = environment('SUPABASE_URL');
  const adminKey = resolveSupabaseAdminKey(environment);
  const appleClientId = environment('APPLE_NATIVE_CLIENT_ID');
  const appleClientSecret = environment('APPLE_NATIVE_CLIENT_SECRET');
  if (!supabaseUrl || !adminKey) return configurationError();

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const handler = createAccountDeletionHandler({
    async authenticate(accessToken: string) {
      const result = await admin.auth.getUser(accessToken);
      if (result.error) return null;
      return result.data.user;
    },

    async revokeAppleAuthorization(authorizationCode: string, expectedSubject: string) {
      if (!appleClientId || !appleClientSecret) {
        throw new Error('apple_deletion_not_configured');
      }
      await exchangeAndRevokeAppleCode(
        {
          fetch,
          clientId: appleClientId,
          clientSecret: appleClientSecret,
          async verifyIdToken(idToken: string, audience: string) {
            const verified = await jwtVerify(idToken, APPLE_JWKS, {
              issuer: 'https://appleid.apple.com',
              audience
            });
            return { sub: verified.payload.sub };
          }
        },
        authorizationCode,
        expectedSubject
      );
    },

    async listAttachmentPaths(userId: string) {
      const result = await admin
        .from('feedback_attachments')
        .select('storage_path')
        .eq('owner_id', userId)
        .limit(1_000);
      if (result.error) throw result.error;
      return (result.data || []).map((record) => record.storage_path);
    },

    async removeAttachmentPaths(paths: string[]) {
      for (let index = 0; index < paths.length; index += 100) {
        const result = await admin.storage
          .from(FEEDBACK_BUCKET)
          .remove(paths.slice(index, index + 100));
        if (result.error) throw result.error;
      }
    },

    async deleteUser(userId: string) {
      const result = await admin.auth.admin.deleteUser(userId, false);
      if (result.error) throw result.error;
    },

    logError(code: string, error: unknown) {
      console.error(
        `Cavalry account deletion failed (${code}):`,
        error instanceof Error ? error.message : 'unknown_error'
      );
    }
  });
  return handler(request);
});
