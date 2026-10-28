import type { CSSProperties, ReactNode } from 'react'
import type { QuanteModule } from '@/content/assetra/modules'

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

function Frame({ name, steps, t, cursor, children, dev }: {
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
          {dev && <span className="mv-dev">Ve vývoji</span>}
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
function Shop({ brand, kicker, title, sub, cta, products, hero, hot }: {
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
        <span>Kolekce</span><span>O nás</span><span>Kontakt</span>
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
            <span className="mv-pnm">{p.n}</span>
            <b>{p.p}</b>
            {hot === i && <span className="mv-buy">Do košíku</span>}
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

/** Product bottle for Qads (scale it with font-size). */
const Bottle = ({ className = '', style }: { className?: string; style?: Vars }) => (
  <span className={`mv-btl ${className}`} style={style}><i className="cap" /><i className="lb">ROSA</i></span>
)

/** Qads frames: format, left edge and size in em (bottom aligned at 21.2 em). */
const formats = [
  { f: '9:16', x: 0, w: 6, h: 10.67, hook: 'Pleť jako po spánku' },
  { f: '4:5', x: 6.4, w: 7.4, h: 9.25, hook: 'Rosa · 30 ml' },
  { f: '1:1', x: 14.2, w: 7.6, h: 7.6, hook: 'Ranní rituál' },
  { f: '16:9', x: 22.2, w: 8.8, h: 4.95, hook: 'Vyzkoušejte' },
]

const inbox = [
  { st: 'zrno.cz', c: 0, s: 'Objednávka #2042', t: '09:41' },
  { st: 'keramika.cz', c: 2, s: 'Dotaz na doručení', t: '09:38' },
  { st: 'hlina.cz', c: 1, s: 'Reklamace hrnku', t: '09:20' },
  { st: 'zrno.cz', c: 0, s: 'Kdy dorazí balík?', t: '09:12' },
  { st: 'keramika.cz', c: 2, s: 'Velkoobchodní ceník', t: '08:55' },
]

export function ModuleVisual({ slug }: { slug: QuanteModule['slug'] }) {
  switch (slug) {
    case 'generate':
      return (
        <Frame name="Generate" steps={['Zadání', 'Stavba', 'Hotovo']} t={15} cursor="gen">
          {/* 1 — the brief, as a conversation */}
          <div className="mv-s" style={sc(0)}>
            <div className="mv-msg mv-i" style={box(0, 0.2, undefined, undefined, at(0.1))}><small>Quante</small>Co budete prodávat a komu?</div>
            <div className="mv-msg u mv-i mv-r" style={{ right: 0, top: u(3.5), ...at(0.6) }}>
              <span className="mv-ty" style={typed(34, 0.7)}>Ručně točenou keramiku, klidný styl</span><i className="mv-car" />
            </div>
            <div className="mv-msg mv-i" style={box(0, 6.7, 29, undefined, at(2.2))}>
              <small>Quante · návrh</small>
              <div className="mv-chips">
                <span className="mv-i mv-pop" style={at(2.5)}><i className="mv-sw mv-h2" />Písková paleta</span>
                <span className="mv-i mv-pop" style={at(2.7)}><em className="mv-serif">Aa</em>Patkové písmo</span>
                <span className="mv-i mv-pop" style={at(2.9)}>24 produktů</span>
                <span className="mv-i mv-pop" style={at(3.1)}>CZK · Zásilkovna</span>
              </div>
            </div>
            <div className="mv-mood mv-i" style={box(0, 13.7, 18.6, 4.4, at(3.2))}>
              <Art art="vase" h={2} /><Art art="bowl" h={1} /><Art art="cup" h={0} />
              <span className="mv-serif">Hlína<br /><small>a glazura</small></span>
            </div>
            <span className="mv-btn mv-i" style={box(20.6, 18.4, 10.4, 2.6, at(3.4))}>
              <span className="mv-pr" style={at(4.05)}>Vytvořit e-shop →</span>
            </span>
            <span className="mv-hint mv-i" style={box(0, 19.2, 18, undefined, at(3.4))}>Kód bude váš · stažení jako ZIP</span>
            <Rip x={25.8} y={19.7} d={4.1} />
          </div>

          {/* 2 — the build: log on the left, the store assembling on the right, one failed build fixed */}
          <div className="mv-s" style={sc(1)}>
            <ul className="mv-log" style={box(0, 0, 12.6)}>
              <li className="mv-i" style={at(0.1)}><Tick done={0.8} />Vzhled a písma</li>
              <li className="mv-i" style={at(0.7)}><Tick done={1.4} />Stránky a texty</li>
              <li className="mv-i" style={at(1.3)}><Tick done={2.0} />24 produktů</li>
              <li className="mv-i" style={at(1.9)}><Tick done={2.5} />Košík a pokladna</li>
              <li className="mv-i" style={at(2.5)}><Tick done={3.0} warn />Build na Vercelu</li>
              <li className="mv-i mv-warn" style={at(3.05)}><Tick done={3.8} />Chyba → opravuji</li>
              <li className="mv-i mv-done" style={at(3.9)}><span className="mv-tk"><i className="mv-ok mv-i mv-pop" style={at(3.9)}>✓</i></span>Sestaveno</li>
            </ul>
            <div className="mv-track" style={box(0, 18.4, 12.6)}>
              <i className="mv-fl" style={at(0.1)} />
            </div>
            <span className="mv-hint" style={box(0, 19.4, 12.6)}>oprava 1 / 5 · zdarma</span>
            <div className="mv-win mv-wire" style={box(13.6, 0, 17.4, 21.4)}>
              <Bar url="náhled" />
              <i className="mv-i" style={box(0.8, 2.8, 15.8, 1.4, at(0.2))} />
              <i className="mv-i" style={box(0.8, 5, 7.6, 1.6, at(0.8))} />
              <span className="mv-wt mv-ty" style={{ ...box(0.8, 5, 7.6), ...typed(22, 2.1) }}>Ručně točená keramika</span>
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
                brand="HLÍNA"
                kicker="Nová kolekce"
                title="Ručně točená keramika"
                sub="Z dílny na Vysočině, každý kus jiný."
                cta="Prohlédnout"
                products={ceramics}
                hero="vase"
                hot={1}
              />
              <span className="mv-badge mv-i mv-pop" style={box(28.9, 2.35, undefined, undefined, at(3.25))}>1</span>
              <span className="mv-toast mv-i mv-dn" style={{ right: u(0.8), top: u(4.6), ...at(0.6) }}>✓ Nasazeno na Vercel</span>
              <span className="mv-toast mv-i mv-dn" style={{ right: u(0.8), top: u(6.6), ...at(3.4) }}>Přidáno do košíku</span>
            </div>
            <span className="mv-flash" style={box(11.5, 19.2, 8, 1.25, at(3.05))} />
            <Rip x={15.5} y={19.8} d={3.1} />
          </div>
        </Frame>
      )

    case 'qscan':
      return (
        <Frame name="Qscan" steps={['Adresa', 'Sken', 'Nový obchod']} t={15} cursor="scan">
          {/* 1 — address + consent, then scan */}
          <div className="mv-s" style={sc(0)}>
            <div className="mv-card" style={box(3.5, 3.2, 24, 14.8)}>
              <span className="mv-lbl" style={box(1.4, 1.3)}>Převod e-shopu podle adresy</span>
              <div className="mv-inp" style={box(1.4, 3, 21.2, 2.8)}>
                <span className="mv-dim">https://</span>
                <span className="mv-ty" style={typed(15, 0.3)}>stary-obchod.cz</span><i className="mv-car" />
              </div>
              <span className="mv-chk" style={box(1.4, 6.6)}>
                <i className="mv-cb"><b className="mv-i mv-pop" style={at(1.85)}>✓</b></i>
                Obchod je můj a obsah smím použít
              </span>
              <span className="mv-btn" style={box(1.4, 9, 21.2, 2.8)}><span className="mv-pr" style={at(3.05)}>Naskenovat</span></span>
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
                  {k === 0 && <em>produkt</em>}
                </span>
              ))}
              <i className="mv-beam" />
            </div>
            <span className="mv-lbl" style={box(14, 0.2)}>Nalezeno · stary-obchod.cz</span>
            <ul className="mv-found" style={box(14, 1.8, 17)}>
              <li className="mv-i mv-r" style={at(0.5)}>Produkty<b>48</b></li>
              <li className="mv-i mv-r" style={at(0.9)}>Varianty<b>112</b></li>
              <li className="mv-i mv-r" style={at(1.3)}>Fotky<b>126</b></li>
              <li className="mv-i mv-r" style={at(1.7)}>Videa<b>2</b></li>
              <li className="mv-i mv-r" style={at(2.1)}>Texty a SEO<b>✓</b></li>
              <li className="mv-i mv-r" style={at(2.5)}>Barvy a písma<b><i className="mv-sw mv-h0" /><i className="mv-sw mv-h1" /><i className="mv-sw mv-h2" /></b></li>
            </ul>
            <div className="mv-copy mv-i" style={box(14, 16.4, 17, 4.6, at(2.6))}>
              <span>Kopíruji fotky k nám</span>
              <div className="mv-track"><i className="mv-fl" style={at(2.7)} /></div>
            </div>
            {[0, 1, 2].map((k) => (
              <i key={k} className="mv-thumb mv-fly" style={box(2 + (k % 2) * 6, 8 + k * 4, 2.2, 2.2, { ...at(2.8 + k * 0.45), '--fx': u(17 - (k % 2) * 6 + k * 1.4), '--fy': u(10.6 - k * 4) })} />
            ))}
          </div>

          {/* 3 — before / after, and what to do with the new store */}
          <div className="mv-s mv-last" style={sc(2)}>
            <span className="mv-lbl" style={box(0, 0)}>Před</span>
            <div className="mv-before" style={box(0, 1.4, 8.06, 13.3)}><OldShop /></div>
            <span className="mv-arrow mv-i mv-l" style={box(8.5, 6.4, 2.6, undefined, at(0.3))}>→</span>
            <span className="mv-lbl acc" style={box(11.4, 0)}>Po · nový obchod v Quante</span>
            <div className="mv-after mv-i" style={box(11.4, 1.4, 19.53, 13.48, at(0.4))}>
              <div className="mv-win" style={box(0, 0, 31, 21.4)}>
                <Bar url="zrno-prazirna.cz" />
                <Shop
                  brand="ZRNO"
                  kicker="Pražírna"
                  title="Káva pražená tento týden"
                  sub="Výběrová zrna, odesíláme do 24 hodin."
                  cta="Vybrat kávu"
                  products={coffee}
                  hero="bag"
                />
              </div>
            </div>
            <span className="mv-toast mv-i mv-pop" style={box(12.4, 12.6, undefined, undefined, at(1))}>✓ 48 produktů převedeno</span>
            <span className="mv-btn mv-i" style={box(0, 16.6, 9.93, 2.6, at(1.6))}><span className="mv-pr" style={at(3.05)}>Upravit ve Studiu</span></span>
            <span className="mv-btn mv-gl mv-i" style={box(10.53, 16.6, 9.93, 2.6, at(1.8))}><span>Hosting</span></span>
            <span className="mv-btn mv-gl mv-i" style={box(21.07, 16.6, 9.93, 2.6, at(2))}><span>Stáhnout kód</span></span>
            <span className="mv-hint mv-i" style={box(0, 19.8, 31, undefined, at(2.2))}>Fotky a videa už jsou u nás. Starý obchod můžete vypnout.</span>
            <Rip x={4.97} y={17.9} d={3.1} />
          </div>
        </Frame>
      )

    case 'qgent':
      return (
        <Frame name="Qgent" steps={['Kontrola', 'Návrh', 'Hotovo']} t={16} cursor="agent">
          {/* the merchant's store stays in place; Qgent's panel changes beside it */}
          <div className="mv-win mv-narrow" style={box(0, 0, 12.6, 21.4)}>
            <Bar />
            <div className="mv-shop">
              <div className="mv-nav"><b>HLÍNA</b><i className="mv-burger" /></div>
              <h4 style={box(0.9, 2.7, 10.8)}>Vítejte v našem obchodě</h4>
              <p style={box(0.9, 7, 10.8)}>Najdete u nás spoustu krásných věcí.</p>
              <span className="mv-cta" style={box(0.9, 8.9)}>Nakoupit</span>
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
            <span className="mv-ring mv-i mv-pop" style={box(0.5, 4.4, 11.6, 4.6, at(0.4))}><em>nadpis</em></span>
          </div>
          <div className="mv-s mv-cut mv-last" style={sc(2)}>
            <div className="mv-patch" style={box(0.6, 4.4, 11.4, 4.6)}>
              <h4 className="mv-i" style={at(0.3)}>Ručně točená keramika z Vysočiny</h4>
            </div>
            <span className="mv-ring mv-done mv-i mv-pop" style={box(0.5, 4.4, 11.6, 4.6, at(0.4))}><em>✓ změněno</em></span>
          </div>

          <div className="mv-pnl" style={box(13.6, 0, 17.4, 21.4)}>
            <div className="mv-ph"><i className="mv-dot" />Qgent<span>Kontrola obchodu</span></div>
          </div>
          {/* 1 — review */}
          <div className="mv-s" style={sc(0)}>
            <span className="mv-btn" style={box(14.6, 3, 9.4, 2.2)}><span className="mv-pr" style={at(0.5)}>Spustit kontrolu</span></span>
            <span className="mv-hint mv-i" style={box(14.6, 5.9, 15.4, undefined, at(0.7))}>Procházím 9 stránek…</span>
            <div className="mv-track" style={box(14.6, 7, 15.4)}><i className="mv-fl" style={at(0.7)} /></div>
            {[
              ['Nadpis neříká, co prodáváte', 'text'],
              ['Chybí informace o dopravě', 'obsah'],
              ['Fotky bez popisku', 'SEO'],
            ].map(([t, tag], k) => (
              <div key={t} className="mv-find mv-i mv-r" style={box(14.6, 8 + k * 3.6, 15.4, 3.1, at(1.4 + k * 0.5))}>
                <b>{k + 1}</b><span>{t}</span><em>{tag}</em>
              </div>
            ))}
            <span className="mv-hint mv-i" style={box(14.6, 19.4, 15.4, undefined, at(2.9))}>3 návrhy · nic se nezmění bez potvrzení</span>
            <Rip x={19.3} y={4.1} d={0.55} />
          </div>
          {/* 2 — the proposal: a preview of the exact change */}
          <div className="mv-s" style={sc(1)}>
            <span className="mv-lbl" style={box(14.6, 3)}>Návrh 1 / 3</span>
            <div className="mv-find mv-big mv-i" style={box(14.6, 4.4, 15.4, 2.6, at(0.2))}><b>1</b><span>Nadpis neříká, co prodáváte</span></div>
            <div className="mv-diff mv-i" style={box(14.6, 7.6, 15.4, 7.2, at(0.6))}>
              <small>app/page.tsx</small>
              <del className="mv-i mv-l" style={at(1)}>Vítejte v našem obchodě</del>
              <ins className="mv-i mv-l" style={at(1.5)}>Ručně točená keramika z Vysočiny</ins>
            </div>
            <span className="mv-btn" style={box(14.6, 15.6, 5.6, 2.2)}><span className="mv-pr" style={at(3.35)}>Použít</span></span>
            <span className="mv-btn mv-gl" style={box(20.6, 15.6, 4.6, 2.2)}><span>Upravit</span></span>
            <span className="mv-btn mv-gl" style={box(25.6, 15.6, 4.4, 2.2)}><span>Zpět</span></span>
            <span className="mv-hint mv-i" style={box(14.6, 18.6, 15.4, undefined, at(2.2))}>Ceny, platby a doprava vždy s druhým potvrzením</span>
            <Rip x={17.4} y={16.7} d={3.4} />
          </div>
          {/* 3 — applied as a draft, undoable */}
          <div className="mv-s mv-last" style={sc(2)}>
            <div className="mv-log1 mv-i" style={box(14.6, 3, 15.4, 2.6, at(0.2))}>
              <i className="mv-ok">✓</i><span>Qgent: nový nadpis<small>koncept</small></span><em>Vrátit</em>
            </div>
            <div className="mv-msg mv-i" style={box(14.6, 6.4, 15.4, undefined, at(0.8))}><small>Qgent</small>Hotovo. Změna je v konceptu a jde kdykoli vrátit.</div>
            <div className="mv-find mv-i mv-r" style={box(14.6, 11.2, 15.4, 3.1, at(1.6))}><b>2</b><span>Doprava: čeká na vás</span><em>zobrazit</em></div>
            <div className="mv-find mv-i mv-r" style={box(14.6, 14.8, 15.4, 3.1, at(2))}><b>3</b><span>Popisky fotek</span><em>zobrazit</em></div>
            <span className="mv-toast mv-i mv-pop" style={box(14.6, 18.7, undefined, undefined, at(2.6))}>Podklady pro Qads připraveny</span>
          </div>
        </Frame>
      )

    case 'qdit':
      return (
        <Frame name="Qdit" steps={['Vybrat', 'Upravit', 'Publikovat']} t={16} cursor="edit">
          <div className="mv-win" style={box(0, 0, 31, 21.4)}>
            <div className="mv-eb">
              <span className="mv-dev3"><i className="mv-on" /><i /><i /></span>
              <span className="mv-page">Úvodní stránka</span>
              <span className="mv-state">Koncept</span>
              <span className="mv-pub"><span className="mv-pr" style={at(10.67 + 1.7)}>Publikovat</span></span>
            </div>
            <Shop
              brand="HLÍNA"
              kicker="Podzim 2026"
              title="Nová kolekce"
              sub="Z dílny na Vysočině, každý kus jiný."
              cta="Nakoupit"
              products={ceramics}
              hero="vase"
            />
          </div>

          {/* 1 — hover, click, the element is selected with its toolbar */}
          <div className="mv-s mv-cut" style={sc(0)}>
            <span className="mv-hov mv-flash" style={box(0.7, 2.4, 5, 1.9, at(0.9))} />
            <span className="mv-sel mv-i" style={box(0.8, 5.5, 12.6, 2.6, at(1.85))}><em>h1 · Nadpis</em></span>
            <span className="mv-tb mv-i mv-l" style={box(14, 5.75, undefined, undefined, at(2.1))}><b>Aa</b><span>B</span><span>↕</span><span>AI</span></span>
            <Rip x={7} y={7} d={1.8} />
          </div>
          {/* 2 — retype the headline, then restyle the button from the panel */}
          <div className="mv-s mv-cut" style={sc(1)}>
            <span className="mv-patch mv-t" style={box(1, 5.9, 12.2, 2.3)}>
              <span className="mv-ty" style={typed(14, 0.1)}>Podzim v hlíně</span><i className="mv-car" />
            </span>
            <span className="mv-sel mv-o" style={box(0.8, 5.5, 12.6, 2.6, at(2))}><em>h1 · Nadpis</em></span>
            <span className="mv-cta2 mv-i" style={box(1.2, 11.5, 6.6, 1.4, at(3.05))}>Nakoupit</span>
            <span className="mv-cta2 wide mv-i" style={box(1.2, 11.5, 8, 1.4, at(4.1))}>Nakoupit</span>
            <span className="mv-sel mv-i" style={box(0.9, 11.2, 9.6, 2, at(2.05))}><em>Tlačítko</em></span>
            <div className="mv-props mv-i mv-r" style={box(21, 2.6, 9.4, 14, at(2.3))}>
              <small>Tlačítko · počítač</small>
              <label>Písmo<span>Geist 600</span></label>
              <label>Velikost<span>16 px</span></label>
              <label>Barva</label>
              <span className="mv-sws"><i className="mv-h0" /><i className="mv-h1" /><i className="mv-h2" /><i className="mv-h3" /></span>
              <i className="mv-swon mv-i mv-pop" style={at(3.05)} />
              <label>Odsazení</label>
              <span className="mv-slider"><i className="mv-knob" style={at(3.6)} /></span>
            </div>
            <Rip x={4.5} y={12.2} d={2} />
            <Rip x={25.9} y={10.4} d={3} />
          </div>
          {/* 3 — publish: shoppers see it only now */}
          <div className="mv-s mv-cut mv-last" style={sc(2)}>
            <span className="mv-patch mv-t" style={box(1, 5.9, 12.2, 2.3)}><span>Podzim v hlíně</span></span>
            <span className="mv-cta2 wide" style={box(1.2, 11.5, 8, 1.4)}>Nakoupit</span>
            <span className="mv-state mv-on mv-i" style={box(19.4, 0.45, undefined, undefined, at(1.9))}>Živě</span>
            <span className="mv-toast mv-i mv-dn" style={{ right: u(0.8), top: u(2.6), ...at(1.95) }}>✓ Publikováno · zákazníci vidí změny</span>
            <span className="mv-chg mv-i" style={box(14.4, 0.45, undefined, undefined, at(0.2))}>3 změny</span>
            <Rip x={27.4} y={1} d={1.75} />
          </div>
        </Frame>
      )

    case 'qads':
      return (
        <Frame name="Qads" steps={['Fotka', 'Generuji', 'Videa']} t={15} cursor="ads">
          {/* 1 — product photo + brief */}
          <div className="mv-s" style={sc(0)}>
            <div className="mv-drop" style={box(0, 0, 11.6, 21.4)}>
              <span className="mv-hint" style={box(0, 0.8, 11.6, undefined, { textAlign: 'center' })}>1–4 fotky produktu</span>
              <span className="mv-photo mv-i mv-dn" style={box(1.6, 3.2, 8.4, 12, at(0.3, { '--from': 'translateY(-4em) rotate(-6deg) scale(.9)' }))}>
                <Bottle style={{ fontSize: '1.1em' }} />
              </span>
              <span className="mv-hint mv-i" style={box(0, 16.4, 11.6, undefined, at(0.9, { textAlign: 'center' }))}>rosa.jpg · nahráno ✓</span>
            </div>
            <span className="mv-lbl" style={box(12.6, 0)}>Název</span>
            <div className="mv-inp" style={box(12.6, 0.9, 18.4, 2.2)}><span className="mv-ty" style={typed(16, 0.9)}>Sérum Rosa 30 ml</span><i className="mv-car" /></div>
            <span className="mv-lbl" style={box(12.6, 3.7)}>Styl</span>
            {['Packshot', 'Lifestyle', 'UGC', 'Filmový', 'Minimal'].map((s, k) => (
              <span key={s} className="mv-opt" style={box(12.6 + k * 3.7, 4.6, 3.5, 1.7)}>{s}</span>
            ))}
            <span className="mv-opt mv-on mv-i mv-pop" style={box(16.3, 4.6, 3.5, 1.7, at(1.85))}>Lifestyle</span>
            <span className="mv-lbl" style={box(12.6, 7)}>Formáty</span>
            {formats.map((f, k) => (
              <span key={f.f} className="mv-opt" style={box(12.6 + k * 4.65, 7.9, 4.45, 1.7)}>{f.f}</span>
            ))}
            {formats.map((f, k) => (
              <span key={f.f} className="mv-opt mv-on mv-i mv-pop" style={box(12.6 + k * 4.65, 7.9, 4.45, 1.7, at(2.3 + k * 0.2))}>{f.f}</span>
            ))}
            <span className="mv-lbl" style={box(12.6, 10.3)}>Délka · jazyk textů</span>
            {['4 s', '6 s', '8 s', '10 s'].map((s, k) => (
              <span key={s} className="mv-opt" style={box(12.6 + k * 2.6, 11.2, 2.4, 1.7)}>{s}</span>
            ))}
            <span className="mv-opt mv-on mv-i mv-pop" style={box(17.8, 11.2, 2.4, 1.7, at(3.1))}>8 s</span>
            <span className="mv-opt" style={box(23.2, 11.2, 7.8, 1.7)}>Čeština</span>
            <span className="mv-btn" style={box(12.6, 16.6, 18.4, 2.6)}><span className="mv-pr" style={at(3.95)}>Generovat · 4 videa</span></span>
            <span className="mv-hint" style={box(12.6, 19.8, 18.4)}>Co se nepovede, to se vrátí v kreditech.</span>
            <Rip x={18.05} y={5.45} d={1.85} />
            <Rip x={21.8} y={17.9} d={4} />
          </div>

          {/* 2 — rendering every format */}
          <div className="mv-s" style={sc(1)}>
            <span className="mv-photo sm" style={box(0, 0.4, 5.4, 7)}><Bottle style={{ fontSize: '0.62em' }} /></span>
            <ul className="mv-log" style={box(6.6, 0.4, 24.4)}>
              <li className="mv-i" style={at(0.2)}><Tick done={0.9} />Scénář a háček</li>
              <li className="mv-i" style={at(0.8)}><Tick done={1.6} />Titulky v češtině</li>
              <li className="mv-i" style={at(1.4)}><Tick done={4.2} />Render 4 videí · Higgsfield</li>
            </ul>
            {formats.map((f, k) => (
              <div key={f.f} className={`mv-frm mv-sk mv-p${k}`} style={box(f.x, 21.2 - f.h, f.w, f.h)}>
                <Bottle className="ghost" />
                <em>{f.f}</em>
                <div className="mv-track in"><i className="mv-fl" style={at(1.4 + k * 0.35)} /></div>
              </div>
            ))}
          </div>

          {/* 3 — finished ads playing, ad copy, download */}
          <div className="mv-s mv-last" style={sc(2)}>
            <span className="mv-lbl acc" style={box(0, 0.8)}>4 videa hotová</span>
            <span className="mv-btn" style={box(23.4, 0, 7.6, 2.4)}><span className="mv-pr" style={at(3.35)}>Stáhnout ZIP</span></span>
            <div className="mv-copyx mv-i" style={box(6.6, 3.2, 24.4, 6.2, at(0.4))}>
              <span><small>Háček</small>Pleť jako po dobrém spánku</span>
              <span><small>Titulek</small>Sérum Rosa · 30 ml</span>
              <span><small>Výzva</small>Vyzkoušejte ještě dnes</span>
              <b>CS</b>
            </div>
            {formats.map((f, k) => (
              <div key={f.f} className={`mv-frm mv-play mv-p${k}`} style={box(f.x, 21.2 - f.h, f.w, f.h)}>
                <i className="bg" />
                <Bottle className="mv-hb" />
                <i className="mv-sh" />
                <em>{f.f}</em>
                <span className="cap mv-i" style={at(0.6 + k * 0.25)}>{f.hook}</span>
                <span className="mv-ok mv-i mv-pop" style={at(0.3 + k * 0.2)}>✓</span>
                <div className="mv-track in"><i className="run" /></div>
              </div>
            ))}
            <span className="mv-toast mv-i mv-dn" style={{ right: 0, top: u(2.9), ...at(3.5) }}>qads-rosa.zip · stahuje se</span>
            <Rip x={27.2} y={1.2} d={3.4} />
          </div>
        </Frame>
      )

    case 'qails':
      return (
        <Frame name="Qails" steps={['Jedna schránka', 'Hledání', 'Podle obchodu']} t={15} cursor="mail" dev>
          {['zrno.cz', 'hlina.cz', 'keramika.cz'].map((s, k) => (
            <span key={s} className="mv-store" style={box(0, 1.2 + k * 5.6, 8.6, 3.6)}><i className={`mv-sw mv-h${[0, 1, 2][k]}`} />{s}</span>
          ))}

          {/* 1 — mail from every store lands in one inbox */}
          <div className="mv-s" style={sc(0)}>
            <div className="mv-ibh" style={box(10, 0, 21)}>Všechny obchody<b className="mv-i mv-pop" style={at(3)}>12 nových</b></div>
            {inbox.map((m, k) => (
              <div key={m.s} className="mv-row mv-i mv-dn" style={box(10, 2.8 + k * 3.2, 21, 2.8, at(0.8 + k * 0.55))}>
                <i className={`mv-sw mv-h${m.c}`} /><em>{m.st}</em><span>{m.s}</span><small>{m.t}</small>
              </div>
            ))}
            {[0, 2, 1, 0, 2].map((src, k) => (
              <i key={k} className="mv-env mv-fly" style={box(7.8, 2.4 + src * 5.6, 1.6, 1.1, { ...at(0.1 + k * 0.55), '--fx': u(3.2), '--fy': u(1.2 + k * 3.2 - src * 5.6) })} />
            ))}
          </div>

          {/* 2 — one search across every store */}
          <div className="mv-s" style={sc(1)}>
            <div className="mv-inp" style={box(10, 0, 21, 2.3)}><span className="mv-dim">⌕</span><span className="mv-ty" style={typed(8, 0.3)}>doručení</span><i className="mv-car" /></div>
            {inbox.map((m, k) => (
              <div key={m.s} className="mv-row" style={box(10, 2.8 + k * 3.2, 21, 2.8)}>
                <i className={`mv-sw mv-h${m.c}`} /><em>{m.st}</em><span>{m.s}</span><small>{m.t}</small>
                {k === 1 || k === 3
                  ? <i className="mv-hitrow mv-i" style={at(1.6)} />
                  : <i className="mv-dimrow mv-i" style={at(1.5)} />}
              </div>
            ))}
            <span className="mv-hint mv-i" style={box(10, 19.2, 21, undefined, at(1.9))}>2 výsledky ze 2 obchodů</span>
          </div>

          {/* 3 — filtered by store */}
          <div className="mv-s mv-last" style={sc(2)}>
            {[['Vše', 12, 10, 4], ['zrno.cz', 5, 14.3, 5.3], ['keramika.cz', 4, 19.9, 6.3], ['hlina.cz', 3, 26.5, 4.5]].map(([t, n, x, w]) => (
              <span key={t} className="mv-tab" style={box(x as number, 0, w as number, 2.2)}>{t}<b>{n}</b></span>
            ))}
            <span className="mv-tab mv-on mv-i mv-pop" style={box(19.9, 0, 6.3, 2.2, at(1.25))}>keramika.cz<b>4</b></span>
            {[
              ['Dotaz na doručení', '09:38'],
              ['Velkoobchodní ceník', '08:55'],
              ['Objednávka #1187', 'včera'],
              ['Poděkování za balík', 'včera'],
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
