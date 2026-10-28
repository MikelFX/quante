import Image from 'next/image'
import type { ReactNode } from 'react'
import {
  BinaryStrip, Button, Card, CharHeading, CheckList, InView, ParticleZone, Pill, SectionLabel, SectionTitle, Sub, Tapes,
  Timeline, cx, delay,
} from '@ad/ui'
import { cta } from '@/content/assetra/site'
import { aiAudience, aiBranka, aiBuilt, aiHero, aiIdeas, aiServices, aiSteps, aiWebShop, productScreens } from '@/content/assetra/ai'
import { LoopVideo } from './LoopVideo'
import { Object3D } from './Object3D'

// Homepage (AI solutions, 2026-10-26). Same building blocks as the web & e-shop page
// (../home/sections.tsx); every service has its own glossy 3D object.

export function AiHero() {
  return (
    <InView className="hero" id="uvod" initial>
      <div className="hgrid" aria-hidden="true" />
      <div className="glow g1" aria-hidden="true" />
      <div className="glow g2" aria-hidden="true" />
      <div className="w hin">
        <div>
          <Pill badge={aiHero.pill.badge}>{aiHero.pill.text}</Pill>
          <CharHeading text={aiHero.title} highlight={['umělou', 'inteligencí']} />
          <p className="lead rv" style={delay(0.55)}>{aiHero.lead}</p>
          <div className="ctas rv" style={delay(0.65)}>
            <Button href={'#' + cta.target} variant="pri" beam arrow>{cta.label}</Button>
            <Button href={'#' + aiHero.secondaryCta.target}>{aiHero.secondaryCta.label}</Button>
          </div>
          <CheckList className="rv" delaySec={0.75} items={aiHero.checks} />
        </div>
        <div className="ai-stage rv" style={delay(0.2)}>
          <Object3D kind="core" size="lg" />
          <Object3D kind="chat" size="sm" sway className="ai-fl f1" />
          <Object3D kind="spark" size="sm" sway className="ai-fl f2" />
          <Object3D kind="grid" size="sm" sway className="ai-fl f3" />
        </div>
      </div>
      <BinaryStrip text="ASSETRA DIGITAL/AI/SOFTWARE/CRM/AUTOMATIZACE/" />
      <Tapes label="Pro firmy, agentury, startupy i jednotlivce" words={aiHero.tapeWords} items={aiHero.tapeItems} />
    </InView>
  )
}

export function AiServices() {
  return (
    <InView className="sec" id="sluzby">
      <div className="w">
        <div className="sh2">
          <div>
            <SectionLabel num="01">{aiServices.label}</SectionLabel>
            <SectionTitle>{aiServices.title}</SectionTitle>
            <Sub>{aiServices.sub}</Sub>
          </div>
          <ParticleZone shapes={['AI', 'CRM', 'API']} />
        </div>
      </div>
      <div className="w ai-list">
        {aiServices.items.map((s, i) => (
          <InView as="article" key={s.title} className={cx('ai-row', i % 2 === 1 && 'rev')}>
            <div className="ai-txt rv">
              <span className="ai-n">{String(i + 1).padStart(2, '0')}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <ul className="feat">{s.features.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
            <div className="ai-vis rv" style={delay(0.15)}>
              <Object3D kind={s.kind} />
            </div>
          </InView>
        ))}
      </div>
    </InView>
  )
}

export function AiAudience() {
  return (
    <InView className="sec" id="pro-koho">
      <div className="w">
        <SectionLabel num="02">{aiAudience.label}</SectionLabel>
        <SectionTitle>{aiAudience.title}</SectionTitle>
        <div className="ai-who">
          {aiAudience.items.map((a, i) => (
            <Card key={a.title} reveal delaySec={0.08 * (i + 1)} className="ai-card">
              <Object3D kind={a.kind} size="sm" />
              <h3>{a.title}</h3>
              <p>{a.text}</p>
            </Card>
          ))}
        </div>
      </div>
    </InView>
  )
}

export function AiIdeas() {
  return (
    <InView className="sec" id="napady">
      <div className="w">
        <div className="sh2">
          <div>
            <SectionLabel num="03">{aiIdeas.label}</SectionLabel>
            <SectionTitle>{aiIdeas.title}</SectionTitle>
            <Sub>{aiIdeas.sub}</Sub>
          </div>
          <ParticleZone shapes={['?', '@sphere', '!']} />
        </div>
        <ul className="ai-ideas">
          {aiIdeas.items.map((t, i) => (
            <li key={t} className="glass rv" style={delay(0.04 * i)}><b>{String(i + 1).padStart(2, '0')}</b>{t}</li>
          ))}
          <li className="ai-more rv" style={delay(0.04 * aiIdeas.items.length)}>
            <b>+</b>Váš nápad
            <Button href={'#' + cta.target} variant="plain">Napsat nám</Button>
          </li>
        </ul>
      </div>
    </InView>
  )
}

/** Our own products: a short header, then one showcase section per product (Branka-style). */
export function AiBuilt() {
  const [quante, qgent, qads] = aiBuilt.items
  return (
    <>
      <InView className="sec pr-head" id="postaveno">
        <div className="w">
          <SectionLabel num="04">{aiBuilt.label}</SectionLabel>
          <SectionTitle>{aiBuilt.title}</SectionTitle>
          <Sub>{aiBuilt.sub}</Sub>
          <nav className="pr-jump rv" aria-label="Naše produkty">
            {[...aiBuilt.items, { id: 'branka', title: aiBranka.title }].map((p) => (
              <a key={p.id} href={'#' + p.id}>{p.title}</a>
            ))}
          </nav>
        </div>
      </InView>
      <Product item={quante} className="ad-q">
        <div className="pr-stage">
          <div className="glow" aria-hidden="true" />
          <Browser url={productScreens.quante.url} className="pr-win">
            <LoopVideo
              src={productScreens.quante.video}
              poster={productScreens.quante.poster}
              label="Quante Studio: zadání v chatu, sestavení obchodu a hotový e-shop"
            />
          </Browser>
          <span className="pr-float pr-log glass" aria-hidden="true">
            <Image src={productScreens.quante.steps[1].src} alt="" width={1280} height={620} sizes="260px" />
          </span>
          <span className="pr-badge glass" aria-hidden="true"><i />Nasazeno</span>
        </div>
        <ul className="pr-steps">
          {productScreens.quante.steps.map((st, i) => (
            <li key={st.src} className="rv" style={delay(0.08 * i)}>
              <Browser className="pr-mini">
                <Image src={st.src} alt={`Quante Studio: ${st.caption}`} width={1280} height={620} sizes="(max-width: 900px) 92vw, 380px" />
              </Browser>
              <b>{st.caption}</b>
              <span>{st.text}</span>
            </li>
          ))}
        </ul>
      </Product>
      <Product item={qgent} reverse>
        <div className="pr-stage pr-qg">
          <div className="glow" aria-hidden="true" />
          <span className="pr-chat glass">
            <Image src={productScreens.qgent.src} alt={productScreens.qgent.alt} width={615} height={915} sizes="(max-width: 900px) 70vw, 330px" />
          </span>
          <div className="pr-find glass" aria-hidden="true">
            <small><i />Qgent · návrh</small>
            <b>{productScreens.qgent.finding.title}</b>
            <code>{productScreens.qgent.finding.edit}</code>
            <span className="pr-acts"><span className="ok">Potvrdit</span><span>Upravit</span></span>
          </div>
          <span className="pr-badge pr-undo glass" aria-hidden="true">↺ Změnu jde vrátit</span>
        </div>
      </Product>
      <Product item={qads} className="ad-q">
        <div className="pr-stage pr-qa">
          <div className="glow" aria-hidden="true" />
          <Browser url={productScreens.qads.url} className="pr-win">
            <Image src={productScreens.qads.composer} alt="Qads: nahrání fotky produktu a tlačítko Generate" width={1400} height={693} sizes="(max-width: 900px) 92vw, 600px" />
          </Browser>
          {productScreens.qads.ads.map((ad, i) => (
            <span key={ad.video} className={cx('pr-ad', i === 0 ? 'a1' : 'a2')}>
              <LoopVideo src={ad.video} poster={ad.poster} label={`Reklama vytvořená v Qads (${ad.label})`} />
              <em>{ad.label}</em>
            </span>
          ))}
          <span className="pr-ad pr-sq">
            <Image src={productScreens.qads.photo.src} alt="Reklamní fotka vytvořená v Qads" width={611} height={1080} sizes="150px" />
            <em>{productScreens.qads.photo.label}</em>
          </span>
        </div>
      </Product>
    </>
  )
}

/** One product showcase: text on one side, its screens on the other; extra rows below. */
function Product({ item, reverse, className, children }: {
  item: (typeof aiBuilt.items)[number]; reverse?: boolean; className?: string; children: ReactNode
}) {
  const [stage, ...rest] = Array.isArray(children) ? children : [children]
  return (
    <InView className={cx('sec pr', className)} id={item.id}>
      <div className="w">
        <div className={cx('br-grid', reverse && 'rev')}>
          <div className="br-txt">
            <p className="br-kick rv">{item.kicker}</p>
            <h2 className="br-h rv" style={delay(0.08)}>{item.title}</h2>
            <p className="br-lead rv" style={delay(0.14)}>{item.lead}</p>
            <ul className="feat rv" style={delay(0.2)}>{item.features.map((f) => <li key={f}>{f}</li>)}</ul>
            <div className="ctas rv" style={delay(0.26)}>
              <Button href={item.href} variant="pri" arrow>{item.cta}</Button>
            </div>
          </div>
          <div className="rv" style={delay(0.12)}>{stage}</div>
        </div>
        {rest}
      </div>
    </InView>
  )
}

/** A glass browser window around a product screen. */
function Browser({ url, className, children }: { url?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx('pr-br glass', className)}>
      <div className="pr-bar" aria-hidden="true">
        <i /><i /><i />
        {url && <span>{url}</span>}
      </div>
      <div className="pr-body">{children}</div>
    </div>
  )
}

/** A phone with a screenshot of our own product (Branka). */
function Phone({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <span className={cx('br-ph', className)}>
      <Image src={src} alt={alt} width={780} height={1688} sizes="(max-width: 900px) 46vw, 240px" />
    </span>
  )
}

export function AiBranka() {
  return (
    <InView className="sec" id="branka">
      <div className="w">
        <div className="br-grid">
          <div className="br-txt">
            <SectionLabel num="05">{aiBranka.label}</SectionLabel>
            <p className="br-kick rv">{aiBranka.kicker}</p>
            <h2 className="br-h rv" style={delay(0.08)}>{aiBranka.title}</h2>
            <p className="br-lead rv" style={delay(0.14)}>{aiBranka.lead}</p>
            <ul className="feat rv" style={delay(0.2)}>{aiBranka.features.map((f) => <li key={f}>{f}</li>)}</ul>
            <div className="ctas rv" style={delay(0.26)}>
              <Button href={aiBranka.href} variant="pri" arrow>{aiBranka.cta}</Button>
              <Button href={'#' + cta.target}>Chci něco podobného</Button>
            </div>
          </div>
          <div className="br-stage rv" style={delay(0.15)}>
            <div className="glow" aria-hidden="true" />
            {aiBranka.stage.map((p, i) => (
              <Phone key={p.src} src={p.src} alt={p.alt} className={['l', 'c', 'r'][i]} />
            ))}
          </div>
        </div>
        <ul className="br-shots">
          {aiBranka.screens.map((sc, i) => (
            <li key={sc.src} className="rv" style={delay(0.06 * i)}>
              <Phone src={sc.src} alt={`Branka: ${sc.caption}`} />
              <b>{sc.caption}</b>
              <span>{sc.text}</span>
            </li>
          ))}
        </ul>
        <Card reveal className="br-auto">
          <div>
            <h3>{aiBranka.automate.title}</h3>
            <p>{aiBranka.automate.text}</p>
          </div>
          <Button href={'#' + cta.target} variant="pri" beam arrow>{aiBranka.automate.cta}</Button>
        </Card>
      </div>
    </InView>
  )
}

export function AiWebShop() {
  return (
    <InView className="sec" id="web-eshop">
      <div className="w">
        <Card reveal className="ai-ws">
          <div>
            <SectionLabel num="06" reveal={false}>{aiWebShop.label}</SectionLabel>
            <h2>{aiWebShop.title}</h2>
            <p>{aiWebShop.text}</p>
            <Button href={aiWebShop.href} variant="pri" arrow>{aiWebShop.cta}</Button>
          </div>
          <Object3D kind="shop" />
        </Card>
      </div>
    </InView>
  )
}

export function AiProcess() {
  return (
    <InView className="sec" id="postup">
      <div className="w">
        <div className="sh2">
          <div>
            <SectionLabel num="07">{aiSteps.label}</SectionLabel>
            <SectionTitle>{aiSteps.title}</SectionTitle>
          </div>
          <ParticleZone shapes={['01', '02', '03', '04']} />
        </div>
        <Timeline steps={aiSteps.steps} />
      </div>
    </InView>
  )
}
