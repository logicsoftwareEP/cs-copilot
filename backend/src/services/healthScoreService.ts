import { AmplitudeSignals } from '../clients/amplitudeClient';
import { HealthTier } from '../types';

export interface HealthScoreResult {
  score: number | null;
  tier: HealthTier | 'unmapped';
  featureAdoption: number | null;
}

/**
 * Compute health score from Amplitude signals using deterministic rules.
 *
 * Scoring breakdown:
 * - DAU/WAU trend (0–40 points)
 * - Feature adoption (0–35 points)
 * - Last login (0–25 points)
 * Total: 0–100 points
 *
 * If all three signals are null, score is null and tier is 'unmapped'.
 */
export function computeScore(signals: AmplitudeSignals): HealthScoreResult {
  const { dauWauTrend, featureAdoption, lastLoginDays } = signals;

  // Check if all signals are null
  if (
    dauWauTrend === null &&
    featureAdoption === null &&
    lastLoginDays === null
  ) {
    return {
      score: null,
      tier: 'unmapped',
      featureAdoption,
    };
  }

  // Score component 1: DAU/WAU trend (0–40 points)
  let dauWauScore = 0;
  if (dauWauTrend !== null) {
    if (dauWauTrend >= 0.1) {
      dauWauScore = 40;
    } else if (dauWauTrend > -0.1) {
      dauWauScore = 25;
    } else if (dauWauTrend >= -0.3) {
      dauWauScore = 10;
    } else {
      dauWauScore = 0;
    }
  }

  // Score component 2: Feature adoption (0–35 points)
  let adoptionScore = 0;
  if (featureAdoption !== null) {
    adoptionScore = Math.round(featureAdoption * 35);
  }

  // Score component 3: Last login (0–25 points)
  let loginScore = 0;
  if (lastLoginDays !== null) {
    if (lastLoginDays < 7) {
      loginScore = 25;
    } else if (lastLoginDays < 14) {
      loginScore = 16;
    } else if (lastLoginDays <= 30) {
      loginScore = 8;
    } else {
      loginScore = 0;
    }
  }

  // Total score
  const score = dauWauScore + adoptionScore + loginScore;

  // Assign tier based on score
  let tier: HealthTier | 'unmapped';
  if (score >= 80) {
    tier = 'healthy';
  } else if (score >= 60) {
    tier = 'watch';
  } else if (score >= 40) {
    tier = 'at-risk';
  } else {
    tier = 'critical';
  }

  return {
    score,
    tier,
    featureAdoption,
  };
}
