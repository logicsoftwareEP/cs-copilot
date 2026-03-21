import { fetchAllZendeskTickets, fetchZendeskTickets } from '../../clients/zendeskClient';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const SUBDOMAIN = 'testco';
const EMAIL = 'agent@testco.com';
const API_TOKEN = 'tok123';

function ticketsPage(
  tickets: Array<{ id: number; status: string; priority: string | null; created_at: string; requester_id: number }>,
  nextPage: string | null = null
) {
  return { ok: true, status: 200, json: async () => ({ tickets, next_page: nextPage }) };
}

function usersPage(users: Array<{ id: number; email: string }>) {
  return { ok: true, status: 200, json: async () => ({ users, next_page: null }) };
}

function errorResponse(status: number) {
  return { ok: false, status, statusText: 'Error', json: async () => ({}) };
}

beforeEach(() => {
  mockFetch.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
});

describe('zendeskClient', () => {
  describe('fetchAllZendeskTickets', () => {
    it('fetches tickets and aggregates by requester domain', async () => {
      const now = new Date().toISOString();
      mockFetch
        // Tickets page
        .mockResolvedValueOnce(ticketsPage([
          { id: 1, status: 'open', priority: 'high', created_at: now, requester_id: 100 },
          { id: 2, status: 'pending', priority: null, created_at: now, requester_id: 200 },
          { id: 3, status: 'open', priority: 'urgent', created_at: now, requester_id: 100 },
        ]))
        // Users page (batch)
        .mockResolvedValueOnce(usersPage([
          { id: 100, email: 'alice@acme.com' },
          { id: 200, email: 'bob@beta.org' },
        ]));

      const result = await fetchAllZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN);

      expect(result).not.toBeNull();
      expect(result!.size).toBe(2);

      const acme = result!.get('acme.com')!;
      expect(acme.openCount).toBe(2);
      expect(acme.ticketVolume).toBe(2);
      expect(acme.highPriorityCount).toBe(1);
      expect(acme.urgentCount).toBe(1);

      const beta = result!.get('beta.org')!;
      expect(beta.openCount).toBe(1);
      expect(beta.ticketVolume).toBe(1);
    });

    it('only counts recent tickets in volume (last 30 days)', async () => {
      const recent = new Date().toISOString();
      const old = new Date('2025-01-01').toISOString();

      mockFetch
        .mockResolvedValueOnce(ticketsPage([
          { id: 1, status: 'open', priority: null, created_at: recent, requester_id: 100 },
          { id: 2, status: 'open', priority: 'high', created_at: old, requester_id: 100 },
        ]))
        .mockResolvedValueOnce(usersPage([{ id: 100, email: 'a@acme.com' }]));

      const result = await fetchAllZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN);
      const acme = result!.get('acme.com')!;

      expect(acme.openCount).toBe(2); // both are open
      expect(acme.ticketVolume).toBe(1); // only recent counts for volume
      expect(acme.highPriorityCount).toBe(0); // old high-priority ticket excluded from volume
    });

    it('returns null on auth failure', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401));

      const result = await fetchAllZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN);
      expect(result).toBeNull();
    });

    it('returns empty map when no tickets', async () => {
      mockFetch.mockResolvedValueOnce(ticketsPage([]));

      const result = await fetchAllZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN);
      expect(result).not.toBeNull();
      expect(result!.size).toBe(0);
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchAllZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN);
      expect(result).toBeNull();
    });
  });

  describe('fetchZendeskTickets (legacy wrapper)', () => {
    it('returns data for a matching domain', async () => {
      const now = new Date().toISOString();
      mockFetch
        .mockResolvedValueOnce(ticketsPage([
          { id: 1, status: 'open', priority: null, created_at: now, requester_id: 100 },
        ]))
        .mockResolvedValueOnce(usersPage([{ id: 100, email: 'a@acme.com' }]));

      const result = await fetchZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN, 'acme.com');
      expect(result).not.toBeNull();
      expect(result!.openCount).toBe(1);
    });

    it('returns zeros for a domain with no tickets', async () => {
      mockFetch
        .mockResolvedValueOnce(ticketsPage([
          { id: 1, status: 'open', priority: null, created_at: new Date().toISOString(), requester_id: 100 },
        ]))
        .mockResolvedValueOnce(usersPage([{ id: 100, email: 'a@other.com' }]));

      const result = await fetchZendeskTickets(SUBDOMAIN, EMAIL, API_TOKEN, 'acme.com');
      expect(result).not.toBeNull();
      expect(result!.openCount).toBe(0);
      expect(result!.ticketVolume).toBe(0);
    });
  });
});
