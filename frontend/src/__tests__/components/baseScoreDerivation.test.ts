import { describe, it, expect } from 'vitest';

/**
 * Tests for the base score derivation logic used in Troubleshoot ScoreSummary.
 *
 * The formula: derivedBase = finalScore - combinedPenalty - icBonus - cxBonus
 * When finalScore is 0 or 110 (clamped), the reverse derivation is unreliable,
 * so we append "(clamped)" to indicate the value may not be exact.
 */

function deriveBaseScore(
  finalScore: number | null,
  combinedPenalty: number,
  icBonus: number,
  cxBonus: number,
): string {
  if (finalScore === null) return '—';
  const derivedBase = finalScore - combinedPenalty - icBonus - cxBonus;
  const wasClamped = finalScore === 0 || finalScore === 110;
  return `${derivedBase}${wasClamped ? ' (clamped)' : ''}`;
}

describe('deriveBaseScore', () => {
  it('returns plain number when score is not clamped', () => {
    // base=70, penalty=-5, bonus=3, cxBonus=2 => final=70
    expect(deriveBaseScore(70, -5, 3, 2)).toBe('70');
  });

  it('appends (clamped) when final score is 0', () => {
    // base=5, penalty=-20, bonus=0, cxBonus=0 => clamped to 0
    // reverse: 0 - (-20) - 0 - 0 = 20 (wrong, actual base was 5)
    expect(deriveBaseScore(0, -20, 0, 0)).toBe('20 (clamped)');
  });

  it('appends (clamped) when final score is 110', () => {
    // base=95, penalty=0, bonus=10, cxBonus=5 => clamped to 110
    // reverse: 110 - 0 - 10 - 5 = 95
    expect(deriveBaseScore(110, 0, 10, 5)).toBe('95 (clamped)');
  });

  it('returns — when score is null', () => {
    expect(deriveBaseScore(null, -5, 3, 0)).toBe('—');
  });

  it('handles zero penalty and zero bonus correctly', () => {
    expect(deriveBaseScore(75, 0, 0, 0)).toBe('75');
  });
});
