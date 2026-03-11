# CS Copilot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CS Copilot that lets CSMs ask natural language questions about their accounts and receive proactive daily churn alerts, available via Web UI and Slack.

**Architecture:** Claude-as-brain with tool calls — each question is routed to Claude (Sonnet/Haiku) which decides which data connectors to call (HubSpot, Zendesk, Intercom, Amplitude MCP), assembles a summary, and returns an answer. A daily Azure Timer Function computes churn scores from Amplitude (primary), Zendesk/Intercom (secondary), and HubSpot (context), then DMs at-risk accounts to each CSM via Slack.

**Tech Stack:** Azure Functions v4 (Node.js 20, TypeScript), `@anthropic-ai/sdk`, `@slack/bolt`, `bolt-azure-functions-receiver`, Axios, Zod, Jest + ts-jest, React + Vite + TypeScript + Tailwind CSS, Azure Static Web Apps, Azure Table Storage, Azure AI Search.

**Design doc:** `docs/plans/2026-02-24-cs-copilot-design.md`

---

## Phase 1: Project Scaffolding

### Task 1: Scaffold the backend Azure Functions project

**Files:**
- Create: `cs-copilot/backend/package.json`
- Create: `cs-copilot/backend/tsconfig.json`
- Create: `cs-copilot/backend/host.json`
- Create: `cs-copilot/backend/local.settings.json`
- Create: `cs-copilot/backend/jest.config.js`
- Create: `cs-copilot/backend/src/types.ts`

**Step 1: Create backend directory and package.json**

```bash
mkdir -p "d:/Logic Software/AI/cs-copilot/backend/src/functions"
mkdir -p "d:/Logic Software/AI/cs-copilot/backend/src/tools"
mkdir -p "d:/Logic Software/AI/cs-copilot/backend/src/services"
mkdir -p "d:/Logic Software/AI/cs-copilot/backend/src/__tests__"
cd "d:/Logic Software/AI/cs-copilot/backend"
```

Create `cs-copilot/backend/package.json`:
```json
{
  "name": "cs-copilot-backend",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "start": "func start",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.61.0",
    "@azure/data-tables": "^13.3.0",
    "@azure/functions": "^4.5.0",
    "@azure/search-documents": "^12.1.0",
    "@slack/bolt": "^4.4.0",
    "axios": "^1.9.0",
    "bolt-azure-functions-receiver": "^2.0.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.3.0",
    "typescript": "^5.8.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "moduleResolution": "node",
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/__tests__/**"]
}
```

**Step 3: Create host.json**

```json
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "excludedTypes": "Request"
      }
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

**Step 4: Create local.settings.json** (never commit this)

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "ANTHROPIC_API_KEY": "",
    "HUBSPOT_ACCESS_TOKEN": "",
    "ZENDESK_SUBDOMAIN": "",
    "ZENDESK_EMAIL": "",
    "ZENDESK_TOKEN": "",
    "INTERCOM_TOKEN": "",
    "AMPLITUDE_API_KEY": "",
    "AMPLITUDE_SECRET_KEY": "",
    "SLACK_BOT_TOKEN": "",
    "SLACK_SIGNING_SECRET": "",
    "AZURE_SEARCH_ENDPOINT": "",
    "AZURE_SEARCH_API_KEY": "",
    "AZURE_STORAGE_CONNECTION_STRING": "UseDevelopmentStorage=true"
  }
}
```

**Step 5: Create jest.config.js**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**']
};
```

**Step 6: Create src/types.ts**

```typescript
export interface AccountSummary {
  id: string;
  name: string;
  csm: string;
  arr: number;
  renewalDate: string;
  healthScore: number;
  healthTier: 'healthy' | 'watch' | 'at-risk' | 'critical';
  scoreDelta: number; // vs yesterday
  usage: UsageSummary;
  support: SupportSummary;
  crm: CrmSummary;
}

export interface UsageSummary {
  dauTrend28d: number; // percentage change
  featuresAdopted: number;
  featuresTotal: number;
  lastLoginDaysAgo: number;
}

export interface SupportSummary {
  openTickets: number;
  criticalTickets: number;
  avgResolutionDays: number;
  csat90d: number | null;
  oldestOpenDays: number;
}

export interface CrmSummary {
  arr: number;
  renewalDate: string;
  renewalDaysAway: number;
  lastCsmContactDaysAgo: number;
  owner: string;
  tier: string;
}

export interface ChurnScore {
  accountId: string;
  score: number;
  tier: 'healthy' | 'watch' | 'at-risk' | 'critical';
  computedAt: string;
  breakdown: {
    amplitude: number;
    support: number;
    crm: number;
  };
}

export interface ToolResult {
  tool: string;
  data: Record<string, unknown>;
  error?: string;
}
```

**Step 7: Install dependencies**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm install
```

Expected: `node_modules` created, no errors.

**Step 8: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/
git commit -m "feat: scaffold cs-copilot backend Azure Functions project"
```

---

### Task 2: Scaffold the frontend React/Vite project

**Files:**
- Create: `cs-copilot/frontend/` (Vite scaffold)

**Step 1: Create the Vite project**

```bash
cd "d:/Logic Software/AI/cs-copilot"
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**Step 2: Configure Tailwind — edit `cs-copilot/frontend/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

**Step 3: Replace `cs-copilot/frontend/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 4: Create directory structure**

```bash
mkdir -p "d:/Logic Software/AI/cs-copilot/frontend/src/pages"
mkdir -p "d:/Logic Software/AI/cs-copilot/frontend/src/components"
mkdir -p "d:/Logic Software/AI/cs-copilot/frontend/src/services"
```

**Step 5: Create `cs-copilot/frontend/src/services/api.ts`** (stub — flesh out in Phase 3)

```typescript
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:7071/api';

export async function getAccounts() {
  const res = await fetch(`${BASE_URL}/accounts`);
  if (!res.ok) throw new Error('Failed to fetch accounts');
  return res.json();
}

export async function getAccount(id: string) {
  const res = await fetch(`${BASE_URL}/accounts/${id}`);
  if (!res.ok) throw new Error('Failed to fetch account');
  return res.json();
}

export async function askAccount(accountId: string, question: string, history: { role: string; content: string }[]) {
  const res = await fetch(`${BASE_URL}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, question, history }),
  });
  if (!res.ok) throw new Error('Failed to ask');
  return res.json();
}
```

**Step 6: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/frontend/
git commit -m "feat: scaffold cs-copilot frontend React/Vite/Tailwind project"
```

---

## Phase 2: Data Connectors (Tools)

### Task 3: HubSpot connector

**Files:**
- Create: `cs-copilot/backend/src/tools/hubspot.ts`
- Create: `cs-copilot/backend/src/__tests__/tools/hubspot.test.ts`

**Step 1: Write the failing test**

Create `cs-copilot/backend/src/__tests__/tools/hubspot.test.ts`:
```typescript
import axios from 'axios';
import { getHubspotAccount } from '../../tools/hubspot';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('getHubspotAccount', () => {
  it('returns a CrmSummary for a valid company', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        id: 'company-123',
        properties: {
          name: 'Acme Corp',
          amount: '48000',
          closedate: '2026-03-18T00:00:00.000Z',
          hubspot_owner_id: 'owner-1',
          hs_lastmodifieddate: '2026-01-24T00:00:00.000Z',
          hs_object_id: 'company-123',
        }
      }
    });
    // Mock owner lookup
    mockedAxios.get.mockResolvedValueOnce({
      data: { firstName: 'Sarah', lastName: 'Chen', email: 'sarah@example.com' }
    });

    const result = await getHubspotAccount('company-123');

    expect(result.arr).toBe(48000);
    expect(result.renewalDaysAway).toBeGreaterThan(0);
    expect(result.owner).toBe('Sarah Chen');
    expect(result.tier).toBeDefined();
  });

  it('throws if company not found', async () => {
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(getHubspotAccount('bad-id')).rejects.toThrow();
  });
});
```

**Step 2: Run test to confirm it fails**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npx jest --testPathPattern=hubspot -t "getHubspotAccount" --no-coverage
```

Expected: FAIL — "Cannot find module '../../tools/hubspot'"

**Step 3: Implement `cs-copilot/backend/src/tools/hubspot.ts`**

```typescript
import axios from 'axios';
import { CrmSummary } from '../types';

const BASE = 'https://api.hubapi.com';
const token = () => process.env.HUBSPOT_ACCESS_TOKEN!;

function daysBetween(date: string): number {
  return Math.round((new Date(date).getTime() - Date.now()) / 86400000);
}

function daysAgo(date: string): number {
  return Math.round((Date.now() - new Date(date).getTime()) / 86400000);
}

async function getOwnerName(ownerId: string): Promise<string> {
  try {
    const res = await axios.get(`${BASE}/crm/v3/owners/${ownerId}`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    const { firstName, lastName } = res.data;
    return `${firstName} ${lastName}`.trim();
  } catch {
    return 'Unknown';
  }
}

export async function getHubspotAccount(companyId: string): Promise<CrmSummary> {
  const props = 'name,amount,closedate,hubspot_owner_id,hs_lastmodifieddate,hs_object_id';
  const res = await axios.get(
    `${BASE}/crm/v3/objects/companies/${companyId}?properties=${props}`,
    { headers: { Authorization: `Bearer ${token()}` } }
  );

  const p = res.data.properties;
  const owner = p.hubspot_owner_id ? await getOwnerName(p.hubspot_owner_id) : 'Unassigned';
  const renewalDaysAway = p.closedate ? daysBetween(p.closedate) : 999;
  const lastCsmContactDaysAgo = p.hs_lastmodifieddate ? daysAgo(p.hs_lastmodifieddate) : 999;

  return {
    arr: parseFloat(p.amount ?? '0'),
    renewalDate: p.closedate ?? '',
    renewalDaysAway,
    lastCsmContactDaysAgo,
    owner,
    tier: p.hs_pipeline_stage ?? 'Unknown',
  };
}

/** Claude tool definition */
export const hubspotToolDef = {
  name: 'get_hubspot_account',
  description: 'Returns CRM context for an account: ARR, renewal date, days to renewal, last CSM contact, and account owner.',
  input_schema: {
    type: 'object' as const,
    properties: {
      company_id: { type: 'string', description: 'HubSpot company ID' }
    },
    required: ['company_id']
  }
};
```

**Step 4: Run tests**

```bash
npx jest --testPathPattern=hubspot --no-coverage
```

Expected: PASS (2 tests)

**Step 5: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/tools/hubspot.ts cs-copilot/backend/src/__tests__/tools/hubspot.test.ts
git commit -m "feat: add HubSpot connector tool"
```

---

### Task 4: Zendesk connector

**Files:**
- Create: `cs-copilot/backend/src/tools/zendesk.ts`
- Create: `cs-copilot/backend/src/__tests__/tools/zendesk.test.ts`

**Step 1: Write the failing test**

Create `cs-copilot/backend/src/__tests__/tools/zendesk.test.ts`:
```typescript
import axios from 'axios';
import { getZendeskSummary } from '../../tools/zendesk';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('getZendeskSummary', () => {
  it('returns a SupportSummary with correct aggregations', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        tickets: [
          { status: 'open', priority: 'urgent', created_at: new Date(Date.now() - 18 * 86400000).toISOString(), satisfaction_rating: { score: 'bad' } },
          { status: 'open', priority: 'normal', created_at: new Date(Date.now() - 5 * 86400000).toISOString(), satisfaction_rating: { score: 'good' } },
          { status: 'solved', priority: 'normal', created_at: new Date(Date.now() - 30 * 86400000).toISOString(), updated_at: new Date(Date.now() - 26 * 86400000).toISOString(), satisfaction_rating: { score: 'good' } },
        ],
        next_page: null
      }
    });

    const result = await getZendeskSummary('acme.zendesk.com', 'Acme Corp');

    expect(result.openTickets).toBe(2);
    expect(result.criticalTickets).toBe(1);
    expect(result.oldestOpenDays).toBe(18);
  });

  it('returns zeros when no tickets', async () => {
    mockedAxios.get.mockResolvedValue({ data: { tickets: [], next_page: null } });
    const result = await getZendeskSummary('acme.zendesk.com', 'Acme Corp');
    expect(result.openTickets).toBe(0);
    expect(result.csat90d).toBeNull();
  });
});
```

**Step 2: Run to confirm failure**

```bash
npx jest --testPathPattern=zendesk --no-coverage
```

Expected: FAIL — "Cannot find module"

**Step 3: Implement `cs-copilot/backend/src/tools/zendesk.ts`**

```typescript
import axios from 'axios';
import { SupportSummary } from '../types';

function daysAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
}

function csatToScore(score: string): number | null {
  const map: Record<string, number> = { good: 5, bad: 1, offered: 3 };
  return map[score] ?? null;
}

export async function getZendeskSummary(subdomain: string, orgName: string): Promise<SupportSummary> {
  const email = process.env.ZENDESK_EMAIL!;
  const token = process.env.ZENDESK_TOKEN!;
  const auth = Buffer.from(`${email}/token:${token}`).toString('base64');
  const base = `https://${subdomain}/api/v2`;

  // Fetch last 90 days of tickets for org
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const query = encodeURIComponent(`organization:"${orgName}" created>${since}`);
  const res = await axios.get(`${base}/search.json?query=type:ticket ${query}&per_page=100`, {
    headers: { Authorization: `Basic ${auth}` }
  });

  const tickets: any[] = res.data.tickets ?? [];
  const open = tickets.filter(t => ['open', 'pending', 'new'].includes(t.status));
  const critical = open.filter(t => ['urgent', 'high'].includes(t.priority));
  const oldestOpenDays = open.length
    ? Math.max(...open.map(t => daysAgo(t.created_at)))
    : 0;

  const csatScores = tickets
    .map(t => csatToScore(t.satisfaction_rating?.score))
    .filter((s): s is number => s !== null);
  const csat90d = csatScores.length ? csatScores.reduce((a, b) => a + b, 0) / csatScores.length : null;

  return {
    openTickets: open.length,
    criticalTickets: critical.length,
    avgResolutionDays: 0, // computed separately if needed
    csat90d,
    oldestOpenDays,
  };
}

export const zendeskToolDef = {
  name: 'get_zendesk_summary',
  description: 'Returns support health summary: open ticket count, critical ticket count, CSAT score (last 90d), and oldest open ticket age.',
  input_schema: {
    type: 'object' as const,
    properties: {
      org_name: { type: 'string', description: 'Organization name in Zendesk' }
    },
    required: ['org_name']
  }
};
```

**Step 4: Run tests**

```bash
npx jest --testPathPattern=zendesk --no-coverage
```

Expected: PASS

**Step 5: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/tools/zendesk.ts cs-copilot/backend/src/__tests__/tools/zendesk.test.ts
git commit -m "feat: add Zendesk connector tool"
```

---

### Task 5: Intercom connector

**Files:**
- Create: `cs-copilot/backend/src/tools/intercom.ts`
- Create: `cs-copilot/backend/src/__tests__/tools/intercom.test.ts`

**Step 1: Write the failing test**

Create `cs-copilot/backend/src/__tests__/tools/intercom.test.ts`:
```typescript
import axios from 'axios';
import { getIntercomSummary } from '../../tools/intercom';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('getIntercomSummary', () => {
  it('returns summary of recent conversations', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        data: [
          { state: 'open', created_at: Math.floor(Date.now() / 1000) - 86400, updated_at: Math.floor(Date.now() / 1000) - 3600 },
          { state: 'closed', created_at: Math.floor(Date.now() / 1000) - 86400 * 5, updated_at: Math.floor(Date.now() / 1000) - 86400 * 4 },
        ],
        pages: { total_count: 2 }
      }
    });

    const result = await getIntercomSummary('company-123');

    expect(result.openTickets).toBe(0); // openTickets not in Intercom
    expect(result.criticalTickets).toBe(0);
    expect(result.oldestOpenDays).toBeGreaterThanOrEqual(0);
  });
});
```

**Step 2: Run to confirm failure**

```bash
npx jest --testPathPattern=intercom --no-coverage
```

**Step 3: Implement `cs-copilot/backend/src/tools/intercom.ts`**

```typescript
import axios from 'axios';
import { SupportSummary } from '../types';

const BASE = 'https://api.intercom.io';
const token = () => process.env.INTERCOM_TOKEN!;

export async function getIntercomSummary(companyId: string): Promise<SupportSummary> {
  const since = Math.floor((Date.now() - 30 * 86400000) / 1000);
  const res = await axios.post(
    `${BASE}/conversations/search`,
    {
      query: {
        operator: 'AND',
        value: [
          { field: 'company_id', operator: '=', value: companyId },
          { field: 'created_at', operator: '>', value: since }
        ]
      },
      pagination: { per_page: 100 }
    },
    {
      headers: {
        Authorization: `Bearer ${token()}`,
        'Intercom-Version': '2.11'
      }
    }
  );

  const conversations: any[] = res.data.data ?? [];
  const open = conversations.filter(c => c.state === 'open');
  const lastContactTs = conversations.length
    ? Math.max(...conversations.map(c => c.updated_at))
    : null;
  const lastContactDaysAgo = lastContactTs
    ? Math.round((Date.now() / 1000 - lastContactTs) / 86400)
    : 999;
  const oldestOpenDays = open.length
    ? Math.max(...open.map(c => Math.round((Date.now() / 1000 - c.created_at) / 86400)))
    : 0;

  return {
    openTickets: open.length,
    criticalTickets: 0, // Intercom has no priority concept
    avgResolutionDays: 0,
    csat90d: null, // Intercom CSAT requires separate survey API
    oldestOpenDays,
  };
}

export const intercomToolDef = {
  name: 'get_intercom_summary',
  description: 'Returns Intercom conversation summary: open conversation count, last contact date.',
  input_schema: {
    type: 'object' as const,
    properties: {
      company_id: { type: 'string', description: 'Intercom company ID' }
    },
    required: ['company_id']
  }
};
```

**Step 4: Run tests**

```bash
npx jest --testPathPattern=intercom --no-coverage
```

Expected: PASS

**Step 5: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/tools/intercom.ts cs-copilot/backend/src/__tests__/tools/intercom.test.ts
git commit -m "feat: add Intercom connector tool"
```

---

## Phase 3: Claude Service + Churn Scoring

### Task 6: Claude service (wraps Anthropic SDK + tools)

**Files:**
- Create: `cs-copilot/backend/src/services/claude.ts`
- Create: `cs-copilot/backend/src/__tests__/services/claude.test.ts`

**Step 1: Write the failing test**

Create `cs-copilot/backend/src/__tests__/services/claude.test.ts`:
```typescript
import { askAboutAccount } from '../../services/claude';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Acme Corp is at risk due to declining usage.' }],
        stop_reason: 'end_turn'
      })
    }
  }))
}));

describe('askAboutAccount', () => {
  it('returns a text answer from Claude', async () => {
    const result = await askAboutAccount(
      'company-123',
      'Acme Corp',
      'What is the churn risk?',
      []
    );
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run to confirm failure**

```bash
npx jest --testPathPattern=services/claude --no-coverage
```

**Step 3: Implement `cs-copilot/backend/src/services/claude.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { hubspotToolDef } from '../tools/hubspot';
import { zendeskToolDef } from '../tools/zendesk';
import { intercomToolDef } from '../tools/intercom';
import { getHubspotAccount } from '../tools/hubspot';
import { getZendeskSummary } from '../tools/zendesk';
import { getIntercomSummary } from '../tools/intercom';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOLS = [hubspotToolDef, zendeskToolDef, intercomToolDef];

const SYSTEM_PROMPT = `You are a CS Copilot assistant. You help Customer Success Managers understand
their accounts by fetching live data from HubSpot, Zendesk, and Intercom.

When answering questions:
- Always fetch relevant data using the available tools before answering
- Be concise and action-oriented
- Highlight risks clearly
- Suggest specific next actions when appropriate
- Format numbers clearly (e.g., "$48,000 ARR", "22 days to renewal")`;

async function executeTool(toolName: string, input: Record<string, string>): Promise<string> {
  try {
    switch (toolName) {
      case 'get_hubspot_account': {
        const data = await getHubspotAccount(input.company_id);
        return JSON.stringify(data);
      }
      case 'get_zendesk_summary': {
        const subdomain = `${process.env.ZENDESK_SUBDOMAIN}.zendesk.com`;
        const data = await getZendeskSummary(subdomain, input.org_name);
        return JSON.stringify(data);
      }
      case 'get_intercom_summary': {
        const data = await getIntercomSummary(input.company_id);
        return JSON.stringify(data);
      }
      default:
        return JSON.stringify({ error: 'Unknown tool' });
    }
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

export async function askAboutAccount(
  accountId: string,
  accountName: string,
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: `[Account: ${accountName} (ID: ${accountId})]\n\n${question}` }
  ];

  let response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: TOOLS as Anthropic.Tool[],
    mcp_servers: [
      {
        type: 'url',
        url: 'https://mcp.amplitude.com/mcp',
        name: 'amplitude',
        authorization_token: process.env.AMPLITUDE_API_KEY
      }
    ],
    messages
  } as any); // mcp_servers is beta, cast needed

  // Agentic loop — handle tool calls
  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => {
        if (block.type !== 'tool_use') throw new Error('Unexpected block type');
        const result = await executeTool(block.name, block.input as Record<string, string>);
        return { type: 'tool_result' as const, tool_use_id: block.id, content: result };
      })
    );

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS as Anthropic.Tool[],
      messages
    });
  }

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock && textBlock.type === 'text' ? textBlock.text : '';
}
```

**Step 4: Run tests**

```bash
npx jest --testPathPattern=services/claude --no-coverage
```

Expected: PASS

**Step 5: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/services/claude.ts cs-copilot/backend/src/__tests__/services/claude.test.ts
git commit -m "feat: add Claude service with agentic tool loop and Amplitude MCP"
```

---

### Task 7: Churn scoring service

**Files:**
- Create: `cs-copilot/backend/src/services/churnScorer.ts`
- Create: `cs-copilot/backend/src/__tests__/services/churnScorer.test.ts`

**Step 1: Write the failing tests**

Create `cs-copilot/backend/src/__tests__/services/churnScorer.test.ts`:
```typescript
import { computeChurnScore, getTier } from '../../services/churnScorer';

describe('getTier', () => {
  it('returns healthy for 80+', () => expect(getTier(85)).toBe('healthy'));
  it('returns watch for 60-79', () => expect(getTier(65)).toBe('watch'));
  it('returns at-risk for 40-59', () => expect(getTier(52)).toBe('at-risk'));
  it('returns critical for under 40', () => expect(getTier(31)).toBe('critical'));
});

describe('computeChurnScore', () => {
  const usage = { dauTrend28d: -41, featuresAdopted: 3, featuresTotal: 12, lastLoginDaysAgo: 2 };
  const support = { openTickets: 2, criticalTickets: 2, avgResolutionDays: 4, csat90d: 2.8, oldestOpenDays: 18 };
  const crm = { arr: 48000, renewalDate: '', renewalDaysAway: 22, lastCsmContactDaysAgo: 31, owner: 'Sarah', tier: 'Enterprise' };

  it('scores a critical account low', () => {
    const score = computeChurnScore(usage, support, crm);
    expect(score.score).toBeLessThan(40);
    expect(score.tier).toBe('critical');
  });

  it('scores a healthy account high', () => {
    const healthyUsage = { dauTrend28d: 15, featuresAdopted: 10, featuresTotal: 12, lastLoginDaysAgo: 1 };
    const healthySupport = { openTickets: 0, criticalTickets: 0, avgResolutionDays: 1, csat90d: 4.8, oldestOpenDays: 0 };
    const healthyCrm = { ...crm, renewalDaysAway: 120, lastCsmContactDaysAgo: 7 };
    const score = computeChurnScore(healthyUsage, healthySupport, healthyCrm);
    expect(score.score).toBeGreaterThan(79);
    expect(score.tier).toBe('healthy');
  });

  it('breakdown sums to total score', () => {
    const score = computeChurnScore(usage, support, crm);
    const sum = score.breakdown.amplitude + score.breakdown.support + score.breakdown.crm;
    expect(score.score).toBe(sum);
  });
});
```

**Step 2: Run to confirm failure**

```bash
npx jest --testPathPattern=churnScorer --no-coverage
```

**Step 3: Implement `cs-copilot/backend/src/services/churnScorer.ts`**

```typescript
import { UsageSummary, SupportSummary, CrmSummary, ChurnScore } from '../types';

export function getTier(score: number): ChurnScore['tier'] {
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'watch';
  if (score >= 40) return 'at-risk';
  return 'critical';
}

function scoreAmplitude(usage: UsageSummary): number {
  let score = 0;

  // DAU trend (25 pts)
  if (usage.dauTrend28d > 10) score += 25;
  else if (usage.dauTrend28d >= -10) score += 15;
  else if (usage.dauTrend28d >= -30) score += 8;
  // else 0

  // Feature adoption (20 pts)
  const adoptionPct = usage.featuresTotal > 0 ? usage.featuresAdopted / usage.featuresTotal : 0;
  score += Math.round(adoptionPct * 20);

  // Last login (15 pts)
  if (usage.lastLoginDaysAgo <= 7) score += 15;
  else if (usage.lastLoginDaysAgo <= 14) score += 10;
  else if (usage.lastLoginDaysAgo <= 30) score += 5;

  return score;
}

function scoreSupport(support: SupportSummary): number {
  let score = 0;

  // Critical tickets (15 pts)
  if (support.criticalTickets === 0) score += 15;
  else if (support.criticalTickets === 1) score += 10;
  else if (support.criticalTickets === 2) score += 5;

  // CSAT (10 pts)
  if (support.csat90d !== null) {
    score += Math.round(((support.csat90d - 1) / 4) * 10);
  } else {
    score += 5; // neutral if no data
  }

  // Oldest open ticket (5 pts)
  if (support.oldestOpenDays <= 14) score += 5;

  return score;
}

function scoreCrm(crm: CrmSummary): number {
  let score = 0;

  // Days to renewal (5 pts)
  if (crm.renewalDaysAway > 90) score += 5;
  else if (crm.renewalDaysAway >= 30) score += 3;
  else score += 1;

  // Last CSM contact (5 pts)
  if (crm.lastCsmContactDaysAgo <= 14) score += 5;
  else if (crm.lastCsmContactDaysAgo <= 30) score += 3;

  return score;
}

export function computeChurnScore(
  usage: UsageSummary,
  support: SupportSummary,
  crm: CrmSummary
): ChurnScore {
  const amplitude = scoreAmplitude(usage);
  const support_ = scoreSupport(support);
  const crm_ = scoreCrm(crm);
  const total = amplitude + support_ + crm_;

  return {
    accountId: '',
    score: total,
    tier: getTier(total),
    computedAt: new Date().toISOString(),
    breakdown: { amplitude, support: support_, crm: crm_ }
  };
}
```

**Step 4: Run tests**

```bash
npx jest --testPathPattern=churnScorer --no-coverage
```

Expected: PASS (all tests)

**Step 5: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/services/churnScorer.ts cs-copilot/backend/src/__tests__/services/churnScorer.test.ts
git commit -m "feat: add churn scoring algorithm with tier classification"
```

---

## Phase 4: Azure Functions (HTTP + Timer)

### Task 8: ChurnScoreJob timer function

**Files:**
- Create: `cs-copilot/backend/src/functions/ChurnScoreJob.ts`

**Note:** This function requires Azure Table Storage to be running locally. Use Azurite emulator: `npx azurite --silent &`

**Step 1: Create `cs-copilot/backend/src/functions/ChurnScoreJob.ts`**

```typescript
import { app, Timer } from '@azure/functions';
import { TableClient } from '@azure/data-tables';
import { getHubspotAccount } from '../tools/hubspot';
import { getZendeskSummary } from '../tools/zendesk';
import { getIntercomSummary } from '../tools/intercom';
import { computeChurnScore, getTier } from '../services/churnScorer';
import { ChurnScore, UsageSummary } from '../types';

// Placeholder: Amplitude data fetched via Claude MCP in live queries
// For the daily job, use Amplitude REST API directly
async function getAmplitudeUsage(companyId: string): Promise<UsageSummary> {
  // TODO: implement Amplitude REST API call for DAU trends
  // For now return neutral defaults — replace in Phase 5
  return { dauTrend28d: 0, featuresAdopted: 5, featuresTotal: 10, lastLoginDaysAgo: 3 };
}

async function getTableClient(): Promise<TableClient> {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING!;
  const client = TableClient.fromConnectionString(conn, 'churnscores');
  await client.createTable();
  return client;
}

async function getYesterdayScore(table: TableClient, accountId: string): Promise<number | null> {
  try {
    const entity = await table.getEntity('score', accountId);
    return entity.score as number;
  } catch {
    return null;
  }
}

async function saveScore(table: TableClient, score: ChurnScore & { accountId: string }): Promise<void> {
  await table.upsertEntity({
    partitionKey: 'score',
    rowKey: score.accountId,
    score: score.score,
    tier: score.tier,
    computedAt: score.computedAt
  });
}

app.timer('ChurnScoreJob', {
  schedule: '0 0 7 * * *', // 7am daily
  handler: async (timer: Timer) => {
    console.log('ChurnScoreJob started at', new Date().toISOString());

    const table = await getTableClient();

    // TODO: fetch all accounts from HubSpot (paginated)
    // For now, stub with env-configured account IDs
    const accountIds = (process.env.ACCOUNT_IDS ?? '').split(',').filter(Boolean);

    for (const accountId of accountIds) {
      try {
        const [crm, support, usage] = await Promise.all([
          getHubspotAccount(accountId),
          getZendeskSummary(`${process.env.ZENDESK_SUBDOMAIN}.zendesk.com`, accountId),
          getAmplitudeUsage(accountId)
        ]);

        const intercom = await getIntercomSummary(accountId);
        // Merge support: Zendesk primary, Intercom fills gaps
        const mergedSupport = {
          ...support,
          openTickets: support.openTickets + intercom.openTickets,
          oldestOpenDays: Math.max(support.oldestOpenDays, intercom.oldestOpenDays)
        };

        const scoreResult = computeChurnScore(usage, mergedSupport, crm);
        const fullScore = { ...scoreResult, accountId };

        const yesterday = await getYesterdayScore(table, accountId);
        await saveScore(table, fullScore);

        const droppedTier = yesterday !== null && getTier(yesterday) !== fullScore.tier;
        console.log(`Account ${accountId}: ${fullScore.score} (${fullScore.tier})${droppedTier ? ' TIER CHANGE' : ''}`);

        // TODO: Send Slack DM (wired in Task 10)
      } catch (err) {
        console.error(`Failed to score account ${accountId}:`, err);
      }
    }
  }
});
```

**Step 2: Verify TypeScript compiles**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/functions/ChurnScoreJob.ts
git commit -m "feat: add ChurnScoreJob timer function (daily 7am churn scoring)"
```

---

### Task 9: HTTP API functions (accounts + ask)

**Files:**
- Create: `cs-copilot/backend/src/functions/GetAccounts.ts`
- Create: `cs-copilot/backend/src/functions/GetAccount.ts`
- Create: `cs-copilot/backend/src/functions/AskAccount.ts`

**Step 1: Create `cs-copilot/backend/src/functions/GetAccounts.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { TableClient } from '@azure/data-tables';

app.http('GetAccounts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'accounts',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const conn = process.env.AZURE_STORAGE_CONNECTION_STRING!;
      const table = TableClient.fromConnectionString(conn, 'churnscores');

      const accounts: any[] = [];
      for await (const entity of table.listEntities({ queryOptions: { filter: "PartitionKey eq 'score'" } })) {
        accounts.push({
          id: entity.rowKey,
          score: entity.score,
          tier: entity.tier,
          computedAt: entity.computedAt
        });
      }

      accounts.sort((a, b) => (a.score as number) - (b.score as number)); // worst first

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(accounts)
      };
    } catch (err) {
      return { status: 500, body: (err as Error).message };
    }
  }
});
```

**Step 2: Create `cs-copilot/backend/src/functions/GetAccount.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getHubspotAccount } from '../tools/hubspot';
import { getZendeskSummary } from '../tools/zendesk';
import { getIntercomSummary } from '../tools/intercom';

app.http('GetAccount', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'accounts/{id}',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const id = req.params.id;
    try {
      const [crm, support, intercom] = await Promise.all([
        getHubspotAccount(id),
        getZendeskSummary(`${process.env.ZENDESK_SUBDOMAIN}.zendesk.com`, id),
        getIntercomSummary(id)
      ]);

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ id, crm, support, intercom })
      };
    } catch (err) {
      return { status: 500, body: (err as Error).message };
    }
  }
});
```

**Step 3: Create `cs-copilot/backend/src/functions/AskAccount.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod';
import { askAboutAccount } from '../services/claude';

const BodySchema = z.object({
  accountId: z.string(),
  accountName: z.string(),
  question: z.string().min(1).max(500),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).default([])
});

app.http('AskAccount', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ask',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const corsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (req.method === 'OPTIONS') return { status: 204, headers: corsHeaders };

    try {
      const body = await req.json();
      const parsed = BodySchema.safeParse(body);
      if (!parsed.success) return { status: 400, body: JSON.stringify(parsed.error), headers: corsHeaders };

      const { accountId, accountName, question, history } = parsed.data;
      const answer = await askAboutAccount(accountId, accountName, question, history);

      return { status: 200, headers: corsHeaders, body: JSON.stringify({ answer }) };
    } catch (err) {
      return { status: 500, body: (err as Error).message, headers: corsHeaders };
    }
  }
});
```

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 5: Smoke test locally**

```bash
npm run build && func start
# In another terminal:
curl http://localhost:7071/api/accounts
```

Expected: JSON array (empty if Azurite has no data yet, no crash).

**Step 6: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/functions/
git commit -m "feat: add GetAccounts, GetAccount, and AskAccount HTTP functions"
```

---

## Phase 5: Web UI

### Task 10: Portfolio page

**Files:**
- Create: `cs-copilot/frontend/src/components/HealthBadge.tsx`
- Create: `cs-copilot/frontend/src/components/AccountCard.tsx`
- Create: `cs-copilot/frontend/src/pages/Portfolio.tsx`
- Modify: `cs-copilot/frontend/src/App.tsx`

**Step 1: Create `cs-copilot/frontend/src/components/HealthBadge.tsx`**

```tsx
type Tier = 'healthy' | 'watch' | 'at-risk' | 'critical';

const CONFIG: Record<Tier, { emoji: string; bg: string; text: string }> = {
  healthy:  { emoji: '✅', bg: 'bg-green-100',  text: 'text-green-800' },
  watch:    { emoji: '🟡', bg: 'bg-yellow-100', text: 'text-yellow-800' },
  'at-risk':{ emoji: '🟠', bg: 'bg-orange-100', text: 'text-orange-800' },
  critical: { emoji: '🔴', bg: 'bg-red-100',    text: 'text-red-800' },
};

export function HealthBadge({ tier, score }: { tier: Tier; score: number }) {
  const { emoji, bg, text } = CONFIG[tier];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-medium ${bg} ${text}`}>
      {emoji} {score}
    </span>
  );
}
```

**Step 2: Create `cs-copilot/frontend/src/components/AccountCard.tsx`**

```tsx
import { HealthBadge } from './HealthBadge';

interface Props {
  id: string;
  name: string;
  score: number;
  tier: 'healthy' | 'watch' | 'at-risk' | 'critical';
  scoreDelta?: number;
  renewalDaysAway?: number;
  onClick: () => void;
}

export function AccountCard({ name, score, tier, scoreDelta, renewalDaysAway, onClick }: Props) {
  const deltaLabel = scoreDelta !== undefined
    ? scoreDelta > 0 ? `↗ +${scoreDelta}` : scoreDelta < 0 ? `↘ ${scoreDelta}` : '→ 0'
    : null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center justify-between gap-4"
    >
      <span className="font-medium text-gray-900">{name}</span>
      <div className="flex items-center gap-3 text-sm text-gray-500 shrink-0">
        {deltaLabel && <span className={scoreDelta! < 0 ? 'text-red-600' : 'text-green-600'}>{deltaLabel}</span>}
        {renewalDaysAway !== undefined && <span>Renewal: {renewalDaysAway}d</span>}
        <HealthBadge tier={tier} score={score} />
      </div>
    </button>
  );
}
```

**Step 3: Create `cs-copilot/frontend/src/pages/Portfolio.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountCard } from '../components/AccountCard';
import { getAccounts } from '../services/api';

export function Portfolio() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    getAccounts().then(setAccounts).finally(() => setLoading(false));
  }, []);

  const filtered = accounts.filter(a =>
    (a.name ?? a.id).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">CS Copilot</h1>
        <input
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search accounts..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </header>
      <main className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-sm font-medium text-gray-500 mb-4">
          {loading ? 'Loading...' : `My Accounts (${filtered.length})`}
        </h2>
        <div className="flex flex-col gap-2">
          {filtered.map(a => (
            <AccountCard
              key={a.id}
              id={a.id}
              name={a.name ?? a.id}
              score={a.score}
              tier={a.tier}
              scoreDelta={a.scoreDelta}
              renewalDaysAway={a.renewalDaysAway}
              onClick={() => navigate(`/accounts/${a.id}`)}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
```

**Step 4: Install react-router-dom**

```bash
cd "d:/Logic Software/AI/cs-copilot/frontend"
npm install react-router-dom
```

**Step 5: Replace `cs-copilot/frontend/src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Portfolio } from './pages/Portfolio';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Portfolio />} />
        <Route path="/accounts/:id" element={<div className="p-8 text-gray-500">Account view coming soon</div>} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Step 6: Run dev server and verify**

```bash
npm run dev
```

Open `http://localhost:5173` — should see the portfolio page with search bar. No crash.

**Step 7: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/frontend/
git commit -m "feat: add Portfolio page with account cards and health badges"
```

---

### Task 11: Account 360° page with chat panel

**Files:**
- Create: `cs-copilot/frontend/src/components/ChatPanel.tsx`
- Create: `cs-copilot/frontend/src/pages/Account.tsx`
- Modify: `cs-copilot/frontend/src/App.tsx`

**Step 1: Create `cs-copilot/frontend/src/components/ChatPanel.tsx`**

```tsx
import { useState, useRef, useEffect } from 'react';
import { askAccount } from '../services/api';

interface Message { role: 'user' | 'assistant'; content: string }

export function ChatPanel({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const question = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setLoading(true);
    try {
      const { answer } = await askAccount(accountId, accountName, question, messages);
      setMessages(prev => [...prev, { role: 'assistant', content: answer }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full border-l border-gray-200">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400 text-center mt-8">Ask anything about {accountName}...</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && <div className="text-sm text-gray-400">Thinking...</div>}
        <div ref={bottomRef} />
      </div>
      <div className="p-4 border-t border-gray-200 flex gap-2">
        <input
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={`Ask about ${accountName}...`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-blue-700"
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Create `cs-copilot/frontend/src/pages/Account.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { HealthBadge } from '../components/HealthBadge';
import { ChatPanel } from '../components/ChatPanel';
import { getAccount } from '../services/api';

export function Account() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) getAccount(id).then(setData).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!data) return <div className="p-8 text-red-500">Account not found</div>;

  const { crm, support } = data;

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600">←</button>
        <h1 className="font-semibold text-gray-900">{crm?.owner ?? id}</h1>
        {data.score && <HealthBadge tier={data.tier} score={data.score} />}
      </header>
      <div className="flex-1 flex overflow-hidden">
        {/* Left: data panels */}
        <div className="w-80 border-r border-gray-200 overflow-y-auto p-6 space-y-6 shrink-0">
          {crm && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">CRM</h2>
              <dl className="space-y-1 text-sm">
                <Row label="ARR" value={`$${crm.arr?.toLocaleString()}`} />
                <Row label="Renewal" value={`${crm.renewalDaysAway}d away`} />
                <Row label="Last contact" value={`${crm.lastCsmContactDaysAgo}d ago`} />
                <Row label="Owner" value={crm.owner} />
              </dl>
            </section>
          )}
          {support && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Support</h2>
              <dl className="space-y-1 text-sm">
                <Row label="Open tickets" value={String(support.openTickets)} />
                <Row label="Critical" value={String(support.criticalTickets)} />
                <Row label="CSAT (90d)" value={support.csat90d ? `${support.csat90d.toFixed(1)}/5` : 'No data'} />
                <Row label="Oldest open" value={`${support.oldestOpenDays}d`} />
              </dl>
            </section>
          )}
        </div>
        {/* Right: chat */}
        <div className="flex-1">
          <ChatPanel accountId={id!} accountName={crm?.owner ?? id!} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{value}</dd>
    </div>
  );
}
```

**Step 3: Update `cs-copilot/frontend/src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Portfolio } from './pages/Portfolio';
import { Account } from './pages/Account';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Portfolio />} />
        <Route path="/accounts/:id" element={<Account />} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Step 4: Run dev server and verify**

```bash
npm run dev
```

Navigate to an account — should see the two-panel layout. Chat panel should show input and respond (requires backend running).

**Step 5: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/frontend/src/
git commit -m "feat: add Account 360 page with chat panel"
```

---

## Phase 6: Slack Bot

### Task 12: Slack bot setup + DM handler

**Files:**
- Create: `cs-copilot/backend/src/services/slackBot.ts`
- Create: `cs-copilot/backend/src/functions/SlackEvents.ts`

**Step 1: Create `cs-copilot/backend/src/services/slackBot.ts`**

```typescript
import { App, AwsLambdaReceiver } from '@slack/bolt';

let app: App | null = null;
let receiver: AwsLambdaReceiver | null = null;

export function getSlackApp(): { app: App; receiver: AwsLambdaReceiver } {
  if (!app || !receiver) {
    // bolt-azure-functions-receiver has same interface as AwsLambdaReceiver
    // Use the azure receiver package in the actual function
    receiver = new AwsLambdaReceiver({
      signingSecret: process.env.SLACK_SIGNING_SECRET!
    });
    app = new App({
      token: process.env.SLACK_BOT_TOKEN!,
      receiver
    });
    registerHandlers(app);
  }
  return { app, receiver };
}

function registerHandlers(app: App) {
  // Handle DMs
  app.message(async ({ message, client, say }) => {
    if (message.subtype) return; // ignore bot messages, edits, etc.
    const dm = message as any;
    if (!dm.text) return;

    await say('Let me look that up...');

    const { askAboutAccount } = await import('./claude');
    // For DMs, we don't have an account yet — Claude will ask or infer from context
    const answer = await askAboutAccount('', 'Unknown', dm.text, []);
    await say(answer);
  });

  // /csm slash command
  app.command('/csm', async ({ command, ack, respond }) => {
    await ack();
    const companyName = command.text.trim();
    if (!companyName) {
      await respond('Usage: `/csm <company name>`');
      return;
    }
    await respond(`Looking up ${companyName}...`);
    const { askAboutAccount } = await import('./claude');
    const answer = await askAboutAccount('', companyName, `Give me a quick health summary of ${companyName}`, []);
    await respond(answer);
  });
}
```

**Step 2: Create `cs-copilot/backend/src/functions/SlackEvents.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { AzureFunctionsReceiver } from 'bolt-azure-functions-receiver';
import { App } from '@slack/bolt';

let slackApp: App | null = null;
let receiver: AzureFunctionsReceiver | null = null;

function getApp() {
  if (!slackApp || !receiver) {
    receiver = new AzureFunctionsReceiver({
      signingSecret: process.env.SLACK_SIGNING_SECRET!
    });
    slackApp = new App({
      token: process.env.SLACK_BOT_TOKEN!,
      receiver
    });

    // DM handler
    slackApp.message(async ({ message, say }) => {
      const dm = message as any;
      if (!dm.text || dm.subtype) return;
      await say('_Looking that up..._');
      const { askAboutAccount } = await import('../services/claude');
      const answer = await askAboutAccount('', 'Unknown Account', dm.text, []);
      await say(answer);
    });

    // /csm slash command
    slackApp.command('/csm', async ({ command, ack, respond }) => {
      await ack();
      const name = command.text.trim();
      if (!name) { await respond('Usage: `/csm <company name>`'); return; }
      const { askAboutAccount } = await import('../services/claude');
      const answer = await askAboutAccount('', name, `Give me a health summary of ${name}`, []);
      await respond(answer);
    });
  }
  return { slackApp, receiver };
}

app.http('SlackEvents', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'slack/events',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const { receiver } = getApp();
    return receiver.requestHandler(req as any, context as any);
  }
});
```

**Step 3: Verify TypeScript compiles**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/services/slackBot.ts cs-copilot/backend/src/functions/SlackEvents.ts
git commit -m "feat: add Slack bot with DM handler and /csm slash command"
```

---

### Task 13: Wire Slack proactive alerts into ChurnScoreJob

**Files:**
- Modify: `cs-copilot/backend/src/functions/ChurnScoreJob.ts`

**Step 1: Add alert sending to ChurnScoreJob**

Add this function before the `app.timer` call in `ChurnScoreJob.ts`:

```typescript
import { WebClient } from '@slack/bolt';

async function sendChurnAlert(csmSlackId: string, atRiskAccounts: Array<{ name: string; score: number; tier: string; delta: number; reason: string }>) {
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  const lines = atRiskAccounts.map(a => {
    const emoji = a.tier === 'critical' ? '🔴' : a.tier === 'at-risk' ? '🟠' : '🟡';
    return `${emoji} *${a.name}* — Score: ${a.score} (${a.delta > 0 ? '+' : ''}${a.delta} vs yesterday)\n   ↘ ${a.reason}`;
  });

  await slack.chat.postMessage({
    channel: csmSlackId,
    text: `Good morning! ${atRiskAccounts.length} account${atRiskAccounts.length > 1 ? 's' : ''} need${atRiskAccounts.length === 1 ? 's' : ''} your attention today:\n\n${lines.join('\n\n')}`
  });
}
```

Update the scoring loop to collect per-CSM alerts and send at the end of the timer run.

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/functions/ChurnScoreJob.ts
git commit -m "feat: wire proactive Slack churn alerts into ChurnScoreJob"
```

---

## Phase 7: Vector Search

### Task 14: Nightly ticket sync to Azure AI Search

**Files:**
- Create: `cs-copilot/backend/src/tools/vectorSearch.ts`
- Create: `cs-copilot/backend/src/functions/TicketSyncJob.ts`

**Step 1: Create `cs-copilot/backend/src/tools/vectorSearch.ts`**

```typescript
import { SearchClient, SearchIndexClient, AzureKeyCredential, VectorizedQuery } from '@azure/search-documents';

const INDEX_NAME = 'tickets';

function getSearchClient() {
  return new SearchClient(
    process.env.AZURE_SEARCH_ENDPOINT!,
    INDEX_NAME,
    new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY!)
  );
}

export interface TicketDoc {
  id: string;
  accountId: string;
  source: 'zendesk' | 'intercom';
  subject: string;
  body: string;
  status: string;
  createdAt: string;
  embedding?: number[];
}

export async function searchTicketHistory(accountId: string, query: string): Promise<string> {
  const client = getSearchClient();
  const results = await client.search(query, {
    filter: `accountId eq '${accountId}'`,
    top: 5,
    select: ['subject', 'body', 'status', 'createdAt', 'source']
  });

  const tickets: string[] = [];
  for await (const result of results.results) {
    const doc = result.document as any;
    tickets.push(`[${doc.source.toUpperCase()} - ${doc.status}] ${doc.subject}\n${doc.body?.slice(0, 300)}...`);
  }

  return tickets.length > 0 ? tickets.join('\n\n---\n\n') : 'No relevant tickets found.';
}

export const vectorSearchToolDef = {
  name: 'search_ticket_history',
  description: 'Semantic search over Zendesk tickets and Intercom conversations for a specific account. Use when the CSM asks about a specific issue, complaint, or past conversation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      account_id: { type: 'string' },
      query: { type: 'string', description: 'What to search for, e.g. "API integration failure" or "billing complaint"' }
    },
    required: ['account_id', 'query']
  }
};
```

**Step 2: Create `cs-copilot/backend/src/functions/TicketSyncJob.ts`**

```typescript
import { app } from '@azure/functions';
import { SearchIndexClient, SearchClient, AzureKeyCredential } from '@azure/search-documents';
import axios from 'axios';

const INDEX_NAME = 'tickets';

async function ensureIndex() {
  const client = new SearchIndexClient(
    process.env.AZURE_SEARCH_ENDPOINT!,
    new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY!)
  );

  try {
    await client.getIndex(INDEX_NAME);
  } catch {
    await client.createIndex({
      name: INDEX_NAME,
      fields: [
        { name: 'id', type: 'Edm.String', key: true },
        { name: 'accountId', type: 'Edm.String', filterable: true },
        { name: 'source', type: 'Edm.String', filterable: true },
        { name: 'subject', type: 'Edm.String', searchable: true },
        { name: 'body', type: 'Edm.String', searchable: true },
        { name: 'status', type: 'Edm.String' },
        { name: 'createdAt', type: 'Edm.String' }
      ]
    });
  }
}

app.timer('TicketSyncJob', {
  schedule: '0 0 2 * * *', // 2am nightly
  handler: async () => {
    console.log('TicketSyncJob started');
    await ensureIndex();

    const searchClient = new SearchClient(
      process.env.AZURE_SEARCH_ENDPOINT!,
      INDEX_NAME,
      new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY!)
    );

    // Fetch and index Zendesk tickets from last 12 months
    const since = new Date(Date.now() - 365 * 86400000).toISOString();
    const email = process.env.ZENDESK_EMAIL!;
    const token = process.env.ZENDESK_TOKEN!;
    const auth = Buffer.from(`${email}/token:${token}`).toString('base64');
    const subdomain = process.env.ZENDESK_SUBDOMAIN!;

    const res = await axios.get(
      `https://${subdomain}.zendesk.com/api/v2/tickets.json?created_after=${since}&per_page=100`,
      { headers: { Authorization: `Basic ${auth}` } }
    );

    const docs = (res.data.tickets ?? []).map((t: any) => ({
      id: `zendesk-${t.id}`,
      accountId: String(t.organization_id ?? ''),
      source: 'zendesk',
      subject: t.subject ?? '',
      body: t.description ?? '',
      status: t.status,
      createdAt: t.created_at
    }));

    if (docs.length > 0) {
      await searchClient.uploadDocuments(docs);
      console.log(`Indexed ${docs.length} Zendesk tickets`);
    }
  }
});
```

**Step 3: Wire `search_ticket_history` into Claude service**

In `cs-copilot/backend/src/services/claude.ts`, add:
- Import `vectorSearchToolDef` and `searchTicketHistory` from `../tools/vectorSearch`
- Add `vectorSearchToolDef` to the `TOOLS` array
- Add a `case 'search_ticket_history'` to `executeTool`:

```typescript
case 'search_ticket_history': {
  const result = await searchTicketHistory(input.account_id, input.query);
  return result;
}
```

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/backend/src/tools/vectorSearch.ts cs-copilot/backend/src/functions/TicketSyncJob.ts cs-copilot/backend/src/services/claude.ts
git commit -m "feat: add ticket vector search with Azure AI Search nightly sync"
```

---

## Phase 8: Deployment

### Task 15: Deploy backend to Azure Functions

**Step 1: Create a `.funcignore`**

```
node_modules
dist
src
__tests__
*.test.ts
local.settings.json
```

**Step 2: Build and deploy**

```bash
cd "d:/Logic Software/AI/cs-copilot/backend"
npm run build
func azure functionapp publish <your-function-app-name>
```

**Step 3: Set environment variables in Azure portal**

Go to Azure Portal → Function App → Configuration → Application Settings and add all variables from `local.settings.json`.

**Step 4: Create `cs-copilot/frontend/staticwebapp.config.json`**

```json
{
  "routes": [
    { "route": "/*", "serve": "/index.html", "statusCode": 200 }
  ],
  "navigationFallback": {
    "rewrite": "/index.html"
  }
}
```

**Step 5: Set VITE_API_URL in frontend .env.production**

```
VITE_API_URL=https://<your-function-app>.azurewebsites.net/api
```

**Step 6: Deploy frontend**

Connect the `cs-copilot/frontend` directory to Azure Static Web Apps via GitHub Actions or:
```bash
npm run build
# Azure Static Web Apps CLI or portal deployment
```

**Step 7: Register Slack event subscription**

In your Slack app dashboard:
- Event Subscriptions URL: `https://<your-function-app>.azurewebsites.net/api/slack/events`
- Subscribe to: `message.im`
- Slash Commands: `/csm` → same URL

**Step 8: Commit any deployment config changes**

```bash
cd "d:/Logic Software/AI"
git add cs-copilot/
git commit -m "feat: add deployment config for Azure Functions and Static Web Apps"
```

---

## Summary: Build Order Checklist

- [ ] Task 1: Scaffold backend project
- [ ] Task 2: Scaffold frontend project
- [ ] Task 3: HubSpot connector
- [ ] Task 4: Zendesk connector
- [ ] Task 5: Intercom connector
- [ ] Task 6: Claude service + agentic loop
- [ ] Task 7: Churn scoring algorithm
- [ ] Task 8: ChurnScoreJob timer function
- [ ] Task 9: HTTP API functions
- [ ] Task 10: Portfolio web page
- [ ] Task 11: Account 360° + chat panel
- [ ] Task 12: Slack bot DM handler + /csm command
- [ ] Task 13: Slack proactive alerts in ChurnScoreJob
- [ ] Task 14: Vector search (Azure AI Search + nightly sync)
- [ ] Task 15: Deployment
