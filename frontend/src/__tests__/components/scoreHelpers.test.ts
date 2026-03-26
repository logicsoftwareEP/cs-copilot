import { describe, it, expect } from 'vitest';
import { dauWauInfo, licenseInfo, formatArr, renewalInfo } from '../../components/scoreHelpers';

describe('dauWauInfo', () => {
  it('returns "No data" when trend is null', () => {
    const result = dauWauInfo(null);
    expect(result.pts).toBe(0);
    expect(result.label).toBe('No data');
    expect(result.hint).toBeNull();
  });

  it('returns "Growing" for trend >= 0.1', () => {
    const result = dauWauInfo(0.15);
    expect(result.pts).toBe(25);
    expect(result.label).toBe('Growing');
    expect(result.detail).toContain('+15%');
  });

  it('returns "Stable" for trend between -0.1 and 0.1', () => {
    const result = dauWauInfo(0.05);
    expect(result.pts).toBe(15);
    expect(result.label).toBe('Stable');
  });

  it('returns "Declining" for trend between -0.3 and -0.1', () => {
    const result = dauWauInfo(-0.2);
    expect(result.pts).toBe(6);
    expect(result.label).toBe('Declining');
  });

  it('returns "Critical decline" for trend < -0.3', () => {
    const result = dauWauInfo(-0.5);
    expect(result.pts).toBe(0);
    expect(result.label).toBe('Critical decline');
  });
});

describe('licenseInfo', () => {
  it('returns "Not set" when licenses is null', () => {
    const result = licenseInfo(100, null);
    expect(result.pts).toBe(0);
    expect(result.label).toBe('Not set');
  });

  it('returns "No data" when mau is null', () => {
    const result = licenseInfo(null, 50);
    expect(result.pts).toBe(0);
    expect(result.label).toBe('No data');
  });

  it('returns 60 pts for >= 80% utilization', () => {
    const result = licenseInfo(90, 100);
    expect(result.pts).toBe(60);
    expect(result.label).toBe('90% utilisation');
  });

  it('returns 45 pts for >= 60% utilization', () => {
    const result = licenseInfo(70, 100);
    expect(result.pts).toBe(45);
    expect(result.label).toBe('70% utilisation');
  });

  it('returns 30 pts for >= 40% utilization', () => {
    const result = licenseInfo(50, 100);
    expect(result.pts).toBe(30);
    expect(result.label).toBe('50% utilisation');
  });

  it('returns 15 pts for >= 20% utilization', () => {
    const result = licenseInfo(25, 100);
    expect(result.pts).toBe(15);
    expect(result.label).toBe('25% utilisation');
  });

  it('returns 0 pts for < 20% utilization', () => {
    const result = licenseInfo(5, 100);
    expect(result.pts).toBe(0);
    expect(result.label).toBe('5% utilisation');
  });

  it('caps utilization at 100%', () => {
    const result = licenseInfo(200, 100);
    expect(result.pts).toBe(60);
    expect(result.label).toBe('100% utilisation');
  });
});

describe('formatArr', () => {
  it('returns dash for zero', () => {
    expect(formatArr(0)).toBe('—');
  });

  it('formats small values as dollar amounts', () => {
    expect(formatArr(500)).toBe('$500');
  });

  it('formats thousands with k suffix and one decimal', () => {
    expect(formatArr(1500)).toBe('$1.5k');
  });

  it('formats large thousands with k suffix and no decimal', () => {
    expect(formatArr(15000)).toBe('$15k');
  });
});

describe('renewalInfo', () => {
  it('returns none for empty date', () => {
    const result = renewalInfo('');
    expect(result.label).toBe('—');
    expect(result.urgency).toBe('none');
  });

  it('returns expired for past dates', () => {
    const past = new Date(Date.now() - 86_400_000 * 5).toISOString();
    const result = renewalInfo(past);
    expect(result.label).toBe('Expired');
    expect(result.urgency).toBe('expired');
  });

  it('returns urgent for dates within 30 days', () => {
    const soon = new Date(Date.now() + 86_400_000 * 15).toISOString();
    const result = renewalInfo(soon);
    expect(result.urgency).toBe('urgent');
    expect(result.label).toMatch(/^\d+d$/);
  });

  it('returns soon for dates within 90 days', () => {
    const mid = new Date(Date.now() + 86_400_000 * 60).toISOString();
    const result = renewalInfo(mid);
    expect(result.urgency).toBe('soon');
    expect(result.label).toMatch(/^\d+d$/);
  });

  it('returns ok for dates beyond 90 days', () => {
    const far = new Date(Date.now() + 86_400_000 * 200).toISOString();
    const result = renewalInfo(far);
    expect(result.urgency).toBe('ok');
  });
});
