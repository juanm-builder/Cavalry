// Owns the authenticated user's private Cavalry display name behind Supabase RLS.
'use strict';

const { asString } = require('./cloud-config.cjs');

const MAX_PROFILE_NAME_LENGTH = 80;

function normalizeProfileName(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
}

function validateProfileName(value) {
  const name = normalizeProfileName(value);
  if (!name) {
    return { ok: false, code: 'profile_name_required', error: 'Enter a profile name.' };
  }
  if (Array.from(name).length > MAX_PROFILE_NAME_LENGTH) {
    return {
      ok: false,
      code: 'profile_name_too_long',
      error: `Profile names can be at most ${MAX_PROFILE_NAME_LENGTH} characters.`
    };
  }
  return { ok: true, name };
}

function createCloudProfileController({ auth } = {}) {
  function signedInContext() {
    const authState = auth && typeof auth.getState === 'function' ? auth.getState() : null;
    const client = auth && typeof auth.getClient === 'function' ? auth.getClient() : null;
    const user = authState && authState.user;
    return auth &&
      typeof auth.isSignedIn === 'function' &&
      auth.isSignedIn() &&
      client &&
      user &&
      user.id
      ? { client, user }
      : null;
  }

  async function getProfile() {
    const context = signedInContext();
    if (!context) {
      return { ok: false, code: 'not_signed_in', error: 'Sign in to Cavalry Cloud first.' };
    }
    try {
      const result = await context.client
        .from('profiles')
        .select('display_name')
        .eq('user_id', context.user.id)
        .maybeSingle();
      if (result.error) throw result.error;
      return {
        ok: true,
        profile: {
          name: asString(result.data && result.data.display_name, MAX_PROFILE_NAME_LENGTH)
        }
      };
    } catch (_error) {
      return {
        ok: false,
        code: 'profile_load_failed',
        error: 'Your Cavalry profile name could not be loaded.'
      };
    }
  }

  async function updateProfile(payload = {}) {
    const context = signedInContext();
    if (!context) {
      return { ok: false, code: 'not_signed_in', error: 'Sign in to Cavalry Cloud first.' };
    }
    const validated = validateProfileName(payload.name);
    if (!validated.ok) return validated;
    try {
      const result = await context.client
        .from('profiles')
        .upsert(
          { user_id: context.user.id, display_name: validated.name },
          { onConflict: 'user_id' }
        )
        .select('display_name')
        .single();
      if (result.error) throw result.error;
      const name = asString(result.data && result.data.display_name, MAX_PROFILE_NAME_LENGTH);
      if (!name) throw new Error('invalid_profile');
      return { ok: true, profile: { name } };
    } catch (_error) {
      return {
        ok: false,
        code: 'profile_update_failed',
        error: 'Your Cavalry profile name could not be updated.'
      };
    }
  }

  return { getProfile, updateProfile };
}

module.exports = {
  MAX_PROFILE_NAME_LENGTH,
  createCloudProfileController,
  normalizeProfileName,
  validateProfileName
};
