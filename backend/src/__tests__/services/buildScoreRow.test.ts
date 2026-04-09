import { buildScoreRow, ScoreRowInput } from '../../services/healthScoreService';
import { AmplitudeSignals, FeatureBreadth } from '../../clients/amplitudeClient';

function sig(overrides: Partial<AmplitudeSignals> = {}): AmplitudeSignals {
  return { dauWauTrend: null, monthlyActiveUsers: null, featureBreadth: null, ...overrides };
}

function fb(usedCount: number, total = 12): FeatureBreadth {
  const categories = [
    'Activity Center', 'Time Tracking', 'Resources', 'Reporting',
    'Dashboards', 'Financials', 'Invoices', 'Custom Forms',
    'AI Features', 'Collaboration', 'Workload', 'Settings',
  ];
  return { used: categories.slice(0, usedCount), total };
}

const featureEvents = [
  { category: 'Activity Center' }, { category: 'Time Tracking' },
  { category: 'Resources' }, { category: 'Reporting' },
  { category: 'Dashboards' }, { category: 'Financials' },
  { category: 'Invoices' }, { category: 'Custom Forms' },
  { category: 'AI Features' }, { category: 'Collaboration' },
  { category: 'Workload' }, { category: 'Settings' },
];

function base(overrides: Partial<ScoreRowInput> = {}): ScoreRowInput {
  return {
    accountId: 'acc-1', date: '2026-03-26',
    signals: null, licenses: null, featureEvents,
    zendeskData: null, intercomData: null,
    previousScore: null, aliasStatus: null,
    ...overrides,
  };
}

describe('buildScoreRow', () => {
  // Pattern 1: unmapped (no alias)
  it('returns unmapped row when signals is null', () => {
    const row = buildScoreRow(base());
    expect(row.score).toBeNull();
    expect(row.tier).toBe('unmapped');
    expect(row.aliasStatus).toBeNull();
    expect(row.scoreDelta).toBeNull();
    expect(row.dauWauTrend).toBeNull();
  });

  it('computes zendesk penalty for unmapped accounts', () => {
    const row = buildScoreRow(base({
      zendeskData: { ticketVolume: 5, openCount: 3, highPriorityCount: 0, urgentCount: 0 },
    }));
    expect(row.score).toBeNull();
    expect(row.zendeskPenalty).toBe(-7); // volume -3 + open -4
    expect(row.zendeskDetails).not.toBeNull();
  });

  // Pattern 2: alias not found
  it('propagates aliasStatus not-found', () => {
    const row = buildScoreRow(base({ aliasStatus: 'not-found' }));
    expect(row.score).toBeNull();
    expect(row.tier).toBe('unmapped');
    expect(row.aliasStatus).toBe('not-found');
  });

  // Pattern 3: successful scoring
  it('computes score correctly with all signals', () => {
    const row = buildScoreRow(base({
      signals: sig({ dauWauTrend: 0.15, monthlyActiveUsers: 80, featureBreadth: fb(10) }),
      licenses: 100,
      aliasStatus: 'valid',
    }));
    expect(row.score).toBe(100);
    expect(row.tier).toBe('healthy');
    expect(row.aliasStatus).toBe('valid');
    expect(row.licenseUtilization).toBeCloseTo(0.8);
  });

  it('builds featureDetails JSON from featureEvents', () => {
    const row = buildScoreRow(base({
      signals: sig({ dauWauTrend: 0.1, featureBreadth: fb(3) }),
      aliasStatus: 'valid',
    }));
    const details = JSON.parse(row.featureDetails!);
    expect(details['Activity Center']).toBe(true);
    expect(details['Time Tracking']).toBe(true);
    expect(details['Resources']).toBe(true);
    expect(details['Reporting']).toBe(false);
  });

  it('computes scoreDelta from previousScore', () => {
    const row = buildScoreRow(base({
      signals: sig({ dauWauTrend: 0.15, monthlyActiveUsers: 80, featureBreadth: fb(10) }),
      licenses: 100,
      previousScore: 90,
      aliasStatus: 'valid',
    }));
    expect(row.scoreDelta).toBe(10); // 100 - 90
  });

  it('scoreDelta is null when previousScore is null', () => {
    const row = buildScoreRow(base({
      signals: sig({ dauWauTrend: 0.15 }),
      aliasStatus: 'valid',
    }));
    expect(row.scoreDelta).toBeNull();
  });

  it('applies zendesk and intercom penalties to scored accounts', () => {
    const row = buildScoreRow(base({
      signals: sig({ dauWauTrend: 0.15, monthlyActiveUsers: 80, featureBreadth: fb(10) }),
      licenses: 100,
      zendeskData: { ticketVolume: 12, openCount: 7, highPriorityCount: 0, urgentCount: 1 },
      intercomData: { openCount: 6, conversationVolume: 10, avgResponseTime: 100000, quickResolutions: 2, aiHandled: 1, avgCxScore: null, cxScoreCount: 0 },
      aliasStatus: 'valid',
    }));
    // Base: 100, zendesk penalty: -8 + -7 + -5 = -20, intercom penalty: -7 + -5 = -12
    // Combined cap: -20, then intercom bonus: +1 (quickRes) + +1 (ai) = +2
    // Final: 100 - 20 + 2 = 82
    expect(row.score).toBe(82);
    expect(row.tier).toBe('healthy');
    expect(row.zendeskPenalty).not.toBeNull();
    expect(row.intercomPenalty).not.toBeNull();
    expect(row.intercomDetails).not.toBeNull();
  });

  // Pattern 4: error fallback (signals=null, aliasStatus=valid)
  it('handles error fallback with aliasStatus valid', () => {
    const row = buildScoreRow(base({ aliasStatus: 'valid' }));
    expect(row.score).toBeNull();
    expect(row.tier).toBe('unmapped');
    expect(row.aliasStatus).toBe('valid');
  });
});
