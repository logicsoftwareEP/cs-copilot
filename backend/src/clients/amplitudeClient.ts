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
 * Convert Date to Amplitude date format (YYYYMMDD) using UTC components.
 */
export function toAmplitudeDate(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Get a Date n days before today, pinned to UTC midnight.
 * Eliminates score variability from shifting query windows across syncs.
 */
export function daysAgo(n: number): Date {
  const now = new Date();
  const todayMidnightUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(todayMidnightUTC - n * 24 * 60 * 60 * 1000);
}

/**
 * Build Basic Auth header value
 */
function buildBasicAuth(apiKey: string, secretKey: string): string {
  const credentials = `${apiKey}:${secretKey}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

// ── Rate-limited fetch for Amplitude API ─────────────────────────────────────

const MAX_CONCURRENT = 4;   // Amplitude allows 5 concurrent; stay under
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 5000; // 5s base, exponential: 5s, 10s, 20s, 40s

let activeRequests = 0;
const queue: Array<{ resolve: () => void }> = [];

async function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return;
  }
  return new Promise(resolve => queue.push({ resolve }));
}

function releaseSlot(): void {
  if (queue.length > 0) {
    const next = queue.shift()!;
    next.resolve();
  } else {
    activeRequests--;
  }
}

/**
 * Fetch with concurrency limiting and retry on 429.
 * All Amplitude API calls MUST use this instead of raw fetch.
 */
async function amplitudeFetch(url: string, headers: Record<string, string>): Promise<Response> {
  await acquireSlot();
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url, { method: 'GET', headers });
      if (response.status !== 429) return response;

      // 429: wait with exponential backoff before retrying
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      } else {
        return response; // exhausted retries, return the 429
      }
    }
    // unreachable, but TypeScript needs it
    throw new Error('unreachable');
  } finally {
    releaseSlot();
  }
}

// ── API functions ────────────────────────────────────────────────────────────

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
  // Sequential to reduce concurrent load
  const currentMAU = await fetchMonthlyActiveUsers(apiKey, secretKey, accountAlias, accountProperty);
  const priorMAU = await fetchMonthlyActiveUsers(apiKey, secretKey, accountAlias, accountProperty, 60, 31);

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

    const response = await amplitudeFetch(
      `https://amplitude.com/api/2/events/segmentation?${params}`,
      { Authorization: buildBasicAuth(apiKey, secretKey) }
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

    const response = await amplitudeFetch(
      `https://amplitude.com/api/2/events/segmentation?${params}`,
      { Authorization: buildBasicAuth(apiKey, secretKey) }
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
 * Calls are serialized to avoid bursting the Amplitude rate limit.
 */
async function fetchFeatureBreadth(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string,
  featureEvents: FeatureEvent[]
): Promise<FeatureBreadth | null> {
  try {
    // Sequential to stay within rate limits (each call goes through amplitudeFetch queue)
    const used: string[] = [];
    for (const fe of featureEvents) {
      const isUsed = await checkFeatureUsed(apiKey, secretKey, accountAlias, accountProperty, fe.eventType);
      if (isUsed) used.push(fe.category);
    }
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

    const response = await amplitudeFetch(
      `https://amplitude.com/api/2/events/segmentation?${params}`,
      { Authorization: buildBasicAuth(apiKey, secretKey) }
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
 * Fetch all Amplitude signals for an account.
 * MAU trend runs first; feature breadth is skipped when there are no active users
 * (saves 12 API calls per inactive account).
 */
export async function fetchSignals(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string,
  featureEvents: FeatureEvent[]
): Promise<AmplitudeSignals> {
  const mauResult = await fetchMauTrend(apiKey, secretKey, accountAlias, accountProperty);

  // Skip feature queries if no active users — no point checking 12 events
  if (!mauResult.currentMAU || mauResult.currentMAU === 0) {
    return {
      dauWauTrend: mauResult.trend,
      monthlyActiveUsers: mauResult.currentMAU,
      featureBreadth: { used: [], total: featureEvents.length },
    };
  }

  const featureBreadth = await fetchFeatureBreadth(apiKey, secretKey, accountAlias, accountProperty, featureEvents);

  return {
    dauWauTrend: mauResult.trend,
    monthlyActiveUsers: mauResult.currentMAU,
    featureBreadth,
  };
}
