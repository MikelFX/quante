import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, CharHeading, CheckList, InView, ParticleZone, SectionLabel, SectionTitle, Sub, Timeline, delay } from '@ad/ui'
import { moduleBySlug, moduleHref, modules, modulesStatusLine, quanteApp, quanteFlow, quanteIntro } from '@/content/assetra/modules'
import { siteHref } from '@/lib/domains'
import { quantePricing } from '@/content/assetra/quante-pricing'
import { ModuleCard } from '../../_components/quante/ModuleCard'
import { QuantePricing } from '../../_components/quante/QuantePricing'
import { QuanteStart } from '../../_components/quante/QuanteStart'
import { quanteShare } from '../../_components/seo'

// quantecode.com/ (next.config.ts rewrites the app host's root here): every Quante product and how
// they connect. The canonical URL is the root of the app host.
export const metadata: Metadata = {
  title: { absolute: 'Quante — celý e-shop na jednom místě' },
  description: quanteIntro.sub + ' Generate, Qscan, Qgent s 20 agenty, Qdit, Qads a další produkty v jednom propojeném celku.',
  ...quanteShare({ path: '/', title: 'Quante — celý e-shop na jednom místě', description: quanteIntro.sub }),
}

export default function QuantePage() {
  return (
    <>
      <InView className="hero q-hero" initial>
        <div className="hgrid" aria-hidden="true" />
        <div className="glow g1" aria-hidden="true" />
        <div className="glow g2" aria-hidden="true" />
        <div className="w hin">
          <div>
            <span className="lbl rv"><b>Q</b>Quante od AssetraDigital</span>
            <Link className="q-new rv" href={moduleHref({ slug: 'qgent' })}>
              <b>Nové</b>Qgent: 20 agentů projde váš e-shop<span aria-hidden="true">→</span>
            </Link>
            <CharHeading text="Celý e-shop na jednom místě" />
            <p className="lead rv" style={delay(0.55)}>
              Vygenerovat, upravit, propagovat a spravovat. Moduly Quante na sebe navazují, takže e-shop vyřešíte
              v jedné aplikaci a nemusíte nikam jinam.
            </p>
            <div className="ctas rv" style={delay(0.65)}>
              <Button href="#moduly" variant="pri" beam arrow>Prohlédnout produkty</Button>
              <Button href={quanteApp.start}>Začít zdarma</Button>
            </div>
            <CheckList
              className="rv"
              delaySec={0.75}
              items={[`${quantePricing.welcomeCredits} kreditů zdarma`, 'Opravy buildu zdarma', 'Kód si stáhnete']}
            />
          </div>
          <ParticleZone className="orb rv" style={delay(0.2)} shapes={['Q', '@cube']} />
        </div>
      </InView>

      <InView className="sec" id="moduly">
        <div className="w">
          <SectionLabel num="01">Produkty</SectionLabel>
          <SectionTitle>Všechny produkty Quante</SectionTitle>
          <Sub>{modulesStatusLine()}</Sub>
          <div className="prods">
            {modules.map((m, i) => <ModuleCard key={m.slug} m={m} i={i} />)}
          </div>
        </div>
      </InView>

      <InView className="sec" id="propojeni">
        <div className="w">
          <SectionLabel num="02">Propojení</SectionLabel>
          <SectionTitle>Jak to drží pohromadě</SectionTitle>
          <Sub>Od převodu stávajícího obchodu po e-maily zákazníků. Každý krok navazuje na ten předchozí.</Sub>
          <Timeline
            steps={quanteFlow.map((f) => {
              const m = moduleBySlug(f.slug)!
              return { hash: m.name + (m.status === 'dev' ? ' · ve vývoji' : ''), title: f.title, text: f.text }
            })}
          />
          <p className="fine">
            Podrobnosti najdete u každého modulu: {modules.map((m, i) => (
              <span key={m.slug}>{i > 0 && ', '}<Link href={moduleHref(m)}>{m.name}</Link></span>
            ))}.
          </p>
        </div>
      </InView>

      <InView className="sec" id="zacit">
        <div className="w">
          <QuanteStart />
        </div>
      </InView>

      <InView className="sec" id="cenik">
        <div className="w">
          <QuantePricing />
        </div>
      </InView>

      <InView className="paths-sec mod-end">
        <div className="w paths">
          <div className="card glass spot path rv" style={delay(0.1)}>
            <span className="lbl">Udělejte si to sami</span>
            <h2>Začněte v Quante</h2>
            <p>Po registraci máte {quantePricing.welcomeCredits} kreditů zdarma. Na první e-shop stačí.</p>
            <Button href={quanteApp.start} variant="pri" arrow>Začít v Quante</Button>
          </div>
          <div className="card glass spot path rv" style={delay(0.2)}>
            <span className="lbl">Uděláme to za vás</span>
            <h2>Web nebo e-shop na míru</h2>
            <p>Navrhneme, postavíme a spravujeme. Bez vstupní investice, za měsíční paušál.</p>
            <Button href={siteHref('/web-eshop#kontakt')}>Domluvit konzultaci</Button>
          </div>
        </div>
      </InView>
    </>
  )
}
