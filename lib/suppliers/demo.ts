// The demo supplier (CLAUDE.md §13r): a made-up warehouse whose feed lets the operator click the
// whole catalog flow through before a real supplier is signed — find → add to store → paid order →
// e-mail to the supplier → tracking number. Pure, no imports.
//
// It is an ordinary supplier row (slug DEMO_SLUG) imported through the normal pipeline from
// GET /api/catalog/demo-feed. Only admins see it in the catalog (lib/suppliers/catalog.ts), and its
// order e-mail is the admin's own address, so nothing ever reaches a real company. Brands are
// invented; photos are our own renders in public/catalog-demo/.

export const DEMO_SLUG = 'demo'
export const DEMO_NAME = 'Ukázkový sklad (demo)'

export interface DemoProduct {
  key: string // photo public/catalog-demo/<key>.jpg
  name: string
  brand: string
  category: string // Heureka CATEGORYTEXT
  wholesale: number // CZK incl. VAT
  retail: number
  stock: number
  description: string
}

export const DEMO_PRODUCTS: DemoProduct[] = [
  { key: 'hrnek', name: 'Keramický hrnek 350 ml, zelená glazura', brand: 'Hlína Studio', category: 'Domácnost | Kuchyně | Hrnky a šálky', wholesale: 129, retail: 249, stock: 140, description: 'Ručně glazovaný kameninový hrnek s pevným uchem. Vhodný do myčky i mikrovlnné trouby.' },
  { key: 'karafa', name: 'Skleněná karafa na vodu 1 l se sklenicí', brand: 'Hlína Studio', category: 'Domácnost | Kuchyně | Karafy a džbány', wholesale: 189, retail: 389, stock: 62, description: 'Karafa z borosilikátového skla a sklenice, která slouží zároveň jako víčko.' },
  { key: 'prkenko', name: 'Dubové krájecí prkénko 40 × 24 cm', brand: 'Hlína Studio', category: 'Domácnost | Kuchyně | Prkénka', wholesale: 249, retail: 499, stock: 48, description: 'Masivní dub ošetřený potravinářským olejem. Jedna strana na krájení, druhá na servírování.' },
  { key: 'dozy', name: 'Sada 2 skleněných dóz s bambusovým víčkem', brand: 'Hlína Studio', category: 'Domácnost | Kuchyně | Dózy na potraviny', wholesale: 199, retail: 429, stock: 85, description: 'Dózy 1,2 l a 0,8 l na mouku, těstoviny nebo kávu. Víčko s těsněním drží potraviny čerstvé.' },
  { key: 'davkovac', name: 'Keramický dávkovač na mýdlo s houbičkou', brand: 'Pura', category: 'Domácnost | Úklid | Dávkovače', wholesale: 159, retail: 329, stock: 70, description: 'Matný keramický dávkovač 350 ml s kovovou pumpičkou. V balení houbička na nádobí.' },
  { key: 'box', name: 'Plstěný úložný box s víkem 40 × 28 cm', brand: 'Domovina', category: 'Domácnost | Úložné boxy', wholesale: 229, retail: 479, stock: 54, description: 'Pevný box z recyklované plsti s koženými úchyty. Na hračky, oblečení i dokumenty.' },
  { key: 'svicka', name: 'Sójová svíčka ve skle, levandule', brand: 'Lumo', category: 'Domácnost | Dekorace | Svíčky', wholesale: 159, retail: 329, stock: 120, description: 'Svíčka ze sójového vosku s bavlněným knotem, hoří přibližně 40 hodin.' },
  { key: 'vaza', name: 'Skleněná váza Vlna 30 cm', brand: 'Lumo', category: 'Domácnost | Dekorace | Vázy', wholesale: 219, retail: 449, stock: 33, description: 'Foukané sklo s jemně zvlněným tvarem v mořské barvě.' },
  { key: 'difuzer', name: 'Aroma difuzér s ratanovými tyčinkami 100 ml', brand: 'Lumo', category: 'Domácnost | Dekorace | Bytové vůně', wholesale: 179, retail: 359, stock: 90, description: 'Vůně cedru a pomeranče, vydrží až 8 týdnů. Lahvička z jantarového skla.' },
  { key: 'lampa', name: 'Stolní lampa Kopule', brand: 'Lumo', category: 'Domácnost | Osvětlení', wholesale: 690, retail: 1390, stock: 18, description: 'Keramická noha a textilní stínidlo, patice E14. Teplé světlo do ložnice i obýváku.' },
  { key: 'kvetinac', name: 'Terakotový květináč s podmiskou 18 cm', brand: 'Verdi', category: 'Dům a zahrada | Květináče', wholesale: 139, retail: 299, stock: 75, description: 'Pálená hlína, odtokový otvor a podmiska v sadě. Rostlina není součástí balení.' },
  { key: 'konvicka', name: 'Kovová konvička na květiny 1,5 l', brand: 'Verdi', category: 'Dům a zahrada | Zalévání', wholesale: 199, retail: 429, stock: 40, description: 'Pozinkovaná ocel s dlouhou hubičkou a jemnou kropítkovou koncovkou.' },
  { key: 'serum', name: 'Pleťové sérum s kyselinou hyaluronovou 30 ml', brand: 'Pura', category: 'Kosmetika | Péče o pleť', wholesale: 149, retail: 349, stock: 110, description: 'Hydratační sérum pro všechny typy pleti. Bez parfemace.' },
  { key: 'krem', name: 'Hydratační denní krém 50 ml', brand: 'Pura', category: 'Kosmetika | Péče o pleť', wholesale: 169, retail: 379, stock: 95, description: 'Lehký krém s bambuckým máslem a niacinamidem ve skleněném kelímku.' },
  { key: 'mydlo', name: 'Přírodní mýdlo, oves a med, 2 ks', brand: 'Pura', category: 'Kosmetika | Mýdla', wholesale: 59, retail: 139, stock: 200, description: 'Ručně vařené mýdlo z rostlinných olejů. Dva kusy po 100 g.' },
  { key: 'termolahev', name: 'Nerezová termoláhev 750 ml', brand: 'Kinetik', category: 'Sport | Lahve a shakery', wholesale: 249, retail: 549, stock: 66, description: 'Dvojitá stěna drží nápoj 24 hodin studený a 12 hodin teplý.' },
  { key: 'shaker', name: 'Shaker na proteinové nápoje 600 ml', brand: 'Kinetik', category: 'Sport | Lahve a shakery', wholesale: 89, retail: 199, stock: 150, description: 'Bez BPA, se sítkem a těsným šroubovacím víčkem.' },
  { key: 'cinka', name: 'Jednoruční činka 4 kg', brand: 'Kinetik', category: 'Sport | Posilování', wholesale: 290, retail: 590, stock: 24, description: 'Litina s pogumovaným povrchem a chromovaným úchopem. Šestihranná, nekutálí se.' },
  { key: 'joga', name: 'Podložka na jógu 183 × 61 cm s popruhem', brand: 'Kinetik', category: 'Sport | Jóga', wholesale: 390, retail: 849, stock: 37, description: 'Protiskluzová podložka tloušťky 6 mm, popruh na nošení v balení.' },
  { key: 'reproduktor', name: 'Bluetooth reproduktor Tón', brand: 'Tonik', category: 'Elektronika | Audio', wholesale: 590, retail: 1290, stock: 29, description: 'Výdrž 12 hodin, voděodolnost IPX5, poutko na zavěšení.' },
]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The demo supplier's Heureka feed; photos and links point at `origin` (the host that serves it). */
export function demoFeedXml(origin: string): string {
  const base = origin.replace(/\/+$/, '')
  const items = DEMO_PRODUCTS.map((p, i) => [
    '<SHOPITEM>',
    `<ITEM_ID>demo-${p.key}</ITEM_ID>`,
    `<PRODUCTNAME>${esc(p.name)}</PRODUCTNAME>`,
    `<DESCRIPTION>${esc(p.description)}</DESCRIPTION>`,
    `<URL>${base}/catalog-demo/${p.key}.jpg</URL>`,
    `<IMGURL>${base}/catalog-demo/${p.key}.jpg</IMGURL>`,
    `<PRICE_VAT>${p.retail}</PRICE_VAT>`,
    `<NAKUPNI_CENA>${p.wholesale}</NAKUPNI_CENA>`,
    '<CURRENCY>CZK</CURRENCY>',
    `<MANUFACTURER>${esc(p.brand)}</MANUFACTURER>`,
    `<CATEGORYTEXT>${esc(p.category)}</CATEGORYTEXT>`,
    `<PRODUCTNO>DEMO-${String(i + 1).padStart(3, '0')}</PRODUCTNO>`,
    `<STOCK_QUANTITY>${p.stock}</STOCK_QUANTITY>`,
    '<DELIVERY_DATE>1</DELIVERY_DATE>',
    '</SHOPITEM>',
  ].join(''))
  return `<?xml version="1.0" encoding="utf-8"?>\n<SHOP>\n${items.join('\n')}\n</SHOP>\n`
}

/** The supplier row the admin's "Add demo supplier" saves (order e-mail = that admin's own address). */
export function demoSupplierInput(origin: string, adminEmail: string) {
  return {
    name: DEMO_NAME,
    slug: DEMO_SLUG,
    feedUrl: `${origin.replace(/\/+$/, '')}/api/catalog/demo-feed`,
    feedFormat: 'heureka',
    wholesaleField: 'NAKUPNI_CENA',
    wholesaleDiscountPct: '',
    currency: 'CZK',
    orderEmail: adminEmail,
    dispatchDays: '1',
    shipsTo: 'CZ, SK',
    note: 'Demo: made-up products for trying the catalog. Only admins see it; orders go to the admin who added it.',
  }
}

/** Top-level category of a feed category ("Domácnost | Kuchyně | Hrnky" → "Domácnost"). */
export function topCategory(category: string): string {
  return category.split(/[|>]/)[0]?.trim() ?? ''
}

export interface Facet { name: string; count: number }

/** Counts for the catalog's filter sidebar: top-level categories and brands, biggest first. */
export function facetsOf(rows: Array<{ brand: string; category: string }>, maxBrands = 40): { categories: Facet[]; brands: Facet[] } {
  const cats = new Map<string, number>()
  const brands = new Map<string, number>()
  for (const r of rows) {
    const c = topCategory(r.category)
    if (c) cats.set(c, (cats.get(c) ?? 0) + 1)
    const b = r.brand.trim()
    if (b) brands.set(b, (brands.get(b) ?? 0) + 1)
  }
  const sorted = (m: Map<string, number>) => [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'cs'))
  return { categories: sorted(cats), brands: sorted(brands).slice(0, maxBrands) }
}

/** A LIKE pattern for "category starts with <top>" with %, _ and \ escaped. */
export function categoryPrefixPattern(top: string): string {
  return `${top.trim().slice(0, 80).replace(/[\\%_]/g, (c) => '\\' + c)}%`
}

export const CATALOG_SORTS = ['relevance', 'price-asc', 'price-desc', 'name'] as const
export type CatalogSort = (typeof CATALOG_SORTS)[number]
export const parseSort = (v: unknown): CatalogSort => (CATALOG_SORTS as readonly string[]).includes(v as string) ? (v as CatalogSort) : 'relevance'
