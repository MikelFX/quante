// Deterministic Czech legal page generator.
// Template version is embedded in output so bulk-updates are traceable.
// Output is HTML-in-markdown compatible with the richText section component.

import type { Merchant, PaymentsConfig, ShippingConfig } from '@/types/manifest'

export const LEGAL_TEMPLATE_VERSION = '1.0'

const YEAR = new Date().getFullYear()

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatAddress(m: Merchant): string {
  const { ulice, mesto, psc, zeme } = m.sidlo
  return `${ulice}, ${psc} ${mesto}${zeme !== 'CZ' ? `, ${zeme}` : ''}`
}

function paymentList(p?: PaymentsConfig): string {
  const methods: string[] = []
  if (p?.providers.includes('comgate') || p?.providers.includes('gopay')) {
    methods.push('platební kartou (Visa, Mastercard), Apple Pay, Google Pay, bankovními tlačítky')
  }
  if (p?.providers.includes('stripe')) {
    methods.push('platební kartou přes Stripe')
  }
  if (p?.dobirka?.enabled) {
    methods.push(`dobírkou (příplatek ${p.dobirka.priplatek_czk} Kč)`)
  }
  if (p?.prevod?.enabled) {
    methods.push('bankovním převodem')
  }
  if (methods.length === 0) methods.push('platební kartou nebo bankovním převodem')
  return methods.join(', ')
}

function shippingList(s?: ShippingConfig): string {
  if (!s?.methods?.length) return 'přepravní službou dle aktuálního ceníku'
  return s.methods.map((m) => {
    const label: Record<string, string> = {
      zasilkovna: 'Zásilkovna (Packeta)',
      ppl: 'PPL',
      dpd: 'DPD',
      balikovna: 'Balíkovna',
      osobni_odber: 'osobní odběr',
      custom: m.nazev ?? 'přepravní službou',
    }
    return `${label[m.type]} (${m.cena_czk} Kč)`
  }).join(', ')
}

// ─── Obchodní podmínky ────────────────────────────────────────────────────────

export function generateObchodniPodminky(
  m: Merchant,
  payments?: PaymentsConfig,
  shipping?: ShippingConfig
): string {
  const ico = escHtml(m.ico)
  const nazev = escHtml(m.obchodni_nazev)
  const adresa = escHtml(formatAddress(m))
  const email = escHtml(m.kontakt.email)
  const telefon = escHtml(m.kontakt.telefon)
  const dic = m.dic ? `\n**DIČ:** ${escHtml(m.dic)}` : ''
  const dphInfo = m.platce_dph
    ? 'Ceny jsou uvedeny bez DPH i s DPH v zákonné výši.'
    : 'Prodávající není plátcem DPH. Uvedené ceny jsou konečné.'

  return `## Obchodní podmínky

**Platnost od:** 1. 1. ${YEAR} | Verze šablony: ${LEGAL_TEMPLATE_VERSION}

---

### 1. Identifikace prodávajícího

**Obchodní firma:** ${nazev}
**IČO:** ${ico}${dic}
**Sídlo:** ${adresa}
**E-mail:** ${email}
**Telefon:** ${telefon}

Prodávající je fyzická nebo právnická osoba provozující internetový obchod na základě živnostenského oprávnění nebo zápisu v obchodním rejstříku.

---

### 2. Sdělení před uzavřením smlouvy

Před odesláním objednávky je kupující seznámen s těmito obchodními podmínkami, cenou zboží a náklady na dodání. Odesláním objednávky kupující potvrzuje, že se s podmínkami seznámil a souhlasí s nimi.

---

### 3. Uzavření kupní smlouvy

Kupní smlouva je uzavřena okamžikem, kdy prodávající potvrdí objednávku e-mailem. Do okamžiku potvrzení není prodávající vázán přijetím objednávky. Prodávající si vyhrazuje právo odmítnout objednávku, zejména je-li zboží vyprodáno nebo vykazuje-li objednávka znaky podvodu.

---

### 4. Ceny a platba

${dphInfo}

Kupující může uhradit kupní cenu těmito způsoby: ${paymentList(payments)}.

Kupní cena je splatná před odesláním zboží, není-li dohodnuto jinak. Zboží zůstává majetkem prodávajícího do úplného zaplacení.

---

### 5. Dodací podmínky

Objednané zboží je expedováno zpravidla do 3 pracovních dnů od přijetí platby (není-li uvedeno jinak u konkrétního produktu).

Dostupné způsoby dopravy: ${shippingList(shipping)}.

${shipping?.doprava_zdarma_od_czk ? `Doprava je zdarma při objednávce nad ${shipping.doprava_zdarma_od_czk} Kč.` : ''}

Prodávající neodpovídá za prodlení způsobené dopravcem nebo okolnostmi vylučujícími odpovědnost (vis maior).

---

### 6. Právo na odstoupení od smlouvy

Kupující – **spotřebitel** má právo odstoupit od smlouvy uzavřené distančním způsobem bez udání důvodu **do 14 dnů od převzetí zboží** (§ 1829 zákona č. 89/2012 Sb., občanský zákoník).

**Postup pro odstoupení:**

1. Zašlete e-mail na adresu ${email} s textem „Odstupuji od smlouvy č. [číslo objednávky]" nebo použijte vzorový formulář níže.
2. Zboží vraťte na adresu sídla prodávajícího nejpozději do 14 dnů od odeslání odstoupení.
3. Prodávající vrátí veškeré přijaté platby (včetně nákladů na dodání ve výši nejlevnějšího nabízeného způsobu doručení) do 14 dnů od obdržení odstoupení, nejpozději však do 14 dnů od vrácení zboží.

Zboží musí být vráceno nepoškozené, neopotřebované a v původním obalu. Náklady na vrácení zboží nese kupující. Prodávající může zadržet vrácení platby do obdržení vráceného zboží.

**Vzorový formulář pro odstoupení od smlouvy:**

> Adresát: ${nazev}, ${adresa}, ${email}
>
> Oznamuji, že tímto odstupuji od smlouvy o nákupu tohoto zboží: [popis]
> Objednáno dne: ________ | Obdrženo dne: ________
> Jméno spotřebitele: ________
> Adresa spotřebitele: ________
> Datum: ________

---

### 7. Reklamační řád

Prodávající odpovídá za vady zboží v souladu s § 2165 občanského zákoníku. Kupující má právo uplatnit reklamaci do **24 měsíců** od převzetí zboží.

**Postup reklamace:**

1. Zašlete e-mail na ${email} s popisem vady, číslem objednávky a fotodokumentací.
2. Prodávající potvrdí přijetí reklamace do 3 pracovních dnů.
3. Reklamace bude vyřízena **nejpozději do 30 dnů** od uplatnění. O způsobu vyřízení bude kupující informován e-mailem.

Kupující má právo na bezplatné odstranění vady, slevu z kupní ceny nebo odstoupení od smlouvy dle § 2169 OZ.

---

### 8. Mimosoudní řešení sporů

V případě sporu, který se nepodaří vyřešit dohodou, může spotřebitel podat návrh na mimosoudní řešení sporu k **České obchodní inspekci (ČOI)**, Štěpánská 15, 120 00 Praha 2, www.coi.cz.

---

### 9. Závěrečná ustanovení

Tyto podmínky jsou platné a účinné od 1. 1. ${YEAR}. Prodávající si vyhrazuje právo podmínky měnit. O změně bude kupující informován e-mailem nebo zveřejněním nové verze na webu.

Právní vztahy se řídí právním řádem České republiky.

---

*Tyto obchodní podmínky slouží jako základ. Finální odpovědnost za jejich správnost a aktuálnost nese provozovatel — doporučujeme kontrolu advokátem.*`
}

// ─── Ochrana osobních údajů ───────────────────────────────────────────────────

export function generateOchranaOsobnichUdaju(
  m: Merchant,
  payments?: PaymentsConfig,
  shipping?: ShippingConfig
): string {
  const nazev = escHtml(m.obchodni_nazev)
  const ico = escHtml(m.ico)
  const adresa = escHtml(formatAddress(m))
  const email = escHtml(m.kontakt.email)

  const zpracovatelList: string[] = []
  if (payments?.providers.includes('comgate')) zpracovatelList.push('**Comgate, a.s.** — zpracování plateb (karty, bankovní tlačítka)')
  if (payments?.providers.includes('gopay')) zpracovatelList.push('**GoPay s.r.o.** — zpracování plateb')
  if (payments?.providers.includes('stripe')) zpracovatelList.push('**Stripe, Inc.** — zpracování plateb kartou')
  if (shipping?.methods.some((m) => m.type === 'zasilkovna')) zpracovatelList.push('**Zásilkovna s.r.o. (Packeta)** — doručení zásilek')
  if (shipping?.methods.some((m) => m.type === 'ppl')) zpracovatelList.push('**PPL CZ s.r.o.** — doručení zásilek')
  if (shipping?.methods.some((m) => m.type === 'dpd')) zpracovatelList.push('**DPD CZ s.r.o.** — doručení zásilek')
  zpracovatelList.push('**Vercel, Inc.** — cloudový hosting webové stránky')

  return `## Zásady ochrany osobních údajů

**Platnost od:** 1. 1. ${YEAR} | Verze šablony: ${LEGAL_TEMPLATE_VERSION}

---

### 1. Správce osobních údajů

**${nazev}**
IČO: ${ico} | Sídlo: ${adresa}
Kontaktní e-mail: ${email}

---

### 2. Jaké osobní údaje zpracováváme

V rámci objednávky zpracováváme: jméno a příjmení, doručovací a fakturační adresu, e-mailovou adresu, telefonní číslo a informace o objednávce (zboží, cena, platba). Při návštěvě webu automaticky zpracováváme technické údaje (IP adresa, typ prohlížeče) nezbytné pro provoz stránky.

---

### 3. Účely a právní základ zpracování

| Účel | Právní základ | Doba uchování |
|---|---|---|
| Vyřízení objednávky a doručení | Plnění smlouvy (čl. 6/1/b GDPR) | 5 let od uzavření smlouvy |
| Vystavení daňového dokladu | Plnění právní povinnosti (čl. 6/1/c GDPR) | 10 let dle zákona o účetnictví |
| Zasílání newsletteru | Souhlas (čl. 6/1/a GDPR) | Do odvolání souhlasu |
| Analytika a zlepšování webu | Oprávněný zájem (čl. 6/1/f GDPR) | 26 měsíců |

---

### 4. Příjemci a zpracovatelé

Vaše osobní údaje předáváme pouze subjektům nezbytným pro plnění smlouvy:

${zpracovatelList.map((z) => `- ${z}`).join('\n')}

Žádný ze zpracovatelů nesmí vaše údaje použít k jiným účelům, než je nezbytné pro poskytnutí dané služby.

---

### 5. Předávání do třetích zemí

Hosting je zajištěn společností Vercel, Inc. (USA) na základě standardních smluvních doložek schválených Evropskou komisí. Platební brány mohou zpracovávat data v EU nebo USA za podmínek odpovídající ochrany.

---

### 6. Vaše práva

Máte právo na **přístup** k vašim osobním údajům, jejich **opravu**, **výmaz** (právo být zapomenut), **omezení zpracování**, **přenositelnost** údajů a **námitku** proti zpracování. Souhlas se zpracováním (např. newsletter) můžete kdykoli odvolat. Svá práva uplatňujte na e-mailu ${email}.

Máte rovněž právo podat stížnost u **Úřadu pro ochranu osobních údajů** (www.uoou.cz).

---

### 7. Bezpečnost

Přijímáme technická a organizační opatření k ochraně vašich osobních údajů před neoprávněným přístupem, ztrátou nebo zneužitím.

---

*Tyto zásady slouží jako základ. Finální odpovědnost nese provozovatel — doporučujeme kontrolu advokátem.*`
}

// ─── Cookies ─────────────────────────────────────────────────────────────────

export function generateCookies(m: Merchant): string {
  const email = escHtml(m.kontakt.email)

  return `## Zásady používání cookies

**Platnost od:** 1. 1. ${YEAR} | Verze šablony: ${LEGAL_TEMPLATE_VERSION}

---

### Co jsou cookies

Cookies jsou malé textové soubory ukládané do vašeho prohlížeče při návštěvě webu. Slouží k zajištění funkčnosti stránky, analýze návštěvnosti a personalizaci obsahu.

---

### Kategorie cookies

| Kategorie | Popis | Příklady | Souhlas |
|---|---|---|---|
| **Nezbytné** | Zajišťují základní funkce webu (košík, přihlášení, bezpečnost) | session, cart | Není vyžadován |
| **Analytické** | Pomáhají nám porozumět, jak návštěvníci web používají | _ga, _gid | Vyžadován |
| **Marketingové** | Slouží k cílenému zobrazování reklam | _fbp, _ttp | Vyžadován |

---

### Správa souhlasu

Při první návštěvě webu zobrazujeme lištu pro správu souhlasu s cookies. Svůj souhlas můžete kdykoli změnit v nastavení cookies (odkaz v patičce webu) nebo smazat cookies v nastavení svého prohlížeče.

---

### Doba uchovávání

Nezbytné cookies jsou uchovávány po dobu relace nebo maximálně 1 rok. Analytické a marketingové cookies jsou uchovávány dle podmínek příslušné služby (zpravidla 13–26 měsíců).

---

### Kontakt

Dotazy ke zpracování cookies zasílejte na: ${email}

---

*Tyto zásady slouží jako základ. Finální odpovědnost nese provozovatel — doporučujeme kontrolu advokátem.*`
}

// ─── Kontakt ──────────────────────────────────────────────────────────────────

export function generateKontakt(m: Merchant): string {
  const nazev = escHtml(m.obchodni_nazev)
  const ico = escHtml(m.ico)
  const adresa = escHtml(formatAddress(m))
  const email = escHtml(m.kontakt.email)
  const telefon = escHtml(m.kontakt.telefon)
  const dic = m.dic ? `\n**DIČ:** ${escHtml(m.dic)}` : ''
  const dphNote = m.platce_dph ? '\n**Plátce DPH**' : '\nNeplátce DPH'

  return `## Kontakt

### ${nazev}

**IČO:** ${ico}${dic}${dphNote}

**Sídlo / provozovna:**
${adresa}

---

**E-mail:** [${email}](mailto:${email})
**Telefon:** ${telefon}

---

### Reklamace a vrácení zboží

Reklamace i vrácení zboží vyřizujeme e-mailem na adrese ${email}. V e-mailu uveďte číslo objednávky a popis požadavku. Odpovídáme do 3 pracovních dnů.

---

### Mimosoudní řešení sporů

Spory s prodávajícím lze řešit mimosoudně prostřednictvím **České obchodní inspekce (ČOI)**:
- Web: [www.coi.cz](https://www.coi.cz)
- Adresa: Štěpánská 15, 120 00 Praha 2`
}
