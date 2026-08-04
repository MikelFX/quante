# Changelog — Fáze 1 zjištění

Spuštěno: `npx tsx scripts/check-changelog.ts` z lokálního prostředí (`.env.local`), 2026-08-03.

## Výstup skriptu (lokálně)

| Kontrola | Výsledek |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ `https://zclkvejbtvdstgltfbgm.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ platný JWT s `role=service_role` |
| `ADMIN_EMAILS` | ✅ `luxur.asr@gmail.com` (1 položka) |
| Tabulka `changelog_entries` | ✅ **existuje, 6 řádků** — seed z migrace proběhl |
| Nejnovější 3 řádky | 2026-07-05, 2026-07-04, 2026-06-28 (odpovídají JSON fallbacku) |
| RLS test (anon) | ✅ vrací 0 řádků — RLS blokuje, jak má |

**Závěr lokální diagnostiky:** databázová vrstva funguje. Tabulka je, seed je, service role klíč je platný, RLS správně blokuje anon. Když aplikace čte přes `supabaseAdmin`, dostane všech 6 řádků.

---

## Kde tedy problém je

Skript pokrývá jen věci, které dokážu ověřit z tvého lokálu. Zbývají tři možné zdroje selhání a jeden **jistý** viník viditelného chování:

### 🔴 Jistý bug (nezávisle na produkci) — ISR cache bez revalidace

`app/(marketing)/changelog/page.tsx:8` má `export const revalidate = 300`. Po nasazení se stránka vyrenderuje jednou, pak se drží 5 minut. Když v `/admin` publikuješ nový záznam:

- API zapíše řádek do DB ✅
- `ChangelogAdmin` zavolá `router.refresh()` → obnoví se **admin route**, kde nový řádek uvidíš ✅
- `/changelog` nikdo neinvaliduje → 5 minut zobrazuje **starou verzi bez tvého záznamu** ❌

To přesně odpovídá tvému popisu „přidané záznamy se na veřejné stránce neobjeví". Ono se objeví, jen se čeká až 5 minut a na Vercelu se ISR cache může držet i déle, když stránka není často navštěvovaná. Fix je 2.2 (`revalidatePath('/changelog')` v POST/DELETE).

### 🟡 Podezření #1 — ADMIN_EMAILS na Vercelu

Skript vidí lokální hodnotu `luxur.asr@gmail.com`. Musíš potvrdit **v Vercel dashboardu** (Project → Settings → Environment Variables → `ADMIN_EMAILS` pro Production a Preview), že:

1. Proměnná tam vůbec je (v `.env.local` je, ale to na Vercel nemá vliv).
2. Obsahuje **přesně ten email**, kterým se přihlašuješ do Clerk v produkci (musí sedět case-insensitive).

Pokud tam není, ani nekliknutí na Publish neuspěje — vrátí 403 z API a v UI se zobrazí „Failed to save entry" (odpovídá scénáři „neuloží se vůbec a nikde není vidět proč"). Server log to logne, klient ne.

**Jak si to ověříš:** otevři devtools → Network → publikuj cokoli → podívej se na `POST /api/admin/changelog`. 403 = ADMIN_EMAILS na Vercelu chybí nebo má jiný email. 500 = něco jiného. 200 = zápis prošel, viník je ISR cache (viz výše).

### 🟡 Podezření #2 — SUPABASE_SERVICE_ROLE_KEY na Vercelu

Stejná logika: v `.env.local` je, ale to Vercelu nepomůže. Když na Vercelu chybí, `supabaseAdmin` fallbackne na `'placeholder'` klíč, každý dotaz selže, ale v `app/(marketing)/changelog/page.tsx:66` se **error zahazuje**, `data` je `null` → tichý fallback na `content/changelog.json` → stránka vypadá funkčně a ukazuje statickou verzi bez tvých nových záznamů. Přesně jako to popisuješ.

**Jak si to ověříš:** v Vercel dashboardu zkontroluj, že `SUPABASE_SERVICE_ROLE_KEY` je nastavená pro Production, a že to je **service_role** klíč, ne anon.

### 🟢 Vyloučeno

- Tabulka existuje.
- Seed proběhl.
- RLS funguje správně (blokuje anon, service role prochází).
- Supabase je jen jeden projekt (`zclkvejbtvdstgltfbgm`) — takže lokál i produkce sdílí stejnou DB. Data z Fáze 1 uvidí i produkce.

---

## Co potřebuji od tebe, než pustím Fázi 2

1. Zkus v produkci publikovat záznam a v devtools Network zachyť response code z `POST /api/admin/changelog`. Napiš mi ho.
2. Pokud je response 200 (úspěch), ale záznam se neobjeví na `/changelog` do minuty → hlavní viník je ISR cache. Fáze 2.2 to opraví.
3. Pokud je 403 → chybí/špatné `ADMIN_EMAILS` na Vercelu.
4. Pokud je 500 → chybí `SUPABASE_SERVICE_ROLE_KEY` na Vercelu, nebo DB volání selhalo. Pošli mi response body.

Fáze 2 opravuje bugy nezávisle na tom, který z těchto tří vyhraje — ale abych věděl, který z nich musíš doopravdy vyřešit v Vercelu (a ne v kódu), potřebuji odpověď na (1). Fixy v kódu jsou hotové zítra, špatná env proměnná v konzoli za 30 vteřin.
