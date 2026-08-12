// Near-miss name matching so an unrecognized reference comes back with candidates instead of a
// dead end; the model can then retry with the intended ID rather than asking the user to retype.

import { asArray, asText, textKey } from './cavalry-assistant-tool-definitions.js';

function entityTokens(value) {
  return textKey(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function fuzzyEntityScore(candidateKey, referenceKey) {
  if (!candidateKey || !referenceKey) return 0;
  if (candidateKey.startsWith(referenceKey) || referenceKey.startsWith(candidateKey)) return 0.9;
  if (candidateKey.includes(referenceKey) || referenceKey.includes(candidateKey)) return 0.75;
  const candidateTokens = entityTokens(candidateKey);
  const referenceTokens = entityTokens(referenceKey);
  if (!candidateTokens.length || !referenceTokens.length) return 0;
  const shared = candidateTokens.filter((token) => referenceTokens.includes(token)).length;
  const overlap = shared / Math.max(candidateTokens.length, referenceTokens.length);
  return overlap >= 0.5 ? 0.5 + overlap * 0.2 : 0;
}

export function fuzzyEntitySuggestions(items, reference, names = ['name']) {
  const referenceKey = textKey(reference);
  if (referenceKey.length < 2) return '';
  const scored = [];
  for (const item of asArray(items)) {
    let best = 0;
    for (const name of names) {
      const score = fuzzyEntityScore(textKey(item && item[name]), referenceKey);
      if (score > best) best = score;
    }
    if (best > 0) scored.push({ item, score: best });
  }
  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ item }) => entitySuggestionLabel(item))
    .join(', ');
}

export function entitySuggestionLabel(item) {
  const label =
    asText(item && item.name) || asText(item && item.description) || asText(item && item.id);
  return `${label} (${asText(item && item.id)})`;
}
