import { FeatureEvent } from '../config';

export interface FeatureBreadth {
  used: string[];
  total: number;
}

export interface AmplitudeSignals {
  dauWauTrend: number | null;       // fractional change, e.g. -0.15 = -15%
  monthlyActiveUsers: number | null; // unique active users in the last 30 days
  featureBreadth: FeatureBreadth | null;
}

interface SegmentationResponse {
  data?: {
    series?: Array<number[]>;
    xValues?: string[];
  };
}

/**
 * Convert Date to Amplitude date format (YYYYMMDD)
 */
function toAmplitudeDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Get a Date n days before today
 */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/**
 * Build Basic Auth header value
 */
function buildBasicAuth(apiKey: string, secretKey: string): string {
  const credentials = `${apiKey}:${secretKey}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

/**
 * Fetch MAU trend: compares current 30-day unique users vs prior 30-day unique users.
 * Weekend-immune — uses 30-day aggregates, not daily counts.
 * Returns { trend, currentMAU } so fetchSignals avoids a duplicate MAU call.
 */
async function fetchMauTrend(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string
): Promise<{ trend: number | null; currentMAU: number | null }> {
  const [currentMAU, priorMAU] = await Promise.all([
    fetchMonthlyActiveUsers(apiKey, secretKey, accountAlias, accountProperty),         // days 1–30
    fetchMonthlyActiveUsers(apiKey, secretKey, accountAlias, accountProperty, 60, 31), // days 31–60
  ]);

  if (currentMAU === null || priorMAU === null || priorMAU === 0) {
    return { trend: null, currentMAU };
  }
  return { trend: (currentMAU - priorMAU) / priorMAU, currentMAU };
}

/**
 * Fetch Monthly Active Users (30-day unique users) for an account.
 * Uses Amplitude Segmentation API with i=30 to get the aggregate count
 * for the full 30-day window.
 *
 * CRITICAL: Account filter MUST go inside the event object's `filters` array,
 * NOT as a top-level `filters` query param. Amplitude silently ignores
 * top-level filters and returns global totals. This bug has bitten us twice.
 */
async function fetchMonthlyActiveUsers(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string,
  startDaysAgo = 30,
  endDaysAgo = 1
): Promise<number | null> {
  try {
    const startDate = toAmplitudeDate(daysAgo(startDaysAgo));
    const endDate = toAmplitudeDate(daysAgo(endDaysAgo));

    const params = new URLSearchParams({
      e: JSON.stringify({
        event_type: '_active',
        filters: [{
          subprop_type: 'user',
          subprop_key: accountProperty,
          subprop_op: 'is',
          subprop_value: [accountAlias],
        }],
      }),
      m: 'uniques',
      i: '30',
      start: startDate,
      end: endDate,
    });

    const response = await fetch(
      `https://amplitude.com/api/2/events/segmentation?${params}`,
      {
        method: 'GET',
        headers: {
          Authorization: buildBasicAuth(apiKey, secretKey),
        },
      }
    );

    if (!response.ok) {
      console.warn(
        `Amplitude MAU query failed: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = (await response.json()) as SegmentationResponse;

    if (!data.data?.series?.[0] || data.data.series[0].length === 0) {
      return null;
    }

    // With i=30, the API returns a single aggregate value for the 30-day window
    return data.data.series[0][0] ?? null;
  } catch (error) {
    console.warn('Error fetching monthly active users:', error);
    return null;
  }
}

/**
 * Check whether a single event type was fired in the last 30 days for an account.
 *
 * CRITICAL: Account filter MUST go inside the event object's `filters` array.
 */
async function checkFeatureUsed(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string,
  eventType: string
): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      e: JSON.stringify({
        event_type: eventType,
        filters: [{
          subprop_type: 'user',
          subprop_key: accountProperty,
          subprop_op: 'is',
          subprop_value: [accountAlias],
        }],
      }),
      m: 'totals',
      i: '30',
      start: toAmplitudeDate(daysAgo(30)),
      end: toAmplitudeDate(daysAgo(1)),
    });

    const response = await fetch(
      `https://amplitude.com/api/2/events/segmentation?${params}`,
      { headers: { Authorization: buildBasicAuth(apiKey, secretKey) } }
    );

    if (!response.ok) return false;

    const data = (await response.json()) as SegmentationResponse;
    if (!data.data?.series?.[0] || data.data.series[0].length === 0) return false;

    return data.data.series[0].some(v => v > 0);
  } catch {
    return false;
  }
}

/**
 * Fetch feature breadth: how many feature categories the account used in the last 30 days.
 */
async function fetchFeatureBreadth(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string,
  featureEvents: FeatureEvent[]
): Promise<FeatureBreadth | null> {
  try {
    const results = await Promise.all(
      featureEvents.map(async fe => ({
        category: fe.category,
        used: await checkFeatureUsed(apiKey, secretKey, accountAlias, accountProperty, fe.eventType),
      }))
    );

    const used = results.filter(r => r.used).map(r => r.category);
    return { used, total: featureEvents.length };
  } catch (error) {
    console.warn('Error fetching feature breadth:', error);
    return null;
  }
}

/**
 * Validate whether an alias has any historical activity in Amplitude.
 * Queries _active events for the last 365 days with i=30 (monthly buckets).
 * Returns true if any bucket has > 0 users, false if all are zero.
 */
export async function validateAlias(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string
): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      e: JSON.stringify({
        event_type: '_active',
        filters: [{
          subprop_type: 'user',
          subprop_key: accountProperty,
          subprop_op: 'is',
          subprop_value: [accountAlias],
        }],
      }),
      m: 'uniques',
      i: '30',
      start: toAmplitudeDate(daysAgo(365)),
      end: toAmplitudeDate(daysAgo(1)),
    });

    const response = await fetch(
      `https://amplitude.com/api/2/events/segmentation?${params}`,
      { headers: { Authorization: buildBasicAuth(apiKey, secretKey) } }
    );

    if (!response.ok) {
      console.warn(`Amplitude alias validation failed: ${response.status} ${response.statusText}`);
      return true; // fail-open: don't flag as not-found on API error
    }

    const data = (await response.json()) as SegmentationResponse;
    if (!data.data?.series?.[0]) return false;

    return data.data.series[0].some(v => v > 0);
  } catch (error) {
    console.warn('Error validating alias:', error);
    return true; // fail-open on network error
  }
}

/**
 * Fetch all Amplitude signals for an account
 */
export async function fetchSignals(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string,
  featureEvents: FeatureEvent[]
): Promise<AmplitudeSignals> {
  const [mauResult, featureBreadth] = await Promise.all([
    fetchMauTrend(apiKey, secretKey, accountAlias, accountProperty),
    fetchFeatureBreadth(apiKey, secretKey, accountAlias, accountProperty, featureEvents),
  ]);

  return {
    dauWauTrend: mauResult.trend,
    monthlyActiveUsers: mauResult.currentMAU,
    featureBreadth,
  };
}
