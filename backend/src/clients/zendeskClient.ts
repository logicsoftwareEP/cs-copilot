export interface ZendeskTicketData {
  ticketVolume: number;
  openCount: number;
  highPriorityCount: number;
  urgentCount: number;
}

interface ZendeskTicket {
  id: number;
  status: string;
  priority: string | null;
  created_at: string;
  requester_id: number;
}

interface ZendeskUser {
  id: number;
  email: string;
}

interface ZendeskListResponse<T> {
  tickets?: T[];
  users?: T[];
  next_page: string | null;
  count?: number;
}

/** Maximum pages to fetch (each page = 100 results). */
const MAX_PAGES = 10;

function buildBasicAuth(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}/token:${apiToken}`).toString('base64')}`;
}

/**
 * Paginate through a Zendesk list endpoint.
 */
async function fetchAllPages<T>(
  url: string,
  authHeader: string,
  key: 'tickets' | 'users'
): Promise<T[] | null> {
  const all: T[] = [];
  let nextUrl: string | null = url;
  let page = 0;

  while (nextUrl && page < MAX_PAGES) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: authHeader },
    });

    if (!response.ok) {
      console.warn(`Zendesk API ${response.status} ${response.statusText} for ${nextUrl}`);
      return null;
    }

    const data = (await response.json()) as ZendeskListResponse<T>;
    const items = data[key] ?? [];
    all.push(...items);
    nextUrl = data.next_page;
    page++;
  }

  return all;
}

function extractDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at > 0 ? email.substring(at + 1).toLowerCase() : '';
}

/**
 * Fetch ALL open/pending/new tickets from Zendesk, then aggregate per requester domain.
 * Returns a Map<domain, ZendeskTicketData>.
 *
 * This approach:
 * - Makes 2-3 API calls total (paginated) instead of 2 per domain
 * - Avoids Zendesk search API quirks with domain matching
 * - Works because open ticket volume is low (typically < 500)
 */
export async function fetchAllZendeskTickets(
  subdomain: string,
  email: string,
  apiToken: string
): Promise<Map<string, ZendeskTicketData> | null> {
  try {
    const baseUrl = `https://${subdomain}.zendesk.com`;
    const authHeader = buildBasicAuth(email, apiToken);

    // Fetch all non-solved tickets (open, pending, new, hold)
    const tickets = await fetchAllPages<ZendeskTicket>(
      `${baseUrl}/api/v2/tickets.json?status=open,pending,new`,
      authHeader,
      'tickets'
    );

    if (tickets === null) return null;

    // Collect unique requester IDs
    const requesterIds = [...new Set(tickets.map(t => t.requester_id))];

    // Batch-fetch requester users to get their emails
    const requesterMap = new Map<number, string>(); // userId → domain
    for (let i = 0; i < requesterIds.length; i += 100) {
      const batch = requesterIds.slice(i, i + 100);
      const ids = batch.join(',');
      const users = await fetchAllPages<ZendeskUser>(
        `${baseUrl}/api/v2/users/show_many.json?ids=${ids}`,
        authHeader,
        'users'
      );
      if (users) {
        for (const u of users) {
          requesterMap.set(u.id, extractDomain(u.email));
        }
      }
    }

    // Aggregate tickets by requester domain
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const domainData = new Map<string, ZendeskTicketData>();

    for (const ticket of tickets) {
      const domain = requesterMap.get(ticket.requester_id);
      if (!domain) continue;

      if (!domainData.has(domain)) {
        domainData.set(domain, { ticketVolume: 0, openCount: 0, highPriorityCount: 0, urgentCount: 0 });
      }
      const data = domainData.get(domain)!;

      // Open count (all statuses we fetched are open/pending/new)
      data.openCount++;

      // Volume = tickets created in the last 30 days
      const created = new Date(ticket.created_at);
      if (created >= thirtyDaysAgo) {
        data.ticketVolume++;
        if (ticket.priority === 'high') data.highPriorityCount++;
        if (ticket.priority === 'urgent') data.urgentCount++;
      }
    }

    return domainData;
  } catch (error) {
    console.warn('Error fetching Zendesk tickets:', error);
    return null;
  }
}

// Keep old function signature for backward compatibility with tests
export async function fetchZendeskTickets(
  subdomain: string,
  email: string,
  apiToken: string,
  domain: string
): Promise<ZendeskTicketData | null> {
  const allData = await fetchAllZendeskTickets(subdomain, email, apiToken);
  if (allData === null) return null;
  return allData.get(domain) ?? { ticketVolume: 0, openCount: 0, highPriorityCount: 0, urgentCount: 0 };
}
