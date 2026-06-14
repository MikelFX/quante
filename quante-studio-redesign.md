# Quante — Studio, Admin & Settings Redesign

> A complete UI/UX rebuild brief for the **logged-in app surfaces**. Hand this to Claude Code as the spec. The marketing landing is separate — this covers everything behind auth: the Studio editor, the generated-store Admin, Billing, and Settings.

---

## 0. Why this redo

Three problems with the current build, and what we fix:

1. **The IA is confusing.** Builder, "Admin", and account-level nav (Projects/Billing/Settings) are tangled together, and there's a mobile bottom-tab bar shown on desktop. → We define **three clearly separated contexts** and give desktop a proper shell.
2. **The design isn't premium.** Flat black, generic spacing, no depth. → A real **dark design system** that matches the cinematic landing (layered surfaces, soft bloom, refined type, restrained motion).
3. **The AI is unreliable and opaque** — "it often doesn't do what I asked." → **Manifest-patch architecture + transparent change summaries + direct-manipulation controls** so users aren't forced to fight the chat for everything, and when the AI does act, you can *see* and *undo* exactly what it did.

**North star:** the Studio is **chat-first but not chat-only**. Talking to Quante is the primary way to build, but every common edit (theme, sections, products) also has a direct control — because the fastest way to fix "the AI won't make the accent green" is a color picker.

---

## 1. Information architecture (the foundational fix)

Three contexts. Never mix them in one nav.

```
QUANTE (logged in)
│
├── APP SHELL  ......... account-level, persistent left sidebar (desktop)
│   ├── Projects        list of stores you're building
│   ├── New project     the brief → generate flow
│   ├── Billing         credits, packs, history
│   └── Settings        account, security, danger zone
│
├── STUDIO  ............ build ONE project (entered from a project card)
│   ├── Chat            talk to Quante  (default)
│   ├── Sections        page structure, direct edit
│   ├── Products        catalog, direct edit
│   ├── Theme           design tokens, direct edit
│   └── Publish         checklist · domain · Stripe · merchant data · export · deploy
│
└── STORE ADMIN  ....... run the LIVE generated store (separate context)
    ├── Dashboard       revenue, orders, status
    ├── Orders
    ├── Products        inventory as a merchant
    ├── Customers
    └── Settings        Stripe, domain, store info
```

**Studio ↔ Store Admin** is a deliberate context switch (you're *building* vs *running* the store), toggled in the top bar (the current Builder/Admin toggle — keep it, but make the two contexts visually distinct so you always know where you are). **Kill the desktop bottom-tab bar**; it returns only on mobile.

---

## 2. Design system

One token layer, used everywhere. Matches the landing.

**Color**
- Surfaces, layered for depth (not one flat black): `bg #08080a` → `surface-1 #0d0d11` → `surface-2 #121218` → `surface-3 #18181f`. Elevation = lighter surface + hairline border, **not** heavy drop shadows.
- Text: `fg #f4f4f6`, `muted #8a8a93`, `dim #5b5b64`.
- Accent (indigo): `#6f78e6`, used sparingly for primary actions, focus, active nav.
- Semantic: `live/success #3ecf8e`, `warning #e0a04f`, `danger #e0564f`.
- Hairlines: `rgba(255,255,255,.07)` / hover `.13`.

**Elevation / bloom.** Premium depth comes from a faint accent bloom behind key surfaces (soft radial gradient, very low opacity) + the surface step + hairline — never large black shadows. Reuse the landing's bloom language.

**Typography**
- Display / headings: tight grotesk (Inter or similar), weight 600–700, letter-spacing −0.02 to −0.035em.
- Labels / eyebrows / numbers / code: mono (`ui-monospace, JetBrains Mono`), often the smallest text, lowercase or small caps.
- Body: sans, 14–15px, line-height 1.55.
- Minimum font size 11px.

**Spacing & shape.** 4px base scale. Radius: inputs/buttons 8–10px, cards/panels 12–16px. Generous padding; let surfaces breathe.

**Motion.** Fast and purposeful. Panel/route transitions 200–280ms `cubic-bezier(.2,.8,.2,1)`. Framer Motion. Respect `prefers-reduced-motion` everywhere.

**Primitives (build on shadcn/ui, themed to the above):**
`Button` (primary / secondary / ghost / danger), `Input`, `Textarea`, `Select`, `SegmentedControl`, `Card`/`Panel`, `Badge`/`Pill`, `Tooltip`, `Toast`, `Dialog`, `Sheet` (side drawer), `Skeleton`, `EmptyState`, `Table`, `CommandPalette` (⌘K). Every interactive element gets a visible focus ring (accent).

---

## 3. App shell

```
┌──────┬────────────────────────────────────────────────────────┐
│ ▣ q  │                                                        │
│      │                                                        │
│ ▢ Pro│                                                        │
│ ＋ New│                  CONTENT AREA                          │
│ ▭ Bil│              (Projects / Billing / Settings)           │
│ ⚙ Set│                                                        │
│      │                                                        │
│──────│                                                        │
│ ● 998│   ← credit pill                                        │
│ ◐ M  │   ← account menu (avatar)                              │
└──────┴────────────────────────────────────────────────────────┘
```

Collapsible left sidebar (icon + label, collapses to icons). Logo top, nav middle, **credit pill + account menu** pinned bottom. Active item: accent text + subtle surface highlight. This replaces the desktop bottom bar. On mobile, sidebar becomes a bottom tab bar.

---

## 4. The Studio (the core — get this right)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ◀ Projects / Drift Surf Co.    [ Builder | Admin ]   v10 ▾   ● 998   ⌘K   │
│                                              [ Export ▾ ]  [ ● Live ↗ ]    │
├────┬───────────────────────────────────┬──────────────────────────────────┤
│ 💬 │                                   │  ◧ desktop  ▢ tablet  ▯ mobile  ⟳ ↗│
│ ▤  │   ACTIVE PANEL                    │ ┌──────────────────────────────┐  │
│ ▦  │   (Chat / Sections / Products /   │ │                              │  │
│ ◑  │    Theme / Publish)               │ │      LIVE PREVIEW            │  │
│ ⬆  │                                   │ │   renders from the manifest  │  │
│    │                                   │ │   — always visible, hot-     │  │
│    │                                   │ │   reloads on every change    │  │
│    │                                   │ │                              │  │
│    │                                   │ └──────────────────────────────┘  │
│    │                                   │  saltline.vercel.app · viewing v10 │
└────┴───────────────────────────────────┴──────────────────────────────────┘
 mode rail (icons): 💬 Chat · ▤ Sections · ▦ Products · ◑ Theme · ⬆ Publish
```

Three zones: **top bar**, **left mode-rail** (icons, tooltips), **center active panel**, **right live preview (always on)**. The preview never disappears — it's the whole point.

### 4.1 Top bar
- Breadcrumb `◀ Projects / {store name}`.
- **Builder | Admin** segmented toggle (context switch to Store Admin).
- **Version selector `v10 ▾`** — first-class. Click → version timeline panel (each: `vN`, the prompt that made it, relative time, **Restore**, **View diff**). The current build buries this; surface it.
- Credit pill `● 998`.
- `⌘K` command palette hint.
- `Export ▾` (ZIP / ZIP+Admin) and `● Live ↗` status (green when deployed, links to the live URL; shows "Publish" when not yet live).

### 4.2 Chat mode (default) — and how we make AI edits reliable

The chat is the hero surface. **Move every Export / Subscribe / Live CTA OUT of the chat** (they belong in Publish). The chat is just: conversation + input + change summaries.

```
Quante: Store loaded. What would you like to change?

You: make the accent deep green and shorten the hero headline

┌─ Quante applied a change ──────────────────────────┐
│ ✓ Accent  #2f6f4f                                   │
│ ✓ Hero headline → "Built for salt & sun"            │
│ Undo   ·   View diff                                │
└─────────────────────────────────────────────────────┘

[ Describe a change…                              → ]   1 credit
chips:  Palette   Typography   Hero   Add section
```

**The reliability model (this is the fix for "it doesn't do what I asked"):**

1. Every instruction → `POST /api/quante/iterate` with `{ manifest, instruction }`.
2. The model returns a **structured patch or the full updated manifest as strict JSON** — never freeform prose, never raw code. Constrain it hard with the manifest schema + few-shot examples in the system prompt.
3. **`zod`-validate** the response. Invalid → one auto-repair attempt → if still invalid, tell the user it couldn't apply and **don't debit the credit**.
4. Apply the patch → preview **hot-reloads from the manifest** (optimistic, instant).
5. **Render a change summary**: a plain-language list of exactly what changed, each with an **Undo** and **View diff**. This makes silent failures impossible — if Quante misunderstood, the user sees it immediately and reverts in one click.
6. If the instruction maps to nothing the schema supports, Quante says so explicitly ("I can change palette, copy, sections, products, layout — that one's outside what I can edit") instead of pretending and burning a credit.

Streaming responses. Quick-suggestion chips that prefill common edits. A small credit-cost hint on the send button.

### 4.3 Sections mode
Reorderable list of the page's sections (drag handle). Each row: **name · tiny live thumbnail · visibility toggle · Edit · Ask AI**.
- **Edit** opens an inline/side-sheet form for that section's props (heading, copy, layout variant, etc.) — direct manipulation, no chat needed.
- **Ask AI** opens chat prefilled with "In the {Hero} section, …".
- **+ Add section** → picker of section types (hero, product grid, feature row, testimonials, rich text, banner, gallery, faq, newsletter).
This replaces today's cramped Edit/AI button pairs.

### 4.4 Products mode
Clean list/table. **+ Add product** and row Edit open a **side sheet** (name, price, currency, images, description, availability). Bulk select/delete. No more tiny Edit/Del buttons crammed in a black rail.

### 4.5 Theme mode
Direct controls for the manifest's `design` tokens, with the live preview reacting instantly:
- **Palette** (bg/surface/text/accent — swatches + hex).
- **Typography** (heading + body font from an allowlist, scale: compact/comfortable/spacious).
- **Density**, **radius**, **motion** intensity.
This is the single biggest "AI won't do what I want" reliever — design changes become a click, not a negotiation.

### 4.6 Publish mode
Consolidates today's scattered Hosting + Merchant + Export into one clear flow:
- **Pre-publish checklist** (the "PŘED PUBLIKACÍ SPLŇTE" items) with pass/fail states and a link to fix each.
- **Merchant / company data** (IČO, DIČ via ARES lookup, address, contact, bank/Stripe) — required for legal pages + payments.
- **Domain** (Vercel subdomain + custom domain connect).
- **Stripe keys** (the store owner's, via env — never Quante's).
- **Export** (ZIP / ZIP + Admin) and **Deploy** with clear status + the live URL.

### 4.7 Right preview pane
Always visible. **Device toggle** (desktop / tablet / mobile) resizing the frame, **refresh**, **open in new tab**, the **live URL**, and a **"viewing vN"** label. During a regenerate, show a **shimmer/skeleton** over the frame, not a blank.

### 4.8 Power-user layer
- **⌘K command palette**: jump to a section, switch mode, run "export", "restore v9", "add testimonials section".
- **Autosave** to Supabase with a save-state indicator; keyboard shortcuts; reversible everything (version table is the undo backbone).

---

## 5. Store Admin (run the live store)

Entered via the **Admin** toggle. Visually distinct from the Studio so the context switch is obvious (e.g. a slightly different accent or header treatment). Standard merchant admin, redesigned:

- **Sidebar:** Dashboard · Orders · Products · Customers · Settings.
- **Dashboard:** metric cards (Revenue, Orders, Products, Sessions) with proper **empty states** ("No orders yet — share your store to make your first sale" instead of a bare "—"), a **store-live** banner with the URL + Visit, **hosting status** (trial days left → upgrade), and quick-action tiles.
- **Orders:** filterable table (status, date, total, customer), row → order detail.
- **Products:** inventory management (stock, price, visibility) — distinct from the Studio's catalog-design view.
- **Settings:** Stripe, domain, store info, legal pages.

---

## 6. Billing

```
CREDIT BALANCE                        ┌ this period ─────────┐
998  credits remaining                │ ▁▂▅▃▆  −37 used      │
                                      └──────────────────────┘

Buy credits   ┌ 100 €9.99 ┐ ┌ 300 €24.99  POPULAR ┐ ┌ 1000 €69.99 ┐
What costs what   (table: full gen 10 · iterate 1 · section 2 · component 3 · export 5)
History           (table: action · amount · balance · when)
```

Balance hero with a small **usage sparkline**, three buy-packs (popular highlighted), the cost table, and a transaction history table. Clean surfaces, mono for numbers.

---

## 7. Settings (account)

Cards: **Account** (email, user id, member since) · **Credits** (balance + Buy) · **Security / Sign out** · **Danger zone** (delete account, with a confirm dialog). Proper spacing and hierarchy — the current version is functional but flat.

---

## 8. New project

The brief is where "the AI gets me" starts. Keep the big textarea + examples + `Generate (10 credits)`, and **add an optional guided mode**: chips for industry / vibe / palette / currency that assemble into a brief for users who don't know what to type. Reduces bad first generations at the source.

---

## 9. States (do not skip)

For every surface: **loading** (skeletons, never spinners-on-blank), **empty** (helpful, with a next action), **error** (what happened + retry), **generating** (preview shimmer + progress), **insufficient credits** (inline prompt to buy — never a silent failure), **offline**.

---

## 10. Responsive

Desktop-first (it's a builder). Tablet: preview collapses to a toggle button, mode-rail stays. Mobile: stacked, global nav becomes the bottom tab bar, the Studio is full-screen with a preview toggle and the mode-rail as a top segmented control.

---

## 11. Implementation notes

- Next.js (App Router) + TypeScript, Tailwind, shadcn/ui themed to the tokens above, Framer Motion for panel/route transitions.
- **The manifest is the single source of truth.** The preview renders purely from it; every edit (chat or direct control) mutates the manifest; autosave persists it; the version table snapshots it.
- `iterate` / `generate` run **server-side** (Claude API), return **strict JSON**, are **`zod`-validated**, **stream**, and **never debit on failure**.
- Optimistic preview updates; reconcile on server confirm.
- Versions = append-only Supabase table → powers timeline + restore + undo.

---

## 12. Build order

- **A — Foundation:** design system (tokens + primitives) + app shell + routing. Kill the desktop bottom bar.
- **B — Studio frame:** the 3-pane layout + live preview rendering from a manifest.
- **C — Chat + reliability:** `iterate` endpoint, strict-JSON + zod + auto-repair + no-debit-on-fail, streaming, **change summaries with Undo/diff**. (This is the priority — it's the #1 complaint.)
- **D — Direct manipulation:** Sections, Products, Theme modes.
- **E — Publish:** checklist · merchant data · domain · Stripe · export · deploy.
- **F — Store Admin:** dashboard + orders + products + settings, with empty states.
- **G — Account surfaces:** Billing, Settings, New project (with guided mode).
- **H — Polish:** all states, ⌘K, responsive, motion pass.

Ship A→C first; that alone fixes the worst of the current experience (premium shell + a Studio where the AI is reliable and transparent).
