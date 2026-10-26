import {
  BinaryStrip, Button, Card, CharHeading, CheckList, InView, ParticleZone, Pill, SectionLabel, SectionTitle, Sub, Tapes,
  Timeline, cx, delay,
} from '@ad/ui'
import { cta } from '@/content/assetra/site'
import { aiAudience, aiBuilt, aiHero, aiIdeas, aiServices, aiSteps, aiWebShop } from '@/content/assetra/ai'
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
          <Object3D kind="chat" size="sm" className="ai-fl f1" />
          <Object3D kind="spark" size="sm" className="ai-fl f2" />
          <Object3D kind="grid" size="sm" className="ai-fl f3" />
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

export function AiBuilt() {
  return (
    <InView className="sec" id="postaveno">
      <div className="w">
        <SectionLabel num="04">{aiBuilt.label}</SectionLabel>
        <SectionTitle>{aiBuilt.title}</SectionTitle>
        <Sub>{aiBuilt.sub}</Sub>
        <div className="ai-built">
          {aiBuilt.items.map((b, i) => (
            <Card key={b.title} reveal delaySec={0.1 * (i + 1)} className="ai-card">
              <Object3D kind={b.kind} size="sm" />
              <h3>{b.title}</h3>
              <p>{b.text}</p>
              <Button href={b.href}>{b.cta}</Button>
            </Card>
          ))}
        </div>
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
            <SectionLabel num="05" reveal={false}>{aiWebShop.label}</SectionLabel>
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
            <SectionLabel num="06">{aiSteps.label}</SectionLabel>
            <SectionTitle>{aiSteps.title}</SectionTitle>
          </div>
          <ParticleZone shapes={['01', '02', '03', '04']} />
        </div>
        <Timeline steps={aiSteps.steps} />
      </div>
    </InView>
  )
}
