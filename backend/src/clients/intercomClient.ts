/**
 * Intercom API client types.
 *
 * IntercomDailySnapshot represents the raw metrics collected for a single
 * domain on a single calendar day, stored in Table Storage via IntercomStore.
 * totalResponseTime and responseCount are kept separately so that snapshots
 * can be combined with a true weighted average rather than an average of averages.
 */
export interface IntercomDailySnapshot {
  /** Total number of conversations started on this day. */
  conversationVolume: number;
  /** Number of conversations still open at snapshot time. */
  openCount: number;
  /** Weighted-average first response time in seconds (totalResponseTime / responseCount). */
  avgResponseTime: number;
  /** Conversations resolved within 1 hour. */
  quickResolutions: number;
  /** Conversations handled or resolved by the AI bot without agent intervention. */
  aiHandled: number;
  /** Sum of first-response times (seconds) across all responded conversations — used for weighted averaging across snapshots. */
  totalResponseTime: number;
  /** Number of conversations that had a first response (denominator for weighted avg). */
  responseCount: number;
  /** Sum of all CX Score ratings (1-5) for conversations that have a rating. */
  cxScoreTotal: number;
  /** Number of conversations that received a CX Score rating. */
  cxScoreCount: number;
}

interface IntercomConversation {
  id: string;
  state: string;
  created_at: number;
  ai_agent_participated: boolean;
  conversation_parts: {
    total_count: number;
  };
  statistics?: {
    first_admin_reply_at?: number | null;
  };
  source?: {
    author?: {
      email?: string | null;
    };
  };
  conversation_rating?: {
    rating: number;
    remark?: string;
    created_at: number;
  } | null;
}

interface IntercomSearchResponse {
  conversations: IntercomConversation[];
  pages?: {
    next?: {
      starting_after?: string;
    };
  };
}

/** Maximum pages to fetch per pass (each page = up to 150 results). */
const MAX_PAGES = 20;

/** Generic/free email domains to exclude from aggregation. */
const GENERIC_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
]);

function extractDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at > 0 ? email.substring(at + 1).toLowerCase() : '';
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Intercom-Version': '2.15',
  };
}

function getContactEmail(conv: IntercomConversation): string | null {
  return conv.source?.author?.email ?? null;
}

function ensureSnapshot(map: Map<string, IntercomDailySnapshot>, domain: string): IntercomDailySnapshot {
  if (!map.has(domain)) {
    map.set(domain, {
      conversationVolume: 0,
      openCount: 0,
      avgResponseTime: 0,
      totalResponseTime: 0,
      responseCount: 0,
      quickResolutions: 0,
      aiHandled: 0,
      cxScoreTotal: 0,
      cxScoreCount: 0,
    });
  }
  return map.get(domain)!;
}

/**
 * Paginate through Intercom /conversations/search.
 * Returns all conversations across pages, or null on API error.
 */
async function searchConversations(
  token: string,
  body: Record<string, unknown>
): Promise<IntercomConversation[] | null> {
  const all: IntercomConversation[] = [];
  let startingAfter: string | undefined;
  let page = 0;

  while (page < MAX_PAGES) {
    const requestBody: Record<string, unknown> = { ...body };
    if (startingAfter) {
      requestBody.pagination = { starting_after: startingAfter };
    }

    const response = await fetch('https://api.intercom.io/conversations/search', {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.warn(`Intercom API ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as IntercomSearchResponse;
    all.push(...(data.conversations ?? []));

    const next = data.pages?.next?.starting_after;
    if (!next) break;
    startingAfter = next;
    page++;
  }

  return all;
}

/**
 * Aggregate a list of conversations into the domain snapshot map.
 * @param conversations  Conversations to process.
 * @param map            Accumulator map.
 * @param countOpen      Whether to increment openCount for open conversations.
 * @param countQuick     Whether to evaluate quick-resolution logic (closed + parts <= 2).
 */
function aggregateConversations(
  conversations: IntercomConversation[],
  map: Map<string, IntercomDailySnapshot>,
  countOpen: boolean,
  countQuick: boolean
): void {
  for (const conv of conversations) {
    const email = getContactEmail(conv);
    if (!email) continue;

    const domain = extractDomain(email);
    if (!domain || GENERIC_DOMAINS.has(domain)) continue;

    const snap = ensureSnapshot(map, domain);

    if (countOpen) {
      // Pass 2: only count open conversations (point-in-time snapshot)
      if (conv.state === 'open') snap.openCount++;
      continue;
    }

    // Pass 1: event-based metrics from incremental fetch
    snap.conversationVolume++;

    if (conv.ai_agent_participated === true) {
      snap.aiHandled++;
    }

    const firstReply = conv.statistics?.first_admin_reply_at;
    if (firstReply && conv.created_at) {
      const elapsed = firstReply - conv.created_at;
      if (elapsed >= 0) {
        snap.totalResponseTime += elapsed;
        snap.responseCount++;
      }
    }

    if (conv.conversation_rating?.rating != null) {
      snap.cxScoreTotal += conv.conversation_rating.rating;
      snap.cxScoreCount++;
    }

    if (countQuick && conv.state === 'closed' && conv.conversation_parts?.total_count <= 2) {
      snap.quickResolutions++;
    }
  }
}

/**
 * Fetch Intercom conversations using a two-pass approach:
 * - Pass 1: POST /conversations/search with created_at filter (incremental volume data)
 * - Pass 2: POST /conversations/search with state=open (point-in-time open count)
 *
 * Contacts without email and generic email domains (gmail, outlook, etc.) are excluded.
 * Returns a Map<domain, IntercomDailySnapshot> or null on API error.
 */
export async function fetchIntercomConversations(
  token: string,
  hoursBack: number
): Promise<Map<string, IntercomDailySnapshot> | null> {
  try {
    const domainMap = new Map<string, IntercomDailySnapshot>();

    // Pass 1: incremental — conversations created in the last N hours
    const sinceTimestamp = Math.floor(Date.now() / 1000) - hoursBack * 3600;

    const incrementalBody = {
      query: {
        operator: 'AND',
        value: [
          {
            field: 'created_at',
            operator: '>',
            value: sinceTimestamp,
          },
        ],
      },
    };

    const incrementalConvs = await searchConversations(token, incrementalBody);
    if (incrementalConvs === null) return null;

    // Pass 1: counts volume, AI, response times, quick resolutions — but NOT openCount
    aggregateConversations(incrementalConvs, domainMap, false, true);

    // Pass 2: point-in-time snapshot of all open conversations
    const openBody = {
      query: {
        operator: 'AND',
        value: [
          {
            field: 'state',
            operator: '=',
            value: 'open',
          },
        ],
      },
    };

    const openConvs = await searchConversations(token, openBody);
    if (openConvs === null) return null;

    // Pass 2: counts volume + openCount + AI + response times — but NOT quickResolutions
    aggregateConversations(openConvs, domainMap, true, false);

    return domainMap;
  } catch (error) {
    console.warn('Error fetching Intercom conversations:', error);
    return null;
  }
}
