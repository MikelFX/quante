import type { CSSProperties, ReactNode } from 'react'
import type { Locale, QuanteModule } from '@/content/assetra/modules'
import { MV_EN } from './module-visual-en'
import { LoopVideo } from './ai/LoopVideo'

/*
 * Animated mini-UIs of the Quante modules: the product cards on the website and the demo under each
 * /quante/<modul> hero. Each one plays the module's real workflow in three steps (the step bar on
 * top follows along) on one CSS loop of --T seconds — no JavaScript, decorative, hidden from
 * assistive tech. Styles and the timing model are in module-visuals.css:
 *
 *   .mv-s   a scene; style --s = 0 | 1 | 2 shows it in that third of the loop
 *   .mv-i   appears --d seconds into its scene (.mv-o disappears), .mv-ty types, .mv-fl fills,
 *           .mv-pr presses, .mv-rip is a click ring — all inherit --s from their scene
 *   .mv-cur the pointer; its path is a per-module keyframe in absolute loop percentages
 *
 * Everything is laid out in stage units (--u, from the card's size) on a 31 × 21.4 u stage
 * (.mv-main), so the pointer's keyframe coordinates land on the buttons it clicks. With reduced motion or
 * animations off, the last scene stands still.
 */

/** The mini-UIs' words in the page's language (English: ./module-visual-en.ts, keyed by the Czech). */
type Tx = (cs: string) => string
const txFor = (locale: Locale): Tx => (locale === 'en' ? (s) => MV_EN[s] ?? s : (s) => s)

type Vars = CSSProperties & { [k: `--${string}`]: string | number }
const sc = (s: number): Vars => ({ '--s': s })
const at = (d: number, more?: Vars): Vars => ({ '--d': `${d}s`, ...more })
/** n stage units (--u, set from the container size, so it means the same in every element). */
const u = (n: number) => `calc(${n} * var(--u))`
const box = (left: number, top: number, width?: number, height?: number, more?: Vars): Vars => ({
  left: u(left),
  top: u(top),
  ...(width !== undefined && { width: u(width) }),
  ...(height !== undefined && { height: u(height) }),
  ...more,
})
const typed = (n: number, d: number): Vars => ({ '--n': n, '--d': `${d}s` })

function Frame({ name, steps, t, cursor, children, dev, tx }: {
  tx: Tx
  name: string
  steps: [string, string, string]
  t: number
  cursor?: string
  children: ReactNode
  dev?: boolean
}) {
  return (
    <div className="pv mv-pv" aria-hidden="true">
      <div className="mv" style={{ '--T': `${t}s` } as Vars}>
        <div className="mv-st">
          <div className="mv-bar">
            <b className="mv-app">{name}</b>
            <ol className="mv-steps">
              {steps.map((label, i) => (
                <li key={label} style={sc(i)}><b>{String(i + 1).padStart(2, '0')}</b><span>{label}</span></li>
              ))}
            </ol>
          </div>
          <div className="mv-main">
            {children}
            {cursor && <Cursor kind={cursor} />}
          </div>
          {dev && <span className="mv-dev">{tx('Ve vývoji')}</span>}
        </div>
      </div>
    </div>
  )
}

function Cursor({ kind }: { kind: string }) {
  return (
    <svg className={`mv-cur mv-c-${kind}`} viewBox="0 0 24 24">
      <path d="M2 1.5 L2 19 L7 14.6 L10.4 22 L13.6 20.6 L10.3 13.4 L17 13.4 Z" />
    </svg>
  )
}

/** A click ring at (x, y) of the stage, `d` seconds into the scene it sits in. */
const Rip = ({ x, y, d }: { x: number; y: number; d: number }) => (
  <i className="mv-rip" style={box(x, y, undefined, undefined, at(d))} />
)

/** Spinner that turns into a check `done` seconds into the scene. */
const Tick = ({ done, warn }: { done: number; warn?: boolean }) => (
  <span className="mv-tk">
    <i className="mv-spin mv-o" style={at(done)} />
    <i className={`mv-ok mv-i mv-pop${warn ? ' mv-warn' : ''}`} style={at(done)}>{warn ? '!' : '✓'}</i>
  </span>
)

/** Window chrome: three dots and an address pill. */
const Bar = ({ url, live }: { url?: string; live?: boolean }) => (
  <div className="mv-wb">
    <span className="mv-dots"><i /><i /><i /></span>
    {url && <span className="mv-url"><i className="mv-lock" />{url}</span>}
    {live && <span className="mv-live">online</span>}
  </div>
)

type Product = { n: string; p: string; art: 'bowl' | 'cup' | 'vase' | 'bag'; h: number }

/** Abstract product photo: a tinted backdrop and a silhouette (hue 0 accent, 1 lilac, 2 warm). */
const Art = ({ art, h, className = '' }: { art: Product['art']; h: number; className?: string }) => (
  <span className={`mv-art mv-${art} mv-h${h} ${className}`} />
)

/**
 * The generated store: 31 × 19.4 em, laid out absolutely so the pointer can find its buttons.
 * Always in the opposite scheme of the page (a lit screen on the dark site, a dark one on the light
 * site) and in its own brand colours — never AssetraDigital's.
 */
function Shop({ brand, kicker, title, sub, cta, products, hero, hot, tx }: {
  tx: Tx
  brand: string
  kicker: string
  title: string
  sub: string
  cta: string
  products: Product[]
  hero: Product['art']
  hot?: number
}) {
  return (
    <div className="mv-shop">
      <div className="mv-nav">
        <b>{brand}</b>
        <span>{tx('Kolekce')}</span><span>{tx('O nás')}</span><span>{tx('Kontakt')}</span>
        <i className="mv-cart" />
      </div>
      <div className="mv-hero">
        <small>{kicker}</small>
        <h4>{title}</h4>
        <p>{sub}</p>
        <span className="mv-cta">{cta}</span>
      </div>
      <Art art={hero} h={2} className="mv-heroimg" />
      <div className="mv-prods">
        {products.map((p, i) => (
          <div key={p.n} className="mv-pc">
            <Art art={p.art} h={p.h} />
            <span className="mv-pnm">{tx(p.n)}</span>
            <b>{p.p}</b>
            {hot === i && <span className="mv-buy">{tx('Do košíku')}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

const ceramics: Product[] = [
  { n: 'Miska Písek', p: '490 Kč', art: 'bowl', h: 2 },
  { n: 'Hrnek Mlha', p: '390 Kč', art: 'cup', h: 1 },
  { n: 'Váza Kámen', p: '1 290 Kč', art: 'vase', h: 0 },
]
const coffee: Product[] = [
  { n: 'Etiopie Guji', p: '289 Kč', art: 'bag', h: 2 },
  { n: 'Kolumbie Huila', p: '319 Kč', art: 'bag', h: 0 },
  { n: 'Espresso směs', p: '259 Kč', art: 'bag', h: 1 },
]

/** The cramped old e-shop that Qscan reads (13 × 21.4 em). */
const OldShop = () => (
  <div className="mv-old">
    <i className="mv-hd" /><i className="mv-bn" />
    {[0, 1, 2, 3, 4, 5].map((k) => (
      <span key={k} className="mv-tl" style={box(0.8 + (k % 2) * 6, 6.6 + Math.floor(k / 2) * 5, 5.4, 4.4)}><i /><i /></span>
    ))}
  </div>
)

/**
 * Qads plays two real ads in turn (owner, 2026-11-05): Character videos for Branka that were shared
 * on the public Qads wall — the woman with the door reader and the woman with the app. Files in
 * public/qads/demo/: the wall's light 432 px loops + poster frames, the product photo cut from the
 * video, the character's face from its sheet. Never point this at the private originals.
 */
const QD = '/qads/demo/'
const qadsAds = [
  {
    file: 'branka-zamek',
    name: 'Branka · vstup do fitka',
    photo: QD + 'branka-zamek-foto.webp',
    photoName: 'ctecka.jpg',
    screen: false,
    say: '„Klepnu a jsem ve fitku.“',
    hook: 'Dveře fitka otevřete telefonem',
    title: 'Bez čipů, karet a klíčů',
    cta: 'Vyzkoušejte Branku',
  },
  {
    file: 'branka-aplikace',
    name: 'Branka · aplikace',
    photo: '/branka/domu.webp',
    photoName: 'aplikace.png',
    screen: true,
    say: '„Celé fitko mám v telefonu.“',
    hook: 'Kurty a lekce v jedné aplikaci',
    title: 'Rezervace kurtů, lekcí i trenérů',
    cta: 'Stáhněte si Branku',
  },
]

/** A real image in the stage (decorative: the whole visual is hidden from assistive tech). */
const Img = ({ src, className }: { src: string; className?: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img className={className} src={src} alt="" loading="lazy" decoding="async" draggable={false} />
)

/** Voice waveform heights (stage units). */
const wave = [1.2, 2.2, 3.1, 1.8, 2.7, 3.4, 2.1, 1.4, 2.9, 3.2, 1.7, 2.4, 3.3, 2.0, 1.3, 2.6, 3.0, 1.9, 2.5, 1.5, 2.8, 3.1, 1.6, 2.2]

const inbox = [
  { st: 'zrno.cz', c: 0, s: 'Objednávka #2042', t: '09:41' },
  { st: 'keramika.cz', c: 2, s: 'Dotaz na doručení', t: '09:38' },
  { st: 'hlina.cz', c: 1, s: 'Reklamace hrnku', t: '09:20' },
  { st: 'zrno.cz', c: 0, s: 'Kdy dorazí balík?', t: '09:12' },
  { st: 'keramika.cz', c: 2, s: 'Velkoobchodní ceník', t: '08:55' },
]

export function ModuleVisual({ slug, locale = 'cs' }: { slug: QuanteModule['slug']; locale?: Locale }) {
  const tx = txFor(locale)
  /** typed() needs the length of the text that types in: the English one, or the tuned Czech count. */
  const tn = (cs: string, n: number) => (locale === 'en' ? tx(cs).length : n)
  switch (slug) {
    case 'generate':
      return (
        <Frame tx={tx} name="Generate" steps={[tx('Zadání'), tx('Stavba'), tx('Hotovo')]} t={15} cursor="gen">
          {/* 1 — the brief, as a conversation */}
          <div className="mv-s" style={sc(0)}>
            <div className="mv-msg mv-i" style={box(0, 0.2, undefined, undefined, at(0.1))}><small>Quante</small>{tx('Co budete prodávat a komu?')}</div>
            <div className="mv-msg u mv-i mv-r" style={{ right: 0, top: u(3.5), ...at(0.6) }}>
              <span className="mv-ty" style={typed(tn('Ručně točenou keramiku, klidný styl', 34), 0.7)}>{tx('Ručně točenou keramiku, klidný styl')}</span><i className="mv-car" />
            </div>
            <div className="mv-msg mv-i" style={box(0, 6.7, 29, undefined, at(2.2))}>
              <small>{tx('Quante · návrh')}</small>
              <div className="mv-chips">
                <span className="mv-i mv-pop" style={at(2.5)}><i className="mv-sw mv-h2" />{tx('Písková paleta')}</span>
                <span className="mv-i mv-pop" style={at(2.7)}><em className="mv-serif">Aa</em>{tx('Patkové písmo')}</span>
                <span className="mv-i mv-pop" style={at(2.9)}>{tx('24 produktů')}</span>
                <span className="mv-i mv-pop" style={at(3.1)}>{tx('CZK · Zásilkovna')}</span>
              </div>
            </div>
            <div className="mv-mood mv-i" style={box(0, 13.7, 18.6, 4.4, at(3.2))}>
              <Art art="vase" h={2} /><Art art="bowl" h={1} /><Art art="cup" h={0} />
              <span className="mv-serif">{tx('Hlína')}<br /><small>{tx('a glazura')}</small></span>
            </div>
            <span className="mv-btn mv-i" style={box(20.6, 18.4, 10.4, 2.6, at(3.4))}>
              <span className="mv-pr" style={at(4.05)}>{tx('Vytvořit e-shop →')}</span>
            </span>
            <span className="mv-hint mv-i" style={box(0, 19.2, 18, undefined, at(3.4))}>{tx('Kód bude váš · stažení jako ZIP')}</span>
            <Rip x={25.8} y={19.7} d={4.1} />
          </div>

          {/* 2 — the build: log on the left, the store assembling on the right, one failed build fixed */}
          <div className="mv-s" style={sc(1)}>
            <ul className="mv-log" style={box(0, 0, 12.6)}>
              <li className="mv-i" style={at(0.1)}><Tick done={0.8} />{tx('Vzhled a písma')}</li>
              <li className="mv-i" style={at(0.7)}><Tick done={1.4} />{tx('Stránky a texty')}</li>
              <li className="mv-i" style={at(1.3)}><Tick done={2.0} />{tx('24 produktů')}</li>
              <li className="mv-i" style={at(1.9)}><Tick done={2.5} />{tx('Košík a pokladna')}</li>
              <li className="mv-i" style={at(2.5)}><Tick done={3.0} warn />{tx('Build na Vercelu')}</li>
              <li className="mv-i mv-warn" style={at(3.05)}><Tick done={3.8} />{tx('Chyba → opravuji')}</li>
              <li className="mv-i mv-done" style={at(3.9)}><span className="mv-tk"><i className="mv-ok mv-i mv-pop" style={at(3.9)}>✓</i></span>{tx('Sestaveno')}</li>
            </ul>
            <div className="mv-track" style={box(0, 18.4, 12.6)}>
              <i className="mv-fl" style={at(0.1)} />
            </div>
            <span className="mv-hint" style={box(0, 19.4, 12.6)}>{tx('oprava 1 / 5 · zdarma')}</span>
            <div className="mv-win mv-wire" style={box(13.6, 0, 17.4, 21.4)}>
              <Bar url={tx('náhled')} />
              <i className="mv-i" style={box(0.8, 2.8, 15.8, 1.4, at(0.2))} />
              <i className="mv-i" style={box(0.8, 5, 7.6, 1.6, at(0.8))} />
              <span className="mv-wt mv-ty" style={{ ...box(0.8, 5, 7.6), ...typed(tn('Ručně točená keramika', 22), 2.1) }}>{tx('Ručně točená keramika')}</span>
              <i className="mv-i" style={box(0.8, 7.2, 6.4, 0.7, at(0.9))} />
              <i className="mv-i" style={box(0.8, 8.4, 3.6, 1.3, at(1))} />
              <i className="mv-i mv-shim" style={box(9.2, 5, 7.4, 5.4, at(0.8))} />
              {[0, 1, 2].map((k) => (
                <i key={k} className="mv-i mv-pop" style={box(0.8 + k * 5.4, 11.4, 4.8, 5.6, at(1.4 + k * 0.2))} />
              ))}
              {[0, 1, 2].map((k) => (
                <span key={k} className="mv-i mv-colour" style={box(0.8 + k * 5.4, 11.4, 4.8, 4, at(2.8 + k * 0.2))}>
                  <Art art={ceramics[k].art} h={ceramics[k].h} />
                </span>
              ))}
              <span className="mv-i mv-colour" style={box(9.2, 5, 7.4, 5.4, at(2.6))}><Art art="vase" h={2} /></span>
              <i className="mv-i" style={box(0.8, 18, 15.8, 1.6, at(2.2))} />
            </div>
          </div>

          {/* 3 — the live store; a shopper adds a product to the cart */}
          <div className="mv-s mv-last" style={sc(2)}>
            <div className="mv-win" style={box(0, 0, 31, 21.4)}>
              <Bar url="hlina-keramika.cz" live />
              <Shop
                tx={tx}
                brand="HLÍNA"
                kicker={tx('Nová kolekce')}
                title={tx('Ručně točená keramika')}
                sub={tx('Z dílny na Vysočině, každý kus jiný.')}
                cta={tx('Prohlédnout')}
                products={ceramics}
                hero="vase"
                hot={1}
              />
              <span className="mv-badge mv-i mv-pop" style={box(28.9, 2.35, undefined, undefined, at(3.25))}>1</span>
              <span className="mv-toast mv-i mv-dn" style={{ right: u(0.8), top: u(4.6), ...at(0.6) }}>{tx('✓ Nasazeno na Vercel')}</span>
              <span className="mv-toast mv-i mv-dn" style={{ right: u(0.8), top: u(6.6), ...at(3.4) }}>{tx('Přidáno do košíku')}</span>
            </div>
            <span className="mv-flash" style={box(11.5, 19.2, 8, 1.25, at(3.05))} />
            <Rip x={15.5} y={19.8} d={3.1} />
          </div>
        </Frame>
      )

    case 'qscan':
      return (
        <Frame tx={tx} name="Qscan" steps={[tx('Adresa'), tx('Sken'), tx('Nový obchod')]} t={15} cursor="scan">
          {/* 1 — address + consent, then scan */}
          <div className="mv-s" style={sc(0)}>
            <div className="mv-card" style={box(3.5, 3.2, 24, 14.8)}>
              <span className="mv-lbl" style={box(1.4, 1.3)}>{tx('Převod e-shopu podle adresy')}</span>
              <div className="mv-inp" style={box(1.4, 3, 21.2, 2.8)}>
                <span className="mv-dim">https://</span>
                <span className="mv-ty" style={typed(15, 0.3)}>stary-obchod.cz</span><i className="mv-car" />
              </div>
              <span className="mv-chk" style={box(1.4, 6.6)}>
                <i className="mv-cb"><b className="mv-i mv-pop" style={at(1.85)}>✓</b></i>
                {tx('Obchod je můj a obsah smím použít')}
              </span>
              <span className="mv-btn" style={box(1.4, 9, 21.2, 2.8)}><span className="mv-pr" style={at(3.05)}>{tx('Naskenovat')}</span></span>
              <span className="mv-hint" style={box(1.4, 12.6)}>Shopify · WooCommerce · Shoptet · web</span>
            </div>
            <Rip x={5.6} y={10.5} d={1.8} />
            <Rip x={15.5} y={13.6} d={3.1} />
          </div>

          {/* 2 — crawl: products found on the old site, photos copied over */}
          <div className="mv-s" style={sc(1)}>
            <div style={box(0, 0, 13, 21.4, { position: 'absolute' })}>
              <OldShop />
              {[0, 1, 2, 3, 4, 5].map((k) => (
                <span key={k} className="mv-hit mv-i mv-pop" style={box(0.8 + (k % 2) * 6, 6.6 + Math.floor(k / 2) * 5, 5.4, 4.4, at(0.5 + k * 0.3))}>
                  {k === 0 && <em>{tx('produkt')}</em>}
                </span>
              ))}
              <i className="mv-beam" />
            </div>
            <span className="mv-lbl" style={box(14, 0.2)}>{tx('Nalezeno · stary-obchod.cz')}</span>
            <ul className="mv-found" style={box(14, 1.8, 17)}>
              <li className="mv-i mv-r" style={at(0.5)}>{tx('Produkty')}<b>48</b></li>
              <li className="mv-i mv-r" style={at(0.9)}>{tx('Varianty')}<b>112</b></li>
              <li className="mv-i mv-r" style={at(1.3)}>{tx('Fotky')}<b>126</b></li>
              <li className="mv-i mv-r" style={at(1.7)}>{tx('Videa')}<b>2</b></li>
              <li className="mv-i mv-r" style={at(2.1)}>{tx('Texty a SEO')}<b>✓</b></li>
              <li className="mv-i mv-r" style={at(2.5)}>{tx('Barvy a písma')}<b><i className="mv-sw mv-h0" /><i className="mv-sw mv-h1" /><i className="mv-sw mv-h2" /></b></li>
            </ul>
            <div className="mv-copy mv-i" style={box(14, 16.4, 17, 4.6, at(2.6))}>
              <span>{tx('Kopíruji fotky k nám')}</span>
              <div className="mv-track"><i className="mv-fl" style={at(2.7)} /></div>
            </div>
            {[0, 1, 2].map((k) => (
              <i key={k} className="mv-thumb mv-fly" style={box(2 + (k % 2) * 6, 8 + k * 4, 2.2, 2.2, { ...at(2.8 + k * 0.45), '--fx': u(17 - (k % 2) * 6 + k * 1.4), '--fy': u(10.6 - k * 4) })} />
            ))}
          </div>

          {/* 3 — before / after, and what to do with the new store */}
          <div className="mv-s mv-last" style={sc(2)}>
            <span className="mv-lbl" style={box(0, 0)}>{tx('Před')}</span>
            <div className="mv-before" style={box(0, 1.4, 8.06, 13.3)}><OldShop /></div>
            <span className="mv-arrow mv-i mv-l" style={box(8.5, 6.4, 2.6, undefined, at(0.3))}>→</span>
            <span className="mv-lbl acc" style={box(11.4, 0)}>{tx('Po · nový obchod v Quante')}</span>
            <div className="mv-after mv-i" style={box(11.4, 1.4, 19.53, 13.48, at(0.4))}>
              <div className="mv-win" style={box(0, 0, 31, 21.4)}>
                <Bar url="zrno-prazirna.cz" />
                <Shop
                tx={tx}
                  brand="ZRNO"
                  kicker={tx('Pražírna')}
                  title={tx('Káva pražená tento týden')}
                  sub={tx('Výběrová zrna, odesíláme do 24 hodin.')}
                  cta={tx('Vybrat kávu')}
                  products={coffee}
                  hero="bag"
                />
              </div>
            </div>
            <span className="mv-toast mv-i mv-pop" style={box(12.4, 12.6, undefined, undefined, at(1))}>{tx('✓ 48 produktů převedeno')}</span>
            <span className="mv-btn mv-i" style={box(0, 16.6, 9.93, 2.6, at(1.6))}><span className="mv-pr" style={at(3.05)}>{tx('Upravit ve Studiu')}</span></span>
            <span className="mv-btn mv-gl mv-i" style={box(10.53, 16.6, 9.93, 2.6, at(1.8))}><span>Hosting</span></span>
            <span className="mv-btn mv-gl mv-i" style={box(21.07, 16.6, 9.93, 2.6, at(2))}><span>{tx('Stáhnout kód')}</span></span>
            <span className="mv-hint mv-i" style={box(0, 19.8, 31, undefined, at(2.2))}>{tx('Fotky a videa už jsou u nás. Starý obchod můžete vypnout.')}</span>
            <Rip x={4.97} y={17.9} d={3.1} />
          </div>
        </Frame>
      )

    case 'qgent':
      return (
        <Frame tx={tx} name="Qgent" steps={[tx('Kontrola'), tx('Návrh'), tx('Hotovo')]} t={16} cursor="agent">
          {/* the merchant's store stays in place; Qgent's panel changes beside it */}
          <div className="mv-win mv-narrow" style={box(0, 0, 12.6, 21.4)}>
            <Bar />
            <div className="mv-shop">
              <div className="mv-nav"><b>HLÍNA</b><i className="mv-burger" /></div>
              <h4 style={box(0.9, 2.7, 10.8)}>{tx('Vítejte v našem obchodě')}</h4>
              <p style={box(0.9, 7, 10.8)}>{tx('Najdete u nás spoustu krásných věcí.')}</p>
              <span className="mv-cta" style={box(0.9, 8.9)}>{tx('Nakoupit')}</span>
              <Art art="vase" h={2} className="mv-abs" />
              <Art art="bowl" h={2} className="mv-abs t1" />
              <Art art="cup" h={1} className="mv-abs t2" />
            </div>
          </div>

          <div className="mv-s mv-cut" style={sc(0)}>
            <i className="mv-beam mv-n" />
            {[[5.2, 1.4], [10, 1.9], [14.8, 2.4]].map(([y, d], k) => (
              <span key={k} className="mv-pin mv-i mv-pop" style={box(11.2, y, undefined, undefined, at(d))}>{k + 1}</span>
            ))}
          </div>
          <div className="mv-s mv-cut" style={sc(1)}>
            <span className="mv-ring mv-i mv-pop" style={box(0.5, 4.4, 11.6, 4.6, at(0.4))}><em>{tx('nadpis')}</em></span>
          </div>
          <div className="mv-s mv-cut mv-last" style={sc(2)}>
            <div className="mv-patch" style={box(0.6, 4.4, 11.4, 4.6)}>
              <h4 className="mv-i" style={at(0.3)}>{tx('Ručně točená keramika z Vysočiny')}</h4>
            </div>
            <span className="mv-ring mv-done mv-i mv-pop" style={box(0.5, 4.4, 11.6, 4.6, at(0.4))}><em>{tx('✓ změněno')}</em></span>
          </div>

          <div className="mv-pnl" style={box(13.6, 0, 17.4, 21.4)}>
            <div className="mv-ph"><i className="mv-dot" />Qgent<span>{tx('Kontrola obchodu')}</span></div>
          </div>
          {/* 1 — review */}
          <div className="mv-s" style={sc(0)}>
            <span className="mv-btn" style={box(14.6, 3, 9.4, 2.2)}><span className="mv-pr" style={at(0.5)}>{tx('Spustit kontrolu')}</span></span>
            <span className="mv-hint mv-i" style={box(14.6, 5.9, 15.4, undefined, at(0.7))}>{tx('Procházím 9 stránek…')}</span>
            <div className="mv-track" style={box(14.6, 7, 15.4)}><i className="mv-fl" style={at(0.7)} /></div>
            {[
              [tx('Nadpis neříká, co prodáváte'), 'text'],
              [tx('Chybí informace o dopravě'), tx('obsah')],
              [tx('Fotky bez popisku'), 'SEO'],
            ].map(([t, tag], k) => (
              <div key={t} className="mv-find mv-i mv-r" style={box(14.6, 8 + k * 3.6, 15.4, 3.1, at(1.4 + k * 0.5))}>
                <b>{k + 1}</b><span>{t}</span><em>{tag}</em>
              </div>
            ))}
            <span className="mv-hint mv-i" style={box(14.6, 19.4, 15.4, undefined, at(2.9))}>{tx('3 návrhy · nic se nezmění bez potvrzení')}</span>
            <Rip x={19.3} y={4.1} d={0.55} />
          </div>
          {/* 2 — the proposal: a preview of the exact change */}
          <div className="mv-s" style={sc(1)}>
            <span className="mv-lbl" style={box(14.6, 3)}>{tx('Návrh 1 / 3')}</span>
            <div className="mv-find mv-big mv-i" style={box(14.6, 4.4, 15.4, 2.6, at(0.2))}><b>1</b><span>{tx('Nadpis neříká, co prodáváte')}</span></div>
            <div className="mv-diff mv-i" style={box(14.6, 7.6, 15.4, 7.2, at(0.6))}>
              <small>app/page.tsx</small>
              <del className="mv-i mv-l" style={at(1)}>{tx('Vítejte v našem obchodě')}</del>
              <ins className="mv-i mv-l" style={at(1.5)}>{tx('Ručně točená keramika z Vysočiny')}</ins>
            </div>
            <span className="mv-btn" style={box(14.6, 15.6, 5.6, 2.2)}><span className="mv-pr" style={at(3.35)}>{tx('Použít')}</span></span>
            <span className="mv-btn mv-gl" style={box(20.6, 15.6, 4.6, 2.2)}><span>{tx('Upravit')}</span></span>
            <span className="mv-btn mv-gl" style={box(25.6, 15.6, 4.4, 2.2)}><span>{tx('Zpět')}</span></span>
            <span className="mv-hint mv-i" style={box(14.6, 18.6, 15.4, undefined, at(2.2))}>{tx('Ceny, platby a doprava vždy s druhým potvrzením')}</span>
            <Rip x={17.4} y={16.7} d={3.4} />
          </div>
          {/* 3 — applied as a draft, undoable */}
          <div className="mv-s mv-last" style={sc(2)}>
            <div className="mv-log1 mv-i" style={box(14.6, 3, 15.4, 2.6, at(0.2))}>
              <i className="mv-ok">✓</i><span>{tx('Qgent: nový nadpis')}<small>{tx('koncept')}</small></span><em>{tx('Vrátit')}</em>
            </div>
            <div className="mv-msg mv-i" style={box(14.6, 6.4, 15.4, undefined, at(0.8))}><small>Qgent</small>{tx('Hotovo. Změna je v konceptu a jde kdykoli vrátit.')}</div>
            <div className="mv-find mv-i mv-r" style={box(14.6, 11.2, 15.4, 3.1, at(1.6))}><b>2</b><span>{tx('Doprava: čeká na vás')}</span><em>{tx('zobrazit')}</em></div>
            <div className="mv-find mv-i mv-r" style={box(14.6, 14.8, 15.4, 3.1, at(2))}><b>3</b><span>{tx('Popisky fotek')}</span><em>{tx('zobrazit')}</em></div>
            <span className="mv-toast mv-i mv-pop" style={box(14.6, 18.7, undefined, undefined, at(2.6))}>{tx('Podklady pro Qads připraveny')}</span>
          </div>
        </Frame>
      )

    case 'qdit':
      return (
        <Frame tx={tx} name="Qdit" steps={[tx('Vybrat'), tx('Upravit'), tx('Publikovat')]} t={16} cursor="edit">
          <div className="mv-win" style={box(0, 0, 31, 21.4)}>
            <div className="mv-eb">
              <span className="mv-dev3"><i className="mv-on" /><i /><i /></span>
              <span className="mv-page">{tx('Úvodní stránka')}</span>
              <span className="mv-state">{tx('Koncept')}</span>
              <span className="mv-pub"><span className="mv-pr" style={at(10.67 + 1.7)}>{tx('Publikovat')}</span></span>
            </div>
            <Shop
                tx={tx}
              brand="HLÍNA"
              kicker={tx('Podzim 2026')}
              title={tx('Nová kolekce')}
              sub={tx('Z dílny na Vysočině, každý kus jiný.')}
              cta={tx('Nakoupit')}
              products={ceramics}
              hero="vase"
            />
          </div>

          {/* 1 — hover, click, the element is selected with its toolbar */}
          <div className="mv-s mv-cut" style={sc(0)}>
            <span className="mv-hov mv-flash" style={box(0.7, 2.4, 5, 1.9, at(0.9))} />
            <span className="mv-sel mv-i" style={box(0.8, 5.5, 12.6, 2.6, at(1.85))}><em>{tx('h1 · Nadpis')}</em></span>
            <span className="mv-tb mv-i mv-l" style={box(14, 5.75, undefined, undefined, at(2.1))}><b>Aa</b><span>B</span><span>↕</span><span>AI</span></span>
            <Rip x={7} y={7} d={1.8} />
          </div>
          {/* 2 — retype the headline, then restyle the button from the panel */}
          <div className="mv-s mv-cut" style={sc(1)}>
            <span className="mv-patch mv-t" style={box(1, 5.9, 12.2, 2.3)}>
              <span className="mv-ty" style={typed(tn('Podzim v hlíně', 14), 0.1)}>{tx('Podzim v hlíně')}</span><i className="mv-car" />
            </span>
            <span className="mv-sel mv-o" style={box(0.8, 5.5, 12.6, 2.6, at(2))}><em>{tx('h1 · Nadpis')}</em></span>
            <span className="mv-cta2 mv-i" style={box(1.2, 11.5, 6.6, 1.4, at(3.05))}>{tx('Nakoupit')}</span>
            <span className="mv-cta2 wide mv-i" style={box(1.2, 11.5, 8, 1.4, at(4.1))}>{tx('Nakoupit')}</span>
            <span className="mv-sel mv-i" style={box(0.9, 11.2, 9.6, 2, at(2.05))}><em>{tx('Tlačítko')}</em></span>
            <div className="mv-props mv-i mv-r" style={box(21, 2.6, 9.4, 14, at(2.3))}>
              <small>{tx('Tlačítko · počítač')}</small>
              <label>{tx('Písmo')}<span>Geist 600</span></label>
              <label>{tx('Velikost')}<span>16 px</span></label>
              <label>{tx('Barva')}</label>
              <span className="mv-sws"><i className="mv-h0" /><i className="mv-h1" /><i className="mv-h2" /><i className="mv-h3" /></span>
              <i className="mv-swon mv-i mv-pop" style={at(3.05)} />
              <label>{tx('Odsazení')}</label>
              <span className="mv-slider"><i className="mv-knob" style={at(3.6)} /></span>
            </div>
            <Rip x={4.5} y={12.2} d={2} />
            <Rip x={25.9} y={10.4} d={3} />
          </div>
          {/* 3 — publish: shoppers see it only now */}
          <div className="mv-s mv-cut mv-last" style={sc(2)}>
            <span className="mv-patch mv-t" style={box(1, 5.9, 12.2, 2.3)}><span>{tx('Podzim v hlíně')}</span></span>
            <span className="mv-cta2 wide" style={box(1.2, 11.5, 8, 1.4)}>{tx('Nakoupit')}</span>
            <span className="mv-state mv-on mv-i" style={box(19.4, 0.45, undefined, undefined, at(1.9))}>{tx('Živě')}</span>
            <span className="mv-toast mv-i mv-dn" style={{ right: u(0.8), top: u(2.6), ...at(1.95) }}>{tx('✓ Publikováno · zákazníci vidí změny')}</span>
            <span className="mv-chg mv-i" style={box(14.4, 0.45, undefined, undefined, at(0.2))}>{tx('3 změny')}</span>
            <Rip x={27.4} y={1} d={1.75} />
          </div>
        </Frame>
      )

    case 'qads':
      return (
        <Frame tx={tx} name="Qads" steps={[tx('Fotka'), tx('Generuji'), tx('Video')]} t={15} cursor="ads">
          {qadsAds.map((raw, k) => {
            const tr = (a: typeof raw) => ({ ...a, name: tx(a.name), say: tx(a.say), hook: tx(a.hook), title: tx(a.title), cta: tx(a.cta) })
            const ad = tr(raw)
            const next = tr(qadsAds[(k + 1) % qadsAds.length])
            return (
              <div key={ad.file} className={`mv-ab${k ? ' mv-b' : ''}`}>
                {/* 1 — product photo, the character, the spoken line */}
                <div className="mv-s" style={sc(0)}>
                  <div className="mv-drop" style={box(0, 0, 11.6, 21.4)}>
                    <span className="mv-hint" style={box(0, 0.8, 11.6, undefined, { textAlign: 'center' })}>{tx('Fotka produktu')}</span>
                    <span className={`mv-photo mv-real${ad.screen ? ' mv-scr' : ''} mv-i mv-dn`} style={box(1.6, 2.8, 8.4, 11.6, at(0.3, { '--from': 'translateY(-4em) rotate(-6deg) scale(.9)' }))}>
                      <Img src={ad.photo} />
                    </span>
                    <span className="mv-hint mv-i" style={box(0, 15.4, 11.6, undefined, at(0.9, { textAlign: 'center' }))}>{ad.photoName} · {tx('nahráno')} ✓</span>
                  </div>
                  <span className="mv-lbl" style={box(12.6, 0)}>{tx('Název')}</span>
                  <div className="mv-inp" style={box(12.6, 0.9, 18.4, 2.2)}><span className="mv-ty" style={typed(ad.name.length, 0.9)}>{ad.name}</span><i className="mv-car" /></div>
                  <span className="mv-lbl" style={box(12.6, 3.7)}>{tx('Postava · Character')}</span>
                  <span className="mv-ava" style={box(12.6, 4.6, 2.6, 2.6)}><Img src={QD + 'postava.webp'} /></span>
                  <span className="mv-ava" style={box(15.6, 4.6, 2.6, 2.6)}><Img src={QD + 'postava-2.webp'} /></span>
                  <span className="mv-ava mv-add" style={box(18.6, 4.6, 2.6, 2.6)}>+</span>
                  <span className="mv-ava-on mv-i mv-pop" style={box(12.6, 4.6, 2.6, 2.6, at(1.85))}><i className="mv-ok">✓</i></span>
                  <span className="mv-hint mv-i" style={box(21.9, 5.3, 9.1, undefined, at(2.05))}>{tx('Stejná tvář v každém videu')}</span>
                  <span className="mv-lbl" style={box(12.6, 7.9)}>{tx('Formát · délka · jazyk')}</span>
                  <span className="mv-opt mv-on" style={box(12.6, 8.8, 3.6, 1.7)}>9:16</span>
                  <span className="mv-opt" style={box(16.4, 8.8, 3, 1.7)}>10 s</span>
                  <span className="mv-opt" style={box(19.6, 8.8, 3, 1.7)}>15 s</span>
                  <span className="mv-opt mv-on mv-i mv-pop" style={box(16.4, 8.8, 3, 1.7, at(2.6))}>10 s</span>
                  <span className="mv-opt" style={box(22.8, 8.8, 8.2, 1.7)}>{tx('Čeština')}</span>
                  <span className="mv-lbl" style={box(12.6, 11.4)}>{tx('Mluvené slovo')}</span>
                  <div className="mv-inp mv-say" style={box(12.6, 12.3, 18.4, 2.6)}><span className="mv-ty" style={typed(ad.say.length, 2.7)}>{ad.say}</span></div>
                  <span className="mv-btn" style={box(12.6, 16.6, 18.4, 2.6)}><span className="mv-pr" style={at(3.95)}>{tx('Generovat video')}</span></span>
                  <span className="mv-hint" style={box(12.6, 19.8, 18.4)}>{tx('Co se nepovede, to se vrátí v kreditech.')}</span>
                  <Rip x={13.9} y={5.9} d={1.85} />
                  <Rip x={21.8} y={17.9} d={4} />
                </div>

                {/* 2 — script, voice, render */}
                <div className="mv-s" style={sc(1)}>
                  <span className={`mv-photo mv-real sm${ad.screen ? ' mv-scr' : ''}`} style={box(0, 0.4, 5, 6.6)}><Img src={ad.photo} /></span>
                  <span className="mv-join" style={box(5.3, 2.75)}>+</span>
                  <span className="mv-ava" style={box(7.2, 1.5, 4.2, 4.2)}><Img src={QD + 'postava.webp'} /></span>
                  <ul className="mv-log" style={box(0, 8.2, 17.8)}>
                    <li className="mv-i" style={at(0.2)}><Tick done={0.9} />{tx('Scénář a háček')}</li>
                    <li className="mv-i" style={at(0.7)}><Tick done={1.7} />{tx('Hlas · čeština')}</li>
                    <li className="mv-i" style={at(1.2)}><Tick done={4.2} />{tx('Render 9:16 · Higgsfield')}</li>
                  </ul>
                  <div className="mv-wave mv-i" style={box(0, 16.9, 17.8, 3.6, at(0.9))}>
                    {wave.map((h, i) => <i key={i} style={{ height: u(h), animationDelay: `${-i * 0.13}s` }} />)}
                  </div>
                  <div className="mv-frm mv-rnd" style={box(19.1, 0, 11.9, 21.2)}>
                    <Img className="mv-blur" src={`${QD}${ad.file}.webp`} />
                    <span className="mv-rev" style={at(0.5)}><Img src={`${QD}${ad.file}.webp`} /></span>
                    <i className="mv-scan" style={at(0.5)} />
                    <em>9:16</em>
                    <div className="mv-track in"><i className="mv-fl" style={at(0.5)} /></div>
                  </div>
                </div>

                {/* 3 — the finished ad playing, its copy, download, the next one */}
                <div className="mv-s mv-last" style={sc(2)}>
                  <div className="mv-frm mv-rnd mv-vid" style={box(0, 0, 11.9, 21.2)}>
                    <LoopVideo className="mv-v" src={`${QD}${ad.file}.mp4`} poster={`${QD}${ad.file}.webp`} label={ad.hook} />
                    <em>9:16 · 10 s</em>
                    <span className="cap mv-i" style={at(0.6)}>{ad.hook}</span>
                    <span className="mv-ok mv-i mv-pop" style={at(0.3)}>✓</span>
                    <div className="mv-track in"><i className="run" /></div>
                  </div>
                  <span className="mv-lbl acc" style={box(13, 0.8)}>{tx('Video hotové')} · {k + 1} / {qadsAds.length}</span>
                  <span className="mv-btn" style={box(23.4, 0, 7.6, 2.4)}><span className="mv-pr" style={at(3.35)}>{tx('Stáhnout')}</span></span>
                  <div className="mv-copyx mv-i" style={box(13, 3.2, 18, 7.6, at(0.4))}>
                    <span><small>{tx('Háček')}</small>{ad.hook}</span>
                    <span><small>{tx('Titulek')}</small>{ad.title}</span>
                    <span><small>{tx('Výzva')}</small>{ad.cta}</span>
                    <b>{locale === 'en' ? 'EN' : 'CS'}</b>
                  </div>
                  {['TikTok', 'Reels', 'Shorts'].map((t, i) => (
                    <span key={t} className="mv-tab mv-i" style={box(13 + i * 4.6, 11.6, 4.2, 1.9, at(0.8 + i * 0.15))}>{t}</span>
                  ))}
                  <div className="mv-next mv-i mv-r" style={box(13, 14.6, 18, 6.6, at(1.3))}>
                    <Img src={`${QD}${next.file}.webp`} />
                    <span><small>{tx('Další reklama')}</small><b>{next.name}</b><em>{tx('Stejná postava, jiný produkt')}</em></span>
                  </div>
                  <span className="mv-toast mv-i mv-dn" style={{ right: 0, top: u(2.9), ...at(3.5) }}>{ad.file}.mp4 · {tx('stahuje se')}</span>
                  <Rip x={27.2} y={1.2} d={3.4} />
                </div>
              </div>
            )
          })}
        </Frame>
      )

    case 'qails':
      return (
        <Frame tx={tx} name="Qails" steps={[tx('Jedna schránka'), tx('Hledání'), tx('Podle obchodu')]} t={15} cursor="mail" dev>
          {['zrno.cz', 'hlina.cz', 'keramika.cz'].map((s, k) => (
            <span key={s} className="mv-store" style={box(0, 1.2 + k * 5.6, 8.6, 3.6)}><i className={`mv-sw mv-h${[0, 1, 2][k]}`} />{s}</span>
          ))}

          {/* 1 — mail from every store lands in one inbox */}
          <div className="mv-s" style={sc(0)}>
            <div className="mv-ibh" style={box(10, 0, 21)}>{tx('Všechny obchody')}<b className="mv-i mv-pop" style={at(3)}>{tx('12 nových')}</b></div>
            {inbox.map((m, k) => (
              <div key={m.s} className="mv-row mv-i mv-dn" style={box(10, 2.8 + k * 3.2, 21, 2.8, at(0.8 + k * 0.55))}>
                <i className={`mv-sw mv-h${m.c}`} /><em>{m.st}</em><span>{tx(m.s)}</span><small>{m.t}</small>
              </div>
            ))}
            {[0, 2, 1, 0, 2].map((src, k) => (
              <i key={k} className="mv-env mv-fly" style={box(7.8, 2.4 + src * 5.6, 1.6, 1.1, { ...at(0.1 + k * 0.55), '--fx': u(3.2), '--fy': u(1.2 + k * 3.2 - src * 5.6) })} />
            ))}
          </div>

          {/* 2 — one search across every store */}
          <div className="mv-s" style={sc(1)}>
            <div className="mv-inp" style={box(10, 0, 21, 2.3)}><span className="mv-dim">⌕</span><span className="mv-ty" style={typed(tn('doručení', 8), 0.3)}>{tx('doručení')}</span><i className="mv-car" /></div>
            {inbox.map((m, k) => (
              <div key={m.s} className="mv-row" style={box(10, 2.8 + k * 3.2, 21, 2.8)}>
                <i className={`mv-sw mv-h${m.c}`} /><em>{m.st}</em><span>{tx(m.s)}</span><small>{m.t}</small>
                {k === 1 || k === 3
                  ? <i className="mv-hitrow mv-i" style={at(1.6)} />
                  : <i className="mv-dimrow mv-i" style={at(1.5)} />}
              </div>
            ))}
            <span className="mv-hint mv-i" style={box(10, 19.2, 21, undefined, at(1.9))}>{tx('2 výsledky ze 2 obchodů')}</span>
          </div>

          {/* 3 — filtered by store */}
          <div className="mv-s mv-last" style={sc(2)}>
            {[[tx('Vše'), 12, 10, 4], ['zrno.cz', 5, 14.3, 5.3], ['keramika.cz', 4, 19.9, 6.3], ['hlina.cz', 3, 26.5, 4.5]].map(([t, n, x, w]) => (
              <span key={t} className="mv-tab" style={box(x as number, 0, w as number, 2.2)}>{t}<b>{n}</b></span>
            ))}
            <span className="mv-tab mv-on mv-i mv-pop" style={box(19.9, 0, 6.3, 2.2, at(1.25))}>keramika.cz<b>4</b></span>
            {[
              [tx('Dotaz na doručení'), '09:38'],
              [tx('Velkoobchodní ceník'), '08:55'],
              [tx('Objednávka #1187'), tx('včera')],
              [tx('Poděkování za balík'), tx('včera')],
            ].map(([s, t], k) => (
              <div key={s} className="mv-row mv-i mv-dn" style={box(10, 2.8 + k * 3.2, 21, 2.8, at(1.4 + k * 0.2))}>
                <i className="mv-sw mv-h2" /><em>keramika.cz</em><span>{s}</span><small>{t}</small>
              </div>
            ))}
            <Rip x={23.05} y={1.1} d={1.2} />
          </div>
        </Frame>
      )
  }
}
