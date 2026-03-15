export interface ZendeskTicketData {
  ticketVolume: number;
  openCount: number;
  highPriorityCount: number;
  urgentCount: number;
}

interface ZendeskSearchResponse {
  results: Array<{ priority?: string | null }>;
  next_page: string | null;
  count?: number;
}

/** Maximum pages to fetch per query (each page = 100 results). */
const MAX_PAGES = 5;

/**
 * Build Basic Auth header value for Zendesk API.
 * Uses the {email}/token:{apiToken} convention.
 */
function buildBasicAuth(email: string, apiToken: string): string {
  const credentials = `${email}/token:${apiToken}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

/**
 * Format a Date as YYYY-MM-DD for Zendesk search queries.
 */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch all results for a Zendesk search query, paginating up to MAX_PAGES.
 * Returns the raw ticket results array.
 */
async function fetchSearchResults(
  baseUrl: string,
  query: string,
  authHeader: string
): Promise<Array<{ priority?: string | null }> | null> {
  const allResults: Array<{ priority?: string | null }> = [];
  let url: string | null =
    `${baseUrl}/api/v2/search.json?query=${encodeURIComponent(query)}`;
  let page = 0;

  while (url && page < MAX_PAGES) {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(
        `Zendesk search failed: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = (await response.json()) as ZendeskSearchResponse;
    allResults.push(...data.results);
    url = data.next_page;
    page++;
  }

  return allResults;
}

/**
 * Fetch Zendesk ticket data for a given domain.
 *
 * Runs two queries:
 * 1. Recent tickets (last 30 days) -- for volume and severity counts
 * 2. Currently open/pending/new tickets -- for open count regardless of age
 *
 * Returns null on any error (null = "couldn't check", not zeros = "checked, clean").
 */
export async function fetchZendeskTickets(
  subdomain: string,
  email: string,
  apiToken: string,
  domain: string
): Promise<ZendeskTicketData | null> {
  try {
    const baseUrl = `https://${subdomain}.zendesk.com`;
    const authHeader = buildBasicAuth(email, apiToken);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = toIsoDate(thirtyDaysAgo);

    // Query 1: volume + severity (tickets created in the last 30 days)
    const volumeQuery =
      `type:ticket requester:*@${domain} created>${dateStr}`;

    // Query 2: open tickets (regardless of creation date)
    const openQuery =
      `type:ticket requester:*@${domain} status:open status:pending status:new`;

    const [volumeResults, openResults] = await Promise.all([
      fetchSearchResults(baseUrl, volumeQuery, authHeader),
      fetchSearchResults(baseUrl, openQuery, authHeader),
    ]);

    if (volumeResults === null || openResults === null) {
      return null;
    }

    // Count severity from the volume query (last 30 days)
    let highPriorityCount = 0;
    let urgentCount = 0;
    for (const ticket of volumeResults) {
      if (ticket.priority === 'high') {
        highPriorityCount++;
      } else if (ticket.priority === 'urgent') {
        urgentCount++;
      }
    }

    return {
      ticketVolume: volumeResults.length,
      openCount: openResults.length,
      highPriorityCount,
      urgentCount,
    };
  } catch (error) {
    console.warn('Error fetching Zendesk tickets:', error);
    return null;
  }
}
