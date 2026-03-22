import { fetchIntercomConversations, IntercomDailySnapshot } from '../../clients/intercomClient';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const TOKEN = 'test-token-123';
const HOURS_BACK = 24;

// Helper: build a search response page
function searchPage(
  conversations: any[],
  startingAfter: string | null = null
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      conversations,
      pages: startingAfter
        ? { next: { starting_after: startingAfter } }
        : {},
    }),
  };
}

function errorResponse(status: number) {
  return { ok: false, status, statusText: 'Unauthorized', json: async () => ({}) };
}

// Helper: build a minimal conversation object
function makeConv(opts: {
  id?: string;
  email?: string;
  state?: string;
  parts?: number;
  ai?: boolean;
  firstAdminReply?: number;
  createdAt?: number;
}): any {
  const {
    id = '1',
    email,
    state = 'open',
    parts = 3,
    ai = false,
    firstAdminReply,
    createdAt = 1700000000,
  } = opts;

  return {
    id,
    state,
    created_at: createdAt,
    ai_agent_participated: ai,
    conversation_parts: { total_count: parts },
    statistics: firstAdminReply ? { first_admin_reply_at: firstAdminReply } : {},
    contacts: {
      contacts: email
        ? [{ type: 'contact', id: 'c1' }]
        : [],
    },
    // We embed the contact email directly for test simplicity (the client resolves it)
    _testEmail: email,
  };
}

// The real Intercom API embeds contacts differently; we'll mock accordingly.
// For the client, contact email lives at source.email or contacts array.
// We'll use the structure our client actually reads.
function makeConvWithEmail(opts: {
  id?: string;
  email?: string | null;
  state?: string;
  parts?: number;
  ai?: boolean;
  firstAdminReply?: number;
  createdAt?: number;
}): any {
  const {
    id = '1',
    email = null,
    state = 'open',
    parts = 3,
    ai = false,
    firstAdminReply,
    createdAt = 1700000000,
  } = opts;

  return {
    id,
    state,
    created_at: createdAt,
    ai_agent_participated: ai,
    conversation_parts: { total_count: parts },
    statistics: firstAdminReply != null ? { first_admin_reply_at: firstAdminReply } : {},
    source: {
      author: {
        email: email,
      },
    },
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
});

describe('intercomClient', () => {
  describe('fetchIntercomConversations', () => {

    it('aggregates conversations by domain', async () => {
      const conv1 = makeConvWithEmail({ id: '1', email: 'alice@acme.com', state: 'open', parts: 5 });
      const conv2 = makeConvWithEmail({ id: '2', email: 'bob@acme.com', state: 'open', parts: 4 });
      const conv3 = makeConvWithEmail({ id: '3', email: 'charlie@beta.org', state: 'open', parts: 2 });

      // Pass 1 (incremental, created_at filter) — no results for simplicity
      mockFetch.mockResolvedValueOnce(searchPage([]));
      // Pass 2 (open snapshot)
      mockFetch.mockResolvedValueOnce(searchPage([conv1, conv2, conv3]));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(result).not.toBeNull();
      expect(result!.has('acme.com')).toBe(true);
      expect(result!.has('beta.org')).toBe(true);
      expect(result!.get('acme.com')!.openCount).toBe(2);
      expect(result!.get('beta.org')!.openCount).toBe(1);
    });

    it('merges pass 1 (incremental) into conversationVolume', async () => {
      const conv1 = makeConvWithEmail({ id: '1', email: 'alice@acme.com', state: 'closed', parts: 5 });
      const conv2 = makeConvWithEmail({ id: '2', email: 'bob@acme.com', state: 'open', parts: 3 });

      // Pass 1: one closed conversation (contributes to conversationVolume)
      mockFetch.mockResolvedValueOnce(searchPage([conv1]));
      // Pass 2: one open conversation (contributes to openCount)
      mockFetch.mockResolvedValueOnce(searchPage([conv2]));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(result).not.toBeNull();
      const acme = result!.get('acme.com')!;
      expect(acme.conversationVolume).toBe(1); // only pass 1 (incremental)
      expect(acme.openCount).toBe(1); // only open
    });

    it('returns null on API error in pass 1', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);
      expect(result).toBeNull();
    });

    it('returns null on API error in pass 2', async () => {
      // Pass 1 succeeds
      mockFetch.mockResolvedValueOnce(searchPage([]));
      // Pass 2 fails
      mockFetch.mockResolvedValueOnce(errorResponse(500));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);
      expect(result).toBeNull();
    });

    it('skips contacts with no email', async () => {
      const noEmail = makeConvWithEmail({ id: '1', email: null, state: 'open' });
      const withEmail = makeConvWithEmail({ id: '2', email: 'alice@acme.com', state: 'open' });

      mockFetch.mockResolvedValueOnce(searchPage([]));
      mockFetch.mockResolvedValueOnce(searchPage([noEmail, withEmail]));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(result).not.toBeNull();
      expect(result!.size).toBe(1);
      expect(result!.has('acme.com')).toBe(true);
    });

    it('excludes generic email domains', async () => {
      const gmail = makeConvWithEmail({ id: '1', email: 'user@gmail.com', state: 'open' });
      const outlook = makeConvWithEmail({ id: '2', email: 'user@outlook.com', state: 'open' });
      const yahoo = makeConvWithEmail({ id: '3', email: 'user@yahoo.com', state: 'open' });
      const real = makeConvWithEmail({ id: '4', email: 'user@acme.com', state: 'open' });

      mockFetch.mockResolvedValueOnce(searchPage([]));
      mockFetch.mockResolvedValueOnce(searchPage([gmail, outlook, yahoo, real]));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(result).not.toBeNull();
      expect(result!.has('gmail.com')).toBe(false);
      expect(result!.has('outlook.com')).toBe(false);
      expect(result!.has('yahoo.com')).toBe(false);
      expect(result!.has('acme.com')).toBe(true);
    });

    it('counts quick resolutions (closed + parts <= 2)', async () => {
      const quickClosed = makeConvWithEmail({ id: '1', email: 'a@acme.com', state: 'closed', parts: 2 });
      const slowClosed = makeConvWithEmail({ id: '2', email: 'b@acme.com', state: 'closed', parts: 5 });
      const openFew = makeConvWithEmail({ id: '3', email: 'c@acme.com', state: 'open', parts: 1 });

      // Pass 1: quick + slow closed conversations
      mockFetch.mockResolvedValueOnce(searchPage([quickClosed, slowClosed]));
      // Pass 2: open with few parts (open should NOT count as quick resolution)
      mockFetch.mockResolvedValueOnce(searchPage([openFew]));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(result).not.toBeNull();
      const acme = result!.get('acme.com')!;
      expect(acme.quickResolutions).toBe(1); // only quickClosed qualifies
    });

    it('counts AI-handled conversations', async () => {
      const aiConv = makeConvWithEmail({ id: '1', email: 'a@acme.com', state: 'closed', ai: true });
      const humanConv = makeConvWithEmail({ id: '2', email: 'b@acme.com', state: 'closed', ai: false });

      // AI/human conversations go in Pass 1 (incremental) — Pass 2 only counts openCount
      mockFetch.mockResolvedValueOnce(searchPage([aiConv, humanConv]));
      mockFetch.mockResolvedValueOnce(searchPage([]));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(result).not.toBeNull();
      const acme = result!.get('acme.com')!;
      expect(acme.aiHandled).toBe(1);
    });

    it('calculates response time from statistics', async () => {
      const createdAt = 1700000000;
      const firstAdminReply = 1700000300; // 300 seconds later
      const conv = makeConvWithEmail({
        id: '1',
        email: 'a@acme.com',
        state: 'closed',
        createdAt,
        firstAdminReply,
      });

      // Response time tracked in Pass 1 (incremental) — Pass 2 only counts openCount
      mockFetch.mockResolvedValueOnce(searchPage([conv]));
      mockFetch.mockResolvedValueOnce(searchPage([]));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(result).not.toBeNull();
      const acme = result!.get('acme.com')!;
      expect(acme.totalResponseTime).toBe(300);
      expect(acme.responseCount).toBe(1);
    });

    it('accumulates response time across multiple conversations', async () => {
      const conv1 = makeConvWithEmail({ id: '1', email: 'a@acme.com', state: 'closed', createdAt: 1700000000, firstAdminReply: 1700000100 }); // 100s
      const conv2 = makeConvWithEmail({ id: '2', email: 'b@acme.com', state: 'closed', createdAt: 1700000000, firstAdminReply: 1700000200 }); // 200s

      // Response time tracked in Pass 1 (incremental)
      mockFetch.mockResolvedValueOnce(searchPage([conv1, conv2]));
      mockFetch.mockResolvedValueOnce(searchPage([]));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(result).not.toBeNull();
      const acme = result!.get('acme.com')!;
      expect(acme.totalResponseTime).toBe(300);
      expect(acme.responseCount).toBe(2);
    });

    it('does not count response time when first_admin_reply_at is missing', async () => {
      const conv = makeConvWithEmail({ id: '1', email: 'a@acme.com', state: 'open', firstAdminReply: undefined });

      mockFetch.mockResolvedValueOnce(searchPage([]));
      mockFetch.mockResolvedValueOnce(searchPage([conv]));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(result).not.toBeNull();
      const acme = result!.get('acme.com')!;
      expect(acme.totalResponseTime).toBe(0);
      expect(acme.responseCount).toBe(0);
    });

    it('paginates through multiple pages', async () => {
      const conv1 = makeConvWithEmail({ id: '1', email: 'a@acme.com', state: 'open' });
      const conv2 = makeConvWithEmail({ id: '2', email: 'b@acme.com', state: 'open' });

      // Pass 1: empty
      mockFetch.mockResolvedValueOnce(searchPage([]));
      // Pass 2 page 1: returns conv1 with cursor to next
      mockFetch.mockResolvedValueOnce(searchPage([conv1], 'cursor-abc'));
      // Pass 2 page 2: returns conv2, no cursor
      mockFetch.mockResolvedValueOnce(searchPage([conv2]));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(result).not.toBeNull();
      expect(result!.get('acme.com')!.openCount).toBe(2);
    });

    it('sends correct auth headers', async () => {
      mockFetch.mockResolvedValueOnce(searchPage([]));
      mockFetch.mockResolvedValueOnce(searchPage([]));

      await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
      expect(options.headers['Intercom-Version']).toBe('2.15');
    });

    it('returns empty map when no conversations found', async () => {
      mockFetch.mockResolvedValueOnce(searchPage([]));
      mockFetch.mockResolvedValueOnce(searchPage([]));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);

      expect(result).not.toBeNull();
      expect(result!.size).toBe(0);
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const result = await fetchIntercomConversations(TOKEN, HOURS_BACK);
      expect(result).toBeNull();
    });
  });
});
