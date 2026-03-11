# CS Copilot MVP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CS Copilot MVP — sync active HubSpot clients into Azure Table Storage, map them to Amplitude aliases via a web UI, compute health scores nightly via n8n + Amplitude MCP, and display everything in the existing React app.

**Architecture:** n8n Cloud owns all data writes (HubSpot sync → Azure Table Storage, Amplitude MCP fetch, health score computation). Azure Functions is a thin read API + mapping CRUD. React frontend adds a Mapping page and wires scores into the existing Portfolio page.

**Tech Stack:** Azure Functions v4 (Node.js 20, TypeScript, CommonJS), `@azure/data-tables`, Zod, Jest + ts-jest, React 18 + Vite + Tailwind CSS, react-router-dom v6, n8n Cloud.

**Spec:** `cs-copilot/docs/plans/2026-03-11-cs-copilot-mvp-design.md`

---

## File Map

### Backend — files to create or modify

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/src/types.ts` | Rewrite | All shared TypeScript interfaces |
| `backend/src/config.ts` | Update | Add `tableMapping` and `n8nSyncWebhookUrl` |
| `backend/src/services/accountStore.ts` | Rewrite | `accounts` table CRUD — RowKey = HubSpot ID |
| `backend/src/services/mappingStore.ts` | Create | `amplitudemapping` table CRUD |
| `backend/src/services/scoreStore.ts` | Create | `churnscores` table reads |
| `backend/src/functions/AccountsApi.ts` | Rewrite | `GET /api/accounts`, `GET /api/accounts/:id` — read-only |
| `backend/src/functions/MappingApi.ts` | Create | `GET/POST/DELETE /api/mapping` |
| `backend/src/functions/SyncTrigger.ts` | Create | `POST /api/sync` — fires n8n webhook |
| `backend/src/functions/ImportAccounts.ts` | Delete | Replaced by HubSpot sync |
| `backend/src/index.ts` | Update | Register new functions, remove old |
| `backend/src/__tests__/services/accountStore.test.ts` | Create | Tests for accountStore |
| `backend/src/__tests__/services/mappingStore.test.ts` | Create | Tests for mappingStore |
| `backend/src/__tests__/services/scoreStore.test.ts` | Create | Tests for scoreStore |

### Frontend — files to create or modify

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/types.ts` | Rewrite | Align with new backend types |
| `frontend/src/services/api.ts` | Rewrite | New endpoints, remove old write calls |
| `frontend/src/pages/Portfolio.tsx` | Rewrite | Scores, sync button, unmapped flag; remove editing |
| `frontend/src/pages/Mapping.tsx` | Create | Amplitude alias management UI |
| `frontend/src/App.tsx` | Rewrite | Add react-router-dom routing |
| `frontend/src/main.tsx` | Update | Wrap in `<BrowserRouter>` |
| `frontend/src/components/CsvImportModal.tsx` | Delete | Replaced by HubSpot sync |

---

## Chunk 1: Backend — Types, Config, Store Services

### Task 1: Update `types.ts`

**Files:**
- Rewrite: `backend/src/types.ts`

- [ ] **Step 1: Rewrite `backend/src/types.ts`**

```typescript
// Account as synced from HubSpot and stored in the `accounts` table.
// RowKey in Table Storage = hubspotId (stable, never changes).
export interface HubspotAccount {
  hubspotId: string;
  accountName: string;
  csmName: string;
  csmEmail: string;
  arr: number;
  renewalDate: string; // ISO date YYYY-MM-DD or empty string
  hubspotUrl: string;
  syncedAt: string;    // ISO timestamp of last sync
}

// Mapping between a HubSpot company and its Amplitude account alias.
export interface AmplitudeMapping {
  hubspotId: string;
  hubspotName: string;  // denormalised for display
  amplitudeAlias: string;
  createdAt: string;
  updatedAt: string;
}

// Health score for one account on one day, stored in the `churnscores` table.
// PartitionKey = hubspotId, RowKey = YYYY-MM-DD
export interface ChurnScore {
  hubspotId: string;
  date: string;        // YYYY-MM-DD
  score: number | null;
  tier: HealthTier | 'unmapped';
  dauWauTrend: number | null;    // fractional change, e.g. -0.15 = -15%
  featureAdoption: number | null; // fraction used/total, e.g. 0.42
  lastLoginDays: number | null;  // integer days
  scoreDelta: number | null;     // vs previous day
  computedAt: string;
}

// Account as returned by GET /api/accounts — account row joined with latest score.
export interface AccountSummary extends HubspotAccount {
  score: number | null;
  tier: HealthTier | 'unmapped' | null;
  scoreDelta: number | null;
  amplitudeAlias: string | null; // null = not mapped yet
}

export type HealthTier = 'healthy' | 'watch' | 'at-risk' | 'critical';
```

- [ ] **Step 2: Build to check for TypeScript errors**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm run build 2>&1 | head -30
```

Expected: errors referencing old types in `AccountsApi.ts` and `accountStore.ts` — this is expected and will be fixed in subsequent tasks.

---

### Task 2: Update `config.ts`

**Files:**
- Modify: `backend/src/config.ts`

- [ ] **Step 1: Update `config.ts`**

Replace the full file:

```typescript
export interface Config {
  storageConnectionString: string;
  tableAccounts: string;
  tableMapping: string;
  tableScores: string;
  n8nSyncWebhookUrl: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getConfig(): Config {
  return {
    storageConnectionString: requireEnv('AZURE_STORAGE_CONNECTION_STRING'),
    tableAccounts: process.env.AZURE_STORAGE_TABLE_ACCOUNTS ?? 'accounts',
    tableMapping: process.env.AZURE_STORAGE_TABLE_MAPPING ?? 'amplitudemapping',
    tableScores: process.env.AZURE_STORAGE_TABLE_SCORES ?? 'churnscores',
    n8nSyncWebhookUrl: requireEnv('N8N_SYNC_WEBHOOK_URL'),
  };
}
```

- [ ] **Step 2: Update `local.settings.json`** — add the two new vars (never commit this file)

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AZURE_STORAGE_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "AZURE_STORAGE_TABLE_ACCOUNTS": "accounts",
    "AZURE_STORAGE_TABLE_MAPPING": "amplitudemapping",
    "AZURE_STORAGE_TABLE_SCORES": "churnscores",
    "N8N_SYNC_WEBHOOK_URL": "https://your-n8n-instance.app.n8n.cloud/webhook/sync"
  }
}
```

---

### Task 3: Rewrite `accountStore.ts`

**Files:**
- Rewrite: `backend/src/services/accountStore.ts`
- Create: `backend/src/__tests__/services/accountStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/services/accountStore.test.ts`:

```typescript
import { AccountStore } from '../../services/accountStore';
import { HubspotAccount } from '../../types';

// Mock @azure/data-tables before importing AccountStore
const mockUpsertEntity = jest.fn().mockResolvedValue(undefined);
const mockListEntities = jest.fn();
const mockGetEntity = jest.fn();
const mockCreateTable = jest.fn().mockResolvedValue(undefined);

jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(() => ({
      createTable: mockCreateTable,
      upsertEntity: mockUpsertEntity,
      listEntities: mockListEntities,
      getEntity: mockGetEntity,
    })),
  },
  odata: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '')
  ),
}));

const SAMPLE: HubspotAccount = {
  hubspotId: 'hs-123',
  accountName: 'Acme Corp',
  csmName: 'Jane Smith',
  csmEmail: 'jane@example.com',
  arr: 48000,
  renewalDate: '2026-05-01',
  hubspotUrl: 'https://app.hubspot.com/contacts/123',
  syncedAt: '2026-03-11T02:00:00.000Z',
};

describe('AccountStore', () => {
  let store: AccountStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new AccountStore('UseDevelopmentStorage=true', 'accounts');
  });

  it('upserts with hubspotId as RowKey', async () => {
    await store.upsertAccount(SAMPLE);
    expect(mockUpsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'accounts',
        rowKey: 'hs-123',
        accountName: 'Acme Corp',
        arr: 48000,
      }),
      'Replace'
    );
  });

  it('listAccounts returns mapped accounts', async () => {
    const entity = {
      partitionKey: 'accounts',
      rowKey: 'hs-123',
      accountName: 'Acme Corp',
      csmName: 'Jane Smith',
      csmEmail: 'jane@example.com',
      arr: 48000,
      renewalDate: '2026-05-01',
      hubspotUrl: 'https://app.hubspot.com/contacts/123',
      syncedAt: '2026-03-11T02:00:00.000Z',
    };
    mockListEntities.mockReturnValue((async function* () { yield entity; })());
    const results = await store.listAccounts();
    expect(results).toHaveLength(1);
    expect(results[0].hubspotId).toBe('hs-123');
    expect(results[0].accountName).toBe('Acme Corp');
  });

  it('getById returns null for missing entity', async () => {
    mockGetEntity.mockRejectedValue({ statusCode: 404 });
    const result = await store.getById('hs-999');
    expect(result).toBeNull();
  });

  it('getById returns account for existing entity', async () => {
    mockGetEntity.mockResolvedValue({
      partitionKey: 'accounts',
      rowKey: 'hs-123',
      ...SAMPLE,
    });
    const result = await store.getById('hs-123');
    expect(result?.hubspotId).toBe('hs-123');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm test -- --testPathPattern=accountStore --verbose 2>&1 | tail -20
```

Expected: FAIL — `AccountStore` not yet updated.

- [ ] **Step 3: Rewrite `backend/src/services/accountStore.ts`**

```typescript
import { TableClient, odata } from '@azure/data-tables';
import { HubspotAccount } from '../types';

interface AccountEntity {
  partitionKey: string;
  rowKey: string;
  accountName: string;
  csmName: string;
  csmEmail: string;
  arr: number;
  renewalDate: string;
  hubspotUrl: string;
  syncedAt: string;
}

function fromEntity(entity: AccountEntity): HubspotAccount {
  return {
    hubspotId: entity.rowKey,
    accountName: entity.accountName,
    csmName: entity.csmName,
    csmEmail: entity.csmEmail,
    arr: entity.arr,
    renewalDate: entity.renewalDate,
    hubspotUrl: entity.hubspotUrl,
    syncedAt: entity.syncedAt,
  };
}

export class AccountStore {
  private client: TableClient;

  constructor(connectionString: string, tableName: string) {
    this.client = TableClient.fromConnectionString(connectionString, tableName);
  }

  async ensureTable(): Promise<void> {
    try {
      await this.client.createTable();
    } catch (err: any) {
      if (err?.statusCode !== 409) throw err; // 409 = table already exists
    }
  }

  async upsertAccount(account: HubspotAccount): Promise<void> {
    const entity: AccountEntity = {
      partitionKey: 'accounts',
      rowKey: account.hubspotId,
      accountName: account.accountName,
      csmName: account.csmName,
      csmEmail: account.csmEmail,
      arr: account.arr,
      renewalDate: account.renewalDate,
      hubspotUrl: account.hubspotUrl,
      syncedAt: account.syncedAt,
    };
    await this.client.upsertEntity(entity, 'Replace');
  }

  async listAccounts(): Promise<HubspotAccount[]> {
    const results: HubspotAccount[] = [];
    for await (const entity of this.client.listEntities<AccountEntity>({
      queryOptions: { filter: odata`PartitionKey eq 'accounts'` },
    })) {
      results.push(fromEntity(entity));
    }
    return results;
  }

  async getById(hubspotId: string): Promise<HubspotAccount | null> {
    try {
      const entity = await this.client.getEntity<AccountEntity>('accounts', hubspotId);
      return fromEntity(entity);
    } catch (err: any) {
      if (err?.statusCode === 404) return null;
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm test -- --testPathPattern=accountStore --verbose 2>&1 | tail -20
```

Expected: PASS — 4 tests passing.

---

### Task 4: Add `mappingStore.ts`

**Files:**
- Create: `backend/src/services/mappingStore.ts`
- Create: `backend/src/__tests__/services/mappingStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/services/mappingStore.test.ts`:

```typescript
import { MappingStore } from '../../services/mappingStore';
import { AmplitudeMapping } from '../../types';

const mockUpsertEntity = jest.fn().mockResolvedValue(undefined);
const mockDeleteEntity = jest.fn().mockResolvedValue(undefined);
const mockListEntities = jest.fn();
const mockGetEntity = jest.fn();
const mockCreateTable = jest.fn().mockResolvedValue(undefined);

jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(() => ({
      createTable: mockCreateTable,
      upsertEntity: mockUpsertEntity,
      deleteEntity: mockDeleteEntity,
      listEntities: mockListEntities,
      getEntity: mockGetEntity,
    })),
  },
  odata: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '')
  ),
}));

describe('MappingStore', () => {
  let store: MappingStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new MappingStore('UseDevelopmentStorage=true', 'amplitudemapping');
  });

  it('upsertMapping stores with correct keys', async () => {
    await store.upsertMapping('hs-123', 'Acme Corp', 'acme-corp-prod');
    expect(mockUpsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'mapping',
        rowKey: 'hs-123',
        hubspotName: 'Acme Corp',
        amplitudeAlias: 'acme-corp-prod',
      }),
      'Replace'
    );
  });

  it('upsertMapping preserves createdAt on update', async () => {
    const existing = {
      partitionKey: 'mapping',
      rowKey: 'hs-123',
      hubspotName: 'Acme',
      amplitudeAlias: 'old',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    mockGetEntity.mockResolvedValue(existing);
    await store.upsertMapping('hs-123', 'Acme Corp', 'new-alias');
    const call = mockUpsertEntity.mock.calls[0][0];
    expect(call.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('upsertMapping sets createdAt for new mapping', async () => {
    mockGetEntity.mockRejectedValue({ statusCode: 404 });
    await store.upsertMapping('hs-new', 'New Corp', 'new-alias');
    const call = mockUpsertEntity.mock.calls[0][0];
    expect(call.createdAt).toBeTruthy();
    expect(call.amplitudeAlias).toBe('new-alias');
  });

  it('deleteMapping throws for non-existent row', async () => {
    mockDeleteEntity.mockRejectedValue({ statusCode: 404 });
    await expect(store.deleteMapping('hs-missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('listMappings returns all rows', async () => {
    const entity = {
      partitionKey: 'mapping',
      rowKey: 'hs-123',
      hubspotName: 'Acme',
      amplitudeAlias: 'acme',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    mockListEntities.mockReturnValue((async function* () { yield entity; })());
    const results = await store.listMappings();
    expect(results).toHaveLength(1);
    expect(results[0].hubspotId).toBe('hs-123');
    expect(results[0].amplitudeAlias).toBe('acme');
  });

  it('getMapping returns null for missing row', async () => {
    mockGetEntity.mockRejectedValue({ statusCode: 404 });
    const result = await store.getMapping('hs-999');
    expect(result).toBeNull();
  });

  it('deleteMapping calls deleteEntity with correct keys', async () => {
    await store.deleteMapping('hs-123');
    expect(mockDeleteEntity).toHaveBeenCalledWith('mapping', 'hs-123');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm test -- --testPathPattern=mappingStore --verbose 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `backend/src/services/mappingStore.ts`**

```typescript
import { TableClient, odata } from '@azure/data-tables';
import { AmplitudeMapping } from '../types';

interface MappingEntity {
  partitionKey: string;
  rowKey: string;
  hubspotName: string;
  amplitudeAlias: string;
  createdAt: string;
  updatedAt: string;
}

function fromEntity(entity: MappingEntity): AmplitudeMapping {
  return {
    hubspotId: entity.rowKey,
    hubspotName: entity.hubspotName,
    amplitudeAlias: entity.amplitudeAlias,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export class MappingStore {
  private client: TableClient;

  constructor(connectionString: string, tableName: string) {
    this.client = TableClient.fromConnectionString(connectionString, tableName);
  }

  async ensureTable(): Promise<void> {
    try {
      await this.client.createTable();
    } catch (err: any) {
      if (err?.statusCode !== 409) throw err;
    }
  }

  async upsertMapping(hubspotId: string, hubspotName: string, amplitudeAlias: string): Promise<void> {
    const existing = await this.getMapping(hubspotId);
    const now = new Date().toISOString();
    const entity: MappingEntity = {
      partitionKey: 'mapping',
      rowKey: hubspotId,
      hubspotName,
      amplitudeAlias,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.client.upsertEntity(entity, 'Replace');
  }

  async listMappings(): Promise<AmplitudeMapping[]> {
    const results: AmplitudeMapping[] = [];
    for await (const entity of this.client.listEntities<MappingEntity>({
      queryOptions: { filter: odata`PartitionKey eq 'mapping'` },
    })) {
      results.push(fromEntity(entity));
    }
    return results;
  }

  async getMapping(hubspotId: string): Promise<AmplitudeMapping | null> {
    try {
      const entity = await this.client.getEntity<MappingEntity>('mapping', hubspotId);
      return fromEntity(entity);
    } catch (err: any) {
      if (err?.statusCode === 404) return null;
      throw err;
    }
  }

  async deleteMapping(hubspotId: string): Promise<void> {
    await this.client.deleteEntity('mapping', hubspotId);
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm test -- --testPathPattern=mappingStore --verbose 2>&1 | tail -20
```

Expected: PASS — 7 tests passing.

---

### Task 5: Add `scoreStore.ts`

**Files:**
- Create: `backend/src/services/scoreStore.ts`
- Create: `backend/src/__tests__/services/scoreStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/services/scoreStore.test.ts`:

```typescript
import { ScoreStore } from '../../services/scoreStore';

const mockListEntities = jest.fn();
const mockCreateTable = jest.fn().mockResolvedValue(undefined);

jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(() => ({
      createTable: mockCreateTable,
      listEntities: mockListEntities,
    })),
  },
  odata: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '')
  ),
}));

const SCORE_ENTITY = {
  partitionKey: 'hs-123',
  rowKey: '2026-03-11',
  score: 72,
  tier: 'watch',
  dauWauTrend: -0.05,
  featureAdoption: 0.6,
  lastLoginDays: 3,
  scoreDelta: -5,
  computedAt: '2026-03-11T02:00:00.000Z',
};

describe('ScoreStore', () => {
  let store: ScoreStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new ScoreStore('UseDevelopmentStorage=true', 'churnscores');
  });

  it('getLatestScoreForAccount returns most recent score within 90 days', async () => {
    mockListEntities.mockReturnValue((async function* () { yield SCORE_ENTITY; })());
    const result = await store.getLatestScoreForAccount('hs-123');
    expect(result?.score).toBe(72);
    expect(result?.tier).toBe('watch');
    expect(result?.hubspotId).toBe('hs-123');
  });

  it('getLatestScoreForAccount returns null when no rows found', async () => {
    mockListEntities.mockReturnValue((async function* () {})());
    const result = await store.getLatestScoreForAccount('hs-999');
    expect(result).toBeNull();
  });

  it('getScoreHistory returns rows sorted by date ascending', async () => {
    const older = { ...SCORE_ENTITY, rowKey: '2026-03-09', score: 80 };
    const newer = { ...SCORE_ENTITY, rowKey: '2026-03-11', score: 72 };
    mockListEntities.mockReturnValue((async function* () {
      yield newer;
      yield older;
    })());
    const result = await store.getScoreHistory('hs-123', 7);
    expect(result[0].date).toBe('2026-03-09');
    expect(result[1].date).toBe('2026-03-11');
  });

  it('getAllScoresForDate returns map of hubspotId to score', async () => {
    const entity1 = { ...SCORE_ENTITY, partitionKey: 'hs-123', score: 72 };
    const entity2 = { ...SCORE_ENTITY, partitionKey: 'hs-456', score: 45 };
    mockListEntities.mockReturnValue((async function* () {
      yield entity1;
      yield entity2;
    })());
    const result = await store.getAllScoresForDate('2026-03-11');
    expect(result.get('hs-123')?.score).toBe(72);
    expect(result.get('hs-456')?.score).toBe(45);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm test -- --testPathPattern=scoreStore --verbose 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `backend/src/services/scoreStore.ts`**

```typescript
import { TableClient, odata } from '@azure/data-tables';
import { ChurnScore, HealthTier } from '../types';

interface ScoreEntity {
  partitionKey: string;
  rowKey: string;
  score: number | null;
  tier: string;
  dauWauTrend: number | null;
  featureAdoption: number | null;
  lastLoginDays: number | null;
  scoreDelta: number | null;
  computedAt: string;
}

function fromEntity(entity: ScoreEntity): ChurnScore {
  return {
    hubspotId: entity.partitionKey,
    date: entity.rowKey,
    score: entity.score,
    tier: entity.tier as HealthTier | 'unmapped',
    dauWauTrend: entity.dauWauTrend,
    featureAdoption: entity.featureAdoption,
    lastLoginDays: entity.lastLoginDays,
    scoreDelta: entity.scoreDelta,
    computedAt: entity.computedAt,
  };
}

function nDaysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export class ScoreStore {
  private client: TableClient;

  constructor(connectionString: string, tableName: string) {
    this.client = TableClient.fromConnectionString(connectionString, tableName);
  }

  async ensureTable(): Promise<void> {
    try {
      await this.client.createTable();
    } catch (err: any) {
      if (err?.statusCode !== 409) throw err;
    }
  }

  // Returns the most recent score for one account within the last 90 days.
  // Used as fallback in GET /api/accounts when today's row doesn't exist.
  async getLatestScoreForAccount(hubspotId: string): Promise<ChurnScore | null> {
    const cutoff = nDaysAgoISO(90);
    const rows: ChurnScore[] = [];
    for await (const entity of this.client.listEntities<ScoreEntity>({
      queryOptions: {
        filter: odata`PartitionKey eq ${hubspotId} and RowKey ge ${cutoff}`,
      },
    })) {
      rows.push(fromEntity(entity));
    }
    if (rows.length === 0) return null;
    // Sort descending by date, return most recent
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows[0];
  }

  // Returns up to `days` days of score history for one account, sorted ascending.
  async getScoreHistory(hubspotId: string, days: number): Promise<ChurnScore[]> {
    const cutoff = nDaysAgoISO(days);
    const rows: ChurnScore[] = [];
    for await (const entity of this.client.listEntities<ScoreEntity>({
      queryOptions: {
        filter: odata`PartitionKey eq ${hubspotId} and RowKey ge ${cutoff}`,
      },
    })) {
      rows.push(fromEntity(entity));
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  }

  // Returns a Map of hubspotId → ChurnScore for all accounts on a given date.
  // Used by GET /api/accounts to batch-fetch today's scores in one scan.
  async getAllScoresForDate(date: string): Promise<Map<string, ChurnScore>> {
    const result = new Map<string, ChurnScore>();
    for await (const entity of this.client.listEntities<ScoreEntity>({
      queryOptions: { filter: odata`RowKey eq ${date}` },
    })) {
      result.set(entity.partitionKey, fromEntity(entity));
    }
    return result;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm test -- --testPathPattern=scoreStore --verbose 2>&1 | tail -20
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Run all tests**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm test --verbose 2>&1 | tail -30
```

Expected: all 15 tests passing across 3 suites.

- [ ] **Step 6: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/types.ts cs-copilot/backend/src/config.ts cs-copilot/backend/src/services/ cs-copilot/backend/src/__tests__/
git commit -m "feat(cs-copilot): add new store services and updated types for MVP"
```

---

## Chunk 2: Backend — Azure Functions API

### Task 6: Rewrite `AccountsApi.ts`

**Files:**
- Rewrite: `backend/src/functions/AccountsApi.ts`

The new AccountsApi is read-only. It replaces all CRUD operations with two GET endpoints that join accounts with scores.

- [ ] **Step 1: Rewrite `backend/src/functions/AccountsApi.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getConfig } from '../config';
import { AccountStore } from '../services/accountStore';
import { ScoreStore } from '../services/scoreStore';
import { MappingStore } from '../services/mappingStore';
import { AccountSummary } from '../types';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function makeStores() {
  const config = getConfig();
  return {
    accounts: new AccountStore(config.storageConnectionString, config.tableAccounts),
    scores: new ScoreStore(config.storageConnectionString, config.tableScores),
    mappings: new MappingStore(config.storageConnectionString, config.tableMapping),
  };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/accounts
// Returns all accounts joined with their latest health score.
async function listAccounts(
  req: HttpRequest,
  _context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  const { accounts, scores, mappings } = makeStores();
  await Promise.all([accounts.ensureTable(), scores.ensureTable(), mappings.ensureTable()]);

  const [allAccounts, todayScores, allMappings] = await Promise.all([
    accounts.listAccounts(),
    scores.getAllScoresForDate(todayISO()),
    mappings.listMappings(),
  ]);

  const mappingLookup = new Map(allMappings.map(m => [m.hubspotId, m.amplitudeAlias]));

  // For accounts missing today's score, fetch their most recent score
  const missingIds = allAccounts
    .filter(a => !todayScores.has(a.hubspotId))
    .map(a => a.hubspotId);

  const fallbackScores = new Map(
    await Promise.all(
      missingIds.map(async id => {
        const s = await scores.getLatestScoreForAccount(id);
        return [id, s] as const;
      })
    )
  );

  const summary: AccountSummary[] = allAccounts.map(account => {
    const scoreRow = todayScores.get(account.hubspotId) ?? fallbackScores.get(account.hubspotId) ?? null;
    return {
      ...account,
      score: scoreRow?.score ?? null,
      tier: scoreRow?.tier ?? null,
      scoreDelta: scoreRow?.scoreDelta ?? null,
      amplitudeAlias: mappingLookup.get(account.hubspotId) ?? null,
    };
  });

  return {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(summary),
  };
}

// GET /api/accounts/:id
// Returns a single account with score breakdown and 7-day history.
async function getAccount(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  const hubspotId = req.params.id;
  const { accounts, scores, mappings } = makeStores();

  const [account, mapping] = await Promise.all([
    accounts.getById(hubspotId),
    mappings.getMapping(hubspotId),
  ]);

  if (!account) {
    return { status: 404, headers: CORS_HEADERS, body: 'Account not found.' };
  }

  const [latestScore, history] = await Promise.all([
    scores.getLatestScoreForAccount(hubspotId),
    scores.getScoreHistory(hubspotId, 7),
  ]);

  return {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...account,
      score: latestScore?.score ?? null,
      tier: latestScore?.tier ?? null,
      scoreDelta: latestScore?.scoreDelta ?? null,
      amplitudeAlias: mapping?.amplitudeAlias ?? null,
      scoreBreakdown: latestScore
        ? {
            dauWauTrend: latestScore.dauWauTrend,
            featureAdoption: latestScore.featureAdoption,
            lastLoginDays: latestScore.lastLoginDays,
          }
        : null,
      scoreHistory: history,
    }),
  };
}

app.http('ListAccounts', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'function',
  route: 'accounts',
  handler: listAccounts,
});

app.http('GetAccount', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'function',
  route: 'accounts/{id}',
  handler: getAccount,
});
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm run build 2>&1 | grep -E "error TS|Error"
```

Expected: no errors (or only errors in `ImportAccounts.ts` which will be deleted next).

---

### Task 7: Add `MappingApi.ts`

**Files:**
- Create: `backend/src/functions/MappingApi.ts`

- [ ] **Step 1: Create `backend/src/functions/MappingApi.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod';
import { getConfig } from '../config';
import { MappingStore } from '../services/mappingStore';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UpsertMappingSchema = z.object({
  hubspotId: z.string().min(1),
  hubspotName: z.string().min(1),
  amplitudeAlias: z.string().min(1),
});

function makeStore() {
  const config = getConfig();
  return new MappingStore(config.storageConnectionString, config.tableMapping);
}

// GET /api/mapping
async function listMappings(
  req: HttpRequest,
  _context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  const store = makeStore();
  await store.ensureTable();
  const mappings = await store.listMappings();

  return {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(mappings),
  };
}

// POST /api/mapping — create or update a mapping
async function upsertMapping(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { status: 400, headers: CORS_HEADERS, body: 'Invalid JSON body.' };
  }

  const parsed = UpsertMappingSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ errors: parsed.error.issues }),
    };
  }

  const store = makeStore();
  await store.ensureTable();
  try {
    await store.upsertMapping(parsed.data.hubspotId, parsed.data.hubspotName, parsed.data.amplitudeAlias);
  } catch (err: any) {
    context.error('upsertMapping failed:', err);
    return { status: 500, headers: CORS_HEADERS, body: `Storage error: ${err.message}` };
  }

  return { status: 200, headers: CORS_HEADERS };
}

// DELETE /api/mapping/:id
async function deleteMapping(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  const hubspotId = req.params.id;
  const store = makeStore();
  await store.ensureTable();

  try {
    await store.deleteMapping(hubspotId);
  } catch (err: any) {
    if (err?.statusCode === 404) {
      return { status: 404, headers: CORS_HEADERS, body: 'Mapping not found.' };
    }
    context.error('deleteMapping failed:', err);
    return { status: 500, headers: CORS_HEADERS, body: `Storage error: ${err.message}` };
  }

  return { status: 204, headers: CORS_HEADERS };
}

app.http('ListMappings', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'function',
  route: 'mapping',
  handler: listMappings,
});

app.http('UpsertMapping', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'function',
  route: 'mapping',
  handler: upsertMapping,
});

app.http('DeleteMapping', {
  methods: ['DELETE', 'OPTIONS'],
  authLevel: 'function',
  route: 'mapping/{id}',
  handler: deleteMapping,
});
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm run build 2>&1 | grep -E "error TS|Error"
```

Expected: no errors in `MappingApi.ts`.

---

### Task 8: Add `SyncTrigger.ts`

**Files:**
- Create: `backend/src/functions/SyncTrigger.ts`

- [ ] **Step 1: Create `backend/src/functions/SyncTrigger.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getConfig } from '../config';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// POST /api/sync — triggers the n8n sync workflow via its webhook URL.
// Returns immediately; sync runs asynchronously in n8n.
async function triggerSync(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  const config = getConfig();

  try {
    const response = await fetch(config.n8nSyncWebhookUrl, { method: 'POST' });
    if (!response.ok) {
      context.error(`n8n webhook returned ${response.status}`);
      return {
        status: 502,
        headers: CORS_HEADERS,
        body: `Failed to trigger sync: n8n returned ${response.status}`,
      };
    }
  } catch (err: any) {
    context.error('Failed to call n8n webhook:', err);
    return {
      status: 502,
      headers: CORS_HEADERS,
      body: `Failed to trigger sync: ${err.message}`,
    };
  }

  return {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'triggered' }),
  };
}

app.http('TriggerSync', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'function',
  route: 'sync',
  handler: triggerSync,
});
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm run build 2>&1 | grep -E "error TS|Error"
```

Expected: no errors in `SyncTrigger.ts`.

---

### Task 9: Update `index.ts` and delete old files

**Files:**
- Rewrite: `backend/src/index.ts`
- Delete: `backend/src/functions/ImportAccounts.ts`

- [ ] **Step 1: Rewrite `backend/src/index.ts`**

```typescript
import './functions/AccountsApi';
import './functions/MappingApi';
import './functions/SyncTrigger';
```

- [ ] **Step 2: Delete `ImportAccounts.ts`**

```bash
rm "d:/Logic Software/AI/cs-copilot/backend/src/functions/ImportAccounts.ts"
```

- [ ] **Step 3: Build — verify no errors**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm run build 2>&1 | grep -E "error TS|Error"
```

Expected: clean build with no errors.

- [ ] **Step 4: Run all tests**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm test --verbose 2>&1 | tail -20
```

Expected: all 13 tests passing.

- [ ] **Step 5: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/
git commit -m "feat(cs-copilot): rewrite backend API — read-only accounts, mapping CRUD, sync trigger"
```

---

## Chunk 3: n8n Workflow

> **Note:** This chunk has no code tests. Verification is by running the workflow manually and inspecting Azure Table Storage.

### Task 10: n8n Cloud Setup

- [ ] **Step 1: Create n8n Cloud account**

Go to https://n8n.io/cloud — start a free trial or Starter plan (~$24/month).

- [ ] **Step 2: Add HubSpot credential**

In n8n → Credentials → New → HubSpot:
- Use **Private App** access token from HubSpot Settings → Integrations → Private Apps
- Required scopes: `crm.objects.companies.read`, `crm.objects.owners.read`

- [ ] **Step 3: Add Azure Table Storage credential**

In n8n → Credentials → New → Azure Storage:
- Paste the connection string from `local.settings.json` (or Azure portal)

- [ ] **Step 4: Add Anthropic credential**

In n8n → Credentials → New → Anthropic:
- Paste your Anthropic API key
- Model used in AI Agent node: `claude-haiku-4-5-20251001`

- [ ] **Step 5: Add Amplitude MCP credential**

In n8n → Credentials → New → MCP Client (HTTP):
- URL: `https://mcp.amplitude.com/mcp`
- Auth: OAuth 2.0 — complete the OAuth flow by clicking "Connect to Amplitude"

---

### Task 11: Build Sync Workflow

Create a new workflow named **"CS Copilot — Nightly Sync"**.

- [ ] **Step 1: Add Schedule trigger**

- Node type: **Schedule Trigger**
- Rule: Every day at 2:00 AM (UTC or your preferred timezone)

- [ ] **Step 2: Add Webhook trigger (manual sync)**

- Node type: **Webhook**
- HTTP Method: POST
- Path: `/sync`
- Authentication: None (the Azure Function already gate-keeps this via its auth key)
- Connect this trigger's output directly to the same first downstream node as the Schedule trigger

> **Important:** Do NOT use a Merge node between the two triggers. In n8n, multiple trigger nodes can connect to the same downstream node directly. A Merge node in Combine mode would incorrectly wait for both triggers to fire simultaneously before proceeding.

- [ ] **Step 3: Fetch active HubSpot companies**

- Node type: **HubSpot**
- Resource: Companies
- Operation: Search
- Filter: `active = Yes` (custom property filter)
- Properties to return: `hs_object_id`, `name`, `hubspot_owner_id`, `arr__annual_recurring_revenue_` (or your ARR field name), `renewal_date`, `hs_object_url`
- Set "Return All" to true

- [ ] **Step 4: Resolve owner names**

- Node type: **HubSpot**
- Resource: Owners
- Operation: Get
- Owner ID: `{{ $json.properties.hubspot_owner_id }}`
- Connect: after Companies Search node

- [ ] **Step 5: Upsert companies to Azure Table Storage**

- Node type: **Azure Table Storage** (HTTP Request node if no native node — see note below)
- Table: `accounts`
- Operation: Upsert Entity
- PartitionKey: `accounts`
- RowKey: `{{ $json.properties.hs_object_id }}`
- Fields: map all company + owner properties to the `accounts` schema from the spec

> **Note:** If n8n does not have a native Azure Table Storage node, use an **HTTP Request** node with the Azure Table Storage REST API:
> - URL: `https://<account>.table.core.windows.net/accounts(PartitionKey='accounts',RowKey='{{ $json.hs_object_id }}')`
> - Method: PUT (upsert = merge)
> - Auth: use SAS token query param

- [ ] **Step 6: Load Amplitude mapping table**

- Node type: **Azure Table Storage** (or HTTP Request)
- Table: `amplitudemapping`
- Operation: List Entities
- Filter: `PartitionKey eq 'mapping'`

- [ ] **Step 7: Fetch yesterday's scores for delta calculation**

- Node type: **Azure Table Storage** (or HTTP Request)
- Table: `churnscores`
- Operation: List Entities
- Filter: `RowKey eq '<yesterday's date>'` — use expression: `{{ new Date(Date.now() - 86400000).toISOString().slice(0, 10) }}`
- After this node, add a **Code** node. **Name this node exactly `Yesterday Scores Lookup`** (the scoring Code node in Step 11 references it by this name). Code:

```javascript
const lookup = {};
for (const item of $input.all()) {
  lookup[item.json.PartitionKey] = item.json.score ?? null;
}
return [{ json: lookup }];
```

- [ ] **Step 8: Add Split In Batches node**

- Node type: **Split In Batches** (Loop)
- Batch Size: 1 (process one account at a time)
- Input: the company list from Step 3

- [ ] **Step 9: Add AI Agent node (Amplitude MCP)**

Inside the loop:

- Node type: **AI Agent**
- Model: Anthropic (claude-haiku-4-5-20251001)
- Tools: MCP Client → Amplitude credential
- System prompt:
  ```
  You are a data extraction assistant. Given an Amplitude account alias, fetch usage metrics and return ONLY a JSON object with these exact fields:
  {
    "dauWauTrend": <fractional change in DAU/WAU over last 28 days, e.g. -0.15 for -15%>,
    "featuresUsed": <integer: distinct features used in last 30 days>,
    "featuresTotal": <integer: total available/licensed features>,
    "lastLoginDays": <integer: days since most recent active user login>
  }
  If you cannot determine a value, use null. Return ONLY the JSON object, no explanation.
  ```
- User prompt: `Fetch metrics for Amplitude account alias: {{ $json.amplitudeAlias }}`
- Add an **If** node before this: check if `amplitudeAlias` is not empty. If empty, route to the "unmapped" branch.

- [ ] **Step 10: Add error handling on AI Agent**

- In the AI Agent node settings, enable "Continue on Fail"
- Add a **Code** node on the error output: set `score = null`, `tier = 'unmapped'`

- [ ] **Step 11: Add scoring Code node**

- Node type: **Code**
- Language: JavaScript
- Code:

```javascript
const signals = JSON.parse($input.first().json.output || '{}');

const dauWauTrend = signals.dauWauTrend ?? null;
const featuresUsed = signals.featuresUsed ?? null;
const featuresTotal = signals.featuresTotal ?? null;
const lastLoginDays = signals.lastLoginDays ?? null;

// DAU/WAU trend: 0–40 pts
let dauScore = 0;
if (dauWauTrend !== null) {
  if (dauWauTrend >= 0.10) dauScore = 40;
  else if (dauWauTrend > -0.10) dauScore = 25;
  else if (dauWauTrend >= -0.30) dauScore = 10;
  else dauScore = 0;
}

// Feature adoption: 0–35 pts (linear)
let featureScore = 0;
if (featuresUsed !== null && featuresTotal !== null && featuresTotal > 0) {
  featureScore = Math.round((featuresUsed / featuresTotal) * 35);
}

// Last login: 0–25 pts
let loginScore = 0;
if (lastLoginDays !== null) {
  if (lastLoginDays < 7) loginScore = 25;
  else if (lastLoginDays < 14) loginScore = 16;
  else if (lastLoginDays <= 30) loginScore = 8;
  else loginScore = 0;
}

// If all signals are null (MCP responded but returned no data), treat as unmapped
const allNull = dauWauTrend === null && featuresUsed === null && lastLoginDays === null;
const score = allNull ? null : dauScore + featureScore + loginScore;
const tier = score === null ? 'unmapped'
  : score >= 80 ? 'healthy'
  : score >= 60 ? 'watch'
  : score >= 40 ? 'at-risk'
  : 'critical';

const hubspotId = $('Split In Batches').first().json.properties.hs_object_id;
const previousScore = $('Yesterday Scores Lookup').first().json[hubspotId] ?? null;
const today = new Date().toISOString().slice(0, 10);

return [{
  json: {
    partitionKey: hubspotId,
    rowKey: today,
    score,
    tier,
    dauWauTrend: dauWauTrend,
    featureAdoption: (featuresUsed !== null && featuresTotal !== null && featuresTotal > 0)
      ? featuresUsed / featuresTotal
      : null,
    lastLoginDays,
    scoreDelta: (score !== null && previousScore !== null) ? score - previousScore : null,
    computedAt: new Date().toISOString(),
  }
}];
```

- [ ] **Step 12: Write score to Azure Table Storage**

- Node type: **Azure Table Storage** (or HTTP Request)
- Table: `churnscores`
- Operation: Upsert Entity
- PartitionKey: `{{ $json.partitionKey }}`
- RowKey: `{{ $json.rowKey }}`
- Map all remaining fields

- [ ] **Step 13: Copy the webhook URL**

In the Webhook trigger node → copy the Production webhook URL. This goes into `N8N_SYNC_WEBHOOK_URL` in `local.settings.json` and Azure Function App Settings.

- [ ] **Step 14: Activate the workflow**

Toggle the workflow to **Active**. The schedule trigger will now run nightly. The webhook URL is live.

- [ ] **Step 15: Run manual test**

Click **Test Workflow** (or send a POST to the webhook URL). Then check Azure Table Storage:
- `accounts` table should have rows with HubSpot IDs as RowKeys
- `churnscores` table should have rows with today's date as RowKey

```bash
# Quick check via Azure CLI (if available):
az storage entity query --account-name <name> --table-name accounts --filter "PartitionKey eq 'accounts'" --auth-mode login
```

---

## Chunk 4: Frontend

### Task 12: Add routing, update types and API service

**Files:**
- Modify: `frontend/package.json` (add react-router-dom)
- Rewrite: `frontend/src/types.ts`
- Rewrite: `frontend/src/services/api.ts`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Install react-router-dom**

```bash
cd "d:/Logic Software/AI/cs-copilot/frontend"
npm install react-router-dom
```

- [ ] **Step 2: Rewrite `frontend/src/types.ts`**

```typescript
export interface HubspotAccount {
  hubspotId: string;
  accountName: string;
  csmName: string;
  csmEmail: string;
  arr: number;
  renewalDate: string;
  hubspotUrl: string;
  syncedAt: string;
}

export interface AccountSummary extends HubspotAccount {
  score: number | null;
  tier: HealthTier | 'unmapped' | null;
  scoreDelta: number | null;
  amplitudeAlias: string | null;
}

export interface AmplitudeMapping {
  hubspotId: string;
  hubspotName: string;
  amplitudeAlias: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChurnScore {
  hubspotId: string;
  date: string;
  score: number | null;
  tier: HealthTier | 'unmapped';
  dauWauTrend: number | null;
  featureAdoption: number | null;
  lastLoginDays: number | null;
  scoreDelta: number | null;
  computedAt: string;
}

export type HealthTier = 'healthy' | 'watch' | 'at-risk' | 'critical';
```

- [ ] **Step 3: Rewrite `frontend/src/services/api.ts`**

```typescript
import { AccountSummary } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';
const API_KEY = import.meta.env.VITE_API_KEY ?? '';

function withCode(url: string): string {
  return API_KEY ? `${url}?code=${encodeURIComponent(API_KEY)}` : url;
}

export async function getAccounts(): Promise<AccountSummary[]> {
  const res = await fetch(withCode(`${BASE_URL}/accounts`));
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`);
  return res.json();
}

export async function getAccount(hubspotId: string): Promise<AccountSummary> {
  const res = await fetch(withCode(`${BASE_URL}/accounts/${encodeURIComponent(hubspotId)}`));
  if (!res.ok) throw new Error(`Failed to fetch account: ${res.status}`);
  return res.json();
}

export async function upsertMapping(hubspotId: string, hubspotName: string, amplitudeAlias: string): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/mapping`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hubspotId, hubspotName, amplitudeAlias }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Save failed: ${res.status}`);
  }
}

export async function deleteMapping(hubspotId: string): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/mapping/${encodeURIComponent(hubspotId)}`), {
    method: 'DELETE',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Delete failed: ${res.status}`);
  }
}

export async function triggerSync(): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/sync`), { method: 'POST' });
  if (!res.ok) throw new Error(`Sync trigger failed: ${res.status}`);
}
```

- [ ] **Step 4: Update `frontend/src/main.tsx`** — wrap app in BrowserRouter

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
```

- [ ] **Step 5: Build to check for TypeScript errors**

```bash
cd "d:/Logic Software/AI/cs-copilot/frontend"
npm run build 2>&1 | grep -E "error TS|Error" | head -20
```

Expected: TypeScript errors in `Portfolio.tsx` (still uses old types) — expected, fixed next.

---

### Task 13: Rewrite `Portfolio.tsx`

**Files:**
- Rewrite: `frontend/src/pages/Portfolio.tsx`
- Delete: `frontend/src/components/CsvImportModal.tsx`

- [ ] **Step 1: Delete `CsvImportModal.tsx`**

```bash
rm "d:/Logic Software/AI/cs-copilot/frontend/src/components/CsvImportModal.tsx"
```

- [ ] **Step 2: Rewrite `frontend/src/pages/Portfolio.tsx`**

```typescript
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getAccounts, triggerSync } from '../services/api';
import { AccountSummary, HealthTier } from '../types';

const TIER_STYLES: Record<HealthTier | 'unmapped', string> = {
  healthy: 'bg-green-100 text-green-800',
  watch: 'bg-yellow-100 text-yellow-800',
  'at-risk': 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
  unmapped: 'bg-gray-100 text-gray-500',
};

const TIER_LABELS: Record<HealthTier | 'unmapped', string> = {
  healthy: '✅ Healthy',
  watch: '🟡 Watch',
  'at-risk': '🟠 At Risk',
  critical: '🔴 Critical',
  unmapped: '⚠ Unmapped',
};

function formatArr(arr: number): string {
  if (arr == null) return '—';
  return `$${(arr / 1000).toFixed(0)}k`;
}

function renewalBadge(date: string): string {
  if (!date) return '—';
  const days = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'Expired';
  if (days <= 30) return `${days}d ⚠`;
  return `${days}d`;
}

function lastSyncedLabel(accounts: AccountSummary[]): string {
  const syncedAt = accounts.map(a => a.syncedAt).filter(Boolean).sort().reverse()[0];
  if (!syncedAt) return 'Never synced';
  const mins = Math.round((Date.now() - new Date(syncedAt).getTime()) / 60_000);
  if (mins < 60) return `Last synced ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Last synced ${hours}h ago`;
  return `Last synced ${Math.round(hours / 24)}d ago`;
}

export default function Portfolio() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await getAccounts());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load accounts';
      if (msg.includes('404') || msg.includes('Failed to fetch')) {
        setAccounts([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  async function handleSync() {
    setSyncing(true);
    try {
      await triggerSync();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const unmappedCount = accounts.filter(a => !a.amplitudeAlias).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">CS Copilot</h1>
        <nav className="flex items-center gap-4">
          <Link to="/mapping" className="text-sm text-blue-600 hover:text-blue-800">
            Amplitude Mapping
            {unmappedCount > 0 && (
              <span className="ml-1.5 bg-yellow-100 text-yellow-800 text-xs font-medium px-1.5 py-0.5 rounded-full">
                {unmappedCount} unmapped
              </span>
            )}
          </Link>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {syncing ? 'Syncing…' : '↻ Sync Now'}
          </button>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-800">
            My Accounts{accounts.length > 0 ? ` (${accounts.length})` : ''}
          </h2>
          {accounts.length > 0 && (
            <span className="text-xs text-gray-400">{lastSyncedLabel(accounts)}</span>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-3 text-gray-400 py-16 justify-center">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading accounts…
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && accounts.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-4">📋</p>
            <p className="text-lg font-medium text-gray-600 mb-1">No accounts yet</p>
            <p className="text-sm mb-6">Run a sync to pull active clients from HubSpot.</p>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {syncing ? 'Syncing…' : '↻ Sync Now'}
            </button>
          </div>
        )}

        {!loading && !error && accounts.length > 0 && (
          <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">CSM</th>
                  <th className="px-4 py-3">Health</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">ARR</th>
                  <th className="px-4 py-3">Renewal</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {accounts.map(account => {
                  const tier = account.tier ?? null;
                  const isUnmapped = !account.amplitudeAlias;
                  return (
                    <tr
                      key={account.hubspotId}
                      className={`hover:bg-gray-50 transition-colors ${isUnmapped ? 'border-l-2 border-l-yellow-400' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {account.accountName}
                        {isUnmapped && (
                          <Link to="/mapping" className="ml-2 text-xs text-yellow-600 hover:text-yellow-800">
                            ⚠ Map Amplitude
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{account.csmName}</td>
                      <td className="px-4 py-3">
                        {tier ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TIER_STYLES[tier]}`}>
                            {TIER_LABELS[tier]}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">Pending</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {account.score !== null ? (
                          <span>
                            {account.score}
                            {account.scoreDelta !== null && account.scoreDelta !== 0 && (
                              <span className={`ml-1 text-xs ${account.scoreDelta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {account.scoreDelta > 0 ? `↗ +${account.scoreDelta}` : `↘ ${account.scoreDelta}`}
                              </span>
                            )}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatArr(account.arr)}</td>
                      <td className="px-4 py-3 text-gray-600">{renewalBadge(account.renewalDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
```

---

### Task 14: Add `Mapping.tsx`

**Files:**
- Create: `frontend/src/pages/Mapping.tsx`

- [ ] **Step 1: Create `frontend/src/pages/Mapping.tsx`**

```typescript
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getAccounts, upsertMapping, deleteMapping } from '../services/api';
import { AccountSummary } from '../types';

interface RowState {
  editing: boolean;
  inputValue: string;
  saving: boolean;
  error: string | null;
}

export default function Mapping() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await getAccounts());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  function startEdit(hubspotId: string, currentAlias: string | null) {
    setRowStates(prev => ({
      ...prev,
      [hubspotId]: { editing: true, inputValue: currentAlias ?? '', saving: false, error: null },
    }));
  }

  function cancelEdit(hubspotId: string) {
    setRowStates(prev => {
      const next = { ...prev };
      delete next[hubspotId];
      return next;
    });
  }

  async function saveEdit(account: AccountSummary) {
    const state = rowStates[account.hubspotId];
    if (!state) return;
    const alias = state.inputValue.trim();
    if (!alias) return;

    setRowStates(prev => ({
      ...prev,
      [account.hubspotId]: { ...state, saving: true, error: null },
    }));

    try {
      await upsertMapping(account.hubspotId, account.accountName, alias);
      // Update local state immediately
      setAccounts(prev =>
        prev.map(a => a.hubspotId === account.hubspotId ? { ...a, amplitudeAlias: alias } : a)
      );
      cancelEdit(account.hubspotId);
    } catch (err: unknown) {
      setRowStates(prev => ({
        ...prev,
        [account.hubspotId]: {
          ...state,
          saving: false,
          error: err instanceof Error ? err.message : 'Save failed — try again',
        },
      }));
    }
  }

  async function handleDelete(account: AccountSummary) {
    try {
      await deleteMapping(account.hubspotId);
      setAccounts(prev =>
        prev.map(a => a.hubspotId === account.hubspotId ? { ...a, amplitudeAlias: null } : a)
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, account: AccountSummary) {
    if (e.key === 'Enter') saveEdit(account);
    if (e.key === 'Escape') cancelEdit(account.hubspotId);
  }

  const INPUT_CLS = 'border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-56';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">← Portfolio</Link>
          <h1 className="text-xl font-bold text-gray-900">Amplitude Mapping</h1>
        </div>
        <button
          disabled
          title="Coming soon"
          className="px-4 py-2 bg-gray-100 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed"
        >
          ↑ Import CSV
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-sm text-gray-500 mb-6">
          Match each HubSpot account to its Amplitude account alias. Unmapped accounts cannot be scored.
        </p>

        {loading && (
          <div className="flex items-center gap-3 text-gray-400 py-16 justify-center">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading…
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        {!loading && !error && accounts.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-4">🔗</p>
            <p className="text-lg font-medium text-gray-600 mb-1">No accounts yet</p>
            <p className="text-sm">
              <Link to="/" className="text-blue-600 hover:text-blue-800">Run a sync</Link> to pull accounts from HubSpot first.
            </p>
          </div>
        )}

        {!loading && !error && accounts.length > 0 && (
          <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">HubSpot Account</th>
                  <th className="px-4 py-3">Amplitude Alias</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {accounts.map(account => {
                  const state = rowStates[account.hubspotId];
                  const isUnmapped = !account.amplitudeAlias;

                  return (
                    <tr
                      key={account.hubspotId}
                      className={`${isUnmapped ? 'border-l-2 border-l-yellow-400 bg-yellow-50' : 'hover:bg-gray-50'} transition-colors`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{account.accountName}</td>
                      <td className="px-4 py-3">
                        {state?.editing ? (
                          <div>
                            <input
                              autoFocus
                              className={INPUT_CLS}
                              value={state.inputValue}
                              onChange={e => setRowStates(prev => ({
                                ...prev,
                                [account.hubspotId]: { ...prev[account.hubspotId], inputValue: e.target.value },
                              }))}
                              onKeyDown={e => handleKeyDown(e, account)}
                              disabled={state.saving}
                              placeholder="e.g. acme-corp-prod"
                            />
                            {state.error && (
                              <p className="text-xs text-red-600 mt-1">{state.error}</p>
                            )}
                          </div>
                        ) : (
                          <span
                            className={isUnmapped ? 'text-gray-400 italic' : 'text-gray-700'}
                            onClick={() => startEdit(account.hubspotId, account.amplitudeAlias)}
                            role="button"
                            title="Click to edit"
                          >
                            {account.amplitudeAlias ?? 'Not mapped'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {state?.editing ? (
                          <div className="flex gap-3">
                            <button
                              onClick={() => saveEdit(account)}
                              disabled={state.saving || !state.inputValue.trim()}
                              className="text-green-600 hover:text-green-800 disabled:opacity-40 font-bold"
                            >
                              {state.saving ? '…' : '✓'}
                            </button>
                            <button
                              onClick={() => cancelEdit(account.hubspotId)}
                              disabled={state.saving}
                              className="text-gray-400 hover:text-gray-600 font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-3">
                            <button
                              onClick={() => startEdit(account.hubspotId, account.amplitudeAlias)}
                              className="text-gray-400 hover:text-blue-600 transition-colors"
                              title="Edit alias"
                            >
                              ✏
                            </button>
                            {account.amplitudeAlias && (
                              <button
                                onClick={() => handleDelete(account)}
                                className="text-gray-400 hover:text-red-600 transition-colors"
                                title="Remove mapping"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
```

---

### Task 15: Update `App.tsx`

**Files:**
- Rewrite: `frontend/src/App.tsx`

- [ ] **Step 1: Rewrite `frontend/src/App.tsx`**

```typescript
import { Routes, Route } from 'react-router-dom';
import Portfolio from './pages/Portfolio';
import Mapping from './pages/Mapping';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Portfolio />} />
      <Route path="/mapping" element={<Mapping />} />
    </Routes>
  );
}
```

- [ ] **Step 2: Add `staticwebapp.config.json`** — required for SPA routing on Azure Static Web Apps so that hard refreshes on `/mapping` don't 404

Create `frontend/staticwebapp.config.json`:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/api/*", "*.{css,js,png,ico,svg}"]
  }
}
```

- [ ] **Step 3: Build the frontend — verify clean**

```bash
cd "d:/Logic Software/AI/cs-copilot/frontend"
npm run build 2>&1 | grep -E "error|Error" | grep -v "node_modules"
```

Expected: clean build with no errors.

- [ ] **Step 4: Smoke-test locally**

```bash
# Terminal 1 — start backend (requires Azurite for local storage)
cd "d:/Logic Software/AI/cs-copilot/backend"
npm start

# Terminal 2 — start frontend
cd "d:/Logic Software/AI/cs-copilot/frontend"
npm run dev
```

Open http://localhost:5173. Verify:
- Portfolio page loads (shows empty state or accounts if n8n has run)
- "Amplitude Mapping" nav link is visible
- Clicking the link navigates to `/mapping`
- Mapping page shows account rows (or empty state if no accounts synced yet)
- Clicking an alias field opens an input; pressing Escape cancels, Enter saves
- Navigating directly to http://localhost:5173/mapping does not show a 404

- [ ] **Step 5: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/frontend/
git commit -m "feat(cs-copilot): add Mapping page, routing, and updated Portfolio for MVP"
```

---

## Post-Build: Update README and progress.md

- [ ] **Update `cs-copilot/README.md`** — document new architecture, n8n workflow, env vars

- [ ] **Update `cs-copilot/progress.md`** — mark n8n build plan steps as complete

- [ ] **Final commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/README.md cs-copilot/progress.md
git commit -m "docs(cs-copilot): update README and progress for MVP"
```
