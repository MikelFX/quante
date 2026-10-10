# Přepnutí domény: AssetraDigital web + Quante (checklist)

Stav k 2026-10-10. Doména webu je **assetradigital.agency**. Kód na větvi `assetradigital` je na přepnutí
připravený (bod 2). Na `main` (= produkce quantecode.com) zatím nic nejde: merge do `main` je samotné
přepnutí, `/` na quantecode.com pak přesměruje na assetradigital.agency.

## 0. Rozhodnutí před přepnutím (dělá majitel)

- [x] **Doména webu**: assetradigital.agency.
- [ ] **Kdo provozuje Quante**: QuanteCode s.r.o., nebo AssetraDigital s.r.o. (patička, obchodní podmínky, faktury).
- [ ] **Doplněné placeholdery na webu** (`content/assetra/site.ts`): IČO, sídlo, rejstřík, telefon, e-mail,
      doba odpovědi, cena správy, hodinová sazba, DPH, texty obchodních podmínek / ochrany osobních údajů /
      vzorové smlouvy. Bez nich web ukazuje viditelné `[doplnit]`. Po změně spustit `npm run qgent:knowledge`.
- [ ] **Harwo**: souhlas klienta se zveřejněním (`work.approved`), jinak zůstává jako „návrh“.

## 1. Rozdělení domén (`lib/domains.ts`)

| Co | Kde | Proč |
|---|---|---|
| Web AssetraDigital: `/`, `/quante`, `/quante/*`, české právní stránky, `/design`, `/og` (`SITE_PATHS`) | **assetradigital.agency** | nová značka |
| Aplikace Quante: `/dashboard`, `/new`, `/project/*`, `/billing`, `/settings`, `/admin`, `/marketplace`, `/login`, `/signup`, `/qads`, `/changelog`, `/terms`, `/privacy`, `/cookies`, `/refund`, `/invoice/*`, `/preview/*` (`APP_PATHS`) | **quantecode.com** (beze změny) | Clerk produkční instance je navázaná na quantecode.com; náhledy obchodů ve Studiu povolují rámování jen z `*.quantecode.com` (`FRAME_ANCESTORS`) |
| API `/api/*` | **na obou hostech, nikdy se nepřesměrovává** | web volá `/api/leads` a `/api/qgent/public` relativně; obchody volají `QUANTE_API_URL`; Stripe, Vercel, PayPal, Comgate, GoPay a Qads webhooky jsou registrované na quantecode.com |
| Obchody | `*.stores.quantecode.com` + vlastní domény (beze změny) | `HOSTING_ROOT_DOMAIN` |

`__tests__/domain-split.test.mjs` hlídá, že každá stránka patří právě jedné straně (nová stránka mimo oba
seznamy test shodí) a že Clerk na web nepronikne.

## 2. Úpravy kódu — hotovo na větvi (2026-10-10)

- [x] **Přesměrování podle hostu** (`next.config.ts`, 308): na quantecode.com `SITE_PATHS` → assetradigital.agency,
      na assetradigital.agency `APP_PATHS` → quantecode.com. Náhledy na vercel.app a localhost nematchují ani jeden
      host a dál servírují obojí. Ověřeno lokálně s hlavičkou `Host` pro obě domény.
- [x] **Clerk jen v aplikaci**: `ClerkProvider` není v kořenovém layoutu, ale v `components/auth/QuanteClerk.tsx`,
      který obalují layouty `app/(app)`, `app/(marketing)`, `app/login`, `app/signup`, `app/qads`. `proxy.ts`
      na stránkách webu Clerk middleware přeskočí. Web tak nenačítá skript Clerku ani nedělá handshake.
- [x] **Odkazy mezi doménami**: `siteHref()` / `appHref()`. V produkčním buildu (`NEXT_PUBLIC_VERCEL_ENV=production`)
      jsou absolutní, v náhledech a lokálně relativní. Kdyby proměnná chyběla, relativní odkaz dojde přes přesměrování.
- [x] **Nákup Agency**: web nemá přihlášení, takže „Objednat Agency“ vede na quantecode.com `/billing#agency`,
      kde tlačítko „Upgrade to Agency“ spustí Stripe checkout. Zrušená platba se vrací na Billing.
- [x] **SEO**: web má `metadataBase` assetradigital.agency, canonical na každé stránce a vlastní obrázek pro sdílení
      (`/og`). `sitemap.xml` a `robots.txt` se řídí hostem (web na assetradigital.agency, veřejné stránky aplikace
      na quantecode.com). `NEXT_PUBLIC_SITE_URL` zůstává quantecode.com (je to adresa aplikace pro její SEO,
      vlastní domény obchodů a pokladnu) — **neměnit**.
- [x] **Vlastní domény obchodů**: assetradigital.agency nejde připojit jako doména obchodu (`blockedZones`).
- [ ] **E-maily**: odesílatel poptávek (`LEAD_NOTIFY_FROM`) z ověřené domény (viz bod 4).

## 3. Vercel (dělá majitel)

- [ ] Projekt `mikelfxs-projects/quante` → Settings → Domains: přidat `assetradigital.agency` a `www.assetradigital.agency`
      (www nastavit jako redirect na assetradigital.agency). U registrátora nastavit DNS přesně podle Vercelu.
- [ ] Settings → Environment Variables: nechat zapnuté „Automatically expose System Environment Variables“
      (z něj je `NEXT_PUBLIC_VERCEL_ENV`). `NEXT_PUBLIC_SITE_URL` a `NEXT_PUBLIC_APP_URL` **neměnit**.
- [ ] Zkontrolovat, že BotID funguje na produkci (OIDC je zapnuté — ověřeno 2026-10-08).
- [ ] Volitelně: BotID Deep Analysis ve Vercel Firewall (placené).

## 4. Služby třetích stran

- [ ] **Resend**: ověřit doménu odesílatele (assetradigital.agency nebo quantecode.com). Dnes Resend hlásí, že
      quantecode.com ověřená není → e-maily jdou přes `onboarding@resend.dev` a jen na e-mail vlastníka účtu; to se
      týká i e-mailů o objednávkách v Quante. Po ověření nastavit `LEAD_NOTIFY_FROM` (a zkontrolovat `objednavky@`,
      `billing@`, `orders@`).
- [ ] **Clerk**: beze změny (web Clerk nepoužívá). Nastavit jméno aplikace (dnes „My Application“).
- [ ] **Stripe / PayPal / Comgate / GoPay / Vercel webhooky**: beze změny (quantecode.com/api/*).
- [x] **Supabase**: migrace `migration-assetra-leads.sql`, `migration-qgent-public.sql`, `migration-qgent-shop.sql`
      — spuštěné 2026-10-08.
- [ ] **Stripe produkt měsíčního hostingu**: na produkci chybí `STRIPE_HOSTING_MONTHLY_PRICE_ID`
      (web proto ukazuje jen roční hosting 99 USD).

## 5. Merge a ověření

- [ ] Až DNS na Vercelu svítí zeleně: merge `assetradigital` → `main`, počkat na produkční build.
- [ ] Ověřit: assetradigital.agency `/` a `/quante*`; quantecode.com `/` → assetradigital.agency; `/dashboard`, `/login`,
      `/qads` na quantecode.com fungují; přihlášení a odhlášení; Studio náhled obchodu; Publish; formulář poptávky
      na assetradigital.agency (dorazí e-mail); Qgent na webu; Qgent ve Studiu; „Objednat Agency“ → Billing →
      Stripe; testovací nákup kreditů; webhook logy bez chyb.
- [ ] Obchod zákazníka: košík → pokladna → platba (QUANTE_API_URL míří na quantecode.com, nic se nemění).
- [ ] PageSpeed Insights (mobil) pro assetradigital.agency `/` a `/quante`: cíl LCP < 2,5 s, CLS < 0,1. Lokálně se
      škrcením (4× CPU, 1,6 Mbit/s): LCP `/` ~3,1 s, `/quante` ~2,7 s, `/quante/<modul>` ~2,7 s, CLS ~0 — to bylo
      ještě s Clerkem na webu, teď by mělo být lépe.
- [ ] Google Search Console: přidat assetradigital.agency, odeslat sitemapu; u quantecode.com nechat, 308 předají hodnotu.

## 6. Návrat zpět

Revert merge commitu na `main` (nebo Vercel „Instant Rollback“ na předchozí produkční deployment). Přesměrování
podle hostu zmizí s revertem; DNS pro assetradigital.agency může zůstat.
