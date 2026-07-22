export const ADVISOR_CONVERSATION_SUMMARY_VERSION = 'cavalry.advisor_conversation_summary.v1';

function asString(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return asString(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeStringArray(value, limit = 20) {
  return (Array.isArray(value) ? value : []).map(asString).filter(Boolean).slice(0, limit);
}

export function buildAdvisorConversationSummary(state = {}, recentMessages = []) {
  const normalizedState = state && typeof state === 'object' ? state : {};
  const userMessages = (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((message) => asString(message && message.role) === 'user')
    .map((message) => asString(message && (message.content || message.text)))
    .filter(Boolean)
    .slice(-4);
  return {
    summaryVersion: ADVISOR_CONVERSATION_SUMMARY_VERSION,
    currentGoals: normalizeStringArray(
      normalizedState.currentGoals || normalizedState.userGoals,
      10
    ),
    activeScope: normalizedState.activeScope || null,
    lastQuestion: asString(normalizedState.lastQuestion),
    lastAnswerSummary: asString(normalizedState.lastAnswerSummary),
    pendingQuestion: asString(
      normalizedState.pendingQuestion || normalizedState.pendingClarification
    ),
    explainedConcepts: normalizeStringArray(normalizedState.explainedConcepts, 20),
    deliveredRecommendationIds: normalizeStringArray(
      normalizedState.deliveredRecommendationIds,
      30
    ),
    recentUserMessages: userMessages
  };
}

export function detectAdvisorRepeatedQuestion(question, state = {}) {
  const current = normalizeText(question);
  const previous = normalizeText(state && state.lastQuestion);
  if (!(current && previous)) {
    return {
      repeated: false,
      similarity: 0,
      reason: ''
    };
  }
  if (current === previous) {
    return {
      repeated: true,
      similarity: 1,
      reason: 'exact_repeat'
    };
  }
  const currentTokens = current.split(/\s+/).filter((token) => token.length > 2);
  const previousTokens = previous.split(/\s+/).filter((token) => token.length > 2);
  const previousSet = new Set(previousTokens);
  const overlap = currentTokens.filter((token) => previousSet.has(token)).length;
  const denominator = Math.max(1, Math.min(currentTokens.length, previousTokens.length));
  const similarity = overlap / denominator;
  return {
    repeated: similarity >= 0.72,
    similarity: Number(similarity.toFixed(2)),
    reason: similarity >= 0.72 ? 'high_token_overlap' : ''
  };
}
