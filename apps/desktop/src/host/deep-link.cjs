// Review IDs are validated before a deep link can influence renderer navigation.
function asString(value) {
  return String(value == null ? '' : value).trim();
}

function isSafeReviewId(value) {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(asString(value));
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
  getCavalryDeepLinkCommand
};
