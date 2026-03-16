import { computeScore } from '../../services/healthScoreService';
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

    // ── Normalisation: no licenses (maxPossible = 65) ─────────────────────

    it('normalises to 100 when all signals present and maxed out (no licenses)', () => {
      // dauWau ≥0.1 (40) + featureBreadth ≥75% (25) = 65/65 = 100
      const result = computeScore(sig({ dauWauTrend: 0.15, featureBreadth: fb(10, 12) }), null);
      expect(result.score).toBe(100);
      expect(result.tier).toBe('healthy');
    });

    it('normalises partial signals correctly (no licenses)', () => {
      // dauWau ≥0.1 (40) + featureBreadth null (0) = 40/65*100 = 62
      const result = computeScore(sig({ dauWauTrend: 0.15 }), null);
      expect(result.score).toBe(62);
      expect(result.tier).toBe('watch');
    });

    it('normalises featureBreadth-only signal (no licenses)', () => {
      // featureBreadth ≥75% (25) = 25/65*100 = 38 → critical
      const result = computeScore(sig({ featureBreadth: fb(10, 12) }), null);
      expect(result.score).toBe(38);
      expect(result.tier).toBe('critical');
    });

    // ── Normalisation: licenses set (maxPossible = 100) ───────────────────

    it('score = raw points when licenses set (no normalisation needed)', () => {
      // dauWau ≥0.1 (40) + licenseUtil 80% (35) + featureBreadth ≥75% (25) = 100/100 = 100
      const result = computeScore(
        sig({ dauWauTrend: 0.15, monthlyActiveUsers: 80, featureBreadth: fb(10, 12) }),
        100
      );
      expect(result.score).toBe(100);
      expect(result.tier).toBe('healthy');
    });

    it('partial score with licenses set', () => {
      // dauWau stable (25) + licenseUtil 60% (25) + featureBreadth null (0) = 50/100 = 50 → at-risk
      const result = computeScore(
        sig({ dauWauTrend: 0.0, monthlyActiveUsers: 60 }),
        100
      );
      expect(result.score).toBe(50);
      expect(result.tier).toBe('at-risk');
    });

    it('no license score when monthlyActiveUsers is null (licenses set)', () => {
      // dauWau ≥0.1 (40) + licenseUtil null (0) + featureBreadth ≥75% (25) = 65/100 = 65 → watch
      const result = computeScore(
        sig({ dauWauTrend: 0.15, featureBreadth: fb(10, 12) }),
        100
      );
      expect(result.score).toBe(65);
      expect(result.tier).toBe('watch');
    });

    // ── DAU/WAU trend bands ───────────────────────────────────────────────

    it('dauWauTrend ≥ 0.10 scores 40 points', () => {
      const r = computeScore(sig({ dauWauTrend: 0.1 }), null);
      // 40/65*100 = 62
      expect(r.score).toBe(62);
    });

    it('dauWauTrend > 0.10 scores 40 points', () => {
      const r = computeScore(sig({ dauWauTrend: 0.5 }), null);
      expect(r.score).toBe(62);
    });

    it('dauWauTrend 0.09 (stable) scores 25 points', () => {
      // 25/65*100 = 38
      const r = computeScore(sig({ dauWauTrend: 0.09 }), null);
      expect(r.score).toBe(38);
    });

    it('dauWauTrend 0.0 (stable) scores 25 points', () => {
      const r = computeScore(sig({ dauWauTrend: 0.0 }), null);
      expect(r.score).toBe(38);
    });

    it('dauWauTrend -0.09 (stable) scores 25 points', () => {
      const r = computeScore(sig({ dauWauTrend: -0.09 }), null);
      expect(r.score).toBe(38);
    });

    it('dauWauTrend -0.10 scores 10 points', () => {
      // 10/65*100 = 15
      const r = computeScore(sig({ dauWauTrend: -0.1 }), null);
      expect(r.score).toBe(15);
    });

    it('dauWauTrend -0.30 scores 10 points', () => {
      const r = computeScore(sig({ dauWauTrend: -0.3 }), null);
      expect(r.score).toBe(15);
    });

    it('dauWauTrend -0.31 scores 0 points', () => {
      // 0/65*100 = 0
      const r = computeScore(sig({ dauWauTrend: -0.31 }), null);
      expect(r.score).toBe(0);
    });

    // ── License utilisation bands ─────────────────────────────────────────

    it('licenseUtil ≥ 80% scores 35 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 80 }), 100);
      // 35/100 = 35
      expect(r.score).toBe(35);
      expect(r.licenseUtilization).toBeCloseTo(0.8);
    });

    it('licenseUtil = 100% (clamped to 1) scores 35 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 120 }), 100);
      expect(r.score).toBe(35);
      expect(r.licenseUtilization).toBe(1);
    });

    it('licenseUtil ≥ 60% scores 25 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 60 }), 100);
      expect(r.score).toBe(25);
      expect(r.licenseUtilization).toBeCloseTo(0.6);
    });

    it('licenseUtil ≥ 40% scores 15 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 40 }), 100);
      expect(r.score).toBe(15);
      expect(r.licenseUtilization).toBeCloseTo(0.4);
    });

    it('licenseUtil ≥ 20% scores 5 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 20 }), 100);
      expect(r.score).toBe(5);
    });

    it('licenseUtil < 20% scores 0 points', () => {
      const r = computeScore(sig({ monthlyActiveUsers: 10 }), 100);
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

    // ── Feature breadth bands ───────────────────────────────────────────

    it('featureBreadth ≥75% scores 25 points', () => {
      // 9/12 = 0.75 → 25 pts; 25/65*100 = 38
      const r = computeScore(sig({ featureBreadth: fb(9, 12) }), null);
      expect(r.score).toBe(38);
      expect(r.featuresUsed).toBe(9);
    });

    it('featureBreadth ≥50% scores 16 points', () => {
      // 6/12 = 0.50 → 16 pts; 16/65*100 = 25 (Math.round)
      const r = computeScore(sig({ featureBreadth: fb(6, 12) }), null);
      expect(r.score).toBe(25);
      expect(r.featuresUsed).toBe(6);
    });

    it('featureBreadth ≥25% scores 8 points', () => {
      // 3/12 = 0.25 → 8 pts; 8/65*100 = 12
      const r = computeScore(sig({ featureBreadth: fb(3, 12) }), null);
      expect(r.score).toBe(12);
      expect(r.featuresUsed).toBe(3);
    });

    it('featureBreadth <25% scores 0 points', () => {
      // 2/12 = 0.167 → 0 pts
      const r = computeScore(sig({ featureBreadth: fb(2, 12) }), null);
      expect(r.score).toBe(0);
      expect(r.featuresUsed).toBe(2);
    });

    it('featureBreadth 0 features scores 0 points', () => {
      const r = computeScore(sig({ featureBreadth: fb(0, 12) }), null);
      expect(r.score).toBe(0);
      expect(r.featuresUsed).toBe(0);
    });

    it('featureBreadth 100% scores 25 points', () => {
      // 12/12 = 1.0 → 25 pts; 25/65*100 = 38
      const r = computeScore(sig({ featureBreadth: fb(12, 12) }), null);
      expect(r.score).toBe(38);
      expect(r.featuresUsed).toBe(12);
    });

    // ── Tier assignments ───────────────────────────────────────────────────

    it('score ≥ 80 → healthy', () => {
      // 40+35+25=100 with licenses
      const r = computeScore(
        sig({ dauWauTrend: 0.15, monthlyActiveUsers: 80, featureBreadth: fb(10, 12) }),
        100
      );
      expect(r.tier).toBe('healthy');
    });

    it('score = 60 → watch', () => {
      // dauWau stable (25) + licenseUtil 60% (25) + featureBreadth ≥50% (16) = 66/100 → watch
      const r = computeScore(
        sig({ dauWauTrend: 0.0, monthlyActiveUsers: 60, featureBreadth: fb(6, 12) }),
        100
      );
      expect(r.score).toBe(66);
      expect(r.tier).toBe('watch');
    });

    it('score in at-risk range', () => {
      // dauWau stable (25) + featureBreadth ≥25% (8) = 33/65*100 = 51 → at-risk
      const r = computeScore(sig({ dauWauTrend: 0.0, featureBreadth: fb(3, 12) }), null);
      expect(r.score).toBe(51);
      expect(r.tier).toBe('at-risk');
    });

    it('score = 0 → critical', () => {
      const r = computeScore(
        sig({ dauWauTrend: -0.5, monthlyActiveUsers: 10, featureBreadth: fb(0, 12) }),
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
      // dauWau 0.05 → stable (25) + licenseUtil 70/100=0.7 ≥60% (25) + featureBreadth ≥75% (25) = 75/100 = 75 → watch
      const r = computeScore(
        sig({ dauWauTrend: 0.05, monthlyActiveUsers: 70, featureBreadth: fb(10, 12) }),
        100
      );
      expect(r.score).toBe(75);
      expect(r.tier).toBe('watch');
    });

    it('realistic at-risk account: declining, low utilisation, low feature breadth', () => {
      // dauWau -0.15 (10) + licenseUtil 30/200=0.15 <20% (0) + featureBreadth 2/12=0.167 <25% (0) = 10/100 → critical
      const r = computeScore(
        sig({ dauWauTrend: -0.15, monthlyActiveUsers: 30, featureBreadth: fb(2, 12) }),
        200
      );
      expect(r.score).toBe(10);
      expect(r.tier).toBe('critical');
    });
  });
});
