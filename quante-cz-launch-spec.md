# QUANTE — CZ Launch-Ready Spec
## Cíl: každý vygenerovaný e-shop je právně i obchodně schopný prodávat v ČR v den nasazení

> Použití: tento dokument slouží jako zadání pro Claude Code. Každý modul má definici, změny v manifestu a akceptační kritéria. Implementuj po modulech, v uvedeném pořadí (seřazeno podle priority pro prodejeschopnost).

---

## 0. Nová data v onboardingu merchanta (PREREKVIZITA všeho)

Quante musí při generování shopu sbírat údaje o provozovateli — bez nich nelze generovat právní dokumenty ani fakturaci.

**Rozšíření manifestu — `merchant` objekt:**
```json
{
  "merchant": {
    "obchodni_nazev": "string",
    "ico": "string (8 číslic, validace)",
    "dic": "string | null",
    "platce_dph": "boolean",
    "sidlo": { "ulice": "", "mesto": "", "psc": "", "zeme": "CZ" },
    "kontakt": { "email": "", "telefon": "" },
    "bankovni_ucet": "string (pro převody)",
    "zodpovedna_osoba": "string"
  }
}
```

**Akceptační kritéria:**
- IČO validováno algoritmem (kontrolní číslice) + volitelně lookup v ARES API pro předvyplnění názvu a sídla
- Bez vyplněného merchant objektu nelze shop publikovat na doménu (draft/preview ano)

---

## 1. Generátor právních dokumentů

Každý shop automaticky dostane 4 stránky generované z merchant dat + parametrů shopu:

1. **Obchodní podmínky** (`/obchodni-podminky`)
   - Identifikace prodávajícího (z merchant objektu)
   - Proces objednávky a uzavření smlouvy
   - Ceny a platební metody (dynamicky podle aktivovaných bran)
   - Dodací podmínky (dynamicky podle aktivovaných dopravců)
   - **14denní odstoupení od smlouvy bez udání důvodu** (zákonná povinnost, § 1829 OZ) vč. vzorového formuláře pro odstoupení
   - **Reklamační řád** — 2letá odpovědnost za vady, 30denní lhůta na vyřízení
   - Mimosoudní řešení sporů (ČOI)
2. **Zásady ochrany osobních údajů** (`/ochrana-osobnich-udaju`)
   - Správce údajů (merchant), účely zpracování, doba uchování
   - Seznam zpracovatelů generovaný dynamicky podle aktivních integrací (platební brána, dopravce, e-mailing, hosting)
   - Práva subjektů údajů dle GDPR
3. **Zásady cookies** (`/cookies`)
   - Tabulka cookies generovaná podle reálně použitých skriptů v shopu
4. **Stránka Kontakt** (`/kontakt`) — adresa, IČO/DIČ, e-mail, telefon

**Implementace:**
- Šablony jako MDX/templaty s proměnnými, NE volné AI generování (právní text musí být deterministický a auditovatelný)
- Verzování šablon (při změně šablony možnost hromadného update napříč shopy)
- Disclaimer v adminu: „Šablony jsou základ, finální odpovědnost nese provozovatel — doporučujeme kontrolu právníkem."

**Akceptační kritéria:**
- Dokumenty se přegenerují při změně merchant dat nebo aktivních integrací
- Odkazy na všechny 4 stránky povinně v patičce každého generovaného shopu

---

## 2. Cookie consent lišta

- Komponenta s reálnou volbou: Přijmout vše / Odmítnout / Nastavení (kategorie: nezbytné, analytické, marketingové)
- Před souhlasem se nenačítají žádné analytické/marketingové skripty (blokace přes consent mode)
- Stav uložen (localStorage/cookie first-party), respektován napříč session
- Design dědí styl shopu z manifestu (barvy, typografie) — nesmí to vypadat jako cizí plugin

**Akceptační kritéria:** žádný GA/Pixel request před udělením souhlasu (ověřitelné v network tabu).

---

## 3. Platební vrstva

Abstrakce `PaymentProvider` (interface), implementace v pořadí priority:

1. **Comgate** — primární brána pro CZ (karty, Apple Pay, Google Pay, bankovní tlačítka)
2. **GoPay** — alternativa, stejný interface
3. **Stripe** — pro merchanty mířící i mimo CZ
4. **Dobírka** — povinná možnost (CZ specifikum, velký podíl konverzí); jen příznak na objednávce + příplatek dle ceníku dopravce
5. **Bankovní převod** — instrukce + QR platba (SPD formát) v potvrzovacím e-mailu

**Manifest:**
```json
{
  "payments": {
    "providers": ["comgate" | "gopay" | "stripe"],
    "dobirka": { "enabled": true, "priplatek_czk": 39 },
    "prevod": { "enabled": true, "qr": true }
  }
}
```

**Akceptační kritéria:**
- Webhooky brány mění stav objednávky (zaplaceno/zrušeno/refund) idempotentně
- Klíče bran per-shop v env/Supabase (šifrovaně), nikdy v klientském kódu
- Test mode přepínač pro každý shop

---

## 4. Doprava

1. **Zásilkovna (Packeta)** — priorita #1: oficiální widget pro výběr výdejního místa v checkoutu, uložení ID pobočky k objednávce, API pro vytvoření zásilky + tracking
2. **PPL / DPD / Balíkovna** — doručení na adresu (stačí ceník + manuální podání v MVP, API později)
3. **Osobní odběr** — volitelný, adresa z merchant dat

**Manifest:**
```json
{
  "shipping": {
    "methods": [
      { "type": "zasilkovna", "cena_czk": 79 },
      { "type": "ppl", "cena_czk": 119 },
      { "type": "osobni_odber", "cena_czk": 0 }
    ],
    "doprava_zdarma_od_czk": 1500
  }
}
```

**Akceptační kritéria:**
- Ceny dopravy viditelné PŘED dokončením objednávky (košík i checkout) — právní i konverzní požadavek
- Progress bar „do dopravy zdarma zbývá X Kč" v košíku (konverzní standard)

---

## 5. Fakturace

- **MVP:** automaticky generované PDF faktury/dokladu při zaplacení (náležitosti dle zákona: číslo dokladu, dodavatel s IČO/DIČ, odběratel, datum, položky, DPH rozpis pokud plátce / „neplátce DPH" pokud ne)
- **V2:** integrace Fakturoid API (per-shop API klíč) — faktura vzniká tam, Quante jen linkuje
- Číselná řada per shop, konfigurovatelný prefix (např. 2026-0001)

**Akceptační kritéria:** faktura přiložena/odkázána v potvrzovacím e-mailu; plátce DPH → ceny evidovány bez DPH + sazba, neplátce → konečné ceny.

---

## 6. Transakční e-maily (Resend)

Povinná sada, šablony dědí branding shopu z manifestu:

1. Potvrzení objednávky (rekapitulace, platební instrukce u převodu vč. QR)
2. Potvrzení platby + faktura
3. Expedice + tracking link (dle dopravce)
4. Odstoupení/refund potvrzení

**Akceptační kritéria:** odesílatel konfigurovatelný (vlastní doména přes Resend domain verification, fallback na quante subdoménu); všechny e-maily obsahují identifikaci prodávajícího (zákonná náležitost obchodního sdělení).

---

## 7. Checkout — pevné požadavky generátoru

- Max 2–3 kroky: Košík → Údaje + doprava + platba → Potvrzení (ideálně one-page)
- **Guest checkout default** — registrace volitelná až po nákupu
- Ceny vždy s DPH, u plátce zobrazit i rozpis
- Souhlas s obchodními podmínkami = checkbox s odkazem (nesmí být předzaškrtnutý)
- Rekapitulace všech nákladů (zboží + doprava + dobírka) před tlačítkem „Objednat s povinností platby" (přesně tato formulace nebo ekvivalent — zákonný požadavek)

---

## 8. Produktová stránka — pevné požadavky generátoru

- Cena s DPH, skladová dostupnost, dodací doba
- Min. 1 fotka (generátor vyžaduje upload nebo placeholder s warningem před publikací)
- Strukturovaná data (JSON-LD Product) pro SEO od prvního dne

---

## 9. Admin checklist „Připraveno k prodeji"

Před publikací na ostrou doménu shop projde automatickou kontrolou:

- [ ] Merchant data kompletní (IČO validní)
- [ ] 4 právní stránky vygenerované a v patičce
- [ ] Min. 1 platební metoda aktivní a otestovaná (test transakce)
- [ ] Min. 1 dopravní metoda s cenou
- [ ] Transakční e-maily odeslány na testovací adresu
- [ ] Min. 1 produkt s fotkou, cenou a skladovostí
- [ ] Cookie lišta funkční

Nesplněno → publikace zablokovaná, UI ukazuje co chybí (to je zároveň skvělý aktivační funnel).

---

## Mimo scope dne 1 (zapsat do roadmapy, NESTAVĚT teď)

Heureka/Zboží.cz feedy, věrnostní program, multi-jazyk/multi-měna, skladové hospodářství, pokročilá analytika, blog modul, B2B ceníky.

---

## Pořadí implementace (doporučené sprinty)

1. **Sprint 1:** Merchant onboarding (0) + právní generátor (1) + cookie lišta (2) → shop je legální
2. **Sprint 2:** Platby Comgate + dobírka + převod (3) + transakční e-maily (6) → shop umí přijmout peníze
3. **Sprint 3:** Zásilkovna widget (4) + PDF fakturace (5) → shop umí doručit a doložit
4. **Sprint 4:** Checkout/PDP hardening (7, 8) + publish checklist (9) → shop je „launch-ready" tlačítkem
