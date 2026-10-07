'use client'

import { useState, type FormEvent } from 'react'
import { Button, ChipGroup, Field, SectionLabel, SectionTitle, Segmented, SlotNumber, TextArea } from '@ad/ui'

/** Ceník from the design: subscription vs one-off, prices roll in like a slot machine. */
export function PricingDemo() {
  const [mode, setMode] = useState<'sub' | 'one'>('sub')
  return (
    <>
      <div className="prh">
        <div>
          <SectionLabel num="03">Ceník</SectionLabel>
          <SectionTitle>Ceny jako automat</SectionTitle>
        </div>
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
          <div className="zero"><b>0 Kč</b><span>předem<br />minimálně 24 měsíců</span></div>
          <div className="plans">
            <article className="plan glass spot">
              <div className="plh"><h3>Web</h3><span>předplatné</span></div>
              <div className="price"><b><SlotNumber value="990" base={0.1} /></b><span>Kč měsíčně</span></div>
              <ul className="inc"><li>Návrh a stavba na míru</li><li>Hosting, správa a zálohy</li><li>Drobné úpravy</li></ul>
              <Button href="#formular">Domluvit konzultaci</Button>
            </article>
            <article className="plan glass beam spot">
              <div className="plh"><h3>E-shop</h3><span className="hot">předplatné</span></div>
              <div className="price"><b><SlotNumber value="2 490" base={0.2} /></b><span>Kč měsíčně</span></div>
              <ul className="inc"><li>Návrh a stavba na míru</li><li>Doprava, platby a faktury napojené</li><li>Hosting, správa a zálohy</li><li>Drobné úpravy</li></ul>
              <Button href="#formular" variant="pri" arrow>Domluvit konzultaci</Button>
            </article>
          </div>
          <p className="fine">Minimální délka předplatného je 24 měsíců.</p>
        </div>
      ) : (
        <div className="pp">
          <ul className="plist">
            <li><span className="n">Web</span><i /><b>od <SlotNumber value="14 900" base={0.1} /> Kč</b></li>
            <li><span className="n">E-shop</span><i /><b>od <SlotNumber value="49 900" base={0.2} /> Kč</b></li>
            <li><span className="n">Správa</span><i /><b>od <span className="todo">[cena]</span> měsíčně</b></li>
            <li><span className="n">Práce navíc</span><i /><b><span className="todo">[sazba]</span> za hodinu</b></li>
          </ul>
        </div>
      )}
      <p className="fine">Ceny jsou uvedeny <span className="todo">[bez DPH / s DPH]</span>.</p>
    </>
  )
}

const NEEDS = ['Firemní web', 'E-shop', 'Správa', 'Něco jiného']

/** The contact form's look and states. On this page it sends nothing. */
export function FormDemo() {
  const [need, setNeed] = useState('')
  const [sent, setSent] = useState<'' | 'sending' | 'done'>('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (sent) return
    setSent('sending')
    window.setTimeout(() => setSent('done'), 1400)
  }
  const label = sent === 'sending' ? 'Odesílám…' : sent === 'done' ? 'Odesláno' : 'Odeslat poptávku'

  return (
    <form className="frm glass beam rv" id="formular" onSubmit={submit} style={{ animationDelay: '.2s' }}>
      <Field label="Jméno a firma" name="jmeno" autoComplete="organization" placeholder="Jana Nováková, Pekárna Lipová" />
      <Field label="Kontakt" name="kontakt" autoComplete="email" placeholder="Telefon nebo e-mail" />
      <ChipGroup legend="Co potřebujete" options={NEEDS} value={need} onChange={setNeed} />
      <TextArea label="Pár slov k zadání" name="zprava" placeholder="Co prodáváte, co máte teď a co chcete změnit" />
      <Button type="submit" variant="pri" arrow>{label}</Button>
      <div aria-live="polite">
        {sent === 'done' && <p className="sent">Poptávka odeslaná. Ukázka: formulář zatím nikam neodesílá.</p>}
      </div>
    </form>
  )
}
