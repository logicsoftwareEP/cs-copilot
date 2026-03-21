# Intercom Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Intercom chat history to health scoring — support penalty (shared -20 cap with Zendesk) + engagement bonus (up to +10).

**Architecture:** New `intercomClient.ts` bulk-fetches conversations, aggregates by email domain. Daily snapshots stored in `intercomscores` Table Storage. `applyAllPenalties()` replaces `applyZendeskPenalty()`, combining Zendesk + Intercom penalties (capped at -20) and adding engagement bonus. Frontend side panel gets two new cards.

**Tech Stack:** Azure Functions v4, Node.js 20, TypeScript, Azure Table Storage, Intercom REST API v2.15, React 18

**Spec:** `docs/superpowers/specs/2026-03-21-intercom-integration-design.md`

**Known limitation:** The spec calls for a 30-day backfill on first run. This plan uses 36-hour incremental from day one for simplicity. Scores will reach full 30-day accuracy after ~30 days of running. A manual backfill script can be added later if needed.

---

## File Map

### New Files
- `backend/src/clients/intercomClient.ts` — Intercom API client: fetch conversations, aggregate by domain
- `backend/src/services/intercomStore.ts` — `IntercomStore` wrapping `intercomscores` Table Storage table
- `backend/src/__tests__/services/intercomPenalty.test.ts` — unit tests for penalty + bonus scoring
- `backend/src/__tests__/clients/intercomClient.test.ts` — mock-based client tests

### Modified Files
- `backend/src/config.ts` — add `intercomAccessToken` to `Config`
- `backend/src/types.ts` — add `intercomPenalty`, `intercomBonus`, `intercomDetails` to `ChurnScore`
- `backend/src/services/scoreStore.ts` — add Intercom fields to `ScoreEntity`, `fromEntity()`, and `upsertScore()`
- `backend/src/services/healthScoreService.ts` — add `computeIntercomPenalty()`, `computeIntercomBonus()`, replace `applyZendeskPenalty()` with `applyAllPenalties()`
- `backend/src/functions/SyncRunner.ts` — add Intercom fetch/store/aggregate phase, switch to `applyAllPenalties()`
- `backend/src/functions/AccountsApi.ts` — switch to `applyAllPenalties()`, add `intercomDetails` to response
- `backend/src/index.ts` — no change (no new function module)
- `backend/src/__tests__/services/SyncRunner.test.ts` — add Intercom mock, test enabled/disabled/combined paths
- `backend/src/__tests__/services/zendeskPenalty.test.ts` — update tests for `applyAllPenalties()` signature change
- `frontend/src/pages/Portfolio.tsx` — add Intercom side panel cards, handle score > 100

---

## Task 1: Config — Add Intercom env var

**Files:**
- Modify: `backend/src/config.ts:67-87`

- [ ] **Step 1: Add `intercomAccessToken` to Config interface**

In `config.ts`, add to the `Config` interface (after the Zendesk fields):

```typescript
intercomAccessToken: string | null;
```

- [ ] **Step 2: Read env var in `getConfig()`**

After line 85 (`zendeskApiToken`), add:

```typescript
intercomAccessToken: process.env.INTERCOM_ACCESS_TOKEN ?? null,
```

- [ ] **Step 3: Verify build**

Run: `cd backend && npm run build`
Expected: Clean compile

- [ ] **Step 4: Commit**

```bash
git add backend/src/config.ts
git commit -m "feat(config): add INTERCOM_ACCESS_TOKEN env var"
```

---

## Task 2: Intercom Client — Types and Fetching

**Files:**
- Create: `backend/src/clients/intercomClient.ts`
- Create: `backend/src/__tests__/clients/intercomClient.test.ts`

- [ ] **Step 1: Write the failing test for `fetchIntercomConversations`**

Create `backend/src/__tests__/clients/intercomClient.test.ts`:

```typescript
import { fetchIntercomConversations, IntercomDailySnapshot } from '../../clients/intercomClient';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockConversation(overrides: Record<string, any> = {}) {
  return {
    id: 'conv-1',
    state: 'closed',
    statistics: { first_admin_reply_at: 1000, first_contact_reply_at: 500 },
    conversation_parts: { total_count: 2 },
    ai_agent_participated: false,
    contacts: { contacts: [{ email: 'user@acme.com' }] },
    ...overrides,
  };
}

describe('intercomClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    const result = await fetchIntercomConversations('bad-token', 24);
    expect(result).toBeNull();
  });

  it('aggregates conversations by email domain', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversations: [
          mockConversation({ id: 'c1', contacts: { contacts: [{ email: 'a@acme.com' }] } }),
          mockConversation({ id: 'c2', contacts: { contacts: [{ email: 'b@acme.com' }] } }),
          mockConversation({ id: 'c3', contacts: { contacts: [{ email: 'x@other.com' }] } }),
        ],
        pages: { next: null },
      }),
    });

    // Second call: open conversations query
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversations: [
          mockConversation({ id: 'c4', state: 'open', contacts: { contacts: [{ email: 'a@acme.com' }] } }),
        ],
        pages: { next: null },
      }),
    });

    const result = await fetchIntercomConversations('token', 36);
    expect(result).not.toBeNull();
    expect(result!.get('acme.com')).toBeDefined();
    expect(result!.get('acme.com')!.conversationVolume).toBe(2);
    expect(result!.get('acme.com')!.openCount).toBe(1);
    expect(result!.get('other.com')!.conversationVolume).toBe(1);
  });

  it('skips contacts without email', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversations: [
          mockConversation({ contacts: { contacts: [{ email: null }] } }),
        ],
        pages: { next: null },
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: [], pages: { next: null } }),
    });

    const result = await fetchIntercomConversations('token', 36);
    expect(result).not.toBeNull();
    expect(result!.size).toBe(0);
  });

  it('excludes generic domains', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversations: [
          mockConversation({ contacts: { contacts: [{ email: 'user@gmail.com' }] } }),
        ],
        pages: { next: null },
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: [], pages: { next: null } }),
    });

    const result = await fetchIntercomConversations('token', 36);
    expect(result!.size).toBe(0);
  });

  it('identifies quick resolutions (≤2 reply rounds, closed)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversations: [
          mockConversation({ state: 'closed', conversation_parts: { total_count: 2 } }),
          mockConversation({ state: 'closed', conversation_parts: { total_count: 10 } }),
        ],
        pages: { next: null },
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: [], pages: { next: null } }),
    });

    const result = await fetchIntercomConversations('token', 36);
    expect(result!.get('acme.com')!.quickResolutions).toBe(1);
  });

  it('counts AI-handled conversations', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversations: [
          mockConversation({ ai_agent_participated: true }),
          mockConversation({ ai_agent_participated: false }),
        ],
        pages: { next: null },
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: [], pages: { next: null } }),
    });

    const result = await fetchIntercomConversations('token', 36);
    expect(result!.get('acme.com')!.aiHandled).toBe(1);
  });

  it('computes response time from statistics', async () => {
    // first_admin_reply_at - created_at (unix timestamps)
    const created = Math.floor(Date.now() / 1000) - 3600; // 1h ago
    const adminReply = created + 600; // 10 min later
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversations: [
          mockConversation({
            created_at: created,
            statistics: { first_admin_reply_at: adminReply },
          }),
        ],
        pages: { next: null },
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: [], pages: { next: null } }),
    });

    const result = await fetchIntercomConversations('token', 36);
    expect(result!.get('acme.com')!.totalResponseTime).toBe(600);
    expect(result!.get('acme.com')!.responseCount).toBe(1);
  });

  it('paginates through multiple pages', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversations: [mockConversation({ id: 'c1' })],
          pages: { next: { starting_after: 'cursor-1' } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversations: [mockConversation({ id: 'c2' })],
          pages: { next: null },
        }),
      })
      .mockResolvedValueOnce({
        // Open query
        ok: true,
        json: async () => ({ conversations: [], pages: { next: null } }),
      });

    const result = await fetchIntercomConversations('token', 36);
    expect(result!.get('acme.com')!.conversationVolume).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/clients/intercomClient.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `intercomClient.ts`**

Create `backend/src/clients/intercomClient.ts`:

```typescript
export interface IntercomDailySnapshot {
  conversationVolume: number;
  openCount: number;
  totalResponseTime: number;
  responseCount: number;
  quickResolutions: number;
  aiHandled: number;
}

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'aol.com',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com',
]);

const MAX_PAGES = 20;
const BASE_URL = 'https://api.intercom.io';

interface IntercomConversation {
  id: string;
  state: string;
  created_at?: number;
  statistics?: { first_admin_reply_at?: number };
  conversation_parts?: { total_count: number };
  ai_agent_participated?: boolean;
  contacts?: { contacts: Array<{ email?: string | null }> };
}

interface IntercomSearchResponse {
  conversations: IntercomConversation[];
  pages: { next?: { starting_after: string } | null };
}

async function searchConversations(
  token: string,
  query: Record<string, any>,
  startingAfter?: string
): Promise<IntercomSearchResponse | null> {
  const body: any = { query };
  if (startingAfter) {
    body.pagination = { starting_after: startingAfter };
  }

  const res = await fetch(`${BASE_URL}/conversations/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.15',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) return null;
  return res.json();
}

function getDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  const domain = email.split('@')[1].toLowerCase();
  if (GENERIC_DOMAINS.has(domain)) return null;
  return domain;
}

function processConversation(
  conv: IntercomConversation,
  map: Map<string, IntercomDailySnapshot>,
  field: 'incremental' | 'open'
): void {
  const contact = conv.contacts?.contacts?.[0];
  const domain = getDomain(contact?.email);
  if (!domain) return;

  if (!map.has(domain)) {
    map.set(domain, {
      conversationVolume: 0, openCount: 0,
      totalResponseTime: 0, responseCount: 0,
      quickResolutions: 0, aiHandled: 0,
    });
  }
  const entry = map.get(domain)!;

  if (field === 'open') {
    entry.openCount++;
    return;
  }

  // Incremental: event-based metrics
  entry.conversationVolume++;

  if (conv.ai_agent_participated) entry.aiHandled++;

  if (conv.state === 'closed' && (conv.conversation_parts?.total_count ?? 99) <= 2) {
    entry.quickResolutions++;
  }

  if (conv.created_at && conv.statistics?.first_admin_reply_at) {
    const responseTime = conv.statistics.first_admin_reply_at - conv.created_at;
    if (responseTime > 0) {
      entry.totalResponseTime += responseTime;
      entry.responseCount++;
    }
  }
}

/**
 * Fetch Intercom conversations in two passes:
 * 1. Incremental: conversations created in the last `hoursBack` hours
 * 2. Open snapshot: all currently open conversations
 *
 * Returns a Map<domain, IntercomDailySnapshot> or null on API failure.
 */
export async function fetchIntercomConversations(
  token: string,
  hoursBack: number
): Promise<Map<string, IntercomDailySnapshot> | null> {
  const sinceUnix = Math.floor(Date.now() / 1000) - hoursBack * 3600;
  const map = new Map<string, IntercomDailySnapshot>();

  // Pass 1: incremental (recent conversations)
  const incrementalQuery = {
    operator: 'AND',
    value: [{ field: 'created_at', operator: '>', value: sinceUnix }],
  };

  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await searchConversations(token, incrementalQuery, cursor);
    if (result === null) return null; // API error
    for (const conv of result.conversations) {
      processConversation(conv, map, 'incremental');
    }
    if (!result.pages.next) break;
    cursor = result.pages.next.starting_after;
  }

  // Pass 2: open conversations (point-in-time snapshot)
  const openQuery = {
    operator: 'AND',
    value: [{ field: 'state', operator: '=', value: 'open' }],
  };

  cursor = undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await searchConversations(token, openQuery, cursor);
    if (result === null) return null;
    for (const conv of result.conversations) {
      processConversation(conv, map, 'open');
    }
    if (!result.pages.next) break;
    cursor = result.pages.next.starting_after;
  }

  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/clients/intercomClient.test.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/clients/intercomClient.ts backend/src/__tests__/clients/intercomClient.test.ts
git commit -m "feat(intercom): add Intercom client with domain aggregation and tests"
```

---

## Task 3: Intercom Store — Table Storage for Daily Snapshots

**Files:**
- Create: `backend/src/services/intercomStore.ts`

- [ ] **Step 1: Implement `IntercomStore`**

Follow the same pattern as `scoreStore.ts` / `mappingStore.ts`. Create `backend/src/services/intercomStore.ts`:

```typescript
import { TableClient, TableServiceClient } from '@azure/data-tables';
import { IntercomDailySnapshot } from '../clients/intercomClient';

export class IntercomStore {
  private client: TableClient;

  constructor(connectionString: string, tableName = 'intercomscores') {
    this.client = TableClient.fromConnectionString(connectionString, tableName);
  }

  async ensureTable(): Promise<void> {
    await this.client.createTable();
  }

  /** Upsert a daily snapshot for a domain. */
  async upsertSnapshot(domain: string, date: string, data: IntercomDailySnapshot): Promise<void> {
    await this.client.upsertEntity({
      partitionKey: domain,
      rowKey: date,
      ...data,
    }, 'Replace');
  }

  /** Read last N days of snapshots for a domain, return sorted newest-first. */
  async getSnapshots(domain: string, days: number): Promise<Array<{ date: string } & IntercomDailySnapshot>> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffISO = cutoff.toISOString().slice(0, 10);

    const rows: Array<{ date: string } & IntercomDailySnapshot> = [];
    const iter = this.client.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${domain}' and RowKey ge '${cutoffISO}'`,
      },
    });

    for await (const entity of iter) {
      rows.push({
        date: entity.rowKey as string,
        conversationVolume: (entity.conversationVolume as number) ?? 0,
        openCount: (entity.openCount as number) ?? 0,
        totalResponseTime: (entity.totalResponseTime as number) ?? 0,
        responseCount: (entity.responseCount as number) ?? 0,
        quickResolutions: (entity.quickResolutions as number) ?? 0,
        aiHandled: (entity.aiHandled as number) ?? 0,
      });
    }

    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Aggregate 30 days of snapshots into a single IntercomData object.
   * Event-based fields are summed; openCount uses latest snapshot; avgResponseTime is weighted.
   */
  aggregate(snapshots: Array<{ date: string } & IntercomDailySnapshot>): IntercomAggregated | null {
    if (snapshots.length === 0) return null;

    let conversationVolume = 0;
    let quickResolutions = 0;
    let aiHandled = 0;
    let totalResponseTime = 0;
    let responseCount = 0;

    for (const s of snapshots) {
      conversationVolume += s.conversationVolume;
      quickResolutions += s.quickResolutions;
      aiHandled += s.aiHandled;
      totalResponseTime += s.totalResponseTime;
      responseCount += s.responseCount;
    }

    // Latest snapshot for point-in-time fields
    const latest = snapshots[0]; // sorted newest-first
    const openCount = latest.openCount;
    const avgResponseTime = responseCount > 0 ? totalResponseTime / responseCount : 0;

    return { conversationVolume, openCount, avgResponseTime, quickResolutions, aiHandled };
  }

  /** Delete rows older than `days` days for all domains. */
  async cleanup(days: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffISO = cutoff.toISOString().slice(0, 10);

    let deleted = 0;
    const iter = this.client.listEntities({
      queryOptions: { filter: `RowKey lt '${cutoffISO}'` },
    });

    for await (const entity of iter) {
      await this.client.deleteEntity(entity.partitionKey as string, entity.rowKey as string);
      deleted++;
    }

    return deleted;
  }
}

/** Aggregated Intercom data across 30 days — used for scoring. */
export interface IntercomAggregated {
  conversationVolume: number;
  openCount: number;
  avgResponseTime: number;
  quickResolutions: number;
  aiHandled: number;
}
```

- [ ] **Step 2: Verify build**

Run: `cd backend && npm run build`
Expected: Clean compile

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/intercomStore.ts
git commit -m "feat(intercom): add IntercomStore for daily snapshots in Table Storage"
```

---

## Task 4: Types and ScoreStore — Add Intercom Fields

**Files:**
- Modify: `backend/src/types.ts:28-43`
- Modify: `backend/src/services/scoreStore.ts:4-38,107-124`

- [ ] **Step 1: Add Intercom fields to `ChurnScore` in `types.ts`**

After line 41 (`zendeskDetails`), add:

```typescript
intercomPenalty: number | null;
intercomBonus: number | null;
intercomDetails: string | null;   // JSON string of IntercomPenaltyResult & IntercomBonusResult
```

- [ ] **Step 2: Add Intercom fields to `ScoreEntity` in `scoreStore.ts`**

After line 17 (`zendeskDetails`), add:

```typescript
intercomPenalty: number | null;
intercomBonus: number | null;
intercomDetails: string | null;
```

- [ ] **Step 3: Update `fromEntity()` in `scoreStore.ts`**

After line 35 (`zendeskDetails`), add:

```typescript
intercomPenalty: entity.intercomPenalty ?? null,
intercomBonus: entity.intercomBonus ?? null,
intercomDetails: entity.intercomDetails ?? null,
```

- [ ] **Step 4: Update `upsertScore()` in `scoreStore.ts`**

After line 121 (`zendeskDetails`), add:

```typescript
intercomPenalty: score.intercomPenalty,
intercomBonus: score.intercomBonus,
intercomDetails: score.intercomDetails,
```

- [ ] **Step 5: Verify build**

Run: `cd backend && npm run build`
Expected: Compile errors in SyncRunner.ts and AccountsApi.ts (they don't yet pass the new fields to `upsertScore`). This is expected and will be fixed in Tasks 6 and 7. For now verify `types.ts` and `scoreStore.ts` compile.

Run: `cd backend && npx tsc --noEmit backend/src/types.ts backend/src/services/scoreStore.ts 2>&1 || npm run build 2>&1 | head -5`

- [ ] **Step 6: Commit**

```bash
git add backend/src/types.ts backend/src/services/scoreStore.ts
git commit -m "feat(types): add intercomPenalty, intercomBonus, intercomDetails to ChurnScore and ScoreStore"
```

---

## Task 5: Scoring — Intercom Penalty and Bonus

**Files:**
- Create: `backend/src/__tests__/services/intercomPenalty.test.ts`
- Modify: `backend/src/services/healthScoreService.ts`

- [ ] **Step 1: Write failing tests for `computeIntercomPenalty`**

Create `backend/src/__tests__/services/intercomPenalty.test.ts`:

```typescript
import {
  computeIntercomPenalty,
  computeIntercomBonus,
  applyAllPenalties,
  HealthScoreResult,
} from '../../services/healthScoreService';
import { IntercomAggregated } from '../../services/intercomStore';
import { ZendeskTicketData } from '../../clients/zendeskClient';

function ic(overrides: Partial<IntercomAggregated> = {}): IntercomAggregated {
  return {
    conversationVolume: 0, openCount: 0, avgResponseTime: 0,
    quickResolutions: 0, aiHandled: 0,
    ...overrides,
  };
}

function zd(overrides: Partial<ZendeskTicketData> = {}): ZendeskTicketData {
  return { ticketVolume: 0, openCount: 0, highPriorityCount: 0, urgentCount: 0, ...overrides };
}

function baseResult(overrides: Partial<HealthScoreResult> = {}): HealthScoreResult {
  return {
    score: 80, tier: 'healthy',
    licenseUtilization: 0.8, monthlyActiveUsers: 80,
    featuresUsed: 10, featureDetails: null,
    ...overrides,
  };
}

describe('computeIntercomPenalty', () => {
  // ── Open/unresolved bands ──────────────────────────────────────────────
  it('0 open → 0 penalty', () => {
    expect(computeIntercomPenalty(ic()).openPenalty).toBe(0);
  });
  it('1 open → -2 penalty', () => {
    expect(computeIntercomPenalty(ic({ openCount: 1 })).openPenalty).toBe(-2);
  });
  it('2 open → -2 penalty', () => {
    expect(computeIntercomPenalty(ic({ openCount: 2 })).openPenalty).toBe(-2);
  });
  it('3 open → -4 penalty', () => {
    expect(computeIntercomPenalty(ic({ openCount: 3 })).openPenalty).toBe(-4);
  });
  it('5 open → -4 penalty', () => {
    expect(computeIntercomPenalty(ic({ openCount: 5 })).openPenalty).toBe(-4);
  });
  it('6 open → -7 penalty', () => {
    expect(computeIntercomPenalty(ic({ openCount: 6 })).openPenalty).toBe(-7);
  });

  // ── Slow response bands ────────────────────────────────────────────────
  it('no slow response when avg < 24h', () => {
    expect(computeIntercomPenalty(ic({ avgResponseTime: 3600, conversationVolume: 5 })).slowPenalty).toBe(0);
  });
  it('no slow response when < 3 conversations even if avg > 24h', () => {
    expect(computeIntercomPenalty(ic({ avgResponseTime: 90000, conversationVolume: 2 })).slowPenalty).toBe(0);
  });
  it('-5 when avg > 24h AND 3+ conversations', () => {
    expect(computeIntercomPenalty(ic({ avgResponseTime: 90000, conversationVolume: 3 })).slowPenalty).toBe(-5);
  });

  // ── Total and cap ──────────────────────────────────────────────────────
  it('max penalty is -12', () => {
    const r = computeIntercomPenalty(ic({ openCount: 10, avgResponseTime: 90000, conversationVolume: 5 }));
    expect(r.totalPenalty).toBe(-12);
  });
  it('zero data → zero penalty', () => {
    expect(computeIntercomPenalty(ic()).totalPenalty).toBe(0);
  });
});

describe('computeIntercomBonus', () => {
  // ── Quick resolutions ──────────────────────────────────────────────────
  it('0 quick resolutions → 0 bonus', () => {
    expect(computeIntercomBonus(ic()).quickResolutionBonus).toBe(0);
  });
  it('1 quick resolution → +1', () => {
    expect(computeIntercomBonus(ic({ quickResolutions: 1 })).quickResolutionBonus).toBe(1);
  });
  it('3 quick resolutions → +2', () => {
    expect(computeIntercomBonus(ic({ quickResolutions: 3 })).quickResolutionBonus).toBe(2);
  });
  it('5 quick resolutions → +4', () => {
    expect(computeIntercomBonus(ic({ quickResolutions: 5 })).quickResolutionBonus).toBe(4);
  });

  // ── AI-handled ─────────────────────────────────────────────────────────
  it('0 AI → 0 bonus', () => {
    expect(computeIntercomBonus(ic()).aiBonus).toBe(0);
  });
  it('1 AI → +1', () => {
    expect(computeIntercomBonus(ic({ aiHandled: 1 })).aiBonus).toBe(1);
  });
  it('3 AI → +3', () => {
    expect(computeIntercomBonus(ic({ aiHandled: 3 })).aiBonus).toBe(3);
  });

  // ── Active engagement ──────────────────────────────────────────────────
  it('volume < 3 → 0 engagement bonus', () => {
    expect(computeIntercomBonus(ic({ conversationVolume: 2, openCount: 0 })).engagementBonus).toBe(0);
  });
  it('volume ≥ 3, open ≤ 1 → +3', () => {
    expect(computeIntercomBonus(ic({ conversationVolume: 3, openCount: 1 })).engagementBonus).toBe(3);
  });
  it('volume ≥ 3, open > 1 → 0 (stuck, not engaged)', () => {
    expect(computeIntercomBonus(ic({ conversationVolume: 5, openCount: 3 })).engagementBonus).toBe(0);
  });

  // ── Total and cap ──────────────────────────────────────────────────────
  it('max bonus is +10', () => {
    const r = computeIntercomBonus(ic({ quickResolutions: 10, aiHandled: 5, conversationVolume: 10, openCount: 0 }));
    expect(r.totalBonus).toBe(10);
  });
});

describe('applyAllPenalties', () => {
  it('null Zendesk + null Intercom → base unchanged', () => {
    const r = applyAllPenalties(baseResult(), null, null);
    expect(r.score).toBe(80);
    expect(r.zendeskPenalty).toBeNull();
    expect(r.intercomPenalty).toBeNull();
    expect(r.intercomBonus).toBeNull();
  });

  it('Zendesk only → same as before', () => {
    const r = applyAllPenalties(baseResult(), zd({ openCount: 6 }), null);
    expect(r.zendeskPenalty).toBe(-7);
    expect(r.intercomPenalty).toBeNull();
    expect(r.score).toBe(73);
  });

  it('Intercom only → penalty applied', () => {
    const r = applyAllPenalties(baseResult(), null, ic({ openCount: 3 }));
    expect(r.intercomPenalty).toBe(-4);
    expect(r.score).toBe(76);
  });

  it('combined penalties capped at -20', () => {
    // Zendesk: 11 tickets(-8) + 6 open(-7) + urgent(-5) = -20
    // Intercom: 6 open(-7) = -7
    // Total: -27, capped at -20
    const r = applyAllPenalties(
      baseResult({ score: 100 }),
      zd({ ticketVolume: 11, openCount: 6, urgentCount: 1, highPriorityCount: 0 }),
      ic({ openCount: 6 })
    );
    expect(r.score).toBe(80); // 100 - 20
  });

  it('engagement bonus applied after penalty', () => {
    const r = applyAllPenalties(
      baseResult({ score: 70 }),
      null,
      ic({ openCount: 0, quickResolutions: 5, aiHandled: 3, conversationVolume: 5 })
    );
    // bonus: 4 + 3 + 3 = 10
    expect(r.intercomBonus).toBe(10);
    expect(r.score).toBe(80); // 70 + 10
  });

  it('score clamped to 0-110', () => {
    const r = applyAllPenalties(
      baseResult({ score: 100 }),
      null,
      ic({ quickResolutions: 10, aiHandled: 5, conversationVolume: 10, openCount: 0 })
    );
    expect(r.score).toBe(110);
  });

  it('score clamped at 0 when heavy penalties', () => {
    const r = applyAllPenalties(
      baseResult({ score: 10 }),
      zd({ ticketVolume: 11, openCount: 6, urgentCount: 1, highPriorityCount: 0 }),
      ic({ openCount: 6 })
    );
    expect(r.score).toBe(0);
  });

  it('null base score → penalties attached but score stays null', () => {
    const r = applyAllPenalties(
      baseResult({ score: null, tier: 'unmapped' }),
      zd({ openCount: 3 }),
      ic({ openCount: 2 })
    );
    expect(r.score).toBeNull();
    expect(r.zendeskPenalty).toBe(-4);
    expect(r.intercomPenalty).toBe(-2);
  });

  it('tier re-derived from adjusted score', () => {
    const r = applyAllPenalties(
      baseResult({ score: 82 }),
      null,
      ic({ openCount: 3 }) // -4
    );
    expect(r.score).toBe(78);
    expect(r.tier).toBe('watch');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/__tests__/services/intercomPenalty.test.ts --no-coverage`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement scoring functions in `healthScoreService.ts`**

Add the following after the existing `computeZendeskPenalty` function. Also add `applyAllPenalties` and update exports.

Add import at top of file:
```typescript
import { IntercomAggregated } from './intercomStore';
```

Add after `computeZendeskPenalty`:

```typescript
// ── Intercom penalty scoring ────────────────────────────────────────────────

export interface IntercomPenaltyResult {
  totalPenalty: number;      // 0 to -12
  openPenalty: number;       // 0 to -7
  slowPenalty: number;       // 0 to -5
  openCount: number;
  avgResponseTime: number;
}

const SECONDS_24H = 86400;

export function computeIntercomPenalty(data: IntercomAggregated): IntercomPenaltyResult {
  // ── Open penalty ──────────────────────────────────────────────────────
  let openPenalty = 0;
  if (data.openCount >= 6) {
    openPenalty = -7;
  } else if (data.openCount >= 3) {
    openPenalty = -4;
  } else if (data.openCount >= 1) {
    openPenalty = -2;
  }

  // ── Slow response penalty ─────────────────────────────────────────────
  let slowPenalty = 0;
  if (data.avgResponseTime > SECONDS_24H && data.conversationVolume >= 3) {
    slowPenalty = -5;
  }

  const totalPenalty = openPenalty + slowPenalty;

  return {
    totalPenalty,
    openPenalty,
    slowPenalty,
    openCount: data.openCount,
    avgResponseTime: data.avgResponseTime,
  };
}

// ── Intercom engagement bonus ───────────────────────────────────────────────

export interface IntercomBonusResult {
  totalBonus: number;          // 0 to +10
  quickResolutionBonus: number; // 0 to +4
  aiBonus: number;              // 0 to +3
  engagementBonus: number;      // 0 to +3
}

export function computeIntercomBonus(data: IntercomAggregated): IntercomBonusResult {
  // ── Quick resolutions ─────────────────────────────────────────────────
  let quickResolutionBonus = 0;
  if (data.quickResolutions >= 5) {
    quickResolutionBonus = 4;
  } else if (data.quickResolutions >= 3) {
    quickResolutionBonus = 2;
  } else if (data.quickResolutions >= 1) {
    quickResolutionBonus = 1;
  }

  // ── AI-handled ────────────────────────────────────────────────────────
  let aiBonus = 0;
  if (data.aiHandled >= 3) {
    aiBonus = 3;
  } else if (data.aiHandled >= 1) {
    aiBonus = 1;
  }

  // ── Active engagement ─────────────────────────────────────────────────
  let engagementBonus = 0;
  if (data.conversationVolume >= 3 && data.openCount <= 1) {
    engagementBonus = 3;
  }

  const totalBonus = Math.min(10, quickResolutionBonus + aiBonus + engagementBonus);

  return { totalBonus, quickResolutionBonus, aiBonus, engagementBonus };
}
```

- [ ] **Step 4: Implement `applyAllPenalties`**

Add after `computeIntercomBonus`. This replaces `applyZendeskPenalty`:

```typescript
/**
 * Apply Zendesk penalty, Intercom penalty, and Intercom engagement bonus.
 *
 * Combined Zendesk + Intercom penalty is capped at -20.
 * Engagement bonus (0 to +10) applied after penalties.
 * Final score clamped to 0–110.
 */
export function applyAllPenalties(
  baseResult: HealthScoreResult,
  zendeskData: ZendeskTicketData | null,
  intercomData: IntercomAggregated | null
): HealthScoreResult & {
  zendeskPenalty: number | null;
  intercomPenalty: number | null;
  intercomBonus: number | null;
} {
  const zdPenalty = zendeskData ? computeZendeskPenalty(zendeskData).totalPenalty : null;
  const icPenalty = intercomData ? computeIntercomPenalty(intercomData).totalPenalty : null;
  const icBonus = intercomData ? computeIntercomBonus(intercomData).totalBonus : null;

  // If base score is null (unmapped), attach penalties but don't adjust
  if (baseResult.score === null) {
    return { ...baseResult, zendeskPenalty: zdPenalty, intercomPenalty: icPenalty, intercomBonus: icBonus };
  }

  // Combined penalty capped at -20
  const rawPenalty = (zdPenalty ?? 0) + (icPenalty ?? 0);
  const combinedPenalty = Math.max(rawPenalty, -20);

  // Apply penalty then bonus, clamp 0–110
  const afterPenalty = baseResult.score + combinedPenalty;
  const afterBonus = afterPenalty + (icBonus ?? 0);
  const adjustedScore = Math.max(0, Math.min(110, afterBonus));

  const tier = scoreToTier(adjustedScore);

  return {
    ...baseResult,
    score: adjustedScore,
    tier,
    zendeskPenalty: zdPenalty,
    intercomPenalty: icPenalty,
    intercomBonus: icBonus,
  };
}
```

Keep `applyZendeskPenalty` for now (remove in Task 6 when callers are migrated).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/services/intercomPenalty.test.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 6: Run all tests to check for regressions**

Run: `cd backend && npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/healthScoreService.ts backend/src/__tests__/services/intercomPenalty.test.ts
git commit -m "feat(scoring): add Intercom penalty, bonus, and applyAllPenalties"
```

---

## Task 6: SyncRunner — Integrate Intercom into Nightly Sync

**Files:**
- Modify: `backend/src/functions/SyncRunner.ts`
- Modify: `backend/src/__tests__/services/SyncRunner.test.ts`

- [ ] **Step 1: Add imports to SyncRunner.ts**

Add at the top of `SyncRunner.ts`:

```typescript
import { fetchIntercomConversations, IntercomDailySnapshot } from '../clients/intercomClient';
import { IntercomStore, IntercomAggregated } from '../services/intercomStore';
import { applyAllPenalties, computeIntercomPenalty, computeIntercomBonus } from '../services/healthScoreService';
```

Update import of `healthScoreService` to also import `applyAllPenalties` (and remove `applyZendeskPenalty` from the import).

- [ ] **Step 2: Add `intercomFetched` to `SyncResult`**

Add field to the `SyncResult` interface:

```typescript
intercomFetched: number;
```

And initialise it alongside `zendeskFetched`:

```typescript
let intercomFetched = 0;
```

- [ ] **Step 3: Add Intercom fetch phase after Zendesk phase**

After the Zendesk fetch block (after line ~172), add:

```typescript
// ── Intercom fetch phase ───────────────────────────────────────────────────
const intercomEnabled = !!config.intercomAccessToken;
const intercomStore = new IntercomStore(config.storageConnectionString);
let intercomDomainMap = new Map<string, IntercomAggregated>();

if (intercomEnabled) {
  await intercomStore.ensureTable();

  // Incremental fetch: last 36 hours
  const snapshots = await fetchIntercomConversations(config.intercomAccessToken!, 36);

  if (snapshots === null) {
    log('Intercom: fetch failed (possible auth failure)');
  } else {
    // Store today's snapshots
    for (const [domain, data] of snapshots) {
      await intercomStore.upsertSnapshot(domain, todayISO, data);
    }
    log(`Intercom: stored snapshots for ${snapshots.size} domains`);

    // Aggregate last 30 days per domain for scoring
    const allDomains = new Set<string>();
    // Collect domains from today's fetch + any previously stored
    for (const [domain] of snapshots) allDomains.add(domain);

    // Also check stored accounts' domains to aggregate for accounts not in today's fetch
    for (const company of companies) {
      const d = storedMap.get(company.accountId)?.domain ?? company.domain;
      if (d) allDomains.add(d);
    }

    for (const domain of allDomains) {
      const rows = await intercomStore.getSnapshots(domain, 30);
      const aggregated = intercomStore.aggregate(rows);
      if (aggregated) {
        intercomDomainMap.set(domain, aggregated);
      }
    }

    intercomFetched = intercomDomainMap.size;
    log(`Intercom: ${intercomFetched} domains with 30d aggregated data`);
  }

  // Cleanup old rows
  const deleted = await intercomStore.cleanup(35);
  if (deleted > 0) log(`Intercom: cleaned up ${deleted} old snapshot rows`);
} else {
  log('Intercom: disabled (missing config)');
}
```

- [ ] **Step 4: Replace `applyZendeskPenalty` with `applyAllPenalties` in scoring loop**

In the per-account scoring loop, replace:

```typescript
const adjusted = applyZendeskPenalty(baseResult, zendeskData);
const penaltyDetails = zendeskData ? computeZendeskPenalty(zendeskData) : null;
```

With:

```typescript
const accountDomain = storedMap.get(company.accountId)?.domain ?? company.domain ?? null;
const intercomData = accountDomain ? intercomDomainMap.get(accountDomain) ?? null : null;
const adjusted = applyAllPenalties(baseResult, zendeskData, intercomData);
const penaltyDetails = zendeskData ? computeZendeskPenalty(zendeskData) : null;
const intercomPenaltyDetails = intercomData ? computeIntercomPenalty(intercomData) : null;
const intercomBonusDetails = intercomData ? computeIntercomBonus(intercomData) : null;
```

- [ ] **Step 5: Add Intercom fields to `upsertScore` call**

In the `scoreStore.upsertScore({...})` call, add:

```typescript
intercomPenalty: adjusted.intercomPenalty,
intercomBonus: adjusted.intercomBonus,
intercomDetails: intercomData ? JSON.stringify({
  ...intercomPenaltyDetails,
  ...intercomBonusDetails,
  conversationVolume: intercomData.conversationVolume,
  quickResolutions: intercomData.quickResolutions,
  aiHandled: intercomData.aiHandled,
}) : null,
```

Do the same for the unmapped-account path and the error path (null values).

- [ ] **Step 6: Update return value**

Add `intercomFetched` to the return object:

```typescript
return { synced, scored, failed, zendeskFetched, intercomFetched, errors };
```

- [ ] **Step 7: Add SyncRunner tests**

In `SyncRunner.test.ts`, add mock for intercomClient at the top (same pattern as Zendesk):

```typescript
jest.mock('../../clients/intercomClient');
import { fetchIntercomConversations } from '../../clients/intercomClient';
const mockFetchIntercom = fetchIntercomConversations as jest.MockedFunction<typeof fetchIntercomConversations>;
```

Add mock for IntercomStore (same pattern as other stores).

Add enable/disable helpers:

```typescript
function enableIntercomConfig() {
  process.env.INTERCOM_ACCESS_TOKEN = 'ic-token-123';
}
function disableIntercomConfig() {
  delete process.env.INTERCOM_ACCESS_TOKEN;
}
```

Add tests:

```typescript
it('skips Intercom when INTERCOM_ACCESS_TOKEN not set', async () => {
  setupStoreMocks({ mappings: [{ accountId: 'hs-001', amplitudeAlias: 'alpha' }] });
  mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]);
  mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);

  const result = await runSync();
  expect(mockFetchIntercom).not.toHaveBeenCalled();
  expect(result.intercomFetched).toBe(0);
});

it('fetches and scores Intercom data when configured', async () => {
  enableIntercomConfig();
  const { upsertScore } = setupStoreMocks({
    mappings: [{ accountId: 'hs-001', amplitudeAlias: 'alpha' }],
  });
  mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]);
  mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);
  mockFetchIntercom.mockResolvedValue(new Map()); // no conversations

  const result = await runSync();
  expect(mockFetchIntercom).toHaveBeenCalled();
  disableIntercomConfig();
});
```

- [ ] **Step 8: Run all tests**

Run: `cd backend && npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add backend/src/functions/SyncRunner.ts backend/src/__tests__/services/SyncRunner.test.ts
git commit -m "feat(sync): integrate Intercom fetch, store, and scoring into nightly sync"
```

---

## Task 7: AccountsApi — Switch to `applyAllPenalties` and Serve Intercom Details

**Files:**
- Modify: `backend/src/functions/AccountsApi.ts`

- [ ] **Step 1: Update imports**

Replace `applyZendeskPenalty` import with `applyAllPenalties`. Add `IntercomStore` import.

- [ ] **Step 2: Update POST handler (on-demand score refresh)**

In the POST handler, after the Zendesk fetch block, add Intercom data lookup:

```typescript
// Fetch Intercom aggregated data for this account's domain
let intercomData: IntercomAggregated | null = null;
if (account.domain && config.intercomAccessToken) {
  const intercomStore = new IntercomStore(config.storageConnectionString);
  const rows = await intercomStore.getSnapshots(account.domain, 30);
  intercomData = intercomStore.aggregate(rows);
}
```

Replace both `applyZendeskPenalty(baseResult, zendeskData)` calls with:

```typescript
const adjusted = applyAllPenalties(baseResult, zendeskData, intercomData);
```

Update `computeIntercomPenalty` / `computeIntercomBonus` calls for `intercomDetails` JSON storage.

Update the `upsertScore` calls to include `intercomPenalty`, `intercomBonus`, `intercomDetails`.

- [ ] **Step 3: Update GET handler (score breakdown response)**

In the GET handler's `scoreBreakdown` object, add:

```typescript
intercomPenalty: scoreRow.intercomPenalty ?? null,
intercomBonus: scoreRow.intercomBonus ?? null,
intercomDetails: scoreRow.intercomDetails ? JSON.parse(scoreRow.intercomDetails as string) : null,
```

- [ ] **Step 4: Remove `applyZendeskPenalty` from healthScoreService.ts**

Now that all callers use `applyAllPenalties`, remove the old `applyZendeskPenalty` function and update its test file (`zendeskPenalty.test.ts`) to test via `applyAllPenalties` instead.

- [ ] **Step 5: Run all tests**

Run: `cd backend && npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 6: Verify build**

Run: `cd backend && npm run build`
Expected: Clean compile

- [ ] **Step 7: Commit**

```bash
git add backend/src/functions/AccountsApi.ts backend/src/services/healthScoreService.ts backend/src/__tests__/services/zendeskPenalty.test.ts
git commit -m "feat(api): switch to applyAllPenalties, serve Intercom details, remove applyZendeskPenalty"
```

---

## Task 8: Frontend — Side Panel Cards and Score > 100

**Files:**
- Modify: `frontend/src/pages/Portfolio.tsx`

- [ ] **Step 1: Add Intercom penalty info helper**

After the existing `zendeskPenaltyInfo` function, add:

```typescript
function intercomPenaltyInfo(details: any | null): { pts: string; label: string; detail: string; hint: string | null } {
  if (!details) return { pts: 'N/A', label: 'No data', detail: 'Intercom not configured or no domain', hint: null };
  const penalty = (details.openPenalty ?? 0) + (details.slowPenalty ?? 0);
  if (penalty === 0) return { pts: '0', label: 'No issues', detail: 'No open conversation burden', hint: 'Clean — no Intercom penalty applied.' };
  const parts = [];
  if (details.openCount > 0) parts.push(`${details.openCount} open`);
  if (details.slowPenalty < 0) parts.push('slow responses');
  return {
    pts: String(penalty),
    label: parts.join(', '),
    detail: `Open: ${details.openCount} · Avg response: ${Math.round((details.avgResponseTime ?? 0) / 3600)}h`,
    hint: penalty <= -8 ? 'High support burden from Intercom conversations.' : 'Some open conversations — monitor closely.',
  };
}

function intercomBonusInfo(details: any | null): { pts: string; label: string; detail: string; hint: string | null } {
  if (!details) return { pts: 'N/A', label: 'No data', detail: 'Intercom not configured', hint: null };
  const bonus = details.totalBonus ?? 0;
  if (bonus === 0) return { pts: '0', label: 'No engagement', detail: 'No qualifying engagement signals detected', hint: null };
  const parts = [];
  if (details.quickResolutionBonus > 0) parts.push(`${details.quickResolutions} quick resolutions`);
  if (details.aiBonus > 0) parts.push(`${details.aiHandled} AI-handled`);
  if (details.engagementBonus > 0) parts.push('active & not stuck');
  return {
    pts: `+${bonus}`,
    label: parts.join(', '),
    detail: `Quick: ${details.quickResolutions ?? 0} · AI: ${details.aiHandled ?? 0} · Volume: ${details.conversationVolume ?? 0}`,
    hint: bonus >= 7 ? 'Highly engaged — strong product adoption signals.' : 'Some positive engagement signals detected.',
  };
}
```

- [ ] **Step 2: Handle score > 100 in score display**

Where the score is displayed, add a "+N" badge when score exceeds 100:

```typescript
// In the score display area, after the score number:
{score > 100 && (
  <span className="text-tier-healthy text-[12px] font-bold ml-1">+{score - 100}</span>
)}
```

For the score bar, cap the visual width at 100%:

```typescript
const barPct = Math.min(100, score);
```

- [ ] **Step 3: Add Intercom cards to side panel**

After the Zendesk "Support Load" card, add the two Intercom cards using the same card pattern. Rename the existing Zendesk card label from "Support Load" to "Zendesk Support".

Add an "Intercom Support" penalty card and an "Intercom Engagement" bonus card, reading from `bd?.intercomDetails`.

- [ ] **Step 4: Add combined penalty cap note**

Below the Intercom Support card, add:

```typescript
{bd?.zendeskPenalty != null && bd?.intercomPenalty != null && (
  <p className="text-[12px] text-obs-ghost italic px-1">
    Combined support penalty capped at -20
  </p>
)}
```

- [ ] **Step 5: Update scoring key**

In the Scoring Key section at the bottom of the side panel, add the Intercom rows and update the total note:

```typescript
<span>Intercom open {'\u2265'}6       <b className="text-obs-text">-7</b></span>
<span>Intercom slow resp        <b className="text-obs-text">-5</b></span>
<span>Engagement bonus          <b className="text-obs-text">+10</b></span>
```

Update the "Score out of" text:

```typescript
{hasLicenses
  ? 'Score out of 110 (100 base + 10 engagement bonus, minus penalties)'
  : 'Score out of 50 — enter licence count to unlock utilisation'}
```

- [ ] **Step 6: Verify frontend build**

Run: `cd frontend && npm run build`
Expected: Clean compile

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Portfolio.tsx
git commit -m "feat(ui): add Intercom penalty and engagement cards to side panel"
```

---

## Task 9: Update CLAUDE.md and Docs

**Files:**
- Modify: `backend/CLAUDE.md` (in `cs-copilot/CLAUDE.md`)

- [ ] **Step 1: Update CLAUDE.md**

In the `healthScoreService.ts` description, update to:

```
- `healthScoreService.ts` - Pure scoring: licence utilisation (0–60) + activity trend (0–25) + feature adoption (0–15) + Intercom bonus (0–10) − Zendesk/Intercom penalty (0 to -20).
```

Add to the Clients section:

```
- `intercomClient.ts` - Intercom Conversations API: bulk-fetch conversations (incremental + open snapshot), aggregate by contact email domain. Bearer token auth.
```

Add to the Services section:

```
- `intercomStore.ts` - `IntercomStore` for `intercomscores` table. `partitionKey = domain`, `rowKey = YYYY-MM-DD`. Daily snapshots aggregated for 30d scoring.
```

Add to Env vars:

```
`INTERCOM_ACCESS_TOKEN` (optional, enables Intercom scoring)
```

- [ ] **Step 2: Commit**

```bash
git add cs-copilot/CLAUDE.md
git commit -m "docs: update CLAUDE.md with Intercom integration details"
```

---

## Task 10: Deploy and Verify

- [ ] **Step 1: Run full test suite**

Run: `cd backend && npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 2: Build both projects**

Run: `cd backend && npm run build`
Run: `cd frontend && npm run build`
Expected: Both clean

- [ ] **Step 3: Deploy backend**

Run: `cd backend && npx azure-functions-core-tools@4.0.6610 azure functionapp publish cs-copilot-func`
Expected: All functions synced

- [ ] **Step 4: Deploy frontend**

Run: `cd frontend && npx @azure/static-web-apps-cli deploy dist --app-name cs-copilot-ui --env production --no-use-keychain`
Expected: Deployed to production

- [ ] **Step 5: Commit any final changes**

```bash
git commit -m "chore: deploy Intercom integration"
```
