import { Button, SectionLabel, SectionTitle, SlotNumber, Sub } from '@ad/ui'
import { quanteApp, type Locale } from '@/content/assetra/modules'
import { creditsEn, kredity, quantePricing, quantePricingEn } from '@/content/assetra/quante-pricing'
import { AgencyCta } from './AgencyCta'
import { uiCopy } from './ui-copy'

/** Quante pricing: credit packs, what things cost, hosting and Agency — all read from the code. */
export function QuantePricing({ num = '03', locale = 'cs' }: { num?: string; locale?: Locale }) {
  const p = locale === 'en' ? quantePricingEn : quantePricing
  const credits = locale === 'en' ? creditsEn : kredity
  const t = uiCopy(locale)
  return (
    <>
      <SectionLabel num={num}>{t.pricingLbl}</SectionLabel>
      <SectionTitle>{t.pricingTitle}</SectionTitle>
      <Sub>{t.pricingSub(p.welcomeCredits)}</Sub>

      <div className="plans">
        {p.packs.map((pack, i) => (
          <article className={pack.popular ? 'plan glass beam spot' : 'plan glass spot'} key={pack.id}>
            <div className="plh">
              <h3>{credits(pack.credits)}</h3>
              <span className={pack.popular ? 'hot' : undefined}>{pack.popular ? t.popular : t.pack}</span>
            </div>
            <div className="price">
              <b><SlotNumber value={pack.price} base={0.1 * (i + 1)} /></b>
              <span>USD<br />{pack.perCredit} {t.perCredit}</span>
            </div>
            <Button href={quanteApp.dashboard} variant={pack.popular ? 'pri' : 'gl'} arrow={pack.popular}>{t.openQuante}</Button>
          </article>
        ))}
      </div>

      <ul className="plist q-costs">
        {p.costs.map((c) => (
          <li key={c.label}><span className="n">{c.label}</span><i /><b>{c.value}</b></li>
        ))}
        <li><span className="n">{t.hosting}</span><i /><b>{t.hostingValue(p.hosting.annualUsd)}</b></li>
        <li><span className="n">Agency</span><i /><b>{t.agencyValue(p.agency.monthlyUsd, p.agency.summary)}</b></li>
      </ul>
      <AgencyCta locale={locale} />
      <p className="fine">{t.pricingFine(p.agency.fairUse)}</p>
    </>
  )
}
