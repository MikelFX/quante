import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, CharHeading, CheckList, InView, ParticleZone, SectionLabel, SectionTitle, Sub, Timeline, delay } from '@ad/ui'
import { moduleBySlug, modules, quanteApp, quanteFlow, quanteIntro } from '@/content/assetra/modules'
import { quantePricing } from '@/content/assetra/quante-pricing'
import { ModuleCard } from '../../_components/quante/ModuleCard'
import { QuantePricing } from '../../_components/quante/QuantePricing'

export const metadata: Metadata = {
  title: 'Quante — celý e-shop na jednom místě',
  description: quanteIntro.sub + ' Generate, Qdit, Qads a další moduly v jednom propojeném celku.',
  openGraph: { locale: 'cs_CZ', siteName: 'Assetra Digital', title: 'Quante — celý e-shop na jednom místě', description: quanteIntro.sub },
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
            <CharHeading text="Celý e-shop na jednom místě" />
            <p className="lead rv" style={delay(0.55)}>
              Vygenerovat, upravit, propagovat a spravovat. Moduly Quante na sebe navazují, takže e-shop vyřešíte
              v jedné aplikaci a nemusíte nikam jinam.
            </p>
            <div className="ctas rv" style={delay(0.65)}>
              <Button href={quanteApp.dashboard} variant="pri" beam arrow>Otevřít Quante</Button>
              <Button href="/#kontakt">Uděláme to za vás</Button>
            </div>
            <CheckList
              className="rv"
              delaySec={0.75}
              items={[`${quantePricing.welcomeCredits} kreditů zdarma`, 'Opravy buildu zdarma', 'Kód si stáhnete']}
            />
          </div>
          <ParticleZone className="orb rv" style={delay(0.2)} shapes={['Q', '@cube']}>
            <span className="orb-l">Táhni nebo <b>klikni</b></span>
          </ParticleZone>
        </div>
      </InView>

      <InView className="sec" id="moduly">
        <div className="w">
          <SectionLabel num="01">Moduly</SectionLabel>
          <SectionTitle>Šest modulů, jeden celek</SectionTitle>
          <Sub>Tři moduly fungují a můžete je používat hned. Qscan, Qgent a Qails jsou ve vývoji.</Sub>
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
              <span key={m.slug}>{i > 0 && ', '}<Link href={'/quante/' + m.slug}>{m.name}</Link></span>
            ))}.
          </p>
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
            <Button href={quanteApp.signup} variant="pri" arrow>Založit účet</Button>
          </div>
          <div className="card glass spot path rv" style={delay(0.2)}>
            <span className="lbl">Uděláme to za vás</span>
            <h2>Web nebo e-shop na míru</h2>
            <p>Navrhneme, postavíme a spravujeme. Bez vstupní investice, za měsíční paušál.</p>
            <Button href="/#kontakt">Domluvit konzultaci</Button>
          </div>
        </div>
      </InView>
    </>
  )
}
