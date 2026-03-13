import { computeScore } from '../../services/healthScoreService';
import { AmplitudeSignals } from '../../clients/amplitudeClient';

// Helper: build signals with defaults
function sig(overrides: Partial<AmplitudeSignals> = {}): AmplitudeSignals {
  return {
    dauWauTrend: null,
    monthlyActiveUsers: null,
    lastLoginDays: null,
    ...overrides,
  };
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
    });

    // ── Normalisation: no licenses (maxPossible = 65) ─────────────────────

    it('normalises to 100 when all signals present and maxed out (no licenses)', () => {
      // dauWau ≥0.1 (40) + login <7 (25) = 65/65 = 100
      const result = computeScore(sig({ dauWauTrend: 0.15, lastLoginDays: 3 }), null);
      expect(result.score).toBe(100);
      expect(result.tier).toBe('healthy');
    });

    it('normalises partial signals correctly (no licenses)', () => {
      // dauWau ≥0.1 (40) + login null (0) = 40/65*100 = 62
      const result = computeScore(sig({ dauWauTrend: 0.15 }), null);
      expect(result.score).toBe(62);
      expect(result.tier).toBe('watch');
    });

    it('normalises login-only signal (no licenses)', () => {
      // lastLogin <7 (25) = 25/65*100 = 38 → critical
      const result = computeScore(sig({ lastLoginDays: 3 }), null);
      expect(result.score).toBe(38);
      expect(result.tier).toBe('critical');
    });

    // ── Normalisation: licenses set (maxPossible = 100) ───────────────────

    it('score = raw points when licenses set (no normalisation needed)', () => {
      // dauWau ≥0.1 (40) + licenseUtil 80% (35) + login <7 (25) = 100/100 = 100
      const result = computeScore(
        sig({ dauWauTrend: 0.15, monthlyActiveUsers: 80, lastLoginDays: 3 }),
        100
      );
      expect(result.score).toBe(100);
      expect(result.tier).toBe('healthy');
    });

    it('partial score with licenses set', () => {
      // dauWau stable (25) + licenseUtil 60% (25) + login null (0) = 50/100 = 50 → at-risk
      const result = computeScore(
        sig({ dauWauTrend: 0.0, monthlyActiveUsers: 60 }),
        100
      );
      expect(result.score).toBe(50);
      expect(result.tier).toBe('at-risk');
    });

    it('no license score when monthlyActiveUsers is null (licenses set)', () => {
      // dauWau ≥0.1 (40) + licenseUtil null (0) + login <7 (25) = 65/100 = 65 → watch
      const result = computeScore(
        sig({ dauWauTrend: 0.15, lastLoginDays: 3 }),
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

    // ── Last login bands ──────────────────────────────────────────────────

    it('lastLoginDays = 0 scores 25 points', () => {
      const r = computeScore(sig({ lastLoginDays: 0 }), null);
      // 25/65*100 = 38
      expect(r.score).toBe(38);
    });

    it('lastLoginDays = 6 scores 25 points', () => {
      const r = computeScore(sig({ lastLoginDays: 6 }), null);
      expect(r.score).toBe(38);
    });

    it('lastLoginDays = 7 scores 16 points', () => {
      // 16/65*100 = 25 (Math.round)
      const r = computeScore(sig({ lastLoginDays: 7 }), null);
      expect(r.score).toBe(25);
    });

    it('lastLoginDays = 13 scores 16 points', () => {
      const r = computeScore(sig({ lastLoginDays: 13 }), null);
      expect(r.score).toBe(25);
    });

    it('lastLoginDays = 14 scores 8 points', () => {
      // 8/65*100 = 12
      const r = computeScore(sig({ lastLoginDays: 14 }), null);
      expect(r.score).toBe(12);
    });

    it('lastLoginDays = 30 scores 8 points', () => {
      const r = computeScore(sig({ lastLoginDays: 30 }), null);
      expect(r.score).toBe(12);
    });

    it('lastLoginDays = 31 scores 0 points', () => {
      const r = computeScore(sig({ lastLoginDays: 31 }), null);
      expect(r.score).toBe(0);
    });

    it('lastLoginDays = 90 scores 0 points', () => {
      const r = computeScore(sig({ lastLoginDays: 90 }), null);
      expect(r.score).toBe(0);
    });

    // ── Tier assignments ───────────────────────────────────────────────────

    it('score ≥ 80 → healthy', () => {
      // 40+35+25=100 with licenses
      const r = computeScore(
        sig({ dauWauTrend: 0.15, monthlyActiveUsers: 80, lastLoginDays: 3 }),
        100
      );
      expect(r.tier).toBe('healthy');
    });

    it('score = 60 → watch', () => {
      // dauWau stable (25) + licenseUtil 60% (25) + login 7-13 days (16) = 66/100 → watch
      // Actually 25+25+16=66 → watch (≥60)
      const r = computeScore(
        sig({ dauWauTrend: 0.0, monthlyActiveUsers: 60, lastLoginDays: 7 }),
        100
      );
      expect(r.score).toBe(66);
      expect(r.tier).toBe('watch');
    });

    it('score in at-risk range', () => {
      // dauWau -0.1 (10) + login 14-30 (8) = 18/65*100 = 28 → critical
      // Let's do: dauWau stable (25) + login 14d (8) = 33/65*100 = 51 → at-risk
      const r = computeScore(sig({ dauWauTrend: 0.0, lastLoginDays: 14 }), null);
      expect(r.score).toBe(51);
      expect(r.tier).toBe('at-risk');
    });

    it('score = 0 → critical', () => {
      const r = computeScore(
        sig({ dauWauTrend: -0.5, monthlyActiveUsers: 10, lastLoginDays: 90 }),
        100
      );
      expect(r.score).toBe(0);
      expect(r.tier).toBe('critical');
    });

    // ── monthlyActiveUsers passthrough ────────────────────────────────────

    it('monthlyActiveUsers is returned in result', () => {
      const r = computeScore(
        sig({ dauWauTrend: 0.1, monthlyActiveUsers: 42, lastLoginDays: 3 }),
        100
      );
      expect(r.monthlyActiveUsers).toBe(42);
    });

    it('monthlyActiveUsers is null when signal is null', () => {
      const r = computeScore(sig({ dauWauTrend: 0.1 }), null);
      expect(r.monthlyActiveUsers).toBeNull();
    });

    // ── Realistic combined scenario ───────────────────────────────────────

    it('realistic healthy account: stable growth, 70% utilisation, recent login', () => {
      // dauWau 0.05 → stable (25) + licenseUtil 70/100=0.7 ≥60% (25) + login 5d (25) = 75/100 = 75 → at-risk
      // Wait: 75 is ≥60, so watch
      const r = computeScore(
        sig({ dauWauTrend: 0.05, monthlyActiveUsers: 70, lastLoginDays: 5 }),
        100
      );
      expect(r.score).toBe(75);
      expect(r.tier).toBe('watch');
    });

    it('realistic at-risk account: declining, low utilisation, login 2 weeks ago', () => {
      // dauWau -0.15 (10) + licenseUtil 30/200=0.15 <20% (0) + login 14d (8) = 18/100 → critical
      const r = computeScore(
        sig({ dauWauTrend: -0.15, monthlyActiveUsers: 30, lastLoginDays: 14 }),
        200
      );
      expect(r.score).toBe(18);
      expect(r.tier).toBe('critical');
    });
  });
});
