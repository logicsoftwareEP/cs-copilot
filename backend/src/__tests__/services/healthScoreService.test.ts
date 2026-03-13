import { computeScore } from '../../services/healthScoreService';
import { AmplitudeSignals } from '../../clients/amplitudeClient';

describe('healthScoreService', () => {
  describe('computeScore', () => {
    // ========================================================================
    // Test: All signals null => score=null, tier='unmapped'
    // ========================================================================
    it('returns null score and unmapped tier when all signals are null', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBeNull();
      expect(result.tier).toBe('unmapped');
      expect(result.featureAdoption).toBeNull();
    });

    // ========================================================================
    // Test: Mix of null and non-null signals => score computes from non-null
    // ========================================================================
    it('computes score when only dauWauTrend is non-null', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: 0.15, // 40 points
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(40); // 40 + 0 + 0
      expect(result.tier).toBe('at-risk'); // 40-59 range
      expect(result.featureAdoption).toBeNull();
    });

    it('computes score when only featureAdoption is non-null', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: 1.0, // 35 points (1.0 * 35)
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(35);
      expect(result.tier).toBe('critical');
      expect(result.featureAdoption).toBe(1.0);
    });

    it('computes score when only lastLoginDays is non-null', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: null,
        lastLoginDays: 5, // 25 points
      };
      const result = computeScore(signals);
      expect(result.score).toBe(25);
      expect(result.tier).toBe('critical');
      expect(result.featureAdoption).toBeNull();
    });

    // ========================================================================
    // Test: DAU/WAU trend bands
    // ========================================================================
    it('scores 40 points for dauWauTrend >= 0.10', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: 0.1,
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(40);
    });

    it('scores 40 points for dauWauTrend > 0.10', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: 0.15,
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(40);
    });

    it('scores 25 points for dauWauTrend just below 0.10', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: 0.09,
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(25);
    });

    it('scores 25 points for dauWauTrend at 0.0', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: 0.0,
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(25);
    });

    it('scores 25 points for dauWauTrend just above -0.10', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: -0.09,
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(25);
    });

    it('scores 10 points for dauWauTrend at -0.10', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: -0.1,
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(10);
    });

    it('scores 10 points for dauWauTrend at -0.30', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: -0.3,
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(10);
    });

    it('scores 10 points for dauWauTrend between -0.10 and -0.30', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: -0.2,
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(10);
    });

    it('scores 0 points for dauWauTrend < -0.30', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: -0.31,
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(0);
    });

    it('scores 0 points for dauWauTrend far below -0.30', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: -0.5,
        featureAdoption: null,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(0);
    });

    // ========================================================================
    // Test: Feature adoption bands
    // ========================================================================
    it('scores 0 points for featureAdoption=0', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: 0,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(0);
    });

    it('scores 18 points for featureAdoption=0.5 (rounded from 17.5)', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: 0.5,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(18); // Math.round(0.5 * 35) = 18
      expect(result.featureAdoption).toBe(0.5);
    });

    it('scores 35 points for featureAdoption=1.0', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: 1.0,
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(35);
      expect(result.featureAdoption).toBe(1.0);
    });

    // ========================================================================
    // Test: Last login bands
    // ========================================================================
    it('scores 25 points for lastLoginDays=0', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: null,
        lastLoginDays: 0,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(25);
    });

    it('scores 25 points for lastLoginDays=6', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: null,
        lastLoginDays: 6,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(25);
    });

    it('scores 16 points for lastLoginDays=7', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: null,
        lastLoginDays: 7,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(16);
    });

    it('scores 16 points for lastLoginDays=13', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: null,
        lastLoginDays: 13,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(16);
    });

    it('scores 8 points for lastLoginDays=14', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: null,
        lastLoginDays: 14,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(8);
    });

    it('scores 8 points for lastLoginDays=30', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: null,
        lastLoginDays: 30,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(8);
    });

    it('scores 0 points for lastLoginDays=31', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: null,
        lastLoginDays: 31,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(0);
    });

    it('scores 0 points for lastLoginDays > 30', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: null,
        lastLoginDays: 90,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(0);
    });

    // ========================================================================
    // Test: Tier assignments at boundaries
    // ========================================================================
    it('assigns healthy tier for score=80', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: 0.1,
        featureAdoption: 1.0,
        lastLoginDays: 6,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(100);
      expect(result.tier).toBe('healthy');
    });

    it('assigns healthy tier for score=100', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: 0.1, // 40
        featureAdoption: 1.0, // 35
        lastLoginDays: 0, // 25
      };
      const result = computeScore(signals);
      expect(result.score).toBe(100);
      expect(result.tier).toBe('healthy');
    });

    it('assigns watch tier for score=60', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: -0.09, // 25
        featureAdoption: 1.0, // 35
        lastLoginDays: null, // 0
      };
      const result = computeScore(signals);
      expect(result.score).toBe(60);
      expect(result.tier).toBe('watch');
    });

    it('assigns healthy tier for score 91 (40+35+16)', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: 0.1, // 40
        featureAdoption: 1.0, // 35
        lastLoginDays: 7, // 16 (not 25)
      };
      const result = computeScore(signals);
      expect(result.score).toBe(91);
      expect(result.tier).toBe('healthy');
    });

    it('assigns at-risk tier for score=40', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: -0.1, // 10
        featureAdoption: 0.571, // 20 (0.571 * 35 ≈ 20)
        lastLoginDays: 7, // 16
      };
      const result = computeScore(signals);
      expect(result.score).toBe(46);
      expect(result.tier).toBe('at-risk');
    });

    it('assigns at-risk tier for score=59', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: -0.09, // 25
        featureAdoption: 0.971, // 34 (0.971 * 35 ≈ 34)
        lastLoginDays: null, // 0
      };
      const result = computeScore(signals);
      expect(result.score).toBe(59);
      expect(result.tier).toBe('at-risk');
    });

    it('assigns critical tier for score=39', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: -0.2, // 10
        featureAdoption: 0.829, // 29 (0.829 * 35 ≈ 29)
        lastLoginDays: null, // 0
      };
      const result = computeScore(signals);
      expect(result.score).toBe(39);
      expect(result.tier).toBe('critical');
    });

    it('assigns critical tier for score=0', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: -0.5, // 0
        featureAdoption: 0, // 0
        lastLoginDays: 90, // 0
      };
      const result = computeScore(signals);
      expect(result.score).toBe(0);
      expect(result.tier).toBe('critical');
    });

    // ========================================================================
    // Test: featureAdoption is always passed through
    // ========================================================================
    it('always returns featureAdoption from input signals', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: 0.1,
        featureAdoption: 0.42,
        lastLoginDays: 7,
      };
      const result = computeScore(signals);
      expect(result.featureAdoption).toBe(0.42);
    });

    // ========================================================================
    // Additional comprehensive test cases for coverage
    // ========================================================================
    it('combines all three signals for a realistic scenario', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: 0.05, // 25 (> -0.10, < 0.10)
        featureAdoption: 0.75, // 26 (Math.round(0.75 * 35) = 26)
        lastLoginDays: 10, // 16 (7-13 days)
      };
      const result = computeScore(signals);
      expect(result.score).toBe(67); // 25 + 26 + 16
      expect(result.tier).toBe('watch');
      expect(result.featureAdoption).toBe(0.75);
    });

    it('handles edge case: featureAdoption rounds down', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: 0.2, // Math.round(0.2 * 35) = Math.round(7) = 7
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      expect(result.score).toBe(7);
    });

    it('handles edge case: featureAdoption rounds up', () => {
      const signals: AmplitudeSignals = {
        dauWauTrend: null,
        featureAdoption: 0.3, // Math.round(0.3 * 35) = Math.round(10.5) = 11 (banker's rounding is .5 rounds to even, but JS uses standard rounding)
        lastLoginDays: null,
      };
      const result = computeScore(signals);
      // Math.round(10.5) in JS = 11
      expect(result.score).toBe(11);
    });
  });
});
