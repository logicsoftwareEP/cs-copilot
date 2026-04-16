import { computeScore, applyAllPenalties, HealthScoreResult } from '../../services/healthScoreService';
import { AmplitudeSignals, FeatureBreadth } from '../../clients/amplitudeClient';

// Helper: build signals with defaults
function sig(overrides: Partial<AmplitudeSignals> = {}): AmplitudeSignals {
  return {
    dauWauTrend: null,
    monthlyActiveUsers: null,
    featureBreadth: null,
    ...overrides,
  };
}

// Helper: build a FeatureBreadth with N out of 12 features used
function fb(usedCount: number, total = 12): FeatureBreadth {
  const categories = [
    'Activity Center', 'Time Tracking', 'Resources', 'Reporting',
    'Dashboards', 'Financials', 'Invoices', 'Custom Forms',
    'AI Features', 'Collaboration', 'Workload', 'Settings',
  ];
  return { used: categories.slice(0, usedCount), total };
}

describe('healthScoreService', () => {
  describe('computeScore', () => {

    // ── Null handling ────────────────────────────────────────────────────────

    it('returns null score and unmapped tier when all signals are null', () => {
      const result = computeScore(sig(), null);
      expect(result.score).toBeNull();
      expect(result.tier).toBe('unmapped');
      expect(result.licenseUtilization).toBeNull();
      expect(result.monthlyActiveUsers).toBeNull();
      expect(result.featuresUsed).toBeNull();
    });

    // ── Normalisation: no licenses (maxPossible = 40) ─────────────────────

    it('sums all components when all signals present and maxed out (no licenses)', () => {
      // dauWau ≥0.1 (25) + featureAdoption ≥75% (15) = 40 → at-risk (no license points available)
      const result = computeScore(sig({ dauWauTrend: 0.15, featureBreadth: fb(10, 12) }), null);
      expect(result.score).toBe(40);
      expect(result.tier).toBe('at-risk');
    });

    it('partial signals without licenses', () => {
      // dauWau ≥0.1 (25) + featureAdoption null (0) = 25 → critical
      const result = computeScore(sig({ dauWauTrend: 0.15 }), null);
      expect(result.score).toBe(25);
      expect(result.tier).toBe('critical');
    });

    it('featureBreadth-only signal (no licenses)', () => {
      // featureAdoption ≥75% (15) = 15 → critical
      const result = computeScore(sig({ featureBreadth: fb(10, 12) }), null);
      expect(result.score).toBe(15);
      expect(result.tier).toBe('critical');
    });

    // ── Combined scenarios with licenses ──────────────────────────────────

    it('maxed out score with licenses set = 100 → healthy', () => {
      // licenseUtil 80% (60) + dauWau ≥0.1 (25) + featureAdoption ≥75% (15) = 100
      const result = computeScore(
        sig({ dauWauTrend: 0.15, monthlyActiveUsers: 80, featureBreadth: fb(10, 12) }),
        100
      );
      expect(result.score).toBe(100);
      expect(result.tier).toBe('healthy');
    });

    it('partial score with licenses set', () => {
      // licenseUtil 60% (45) + dauWau stable (15) + featureAdoption null (0) = 60 → watch
      const result = computeScore(
        sig({ dauWauTrend: 0.0, monthlyActiveUsers: 60 }),
        100
      );
      expect(result.score).toBe(60);
      expect(result.tier).toBe('watch');
    });

    it('no license score when monthlyActiveUsers is null (licenses set)', () => {
      // licenseUtil null (0) + dauWau ≥0.1 (25) + featureAdoption ≥75% (15) = 40 → at-risk
      const result = computeScore(
        sig({ dauWauTrend: 0.15, featureBreadth: fb(10, 12) }),
        100
      );
      expect(result.score).toBe(40);
      expect(result.tier).toBe('at-risk');
    });

    // ── Activity trend bands (0–25) ─────────────────────────────────────────

    it('dauWauTrend ≥ 0.10 scores 25 points', () => {
      const r = computeScore(sig({ dauWauTrend: 0.1 }), null);
      expect(r.score).toBe(25);
    });

    it('dauWauTrend > 0.10 scores 25 points', () => {
      const r = computeScore(sig({ dauWauTrend: 0.5 }), null);
      expect(r.score).toBe(25);
    });

    it('dauWauTrend 0.09 (stable) scores 15 points', () => {
      const r = computeScore(sig({ dauWauTrend: 0.09 }), null);
      expect(r.score).toBe(15);
    });

    it('dauWauTrend 0.0 (stable) scores 15 points', () => {
      const r = computeScore(sig({ dauWauTrend: 0.0 }), null);
      expect(r.score).toBe(15);
    });

    it('dauWauTrend -0.09 (stable) scores 15 points', () => {
      const r = computeScore(sig({ dauWauTrend: -0.09 }), null);
      expect(r.score).toBe(15);
    });

    it('dauWauTrend -0.10 scores 6 points', () => {
      const r = computeScore(sig({ dauWauTrend: -0.1 }), null);
      expect(r.score).toBe(6);
    });

    it('dauWauTrend -0.30 scores 6 points', () => {
      const r = computeScore(sig({ dauWauTrend: -0.3 }), null);
      expect(r.score).toBe(6);
    });

    it('dauWauTrend -0.31 scores 0 points', () => {
      const r = computeScore(sig({ dauWauTrend: -0.31 }), null);
      expect(r.score).toBe(0);
    });

    // ── License utilisation bands (0–60) ─────────────────────────────────────

    it('licenseUtil ≥ 80% scores 60 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 80 }), 100);
      expect(r.score).toBe(60);
      expect(r.licenseUtilization).toBeCloseTo(0.8);
    });

    it('licenseUtil = 100% (clamped to 1) scores 60 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 120 }), 100);
      expect(r.score).toBe(60);
      expect(r.licenseUtilization).toBe(1);
    });

    it('licenseUtil ≥ 60% scores 45 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 60 }), 100);
      expect(r.score).toBe(45);
      expect(r.licenseUtilization).toBeCloseTo(0.6);
    });

    it('licenseUtil ≥ 40% scores 30 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 40 }), 100);
      expect(r.score).toBe(30);
      expect(r.licenseUtilization).toBeCloseTo(0.4);
    });

    it('licenseUtil ≥ 20% scores 15 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 20 }), 100);
      expect(r.score).toBe(15);
    });

    it('licenseUtil ≥ 10% scores 5 points', () => {
      // 10/100 = 0.1 → 5 pts
      const r = computeScore(sig({ monthlyActiveUsers: 10 }), 100);
      expect(r.score).toBe(5);
      expect(r.licenseUtilization).toBeCloseTo(0.1);
    });

    it('licenseUtil < 10% scores 0 points', () => {
      // 5/100 = 0.05 → 0 pts
      const r = computeScore(sig({ monthlyActiveUsers: 5 }), 100);
      expect(r.score).toBe(0);
    });

    it('licenseUtil = 0 scores 0 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 0 }), 100);
      expect(r.score).toBe(0);
      expect(r.licenseUtilization).toBe(0);
    });

    it('licenseUtilization is null when licenses is null', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 50, dauWauTrend: 0.1 }), null);
      expect(r.licenseUtilization).toBeNull();
    });

    it('licenseUtilization is null when monthlyActiveUsers is null', () => {
      const r = computeScore(sig({ dauWauTrend: 0.1 }), 100);
      expect(r.licenseUtilization).toBeNull();
    });

    // ── Feature adoption bands (0–15) ───────────────────────────────────────

    it('featureAdoption ≥75% scores 15 points', () => {
      // 9/12 = 0.75 → 15 pts
      const r = computeScore(sig({ featureBreadth: fb(9, 12) }), null);
      expect(r.score).toBe(15);
      expect(r.featuresUsed).toBe(9);
    });

    it('featureAdoption ≥50% scores 10 points', () => {
      // 6/12 = 0.50 → 10 pts
      const r = computeScore(sig({ featureBreadth: fb(6, 12) }), null);
      expect(r.score).toBe(10);
      expect(r.featuresUsed).toBe(6);
    });

    it('featureAdoption ≥25% scores 5 points', () => {
      // 3/12 = 0.25 → 5 pts
      const r = computeScore(sig({ featureBreadth: fb(3, 12) }), null);
      expect(r.score).toBe(5);
      expect(r.featuresUsed).toBe(3);
    });

    it('featureAdoption <25% scores 0 points', () => {
      // 2/12 = 0.167 → 0 pts
      const r = computeScore(sig({ featureBreadth: fb(2, 12) }), null);
      expect(r.score).toBe(0);
      expect(r.featuresUsed).toBe(2);
    });

    it('featureAdoption 0 features scores 0 points', () => {
      const r = computeScore(sig({ featureBreadth: fb(0, 12) }), null);
      expect(r.score).toBe(0);
      expect(r.featuresUsed).toBe(0);
    });

    it('featureAdoption 100% scores 15 points', () => {
      // 12/12 = 1.0 → 15 pts
      const r = computeScore(sig({ featureBreadth: fb(12, 12) }), null);
      expect(r.score).toBe(15);
      expect(r.featuresUsed).toBe(12);
    });

    // ── Tier assignments ───────────────────────────────────────────────────

    it('score ≥ 80 → healthy', () => {
      // 60+25+15=100 with licenses
      const r = computeScore(
        sig({ dauWauTrend: 0.15, monthlyActiveUsers: 80, featureBreadth: fb(10, 12) }),
        100
      );
      expect(r.tier).toBe('healthy');
    });

    it('score = 60 → watch', () => {
      // licenseUtil 60% (45) + dauWau stable (15) + featureAdoption ≥50% (10) = 70/100 → watch
      const r = computeScore(
        sig({ dauWauTrend: 0.0, monthlyActiveUsers: 60, featureBreadth: fb(6, 12) }),
        100
      );
      expect(r.score).toBe(70);
      expect(r.tier).toBe('watch');
    });

    it('score in at-risk range', () => {
      // licenseUtil 40% (30) + dauWau stable (15) + featureAdoption ≥25% (5) = 50 → at-risk
      const r = computeScore(
        sig({ dauWauTrend: 0.0, monthlyActiveUsers: 40, featureBreadth: fb(3, 12) }),
        100
      );
      expect(r.score).toBe(50);
      expect(r.tier).toBe('at-risk');
    });

    it('score = 0 → critical', () => {
      // MAU=5/100=0.05 (<10%, 0 pts) + dauWau -0.5 (0 pts) + 0 features = 0
      const r = computeScore(
        sig({ dauWauTrend: -0.5, monthlyActiveUsers: 5, featureBreadth: fb(0, 12) }),
        100
      );
      expect(r.score).toBe(0);
      expect(r.tier).toBe('critical');
    });

    // ── monthlyActiveUsers passthrough ────────────────────────────────────

    it('monthlyActiveUsers is returned in result', () => {
      const r = computeScore(
        sig({ dauWauTrend: 0.1, monthlyActiveUsers: 42, featureBreadth: fb(10, 12) }),
        100
      );
      expect(r.monthlyActiveUsers).toBe(42);
    });

    it('monthlyActiveUsers is null when signal is null', () => {
      const r = computeScore(sig({ dauWauTrend: 0.1 }), null);
      expect(r.monthlyActiveUsers).toBeNull();
    });

    // ── Realistic combined scenario ───────────────────────────────────────

    it('realistic healthy account: stable growth, 70% utilisation, good feature breadth', () => {
      // licenseUtil 70/100=0.7 ≥60% (45) + dauWau 0.05 stable (15) + featureAdoption ≥75% (15) = 75/100 = 75 → watch
      const r = computeScore(
        sig({ dauWauTrend: 0.05, monthlyActiveUsers: 70, featureBreadth: fb(10, 12) }),
        100
      );
      expect(r.score).toBe(75);
      expect(r.tier).toBe('watch');
    });

    it('realistic at-risk account: declining, low utilisation, low feature breadth', () => {
      // licenseUtil 30/200=0.15 ≥10% (5) + dauWau -0.15 (6) + featureAdoption 2/12<25% (0) = 11/100 → critical
      const r = computeScore(
        sig({ dauWauTrend: -0.15, monthlyActiveUsers: 30, featureBreadth: fb(2, 12) }),
        200
      );
      expect(r.score).toBe(11);
      expect(r.tier).toBe('critical');
    });

    // ── 0→N ramp (fetchMauTrend returns trend=1.0) ─────────────────────────

    it('0→N account (trend=1.0) with low license util scores via license floor', () => {
      // South Carolina DMH case: 9 MAU / 65 licenses, trend 1.0 (0→9 ramp),
      // 5/12 features. License floor gives 5 pts at 13.8% util.
      // license (5) + trend (25) + features (5) = 35 → critical
      const r = computeScore(
        sig({
          dauWauTrend: 1.0,
          monthlyActiveUsers: 9,
          featureBreadth: fb(5, 12),
        }),
        65
      );
      expect(r.score).toBe(35);
      expect(r.tier).toBe('critical');
      expect(r.licenseUtilization).toBeCloseTo(9 / 65);
    });
  });

  describe('applyAllPenalties', () => {
    const baseResult: HealthScoreResult = {
      score: 80,
      tier: 'healthy',
      licenseUtilization: 0.8,
      monthlyActiveUsers: 80,
      featuresUsed: 10,
      featureDetails: null,
    };

    it('returns full detail objects alongside penalty totals', () => {
      const adjusted = applyAllPenalties(
        baseResult,
        { ticketVolume: 5, openCount: 3, highPriorityCount: 0, urgentCount: 0 },
        { openCount: 2, conversationVolume: 5, avgResponseTime: 1000, quickResolutions: 3, aiHandled: 1, avgCxScore: 4.5, cxScoreCount: 5 },
      );
      // Penalty totals
      expect(adjusted.zendeskPenalty).toBe(-7); // vol -3 + open -4
      expect(adjusted.intercomPenalty).toBe(-2); // open 1-2 = -2
      expect(adjusted.intercomBonus).toBe(3); // quick 2 + ai 1 (no engage: openCount > 1)
      expect(adjusted.cxScorePenalty).toBe(0);
      expect(adjusted.cxScoreBonus).toBe(5);

      // Detail objects
      expect(adjusted.zendeskDetails).not.toBeNull();
      expect(adjusted.zendeskDetails!.volumePenalty).toBe(-3);
      expect(adjusted.zendeskDetails!.openPenalty).toBe(-4);

      expect(adjusted.intercomPenaltyDetails).not.toBeNull();
      expect(adjusted.intercomPenaltyDetails!.openPenalty).toBe(-2);

      expect(adjusted.intercomBonusDetails).not.toBeNull();
      expect(adjusted.intercomBonusDetails!.quickResolutionBonus).toBe(2);

      expect(adjusted.cxScoreDetails).not.toBeNull();
      expect(adjusted.cxScoreDetails!.cxScoreBonus).toBe(5);
    });

    it('returns null details when data sources are null', () => {
      const adjusted = applyAllPenalties(baseResult, null, null);
      expect(adjusted.zendeskDetails).toBeNull();
      expect(adjusted.intercomPenaltyDetails).toBeNull();
      expect(adjusted.intercomBonusDetails).toBeNull();
      expect(adjusted.cxScoreDetails).toBeNull();
    });
  });
});
