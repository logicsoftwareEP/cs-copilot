import { fetchZendeskTickets } from '../../clients/zendeskClient';

// ── Mock global fetch ──────────────────────────────────────────────────────

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const SUBDOMAIN = 'testco';
const EMAIL = 'agent@testco.com';
const API_TOKEN = 'tok123';
const DOMAIN = 'acme.com';

/** Helper: build a Zendesk search response page. */
function searchPage(
  tickets: Array<{ priority?: string | null }>,
  nextPage: string | null = null
) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ results: tickets, next_page: nextPage }),
  };
}

/** Helper: build an error response. */
function errorResponse(status: number, statusText: string) {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
});

describe('zendeskClient', () => {
  describe('fetchZendeskTickets', () => {

    it('fetches two queries and parses ticket data correctly', async () => {
      // Query 1 (volume): 3 tickets with mixed priorities
      // Query 2 (open): 2 open tickets
      mockFetch
        .mockResolvedValueOnce(
          searchPage([
            { priority: 'high' },
            { priority: 'normal' },
            { priority: 'urgent' },
          ])
        )
        .mockResolvedValueOnce(
          searchPage([{ priority: 'high' }, { priority: null }])
        );

      const result = await fetchZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN, DOMAIN);

      expect(result).not.toBeNull();
      expect(result!.ticketVolume).toBe(3);
      expect(result!.openCount).toBe(2);
      expect(result!.highPriorityCount).toBe(1);
      expect(result!.urgentCount).toBe(1);

      // Verify two fetch calls were made (one per query)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('handles pagination (next_page)', async () => {
      // Both queries run concurrently via Promise.all, so we route by URL
      let volumeCallCount = 0;
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('page=2')) {
          // Volume query page 2
          return searchPage([{ priority: 'urgent' }]);
        }
        if (url.includes('created%3E') || url.includes('created>')) {
          // Volume query page 1
          volumeCallCount++;
          return searchPage(
            [{ priority: 'high' }],
            'https://testco.zendesk.com/api/v2/search.json?page=2'
          );
        }
        // Open query
        return searchPage([]);
      });

      const result = await fetchZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN, DOMAIN);

      expect(result).not.toBeNull();
      expect(result!.ticketVolume).toBe(2);
      expect(result!.highPriorityCount).toBe(1);
      expect(result!.urgentCount).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('caps pagination at 5 pages per query', async () => {
      let volumePages = 0;
      mockFetch.mockImplementation(async (url: string) => {
        // Open query — has status:open in URL
        if (url.includes('status%3Aopen') || url.includes('status:open')) {
          return searchPage([]);
        }
        // Volume query pages (initial + paginated)
        volumePages++;
        return searchPage(
          [{ priority: 'normal' }],
          `https://testco.zendesk.com/api/v2/search.json?page=${volumePages + 1}`
        );
      });

      const result = await fetchZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN, DOMAIN);

      expect(result).not.toBeNull();
      expect(result!.ticketVolume).toBe(5); // 5 pages × 1 ticket each
      // 5 pages for query 1 + 1 page for query 2
      expect(mockFetch).toHaveBeenCalledTimes(6);
    });

    it('returns null on 401 error', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

      const result = await fetchZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN, DOMAIN);

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalled();
    });

    it('returns null on 500 error', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'));

      const result = await fetchZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN, DOMAIN);

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalled();
    });

    it('returns valid data with zeros when there are 0 tickets', async () => {
      mockFetch
        .mockResolvedValueOnce(searchPage([]))
        .mockResolvedValueOnce(searchPage([]));

      const result = await fetchZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN, DOMAIN);

      expect(result).not.toBeNull();
      expect(result!.ticketVolume).toBe(0);
      expect(result!.openCount).toBe(0);
      expect(result!.highPriorityCount).toBe(0);
      expect(result!.urgentCount).toBe(0);
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN, DOMAIN);

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalled();
    });
  });
});
