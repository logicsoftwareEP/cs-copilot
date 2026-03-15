import {
  computeZendeskPenalty,
  applyZendeskPenalty,
  HealthScoreResult,
} from '../../services/healthScoreService';
import { ZendeskTicketData } from '../../clients/zendeskClient';

// Helper: build ZendeskTicketData with defaults
function zd(overrides: Partial<ZendeskTicketData> = {}): ZendeskTicketData {
  return {
    ticketVolume: 0,
    openCount: 0,
    highPriorityCount: 0,
    urgentCount: 0,
    ...overrides,
  };
}

// Helper: build a base HealthScoreResult
function baseResult(overrides: Partial<HealthScoreResult> = {}): HealthScoreResult {
  return {
    score: 80,
    tier: 'healthy',
    licenseUtilization: 0.8,
    monthlyActiveUsers: 80,
    ...overrides,
  };
}

describe('computeZendeskPenalty', () => {

  // ── Volume penalty thresholds ──────────────────────────────────────────

  it('volume 0 → 0 penalty', () => {
    expect(computeZendeskPenalty(zd({ ticketVolume: 0 })).volumePenalty).toBe(0);
  });

  it('volume 2 → 0 penalty', () => {
    expect(computeZendeskPenalty(zd({ ticketVolume: 2 })).volumePenalty).toBe(0);
  });

  it('volume 3 → -3 penalty', () => {
    expect(computeZendeskPenalty(zd({ ticketVolume: 3 })).volumePenalty).toBe(-3);
  });

  it('volume 5 → -3 penalty', () => {
    expect(computeZendeskPenalty(zd({ ticketVolume: 5 })).volumePenalty).toBe(-3);
  });

  it('volume 6 → -5 penalty', () => {
    expect(computeZendeskPenalty(zd({ ticketVolume: 6 })).volumePenalty).toBe(-5);
  });

  it('volume 10 → -5 penalty', () => {
    expect(computeZendeskPenalty(zd({ ticketVolume: 10 })).volumePenalty).toBe(-5);
  });

  it('volume 11 → -8 penalty', () => {
    expect(computeZendeskPenalty(zd({ ticketVolume: 11 })).volumePenalty).toBe(-8);
  });

  // ── Open ticket penalty thresholds ─────────────────────────────────────

  it('open 0 → 0 penalty', () => {
    expect(computeZendeskPenalty(zd({ openCount: 0 })).openPenalty).toBe(0);
  });

  it('open 1 → -2 penalty', () => {
    expect(computeZendeskPenalty(zd({ openCount: 1 })).openPenalty).toBe(-2);
  });

  it('open 2 → -2 penalty', () => {
    expect(computeZendeskPenalty(zd({ openCount: 2 })).openPenalty).toBe(-2);
  });

  it('open 3 → -4 penalty', () => {
    expect(computeZendeskPenalty(zd({ openCount: 3 })).openPenalty).toBe(-4);
  });

  it('open 5 → -4 penalty', () => {
    expect(computeZendeskPenalty(zd({ openCount: 5 })).openPenalty).toBe(-4);
  });

  it('open 6 → -7 penalty', () => {
    expect(computeZendeskPenalty(zd({ openCount: 6 })).openPenalty).toBe(-7);
  });

  // ── Severity penalty thresholds ────────────────────────────────────────

  it('0 high, 0 urgent → 0 penalty', () => {
    expect(computeZendeskPenalty(zd()).severityPenalty).toBe(0);
  });

  it('1 high → -2 penalty', () => {
    expect(computeZendeskPenalty(zd({ highPriorityCount: 1 })).severityPenalty).toBe(-2);
  });

  it('2 high → -2 penalty', () => {
    expect(computeZendeskPenalty(zd({ highPriorityCount: 2 })).severityPenalty).toBe(-2);
  });

  it('3 high → -5 penalty', () => {
    expect(computeZendeskPenalty(zd({ highPriorityCount: 3 })).severityPenalty).toBe(-5);
  });

  it('1 urgent → -5 penalty', () => {
    expect(computeZendeskPenalty(zd({ urgentCount: 1 })).severityPenalty).toBe(-5);
  });

  // ── Total penalty cap ─────────────────────────────────────────────────

  it('caps total penalty at -20 when all sub-penalties are at maximum', () => {
    // volume -8, open -7, severity -5 = -20 (exactly the cap)
    const result = computeZendeskPenalty(
      zd({ ticketVolume: 15, openCount: 10, highPriorityCount: 5, urgentCount: 1 })
    );
    expect(result.totalPenalty).toBe(-20);
    expect(result.volumePenalty).toBe(-8);
    expect(result.openPenalty).toBe(-7);
    expect(result.severityPenalty).toBe(-5);
  });

  it('returns raw counts in the result', () => {
    const result = computeZendeskPenalty(
      zd({ ticketVolume: 7, openCount: 3, highPriorityCount: 2, urgentCount: 1 })
    );
    expect(result.ticketVolume).toBe(7);
    expect(result.openCount).toBe(3);
    expect(result.highPriorityCount).toBe(2);
    expect(result.urgentCount).toBe(1);
  });
});

describe('applyZendeskPenalty', () => {

  it('passes through base result unchanged when zendeskData is null', () => {
    const base = baseResult();
    const result = applyZendeskPenalty(base, null);

    expect(result.score).toBe(80);
    expect(result.tier).toBe('healthy');
    expect(result.zendeskPenalty).toBeNull();
  });

  it('reduces score and re-derives tier when penalty applied', () => {
    // Base score 80 (healthy), penalty from 5 tickets + 2 open + 1 high
    // volume -3, open -2, severity -2 = -7 → 80-7 = 73 → watch
    const result = applyZendeskPenalty(
      baseResult({ score: 80, tier: 'healthy' }),
      zd({ ticketVolume: 5, openCount: 2, highPriorityCount: 1 })
    );

    expect(result.score).toBe(73);
    expect(result.tier).toBe('watch');
    expect(result.zendeskPenalty).toBe(-7);
  });

  it('clamps score to 0 when penalty exceeds score', () => {
    // Base score 10, penalty -15 (volume -8 + open -7)
    const result = applyZendeskPenalty(
      baseResult({ score: 10, tier: 'critical' }),
      zd({ ticketVolume: 11, openCount: 6 })
    );

    expect(result.score).toBe(0);
    expect(result.tier).toBe('critical');
    expect(result.zendeskPenalty).toBe(-15);
  });

  it('handles null base score (unmapped account)', () => {
    const result = applyZendeskPenalty(
      baseResult({ score: null, tier: 'unmapped' }),
      zd({ ticketVolume: 5, openCount: 2 })
    );

    expect(result.score).toBeNull();
    expect(result.tier).toBe('unmapped');
    expect(result.zendeskPenalty).toBe(-5); // volume -3 + open -2
  });

  it('keeps healthy tier when penalty is small', () => {
    // Score 95, penalty -3 = 92 → still healthy
    const result = applyZendeskPenalty(
      baseResult({ score: 95, tier: 'healthy' }),
      zd({ ticketVolume: 3 })
    );

    expect(result.score).toBe(92);
    expect(result.tier).toBe('healthy');
    expect(result.zendeskPenalty).toBe(-3);
  });

  it('applies zero penalty when ticket data shows no issues', () => {
    const result = applyZendeskPenalty(
      baseResult({ score: 80, tier: 'healthy' }),
      zd()
    );

    expect(result.score).toBe(80);
    expect(result.tier).toBe('healthy');
    expect(result.zendeskPenalty).toBe(0);
  });
});
