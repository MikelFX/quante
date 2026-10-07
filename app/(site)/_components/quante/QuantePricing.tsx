import { Button, SectionLabel, SectionTitle, SlotNumber, Sub } from '@ad/ui'
import { quanteApp } from '@/content/assetra/modules'
import { kredity, quantePricing as p } from '@/content/assetra/quante-pricing'
import { AgencyCta } from './AgencyCta'

/** Quante pricing: credit packs, what things cost, hosting and Agency — all read from the code. */
export function QuantePricing({ num = '03' }: { num?: string }) {
  return (
    <>
      <SectionLabel num={num}>Ceník Quante</SectionLabel>
      <SectionTitle>Kredity a hosting</SectionTitle>
      <Sub>
        Quante počítá kredity. Po registraci jich dostanete {p.welcomeCredits} zdarma, další si dokoupíte v balíčku.
        Ceny jsou v USD a platí se kartou přes Stripe.
      </Sub>

      <div className="plans">
        {p.packs.map((pack, i) => (
          <article className={pack.popular ? 'plan glass beam spot' : 'plan glass spot'} key={pack.id}>
            <div className="plh">
              <h3>{kredity(pack.credits)}</h3>
              <span className={pack.popular ? 'hot' : undefined}>{pack.popular ? 'nejčastější' : 'balíček'}</span>
            </div>
            <div className="price">
              <b><SlotNumber value={pack.price} base={0.1 * (i + 1)} /></b>
              <span>USD<br />{pack.perCredit} USD za kredit</span>
            </div>
            <Button href={quanteApp.dashboard} variant={pack.popular ? 'pri' : 'gl'} arrow={pack.popular}>Otevřít Quante</Button>
          </article>
        ))}
      </div>

      <ul className="plist q-costs">
        {p.costs.map((c) => (
          <li key={c.label}><span className="n">{c.label}</span><i /><b>{c.value}</b></li>
        ))}
        <li><span className="n">Hosting obchodu</span><i /><b>{p.hosting.annualUsd} USD ročně, první měsíc zdarma</b></li>
        <li><span className="n">Agency</span><i /><b>{p.agency.monthlyUsd} USD měsíčně · až {p.agency.projects} obchodů, úpravy a opravy bez kreditů, export bez značky Quante</b></li>
      </ul>
      <AgencyCta />
      <p className="fine">Kredity za generování a úpravy se strhávají předem. Když se obchod nepodaří sestavit ani po pěti automatických opravách, vrátí se.</p>
    </>
  )
}
