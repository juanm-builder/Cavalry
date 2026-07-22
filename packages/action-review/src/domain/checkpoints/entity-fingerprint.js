import { sha256Hex } from '../fingerprints/sha256.js';

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key]))
      .join(',') +
    '}'
  );
}

export function fingerprintEntity(value) {
  return sha256Hex(stableStringify(clonePlain(value)));
}

export function cloneEntity(value) {
  return clonePlain(value);
}

export function fingerprintWorkbookCore(workbook) {
  const clone = clonePlain(workbook || {});
  delete clone.externalDraftGroups;
  delete clone.externalApiAuditEvents;
  delete clone.externalApiIdempotencyRecords;
  delete clone.aiDrafts;
  delete clone.advisorDraftGroups;
  delete clone.checkpoints;
  delete clone.checkpointAuditEvents;
  delete clone.checkpointIdempotencyRecords;
  return fingerprintEntity(clone);
}
