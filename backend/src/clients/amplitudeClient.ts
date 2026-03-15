export interface AmplitudeSignals {
  dauWauTrend: number | null;       // fractional change, e.g. -0.15 = -15%
  monthlyActiveUsers: number | null; // unique active users in the last 30 days
  lastLoginDays: number | null;     // integer days since last login
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

    const filters = JSON.stringify([
      {
        subprop_type: 'user',
        subprop_key: accountProperty,
        subprop_op: 'is',
        subprop_value: [accountAlias],
      },
    ]);

    const params = new URLSearchParams({
      e: JSON.stringify({ event_type: '_active' }),
      m: 'uniques',
      i: '30',
      start: startDate,
      end: endDate,
      filters,
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
 * Fetch last login (90 days, days since most recent non-zero session start)
 */
async function fetchLastLoginDays(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string
): Promise<number | null> {
  try {
    const startDate = toAmplitudeDate(daysAgo(90));
    const endDate = toAmplitudeDate(daysAgo(1));

    const filters = JSON.stringify([
      {
        subprop_type: 'user',
        subprop_key: accountProperty,
        subprop_op: 'is',
        subprop_value: [accountAlias],
      },
    ]);

    const params = new URLSearchParams({
      e: JSON.stringify({ event_type: '_session_start' }),
      m: 'totals',
      i: '1',
      start: startDate,
      end: endDate,
      filters,
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
        `Amplitude last login query failed: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = (await response.json()) as SegmentationResponse;

    if (!data.data?.series?.[0] || !data.data.xValues) {
      return null;
    }

    const counts = data.data.series[0];
    const xValues = data.data.xValues;

    // Find the most recent date (highest index) with > 0 count
    let mostRecentIdx = -1;
    for (let i = counts.length - 1; i >= 0; i--) {
      if (counts[i] > 0) {
        mostRecentIdx = i;
        break;
      }
    }

    if (mostRecentIdx === -1) {
      // No non-zero entry found
      return null;
    }

    const mostRecentDateStr = xValues[mostRecentIdx];
    // Amplitude xValues are returned as "YYYY-MM-DD"; new Date() handles both ISO formats.
    const mostRecentDate = new Date(mostRecentDateStr);
    const today = new Date();
    const diffMs = today.getTime() - mostRecentDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    return diffDays;
  } catch (error) {
    console.warn('Error fetching last login days:', error);
    return null;
  }
}

/**
 * Fetch all Amplitude signals for an account
 */
export async function fetchSignals(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string
): Promise<AmplitudeSignals> {
  const [mauResult, lastLoginDays] = await Promise.all([
    fetchMauTrend(apiKey, secretKey, accountAlias, accountProperty),
    fetchLastLoginDays(apiKey, secretKey, accountAlias, accountProperty),
  ]);

  return {
    dauWauTrend: mauResult.trend,
    monthlyActiveUsers: mauResult.currentMAU,
    lastLoginDays,
  };
}
