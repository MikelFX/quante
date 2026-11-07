import Link from 'next/link'
import { Button, CharHeading, CheckList, InView, ParticleZone, SectionLabel, SectionTitle, Sub, Timeline, delay } from '@ad/ui'
import { moduleBySlug, moduleHref, modulesFor, modulesStatusLine, quanteApp, quanteFlowFor, type Locale } from '@/content/assetra/modules'
import { siteHref } from '@/lib/domains'
import { quantePricing } from '@/content/assetra/quante-pricing'
import { ModuleCard } from './ModuleCard'
import { QuantePricing } from './QuantePricing'
import { QuanteStart } from './QuanteStart'
import { AgentNumbers } from './AgentNumbers'
import { uiCopy } from './ui-copy'

// The Quante overview: quantecode.com/ (Czech) and quantecode.com/en. Every product and how they
// connect, where to start, pricing, the agents strip.
const COPY = {
  cs: {
    label: 'Quante od AssetraDigital',
    newBadge: 'Nové',
    newText: 'Qgent: 20 agentů projde váš e-shop',
    title: 'Celý e-shop na jednom místě',
    lead: 'Vygenerovat, upravit, propagovat a spravovat. Moduly Quante na sebe navazují, takže e-shop vyřešíte v jedné aplikaci a nemusíte nikam jinam.',
    browse: 'Prohlédnout produkty',
    checks: (n: number) => [`${n} kreditů zdarma`, 'Opravy buildu zdarma', 'Kód si stáhnete'],
    allTitle: 'Všechny produkty Quante',
    flowSub: 'Od převodu stávajícího obchodu po e-maily zákazníků. Každý krok navazuje na ten předchozí.',
    flowTitle: 'Jak to drží pohromadě',
    devSuffix: ' · ve vývoji',
    details: 'Podrobnosti najdete u každého modulu:',
    and: ', ',
    agentsLbl: 'Agenti',
    agentsTitle: 'Agenti u nás',
    agentsSub: 'Quante je i místo pro AI agenty: každá stránka jako Markdown, MCP server bez klíče, placené nástroje a Qbox sandboxy, za které agent zaplatí sám. Tady je vidět, kolik jich už přišlo a nakoupilo.',
    diyLbl: 'Udělejte si to sami',
    diyTitle: 'Začněte v Quante',
    diyText: (n: number) => `Po registraci máte ${n} kreditů zdarma. Na první e-shop stačí.`,
    diyCta: 'Začít v Quante',
    customTitle: 'Web nebo e-shop na míru',
    customText: 'Navrhneme, postavíme a spravujeme. Bez vstupní investice, za měsíční paušál.',
  },
  en: {
    label: 'Quante by AssetraDigital',
    newBadge: 'New',
    newText: 'Qgent: 20 agents go through your store',
    title: 'Your whole store in one place',
    lead: 'Generate, edit, promote and run it. The Quante modules build on each other, so your online store lives in one app and you don’t need anything else.',
    browse: 'See the products',
    checks: (n: number) => [`${n} free credits`, 'Build fixes for free', 'Download your code'],
    allTitle: 'Every Quante product',
    flowSub: 'From moving an existing store to your customers’ e-mail. Every step builds on the one before.',
    flowTitle: 'How it fits together',
    devSuffix: ' · in development',
    details: 'Details for each module:',
    and: ', ',
    agentsLbl: 'Agents',
    agentsTitle: 'Agents at Quante',
    agentsSub: 'Quante is a place for AI agents too: every page as Markdown, an MCP server with no key, paid tools and Qbox sandboxes the agent pays for itself. Here is how many have come by and bought.',
    diyLbl: 'Do it yourself',
    diyTitle: 'Start in Quante',
    diyText: (n: number) => `You get ${n} free credits when you sign up. Enough for your first store.`,
    diyCta: 'Start in Quante',
    customTitle: 'A custom website or store',
    customText: 'We design, build and run it. No upfront cost, one monthly fee.',
  },
}

export function QuanteOverview({ locale = 'cs' }: { locale?: Locale }) {
  const c = COPY[locale]
  const t = uiCopy(locale)
  const mods = modulesFor(locale)
  return (
    <>
      <InView className="hero q-hero" initial>
        <div className="hgrid" aria-hidden="true" />
        <div className="glow g1" aria-hidden="true" />
        <div className="glow g2" aria-hidden="true" />
        <div className="w hin">
          <div>
            <span className="lbl rv"><b>Q</b>{c.label}</span>
            <Link className="q-new rv" href={moduleHref({ slug: 'qgent' }, locale)}>
              <b>{c.newBadge}</b>{c.newText}<span aria-hidden="true">→</span>
            </Link>
            <CharHeading text={c.title} />
            <p className="lead rv" style={delay(0.55)}>{c.lead}</p>
            <div className="ctas rv" style={delay(0.65)}>
              <Button href="#moduly" variant="pri" beam arrow>{c.browse}</Button>
              <Button href={quanteApp.start}>{t.startFree}</Button>
            </div>
            <CheckList className="rv" delaySec={0.75} items={c.checks(quantePricing.welcomeCredits)} />
          </div>
          <ParticleZone className="orb rv" style={delay(0.2)} shapes={['Q', '@cube']} />
        </div>
      </InView>

      <InView className="sec" id="moduly">
        <div className="w">
          <SectionLabel num="01">{t.products}</SectionLabel>
          <SectionTitle>{c.allTitle}</SectionTitle>
          <Sub>{modulesStatusLine(locale)}</Sub>
          <div className="prods">
            {mods.map((m, i) => <ModuleCard key={m.slug} m={m} i={i} locale={locale} />)}
          </div>
        </div>
      </InView>

      <InView className="sec" id="propojeni">
        <div className="w">
          <SectionLabel num="02">{t.connections}</SectionLabel>
          <SectionTitle>{c.flowTitle}</SectionTitle>
          <Sub>{c.flowSub}</Sub>
          <Timeline
            steps={quanteFlowFor(locale).map((f) => {
              const m = moduleBySlug(f.slug, locale)!
              return { hash: m.name + (m.status === 'dev' ? c.devSuffix : ''), title: f.title, text: f.text }
            })}
          />
          <p className="fine">
            {c.details} {mods.map((m, i) => (
              <span key={m.slug}>{i > 0 && c.and}<Link href={moduleHref(m, locale)}>{m.name}</Link></span>
            ))}.
          </p>
        </div>
      </InView>

      <InView className="sec" id="zacit">
        <div className="w">
          <QuanteStart locale={locale} />
        </div>
      </InView>

      <InView className="sec" id="cenik">
        <div className="w">
          <QuantePricing locale={locale} />
        </div>
      </InView>

      <InView className="sec" id="agenti">
        <div className="w">
          <SectionLabel num="04">{c.agentsLbl}</SectionLabel>
          <SectionTitle>{c.agentsTitle}</SectionTitle>
          <Sub>{c.agentsSub}</Sub>
          <AgentNumbers locale={locale} />
        </div>
      </InView>

      <InView className="paths-sec mod-end">
        <div className="w paths">
          <div className="card glass spot path rv" style={delay(0.1)}>
            <span className="lbl">{c.diyLbl}</span>
            <h2>{c.diyTitle}</h2>
            <p>{c.diyText(quantePricing.welcomeCredits)}</p>
            <Button href={quanteApp.start} variant="pri" arrow>{c.diyCta}</Button>
          </div>
          <div className="card glass spot path rv" style={delay(0.2)}>
            <span className="lbl">{t.forYouLbl}</span>
            <h2>{c.customTitle}</h2>
            <p>{c.customText}</p>
            <Button href={siteHref('/web-eshop#kontakt')}>{t.consult}</Button>
          </div>
        </div>
      </InView>
    </>
  )
}
