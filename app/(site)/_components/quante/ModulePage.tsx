import Link from 'next/link'
import { Button, Card, InView, ParticleZone, Pill, SectionLabel, SectionTitle, Sub, delay } from '@ad/ui'
import { moduleBySlug, moduleHref, quanteHome, type QuanteModule } from '@/content/assetra/modules'
import { siteHref } from '@/lib/domains'
import { moduleCosts } from '@/content/assetra/quante-pricing'
import { ModuleVisual } from '../ModuleVisual'
import { CursorEdit } from './CursorEdit'
import { cursorEditScript } from './cursor-edit-script'

/**
 * /quante/<slug>: what the module does, how it connects to the others, the animated mini-UI and —
 * only for modules that really ship — the way into the app. Modules in development get the
 * „Ve vývoji“ label, no app entry and no dates.
 */
export function ModulePage({ m }: { m: QuanteModule }) {
  const live = m.status === 'live'
  const costs = moduleCosts(m.slug)
  // Qdit and Qgent open with a cursor editing their own headline and lead (CursorEdit.tsx)
  const edit = cursorEditScript(m.slug, m.name, m.lead)
  return (
    <>
      <InView className="sec mod-top" initial>
        <div className="w">
          <Link className="mod-back rv" href={quanteHome()}>← Všechny produkty Quante</Link>
          <div className="sh2">
            <div>
              <Pill badge={live ? 'K dispozici' : 'Ve vývoji'}>{m.tag}</Pill>
              {edit ? (
                <CursorEdit name={m.name} script={edit} />
              ) : (
                <>
                  <SectionTitle as="h1">{m.name}</SectionTitle>
                  <Sub>{m.lead}</Sub>
                </>
              )}
              <div className="ctas rv" style={delay(0.2)}>
                {m.app ? (
                  <Button href={m.app.href} variant="pri" beam arrow>{m.app.label}</Button>
                ) : (
                  <Button href={siteHref('/#kontakt')} variant="pri" beam arrow>Domluvit konzultaci</Button>
                )}
                <Button href={quanteHome('#moduly')}>Všechny produkty</Button>
              </div>
            </div>
            <ParticleZone shapes={m.shapes} />
          </div>
          <div className="prod glass mod-demo rv" style={delay(0.25)}>
            <ModuleVisual slug={m.slug} />
          </div>
        </div>
      </InView>

      <InView className="sec">
        <div className="w">
          <SectionLabel num="01">{live ? 'Co umí' : 'Co bude umět'}</SectionLabel>
          <SectionTitle>{live ? 'Co modul dělá' : 'Na čem pracujeme'}</SectionTitle>
          <div className="bento">
            {m.features.map((f, i) => (
              <Card key={f.title} className="w4" reveal delaySec={0.08 * ((i % 3) + 1)}>
                <div className="ch"><h3>{f.title}</h3><span>{String(i + 1).padStart(2, '0')}</span></div>
                <p className="mod-text">{f.text}</p>
              </Card>
            ))}
          </div>
          {m.note && <p className="fine mod-note rv">{m.note}</p>}
        </div>
      </InView>

      <InView className="sec">
        <div className="w">
          <SectionLabel num="02">Propojení</SectionLabel>
          <SectionTitle>Jak navazuje</SectionTitle>
          <div className="bento">
            {m.links.map((l, i) => {
              const to = moduleBySlug(l.to)!
              return (
                <Card key={l.to} className="w4" reveal delaySec={0.08 * (i + 1)}>
                  <div className="ch"><h3>{to.name}</h3>{to.status === 'dev' && <span>ve vývoji</span>}</div>
                  <p className="mod-text">{l.text}</p>
                  <div className="lk"><Link href={moduleHref(to)}>Detail modulu ↗</Link></div>
                </Card>
              )
            })}
          </div>
        </div>
      </InView>

      {costs.length > 0 && (
        <InView className="sec">
          <div className="w">
            <SectionLabel num="03">Cena</SectionLabel>
            <SectionTitle>Kolik to stojí</SectionTitle>
            <ul className="plist">
              {costs.map((c) => <li key={c.label}><span className="n">{c.label}</span><i /><b>{c.value}</b></li>)}
            </ul>
            <p className="fine">Ceny kreditů a balíčky najdete v <Link href={quanteHome('#cenik')}>ceníku Quante</Link>.</p>
          </div>
        </InView>
      )}

      <InView className="paths-sec mod-end">
        <div className="w paths">
          <Card reveal delaySec={0.1} className="path">
            <span className="lbl">Uděláme to za vás</span>
            <h2>Raději s námi?</h2>
            <p>Web nebo e-shop navrhneme, postavíme a spravujeme. Bez vstupní investice, za měsíční paušál.</p>
            <Button href={siteHref('/#kontakt')} variant={live ? 'gl' : 'pri'} arrow={!live}>Domluvit konzultaci</Button>
          </Card>
          <Card reveal delaySec={0.2} className="path">
            <span className="lbl">Quante</span>
            <h2>Další produkty</h2>
            <p>Generate, Qscan, Qgent s 20 agenty, Qdit, Qads a Qails tvoří jeden propojený celek.</p>
            <Button href={quanteHome('#moduly')}>Všechny produkty</Button>
          </Card>
        </div>
      </InView>
    </>
  )
}
