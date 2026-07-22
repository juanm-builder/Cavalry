import { ADVISOR_PROVIDER_KIND } from './model-capabilities.js';

export const ADVISOR_GENERATION_PROFILE_VERSION = 'cavalry.advisor_generation_profile.v1';

function asString(value) {
  return String(value || '').trim();
}

function isFullTransactionList(summary) {
  const packet = summary && summary.data_packets && summary.data_packets.transaction_list;
  return !!(packet && packet.mode === 'full');
}

function isFullCategoryInventory(summary) {
  const packet = summary && summary.data_packets && summary.data_packets.category_inventory;
  return !!(packet && packet.selection && packet.selection.policy === 'full_category_inventory');
}

function getDefaultMaxTokens({ summary, turn, responseMode, providerKind, capabilityProfile }) {
  if (isFullTransactionList(summary) || isFullCategoryInventory(summary)) {
    return Math.min(
      Number(capabilityProfile && capabilityProfile.maxReliableOutputTokens) || 2600,
      2600
    );
  }
  if (responseMode === 'prose' && turn && turn.responseStyle === 'breakdown') {
    return Math.min(
      Number(capabilityProfile && capabilityProfile.maxReliableOutputTokens) || 1800,
      1800
    );
  }
  if (providerKind === ADVISOR_PROVIDER_KIND.LOCAL_MODEL) {
    return Math.min(
      Number(capabilityProfile && capabilityProfile.maxReliableOutputTokens) || 1200,
      1800
    );
  }
  return 1200;
}

function getPurposeForIntent(intent) {
  const target = asString(intent);
  if (target === 'transaction_list') {
    return 'transaction_listing';
  }
  if (target === 'categorization_review' || target === 'category_inventory') {
    return 'categorization_review';
  }
  if (target === 'advisor_brain') {
    return 'draft_proposal';
  }
  if (
    target === 'spending_analysis' ||
    target === 'transaction_analysis' ||
    target === 'net_worth_impact_transactions' ||
    target === 'account_analysis'
  ) {
    return 'financial_explanation';
  }
  return 'financial_answer';
}

export function buildAdvisorGenerationProfile({
  turn,
  summary,
  responseMode,
  capabilityProfile
} = {}) {
  const providerKind =
    capabilityProfile && capabilityProfile.providerKind
      ? capabilityProfile.providerKind
      : ADVISOR_PROVIDER_KIND.RULES;
  const mode =
    responseMode || (capabilityProfile && capabilityProfile.preferredResponseMode) || 'rules';
  const targetIntent = asString(turn && (turn.targetIntent || turn.intent));
  const purpose = getPurposeForIntent(targetIntent);
  const proseMode = mode === 'prose';
  return {
    profile_version: ADVISOR_GENERATION_PROFILE_VERSION,
    purpose,
    provider_kind: providerKind,
    response_mode: mode,
    temperature: providerKind === ADVISOR_PROVIDER_KIND.RULES ? 0 : proseMode ? 0.25 : 0.1,
    retryTemperature: 0.05,
    topP: 0.9,
    maxTokens:
      providerKind === ADVISOR_PROVIDER_KIND.RULES
        ? 0
        : getDefaultMaxTokens({
            summary,
            turn,
            responseMode: mode,
            providerKind,
            capabilityProfile
          })
  };
}
