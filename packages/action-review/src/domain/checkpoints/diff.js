import { cloneEntity, fingerprintEntity } from './entity-fingerprint.js';

// Both fingerprints are recorded so rollback can refuse stale or externally changed entities.
export function buildCheckpointDiff(before, after) {
  const beforeValue = before == null ? null : cloneEntity(before);
  const afterValue = after == null ? null : cloneEntity(after);
  return {
    before: beforeValue,
    after: afterValue,
    before_fingerprint: beforeValue == null ? null : fingerprintEntity(beforeValue),
    after_fingerprint: afterValue == null ? null : fingerprintEntity(afterValue)
  };
}
