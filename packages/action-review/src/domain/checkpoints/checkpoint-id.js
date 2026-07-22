function pad(value) {
  return String(value).padStart(2, '0');
}

export function createCheckpointId({ now, createId } = {}) {
  if (typeof createId === 'function') {
    return createId('cp');
  }
  const date = now ? new Date(now()) : new Date();
  const stamp = [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join('_');
  return 'cp_' + stamp + '_' + Math.random().toString(36).slice(2, 8);
}

export function isSafeCheckpointId(value) {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(String(value || '').trim());
}

export function getCheckpointReviewUrl(checkpointId) {
  return checkpointId ? 'cavalry://checkpoints/' + encodeURIComponent(checkpointId) : '';
}

export function getCheckpointIdFromReviewUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'cavalry:' || parsed.hostname !== 'checkpoints') return '';
    const id = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] || '');
    return isSafeCheckpointId(id) ? id : '';
  } catch (_error) {
    return '';
  }
}
