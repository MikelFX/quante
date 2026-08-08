# Quante — dlouhodobá byznysová vize a fázovaná roadmapa

> Toto je strategický/byznysový dokument, oddělený od technického `docs/update-log.md`. Update-log popisuje, co bylo v kódu skutečně postaveno a otestováno. Tento dokument popisuje vizi, kam by se Quante mohlo dál ubírat, a orientační odhady nákladů pro jednotlivé fáze. Nejde o popis současného stavu systému — dnešní stav je Fáze 0.

---

## Shrnutí vize

Quante dnes je platforma, kde si člověk pomocí AI během pár minut nechá postavit vlastní e-shop — bez developera, bez agentury, bez měsíců práce. To samo o sobě řeší reálný problém (založení e-shopu je dnes drahé a pomalé), ale dlouhodobá vize jde dál.

Základní myšlenka: **decentralizovaný retail**. Místo toho, aby zboží prodávalo pár velkých řetězců přes své vlastní obchody, ho prodávají tisíce jednotlivých lidí a malých firem přes vlastní, brandované, AI-generované e-shopy — a Quante pod kapotou zajišťuje sdílenou infrastrukturu, kterou by si žádný z nich sám nepostavil: platby, doručení, sklad, logistiku.

Nejbližší existující analogie jsou čínské platformy jako **Pinduoduo nebo Taobao** — masivní síť drobných prodejců nad sdílenou logistickou a platební infrastrukturou. Rozdíl je v tom, že Pinduoduo/Taobao jsou uniformní tržiště (jeden vzhled, jeden seznam produktů vedle sebe), zatímco u Quante má každý prodejce **svůj vlastní branding, vlastní doménu, vlastní vzhled obchodu** — AI generuje jedinečný, na míru vypadající e-shop pro každého, ne políčko v katalogu.

Pokud by se tahle vize naplnila v plném rozsahu, konečným stavem by byla síť tisíců nezávislých, AI-generovaných e-shopů, které dohromady sdílí logistickou páteř srovnatelnou svým dosahem s velkými řetězci typu Tesco nebo Billa — jen s tisíci různých "vývěsních štítů" místo jednoho. To je vize v horizontu mnoha let, ne blízká budoucnost — cesta k ní je rozdělená do čtyř fází níže, z nichž každá musí ekonomicky fungovat sama o sobě, než se přejde k další.

---

## Fáze 0 (teď – 6 měsíců): Spolehlivost + první tržby

**Cíl fáze:** dostat dnešní produkt do stavu, kde funguje spolehlivě a kde má Quante první platící zákazníky a ověřenou unit ekonomiku (tedy že náklady na vygenerování a provoz jednoho e-shopu jsou nižší než to, co za něj zákazník zaplatí).

Hlavní úkoly:

- **Snížit timeout rate generace** ze současných 12,8 % pod 2 %. Dnes se e-shop generuje synchronně v jednom dlouhém volání, které občas nestihne doběhnout včas — cílem je přesunout generaci na frontu úloh na pozadí se streamovaným výsledkem, aby k timeoutům docházelo jen výjimečně.
- **Dokončit a spustit byrd fulfillment integraci** — tahle část je z technického hlediska už hotová (viz `docs/update-log.md`), čeká jen na spuštění migrace a aktivaci merchanty.
- **Spustit Store Health Score** naostro — pomáhá obchodníkům skutečně dotáhnout svůj e-shop do prodejeschopného stavu, což by mělo zvýšit podíl obchodů, které reálně vydělávají (a tedy i podíl platících zákazníků Quante).
- Základní marketing a launch — dostat produkt před první reálné uživatele a získat zpětnou vazbu z trhu.

**Náklady:** V této fázi jde primárně o provozní (cloud/API) náklady, ne o kapitálové investice. Odhad řádově **$500–2 000 měsíčně** na provoz (Vercel hosting, Supabase databáze, Claude API volání za generování obchodů, Clerk autentizace). Žádné velké investice nejsou v této fázi potřeba — cílem je dostat se k prvním platícím zákazníkům a ověřit, že model vůbec ekonomicky dává smysl, než se do čehokoliv investuje víc kapitálu.

---

## Fáze 1 (6–18 měsíců): Škálování merchant base, marketplace + partner program naživo

**Cíl fáze:** z produktu, který funguje pro první uživatele, udělat produkt, který dokáže růst — přidat chybějící obchodní vrstvy (partnerský program a marketplace se skutečnými penězi) a rozšířit okruh toho, co se dá přes Quante prodávat.

Hlavní úkoly:

- **UI pro partner program a marketplace.** Obě featury dnes (viz `docs/update-log.md`) existují jen jako API a databázová vrstva — chybí obrazovky pro registraci partnera, přehled provizí, publikování nabídek na marketplace a admin frontu pro schvalování. Tohle je nutná podmínka k tomu, aby tyhle featury mohl reálně používat někdo mimo tebe.
- **Napojení Stripe Connect pro skutečné platby a výplaty.** Dnes partner program i marketplace jen počítají a evidují, kolik by kdo měl dostat — žádné skutečné peníze nikam neputují. Tahle fáze je o tom, aby se to změnilo: skutečné vybírání plateb na marketplace (Stripe Checkout) a skutečné výplaty partnerům a prodejcům (Stripe Connect).
- **Rozšíření na neplodinové retail kategorie** mimo generování e-shopů obecně — drogerie, elektronika, oblečení, domácí potřeby. Cíl je rozšířit typy obchodů, které Quante umí dobře obsloužit, a tím i adresovatelný trh.

**Náklady:** Tady už pravděpodobně bude potřeba menší kapitálový vstup — na marketing/growth (získávání dalších obchodníků a partnerů) a případně první zaměstnance (vývojář, support). Odhad řádově **$50 000–250 000** jako menší seed investice.

---

## Fáze 2 (18–36 měsíců): Vlastní/řízený fulfillment pro netrvanlivé zboží

**Cíl fáze:** jakmile objem obchodů na platformě ospravedlní investici do vlastní logistiky, začít budovat první regionální fulfillment centrum — místo (nebo vedle) spoléhání se čistě na externí partnery jako byrd.

Hlavní úkoly:

- Vyhodnotit, jestli zůstat u modelu externího partnera (byrd a podobní), nebo investovat do licencované robotické skladové technologie (např. AutoStore, GreyOrange a podobné systémy) — takové systémy stojí řádově **$1–5+ milionů** podle velikosti instalace, i pro menší nasazení.
- Fokus v této fázi zůstává výhradně na **netrvanlivém zboží** (ne na čerstvých potravinách) — to výrazně zjednodušuje logistiku (žádný chladicí řetězec, žádné přísné časové okno doručení) a je přirozeným dalším krokem po fázi 1.
- Cílem je, aby vlastní/řízený fulfillment centrum sloužilo jako sdílená infrastruktura pro obchody více prodejců najednou — to je bod, kdy se z Quante stává skutečně logistická platforma, ne jen nástroj na generování e-shopů.

**Náklady:** Tahle fáze už vyžaduje reálnou investici — realisticky Series A kolo. Odhad řádově **$1–5 milionů**.

---

## Fáze 3 (3–5+ let): Multi-region síť, cold chain pro potraviny

**Cíl fáze:** toto je fáze, ve které by Quante reálně mohlo začít konkurovat velkým potravinovým řetězcům typu Tesco nebo Billa — a zároveň fáze s nejvyšší kapitálovou náročností a nejdelším horizontem.

Hlavní úkoly:

- Rozšíření sítě automatizovaných skladů do více zemí/regionů — víc fulfillment center, geograficky rozprostřená síť.
- Přidání chladicího řetězce (cold chain) pro potraviny — to je zásadní skok oproti fázi 2, protože přináší úplně novou sadu požadavků (teplotní kontrola, rychlost doručení, potravinářské regulace) a s tím spojené výrazně vyšší náklady i riziko.
- Tohle je fáze, kde by síť AI-generovaných e-shopů nad sdílenou Quante logistikou mohla v teorii nabídnout srovnatelný dosah a rychlost doručení jako velký řetězec — jen rozprostřený přes tisíce nezávislých značek místo jedné.

**Náklady:** Tady už jde o velké kapitálové investice — realisticky Series B a další kola. Odhad řádově **$10–50+ milionů**.

---

## Shrnutí fází

| Fáze | Horizont | Hlavní zaměření | Odhad nákladů |
|---|---|---|---|
| 0 | teď – 6 měsíců | Spolehlivost, první tržby | $500–2 000 / měsíc (provoz) |
| 1 | 6–18 měsíců | UI pro partnery/marketplace, skutečné platby, rozšíření kategorií | $50 000–250 000 (seed) |
| 2 | 18–36 měsíců | Vlastní/řízený fulfillment, netrvanlivé zboží | $1–5 milionů (Series A) |
| 3 | 3–5+ let | Multi-region síť, cold chain, potraviny | $10–50+ milionů (Series B+) |

Klíčový princip mezi fázemi: **každá fáze by měla ekonomicky fungovat sama o sobě, než se přejde k další.** Není cílem skočit rovnou do fáze 2 nebo 3 bez ověřeného, ziskového základu z fáze 0 a 1 — kapitálově náročné fáze (2 a 3) dávají smysl až tehdy, když objem obchodů na platformě reálně existuje a investici do vlastní logistiky ospravedlňuje.

---

## Disclaimer

Všechny částky a odhady nákladů v tomto dokumentu jsou **orientační**, odvozené z veřejně známých řádů nákladů podobných projektů a technologií (cloudový provoz, robotizované sklady typu AutoStore/GreyOrange, typické velikosti seed/Series A/Series B kol v podobných byznysech). **Nejde o finanční poradenství ani o závazný byznys plán.** Přesné částky, reálná proveditelnost jednotlivých fází a jakékoliv kapitálové nebo investiční rozhodnutí by měly být před realizací ověřeny s odpovídajícími odborníky/konzultanty (finanční poradce, právník, případně specialisté na skladovou logistiku a cold chain) — tento dokument slouží jako výchozí bod pro diskuzi a plánování, ne jako hotové rozhodnutí.
