import { AmplitudeSignals } from '../clients/amplitudeClient';
import { HealthTier } from '../types';

export interface HealthScoreResult {
  score: number | null;
  tier: HealthTier | 'unmapped';
  licenseUtilization: number | null;
  monthlyActiveUsers: number | null;
}

/**
 * Compute health score from Amplitude signals and account license count.
 *
 * Scoring breakdown:
 * - DAU/WAU trend    (0–40 points) — same bands regardless of licenses
 * - License utilisation (0–35 points) — MAU ÷ licenses; omitted when licenses not set
 * - Last login       (0–25 points)
 *
 * Normalisation:
 *   maxPossible = licenses !== null ? 100 : 65
 *   finalScore  = Math.round(rawScore / maxPossible × 100)
 *
 * This ensures the score is always expressed as a percentage of available signals.
 * When licenses are not yet entered, the score is normalised out of 65 (max from
 * the two Amplitude signals we can still compute).
 *
 * Returns score=null and tier='unmapped' only when ALL Amplitude signals are null.
 */
export function computeScore(
  signals: AmplitudeSignals,
  licenses: number | null
): HealthScoreResult {
  const { dauWauTrend, monthlyActiveUsers, lastLoginDays } = signals;

  // If all Amplitude signals are null there is nothing to score
  if (dauWauTrend === null && monthlyActiveUsers === null && lastLoginDays === null) {
    return {
      score: null,
      tier: 'unmapped',
      licenseUtilization: null,
      monthlyActiveUsers: null,
    };
  }

  // ── Component 1: DAU/WAU trend (0–40 points) ──────────────────────────────
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

  // ── Component 2: License utilisation (0–35 points) ───────────────────────
  let licenseUtilization: number | null = null;
  let licenseScore = 0;

  if (licenses !== null && licenses > 0 && monthlyActiveUsers !== null) {
    licenseUtilization = Math.min(1, monthlyActiveUsers / licenses);

    if (licenseUtilization >= 0.8) {
      licenseScore = 35;
    } else if (licenseUtilization >= 0.6) {
      licenseScore = 25;
    } else if (licenseUtilization >= 0.4) {
      licenseScore = 15;
    } else if (licenseUtilization >= 0.2) {
      licenseScore = 5;
    } else {
      licenseScore = 0;
    }
  }

  // ── Component 3: Last login (0–25 points) ────────────────────────────────
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

  // ── Normalise ─────────────────────────────────────────────────────────────
  const rawScore = dauWauScore + licenseScore + loginScore;
  const maxPossible = licenses !== null ? 100 : 65;
  const score = Math.round((rawScore / maxPossible) * 100);

  // ── Tier ──────────────────────────────────────────────────────────────────
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
    licenseUtilization,
    monthlyActiveUsers,
  };
}
