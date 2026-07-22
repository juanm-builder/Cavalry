import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

export function generateCompanionBetaToken(bytes = 32) {
  return 'cavb_' + randomBytes(bytes).toString('base64url');
}

export function hashCompanionBetaToken(token) {
  const raw = asString(token);
  if (!raw) {
    return '';
  }
  return 'sha256:' + createHash('sha256').update(raw).digest('hex');
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(asString(left));
  const b = Buffer.from(asString(right));
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function verifyCompanionBetaToken(token, options = {}) {
  const rawToken = asString(token);
  if (!rawToken) {
    return false;
  }
  const configuredHash = asString(options.hash || process.env.CAVALRY_COMPANION_BETA_API_KEY_HASH);
  if (configuredHash) {
    return constantTimeEqual(hashCompanionBetaToken(rawToken), configuredHash);
  }
  const configuredRaw = asString(options.raw || process.env.CAVALRY_COMPANION_BETA_API_KEY);
  if (!configuredRaw) {
    return false;
  }
  return constantTimeEqual(rawToken, configuredRaw);
}

export function hasCompanionBetaTokenConfig(options = {}) {
  return !!asString(
    options.hash ||
      process.env.CAVALRY_COMPANION_BETA_API_KEY_HASH ||
      options.raw ||
      process.env.CAVALRY_COMPANION_BETA_API_KEY
  );
}
