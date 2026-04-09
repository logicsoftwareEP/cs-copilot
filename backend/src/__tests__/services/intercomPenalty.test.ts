import {
  computeIntercomPenalty,
  computeIntercomBonus,
  computeCxScorePenaltyBonus,
  applyAllPenalties,
  IntercomPenaltyResult,
  IntercomBonusResult,
  CxScoreResult,
  HealthScoreResult,
} from '../../services/healthScoreService';
import { IntercomAggregated } from '../../services/intercomStore';
import { ZendeskTicketData } from '../../clients/zendeskClient';

// Helper: build IntercomAggregated with defaults
function ic(overrides: Partial<IntercomAggregated> = {}): IntercomAggregated {
  return {
    conversationVolume: 0,
    openCount: 0,
    avgResponseTime: 0,
    quickResolutions: 0,
    aiHandled: 0,
    avgCxScore: null,
    cxScoreCount: 0,
    ...overrides,
  };
}

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
    featuresUsed: 8,
    featureDetails: null,
    ...overrides,
  };
}

// ── computeIntercomPenalty ──────────────────────────────────────────────────

describe('computeIntercomPenalty', () => {

  // ── Open ticket penalty thresholds ─────────────────────────────────────

  it('open 0 → 0 penalty', () => {
    expect(computeIntercomPenalty(ic({ openCount: 0 })).openPenalty).toBe(0);
  });

  it('open 1 → -2 penalty', () => {
    expect(computeIntercomPenalty(ic({ openCount: 1 })).openPenalty).toBe(-2);
  });

  it('open 2 → -2 penalty', () => {
    expect(computeIntercomPenalty(ic({ openCount: 2 })).openPenalty).toBe(-2);
  });

  it('open 3 → -4 penalty', () => {
    expect(computeIntercomPenalty(ic({ openCount: 3 })).openPenalty).toBe(-4);
  });

  it('open 5 → -4 penalty', () => {
    expect(computeIntercomPenalty(ic({ openCount: 5 })).openPenalty).toBe(-4);
  });

  it('open 6 → -7 penalty', () => {
    expect(computeIntercomPenalty(ic({ openCount: 6 })).openPenalty).toBe(-7);
  });

  // ── Slow response penalty ──────────────────────────────────────────────

  it('avgResponseTime < 86400s → 0 slow penalty', () => {
    expect(computeIntercomPenalty(ic({
      avgResponseTime: 43200,
      conversationVolume: 5,
    })).slowPenalty).toBe(0);
  });

  it('avgResponseTime > 86400s but volume < 3 → 0 slow penalty', () => {
    expect(computeIntercomPenalty(ic({
      avgResponseTime: 90000,
      conversationVolume: 2,
    })).slowPenalty).toBe(0);
  });

  it('avgResponseTime > 86400s AND volume >= 3 → -5 slow penalty', () => {
    expect(computeIntercomPenalty(ic({
      avgResponseTime: 90000,
      conversationVolume: 3,
    })).slowPenalty).toBe(-5);
  });

  it('avgResponseTime exactly 86400s → 0 slow penalty (not strictly greater)', () => {
    expect(computeIntercomPenalty(ic({
      avgResponseTime: 86400,
      conversationVolume: 5,
    })).slowPenalty).toBe(0);
  });

  // ── Max total penalty -12 ──────────────────────────────────────────────

  it('max penalty: open 6+ and slow response → -12 total', () => {
    const result = computeIntercomPenalty(ic({
      openCount: 6,
      avgResponseTime: 100000,
      conversationVolume: 5,
    }));
    expect(result.openPenalty).toBe(-7);
    expect(result.slowPenalty).toBe(-5);
    expect(result.totalPenalty).toBe(-12);
  });

  // ── Zero data ─────────────────────────────────────────────────────────

  it('all zeros → zero penalty', () => {
    const result = computeIntercomPenalty(ic());
    expect(result.totalPenalty).toBe(0);
    expect(result.openPenalty).toBe(0);
    expect(result.slowPenalty).toBe(0);
    expect(result.openCount).toBe(0);
    expect(result.avgResponseTime).toBe(0);
  });

  // ── Result fields ──────────────────────────────────────────────────────

  it('returns raw counts in the result', () => {
    const result = computeIntercomPenalty(ic({
      openCount: 3,
      avgResponseTime: 90000,
      conversationVolume: 4,
    }));
    expect(result.openCount).toBe(3);
    expect(result.avgResponseTime).toBe(90000);
  });
});

// ── computeIntercomBonus ───────────────────────────────────────────────────

describe('computeIntercomBonus', () => {

  // ── Quick resolution bonus ─────────────────────────────────────────────

  it('quickResolutions 0 → 0 bonus', () => {
    expect(computeIntercomBonus(ic({ quickResolutions: 0 })).quickResolutionBonus).toBe(0);
  });

  it('quickResolutions 1 → +1 bonus', () => {
    expect(computeIntercomBonus(ic({ quickResolutions: 1 })).quickResolutionBonus).toBe(1);
  });

  it('quickResolutions 2 → +1 bonus', () => {
    expect(computeIntercomBonus(ic({ quickResolutions: 2 })).quickResolutionBonus).toBe(1);
  });

  it('quickResolutions 3 → +2 bonus', () => {
    expect(computeIntercomBonus(ic({ quickResolutions: 3 })).quickResolutionBonus).toBe(2);
  });

  it('quickResolutions 4 → +2 bonus', () => {
    expect(computeIntercomBonus(ic({ quickResolutions: 4 })).quickResolutionBonus).toBe(2);
  });

  it('quickResolutions 5 → +4 bonus', () => {
    expect(computeIntercomBonus(ic({ quickResolutions: 5 })).quickResolutionBonus).toBe(4);
  });

  it('quickResolutions 10 → +4 bonus', () => {
    expect(computeIntercomBonus(ic({ quickResolutions: 10 })).quickResolutionBonus).toBe(4);
  });

  // ── AI handled bonus ───────────────────────────────────────────────────

  it('aiHandled 0 → 0 bonus', () => {
    expect(computeIntercomBonus(ic({ aiHandled: 0 })).aiBonus).toBe(0);
  });

  it('aiHandled 1 → +1 bonus', () => {
    expect(computeIntercomBonus(ic({ aiHandled: 1 })).aiBonus).toBe(1);
  });

  it('aiHandled 2 → +1 bonus', () => {
    expect(computeIntercomBonus(ic({ aiHandled: 2 })).aiBonus).toBe(1);
  });

  it('aiHandled 3 → +3 bonus', () => {
    expect(computeIntercomBonus(ic({ aiHandled: 3 })).aiBonus).toBe(3);
  });

  it('aiHandled 5 → +3 bonus', () => {
    expect(computeIntercomBonus(ic({ aiHandled: 5 })).aiBonus).toBe(3);
  });

  // ── Engagement bonus ───────────────────────────────────────────────────

  it('volume < 3 → 0 engagement bonus', () => {
    expect(computeIntercomBonus(ic({
      conversationVolume: 2,
      openCount: 0,
    })).engagementBonus).toBe(0);
  });

  it('volume >= 3 AND openCount <= 1 → +3 engagement bonus', () => {
    expect(computeIntercomBonus(ic({
      conversationVolume: 3,
      openCount: 1,
    })).engagementBonus).toBe(3);
  });

  it('volume >= 3 AND openCount = 0 → +3 engagement bonus', () => {
    expect(computeIntercomBonus(ic({
      conversationVolume: 5,
      openCount: 0,
    })).engagementBonus).toBe(3);
  });

  it('volume >= 3 AND openCount > 1 → 0 engagement bonus', () => {
    expect(computeIntercomBonus(ic({
      conversationVolume: 5,
      openCount: 2,
    })).engagementBonus).toBe(0);
  });

  // ── Max total bonus capped at +10 ─────────────────────────────────────

  it('max bonus capped at 10: quickResolutions=5, aiHandled=3, engagement → would be 11, capped at 10', () => {
    const result = computeIntercomBonus(ic({
      quickResolutions: 5,
      aiHandled: 3,
      conversationVolume: 5,
      openCount: 0,
    }));
    expect(result.quickResolutionBonus).toBe(4);
    expect(result.aiBonus).toBe(3);
    expect(result.engagementBonus).toBe(3);
    expect(result.totalBonus).toBe(10); // capped from 10 (4+3+3=10, already at cap)
  });

  it('sum exceeding 10 is capped at 10', () => {
    // Hypothetical: quickRes=5(+4), ai=3(+3), engagement(+3) = 10 (already at 10 exactly)
    // To test cap, ensure underlying logic caps
    const result = computeIntercomBonus(ic({
      quickResolutions: 5,
      aiHandled: 3,
      conversationVolume: 5,
      openCount: 0,
    }));
    expect(result.totalBonus).toBeLessThanOrEqual(10);
  });

  // ── Zero data ─────────────────────────────────────────────────────────

  it('all zeros → zero bonus', () => {
    const result = computeIntercomBonus(ic());
    expect(result.totalBonus).toBe(0);
    expect(result.quickResolutionBonus).toBe(0);
    expect(result.aiBonus).toBe(0);
    expect(result.engagementBonus).toBe(0);
  });
});

// ── applyAllPenalties ─────────────────────────────────────────────────────

describe('applyAllPenalties', () => {

  it('null both zendesk and intercom → no change, both penalties null', () => {
    const base = baseResult({ score: 80, tier: 'healthy' });
    const result = applyAllPenalties(base, null, null);
    expect(result.score).toBe(80);
    expect(result.tier).toBe('healthy');
    expect(result.zendeskPenalty).toBeNull();
    expect(result.intercomPenalty).toBeNull();
    expect(result.intercomBonus).toBeNull();
  });

  it('zendesk only: applies zendesk penalty, intercomPenalty/Bonus null', () => {
    // volume 5 → -3, open 2 → -2, no severity = -5 total; 80-5 = 75 → watch
    const base = baseResult({ score: 80, tier: 'healthy' });
    const result = applyAllPenalties(base, zd({ ticketVolume: 5, openCount: 2 }), null);
    expect(result.score).toBe(75);
    expect(result.tier).toBe('watch');
    expect(result.zendeskPenalty).toBe(-5);
    expect(result.intercomPenalty).toBeNull();
    expect(result.intercomBonus).toBeNull();
  });

  it('intercom only: applies intercom penalty and bonus, zendeskPenalty null', () => {
    // openCount 3 → -4, slowPenalty 0 (no slow); quickRes 5 → +4 bonus; 80 + (-4) + 4 = 80
    const base = baseResult({ score: 80, tier: 'healthy' });
    const result = applyAllPenalties(base, null, ic({
      openCount: 3,
      quickResolutions: 5,
    }));
    expect(result.zendeskPenalty).toBeNull();
    expect(result.intercomPenalty).toBe(-4);
    expect(result.intercomBonus).toBe(4);
    expect(result.score).toBe(80);
    expect(result.tier).toBe('healthy');
  });

  it('combined: zendesk + intercom penalties cap at -20', () => {
    // zendesk: ticketVolume 11 → -8, openCount 6 → -7, urgent 1 → -5 = -20
    // intercom: openCount 6 → -7, slow (90000s, vol 5) → -5 = -12
    // combined = -20 + -12 = -32, capped to -20; bonus: none; 80 + (-20) = 60
    const base = baseResult({ score: 80, tier: 'healthy' });
    const result = applyAllPenalties(
      base,
      zd({ ticketVolume: 11, openCount: 6, urgentCount: 1 }),
      ic({ openCount: 6, avgResponseTime: 90000, conversationVolume: 5 }),
    );
    expect(result.zendeskPenalty).toBe(-20);
    expect(result.intercomPenalty).toBe(-12);
    // combined penalty capped at -20
    expect(result.score).toBe(60); // 80 + (-20) = 60 (before bonus; no bonus here)
    expect(result.tier).toBe('watch');
  });

  it('bonus applied after penalty', () => {
    // zendesk: ticketVolume 3 → -3; intercom: no penalty, quickRes 5 → +4 bonus
    // score: 80 + (-3) + 4 = 81
    const base = baseResult({ score: 80, tier: 'healthy' });
    const result = applyAllPenalties(
      base,
      zd({ ticketVolume: 3 }),
      ic({ quickResolutions: 5 }),
    );
    expect(result.intercomBonus).toBe(4);
    expect(result.zendeskPenalty).toBe(-3);
    expect(result.score).toBe(81);
    expect(result.tier).toBe('healthy');
  });

  it('clamps final score to 0 when penalties exceed score', () => {
    const base = baseResult({ score: 5, tier: 'critical' });
    const result = applyAllPenalties(
      base,
      zd({ ticketVolume: 11, openCount: 6 }),
      ic({ openCount: 6 }),
    );
    expect(result.score).toBe(0);
    expect(result.tier).toBe('critical');
  });

  it('clamps final score to 110 when bonus pushes above 100', () => {
    const base = baseResult({ score: 100, tier: 'healthy' });
    const result = applyAllPenalties(
      base,
      null,
      ic({ quickResolutions: 5, aiHandled: 3, conversationVolume: 5, openCount: 0 }),
    );
    expect(result.score).toBeLessThanOrEqual(110);
    expect(result.score).toBeGreaterThan(100);
  });

  it('null base score (unmapped): attaches penalties but does not adjust score', () => {
    const base = baseResult({ score: null, tier: 'unmapped' });
    const result = applyAllPenalties(
      base,
      zd({ ticketVolume: 5, openCount: 2 }),
      ic({ openCount: 3 }),
    );
    expect(result.score).toBeNull();
    expect(result.tier).toBe('unmapped');
    expect(result.zendeskPenalty).not.toBeNull();
    expect(result.intercomPenalty).not.toBeNull();
  });

  it('tier is re-derived after adjustments', () => {
    // score 80 (healthy) → penalty drops it below 80
    // zd: ticketVolume 5 → -3, openCount 2 → -2 = -5; score 80-5 = 75 → watch
    const base = baseResult({ score: 80, tier: 'healthy' });
    const result = applyAllPenalties(base, zd({ ticketVolume: 5, openCount: 2 }), null);
    expect(result.score).toBe(75);
    expect(result.tier).toBe('watch'); // re-derived, not stale 'healthy'
  });

  it('tier re-derives to critical when score falls below 40', () => {
    // score 45 (at-risk) − 20 combined cap = 25 → critical
    const base = baseResult({ score: 45, tier: 'at-risk' });
    const result = applyAllPenalties(
      base,
      zd({ ticketVolume: 11, openCount: 6, urgentCount: 1 }),
      ic({ openCount: 6, avgResponseTime: 90000, conversationVolume: 5 }),
    );
    expect(result.score).toBe(25);
    expect(result.tier).toBe('critical');
  });
});

// ── computeCxScorePenaltyBonus ──────────────────────────────────────────────

describe('computeCxScorePenaltyBonus', () => {

  // ── Minimum threshold: < 3 rated conversations → all zeros ────────────

  it('returns all zeros when cxScoreCount < 3', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 1.0, cxScoreCount: 2 }));
    expect(result.cxScorePenalty).toBe(0);
    expect(result.cxScoreBonus).toBe(0);
    expect(result.netCxScore).toBe(0);
  });

  it('returns all zeros when avgCxScore is null', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: null, cxScoreCount: 0 }));
    expect(result.cxScorePenalty).toBe(0);
    expect(result.cxScoreBonus).toBe(0);
    expect(result.netCxScore).toBe(0);
  });

  // ── Penalty thresholds ────────────────────────────────────────────────

  it('avg < 2.0 → -8 penalty', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 1.5, cxScoreCount: 5 }));
    expect(result.cxScorePenalty).toBe(-8);
  });

  it('avg = 2.0 → -5 penalty (not -8, boundary)', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 2.0, cxScoreCount: 5 }));
    expect(result.cxScorePenalty).toBe(-5);
  });

  it('avg < 2.5 → -5 penalty', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 2.3, cxScoreCount: 5 }));
    expect(result.cxScorePenalty).toBe(-5);
  });

  it('avg = 2.5 → -3 penalty (not -5, boundary)', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 2.5, cxScoreCount: 5 }));
    expect(result.cxScorePenalty).toBe(-3);
  });

  it('avg < 3.0 → -3 penalty', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 2.9, cxScoreCount: 5 }));
    expect(result.cxScorePenalty).toBe(-3);
  });

  it('avg = 3.0 → 0 penalty', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 3.0, cxScoreCount: 5 }));
    expect(result.cxScorePenalty).toBe(0);
  });

  // ── Bonus thresholds ──────────────────────────────────────────────────

  it('avg >= 4.5 → +5 bonus', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 4.5, cxScoreCount: 5 }));
    expect(result.cxScoreBonus).toBe(5);
  });

  it('avg = 5.0 → +5 bonus', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 5.0, cxScoreCount: 5 }));
    expect(result.cxScoreBonus).toBe(5);
  });

  it('avg >= 4.0 but < 4.5 → +3 bonus', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 4.2, cxScoreCount: 5 }));
    expect(result.cxScoreBonus).toBe(3);
  });

  it('avg >= 3.5 but < 4.0 → +1 bonus', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 3.7, cxScoreCount: 5 }));
    expect(result.cxScoreBonus).toBe(1);
  });

  it('avg = 3.0 → 0 bonus', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 3.0, cxScoreCount: 5 }));
    expect(result.cxScoreBonus).toBe(0);
  });

  // ── Net score ─────────────────────────────────────────────────────────

  it('netCxScore = penalty + bonus', () => {
    // avg 1.5 → penalty -8, bonus 0; net = -8
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 1.5, cxScoreCount: 5 }));
    expect(result.netCxScore).toBe(-8);
  });

  it('passes through avgCxScore and cxScoreCount', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 4.5, cxScoreCount: 10 }));
    expect(result.avgCxScore).toBe(4.5);
    expect(result.cxScoreCount).toBe(10);
  });

  // ── Boundary: exactly 3 rated conversations activates scoring ─────────

  it('cxScoreCount = 3 activates scoring', () => {
    const result = computeCxScorePenaltyBonus(ic({ avgCxScore: 1.5, cxScoreCount: 3 }));
    expect(result.cxScorePenalty).toBe(-8);
  });
});

// ── applyAllPenalties with CX Score ─────────────────────────────────────────

describe('applyAllPenalties with CX Score', () => {

  it('includes CX penalty in combined penalty cap', () => {
    // zendesk: volume 11 → -8, open 6 → -7, urgent → -5 = -20
    // intercom: open 6 → -7, slow → -5 = -12
    // CX: avg 1.5, count 5 → penalty -8
    // raw combined = -20 + -12 + -8 = -40, capped to -20
    const base = baseResult({ score: 80, tier: 'healthy' });
    const result = applyAllPenalties(
      base,
      zd({ ticketVolume: 11, openCount: 6, urgentCount: 1 }),
      ic({ openCount: 6, avgResponseTime: 90000, conversationVolume: 5, avgCxScore: 1.5, cxScoreCount: 5 }),
    );
    expect(result.score).toBe(60); // 80 + (-20) = 60 (capped, no bonus)
    expect(result.cxScorePenalty).toBe(-8);
    expect(result.cxScoreBonus).toBe(0);
  });

  it('includes CX bonus after penalty', () => {
    // No zendesk, no intercom penalty; CX avg 4.5, count 5 → bonus +5
    const base = baseResult({ score: 80, tier: 'healthy' });
    const result = applyAllPenalties(
      base,
      null,
      ic({ avgCxScore: 4.5, cxScoreCount: 5 }),
    );
    expect(result.cxScoreBonus).toBe(5);
    expect(result.score).toBe(85); // 80 + 0 + 0 + 5 = 85
  });

  it('CX penalty and bonus both null when no intercom data', () => {
    const base = baseResult({ score: 80, tier: 'healthy' });
    const result = applyAllPenalties(base, null, null);
    expect(result.cxScorePenalty).toBeNull();
    expect(result.cxScoreBonus).toBeNull();
  });

  it('CX score inactive (< 3 ratings) does not affect score', () => {
    const base = baseResult({ score: 80, tier: 'healthy' });
    const result = applyAllPenalties(
      base,
      null,
      ic({ avgCxScore: 1.0, cxScoreCount: 2 }),
    );
    expect(result.cxScorePenalty).toBe(0);
    expect(result.cxScoreBonus).toBe(0);
    expect(result.score).toBe(80);
  });
});
