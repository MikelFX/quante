import Link from 'next/link'
import { Button, Card, InView, ParticleZone, Pill, SectionLabel, SectionTitle, Sub, delay } from '@ad/ui'
import { moduleBySlug, moduleHref, quanteHome, type Locale, type QuanteModule } from '@/content/assetra/modules'
import { siteHref } from '@/lib/domains'
import { moduleCosts, moduleCostsEn } from '@/content/assetra/quante-pricing'
import { ModuleVisual } from '../ModuleVisual'
import { CursorEdit } from './CursorEdit'
import { cursorEditScript } from './cursor-edit-script'
import { uiCopy } from './ui-copy'

/**
 * /quante/<slug>: what the module does, how it connects to the others, the animated mini-UI and —
 * only for modules that really ship — the way into the app. Modules in development get the
 * „Ve vývoji“ label, no app entry and no dates.
 */
export function ModulePage({ m, locale = 'cs' }: { m: QuanteModule; locale?: Locale }) {
  const live = m.status === 'live'
  const t = uiCopy(locale)
  const costs = locale === 'en' ? moduleCostsEn(m.slug) : moduleCosts(m.slug)
  // Qdit and Qgent open with a cursor editing their own headline and lead (CursorEdit.tsx). Its
  // drafts are written for the Czech copy, so the English pages show the plain hero.
  const edit = locale === 'cs' ? cursorEditScript(m.slug, m.name, m.lead) : null
  return (
    <>
      <InView className="sec mod-top" initial>
        <div className="w">
          <Link className="mod-back rv" href={quanteHome('', locale)}>{t.backAll}</Link>
          <div className="sh2">
            <div>
              <Pill badge={live ? t.available : t.inDev}>{m.tag}</Pill>
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
                  <Button href={siteHref('/#kontakt')} variant="pri" beam arrow>{t.consult}</Button>
                )}
                <Button href={quanteHome('#moduly', locale)}>{t.allProducts}</Button>
              </div>
            </div>
            <ParticleZone shapes={m.shapes} />
          </div>
          <div className="prod glass mod-demo rv" style={delay(0.25)}>
            <ModuleVisual slug={m.slug} locale={locale} />
          </div>
        </div>
      </InView>

      <InView className="sec">
        <div className="w">
          <SectionLabel num="01">{live ? t.whatItDoesLbl : t.whatItWillLbl}</SectionLabel>
          <SectionTitle>{live ? t.whatItDoes : t.whatWeBuild}</SectionTitle>
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
          <SectionLabel num="02">{t.connections}</SectionLabel>
          <SectionTitle>{t.howItConnects}</SectionTitle>
          <div className="bento">
            {m.links.map((l, i) => {
              const to = moduleBySlug(l.to, locale)!
              return (
                <Card key={l.to} className="w4" reveal delaySec={0.08 * (i + 1)}>
                  <div className="ch"><h3>{to.name}</h3>{to.status === 'dev' && <span>{t.inDevLower}</span>}</div>
                  <p className="mod-text">{l.text}</p>
                  <div className="lk"><Link href={moduleHref(to, locale)}>{t.moduleDetail}</Link></div>
                </Card>
              )
            })}
          </div>
        </div>
      </InView>

      {costs.length > 0 && (
        <InView className="sec">
          <div className="w">
            <SectionLabel num="03">{t.price}</SectionLabel>
            <SectionTitle>{t.howMuch}</SectionTitle>
            <ul className="plist">
              {costs.map((c) => <li key={c.label}><span className="n">{c.label}</span><i /><b>{c.value}</b></li>)}
            </ul>
            <p className="fine">{t.pricesIn} <Link href={quanteHome('#cenik', locale)}>{t.pricingLink}</Link>.</p>
          </div>
        </InView>
      )}

      <InView className="paths-sec mod-end">
        <div className="w paths">
          <Card reveal delaySec={0.1} className="path">
            <span className="lbl">{t.forYouLbl}</span>
            <h2>{t.withUs}</h2>
            <p>{t.withUsText}</p>
            <Button href={siteHref('/#kontakt')} variant={live ? 'gl' : 'pri'} arrow={!live}>{t.consult}</Button>
          </Card>
          <Card reveal delaySec={0.2} className="path">
            <span className="lbl">Quante</span>
            <h2>{t.moreProducts}</h2>
            <p>{t.moreProductsText}</p>
            <Button href={quanteHome('#moduly', locale)}>{t.allProducts}</Button>
          </Card>
        </div>
      </InView>
    </>
  )
}
