# Přepnutí domény: AssetraDigital web + Quante (checklist)

Stav k 2026-10-08. Větev `assetradigital` je hotová, na `main` (= produkce quantecode.com) zatím nic nejde.
Merge do `main` je samotné přepnutí — `/` na quantecode.com se tím změní na web AssetraDigital.

## 0. Rozhodnutí před přepnutím (dělá majitel)

- [ ] **Doména webu AssetraDigital** (dál jen `D`, např. assetradigital.cz) — koupená, přístup k DNS.
- [ ] **Kdo provozuje Quante**: QuanteCode s.r.o., nebo AssetraDigital s.r.o. (patička, obchodní podmínky, faktury).
- [ ] **Doplněné placeholdery na webu** (`content/assetra/site.ts`): IČO, sídlo, rejstřík, telefon, e-mail,
      doba odpovědi, cena správy, hodinová sazba, DPH, texty obchodních podmínek / ochrany osobních údajů /
      vzorové smlouvy. Bez nich web ukazuje viditelné `[doplnit]`. Po změně spustit `npm run qgent:knowledge`.
- [ ] **Harwo**: souhlas klienta se zveřejněním (`work.approved`), jinak zůstává jako „návrh“.

## 1. Doporučené rozdělení domén

| Co | Kde | Proč |
|---|---|---|
| Web AssetraDigital (`/`, `/quante`, `/quante/*`, české právní stránky) | **D** | nová značka |
| Aplikace Quante (`/dashboard`, `/new`, `/project/*`, `/billing`, `/settings`, `/login`, `/signup`, `/qads`, `/changelog`, `/terms`, `/privacy`, `/cookies`, `/refund`, `/invoice/*`) | **quantecode.com** (beze změny) | Clerk produkční instance je navázaná na quantecode.com; náhledy obchodů ve Studiu povolují rámování jen z `*.quantecode.com` (`FRAME_ANCESTORS` v `lib/store-template/build.ts`) |
| API (`/api/*`) | **na obou hostech, nikdy nepřesměrovat** (je to jeden deployment; web na D volá `/api/leads` a `/api/qgent/public` relativně) | obchody volají `QUANTE_API_URL` zapečený v jejich env; Stripe, Vercel, PayPal, Comgate, GoPay a Qads webhooky jsou registrované na quantecode.com |
| Obchody | `*.stores.quantecode.com` + vlastní domény (beze změny) | `HOSTING_ROOT_DOMAIN` |

Přesun aplikace na D by znamenal změnu domény v Clerku, nový `FRAME_ANCESTORS` + rollout scaffoldu do všech
obchodů a přeregistraci webhooků — nedoporučuji spolu s tímhle přepnutím.

## 2. Úpravy kódu (udělat na větvi před merge, až bude D známá)

- [ ] **Přesměrování podle hostu** v `next.config.ts`:
  - na quantecode.com: `/`, `/quante`, `/quante/:path*`, `/obchodni-podminky`, `/ochrana-osobnich-udaju`,
    `/vzorova-smlouva`, `/design` → 301 na `https://D/...` (`has: [{ type: 'host', value: 'quantecode.com' }]`);
  - na D: aplikační cesty (tabulka výše) → 301 na `https://quantecode.com/...`, aby Clerk běžel jen na jednom hostu;
  - `/api/*` se nepřesměrovává nikde.
- [ ] **Odkazy z webu do aplikace absolutně**: `quanteApp` v `content/assetra/modules.ts` (`/dashboard`, `/new`,
      `/qads`, `/signup`) → `https://quantecode.com/...`.
- [ ] **Nákup Agency** (`AgencyCta`, volá `/api/stripe/agency-checkout` a při odhlášení posílá na `/login`): na D
      nebude Clerk session, takže tlačítko musí vést na quantecode.com (např. na `/billing` nebo stránku s nákupem
      v aplikaci), ne volat API z D.
- [ ] **SEO**: `NEXT_PUBLIC_SITE_URL` (canonical, OG, sitemap) — web na D má mít vlastní base; sitemap rozdělit
      podle hostu (D: web, quantecode.com: veřejné stránky aplikace). `app/robots.ts` totéž.
- [ ] **OG obrázek a metadata** webu s `metadataBase` na D.
- [ ] **E-maily**: odesílatel poptávek (`LEAD_NOTIFY_FROM`) z ověřené domény (viz bod 4).
- [ ] Spustit testy (`npm test`), `next build`, projít preview.

## 3. Vercel

- [ ] Přidat D (a `www.D` → redirect na D) do projektu `mikelfxs-projects/quante`, nastavit DNS podle Vercelu.
- [ ] Env proměnné (Production): `NEXT_PUBLIC_SITE_URL=https://D`; `NEXT_PUBLIC_APP_URL` **nechat** na quantecode.com
      (stores + faktury + webhook URL z něj berou platformu).
- [ ] Zkontrolovat, že BotID funguje na produkci (OIDC je zapnuté — ověřeno 2026-10-08).
- [ ] Volitelně: BotID Deep Analysis ve Vercel Firewall (placené).

## 4. Služby třetích stran

- [ ] **Resend**: ověřit doménu odesílatele (D nebo quantecode.com). Dnes Resend hlásí, že quantecode.com ověřená
      není → e-maily jdou přes `onboarding@resend.dev` a jen na e-mail vlastníka účtu; to se týká i e-mailů
      o objednávkách v Quante. Po ověření nastavit `LEAD_NOTIFY_FROM` (a zkontrolovat `objednavky@`, `billing@`, `orders@`).
- [ ] **Clerk**: beze změny, pokud aplikace zůstává na quantecode.com. Nastavit jméno aplikace (dnes „My Application“).
- [ ] **Stripe / PayPal / Comgate / GoPay / Vercel webhooky**: beze změny (quantecode.com/api/*).
- [ ] **Supabase**: migrace `migration-assetra-leads.sql`, `migration-qgent-public.sql`, `migration-qgent-shop.sql`
      — spuštěné 2026-10-08.
- [ ] **Stripe produkt měsíčního hostingu**: na produkci chybí `STRIPE_HOSTING_MONTHLY_PRICE_ID`
      (web proto ukazuje jen roční hosting 99 USD).

## 5. Merge a ověření

- [ ] Merge `assetradigital` → `main` (po bodu 2), počkat na produkční build.
- [ ] Ověřit: D `/` a `/quante*`; quantecode.com `/` → 301 na D; `/dashboard`, `/login`, `/qads` na quantecode.com
      fungují; přihlášení a odhlášení; Studio náhled obchodu; Publish; formulář poptávky na D (dorazí e-mail);
      Qgent na webu; Qgent ve Studiu; Stripe testovací nákup kreditů; webhook logy bez chyb.
- [ ] Obchod zákazníka: košík → pokladna → platba (QUANTE_API_URL míří na quantecode.com, nic se nemění).
- [ ] PageSpeed Insights (mobil) pro D `/` a `/quante`: cíl LCP < 2,5 s, CLS < 0,1. Lokálně se škrcením
      (4× CPU, 1,6 Mbit/s): LCP `/` ~3,1 s, `/quante` ~2,7 s, `/quante/<modul>` ~2,7 s, CLS ~0.
- [ ] Google Search Console: přidat D, odeslat sitemapu; u quantecode.com nechat, 301 předají hodnotu.

## 6. Návrat zpět

Revert merge commitu na `main` (nebo Vercel „Instant Rollback“ na předchozí produkční deployment). Přesměrování
podle hostu zmizí s revertem; DNS pro D může zůstat.
