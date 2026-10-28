// AssetraDigital company documents (/obchodni-podminky, /ochrana-osobnich-udaju, /vzorova-smlouva).
// Data, not markup: `app/(site)/(web)/LegalDoc.tsx` renders it. Tokens inside the text:
//   {{ico}} {{seat}} …  a company / contact fact from site.ts — shown as a [placeholder] while it is null
//   {{?label}}          a fact or decision only the owner can supply — always a visible [placeholder]
//   {{_label}}          a blank in the sample contract, filled in per client
// Never replace a placeholder with an invented fact.

import { company, contact, pricing } from './site'

export type LegalSection = { h: string; p?: string[]; ol?: string[]; ul?: string[]; after?: string[] }
export type LegalDocument = { slug: string; title: string; lead: string; effective: string; sections: LegalSection[]; signatures?: boolean }

/** Values for the {{key}} tokens; null = not known yet → placeholder with the label. */
export const legalFacts: Record<string, { value: string | null; label: string }> = {
  name: { value: company.name, label: 'název společnosti' },
  ico: { value: company.ico, label: 'IČO' },
  seat: { value: company.seat, label: 'sídlo' },
  registry: { value: company.registry, label: 'spisová značka v obchodním rejstříku' },
  email: { value: contact.email, label: 'e-mail' },
  phone: { value: contact.phone, label: 'telefon' },
  minMonths: { value: String(pricing.subscription.minMonths), label: 'minimální doba' },
  vat: { value: pricing.vat, label: 'ceny bez DPH / s DPH' },
}

const providerId = '{{name}}, IČO {{ico}}, se sídlem {{seat}}, zapsaná v obchodním rejstříku vedeném {{registry}}'
const provider = `${providerId}, e-mail {{email}}, telefon {{phone}}`

export const terms: LegalDocument = {
  slug: 'obchodni-podminky',
  title: 'Obchodní podmínky',
  lead: 'Podmínky, za kterých pro vás navrhujeme, stavíme a spravujeme AI řešení, software, weby a e-shopy.',
  effective: '{{?datum účinnosti}}',
  sections: [
    {
      h: 'Úvodní ustanovení',
      ol: [
        `Tyto obchodní podmínky (dále „podmínky“) upravují vztahy mezi společností ${provider} (dále „poskytovatel“), a jejími zákazníky (dále „objednatel“).`,
        'Podmínky se vztahují na návrh a vývoj AI řešení, systémů postavených kolem AI, CRM, asistentů, automatizací a dalšího softwaru na míru, na návrh a stavbu webů a e-shopů a na jejich správu a hosting (dále společně „služby“).',
        'Podmínky jsou součástí každé smlouvy uzavřené mezi poskytovatelem a objednatelem (dále „smlouva“). Pokud se smlouva od podmínek odchyluje, platí smlouva.',
        'Aplikace Quante (quantecode.com) se řídí vlastními podmínkami zveřejněnými v aplikaci; tyto podmínky se na ni nevztahují.',
      ],
    },
    {
      h: 'Pojmy',
      ul: [
        'Dílo: software, AI řešení, web nebo e-shop, které poskytovatel pro objednatele vytvoří podle smlouvy, včetně zdrojového kódu a dokumentace.',
        'Správa: průběžné služby po spuštění díla, zejména hosting, zálohy, aktualizace, dohled nad provozem a drobné úpravy.',
        'Paušál: model, ve kterém objednatel neplatí za stavbu díla předem a hradí pravidelnou měsíční platbu za stavbu i správu.',
        'Nabídka: písemný návrh poskytovatele s rozsahem, cenou a harmonogramem.',
        'Podklady: texty, fotografie, data, přístupy a další materiály, které objednatel poskytovateli předává.',
        'Spotřebitel: objednatel, který je fyzickou osobou a smlouvu neuzavírá v rámci své podnikatelské činnosti.',
      ],
    },
    {
      h: 'Uzavření smlouvy',
      ol: [
        'Konzultace je zdarma a nezavazuje žádnou ze stran. Odeslání poptávky přes formulář na webu ani rozhovor s asistentem Qgent nejsou objednávkou.',
        'Po konzultaci poskytovatel připraví nabídku s pevnou cenou a jasně popsaným rozsahem. Nabídka platí 30 dní, pokud v ní není uvedeno jinak.',
        'Smlouva vzniká podpisem smlouvy oběma stranami (i elektronicky) nebo písemným přijetím nabídky objednatelem, například e-mailem.',
        'Změny rozsahu po uzavření smlouvy se sjednávají písemně (stačí e-mail) včetně dopadu na cenu a termíny. Bez takové dohody poskytovatel práce nad rámec rozsahu neprovádí a neúčtuje.',
      ],
    },
    {
      h: 'Cena a platební podmínky',
      ol: [
        'Cena je uvedena ve smlouvě nebo v nabídce a pro sjednaný rozsah je pevná. Ceny jsou uvedeny {{vat}}.',
        'U jednorázové ceny se platí podle splátkového kalendáře ve smlouvě; není-li sjednán, uhradí objednatel 50 % ceny po uzavření smlouvy a 50 % po předání díla.',
        'Paušál se platí měsíčně předem na základě faktury. Správa sjednaná samostatně se platí stejně.',
        'Splatnost faktur je 14 dní od vystavení. Při prodlení může poskytovatel účtovat zákonný úrok z prodlení.',
        'Je-li objednatel v prodlení s platbou déle než 30 dní, může poskytovatel po předchozím písemném upozornění s náhradní lhůtou alespoň 7 dní pozastavit správu a další práce. Data objednatele tím nemaže.',
        'Náklady třetích stran (například doména, placené licence, poplatky za AI modely nebo za platební bránu) jsou součástí ceny jen tehdy, je-li to ve smlouvě výslovně uvedeno. Jinak je objednatel hradí přímo jejich poskytovatelům nebo podle skutečné spotřeby.',
      ],
    },
    {
      h: 'Paušál',
      ol: [
        'U paušálu objednatel neplatí za stavbu díla nic předem. Měsíční platba zahrnuje stavbu díla a správu v rozsahu podle smlouvy.',
        'Paušál se sjednává na minimální dobu {{minMonths}} měsíců od spuštění díla. Po jejím uplynutí trvá na dobu neurčitou a obě strany jej mohou vypovědět s výpovědní dobou 1 měsíc.',
        'Pokud objednatel ukončí paušál před koncem minimální doby z jiného důvodu než pro porušení smlouvy poskytovatelem, uhradí zbývající měsíční platby do konce minimální doby, nejvýše však rozdíl mezi jednorázovou cenou díla uvedenou ve smlouvě a již zaplacenými platbami.',
        'Po skončení paušálu a uhrazení všech plateb poskytovatel předá objednateli zdrojový kód, data a přístupy podle článku o právech k dílu.',
      ],
    },
    {
      h: 'Součinnost objednatele',
      ol: [
        'Objednatel včas dodá podklady, přístupy a rozhodnutí potřebná k plnění a určí kontaktní osobu.',
        'Objednatel odpovídá za to, že k podkladům (texty, fotografie, loga, data) má potřebná práva a že jejich použití neporušuje práva třetích osob ani právní předpisy.',
        'Objednatel odpovídá za obsah, který na web nebo do systému vkládá sám, a za obchodní údaje svého e-shopu (ceny, popisy zboží, vlastní obchodní podmínky vůči svým zákazníkům).',
        'Pokud je objednatel se součinností v prodlení, posouvají se termíny poskytovatele nejméně o dobu tohoto prodlení.',
      ],
    },
    {
      h: 'Předání a převzetí díla',
      ol: [
        'Před spuštěním poskytovatel zpřístupní objednateli testovací verzi díla.',
        'Objednatel má 10 pracovních dní na to, aby dílo vyzkoušel a sdělil případné vady. Poskytovatel vady v rozsahu smlouvy odstraní a předá opravenou verzi.',
        'Dílo je převzato podpisem předávacího protokolu, písemným potvrzením (i e-mailem), spuštěním do ostrého provozu na pokyn objednatele, nebo marným uplynutím lhůty podle předchozího bodu.',
        'Drobné vady, které nebrání užívání díla, nejsou důvodem odmítnout převzetí; poskytovatel je odstraní v dohodnuté lhůtě.',
      ],
    },
    {
      h: 'Práva k dílu, doména a předání kódu',
      ol: [
        'Doména patří objednateli. Je registrována na jeho jméno, nebo na něj bude bezplatně převedena.',
        'Po úplném zaplacení ceny poskytuje poskytovatel objednateli výhradní, časově a územně neomezenou licenci k části díla vytvořené pro objednatele na míru, včetně práva ji upravovat a postoupit. Objednatel není povinen licenci využít.',
        'K obecným knihovnám, nástrojům a postupům, které poskytovatel používá i v jiných projektech, získává objednatel nevýhradní, časově neomezenou licenci v rozsahu potřebném k užívání a úpravám díla. Komponenty s otevřeným kódem se řídí svými licencemi.',
        'Na požádání a vždy při skončení spolupráce předá poskytovatel zdrojový kód, data a přístupy, nejpozději do 30 dní, v běžném strojově čitelném formátu.',
        'Platby zákazníků e-shopu jdou přímo na účet objednatele. Platební brány, dopravci a fakturační systémy se zřizují na objednatele; poskytovatel k jeho penězům nemá přístup.',
        'Poskytovatel smí dílo uvést mezi referencemi jen se souhlasem objednatele.',
      ],
    },
    {
      h: 'AI řešení',
      ol: [
        'Výstupy jazykových modelů a dalších AI systémů jsou pravděpodobnostní a mohou obsahovat chyby. Poskytovatel odpovídá za to, že řešení navrhne a nastaví podle smlouvy a v souladu se současnou dobrou praxí, nikoli za správnost každé jednotlivé odpovědi modelu.',
        'U rozhodnutí s právním, finančním nebo zdravotním dopadem zajistí objednatel kontrolu člověkem, pokud se strany výslovně nedohodnou jinak.',
        'AI řešení mohou využívat modely a služby třetích stran (například Anthropic, OpenAI, Google). Jejich dostupnost, ceny a podmínky určují tito poskytovatelé; při jejich podstatné změně poskytovatel navrhne náhradní řešení.',
        'Objednatel do AI systému vkládá jen data, ke kterým má oprávnění. Zpracování osobních údajů v AI řešení se řídí zpracovatelskými podmínkami ve smlouvě.',
        'Poskytovatel objednateli poskytne součinnost při plnění povinností podle nařízení (EU) 2024/1689 o umělé inteligenci, zejména povinnosti informovat uživatele, že komunikují s AI systémem.',
      ],
    },
    {
      h: 'Správa a hosting',
      ol: [
        'Rozsah správy (hosting, zálohy, aktualizace, dohled, drobné úpravy a jejich měsíční rozsah) a doby reakce určuje smlouva.',
        'Poskytovatel se stará o to, aby dílo bylo dostupné a zabezpečené. Plánovanou údržbu provádí pokud možno mimo špičku a s předstihem ji oznamuje.',
        'Poskytovatel neodpovídá za výpadky a změny služeb třetích stran, na kterých dílo závisí (hosting, platební brány, dopravci, AI modely, registrátor domény), ale bez zbytečného odkladu pomůže s nápravou.',
        'Práce nad rámec sjednaného rozsahu správy provádí poskytovatel jen po předchozím odsouhlasení ceny objednatelem.',
      ],
    },
    {
      h: 'Vady a odpovědnost',
      ol: [
        'Vady díla objednatel oznamuje písemně bez zbytečného odkladu po jejich zjištění. Vady oznámené do 6 měsíců od převzetí poskytovatel odstraní bezplatně; u spotřebitelů platí zákonná práva z vadného plnění v plném rozsahu.',
        'Za vadu se nepovažuje stav způsobený zásahem objednatele nebo třetí osoby do díla, podklady objednatele nebo změnou služeb třetích stran.',
        'Celková odpovědnost poskytovatele za škodu z jedné smlouvy je vůči podnikateli omezena na částku, kterou objednatel poskytovateli zaplatil za posledních 12 měsíců. Omezení se nevztahuje na škodu způsobenou úmyslně nebo z hrubé nedbalosti ani na újmu na zdraví.',
        'Poskytovatel neodpovídá za ušlý zisk ani za nepřímé škody, pokud je nezpůsobil úmyslně nebo z hrubé nedbalosti.',
      ],
    },
    {
      h: 'Ochrana osobních údajů a mlčenlivost',
      ol: [
        'Jak poskytovatel zpracovává osobní údaje, popisuje stránka Ochrana osobních údajů.',
        'Pokud poskytovatel při plnění zpracovává osobní údaje za objednatele (například zákazníky jeho e-shopu), je zpracovatelem podle čl. 28 GDPR a řídí se zpracovatelskými podmínkami ve smlouvě.',
        'Obě strany zachovávají mlčenlivost o důvěrných informacích druhé strany, a to i po skončení smlouvy.',
      ],
    },
    {
      h: 'Spotřebitelé',
      ol: [
        'Spotřebitel může od smlouvy uzavřené na dálku odstoupit bez udání důvodu do 14 dní od jejího uzavření. Odstoupení stačí poslat e-mailem na {{email}}.',
        'Pokud spotřebitel výslovně požádá, aby poskytovatel začal s plněním před uplynutím lhůty k odstoupení, a poté odstoupí, uhradí poměrnou část ceny za plnění poskytnuté do odstoupení.',
        'Spotřebitel nemůže odstoupit od smlouvy o službách, které byly s jeho výslovným souhlasem před uplynutím lhůty zcela splněny.',
        'K mimosoudnímu řešení spotřebitelských sporů je příslušná Česká obchodní inspekce, Štěpánská 567/15, 120 00 Praha 2, www.coi.cz.',
      ],
    },
    {
      h: 'Ukončení smlouvy',
      ol: [
        'Smlouvu o dílo lze ukončit dohodou nebo odstoupením při podstatném porušení, které druhá strana neodstraní ani v náhradní lhůtě alespoň 14 dní od písemné výzvy.',
        'Při ukončení smlouvy o dílo před převzetím uhradí objednatel cenu prací provedených do ukončení; poskytovatel mu předá jejich výsledky.',
        'Správu sjednanou na dobu neurčitou mohou obě strany vypovědět s výpovědní dobou 1 měsíc; pro paušál platí článek Paušál.',
        'Po skončení správy poskytovatel na požádání pomůže s převodem díla k jinému poskytovateli. Data objednatele uchovává ještě 30 dní a poté je smaže, pokud mu jejich uchování neukládá zákon.',
      ],
    },
    {
      h: 'Závěrečná ustanovení',
      ol: [
        'Vztahy podle těchto podmínek se řídí právem České republiky, zejména zákonem č. 89/2012 Sb., občanský zákoník. Spory rozhodují obecné soudy České republiky.',
        'Poskytovatel může podmínky měnit. U trvajících smluv oznámí změnu objednateli alespoň 30 dní předem; objednatel, který se změnou nesouhlasí, může smlouvu vypovědět ke dni účinnosti změny.',
        'Tyto podmínky jsou účinné od {{?datum účinnosti}}.',
      ],
    },
  ],
}

export const privacy: LegalDocument = {
  slug: 'ochrana-osobnich-udaju',
  title: 'Ochrana osobních údajů',
  lead: 'Jaké osobní údaje o vás zpracováváme, proč, jak dlouho a jaká máte práva.',
  effective: '{{?datum účinnosti}}',
  sections: [
    {
      h: 'Kdo údaje zpracovává',
      p: [
        `Správcem osobních údajů je ${provider} (dále „my“). Zpracování se řídí nařízením (EU) 2016/679 (GDPR) a zákonem č. 110/2019 Sb., o zpracování osobních údajů.`,
        'S čímkoli, co se týká vašich údajů, se na nás obraťte na {{email}}. Pověřence pro ochranu osobních údajů jsme nejmenovali, protože nám to zákon neukládá.',
      ],
    },
    {
      h: 'Poptávkový formulář',
      ul: [
        'Údaje: jméno a firma, telefon nebo e-mail, zvolená oblast a text zprávy. Technicky ukládáme typ prohlížeče a otisk IP adresy (zašifrovaný jednosměrnou funkcí, samotnou IP adresu neukládáme).',
        'Účel: odpovědět na poptávku a připravit nabídku; otisk IP adresy a typ prohlížeče slouží jen k ochraně formuláře před spamem a zneužitím.',
        'Právní základ: provedení opatření před uzavřením smlouvy na vaši žádost (čl. 6 odst. 1 písm. b GDPR); ochrana proti zneužití je náš oprávněný zájem (čl. 6 odst. 1 písm. f GDPR).',
        'Doba uložení: po dobu jednání o spolupráci; pokud smlouva nevznikne, nejdéle {{?doba uložení poptávek, např. 12 měsíců}} od poslední komunikace. Pokud smlouva vznikne, platí doby pro klienty.',
      ],
    },
    {
      h: 'Asistent Qgent na webu',
      ul: [
        'Údaje: text konverzace, stránka, ze které píšete, a otisk IP adresy. E-mailové adresy a telefonní čísla z uložené konverzace automaticky odstraňujeme. Do asistenta prosím nepište citlivé údaje.',
        'Účel: odpovědět na váš dotaz, chránit službu před zneužitím a zlepšovat odpovědi asistenta.',
        'Právní základ: náš oprávněný zájem na provozu a zabezpečení asistenta (čl. 6 odst. 1 písm. f GDPR).',
        'Doba uložení: 30 dní, poté se konverzace automaticky mažou.',
        'Odpovědi tvoří jazykový model Claude od společnosti Anthropic, PBC (USA), které text konverzace předáváme ke zpracování. Asistent je AI, ne člověk.',
        'Pokud vám asistent nabídne předvyplnění poptávky, formulář odesíláte až vy sami; pak platí podmínky pro poptávkový formulář.',
      ],
    },
    {
      h: 'Klienti a jednání o smlouvě',
      ul: [
        'Údaje: identifikační a kontaktní údaje vás nebo vaší firmy a kontaktních osob, obsah komunikace, smluvní a fakturační údaje.',
        'Účel a právní základ: uzavření a plnění smlouvy (čl. 6 odst. 1 písm. b GDPR), vedení účetnictví a daňové povinnosti (čl. 6 odst. 1 písm. c GDPR), vymáhání a obrana právních nároků (čl. 6 odst. 1 písm. f GDPR).',
        'Doba uložení: po dobu trvání smlouvy a poté po dobu, kterou ukládají právní předpisy (účetní a daňové doklady až 10 let), případně do uplynutí promlčecích lhůt.',
      ],
    },
    {
      h: 'Měření návštěvnosti a cookies',
      ul: [
        'Web nepoužívá reklamní ani sledovací cookies a nesdílí údaje s reklamními sítěmi, proto se vás na souhlas s cookies neptá.',
        'Návštěvnost a rychlost webu měříme službami Vercel Web Analytics a Speed Insights. Ty nepoužívají cookies a pracují jen se souhrnnými údaji, ze kterých nelze určit konkrétního návštěvníka. Právním základem je náš oprávněný zájem na fungování a zlepšování webu.',
        'V úložišti vašeho prohlížeče ukládáme jen to, co je potřeba pro funkce, které sami používáte: zvolený vzhled (světlý / tmavý) a vypnuté animace trvale, rozepsanou konverzaci s asistentem a předvyplnění formuláře jen do zavření okna. Tyto údaje k nám neodcházejí a můžete je kdykoli smazat v nastavení prohlížeče.',
        'Formulář a asistent jsou chráněny službou Vercel BotID, která v prohlížeči neviditelně ověřuje, že je neodesílá robot.',
      ],
    },
    {
      h: 'Komu údaje předáváme',
      p: ['Osobní údaje neprodáváme. Pracují s nimi jen naši zpracovatelé, kteří nám poskytují techniku pro provoz webu, a to jen v nezbytném rozsahu:'],
      ul: [
        'Vercel Inc. (USA): hosting webu, měření návštěvnosti, ochrana proti robotům.',
        'Supabase Inc. (USA): databáze, ve které ukládáme poptávky a konverzace s asistentem.',
        'Resend (Plus Five Five, Inc., USA): doručení upozornění na novou poptávku e-mailem.',
        'Anthropic, PBC (USA): jazykový model, který odpovídá v asistentovi Qgent.',
        'Klientské údaje dále účetní a daňový poradce a poskytovatel fakturačního systému.',
        'Orgány veřejné moci, pokud nám to ukládá zákon.',
      ],
      after: [
        'Někteří zpracovatelé sídlí v USA. Údaje jim předáváme na základě rozhodnutí Evropské komise o odpovídající ochraně (EU-US Data Privacy Framework), u zpracovatelů, kteří k němu nepřistoupili, na základě standardních smluvních doložek schválených Evropskou komisí.',
      ],
    },
    {
      h: 'Když pro vás provozujeme web nebo e-shop',
      p: [
        'Pokud spravujeme váš web, e-shop nebo AI řešení, zpracováváme údaje vašich zákazníků jako váš zpracovatel podle čl. 28 GDPR. Správcem jste vy a podmínky zpracování určuje naše smlouva. Zákazníci vašeho obchodu se se svými žádostmi obracejí na vás; my vám s jejich vyřízením pomůžeme.',
      ],
    },
    {
      h: 'Vaše práva',
      p: ['Máte právo:'],
      ul: [
        'získat přístup ke svým údajům a jejich kopii,',
        'na opravu nepřesných údajů,',
        'na výmaz, pokud údaje už nepotřebujeme nebo je zpracováváme neoprávněně,',
        'na omezení zpracování,',
        'na přenositelnost údajů, které jste nám poskytli na základě smlouvy,',
        'vznést námitku proti zpracování založenému na našem oprávněném zájmu,',
        'podat stížnost u Úřadu pro ochranu osobních údajů, Pplk. Sochora 27, 170 00 Praha 7, www.uoou.cz.',
      ],
      after: [
        'Žádost pošlete na {{email}}. Odpovíme bez zbytečného odkladu, nejpozději do jednoho měsíce. Automatizované rozhodování ani profilování s právními účinky neprovádíme.',
      ],
    },
    {
      h: 'Změny',
      p: [
        'Tento dokument můžeme aktualizovat, například když začneme používat novou službu. Aktuální znění je vždy na této stránce. Účinné od {{?datum účinnosti}}.',
      ],
    },
  ],
}

const party = (who: string) =>
  `{{_${who}: název / jméno}}, IČO {{_IČO}}, DIČ {{_DIČ}}, se sídlem {{_adresa}}, zapsaný v {{_rejstřík a spisová značka}}, zastoupený {{_jméno a funkce}}, e-mail {{_e-mail}}`

export const sampleContract: LegalDocument = {
  slug: 'vzorova-smlouva',
  title: 'Vzorová smlouva',
  lead: 'Smlouva o dílo a o poskytování služeb správy. Vzor k nahlédnutí: konkrétní znění vždy vychází z nabídky a doplníme ho podle vašeho projektu.',
  effective: '',
  signatures: true,
  sections: [
    {
      h: 'Smluvní strany',
      p: [
        `Poskytovatel: ${providerId}, zastoupená {{?jméno a funkce jednatele}}, e-mail {{email}}`,
        `Objednatel: ${party('objednatel')}`,
        'uzavírají podle § 2586 a násl. a § 1746 odst. 2 zákona č. 89/2012 Sb., občanský zákoník, tuto smlouvu o dílo a o poskytování služeb správy (dále „smlouva“).',
      ],
    },
    {
      h: 'I. Předmět smlouvy',
      ol: [
        'Poskytovatel se zavazuje vytvořit pro objednatele dílo: {{_AI řešení / software / web / e-shop: stručný popis}}, v rozsahu podle Přílohy č. 1 (Specifikace a cenová nabídka), a předat ho objednateli.',
        'Je-li sjednána správa, poskytovatel se zavazuje po spuštění díla poskytovat služby správy v rozsahu podle Přílohy č. 3 (Rozsah správy).',
        'Objednatel se zavazuje poskytnout součinnost, dílo převzít a zaplatit sjednanou cenu.',
      ],
    },
    {
      h: 'II. Cena a platby',
      p: ['Strany si zvolí jednu z variant:'],
      ol: [
        'Varianta A, jednorázová cena: cena díla činí {{_částka}} Kč {{_bez DPH / s DPH}}. Objednatel uhradí 50 % ceny po podpisu smlouvy a 50 % po převzetí díla. Správa, je-li sjednána, se hradí měsíčně ve výši {{_částka}} Kč.',
        'Varianta B, paušál: objednatel nehradí za stavbu díla nic předem a platí měsíčně {{_částka}} Kč {{_bez DPH / s DPH}} za stavbu i správu. Paušál se sjednává na minimální dobu {{minMonths}} měsíců od spuštění díla, poté trvá na dobu neurčitou.',
        'Cena je pro rozsah podle Přílohy č. 1 pevná. Práce nad rámec tohoto rozsahu se provádějí jen na základě písemné dohody o ceně (stačí e-mail).',
        'Platby se hradí na základě faktur se splatností 14 dní. Náklady třetích stran nejsou v ceně, pokud nejsou uvedeny v Příloze č. 1.',
      ],
    },
    {
      h: 'III. Termíny',
      ol: [
        'Poskytovatel předá objednateli testovací verzi díla do {{_datum}} a dílo spustí do {{_datum}}, podrobně podle Přílohy č. 2 (Harmonogram).',
        'Termíny se prodlužují o dobu, po kterou je objednatel v prodlení se součinností nebo se schválením.',
      ],
    },
    {
      h: 'IV. Součinnost objednatele',
      ol: [
        'Objednatel dodá podklady a přístupy uvedené v Příloze č. 1 nejpozději do {{_datum}} a na dotazy poskytovatele odpovídá zpravidla do 5 pracovních dní.',
        'Objednatel prohlašuje, že má k dodaným podkladům potřebná práva.',
        'Kontaktní osobou objednatele je {{_jméno, e-mail, telefon}}.',
      ],
    },
    {
      h: 'V. Předání a převzetí',
      ol: [
        'Objednatel má 10 pracovních dní od zpřístupnění testovací verze na připomínky. Poskytovatel vady v rozsahu smlouvy odstraní.',
        'Dílo je převzato podpisem předávacího protokolu, písemným potvrzením, spuštěním do ostrého provozu na pokyn objednatele, nebo marným uplynutím lhůty podle bodu 1.',
        'Drobné vady nebránící užívání díla nejsou důvodem odmítnout převzetí.',
      ],
    },
    {
      h: 'VI. Doména, kód a data',
      ol: [
        'Doména {{_doména}} je registrována na objednatele, nebo na něj bude bezplatně převedena.',
        'Po úplném zaplacení ceny poskytuje poskytovatel objednateli výhradní, časově a územně neomezenou licenci k části díla vytvořené na míru, včetně práva ji upravovat a postoupit. K obecným knihovnám a nástrojům poskytovatele získává objednatel nevýhradní, časově neomezenou licenci v rozsahu potřebném k užívání a úpravám díla.',
        'Na požádání a vždy při skončení smlouvy předá poskytovatel objednateli zdrojový kód, data a přístupy, nejpozději do 30 dní. U paušálu po uhrazení všech plateb podle článku II.',
        'Platby zákazníků e-shopu jdou přímo na účet objednatele. Platební brány, dopravci a fakturační systémy se zřizují na objednatele.',
      ],
    },
    {
      h: 'VII. Správa a hosting',
      ol: [
        'Správa zahrnuje hosting, zálohy, bezpečnostní aktualizace, dohled nad provozem a drobné úpravy v rozsahu {{_počet hodin nebo popis}} měsíčně, podle Přílohy č. 3.',
        'Poskytovatel reaguje na hlášení výpadku do {{_doba}} v pracovní dny a na ostatní požadavky do {{_doba}}.',
        'Poskytovatel neodpovídá za výpadky služeb třetích stran, na kterých dílo závisí, ale bez zbytečného odkladu pomůže s nápravou.',
      ],
    },
    {
      h: 'VIII. AI komponenty',
      ol: [
        'Dílo využívá tyto AI modely a služby třetích stran: {{_například Anthropic Claude}}. Poplatky za jejich používání hradí {{_objednatel přímo / poskytovatel v ceně / podle spotřeby}}.',
        'Výstupy AI jsou pravděpodobnostní. Poskytovatel odpovídá za navržení a nastavení řešení podle smlouvy, nikoli za správnost každé jednotlivé odpovědi modelu. U rozhodnutí s právním, finančním nebo zdravotním dopadem zajistí objednatel kontrolu člověkem.',
        'Poskytovatel poskytne součinnost při plnění povinností podle nařízení (EU) 2024/1689 o umělé inteligenci.',
      ],
    },
    {
      h: 'IX. Vady a odpovědnost',
      ol: [
        'Vady oznámené do 6 měsíců od převzetí poskytovatel odstraní bezplatně, zpravidla do 10 pracovních dní; vady bránící provozu bez zbytečného odkladu.',
        'Celková odpovědnost poskytovatele za škodu je omezena na částku, kterou objednatel zaplatil za posledních 12 měsíců. Omezení neplatí pro škodu způsobenou úmyslně nebo z hrubé nedbalosti ani pro újmu na zdraví.',
      ],
    },
    {
      h: 'X. Osobní údaje a mlčenlivost',
      ol: [
        'Zpracovává-li poskytovatel pro objednatele osobní údaje (například zákazníků e-shopu nebo uživatelů AI řešení), je zpracovatelem podle čl. 28 GDPR. Zpracovává je jen k plnění této smlouvy a podle pokynů objednatele, zajistí jejich zabezpečení a mlčenlivost osob, které s nimi pracují, další zpracovatele (hosting, databáze, AI modely) zapojí jen ty uvedené v Příloze č. 1 nebo oznámené objednateli předem, pomůže objednateli s vyřizováním žádostí subjektů údajů, ohlásí mu porušení zabezpečení bez zbytečného odkladu a po skončení smlouvy údaje předá a smaže.',
        'Strany zachovávají mlčenlivost o důvěrných informacích druhé strany i po skončení smlouvy.',
      ],
    },
    {
      h: 'XI. Trvání a ukončení',
      ol: [
        'Smlouva nabývá účinnosti podpisem oběma stranami. Část o dílo končí jeho převzetím a zaplacením, správa trvá na dobu neurčitou (u paušálu s minimální dobou podle článku II) a lze ji vypovědět s výpovědní dobou 1 měsíc.',
        'Ukončí-li objednatel paušál před koncem minimální doby z jiného důvodu než pro porušení smlouvy poskytovatelem, uhradí zbývající měsíční platby do konce minimální doby, nejvýše však rozdíl mezi cenou díla podle Přílohy č. 1 a již zaplacenými platbami.',
        'Každá strana může odstoupit při podstatném porušení, které druhá strana neodstraní ani v náhradní lhůtě 14 dní od písemné výzvy.',
      ],
    },
    {
      h: 'XII. Závěrečná ustanovení',
      ol: [
        'Smlouva se řídí právem České republiky. Nedílnou součástí smlouvy jsou obchodní podmínky poskytovatele zveřejněné na webu; odchylná ujednání smlouvy mají přednost.',
        'Smlouvu lze měnit jen písemnými dodatky; změny rozsahu podle článku II lze sjednat i e-mailem.',
        'Smlouva je podepsána elektronicky, nebo ve dvou vyhotoveních, z nichž každá strana obdrží jedno.',
        'Přílohy: č. 1 Specifikace a cenová nabídka, č. 2 Harmonogram, č. 3 Rozsah správy.',
      ],
    },
  ],
}

export const legalDocuments = { [terms.slug]: terms, [privacy.slug]: privacy, [sampleContract.slug]: sampleContract }

/** Whether the document still shows an owner placeholder; such a page stays out of search results. */
export function hasLegalPlaceholders(doc: LegalDocument): boolean {
  const text = JSON.stringify(doc)
  return /\{\{\?/.test(text) || [...text.matchAll(/\{\{(\w+)\}\}/g)].some((m) => !legalFacts[m[1]]?.value)
}
