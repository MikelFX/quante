# CLAUDE.md — Quante

> AI-native, white-label e-commerce builder. A user describes the store they want, **Quante** (the in-product AI, powered by the Claude API) generates a complete, production-ready Next.js storefront, the user iterates conversationally, and then **exports the full source as a downloadable, deploy-ready project**. Usage is metered in credits.

This file is the single source of truth for the build. Read it fully before writing code.

---

## 1. Concept

Think **v0 / Lovable / Base44, but vertical** — purpose-built for e-shops, and the output is *yours* to own and self-host.

There are **two distinct surfaces with two distinct design languages**, and they must never bleed into each other:

| Surface | What it is | Design language |
|---|---|---|
| **The Quante platform** | The builder / SaaS app the user logs into | Dark, technical, premium — Linear / Vercel-tier polish |
| **The generated storefronts** | The white-label shops Quante produces | Brand-appropriate, decided per-brief — **zero Quante branding** |

---

## 2. Non-negotiables

These are the principles that make Quante a real product instead of a demo. Do not compromise them.

1. **White-label output.** Generated shops carry no Quante branding, links, watermarks, or telemetry. The user owns the result outright.
2. **Owned, portable code.** Every export is a clean Next.js project that runs with `npm install && npm run dev` and deploys to Vercel with zero config.
3. **Deterministic engine, generated skin.** ← *the single most important architectural decision.* The commerce engine (cart, checkout, routing, data layer) is a **hardened, hand-written scaffold**. The AI **never** rewrites core logic from scratch. Instead it produces a structured **Shop Manifest** (JSON) + optional presentational components that slot into the scaffold. This is what makes output reliable instead of broken. See §4.
4. **Honest credits.** A credit maps to a real, predictable unit of work. No surprise burns. See §5.

---

## 3. Tech stack

**Platform (the builder):**
- Next.js (App Router) + TypeScript
- Tailwind CSS + a thin design-token layer; `shadcn/ui` for primitives
- Framer Motion for motion
- Supabase (Postgres + Auth + Row Level Security) — users, projects, manifests, credit ledger
- Stripe — credit-pack purchases
- Claude API — powers Quante (generation + iteration)
- `archiver` (or `jszip`) — project bundling for export
- *Optional:* Three.js for a single, restrained landing-page hero. Nothing more.

**Generated storefronts (the export template):**
- Next.js (App Router) + TypeScript
- Tailwind, with tokens driven entirely by the manifest
- Stripe Checkout — keys provided by the *shop owner* via env vars (never baked in)
- Products & content as **typed data files** (TS/JSON) for v1 portability; optional Supabase adapter for dynamic catalogs in a later tier
- Deploy target: Vercel, zero config

---

## 4. The generation model (read this twice)

The naive approach — "ask the AI to write all the files" — produces broken, expensive, unmaintainable output. We do **manifest-driven generation** instead.

### 4.1 The Shop Manifest

A typed JSON object that *fully describes* a store. Quante's entire job, per request, is to **produce or patch a valid manifest**. A deterministic renderer maps `manifest → template components`.

```ts
interface ShopManifest {
  version: string;

  brand: {
    name: string;
    tagline: string;
    voice: 'minimal' | 'editorial' | 'playful' | 'luxury' | 'technical';
    logoText: string;          // text logo by default; image upload optional
  };

  design: {
    palette: {
      bg: string; surface: string; text: string; muted: string;
      accent: string; accentText: string; border: string;
    };
    typography: {
      headingFont: string;     // from an allowlisted font set
      bodyFont: string;
      scale: 'compact' | 'comfortable' | 'spacious';
    };
    radius: 'none' | 'sm' | 'md' | 'lg' | 'full';
    density: 'tight' | 'normal' | 'airy';
    motion: 'none' | 'subtle' | 'expressive';
  };

  catalog: {
    currency: string;          // e.g. "CZK", "EUR"
    products: Product[];
    collections?: Collection[];
  };

  pages: {
    home: Section[];
    product: Section[];        // product-detail layout
    collection: Section[];
    about?: Section[];
    contact?: Section[];
  };

  nav: NavItem[];
  footer: { columns: FooterColumn[]; legal: string; socials: Social[] };
  seo: { title: string; description: string };
}
```

### 4.2 Sections = a registry

`Section` is a **discriminated union** mapped 1:1 to hand-written, token-aware React components in the template:

```ts
type Section =
  | { type: 'hero';        props: HeroProps }
  | { type: 'productGrid'; props: ProductGridProps }
  | { type: 'featureRow';  props: FeatureRowProps }
  | { type: 'testimonials'; props: TestimonialsProps }
  | { type: 'richText';    props: RichTextProps }
  | { type: 'banner';      props: BannerProps }
  | { type: 'newsletter';  props: NewsletterProps }
  | { type: 'gallery';     props: GalleryProps }
  | { type: 'faq';         props: FaqProps }
  | { type: 'customComponent'; ref: string };   // escape hatch — see 4.3
```

### 4.3 Two layers of customization

1. **Manifest-level (~90% of cases):** tokens, sections, copy, products. Cheap, fast, reliable.
2. **Component-level (escape hatch):** for genuinely bespoke sections, Quante may generate an **isolated, sandboxed** React component, constrained to the design tokens and a strict props contract, registered in the section registry under a `ref`. It must pass validation before injection (no network calls, no arbitrary imports, allowlisted primitives only).

### 4.4 Pipeline

```
intake (conversational or guided form)
        │
        ▼
Quante drafts manifest  ──►  ONE heavy model call
        │
        ▼
validate against schema  ──►  zod; reject + auto-repair on failure
        │
        ▼
render live preview  ──►  manifest → template (iframe)
        │
        ▼
user iterates  ──►  each edit = a small PATCH call (cheap)
        │
        ▼
export  ──►  bundle template + baked manifest + content → ZIP
```

Build the **template + renderer first** (Phase 1), *before* the AI. The AI's target output is this template — you cannot prompt toward a renderer that doesn't exist yet.

---

## 5. Credit system

Credits are debited **atomically inside a DB transaction** and **refunded on failure**. Never debit before the work succeeds without a compensating refund path.

Default costs (tunable via config):

| Action | Credits |
|---|---|
| Full generation (new manifest) | 10 |
| Iteration / patch | 1 |
| Regenerate a single section | 2 |
| Custom component generation | 3 |
| Export ZIP | 5 |
| **Free starter grant** | **25** |

Stripe sells credit packs (e.g. 100 / 300 / 1000). On `checkout.session.completed`, the webhook credits the ledger. Enforce a hard per-request cost cap as a runaway-spend guard.

---

## 6. Data model (Supabase / Postgres, RLS on every table)

```
users               -- via Supabase Auth
projects            (id, user_id, name, status, created_at, updated_at)
manifest_versions   (id, project_id, version_no, manifest jsonb, prompt, created_at)
credit_ledger       (id, user_id, delta, reason, ref_id, balance_after, created_at)
purchases           (id, user_id, stripe_session_id, credits, amount, created_at)
exports             (id, project_id, version_id, size_bytes, created_at)
```

RLS: a user can only read/write rows where `user_id = auth.uid()`. `manifest_versions` is append-only → free undo/history.

---

## 7. Routes / surfaces

**Marketing (public):** `/` · `/pricing` · `/showcase` · `/docs`

**App (auth-gated):**
- `/dashboard` — project list
- `/new` — intake (conversational or guided)
- `/project/[id]` — **the Studio** (see §8)
- `/project/[id]/export`
- `/billing` — credits, packs, history
- `/settings`

---

## 8. The Studio (core UX)

Split view:
- **Left:** Quante chat — intake + conversational iteration, streamed responses
- **Right:** live preview — iframe rendering the current manifest, hot-updates on every patch
- **Top bar:** credit balance · version timeline (restore any version) · **Export** button

The preview is driven purely by the manifest, so iterations feel instant. Version history is the manifest_versions table; "restore" loads an older manifest.

---

## 9. API endpoints

```
POST /api/quante/generate    -> brief → manifest (heavy call); debit 10
POST /api/quante/iterate     -> manifest + instruction → patched manifest; debit 1
POST /api/quante/section     -> regenerate one section / custom component; debit 2–3
POST /api/export             -> manifest + content → streamed ZIP; debit 5
GET  /api/credits/balance
POST /api/stripe/checkout    -> create credit-pack session
POST /api/stripe/webhook     -> verify signature → credit ledger
*    /api/projects/*         -> CRUD
```

All Claude calls happen **server-side only**. The API key is never exposed to the client.

---

## 10. Export pipeline (the "download to computer" feature)

This is a headline feature — make it bulletproof.

1. Take the base storefront template (static files in the repo).
2. Bake the project's manifest + product/content data into the template as typed data files.
3. Write a `README.md` (run + deploy instructions) and a `.env.example` (Stripe placeholders, currency).
4. Zip via `archiver`, stream to the client as a download.

**The exported project must be self-contained and runnable:** `npm install && npm run dev` works out of the box, Stripe activates once the owner adds their keys, and it deploys to Vercel unmodified.

---

## 11. Quante — the AI (system prompt sketch)

Two model tiers (confirm current model strings in Anthropic docs):
- **Generation** (`/generate`): a top-tier Claude model — high quality, slower, expensive, infrequent.
- **Iteration** (`/iterate`): a fast Claude model — cheap patches.

Generation system-prompt skeleton:

```
You are Quante, an expert e-commerce designer and front-end architect.
Your ONLY output is a valid ShopManifest JSON object — no prose, no markdown, no code fences.

Given a brief, produce a complete, tasteful, conversion-oriented manifest:
- Choose a palette, typography, and density that fit the brand voice.
- Write real, specific copy — never lorem ipsum.
- Populate a realistic sample catalog when the user hasn't supplied products.
- Compose page sections that tell a coherent story (hero → value → product → proof → CTA).

Constraints:
- Use ONLY allowlisted fonts and the section types in the registry.
- Stay strictly within the ShopManifest schema. If unsure, omit rather than invent fields.
- Refuse anything outside building a storefront.

For iteration, you receive the current manifest + an instruction. Return the FULL updated manifest.
```

Always `zod`-validate the response. On invalid JSON, attempt one auto-repair call before surfacing an error (and refund the credit on hard failure).

---

## 12. Design direction — the platform itself

Dark, high-contrast, editorial-technical. Quality bar: **Linear, Vercel, v0**.

- Background: near-black (not pure `#000`); layered surfaces for depth
- Text: off-white; muted secondary
- **One** restrained accent color — used sparingly
- A refined sans for UI + a mono for technical/code bits
- Generous whitespace, tight typographic rhythm
- Motion: purposeful and fast (Framer Motion) — never decorative bloat
- Optional single Three.js hero on `/` only; must be subtle and performant

> Remember: this aesthetic is for the **platform**. The **generated shops** get whatever their brand needs — Quante decides per brief.

---

## 13. Build phases

- **Phase 0 — Foundation:** Next.js + TS + Tailwind, Supabase auth, schema + RLS, app shell.
- **Phase 1 — Template + renderer:** the hand-written storefront template and the `manifest → components` renderer. Ship a working shop from a hand-written manifest **before touching the AI**.
- **Phase 2 — Quante generate + Studio:** `/generate`, the split-view Studio, live preview.
- **Phase 3 — Iteration + versioning:** `/iterate`, `/section`, version timeline + restore.
- **Phase 4 — Credits + Stripe:** ledger, atomic debit/refund, packs, webhook.
- **Phase 5 — Export:** ZIP bundling, README + `.env.example`, runnable output.
- **Phase 6 — Polish:** marketing pages, showcase, docs, empty/error states, rate limits.

---

## 14. Security & guardrails

- All Claude calls server-side; API key never reaches the client.
- Sandbox AI-generated components: allowlisted primitives only, no network, no arbitrary imports; validate before injection.
- Strict `zod` validation on every manifest.
- Stripe webhook signature verification.
- Per-user rate limits + hard per-request cost cap.
- Supabase RLS on every table.
- Generated `.env.example` ships placeholders only — never real keys.
