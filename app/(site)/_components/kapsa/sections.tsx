import { Button, Card, CheckList, InView, ParticleZone, Pill, SectionLabel, SectionTitle, Sub, Timeline, Todo, delay } from '@ad/ui'
import { cta, company } from '@/content/assetra/site'
import { kapsa, kapsaStatusLabel } from '@/content/assetra/kapsa'

// /kapsa: Kapsa, our AI personal-finance app (content/assetra/kapsa.ts). A product of
// AssetraDigital with its own app, so this page lives on the website, not among the Quante modules.
// Same building blocks as the Quante module pages (ModulePage.tsx): no new styles. Unknown facts
// (the app's address, the price) render as visible [placeholders].

/** Hero CTA: the Kapsa app once its address is known, a visible placeholder until then. */
function AppCta() {
  if (kapsa.appUrl) return <Button href={kapsa.appUrl} variant="pri" beam arrow>{kapsa.hero.cta}</Button>
  return (
    <>
      <Button variant="pri" disabled>{kapsa.hero.cta}</Button>
      <Todo>[adresa aplikace Kapsa]</Todo>
    </>
  )
}

export function KapsaHero() {
  return (
    <InView className="sec mod-top" initial>
      <div className="w">
        <div className="sh2">
          <div>
            <Pill badge={kapsaStatusLabel()}>{kapsa.hero.tag}</Pill>
            <SectionTitle as="h1">{kapsa.name}</SectionTitle>
            <Sub>{kapsa.hero.promise}</Sub>
            <p className="lead rv" style={delay(0.15)}>{kapsa.hero.lead}</p>
            <div className="ctas rv" style={delay(0.2)}>
              <AppCta />
              <Button href={'#' + kapsa.hero.secondaryCta.target}>{kapsa.hero.secondaryCta.label}</Button>
            </div>
            <CheckList className="rv" delaySec={0.25} items={kapsa.hero.checks} />
          </div>
          <ParticleZone shapes={['KAPSA', '@torus']} />
        </div>
      </div>
    </InView>
  )
}

export function KapsaFeatures() {
  return (
    <InView className="sec" id={kapsa.hero.secondaryCta.target}>
      <div className="w">
        <SectionLabel num="01">{kapsa.features.label}</SectionLabel>
        <SectionTitle>{kapsa.features.title}</SectionTitle>
        <div className="bento">
          {kapsa.features.items.map((f, i) => (
            <Card key={f.title} className="w4" reveal delaySec={0.08 * ((i % 3) + 1)}>
              <div className="ch"><h3>{f.title}</h3><span>{String(i + 1).padStart(2, '0')}</span></div>
              <p className="mod-text">{f.text}</p>
            </Card>
          ))}
        </div>
        <p className="fine mod-note rv">{kapsa.install}</p>
      </div>
    </InView>
  )
}

export function KapsaSteps() {
  return (
    <InView className="sec" id="jak-funguje">
      <div className="w">
        <SectionLabel num="02">{kapsa.steps.label}</SectionLabel>
        <SectionTitle>{kapsa.steps.title}</SectionTitle>
        <Timeline steps={kapsa.steps.steps} />
      </div>
    </InView>
  )
}

export function KapsaHonest() {
  return (
    <InView className="sec" id="na-rovinu">
      <div className="w">
        <SectionLabel num="03">{kapsa.honest.label}</SectionLabel>
        <SectionTitle>{kapsa.honest.title}</SectionTitle>
        <div className="bento">
          {kapsa.honest.items.map((f, i) => (
            <Card key={f.title} className="w4" reveal delaySec={0.08 * (i + 1)}>
              <div className="ch"><h3>{f.title}</h3></div>
              <p className="mod-text">{f.text}</p>
            </Card>
          ))}
        </div>
      </div>
    </InView>
  )
}

export function KapsaFacts() {
  return (
    <InView className="sec" id="stav">
      <div className="w">
        <SectionLabel num="04">{kapsa.facts.label}</SectionLabel>
        <SectionTitle>{kapsa.facts.title}</SectionTitle>
        <ul className="plist">
          <li><span className="n">Stav</span><i /><b>{kapsaStatusLabel()}</b></li>
          <li>
            <span className="n">Aplikace</span><i />
            <b>{kapsa.appUrl ? <a href={kapsa.appUrl}>{kapsa.appUrl.replace(/^https?:\/\//, '')}</a> : <Todo>[adresa aplikace]</Todo>}</b>
          </li>
          <li><span className="n">Cena</span><i /><b>{kapsa.price ?? <Todo>[cena]</Todo>}</b></li>
        </ul>
        <p className="fine">{kapsa.status === 'dev' ? kapsa.facts.note + ' ' : ''}{kapsa.name} je produkt {company.name}</p>
      </div>
    </InView>
  )
}

export function KapsaEnd() {
  const { similar, more } = kapsa.end
  return (
    <InView className="paths-sec mod-end">
      <div className="w paths">
        <Card reveal delaySec={0.1} className="path">
          <span className="lbl">{similar.label}</span>
          <h2>{similar.title}</h2>
          <p>{similar.text}</p>
          <Button href={'/#' + cta.target} variant="pri" arrow>{similar.cta}</Button>
        </Card>
        <Card reveal delaySec={0.2} className="path">
          <span className="lbl">{more.label}</span>
          <h2>{more.title}</h2>
          <p>{more.text}</p>
          <Button href="/#postaveno">{more.cta}</Button>
        </Card>
      </div>
    </InView>
  )
}
