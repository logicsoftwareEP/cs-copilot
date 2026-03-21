# Auth & User Management Design

## Problem

CS Copilot is currently open — anyone with the URL can access all customer data. We need authentication via Microsoft Entra ID and role-based access control with three permission levels.

## Approach

Use Azure Static Web Apps built-in Entra ID authentication. No MSAL library, no JWT validation, no token management code. SWA handles the OAuth flow, session cookies, and passes user identity to the backend via the `x-ms-client-principal` header.

User roles are managed in-app via an admin page, stored in Azure Table Storage.

### Architecture Migration Required

The backend is currently deployed as a **separate** Azure Functions app (`cs-copilot-func`) called directly by the frontend via `VITE_API_URL` with a function key (`?code=...`). SWA's `x-ms-client-principal` header injection only works for **linked backends** behind the SWA proxy.

**Required migration:**
1. Link `cs-copilot-func` to `cs-copilot-ui` (SWA) via `az staticwebapp backends link`
2. Change all endpoint `authLevel` from `'function'` to `'anonymous'` (SWA handles auth, function keys are incompatible with SWA proxy)
3. Remove `VITE_API_URL` and `VITE_API_KEY` from the frontend — all API calls go to `/api/*` (same-origin through SWA proxy)
4. Remove the `withCode()` helper and `?code=` query param logic from `frontend/src/services/api.ts`
5. Remove `CORS_HEADERS` and `OPTIONS` handling from all backend handlers (requests are same-origin through SWA)
6. The timer trigger (`NightlySync`) is invoked by the Azure Functions runtime directly, not through HTTP — no auth changes needed for it

## Roles

Three roles: **Admin**, **Supervisor**, **CSM**.

| Action | Admin | Supervisor | CSM |
|--------|-------|------------|-----|
| View all accounts | Yes | Yes | No (own only) |
| Trigger sync | Yes | No | No |
| Manage mappings | Yes | Yes | No |
| Edit ARR / licences | Yes | Yes | No |
| Manage users (`/admin`) | Yes | No | No |

CSMs see only accounts where `account.csmName` matches their `displayName` in the users table (case-insensitive comparison).

## Authentication Flow

1. `staticwebapp.config.json` requires `authenticated` role on all routes except `/.auth/*`
2. Unauthenticated users are redirected to `/.auth/login/aad` (Entra ID)
3. After login, SWA sets a secure session cookie
4. Frontend calls `GET /.auth/me` to get the logged-in user's Entra ID info
5. Frontend calls `GET /api/me` — backend decodes `x-ms-client-principal`, looks up user in `users` table, returns `{ email, displayName, role }` or 403
6. If 403 → frontend shows "Access denied, contact admin" screen
7. If authorized → frontend stores user context and renders the app
8. All subsequent API calls go through SWA proxy — `x-ms-client-principal` header is injected automatically

Auth providers restricted to `aad` only (GitHub/Twitter defaults blocked).

### How `x-ms-client-principal` is decoded

The header value is a base64-encoded JSON object:
```typescript
const header = req.headers.get('x-ms-client-principal');
const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
// decoded.claims is an array of { typ, val }
// Email: find claim where typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
//    or typ === 'preferred_username'
const emailClaim = decoded.claims.find(c =>
  c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
  || c.typ === 'preferred_username'
);
const email = emailClaim?.val?.toLowerCase();
```

## Data Model

### New `users` table (Azure Table Storage)

| Field | Type | Description |
|-------|------|-------------|
| partitionKey | `'users'` | Fixed |
| rowKey | string | Email (lowercase) |
| displayName | string | Must match `csmName` on accounts for CSM filtering |
| role | `'admin' \| 'supervisor' \| 'csm'` | Permission level |
| createdAt | string | ISO timestamp |
| updatedAt | string | ISO timestamp |

### CSM filtering

Primary match: `account.csmName` compared case-insensitively to `user.displayName`. The `Account` type also has `csmEmail` but it is currently empty for SQL-sourced accounts. If `csmEmail` becomes available in the future, it should be preferred as the matching field (emails are canonical, names are not).

The admin must ensure the `displayName` entered in the user management page exactly matches the CSM name shown in accounts (from the SQL view's `HubspotSuccessManager` column).

### Bootstrap

Seed admin user on first deploy: `vadim@logicsoftware.net` with role `admin`. Done via a setup script that writes directly to Table Storage.

## Backend Changes

### New files

**`src/services/userStore.ts`** — CRUD for `users` table. Same pattern as `AccountStore`:
- `getUser(email): User | null`
- `listUsers(): User[]`
- `upsertUser(email, displayName, role): void`
- `deleteUser(email): void`
- `ensureTable(): void`

**`src/functions/UsersApi.ts`** — User management + auth check:
- `GET /api/me` — decodes `x-ms-client-principal`, returns `{ email, displayName, role }` or 403. Used by frontend to bootstrap auth context.
- `GET /api/users` — list all users (admin only)
- `POST /api/users` — create or update user (Zod-validated: email, displayName, role). **Guard: cannot delete or demote the last admin.**
- `DELETE /api/users?email=...` — delete user (admin only, email passed as query param to avoid `@` in URL path). **Guard: cannot delete the last admin.**

**`src/auth.ts`** — Shared auth helper:
- `authenticateRequest(req): { email, displayName, role }` — decodes `x-ms-client-principal` header (see decoding section above), extracts email from claims, looks up user in `users` table, returns user or throws 403
- `requireRole(user, ...roles)` — throws 403 if user's role is not in the allowed list
- Used by every API handler

### Changes to existing endpoints

All endpoints: change `authLevel` from `'function'` to `'anonymous'`. Remove `CORS_HEADERS`, remove `OPTIONS` handling.

**AccountsApi.ts:**
- `GET /api/accounts` — call `authenticateRequest()`. If role is `csm`, filter results where `account.csmName.toLowerCase() === user.displayName.toLowerCase()`
- `GET /api/accounts/{id}` — if role is `csm`, verify account's `csmName` matches user (case-insensitive)
- `PATCH /api/accounts/{id}` — require `admin` or `supervisor` role

**MappingApi.ts:**
- All routes — require `admin` or `supervisor` role

**SyncTrigger.ts:**
- `POST /api/sync` — require `admin` role

**SyncRunner.ts:**
- No changes. `runSync()` is called internally by the timer trigger and by `SyncTrigger`. Auth is checked at the HTTP layer only.

**index.ts:**
- Add `import './functions/UsersApi'` for function registration

## Frontend Changes

### API service changes (`src/services/api.ts`)

- Remove `VITE_API_URL` — use relative `/api` path (same-origin via SWA proxy)
- Remove `VITE_API_KEY` and `withCode()` helper — no more function key auth
- Add `getMe(): Promise<User>` — calls `GET /api/me`

### Auth context (`src/contexts/AuthContext.tsx`)

1. Calls `GET /.auth/me` on mount — checks SWA authentication
2. If not authenticated → `window.location.href = '/.auth/login/aad'`
3. If authenticated → calls `GET /api/me` to check app-level authorization and get role
4. If 403 → renders "Access denied, contact admin" screen
5. If authorized → stores `{ email, displayName, role }` in context

Wraps `<App />` in `main.tsx`. Exposes `useAuth()` hook.

### New route: `/admin`

Simple user management page (admin only):
- Table: email, display name, role, edit/delete actions
- "Add user" form: email, display name, role dropdown
- Inline edit for role and display name
- Delete with confirmation dialog
- No pagination needed (<10 users)

### Portfolio page changes

- CSMs: hide Sync button, hide owner filter (they only see their own accounts)
- All roles: show user name + role in header, logout link (`/.auth/logout`)

### Route protection

- `/admin` — accessible only to `admin` role, others redirect to `/`
- `/` — all roles (data filtering handled by backend)
- `/mapping` — currently redirects to `/`, no change needed

## Azure Configuration

### Entra ID app registration
- Register app in Azure AD tenant
- Set redirect URI to `https://lemon-island-0c1c7070f.4.azurestaticapps.net/.auth/login/aad/callback`
- Create a client secret (required for custom Entra ID registration with SWA)

### Static Web App configuration
- Link `cs-copilot-func` backend: `az staticwebapp backends link --name cs-copilot-ui --resource-group customersuccess --backend-resource-id <function-app-resource-id>`
- Set app settings: `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` in SWA configuration

### staticwebapp.config.json (replaces existing)
```json
{
  "routes": [
    { "route": "/.auth/login/github", "statusCode": 404 },
    { "route": "/.auth/login/twitter", "statusCode": 404 },
    { "route": "/api/*", "allowedRoles": ["authenticated"] },
    { "route": "/*", "allowedRoles": ["authenticated"] }
  ],
  "responseOverrides": {
    "401": {
      "redirect": "/.auth/login/aad",
      "statusCode": 302
    }
  },
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/api/*", "*.{css,js,png,ico,svg}"]
  }
}
```

## Local Development

When running locally (`vite dev` + `func start`), there is no SWA auth layer. To support local development:

- Backend: add a `SKIP_AUTH` env var (only in `local.settings.json`, never in Azure). When set, `authenticateRequest()` returns a mock user `{ email: 'dev@local', displayName: 'Dev User', role: 'admin' }`.
- Frontend: when `VITE_API_URL` is set (local dev only), skip the `/.auth/me` check and use the mock user from `GET /api/me`.

## Testing

- Unit tests for `UserStore` (same pattern as existing store tests)
- Unit tests for `authenticateRequest` helper (mock header decoding + user lookup)
- Unit tests for `requireRole` helper
- SyncRunner tests — no auth changes needed (called internally)
- Update `AccountsApi` / `MappingApi` tests to include mock `x-ms-client-principal` header
- Manual E2E: login flow, role-based filtering, admin page CRUD, access denied screen, last-admin guard

## Files Summary

| File | Change |
|------|--------|
| `frontend/staticwebapp.config.json` | Replace with auth routes + provider restrictions |
| `frontend/src/services/api.ts` | Remove function key, use `/api` relative path, add `getMe()` |
| `frontend/src/contexts/AuthContext.tsx` | **NEW** — auth context + `useAuth()` hook |
| `frontend/src/main.tsx` | Wrap with AuthProvider |
| `frontend/src/App.tsx` | Add `/admin` route, role guard |
| `frontend/src/pages/Admin.tsx` | **NEW** — user management page |
| `frontend/src/pages/Portfolio.tsx` | Role-aware UI (hide sync, filter) |
| `frontend/src/types.ts` | Add `User` type |
| `backend/src/types.ts` | Add `User`, `UserRole` types |
| `backend/src/auth.ts` | **NEW** — `authenticateRequest` + `requireRole` helpers |
| `backend/src/services/userStore.ts` | **NEW** — users table CRUD |
| `backend/src/functions/UsersApi.ts` | **NEW** — `GET /api/me` + admin user management API |
| `backend/src/functions/AccountsApi.ts` | Add auth + CSM filtering, remove CORS/OPTIONS, `authLevel: 'anonymous'` |
| `backend/src/functions/MappingApi.ts` | Add auth + role gating, remove CORS/OPTIONS, `authLevel: 'anonymous'` |
| `backend/src/functions/SyncTrigger.ts` | Add auth + admin-only, remove CORS/OPTIONS, `authLevel: 'anonymous'` |
| `backend/src/index.ts` | Register UsersApi |
| `backend/scripts/seed-admin.ts` | **NEW** — bootstrap script for `vadim@logicsoftware.net` |
