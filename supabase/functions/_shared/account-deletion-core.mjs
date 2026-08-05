function response(status, body) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

function appleIdentitySubject(user) {
  const identity = Array.isArray(user && user.identities)
    ? user.identities.find((candidate) => candidate && candidate.provider === 'apple')
    : null;
  const appMetadata =
    user && user.app_metadata && typeof user.app_metadata === 'object' ? user.app_metadata : {};
  const metadataProviders = [
    appMetadata.provider,
    ...(Array.isArray(appMetadata.providers) ? appMetadata.providers : [])
  ].map((provider) =>
    String(provider || '')
      .trim()
      .toLowerCase()
  );
  if (!identity) {
    return { linked: metadataProviders.includes('apple'), subject: '' };
  }
  const identityData =
    identity.identity_data && typeof identity.identity_data === 'object'
      ? identity.identity_data
      : {};
  return { linked: true, subject: String(identityData.sub || '').trim() };
}

export async function exchangeAndRevokeAppleCode(
  { fetch: fetchImplementation, verifyIdToken, clientId, clientSecret },
  authorizationCode,
  expectedSubject
) {
  const exchange = await fetchImplementation('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code'
    })
  });
  const token = await exchange.json().catch(() => null);
  if (!exchange.ok || !(token && typeof token.id_token === 'string')) {
    throw new Error('apple_code_exchange_failed');
  }

  const verified = await verifyIdToken(token.id_token, clientId);
  if (String((verified && verified.sub) || '') !== expectedSubject) {
    throw new Error('apple_identity_mismatch');
  }

  const refreshToken = typeof token.refresh_token === 'string' ? token.refresh_token : '';
  const accessToken = typeof token.access_token === 'string' ? token.access_token : '';
  const revocationToken = refreshToken || accessToken;
  if (!revocationToken) throw new Error('apple_revocation_token_missing');

  const revocation = await fetchImplementation('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token: revocationToken,
      token_type_hint: refreshToken ? 'refresh_token' : 'access_token'
    })
  });
  if (!revocation.ok) throw new Error('apple_token_revocation_failed');
}

export function resolveSupabaseAdminKey(readEnvironment) {
  const encodedSecretKeys = String(readEnvironment('SUPABASE_SECRET_KEYS') || '').trim();
  if (encodedSecretKeys) {
    try {
      const secretKeys = JSON.parse(encodedSecretKeys);
      if (secretKeys && typeof secretKeys === 'object' && !Array.isArray(secretKeys)) {
        const defaultSecretKey = String(secretKeys.default || '').trim();
        if (defaultSecretKey) return defaultSecretKey;
      }
    } catch (_error) {
      // Fall back to the legacy key while projects migrate to Supabase secret keys.
    }
  }

  return String(readEnvironment('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
}

export function createAccountDeletionHandler(dependencies) {
  const {
    authenticate,
    deleteUser,
    listAttachmentPaths,
    logError = () => {},
    removeAttachmentPaths,
    revokeAppleAuthorization
  } = dependencies;

  return async function handleAccountDeletion(request) {
    if (request.method !== 'POST') {
      return response(405, { error: 'method_not_allowed' });
    }
    const authorization = String(request.headers.get('Authorization') || '');
    const accessToken = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken || accessToken.length > 16_384) {
      return response(401, { error: 'authentication_required' });
    }

    let user = null;
    try {
      user = await authenticate(accessToken);
    } catch (_error) {
      user = null;
    }
    if (!(user && user.id)) {
      return response(401, { error: 'authentication_required' });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (_error) {
      return response(400, { error: 'invalid_request' });
    }
    if (!(payload && payload.confirmation === 'DELETE')) {
      return response(400, { error: 'deletion_confirmation_required' });
    }

    let manualAppleRevocationRequired = false;
    const appleIdentity = appleIdentitySubject(user);
    if (appleIdentity.linked) {
      const authorizationCode = String(payload.appleAuthorizationCode || '').trim();
      if (!authorizationCode || authorizationCode.length > 4_096 || !appleIdentity.subject) {
        manualAppleRevocationRequired = true;
      } else {
        try {
          await revokeAppleAuthorization(authorizationCode, appleIdentity.subject);
        } catch (error) {
          manualAppleRevocationRequired = true;
          logError('apple_token_revocation_failed', error);
        }
      }
    }

    let storagePaths;
    try {
      storagePaths = (await listAttachmentPaths(user.id))
        .map((path) => String(path || '').trim())
        .filter((path) => path.startsWith(`${user.id}/`));
      await removeAttachmentPaths(storagePaths);
    } catch (error) {
      logError('account_data_deletion_failed', error);
      return response(500, { error: 'account_data_deletion_failed' });
    }

    try {
      await deleteUser(user.id);
    } catch (error) {
      logError('account_deletion_failed', error);
      return response(500, { error: 'account_deletion_failed' });
    }
    return response(200, { deleted: true, manualAppleRevocationRequired });
  };
}
