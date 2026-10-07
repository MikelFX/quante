'use client'

import { useState, type FormEvent } from 'react'
import { Button, ChipGroup, Field, TextArea } from '@ad/ui'

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
