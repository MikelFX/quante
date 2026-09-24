# Quante — souhrnný TODO list (stav k 2026-08-28, doplněno 2026-09-24)

---

## 🔐 Security audit 2026-09 — owner actions (doplněno 2026-09-24)

Kompletní bezpečnostní audit + 4 kola oprav (detail v `docs/update-log.md`, záznam 2026-09-23 – 09-24). Kód je hotový, `tsc` čistý, 212/212 testů, `next build` prochází. **Všech 19 migrací je spuštěných v produkci a ověřených (2026-09-24).**

**Musí se udělat, jinak to na produkci neběží:**
- [ ] **Commit + deploy** nového kódu (zatím necommitnuto na větvi `theme-green-accent`).
- [ ] **Vercel env vars:** `CRON_SECRET` (bez něj všechny crony vrací 401), `NEXT_PUBLIC_APP_URL` (https — bez něj checkout/e-maily fail closed), `VERCEL_TOKEN`, `HIGGSFIELD_WEBHOOK_SECRET`, `SECRETS_ENCRYPTION_KEY`.
- [ ] **Stripe dashboard → webhook:** přidat eventy `invoice.paid`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`; odebrat `account.updated` (Stripe Connect routy jsou smazané).
- [ ] **Clerk:** přepnout produkci z development instance (`pk_test_`) na production; v Restrictions zapnout blokování e-mailových subadres (`+tag`) a jednorázových domén.
- [ ] **Po deployi přenasadit všechny hostované obchody** (nový scaffold: klíč posílaný serverem, sandbox komponent, success stránka bez bankovních údajů v URL). Až v logu nebudou řádky `[store/checkout] keyless legacy checkout`, nastavit `STORE_CHECKOUT_REQUIRE_KEY=true`.
- [ ] **Jeden testovací deploy obchodu:** ověřit, že Vercel API přijme nastavení store projektů (`npm install --ignore-scripts`, `oidcTokenConfig.enabled=false`, `ssoProtection: null`).
- [ ] **Úklid lokálně:** smazat probe skripty v kořeni repa (`__probe_tmp.mjs`, `__test-iterate-image-tmp.mjs`, `extract-scaffold-tmp.mts`, `_audit-*.mjs`) — některé používají service-role klíč; vypnout Obsidian plugin *Local REST API* (vystavuje složku včetně `.env.local`).
- [ ] **Data:** projít kontrolní dotazy v `supabase/migration-security-foundation.sql` (projekty sdílející jeden Vercel projekt, nejednoznačné `store_slug`); v adminu přezkoumat marketplace komponenty, které byly dřív auto-listed.

**Byznysová rozhodnutí (v kódu je bezpečný default):**
- [ ] Peníze za objednávky v obchodech jdou přes Stripe účet Quante → zvážit Stripe Connect destination charges (peníze rovnou obchodníkovi).
- [ ] Agency = hosting zdarma pro všechny jejich obchody — potvrdit.
- [ ] Rebuild po skutečné úpravě produktů u neživého/pozastaveného obchodu je zdarma — nechat, nebo účtovat `preview_deploy`?
- [ ] Mazání starých vstupních fotek v `qads-inputs` (retence) a vracení zboží na sklad po refundu.
- [ ] Neaudit bezpečnosti, ale z prvního auditu: nepravdivé ceny/texty v UI a na webu („Push to Live 5 cr“, „ZIP 5 cr“, Terms s EUR a starými cenami, FAQ o doménách, „kredity jen při úspěchu“).

Tento dokument spojuje nálezy z dřívějšího velkého auditu s nálezy z dnešní session (Namecheap doménové vyhledávání, byrd fulfillment migrace). Řazeno podle toho, co je potřeba udělat dál — ne podle důležitosti.

---

## ✅ Hotovo a ověřeno naživo (nepotřebuje už nic)

Tyhle položky byly dřív na seznamu problémů a dnes jsou potvrzené jako funkční přímo v produkci:

- **`SECRETS_ENCRYPTION_KEY`** — nastaven ve Vercel env vars. Šifrování `project_secrets` (platební/shipping klíče) funguje.
- **byrd fulfillment DB sloupce** — chyběly (`project_secrets.byrd_api_key/byrd_api_secret`, `store_orders.fulfillment_provider/fulfillment_ref/fulfillment_status`). Migrace spuštěna dnes přímo v produkční Supabase. Živě ověřeno: uložení byrd API klíčů v Admin → Settings → Shipping na projektu "Hodinový manžel" teď skutečně projde (dřív by spadlo na neexistujícím sloupci).
- **Market & language migrace** (`project_secrets.market_country/market_language`) — potvrzeno, že sloupce v produkci existují, není potřeba nic pouštět.
- **Hosting na `*.stores.quantecode.com`** — ověřeno end-to-end: generace → Deploy live → doména se připojí → 30denní trial se spustí → doména resolvuje přes HTTPS.
- **Dva "auto-fix oscillation" bugy v generovaném checkout route** (zastaralá `@ts-expect-error` direktiva, Stripe `apiVersion` literal-type drift) — opraveny, nasazeny, ověřeny čistým buildem bez jediného auto-fix zásahu.
- **Namecheap API klíče přidány do Vercelu** (`NAMECHEAP_API_USER/API_KEY/CLIENT_IP/SANDBOX`) a proveden redeploy, aby se projevily. Volání teď skutečně jdou na `api.namecheap.com` (potvrzeno ve Vercel Logs) — ale samotné vyhledávání pořád nefunguje, viz níže.

---

## 🔴 Hotovo v kódu, čeká na `git push` z tvého počítače

Já nemám GitHub přístup z téhle sandboxky, takže tohle musíš pushnout ty:

- **Commit `1b69d90`** — "Log real Namecheap API errors instead of silently treating them as unavailable". Přidává `console.error` do `lib/namecheap.ts` a `app/api/domains/search/route.ts`, aby se skutečná chyba od Namecheapu objevila ve Vercel Logs místo tichého "No results". Bez rizika, nic nemění na chování pro uživatele.

**Po pushnutí** zopakuj vyhledání domény na `quantecode.com/domains` a pak se podívej do Vercel → Logs → hledej `domains/search` → rozbal request → dole uvidíš `[namecheap] API error ...` s přesným kódem a hláškou od Namecheapu.

---

## 🟡 Nový nález — Namecheap doménové vyhledávání pořád nefunguje

I s přidanými API klíči `quantecode.com/domains` vrací "No results" pro naprosto libovolný název (otestováno na 9 TLD variantách najednou — nemožné, aby byly všechny obsazené). Ve Vercel Logs vidím, že se volání na `api.namecheap.com` skutečně odešlou (9× GET, 553 ms), takže klíče se používají — ale Namecheap zjevně vrací chybu na úrovni XML odpovědi, kterou kód dosud tiše polykal (opraveno výše, ale log se ukáže až po pushi).

**Nejpravděpodobnější příčina — IP whitelist.** Namecheap API vyžaduje, aby volající IP adresa byla ručně přidaná v nastavení tvého Namecheap účtu (potvrzeno v jejich vlastní dokumentaci — bez toho każé volání spadne na chybu, i s validními klíči). Vercel serverless funkce ale běží z **rotujících, ne pevných IP adres** — pevná IP je u Vercelu placený add-on ($100/měsíc navíc, jen na Pro/Enterprise plánu). To je přesně scénář, který Namecheap i komunitní diskuze označují za nejčastější zdroj tohohle problému.

**Co s tím — dvě cesty:**
1. **Ověř nejdřív přesnou chybu** (po pushi commitu výše) — možná je to něco jednoduššího (např. API access vůbec není v Namecheap účtu zapnutý, nebo `NAMECHEAP_CLIENT_IP` musí sedět s nějakou konkrétní hodnotou).
2. Pokud je to skutečně IP whitelist a Vercel nemá pevnou IP: buď koupit Vercel Static IP add-on a tu IP whitelistnout, nebo přesměrovat jen tahle volání přes proxy se statickou IP (např. QuotaGuard, Fixie — služby přesně na tenhle problém).

**Kde v Namecheapu to nastavit:** přihlásit se na namecheap.com → Profile (ikona vpravo nahoře) → Tools → sekce "Business & Dev Tools" → API Access → tam by mělo jít vidět, jestli je API vůbec povolené a jaké IP jsou na whitelistu.

---

## 🟠 Byrd fulfillment — funguje, ale s omezeními

Ukládání klíčů teď funguje (viz výše), ale i tak to není "hotové" v plném rozsahu, co spec popisoval:

- **Žádné auto-odeslání do byrd po zaplacení.** Dnes je to čistě manuální tlačítko "Send to fulfillment" u každé objednávky v Adminu. Napojení na Stripe webhook (aby se objednávka poslala do byrd automaticky po platbě) nebylo nikdy uděláno — je to úmyslně tak, protože jde o byznysové rozhodnutí (chceš review krok, nebo ne?), ne technický dluh.
- **Cron joby běží jen 1× denně, ne každých 15 minut / hodinu jak specifikace chtěla.** V `vercel.json` jsou dnes nastavené na denní frekvenci (`0 3 * * *` apod.), protože **Vercel Hobby plán nepodporuje cron častější než jednou denně**. Týká se to: dohledání zaseknutých "creating" zásilek (dnes se to zkontroluje jen 1× denně místo do 10 minut), sync skladových zásob z byrd, a odesílání sledovacích e-mailů zákazníkům. Funguje to, jen pomaleji než bylo navrženo. Řešení: upgrade na Vercel Pro (viz sekce Vercel plán níže).
- **Admin UI je jen základ** — uložit klíče, poslat/refreshnout jednu objednávku. Chybí: test spojení jedním klikem, přehled všech zásilek na jednom místě, tlačítko na opětovný pokus u selhaných.
- **Vratky (`announceReturn`) nejsou vůbec implementované** — volání by spadlo s jasnou chybou, ne že by tiše nefungovalo.
- Nikdy to neběželo proti reálnému byrd účtu — jen proti testovacím datům v testech.

---

## 🔴 Potřebuje rozhodnutí od tebe (byznys, ne technika)

- **Vercel plán — "Hobby".** Ve Vercelu visí trvalé upozornění "The billing address on your payment method is missing or incomplete" — bez doplnění fakturační adresy nejde ani upgradovat plán, kdybys chtěl. Hobby plán navíc limituje frekvenci cronů (viz byrd výše) a nemá static outbound IP bez příplatku. Pokud plánuješ reálný provoz s platícími zákazníky, doporučuju: (1) doplnit fakturační adresu, (2) zvážit upgrade na Pro — kvůli cronům, případně kvůli static IP pro Namecheap.
- **Auto-shipping do byrd po platbě** — ano/ne? (viz výše, dnes je to manuální krok).
- **Chybějící firemní údaje v `lib/site-config.ts`** — `ico`, `dic`, `contactEmail` operátora (tebe jako provozovatele Quante) jsou prázdné řetězce s komentářem `[TO FILL IN]`. Bez nich se na `/terms`, `/privacy` a `/contact` nezobrazí kompletní právní údaje provozovatele platformy samotné (netýká se to generovaných obchodů — tam se firemní údaje vyplňují zvlášť v Adminu). Stačí doplnit přímo v souboru a pushnout.

---

## 🔑 Potřebuje konkrétní API klíč / účet od tebe

### 1. Namecheap — IP whitelist nebo Static IP
Popsáno výše v sekci o doménovém vyhledávání. Návod: namecheap.com → přihlásit se → ikona profilu vpravo nahoře → **Tools** → **Business & Dev Tools** → **API Access**. Tam zkontroluj: (a) jestli je API access vůbec "Enabled", (b) sekci **Whitelisted IPs**.

### 2. Clerk — produkce běží v TEST módu
Živě ověřeno (publishable klíč na `quantecode.com` začíná `pk_test_...`, ne `pk_live_...`). Clerk test/vývojové instance mívají omezení počtu uživatelů a nejsou určené pro ostrý provoz.
**Kde to přepnout:** dashboard.clerk.com → vybrat aplikaci Quante → v levém menu by měla být sekce pro přechod z Development na Production instanci (Clerk to obvykle vede jako průvodce — vyžaduje mj. nastavení vlastní domény pro přihlašování míso `*.accounts.dev`). Po přepnutí je potřeba nový `CLERK_SECRET_KEY` a `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (živé, `pk_live_...` / `sk_live_...`) nastavit ve Vercel env vars.

### 3. Maison Sève checkout — 404 (reprodukováno živě)
Tohle není chybějící klíč, ale starý obchod. `maison-s-ve.stores.quantecode.com` je featurovaný jako živá ukázka přímo na hlavní stránce quantecode.com (`app/page.tsx` — `HERO_SHOWCASE`), ale byl vygenerovaný předtím, než `buildCodeGenScaffold()` vůbec uměl vytvořit `/checkout` stránku (oprava proběhla 21. 8.). Kliknutí na "Checkout" v košíku vede na 404 — a tohle je vidět úplně každému návštěvníkovi landing page, kdo si to vyzkouší.
**Řešení bez čekání na klíč:** stačí ten projekt v Studiu jednou znovu vygenerovat/redeployovat (stejně jako jsme to dělali s "Hodinový manžel" — commit s opraveným scaffoldem už je live), aby dostal aktuální scaffold s funkčním checkoutem.

### 4. Stripe — test vs. live mód nejde ověřit odsud
`STRIPE_SECRET_KEY` je ve Vercelu nastavený, ale hodnotu (a tedy jestli je `sk_test_...` nebo `sk_live_...`) jako sandbox nevidím — Vercel skryté proměnné neukazuje. Zkontroluj prosím přímo v Stripe Dashboardu (přepínač Test/Live mode vlevo dole), jestli je účet napojený na live klíče, než začneš brát platby od reálných zákazníků.

---

## Rychlý přehled podle stavu

| Položka | Stav |
|---|---|
| Hosting + `*.stores.quantecode.com` doména | ✅ funguje |
| Stripe Connect platby (checkout flow) | ✅ funguje (na nových store) |
| byrd — uložení klíčů | ✅ funguje (po dnešní migraci) |
| byrd — auto-shipping, admin UI, vratky, rychlost cronů | 🟠 funguje částečně / manuálně |
| Vlastní doména koupená přes Namecheap | 🔴 nefunguje (pravděpodobně IP whitelist) |
| Maison Sève checkout (na landing page!) | 🔴 404, potřebuje redeploy |
| Clerk auth | 🔴 test mód, ne produkční |
| Firemní údaje platformy (IČO, DIČ, kontaktní e-mail) | 🔴 prázdné |
| Vercel plán / fakturace | 🔴 Hobby, chybí fakturační adresa |
