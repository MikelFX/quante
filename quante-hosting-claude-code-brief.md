# Quante — Managed Hosting (Deploy to Vercel) — Implementation Brief

## Goal
Add a **"Deploy to Quante hosting"** feature. When a user finishes a generated store, Quante deploys that store's Next.js codebase to Vercel **under Quante's own Vercel team**, programmatically, and returns a live URL. The customer never sees or touches Vercel — they get `https://<slug>.quante.app` (or their own custom domain). Use **Vercel for Platforms (Multi-Project mode)**.

## Stack & hard constraints
- Next.js (App Router), TypeScript **strict**, Supabase (Postgres), Stripe — match the existing Quante stack.
- Use the official **Vercel SDK (`@vercel/sdk`)**. Do NOT hardcode REST API version numbers. If you need raw REST, read the current Vercel for Platforms / REST API docs first.
- The Vercel access token is **server-only**. Never ship it to the client, never include it in a server action's return value, never log it. All Vercel calls run in server code (route handlers / server actions).
- Every deploy is tied to a `project` row and a `user` — no orphan deployments.
- **Idempotent:** re-deploying an existing store updates the same Vercel project; it never creates a new one.
- Commits in Conventional Commits style.

## Environment variables (server)
- `VERCEL_TOKEN` — team-scoped access token
- `VERCEL_TEAM_ID` — Quante's Vercel team id
- `HOSTING_ROOT_DOMAIN` — e.g. `quante.app` (wildcard `*.quante.app` must point to Vercel using Vercel nameservers for wildcard SSL)

## Data model (Supabase)
Create table `deployments`:
- `id` uuid pk
- `project_id` uuid fk → projects
- `user_id` uuid fk → users
- `vercel_project_id` text
- `vercel_deployment_id` text
- `status` enum: `queued | building | ready | error | canceled`
- `url` text (vercel deployment url)
- `domain` text nullable (assigned subdomain or custom domain)
- `version` int (which store version was deployed)
- `error_message` text nullable
- `created_at`, `updated_at` timestamptz

Add RLS: a user can only read their own deployments.

## Service layer — `lib/hosting/vercel.ts`
Typed, server-only functions:
- `ensureVercelProject(projectSlug): Promise<{ vercelProjectId }>` — create the Vercel project if it doesn't exist for this Quante project; framework `nextjs`. Persist `vercel_project_id` on the project row.
- `setEnvVars(vercelProjectId, vars: Record<string,string>, { encrypted }): Promise<void>` — set per-tenant env vars, target `production`. Secrets (Stripe keys, DB url) must be `encrypted`. Upsert (replace existing keys).
- `createDeployment(vercelProjectId, files: GeneratedFile[], { target: 'production' }): Promise<{ deploymentId, url }>` — upload the generated store files and create a production deployment. Prefer SHA-based file upload, fall back to inline.
- `getDeploymentStatus(deploymentId): Promise<DeploymentStatus>` — map Vercel `readyState` → our enum.
- `attachDomain(vercelProjectId, domain): Promise<{ verified, dnsInstructions? }>` — assign subdomain or custom domain; for custom domains return CNAME/verification info.
- `removeProject(vercelProjectId): Promise<void>` — teardown.

`GeneratedFile = { path: string; content: string; encoding?: 'utf-8' | 'base64' }`.
The store generator already produces this file tree (same source as the ZIP export) — **reuse it, do not regenerate**.

## Deploy flow — server action `deployStore(projectId)`
1. **Auth:** load project, assert it belongs to `auth.userId`.
2. **Billing:** check the user has enough credits / an active hosting entitlement. Reject early if not.
3. `ensureVercelProject`.
4. `setEnvVars` with the store's required env (Stripe publishable/secret, DB url, etc.). These arrive as **inputs** — provisioning the DB/Stripe is out of scope.
5. Resolve the file tree for the **current store version**.
6. `createDeployment` → insert a `deployments` row (`status: building`).
7. Poll `getDeploymentStatus` with backoff and a hard timeout (e.g. 5 min). Update the row on each transition.
8. On `ready`: `attachDomain` with `<slug>.${HOSTING_ROOT_DOMAIN}`, persist `url` + `domain`, deduct credits / mark hosting active, return `{ url, domain }`.
9. On `error`: persist `error_message`, do not charge, return a clean user-facing error (do not leak Vercel internals).

## Domains
- **Default:** subdomain `<slug>.quante.app`, auto-SSL via wildcard.
- **Custom domain (premium):** `attachDomain(projectId, customDomain)` → return DNS instructions (CNAME → `cname.vercel-dns.com`) to show the user, then a verify step + status polling. Auto-SSL once verified.
- Handle slug/domain collisions with a clear error.

## Re-deploy / versioning
The store is editable (chat → new version). `deployStore` on an already-deployed project must:
- reuse the existing `vercel_project_id`,
- re-`setEnvVars` if changed,
- create a new production deployment from the new version's files,
- update the deployment record's `version` + `vercel_deployment_id` (or insert a new row and mark the previous one superseded — pick one, be consistent),
- keep the same domain (no re-verification).

## Billing
- Hosting consumes credits or requires a hosting subscription — integrate with the existing Stripe + credit system.
- **Usage guardrail (important):** flat-fee hosting on usage-priced infra is a margin risk. Add a per-deployment credit cost AND record bandwidth/invocation usage if the Vercel API exposes it, so a usage cap can be enforced later. At minimum, leave a clear extension point for usage-based limits.

## Teardown
- On hosting cancel / project delete: `removeProject`, remove domains, mark `deployments` rows `canceled`. Idempotent and safe to call twice.

## Error handling (required)
- Build failure (generated code doesn't compile) → "Deploy failed, your store wasn't charged" + log the full Vercel error **server-side only**.
- Vercel rate limit / 5xx → retry with backoff; after N attempts, fail cleanly.
- Token/permission errors → log, never expose, generic user message.
- Timeouts → mark `error`; never leave rows stuck in `building`.

## Acceptance criteria
- [ ] A user can click "Deploy" and get a live `<slug>.quante.app` URL serving their generated store.
- [ ] `VERCEL_TOKEN` never appears in any client bundle, network response, or client-visible log.
- [ ] Re-deploying after an edit updates the same project + URL, not a new one.
- [ ] Failed builds don't charge the user and show a clean message.
- [ ] Custom domain flow returns correct DNS instructions and verifies.
- [ ] All new code is typed (no `any`), passes `tsc --strict` and lint.
- [ ] Teardown fully removes the Vercel project and its domains.

## Out of scope (do not build now)
- Provisioning per-store databases or Stripe accounts (env vars are inputs).
- Usage-based billing enforcement (leave the extension point only).
- GDPR sub-processor docs / DPA (handled outside code).
