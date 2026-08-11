# Model swap — Phase 1 findings

Task: replace **primary generation** model `claude-fable-5` → `claude-opus-5`.
Do NOT touch fallback, iteration, intake, or fix models.

## ⚠️ Critical concern — please confirm before Phase 2

Two of the model IDs currently in this repo do not resolve against the Anthropic API as of my knowledge cutoff (Jan 2026). The current Claude family shipping through `anthropic.messages.create` is 4.X:
- `claude-opus-4-7`
- `claude-sonnet-4-6`
- `claude-haiku-4-5-20251001`

The generate route hardcodes `claude-fable-5` and `claude-sonnet-5` — both are unshipped names (and the code comment on line 18–19 admits it: *"Fable 5 advertises 128k max output tokens. Unverifiable until the model ships in the SDK — if the API rejects this value, drop back to 64000."*). The target `claude-opus-5` is in the same category — I have no record of it in the SDK.

**Possible interpretations — please pick one before I start Phase 2:**
1. You have private early access / a preview model string not in public SDK — use `claude-opus-5` literally as given, accept it will 404 in envs without that access.
2. You meant the current shipping Opus and the intended string is `claude-opus-4-7`.
3. Both `claude-fable-5` and `claude-sonnet-5` (fallback) are known-invalid placeholders — swap the primary to whatever you name and I leave the fallback string alone as instructed.

I'll proceed exactly per your answer. The rest of Phase 1 below assumes you'll answer #1 or #3 (primary only becomes `claude-opus-5`, fallback stays `claude-sonnet-5`).

---

## Table of references

| File | Line | Reference | Pipeline stage | Primary gen? |
|---|---|---|---|---|
| `app/api/quante/generate/route.ts` | 11 | Comment: "raise SOFT_TIMEOUT_MS to 500_000 for Fable 5's adaptive-thinking latency" | Generation | Yes — comment |
| `app/api/quante/generate/route.ts` | 14 | `const PRIMARY_MODEL = 'claude-fable-5'` | Generation | **Yes — the one string to swap** |
| `app/api/quante/generate/route.ts` | 15 | `const FALLBACK_MODEL = 'claude-sonnet-5'` | Generation (fallback) | No — leave alone |
| `app/api/quante/generate/route.ts` | 18–19 | Comment about Fable 5 advertising 128k output | Generation | Yes — comment |
| `app/api/quante/generate/route.ts` | 127 | Comment: `// --- Primary: claude-fable-5 ---` | Generation | Yes — comment |
| `app/api/quante/generate/route.ts` | 128 | Comment mentioning fallback string | Generation (fallback) | No |
| `app/api/quante/generate/route.ts` | 132 | `let modelUsed = PRIMARY_MODEL` (var + log field) | Generation | Indirect |
| `app/api/quante/generate/route.ts` | 135, 137, 144, 145, 150, 161, 174, 176, 201 | Variables `fableStream`, `fableStreamCompleted`; string "Fable 5" in warn logs; string "Sonnet 5" in warn logs | Generation | Indirect — variable names |
| `app/api/quante/generate/route.ts` | 138 | `model: PRIMARY_MODEL` on `anthropic.messages.stream({...})` | **Generation — the actual API call** | **Yes** |
| `app/api/quante/generate/route.ts` | 187 | `// --- Fallback: claude-sonnet-5 ---` | Fallback | No |
| `app/api/quante/generate/route.ts` | 189 | `console.warn` template literal referencing both strings | Both | Indirect |
| `app/api/quante/generate/route.ts` | 191 | `modelUsed = FALLBACK_MODEL` | Fallback | No |
| `app/api/quante/generate/route.ts` | 195 | `model: FALLBACK_MODEL` on fallback `anthropic.messages.stream` | Fallback | No |
| `lib/claude.ts` | 8 | `export const GENERATION_MODEL = 'claude-sonnet-4-6'` | **Dead code / stale** — exported but nothing imports it (see below) | Independent |
| `lib/claude.ts` | 9 | `export const ITERATION_MODEL = 'claude-sonnet-4-6'` | Iteration | Leave |
| `lib/claude.ts` | 10 | `export const INTAKE_MODEL = 'claude-haiku-4-5-20251001'` | Intake | Leave |

### `messages.create` / `messages.stream` call sites (every model-consuming API call)

| Route | Line | Model reference | Stage |
|---|---|---|---|
| `app/api/quante/generate/route.ts` | 137 (`.stream`) | `PRIMARY_MODEL` | **Primary generation** |
| `app/api/quante/generate/route.ts` | 194 (`.stream`) | `FALLBACK_MODEL` | Generation fallback |
| `app/api/quante/iterate/route.ts` | 129 | `ITERATION_MODEL` | Iteration |
| `app/api/quante/section/route.ts` | 102 | `ITERATION_MODEL` | Section regen |
| `app/api/quante/custom-component/route.ts` | 100 | `ITERATION_MODEL` | Custom component |
| `app/api/quante/fix/route.ts` | 94 | `ITERATION_MODEL` | Self-healing fix (⚠ not a dedicated fix model — uses ITERATION_MODEL) |
| `app/api/quante/intake/route.ts` | 49 | `INTAKE_MODEL` | Intake |
| `app/api/quante/image-suggest/route.ts` | 64 | `ITERATION_MODEL` | Aux |
| `app/api/quante/vision/route.ts` | 104 | `ITERATION_MODEL` | Aux (vision) |
| `app/api/projects/[id]/insights/route.ts` | 138 | `INTAKE_MODEL` | Analytics |
| `app/api/webhooks/vercel-deploy/route.ts` | 145 | `INTAKE_MODEL` | Changelog draft |

### Env var references (`*MODEL*`)

Zero. No file reads `process.env.*MODEL*`. Model IDs are 100% hardcoded today.
`.env.local.example` contains no `GENERATION_MODEL`, `ITERATION_MODEL`, or similar entry.

### Type unions / config objects listing allowed models

None. There is no `AllowedModel` type, no model registry, and no runtime validation of model strings anywhere in the codebase.

### DB / logs / changelog references

- **DB:** No `code_versions` or `deployments` column stores the model name. `modelUsed` is captured only in a `console.warn` line (route.ts:224). Nothing persists.
- **Logs:** `[generate] model_used=${modelUsed}` — the only structured log line.
- **Changelog DB (`changelog_entries`):** no model-name column; nothing to update.
- **`docs/changelog-findings.md`, `docs/update-log.md`, `docs/business-roadmap.md`:** grep for `fable` — no matches; safe.

### UI strings / marketing / user-facing docs

- `QuanteCode/API Routes — reference.md` line 14 — "Fable 5" in a table cell (docs).
- `QuanteCode/AI modely a prompty.md` line 13 — "Fable 5" description.
- `QuanteCode/Claude Code Workflow.md` line 32 — Claude Code workflow reference (Anthropic tooling context, not the runtime store-gen model — likely unrelated to this swap, please confirm).
- `QuanteCode/Feature Map — aktuální stav.md` line 9 — "Audit Claude Code (Fable 5)".
- `QuanteCode/Tech Stack.md` line 18 — Tech stack table.
- `QuanteCode/Unit Economics.md` line 13 — cost row per generation.
- `QuanteCode/Vize a filozofie.md` line 28 — philosophy note.
- `ClaudeInfoQuante.md` line 730 — describes the *current* state as `claude-sonnet-4-6` (**already stale vs. the actual code in `generate/route.ts`** — the doc says Sonnet, the code says Fable).

No customer-facing UI copy (no matches in `app/**`, `components/**`) references the model by name.

---

## Phase 3 preview (things I will need to confirm, not change yet)

1. **`max_tokens = 128000`** on both primary and fallback streams (route.ts:20). Tuned for a hypothetical Fable 5 128k output ceiling. If `claude-opus-5` doesn't actually accept 128k, the API will 400 immediately. Flag — will not silently change.
2. **`cache_control: { type: 'ephemeral' }`** breakpoint sits on the system prompt (route.ts:139, 196). Cached prefix = `SYSTEM_PROMPT_CODE_GENERATION` (large, static, well-suited for caching). No model-specific logic — still valid.
3. **`SOFT_TIMEOUT_MS = 240_000`** — sized for Vercel's 300s hard cap minus 60s for DB/deploy. Not tuned to Fable specifically; the comment about raising to 500_000 assumes an Enterprise plan bump. Report only — do not touch.
4. **No `if (model === '...')` branches** exist anywhere. Zero conditional logic on model name. Nothing dangling.
5. **No per-model credit rate table.** `GENERATE_COST = 10` is a single constant (route.ts:16). Cost is flat regardless of model. Nothing to update on cost, but flag: switching primary to a more expensive model doesn't currently propagate to price.
6. **Dead export:** `lib/claude.ts:8` exports `GENERATION_MODEL = 'claude-sonnet-4-6'` but no file imports it (only ITERATION_MODEL and INTAKE_MODEL are imported anywhere). Phase 2 centralisation should reclaim this symbol as the source of truth and delete the local `PRIMARY_MODEL` const.

---

## Proposed Phase 2 plan (do not execute until you confirm)

1. In `lib/claude.ts`, extend the model exports to a single object and read primary from env:
   ```ts
   export const MODELS = {
     generation: process.env.GENERATION_MODEL ?? 'claude-opus-5',
     fallback:   'claude-sonnet-5',                  // unchanged
     iteration:  'claude-sonnet-4-6',                // unchanged
     intake:     'claude-haiku-4-5-20251001',        // unchanged
     fix:        'claude-sonnet-4-6',                // = iteration today; keep alias
   } as const
   ```
   Keep the existing named exports as aliases (`GENERATION_MODEL`, `ITERATION_MODEL`, `INTAKE_MODEL`) so nothing else breaks.
2. In `app/api/quante/generate/route.ts`:
   - Delete `PRIMARY_MODEL` / `FALLBACK_MODEL` local constants.
   - Import `MODELS` from `@/lib/claude`.
   - Rename local variables `fableStream*` → `primaryStream*` (removes stale name; not a behaviour change).
   - Update the two comment blocks that say "Fable 5" / "Sonnet 5".
3. Append to `.env.local.example`:
   ```
   # Primary storefront-generation model. Falls back to claude-sonnet-5 on refusal/error.
   # Valid values: any Anthropic model ID (e.g. claude-opus-5, claude-opus-4-7).
   GENERATION_MODEL=claude-opus-5
   ```
4. Docs edits deferred — ask before touching `QuanteCode/*.md` and `ClaudeInfoQuante.md`, since they read like curated user notes rather than generated docs.

---

**Waiting on your answer to the 3 interpretations at the top before I edit anything.**
