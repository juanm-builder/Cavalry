import { describe, expect, it } from 'vitest';
import {
  buildProviderScorecard,
  scoreUserFacingPolish
} from '../../scripts/advisor-live-smoke.mjs';

function makeTurn(overrides = {}) {
  return Object.assign(
    {
      finalVisibleMessage:
        'I checked the verified Cavalry facts and found useful review items. Nothing changed.',
      elapsedMs: 10,
      modelAttempted: false,
      modelSucceeded: false,
      fallbackUsed: false,
      skeletonUsed: false,
      safety: {
        directWorkbookMutation: false,
        modelOutputAcceptedAsMutation: false,
        writesRequireReview: true
      },
      modelDiagnostics: {
        fallbackCopyUserVisible: false,
        modelFailureCopyVisible: false
      }
    },
    overrides
  );
}

describe('advisor provider certification scorecard', () => {
  it('does not award perfect polish when fallback copy is visible', () => {
    const score = scoreUserFacingPolish(
      'I had trouble generating the polished Advisor answer, so I am showing verified copy.',
      {
        fallbackCopyUserVisible: true
      }
    );

    expect(score).toBeLessThan(5);
  });

  it('separates model contribution from safe recovery', () => {
    const scorecard = buildProviderScorecard(
      'broad_transaction_review_fallback',
      [
        makeTurn({
          modelAttempted: true,
          modelSucceeded: false,
          fallbackUsed: true,
          skeletonUsed: true,
          modelDiagnostics: {
            fallbackCopyUserVisible: true,
            modelFailureCopyVisible: false
          }
        })
      ],
      {
        usefulRecovery: true,
        draftCorrectness: true
      }
    );

    expect(scorecard).toMatchObject({
      safety: 'pass',
      draftCorrectness: 'pass',
      recoveryUsefulness: 'pass',
      modelContributionAccepted: 'no'
    });
    expect(scorecard.userFacingPolish.score).toBeLessThan(5);
  });

  it('marks accepted model answers separately from draft safety', () => {
    const scorecard = buildProviderScorecard(
      'categorization_review_baseline',
      [
        makeTurn({
          modelAttempted: true,
          modelSucceeded: true,
          fallbackUsed: false,
          skeletonUsed: false
        })
      ],
      {
        usefulRecovery: true,
        draftCorrectness: true
      }
    );

    expect(scorecard.modelContributionAccepted).toBe('yes');
    expect(scorecard.safety).toBe('pass');
  });
});
