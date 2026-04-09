/**
 * Tests for DiagnosticsApi endpoint handlers.
 *
 * We mock the stores and config, then invoke the handler functions directly.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetAllSnapshots = jest.fn();
const mockAggregate = jest.fn();
const mockEnsureTable = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/intercomStore', () => ({
  IntercomStore: jest.fn().mockImplementation(() => ({
    ensureTable: mockEnsureTable,
    getAllSnapshots: mockGetAllSnapshots,
    aggregate: mockAggregate,
  })),
}));

const mockListAccounts = jest.fn();
jest.mock('../../services/accountStore', () => ({
  AccountStore: jest.fn().mockImplementation(() => ({
    ensureTable: mockEnsureTable,
    listAccounts: mockListAccounts,
  })),
}));

const mockGetAllScoresForDate = jest.fn();
jest.mock('../../services/scoreStore', () => ({
  ScoreStore: jest.fn().mockImplementation(() => ({
    ensureTable: mockEnsureTable,
    getAllScoresForDate: mockGetAllScoresForDate,
  })),
}));

jest.mock('../../config', () => ({
  getConfig: () => ({
    storageConnectionString: 'fake',
    tableAccounts: 'accounts',
    tableScores: 'churnscores',
  }),
}));

jest.mock('../../middleware', () => ({
  withAuth: (handler: any, ..._roles: any[]) => handler,
  corsHeaders: () => ({ 'Access-Control-Allow-Origin': '*' }),
}));

jest.mock('@azure/functions', () => ({
  app: {
    http: jest.fn(),
  },
}));

// Import after mocks
import { handleDiagnostics } from '../../functions/DiagnosticsApi';

function makeRequest(type: string): any {
  return {
    params: { type },
    method: 'GET',
  };
}

const mockContext: any = { error: jest.fn() };
const mockUser: any = { email: 'admin@test.com', role: 'admin', displayName: 'Admin' };

describe('DiagnosticsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/diagnostics/intercom', () => {
    it('returns grouped domains with aggregated data', async () => {
      const snapshots = [
        { domain: 'acme.com', date: '2026-04-08', conversationVolume: 5, openCount: 2, avgResponseTime: 3600, quickResolutions: 1, aiHandled: 0, totalResponseTime: 7200, responseCount: 2, cxScoreTotal: 8, cxScoreCount: 2 },
        { domain: 'acme.com', date: '2026-04-07', conversationVolume: 3, openCount: 1, avgResponseTime: 1800, quickResolutions: 2, aiHandled: 1, totalResponseTime: 3600, responseCount: 2, cxScoreTotal: 4, cxScoreCount: 1 },
        { domain: 'beta.io', date: '2026-04-08', conversationVolume: 1, openCount: 0, avgResponseTime: 600, quickResolutions: 0, aiHandled: 1, totalResponseTime: 600, responseCount: 1, cxScoreTotal: 5, cxScoreCount: 1 },
      ];

      mockGetAllSnapshots.mockResolvedValue(snapshots);
      mockAggregate
        .mockReturnValueOnce({ conversationVolume: 8, openCount: 2, avgResponseTime: 2700, quickResolutions: 3, aiHandled: 1, avgCxScore: 4.0, cxScoreCount: 3 })
        .mockReturnValueOnce({ conversationVolume: 1, openCount: 0, avgResponseTime: 600, quickResolutions: 0, aiHandled: 1, avgCxScore: 5.0, cxScoreCount: 1 });

      const res = await handleDiagnostics(makeRequest('intercom'), mockContext, mockUser);

      expect(res.status).toBe(200);
      const body = JSON.parse(res.body as string);
      expect(body.domains).toHaveLength(2);

      const acme = body.domains.find((d: any) => d.domain === 'acme.com');
      expect(acme.aggregated.conversationVolume).toBe(8);
      expect(acme.snapshots).toHaveLength(2);
    });

    it('returns empty domains array when no data', async () => {
      mockGetAllSnapshots.mockResolvedValue([]);

      const res = await handleDiagnostics(makeRequest('intercom'), mockContext, mockUser);
      const body = JSON.parse(res.body as string);
      expect(body.domains).toEqual([]);
    });
  });

  describe('GET /api/diagnostics/zendesk', () => {
    it('returns per-account zendesk rows (not grouped by domain)', async () => {
      mockListAccounts.mockResolvedValue([
        { accountId: 'acc1', accountName: 'Acme Corp', domain: 'acme.com' },
        { accountId: 'acc2', accountName: 'Acme Div B', domain: 'acme.com' },
        { accountId: 'acc3', accountName: 'Beta Inc', domain: 'beta.io' },
      ]);

      const scores = new Map();
      scores.set('acc1', {
        accountId: 'acc1',
        computedAt: '2026-04-09T02:00:00Z',
        zendeskDetails: JSON.stringify({
          ticketVolume: 3, openCount: 1, highPriorityCount: 0, urgentCount: 0,
          totalPenalty: -3, volumePenalty: -3, openPenalty: 0, severityPenalty: 0,
        }),
      });
      scores.set('acc2', {
        accountId: 'acc2',
        computedAt: '2026-04-09T02:00:00Z',
        zendeskDetails: JSON.stringify({
          ticketVolume: 2, openCount: 1, highPriorityCount: 1, urgentCount: 0,
          totalPenalty: -4, volumePenalty: 0, openPenalty: -2, severityPenalty: -2,
        }),
      });
      scores.set('acc3', {
        accountId: 'acc3',
        computedAt: '2026-04-09T02:00:00Z',
        zendeskDetails: null,
      });

      mockGetAllScoresForDate.mockResolvedValue(scores);

      const res = await handleDiagnostics(makeRequest('zendesk'), mockContext, mockUser);

      expect(res.status).toBe(200);
      const body = JSON.parse(res.body as string);
      expect(body.syncedAt).toBe('2026-04-09T02:00:00Z');
      // Per-account rows, not grouped by domain
      expect(body.accounts).toHaveLength(2); // acc1 and acc2 have zendesk data

      const acc1 = body.accounts.find((a: any) => a.accountName === 'Acme Corp');
      expect(acc1.domain).toBe('acme.com');
      expect(acc1.ticketVolume).toBe(3);
      expect(acc1.openCount).toBe(1);
      expect(acc1.totalPenalty).toBe(-3);
      expect(acc1.volumePenalty).toBe(-3);
      expect(acc1.openPenalty).toBe(0);
      expect(acc1.severityPenalty).toBe(0);

      const acc2 = body.accounts.find((a: any) => a.accountName === 'Acme Div B');
      expect(acc2.domain).toBe('acme.com');
      expect(acc2.ticketVolume).toBe(2);
      expect(acc2.totalPenalty).toBe(-4);

      // Sorted by totalPenalty ascending (worst first)
      expect(body.accounts[0].accountName).toBe('Acme Div B');
      expect(body.accounts[1].accountName).toBe('Acme Corp');
    });

    it('returns empty accounts when no scores have zendesk data', async () => {
      mockListAccounts.mockResolvedValue([
        { accountId: 'acc1', accountName: 'Test', domain: 'test.com' },
      ]);
      const scores = new Map();
      scores.set('acc1', {
        accountId: 'acc1',
        computedAt: '2026-04-09T02:00:00Z',
        zendeskDetails: null,
      });
      mockGetAllScoresForDate.mockResolvedValue(scores);

      const res = await handleDiagnostics(makeRequest('zendesk'), mockContext, mockUser);
      const body = JSON.parse(res.body as string);
      expect(body.accounts).toEqual([]);
    });
  });

  describe('unknown type', () => {
    it('returns 404 for unknown type', async () => {
      const res = await handleDiagnostics(makeRequest('unknown'), mockContext, mockUser);
      expect(res.status).toBe(404);
    });
  });
});
