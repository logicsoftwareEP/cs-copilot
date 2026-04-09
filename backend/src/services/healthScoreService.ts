import { AmplitudeSignals } from '../clients/amplitudeClient';
import { ZendeskTicketData } from '../clients/zendeskClient';
import { IntercomAggregated } from '../services/intercomStore';
import { ChurnScore, HealthTier } from '../types';

// Component maximums — used for normalisation
const LICENSE_MAX = 60;
const ACTIVITY_MAX = 25;
const FEATURE_MAX = 15;

function scoreToTier(score: number): HealthTier {
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'watch';
  if (score >= 40) return 'at-risk';
  return 'critical';
}

export interface HealthScoreResult {
  score: number | null;
  tier: HealthTier | 'unmapped';
  licenseUtilization: number | null;
  monthlyActiveUsers: number | null;
  featuresUsed: number | null;
  featureDetails: Record<string, boolean> | null;
}

/**
 * Compute health score from Amplitude signals and account license count.
 *
 * Scoring breakdown:
 * - License utilisation (0–60 points) — MAU ÷ licenses; omitted when licenses not set
 * - Activity trend      (0–25 points) — DAU/WAU trend; same bands regardless of licenses
 * - Feature adoption    (0–15 points) — ratio of feature categories used in last 30d
 *
 * Normalisation:
 *   maxPossible = licenses !== null ? 100 : 40
 *   finalScore  = Math.round(rawScore / maxPossible × 100)
 *
 * This ensures the score is always expressed as a percentage of available signals.
 * When licenses are not yet entered, the score is normalised out of 40 (max from
 * the two Amplitude signals we can still compute).
 *
 * Returns score=null and tier='unmapped' only when ALL Amplitude signals are null.
 */
export function computeScore(
  signals: AmplitudeSignals,
  licenses: number | null
): HealthScoreResult {
  const { dauWauTrend, monthlyActiveUsers, featureBreadth } = signals;

  // If all Amplitude signals are null there is nothing to score
  if (dauWauTrend === null && monthlyActiveUsers === null && featureBreadth === null) {
    return {
      score: null,
      tier: 'unmapped',
      licenseUtilization: null,
      monthlyActiveUsers: null,
      featuresUsed: null,
      featureDetails: null,
    };
  }

  // ── Component 1: License utilisation (0–60 points) ───────────────────────
  let licenseUtilization: number | null = null;
  let licenseScore = 0;

  if (licenses !== null && licenses > 0 && monthlyActiveUsers !== null) {
    licenseUtilization = Math.min(1, monthlyActiveUsers / licenses);

    if (licenseUtilization >= 0.8) {
      licenseScore = 60;
    } else if (licenseUtilization >= 0.6) {
      licenseScore = 45;
    } else if (licenseUtilization >= 0.4) {
      licenseScore = 30;
    } else if (licenseUtilization >= 0.2) {
      licenseScore = 15;
    } else {
      licenseScore = 0;
    }
  }

  // ── Component 2: Activity trend (0–25 points) ──────────────────────────────
  let dauWauScore = 0;
  if (dauWauTrend !== null) {
    if (dauWauTrend >= 0.1) {
      dauWauScore = 25;
    } else if (dauWauTrend > -0.1) {
      dauWauScore = 15;
    } else if (dauWauTrend >= -0.3) {
      dauWauScore = 6;
    } else {
      dauWauScore = 0;
    }
  }

  // ── Component 3: Feature adoption (0–15 points) ────────────────────────────
  let featureScore = 0;
  if (featureBreadth !== null && featureBreadth.total > 0) {
    const ratio = featureBreadth.used.length / featureBreadth.total;
    if (ratio >= 0.75) {
      featureScore = 15;
    } else if (ratio >= 0.50) {
      featureScore = 10;
    } else if (ratio >= 0.25) {
      featureScore = 5;
    } else {
      featureScore = 0;
    }
  }

  // ── Normalise ─────────────────────────────────────────────────────────────
  const rawScore = dauWauScore + licenseScore + featureScore;
  const maxPossible = licenses !== null
    ? LICENSE_MAX + ACTIVITY_MAX + FEATURE_MAX
    : ACTIVITY_MAX + FEATURE_MAX;
  const score = Math.round((rawScore / maxPossible) * 100);

  const tier = scoreToTier(score);

  return {
    score,
    tier,
    licenseUtilization,
    monthlyActiveUsers,
    featuresUsed: featureBreadth ? featureBreadth.used.length : null,
    featureDetails: null, // populated by caller with full category map
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

// ── Intercom penalty scoring ─────────────────────────────────────────────────

export interface IntercomPenaltyResult {
  totalPenalty: number;    // 0 to -12
  openPenalty: number;     // 0 to -7
  slowPenalty: number;     // 0 to -5
  openCount: number;
  avgResponseTime: number;
}

/**
 * Compute an Intercom support penalty from aggregated conversation data.
 *
 * Penalty thresholds:
 *   Open conversations:  0 → 0, 1-2 → -2, 3-5 → -4, 6+ → -7
 *   Slow response:       avgResponseTime > 86400s AND volume >= 3 → -5, else 0
 *
 * Total is the sum of sub-penalties (max is -12, no additional cap needed).
 */
export function computeIntercomPenalty(data: IntercomAggregated): IntercomPenaltyResult {
  // ── Open conversation penalty ──────────────────────────────────────────
  let openPenalty = 0;
  if (data.openCount >= 6) {
    openPenalty = -7;
  } else if (data.openCount >= 3) {
    openPenalty = -4;
  } else if (data.openCount >= 1) {
    openPenalty = -2;
  }

  // ── Slow response penalty ──────────────────────────────────────────────
  let slowPenalty = 0;
  if (data.avgResponseTime > 86400 && data.conversationVolume >= 3) {
    slowPenalty = -5;
  }

  const totalPenalty = openPenalty + slowPenalty;

  return {
    totalPenalty,
    openPenalty,
    slowPenalty,
    openCount: data.openCount,
    avgResponseTime: data.avgResponseTime,
  };
}

// ── Intercom bonus scoring ───────────────────────────────────────────────────

export interface IntercomBonusResult {
  totalBonus: number;           // 0 to +10
  quickResolutionBonus: number; // 0 to +4
  aiBonus: number;              // 0 to +3
  engagementBonus: number;      // 0 to +3
}

/**
 * Compute an Intercom engagement bonus from aggregated conversation data.
 *
 * Bonus thresholds:
 *   Quick resolutions: 0 → 0, >=1 → +1, >=3 → +2, >=5 → +4
 *   AI handled:        0 → 0, >=1 → +1, >=3 → +3
 *   Engagement:        volume >= 3 AND openCount <= 1 → +3, else 0
 *
 * Total is capped at +10.
 */
export function computeIntercomBonus(data: IntercomAggregated): IntercomBonusResult {
  // ── Quick resolution bonus ──────────────────────────────────────────────
  let quickResolutionBonus = 0;
  if (data.quickResolutions >= 5) {
    quickResolutionBonus = 4;
  } else if (data.quickResolutions >= 3) {
    quickResolutionBonus = 2;
  } else if (data.quickResolutions >= 1) {
    quickResolutionBonus = 1;
  }

  // ── AI handled bonus ────────────────────────────────────────────────────
  let aiBonus = 0;
  if (data.aiHandled >= 3) {
    aiBonus = 3;
  } else if (data.aiHandled >= 1) {
    aiBonus = 1;
  }

  // ── Engagement bonus ────────────────────────────────────────────────────
  let engagementBonus = 0;
  if (data.conversationVolume >= 3 && data.openCount <= 1) {
    engagementBonus = 3;
  }

  const totalBonus = Math.min(10, quickResolutionBonus + aiBonus + engagementBonus);

  return {
    totalBonus,
    quickResolutionBonus,
    aiBonus,
    engagementBonus,
  };
}

// ── CX Score penalty/bonus ──────────────────────────────────────────────────

export interface CxScoreResult {
  cxScorePenalty: number;
  cxScoreBonus: number;
  netCxScore: number;
  avgCxScore: number | null;
  cxScoreCount: number;
}

/**
 * Compute a CX Score penalty/bonus from aggregated Intercom conversation rating data.
 *
 * Minimum 3 rated conversations to activate (else all zeros).
 * Penalty: avg < 2.0 → -8, < 2.5 → -5, < 3.0 → -3, else 0
 * Bonus: avg >= 4.5 → +5, >= 4.0 → +3, >= 3.5 → +1, else 0
 * netCxScore = penalty + bonus
 */
export function computeCxScorePenaltyBonus(data: IntercomAggregated): CxScoreResult {
  const { avgCxScore, cxScoreCount } = data;

  // Minimum 3 rated conversations to activate
  if (avgCxScore == null || cxScoreCount < 3) {
    return { cxScorePenalty: 0, cxScoreBonus: 0, netCxScore: 0, avgCxScore, cxScoreCount };
  }

  // ── Penalty ───────────────────────────────────────────────────────────
  let cxScorePenalty = 0;
  if (avgCxScore < 2.0) {
    cxScorePenalty = -8;
  } else if (avgCxScore < 2.5) {
    cxScorePenalty = -5;
  } else if (avgCxScore < 3.0) {
    cxScorePenalty = -3;
  }

  // ── Bonus ─────────────────────────────────────────────────────────────
  let cxScoreBonus = 0;
  if (avgCxScore >= 4.5) {
    cxScoreBonus = 5;
  } else if (avgCxScore >= 4.0) {
    cxScoreBonus = 3;
  } else if (avgCxScore >= 3.5) {
    cxScoreBonus = 1;
  }

  const netCxScore = cxScorePenalty + cxScoreBonus;

  return { cxScorePenalty, cxScoreBonus, netCxScore, avgCxScore, cxScoreCount };
}

// ── Score row builder ───────────────────────────────────────────────────────

export interface ScoreRowInput {
  accountId: string;
  date: string;
  signals: AmplitudeSignals | null;
  licenses: number | null;
  featureEvents: { category: string }[];
  zendeskData: ZendeskTicketData | null;
  intercomData: IntercomAggregated | null;
  previousScore: number | null;
  aliasStatus: 'valid' | 'not-found' | null;
}

/**
 * Build a complete ChurnScore row from inputs. Handles all 4 patterns:
 *   1. Unmapped (no alias): score=null, tier='unmapped'
 *   2. Alias not found: score=null, tier='unmapped', aliasStatus='not-found'
 *   3. Successful scoring: full computation
 *   4. Error fallback: score=null (signals=null)
 *
 * Pure function — no side effects, no storage calls.
 */
export function buildScoreRow(input: ScoreRowInput): ChurnScore {
  const { accountId, date, signals, licenses, featureEvents, zendeskData, intercomData, previousScore, aliasStatus } = input;
  const computedAt = new Date().toISOString();

  // Patterns 1, 2, 4: no signals or unmapped
  if (!signals) {
    const unmappedBase: HealthScoreResult = {
      score: null, tier: 'unmapped',
      licenseUtilization: null, monthlyActiveUsers: null,
      featuresUsed: null, featureDetails: null,
    };
    const adjusted = applyAllPenalties(unmappedBase, zendeskData, intercomData);
    return {
      accountId, date, score: null, tier: 'unmapped',
      dauWauTrend: null, monthlyActiveUsers: null, licenseUtilization: null,
      featuresUsed: null, featureDetails: null, scoreDelta: null, computedAt,
      zendeskPenalty: adjusted.zendeskPenalty,
      zendeskDetails: adjusted.zendeskDetails ? JSON.stringify(adjusted.zendeskDetails) : null,
      intercomPenalty: adjusted.intercomPenalty,
      intercomBonus: adjusted.intercomBonus,
      intercomDetails: intercomData ? JSON.stringify({ ...adjusted.intercomPenaltyDetails, ...adjusted.intercomBonusDetails, ...adjusted.cxScoreDetails, conversationVolume: intercomData.conversationVolume, quickResolutions: intercomData.quickResolutions, aiHandled: intercomData.aiHandled }) : null,
      cxScorePenalty: adjusted.cxScorePenalty,
      cxScoreBonus: adjusted.cxScoreBonus,
      aliasStatus,
    };
  }

  // Pattern 3: successful scoring
  const baseResult = computeScore(signals, licenses);
  const adjusted = applyAllPenalties(baseResult, zendeskData, intercomData);

  let featureDetailsJson: string | null = null;
  if (signals.featureBreadth) {
    const details: Record<string, boolean> = {};
    for (const fe of featureEvents) {
      details[fe.category] = signals.featureBreadth.used.includes(fe.category);
    }
    featureDetailsJson = JSON.stringify(details);
  }

  let scoreDelta: number | null = null;
  if (previousScore !== null && adjusted.score !== null) {
    scoreDelta = adjusted.score - previousScore;
  }

  return {
    accountId, date,
    score: adjusted.score, tier: adjusted.tier,
    dauWauTrend: signals.dauWauTrend,
    monthlyActiveUsers: adjusted.monthlyActiveUsers,
    licenseUtilization: adjusted.licenseUtilization,
    featuresUsed: signals.featureBreadth?.used.length ?? null,
    featureDetails: featureDetailsJson,
    scoreDelta, computedAt,
    zendeskPenalty: adjusted.zendeskPenalty,
    zendeskDetails: adjusted.zendeskDetails ? JSON.stringify(adjusted.zendeskDetails) : null,
    intercomPenalty: adjusted.intercomPenalty,
    intercomBonus: adjusted.intercomBonus,
    intercomDetails: intercomData ? JSON.stringify({ ...adjusted.intercomPenaltyDetails, ...adjusted.intercomBonusDetails, ...adjusted.cxScoreDetails, conversationVolume: intercomData.conversationVolume, quickResolutions: intercomData.quickResolutions, aiHandled: intercomData.aiHandled }) : null,
    cxScorePenalty: adjusted.cxScorePenalty,
    cxScoreBonus: adjusted.cxScoreBonus,
    aliasStatus,
  };
}

// ── Combined penalty application ─────────────────────────────────────────────

export interface AdjustedScoreResult extends HealthScoreResult {
  zendeskPenalty: number | null;
  intercomPenalty: number | null;
  intercomBonus: number | null;
  cxScorePenalty: number | null;
  cxScoreBonus: number | null;
  zendeskDetails: ZendeskPenaltyResult | null;
  intercomPenaltyDetails: IntercomPenaltyResult | null;
  intercomBonusDetails: IntercomBonusResult | null;
  cxScoreDetails: CxScoreResult | null;
}

/**
 * Apply all available penalties and bonuses to a base health-score result.
 *
 * Combines Zendesk and Intercom penalties (capped at -20 combined),
 * then adds the Intercom bonus, and clamps the final score to 0-110.
 * If the base score is null (unmapped account), penalties are attached
 * for informational purposes but the score is not adjusted.
 *
 * Returns full detail objects for each penalty/bonus source to avoid
 * redundant recomputation by callers.
 */
export function applyAllPenalties(
  baseResult: HealthScoreResult,
  zendeskData: ZendeskTicketData | null,
  intercomData: IntercomAggregated | null,
): AdjustedScoreResult {
  const zdResult = zendeskData !== null ? computeZendeskPenalty(zendeskData) : null;
  const icPenaltyResult = intercomData !== null ? computeIntercomPenalty(intercomData) : null;
  const icBonusResult = intercomData !== null ? computeIntercomBonus(intercomData) : null;
  const cxResult = intercomData !== null ? computeCxScorePenaltyBonus(intercomData) : null;

  const zdPenalty = zdResult ? zdResult.totalPenalty : null;
  const icPenalty = icPenaltyResult ? icPenaltyResult.totalPenalty : null;
  const icBonus = icBonusResult ? icBonusResult.totalBonus : null;
  const cxPenalty = cxResult ? cxResult.cxScorePenalty : null;
  const cxBonus = cxResult ? cxResult.cxScoreBonus : null;

  const details = {
    zendeskDetails: zdResult,
    intercomPenaltyDetails: icPenaltyResult,
    intercomBonusDetails: icBonusResult,
    cxScoreDetails: cxResult,
  };

  // If base score is null (unmapped), attach penalties but don't adjust score
  if (baseResult.score === null) {
    return {
      ...baseResult,
      zendeskPenalty: zdPenalty,
      intercomPenalty: icPenalty,
      intercomBonus: icBonus,
      cxScorePenalty: cxPenalty,
      cxScoreBonus: cxBonus,
      ...details,
    };
  }

  // Combined penalty capped at -20
  const rawCombinedPenalty = (zdPenalty ?? 0) + (icPenalty ?? 0) + (cxPenalty ?? 0);
  const combinedPenalty = Math.max(rawCombinedPenalty, -20);

  // Apply penalty then bonus, clamp final score to 0-110
  const afterPenalty = baseResult.score + combinedPenalty;
  const afterBonus = afterPenalty + (icBonus ?? 0) + (cxBonus ?? 0);
  const finalScore = Math.min(110, Math.max(0, afterBonus));

  const tier = scoreToTier(finalScore);

  return {
    ...baseResult,
    score: finalScore,
    tier,
    zendeskPenalty: zdPenalty,
    intercomPenalty: icPenalty,
    intercomBonus: icBonus,
    cxScorePenalty: cxPenalty,
    cxScoreBonus: cxBonus,
    ...details,
  };
}
