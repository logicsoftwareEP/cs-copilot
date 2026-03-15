import { AmplitudeSignals } from '../clients/amplitudeClient';
import { ZendeskTicketData } from '../clients/zendeskClient';
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

// ── Zendesk penalty scoring ─────────────────────────────────────────────────

export interface ZendeskPenaltyResult {
  totalPenalty: number;      // 0 to -20 (capped)
  volumePenalty: number;     // 0 to -8
  openPenalty: number;       // 0 to -7
  severityPenalty: number;   // 0 to -5
  ticketVolume: number;
  openCount: number;
  highPriorityCount: number;
  urgentCount: number;
}

/**
 * Compute a Zendesk support-ticket penalty from ticket data.
 *
 * Pure function — no side-effects. Penalty thresholds:
 *   Volume (last 30d):  0-2 → 0, 3-5 → -3, 6-10 → -5, 11+ → -8
 *   Open (unresolved):  0 → 0, 1-2 → -2, 3-5 → -4, 6+ → -7
 *   Severity (30d):     none → 0, 1-2 high → -2, any urgent OR 3+ high → -5
 *
 * Total is the sum of sub-penalties, capped at -20.
 */
export function computeZendeskPenalty(data: ZendeskTicketData): ZendeskPenaltyResult {
  // ── Volume penalty ──────────────────────────────────────────────────────
  let volumePenalty = 0;
  if (data.ticketVolume >= 11) {
    volumePenalty = -8;
  } else if (data.ticketVolume >= 6) {
    volumePenalty = -5;
  } else if (data.ticketVolume >= 3) {
    volumePenalty = -3;
  }

  // ── Open ticket penalty ─────────────────────────────────────────────────
  let openPenalty = 0;
  if (data.openCount >= 6) {
    openPenalty = -7;
  } else if (data.openCount >= 3) {
    openPenalty = -4;
  } else if (data.openCount >= 1) {
    openPenalty = -2;
  }

  // ── Severity penalty ────────────────────────────────────────────────────
  let severityPenalty = 0;
  if (data.urgentCount >= 1 || data.highPriorityCount >= 3) {
    severityPenalty = -5;
  } else if (data.highPriorityCount >= 1) {
    severityPenalty = -2;
  }

  // ── Total (capped at -20) ──────────────────────────────────────────────
  const rawTotal = volumePenalty + openPenalty + severityPenalty;
  const totalPenalty = Math.max(rawTotal, -20);

  return {
    totalPenalty,
    volumePenalty,
    openPenalty,
    severityPenalty,
    ticketVolume: data.ticketVolume,
    openCount: data.openCount,
    highPriorityCount: data.highPriorityCount,
    urgentCount: data.urgentCount,
  };
}

/**
 * Apply Zendesk penalty to a base health-score result.
 *
 * If zendeskData is null (i.e. Zendesk not configured or API error),
 * the base result is returned unchanged with zendeskPenalty = null.
 *
 * Otherwise the penalty is subtracted from the score (clamped to 0)
 * and the tier is re-derived from the adjusted score.
 */
export function applyZendeskPenalty(
  baseResult: HealthScoreResult,
  zendeskData: ZendeskTicketData | null
): HealthScoreResult & { zendeskPenalty: number | null } {
  if (zendeskData === null) {
    return { ...baseResult, zendeskPenalty: null };
  }

  const { totalPenalty } = computeZendeskPenalty(zendeskData);

  // If the base score is null (unmapped account), penalty cannot be applied
  if (baseResult.score === null) {
    return { ...baseResult, zendeskPenalty: totalPenalty };
  }

  const adjustedScore = Math.max(0, baseResult.score + totalPenalty);

  // Re-derive tier from adjusted score
  let tier: HealthTier | 'unmapped';
  if (adjustedScore >= 80) {
    tier = 'healthy';
  } else if (adjustedScore >= 60) {
    tier = 'watch';
  } else if (adjustedScore >= 40) {
    tier = 'at-risk';
  } else {
    tier = 'critical';
  }

  return {
    ...baseResult,
    score: adjustedScore,
    tier,
    zendeskPenalty: totalPenalty,
  };
}
