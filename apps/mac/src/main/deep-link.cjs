// Review IDs are validated before a deep link can influence renderer navigation.
function asString(value) {
  return String(value == null ? '' : value).trim();
}

function isSafeReviewId(value) {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(asString(value));
}

function boundedPrintable(value, maximum) {
  const text = asString(value);
  return text.length > 0 && text.length <= maximum && /^[\x20-\x7e]+$/.test(text) ? text : '';
}

function getCavalryAuthCallback(rawUrl) {
  try {
    const parsed = new URL(asString(rawUrl));
    if (
      parsed.protocol !== 'cavalry:' ||
      parsed.hostname !== 'auth' ||
      !['/callback', '/callback/'].includes(parsed.pathname) ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.hash
    ) {
      return null;
    }
    const parameterNames = [...parsed.searchParams.keys()].map((name) => name.toLowerCase());
    const includesCredential = parameterNames.some((name) =>
      [
        'access_token',
        'refresh_token',
        'id_token',
        'provider_token',
        'provider_refresh_token',
        'token'
      ].includes(name)
    );
    const codeValues = parsed.searchParams.getAll('code');
    const errorValues = [
      ...parsed.searchParams.getAll('error'),
      ...parsed.searchParams.getAll('error_code')
    ];
    if (
      includesCredential ||
      codeValues.length > 1 ||
      errorValues.length > 1 ||
      (codeValues.length && errorValues.length)
    ) {
      return null;
    }
    const errorCode = boundedPrintable(
      parsed.searchParams.get('error_code') || parsed.searchParams.get('error'),
      64
    );
    if (errorCode) {
      return {
        type: 'auth-callback',
        ok: false,
        errorCode,
        errorMessage:
          boundedPrintable(parsed.searchParams.get('error_description'), 240) ||
          'Cloud sign-in was cancelled.'
      };
    }
    const code = boundedPrintable(parsed.searchParams.get('code'), 4096);
    return code ? { type: 'auth-callback', ok: true, code } : null;
  } catch (_error) {
    return null;
  }
}

function findCavalryDeepLinkArgument(args) {
  return (
    (Array.isArray(args) ? args : []).find((value) => {
      const text = asString(value);
      return text.length <= 8192 && /^cavalry:\/\//i.test(text);
    }) || ''
  );
}

function getCavalryDeepLinkCommand(rawUrl) {
  try {
    const parsed = new URL(asString(rawUrl));
    if (parsed.protocol !== 'cavalry:') {
      return null;
    }
    if (parsed.hostname === 'draft-groups') {
      const draftGroupId = decodeURIComponent(
        parsed.pathname.replace(/^\/+/, '').split('/')[0] || ''
      );
      return isSafeReviewId(draftGroupId) ? { type: 'open-draft-group', draftGroupId } : null;
    }
    if (parsed.hostname === 'checkpoints') {
      const checkpointId = decodeURIComponent(
        parsed.pathname.replace(/^\/+/, '').split('/')[0] || ''
      );
      return isSafeReviewId(checkpointId) ? { type: 'open-checkpoint', checkpointId } : null;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

module.exports = {
  findCavalryDeepLinkArgument,
  getCavalryAuthCallback,
  getCavalryDeepLinkCommand
};
