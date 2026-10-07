import {
  BinaryStrip, Button, Card, CharHeading, CheckList, InView, ParticleZone, Pill, SectionLabel, SectionTitle,
  StackCards, Sub, Tapes, Timeline, Todo, delay,
} from '@ad/ui'
import { contact, contactSection, contract, cta, hero, paths, services, steps, work } from '@/content/assetra/site'
import { modules, quanteIntro } from '@/content/assetra/modules'
import { ModuleCard } from '../quante/ModuleCard'
import { HeroStage } from './HeroStage'
import { LeadForm } from './LeadForm'
import { Pricing } from './Pricing'

// Homepage sections, markup 1:1 with design/assetradigital-design-v2.dc.html.

export function Hero() {
  return (
    <InView className="hero" id="uvod" initial>
      <div className="hgrid" aria-hidden="true" />
      <div className="glow g1" aria-hidden="true" />
      <div className="glow g2" aria-hidden="true" />
      <div className="w hin">
        <div>
          <Pill badge={hero.pill.badge}>{hero.pill.text}</Pill>
          <CharHeading text={hero.title} />
          <p className="lead rv" style={delay(0.55)}>{hero.lead}</p>
          <div className="ctas rv" style={delay(0.65)}>
            <Button href={'#' + cta.target} variant="pri" beam arrow>{cta.label}</Button>
            <Button href={'#' + hero.secondaryCta.target}>{hero.secondaryCta.label}</Button>
          </div>
          <CheckList className="rv" delaySec={0.75} items={hero.checks} />
        </div>
        <ParticleZone className="orb rv" style={delay(0.2)} shapes={['@logo', '@sphere', '@torus', '@cube']}>
          <span className="orb-l">Táhni nebo <b>klikni</b></span>
        </ParticleZone>
      </div>
      <HeroStage />
      <BinaryStrip text="ASSETRA DIGITAL/WEB/E-SHOP/0 KC PREDEM/" />
      <Tapes
        label={'Napojení: ' + hero.integrations.map((i) => i.n).join(', ')}
        words={hero.tapeWords}
        items={hero.integrations}
      />
    </InView>
  )
}

/** The two ways in, side by side (not in the design file; built from its own components). */
export function Paths() {
  return (
    <InView className="paths-sec" aria-label="Dvě cesty">
      <div className="w paths">
        {paths.map((p, i) => (
          <Card key={p.kicker} reveal delaySec={0.1 * (i + 1)} className="path">
            <span className="lbl">{p.kicker}</span>
            <h2>{p.title}</h2>
            <p>{p.text}</p>
            <Button href={p.cta.href} variant={i === 0 ? 'pri' : 'gl'} arrow={i === 0}>{p.cta.label}</Button>
          </Card>
        ))}
      </div>
    </InView>
  )
}

const BARS = Array.from({ length: 30 }, (_, i) => i)

export function Services() {
  const [web, shop, care] = services.items
  const feat = (f: { b?: string; t?: string }) => (
    <li key={(f.b ?? '') + (f.t ?? '')}>{f.b && <b>{f.b}</b>}{f.b && f.t ? ' ' : ''}{f.t}</li>
  )
  return (
    <InView className="sec" id="sluzby">
      <div className="w">
        <div className="sh2">
          <div>
            <SectionLabel num="01">{services.label}</SectionLabel>
            <SectionTitle>{services.title}</SectionTitle>
          </div>
          <ParticleZone shapes={['WEB', 'E-SHOP', 'SPRÁVA']} />
        </div>
        <div className="bento">
          <Card span={5} reveal delaySec={0.1}>
            <div className="ch"><h3>{web.title}</h3><span>01</span></div>
            <ul className="feat">{web.features.map(feat)}</ul>
            <div className="vis rfw" aria-hidden="true">
              <div className="rf">
                <div className="rf-b"><i /><i /><i /></div>
                <div className="rf-c"><div className="rf-h" /><div className="rf-g"><i /><i /><i /></div><div className="rf-f"><i /><i /><b /></div></div>
              </div>
              <div className="rfl"><b>počítač</b><b>mobil</b></div>
            </div>
          </Card>
          <Card span={7} reveal delaySec={0.2}>
            <div className="ch"><h3>{shop.title}</h3><span>02</span></div>
            <ul className="feat">{shop.features.map(feat)}</ul>
            <div className="vis" aria-hidden="true">
              <div className="pipe">
                <div className="pn"><small>košík</small>Objednávka</div><i className="pl p1" />
                <div className="pn" style={delay(1.2)}><small>platba</small>Comgate</div><i className="pl p2" />
                <div className="pn" style={delay(2.4)}><small>faktura</small>Fakturoid</div><i className="pl p3" />
                <div className="pn" style={delay(3.6)}><small>štítek</small>Zásilkovna</div>
              </div>
              <div className="log">
                <span className="tl">→ objednávka #2042 · 1 290 Kč</span>
                <span className="tl ok" style={delay(1.2)}>✓ zaplaceno přes Comgate</span>
                <span className="tl ok" style={delay(2.4)}>✓ faktura vystavená ve Fakturoidu</span>
                <span className="tl ok" style={delay(3.6)}>✓ štítek Zásilkovny připravený</span>
              </div>
            </div>
          </Card>
          <Card reveal delaySec={0.3}>
            <div className="ch"><h3>{care.title}</h3><span>03</span></div>
            <ul className="feat">{care.features.map(feat)}</ul>
            <div className="vis st">
              <div className="st-a">
                <div><small>Ukázka přehledu</small><div className="live"><i />Web je online</div></div>
                <div>
                  <small>Dostupnost, posledních 30 dní</small>
                  <div className="bars" aria-hidden="true">{BARS.map((i) => <i key={i} style={{ animationDelay: i * 30 + 'ms' }} />)}</div>
                </div>
              </div>
              <ul className="chk">
                <li>Záloha<b>✓ dnes</b></li>
                <li>Aktualizace<b>✓ aktuální</b></li>
                <li>Certifikát SSL<b>✓ platný</b></li>
                <li>Úpravy na přání<b>v ceně</b></li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </InView>
  )
}

export function Contract() {
  return (
    <InView className="sec" id="smlouva">
      <div className="w">
        <div className="sh2">
          <div>
            <SectionLabel num="02">{contract.label}</SectionLabel>
            <SectionTitle>{contract.title}</SectionTitle>
            <Sub>{contract.sub}</Sub>
          </div>
          <ParticleZone shapes={['§']} />
        </div>
        <StackCards items={contract.rules} />
      </div>
    </InView>
  )
}

export function PricingSection() {
  return (
    <InView className="sec" id="cenik">
      <div className="w">
        <Pricing />
      </div>
    </InView>
  )
}

export function Process() {
  return (
    <InView className="sec" id="postup">
      <div className="w">
        <div className="sh2">
          <div>
            <SectionLabel num="04">{steps.label}</SectionLabel>
            <SectionTitle>{steps.title}</SectionTitle>
          </div>
          <ParticleZone shapes={['01', '02', '03', '04']} />
        </div>
        <Timeline steps={steps.steps} />
      </div>
    </InView>
  )
}

export function Work() {
  return (
    <InView className="sec" id="prace">
      <div className="w">
        <div className="wk">
          <div>
            <SectionLabel num="05">{work.label}</SectionLabel>
            <SectionTitle>{work.title}</SectionTitle>
            <ParticleZone className="pz-l" shapes={['@wave', 'HARWO']} />
          </div>
          <div className="rv" style={delay(0.1)}>
            <p className="sub">{work.sub}</p>
            <dl className="spec">
              {work.spec.map((s) => <div className="glass" key={s.dt}><dt>{s.dt}</dt><dd>{s.dd}</dd></div>)}
            </dl>
            {!work.approved && <Todo>[souhlas Harwo s ukázkou]</Todo>}
          </div>
        </div>
        <div className="stage" aria-hidden="true">
          <div className="tilt">
            <div className="st3">
              <div className="hw">
                {/* bottom-left: the floating palette / filter / order cards cover the other corners */}
                {!work.approved && <span className="stripe" style={{ top: 'auto', right: 'auto', bottom: 16, left: 16 }}>Návrh</span>}
                <div className="hb"><i /><i /><i /><span>harwo.cz</span></div>
                <div className="hh"><span className="hh-l">Harwo</span><span className="hh-s">Hledat zboží…</span><span className="hh-b">Objednat na IČO</span></div>
                <div className="hm">
                  <div className="hc"><b>Kategorie</b><span className="on">Sýry</span><span>Mléčné výrobky</span><span>Máslo a tuky</span><span>Uzeniny</span><span>Mražené</span><span>Nápoje</span></div>
                  <div>
                    <div className="hf"><span className="on">Chlazené 2–8 °C</span><span>Mražené −18 °C</span><span>Novinky</span></div>
                    <div className="hp">
                      <div><div className="food f1"><i /></div><span>Gouda, kolo</span><small>cena po přihlášení</small></div>
                      <div><div className="food f2"><i /></div><span>Eidam 30 %, blok</span><small>cena po přihlášení</small></div>
                      <div><div className="food f3"><i /></div><span>Máslo 82 %</span><small>cena po přihlášení</small></div>
                      <div><div className="food f4"><i /></div><span>Mozzarella</span><small>cena po přihlášení</small></div>
                      <div><div className="food f5"><i /></div><span>Smetana 33 %</span><small>cena po přihlášení</small></div>
                      <div><div className="food fz f6"><i /></div><span>Hranolky</span><small>mražené</small></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="sat s1 glass">
                <h4>Paleta</h4>
                <div className="sw">
                  <span><i style={{ background: '#efe9dc' }} />Len</span>
                  <span><i style={{ background: '#56634a' }} />Mech</span>
                  <span><i style={{ background: '#7e5536' }} />Kůra</span>
                  <span><i style={{ background: '#2f3a2a' }} />Les</span>
                </div>
                <p>Nadpisy serif, text Geist</p>
              </div>
              <div className="sat s2 glass">
                <h4>Filtr</h4>
                <div className="tg"><div>Chlazené<small>2–8 °C</small></div><span className="sw-t on" /></div>
                <div className="tg"><div>Mražené<small>−18 °C</small></div><span className="sw-t an" /></div>
              </div>
              <div className="sat s3 glass">
                <h4>Objednávka na firmu</h4>
                <div className="fld"><span>IČO</span><b>12345678</b></div>
                <span className="okb">Odeslat objednávku</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </InView>
  )
}

export function Quante() {
  return (
    <InView className="sec" id="quante">
      <div className="w">
        <div className="sh2">
          <div>
            <SectionLabel num="06">{quanteIntro.label}</SectionLabel>
            <SectionTitle>{quanteIntro.title}</SectionTitle>
            <Sub>{quanteIntro.sub}</Sub>
          </div>
          <ParticleZone shapes={['Q', 'ADS', 'AGENT']} />
        </div>
        <div className="prods">
          {modules.map((m, i) => <ModuleCard key={m.slug} m={m} i={i} />)}
        </div>
      </div>
    </InView>
  )
}

export function Contact() {
  return (
    <InView className="sec" id="kontakt">
      <div className="w ct">
        <div>
          <SectionLabel num="07">{contactSection.label}</SectionLabel>
          <h2 className="big ttl">{contactSection.title[0]}<span>{contactSection.title[1]}</span></h2>
          <p className="sub rv" style={delay(0.15)}>
            Konzultace je zdarma. Ozveme se do {contact.responseTime ?? <Todo>[doba]</Todo>}.
          </p>
          <dl className="cl rv" style={delay(0.25)}>
            <div className="glass"><dt>Telefon</dt><dd>{contact.phone ?? <Todo>[telefon]</Todo>}</dd></div>
            <div className="glass"><dt>E-mail</dt><dd>{contact.email ?? <Todo>[e-mail]</Todo>}</dd></div>
          </dl>
          <ParticleZone className="pz-l" shapes={['@', 'AHOJ']} />
        </div>
        <LeadForm />
      </div>
    </InView>
  )
}
