'use client'

import { useState } from 'react'
import { Button, ParticleZone, SectionLabel, SectionTitle, Segmented, SlotNumber, Todo } from '@ad/ui'
import { pricing } from '@/content/assetra/site'

/** Ceník: subscription (0 Kč upfront) vs one-off; prices spin in like a slot machine. */
export function Pricing({ ctaHref = '#kontakt', num = '03' }: { ctaHref?: string; num?: string }) {
  const [mode, setMode] = useState<'sub' | 'one'>('sub')
  const { subscription: sub, oneOff } = pricing
  return (
    <>
      <div className="prh">
        <div>
          <SectionLabel num={num}>{pricing.label}</SectionLabel>
          <SectionTitle>{pricing.title}</SectionTitle>
        </div>
        <ParticleZone className="pz-s" shapes={['0 Kč', '990', '2 490']} />
        <Segmented
          className="rv"
          label="Způsob platby"
          value={mode}
          onChange={setMode}
          options={[{ value: 'sub', label: 'Předplatné' }, { value: 'one', label: 'Jednorázově' }]}
        />
      </div>
      {mode === 'sub' ? (
        <div className="pp">
          <div className="zero"><b>{sub.upfront}</b><span>předem<br />minimálně {sub.minMonths} měsíců</span></div>
          <div className="plans">
            {sub.plans.map((p, i) => (
              <article className={p.hot ? 'plan glass beam spot' : 'plan glass spot'} key={p.name}>
                <div className="plh"><h3>{p.name}</h3><span className={p.hot ? 'hot' : undefined}>předplatné</span></div>
                <div className="price"><b><SlotNumber value={p.monthly} base={0.1 * (i + 1)} /></b><span>Kč měsíčně</span></div>
                <ul className="inc">{p.includes.map((x) => <li key={x}>{x}</li>)}</ul>
                <Button href={ctaHref} variant={p.hot ? 'pri' : 'gl'} arrow={p.hot}>Domluvit konzultaci</Button>
              </article>
            ))}
          </div>
          <p className="fine">Minimální délka předplatného je {sub.minMonths} měsíců.</p>
        </div>
      ) : (
        <div className="pp">
          <ul className="plist">
            <li><span className="n">Web</span><i /><b>od <SlotNumber value={oneOff.web} base={0.1} /> Kč</b></li>
            <li><span className="n">E-shop</span><i /><b>od <SlotNumber value={oneOff.eshop} base={0.2} /> Kč</b></li>
            <li><span className="n">Správa</span><i /><b>od {oneOff.management ?? <Todo>[cena]</Todo>} měsíčně</b></li>
            <li><span className="n">Práce navíc</span><i /><b>{oneOff.hourly ?? <Todo>[sazba]</Todo>} za hodinu</b></li>
          </ul>
        </div>
      )}
      <p className="fine">Ceny jsou uvedeny {pricing.vat ?? <Todo>[bez DPH / s DPH]</Todo>}.</p>
    </>
  )
}
