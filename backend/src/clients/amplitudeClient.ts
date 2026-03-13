export interface AmplitudeSignals {
  dauWauTrend: number | null;    // fractional change, e.g. -0.15 = -15%
  featureAdoption: number | null; // fraction of features used, e.g. 0.42
  lastLoginDays: number | null;  // integer days since last login
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
 * Fetch DAU/WAU trend (28 days, comparing first 14 days to last 14 days)
 */
async function fetchDauWauTrend(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string
): Promise<number | null> {
  try {
    const startDate = toAmplitudeDate(daysAgo(28));
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
      e: JSON.stringify({ event_type: '_active' }),
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
        `Amplitude DAU/WAU query failed: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = (await response.json()) as SegmentationResponse;

    if (!data.data?.series?.[0] || data.data.series[0].length === 0) {
      return null;
    }

    const dailyCounts = data.data.series[0];

    // Split into two 14-day halves
    const first14 = dailyCounts.slice(0, 14);
    const last14 = dailyCounts.slice(-14);

    const first14avg =
      first14.length > 0
        ? first14.reduce((a, b) => a + b, 0) / first14.length
        : 0;
    const last14avg =
      last14.length > 0
        ? last14.reduce((a, b) => a + b, 0) / last14.length
        : 0;

    if (first14avg === 0) {
      return null;
    }

    return (last14avg - first14avg) / first14avg;
  } catch (error) {
    console.warn('Error fetching DAU/WAU trend:', error);
    return null;
  }
}

/**
 * Fetch feature adoption (30 days, count of active days / total features)
 */
async function fetchFeatureAdoption(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string,
  featuresTotal: number
): Promise<number | null> {
  try {
    const startDate = toAmplitudeDate(daysAgo(30));
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
      e: JSON.stringify({ event_type: '_active' }),
      m: 'uniques',
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
        `Amplitude feature adoption query failed: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = (await response.json()) as SegmentationResponse;

    if (!data.data?.series?.[0] || data.data.series[0].length === 0) {
      return null;
    }

    const dailyValues = data.data.series[0];

    // Count days with > 0 active users
    const activeDays = dailyValues.filter((val) => val > 0).length;

    // Clamp to [0, 1]
    let adoption = activeDays / featuresTotal;
    adoption = Math.max(0, Math.min(1, adoption));

    return adoption;
  } catch (error) {
    console.warn('Error fetching feature adoption:', error);
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
    // Parse YYYYMMDD format
    const year = parseInt(mostRecentDateStr.slice(0, 4), 10);
    const month = parseInt(mostRecentDateStr.slice(4, 6), 10) - 1;
    const day = parseInt(mostRecentDateStr.slice(6, 8), 10);

    const mostRecentDate = new Date(year, month, day);
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
  accountProperty: string,
  featuresTotal: number
): Promise<AmplitudeSignals> {
  const [dauWauTrend, featureAdoption, lastLoginDays] = await Promise.all([
    fetchDauWauTrend(apiKey, secretKey, accountAlias, accountProperty),
    fetchFeatureAdoption(
      apiKey,
      secretKey,
      accountAlias,
      accountProperty,
      featuresTotal
    ),
    fetchLastLoginDays(apiKey, secretKey, accountAlias, accountProperty),
  ]);

  return {
    dauWauTrend,
    featureAdoption,
    lastLoginDays,
  };
}
