'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, ChipGroup, Field, TextArea } from '@ad/ui'
import { contactSection } from '@/content/assetra/site'
import { PREFILL_EVENT, takePrefill, type LeadPrefill } from '../qgent/prefill'

type State = '' | 'sending' | 'done' | 'error'

/** „Odeslat poptávku“ — stores the lead (POST /api/leads) and notifies AssetraDigital. */
export function LeadForm() {
  const [jmeno, setJmeno] = useState('')
  const [kontakt, setKontakt] = useState('')
  const [potreba, setPotreba] = useState('')
  const [zprava, setZprava] = useState('')
  const [web, setWeb] = useState('') // honeypot — people never see or fill it
  const [shownAt] = useState(() => Date.now())
  const [state, setState] = useState<State>('')
  const [error, setError] = useState('')
  const [viaQgent, setViaQgent] = useState(false)

  // Qgent hands over name / contact / need after the visitor confirmed it in the panel —
  // either right now (event) or before this page was open (sessionStorage).
  useEffect(() => {
    const apply = (p: LeadPrefill | null) => {
      if (!p) return
      if (p.jmeno) setJmeno(p.jmeno)
      if (p.kontakt) setKontakt(p.kontakt)
      if ((contactSection.needs as string[]).includes(p.potreba)) setPotreba(p.potreba)
      setViaQgent(true)
      setState((s) => (s === 'done' ? s : ''))
    }
    const onPrefill = () => {
      apply(takePrefill())
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.frm textarea[name="zprava"]')?.focus({ preventScroll: true }))
    }
    apply(takePrefill())
    window.addEventListener(PREFILL_EVENT, onPrefill)
    return () => window.removeEventListener(PREFILL_EVENT, onPrefill)
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (state === 'sending' || state === 'done') return
    if (kontakt.trim().length < 3) {
      setState('error')
      setError('Vyplňte prosím telefon nebo e-mail, ať se vám můžeme ozvat.')
      return
    }
    setState('sending')
    setError('')
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jmeno, kontakt, potreba, zprava, web, ms: Date.now() - shownAt, ...(viaQgent ? { via: 'qgent' } : {}) }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Poptávku se nepodařilo odeslat. Zkuste to prosím znovu.')
      setState('done')
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Poptávku se nepodařilo odeslat. Zkuste to prosím znovu.')
    }
  }

  const label = state === 'sending' ? 'Odesílám…' : state === 'done' ? 'Odesláno' : 'Odeslat poptávku'

  return (
    <form className="frm glass beam rv" style={{ animationDelay: '.2s' }} onSubmit={submit} noValidate>
      <Field label="Jméno a firma" name="jmeno" autoComplete="organization" placeholder="Jana Nováková, Pekárna Lipová" maxLength={120} value={jmeno} onChange={(e) => setJmeno(e.target.value)} />
      <Field label="Kontakt" name="kontakt" autoComplete="email" placeholder="Telefon nebo e-mail" maxLength={160} required aria-required="true" value={kontakt} onChange={(e) => setKontakt(e.target.value)} />
      <ChipGroup legend="Co potřebujete" options={[...contactSection.needs]} value={potreba} onChange={setPotreba} />
      <TextArea label="Pár slov k zadání" name="zprava" placeholder="Co prodáváte, co máte teď a co chcete změnit" maxLength={4000} value={zprava} onChange={(e) => setZprava(e.target.value)} />
      <div className="hpot" aria-hidden="true">
        <label>Web<input type="text" name="web" tabIndex={-1} autoComplete="off" value={web} onChange={(e) => setWeb(e.target.value)} /></label>
      </div>
      {viaQgent && state !== 'done' && <p className="frm-note">Předvyplnil asistent Qgent. Zkontrolujte údaje a poptávku odešlete.</p>}
      <Button type="submit" variant="pri" arrow disabled={state === 'sending' || state === 'done'}>{label}</Button>
      <p className="frm-note">
        Údaje použijeme jen k odpovědi na poptávku. Více v <Link href="/ochrana-osobnich-udaju">ochraně osobních údajů</Link>.
      </p>
      <div aria-live="polite">
        {state === 'done' && <p className="sent">Poptávka odeslaná. Děkujeme, ozveme se vám.</p>}
        {state === 'error' && <p className="frm-err" role="alert">{error}</p>}
      </div>
    </form>
  )
}
