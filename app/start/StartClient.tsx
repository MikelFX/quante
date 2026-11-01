'use client'

// The onboarding wizard (/start, lib/onboarding/model.ts): three steps with a progress bar —
// who you are, what you want to do first, one short input — then the visitor lands in the module
// with that input already filled. Signed out, the answers wait in localStorage while they sign up
// (/signup → /start?resume=1) and the wizard finishes by itself on the way back.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, ArrowRight, Bot, Building2, CalendarDays, Check, Clapperboard, Globe, Loader2,
  Megaphone, PenLine, ScanLine, ShoppingBag, Sparkles, Store, UserRound, X,
} from 'lucide-react'
import { ParticleMode } from '@ad/ui/particles'
import { QuanteBrand } from '@/components/shell/QuanteBrand'
import { CREDIT_COSTS } from '@/lib/config'
import { siteHref } from '@/lib/domains'
import {
  EMPTY, LIMITS, PENDING_KEY, PENDING_MAX_AGE_MS, STEPS,
  adKindsFor, destination, detailReady, examplesFor, goalsFor, normalizeUrl, parseAnswers, startStep,
  PERSONAS, type AdKind, type Answers, type GoalId, type PersonaId,
} from '@/lib/onboarding/model'
import '../qads/qads.css'
import './start.css'

export interface StartStore { id: string; name: string }

interface Props {
  signedIn: boolean
  stores: StartStore[]
  initialPersona: PersonaId | null
  initialGoal: GoalId | null
  /** Opened from a website link with the answers in the URL. */
  fromLink: boolean
  /** Back from sign-up: finish with the answers kept in localStorage. */
  resume: boolean
}

const PERSONA_ICON: Record<PersonaId, typeof Store> = { business: Store, creator: Sparkles, agency: Building2 }
const GOAL_ICON: Record<GoalId, typeof Store> = { ads: Megaphone, scan: ScanLine, new: ShoppingBag, edit: PenLine, review: Bot }
const KIND_ICON: Record<AdKind, typeof Store> = { ad: Clapperboard, character: UserRound, plan: CalendarDays }

const TITLES = ['What describes you best?', 'What do you want to do first?', '']

function detailTitle(a: Answers): string {
  switch (a.goal) {
    case 'ads': return 'What should the ad sell?'
    case 'scan': return 'Where is your store now?'
    case 'new': return 'What will your store sell?'
    case 'edit': return 'Which store do you want to change?'
    case 'review': return 'Which store should Qgent check?'
    default: return ''
  }
}

function ctaLabel(a: Answers): string {
  switch (a.goal) {
    case 'ads': return a.adKind === 'plan' ? 'Open the plan' : a.adKind === 'character' ? 'Open Character' : 'Open Qads'
    case 'scan': return 'Scan my store'
    case 'new': return 'Start building'
    case 'edit': return 'Open the editor'
    case 'review': return 'Open Qgent'
    default: return 'Continue'
  }
}

/** What happens right after the click — said honestly, before anything is spent. */
function nextNote(a: Answers, signedIn: boolean): string {
  const account = signedIn ? '' : `First a free account — you get ${CREDIT_COSTS.welcome_grant} credits after verifying your email. `
  switch (a.goal) {
    case 'ads':
      if (a.adKind === 'plan') return `${account}Qads reads your store’s products and suggests ads and a posting calendar.`
      return `${account}Next you add one product photo and press Generate — the price is shown before anything is spent.`
    case 'scan': return `${account}Scanning is free. You tick that the store is yours and Qscan reads it.`
    case 'new': return `${account}Quante asks one or two questions about your brief, then builds the store.`
    case 'edit': return 'The visual editor runs on a computer. Changes stay a draft until you publish.'
    case 'review': return 'The review runs when you press it there; its price is shown first.'
    default: return account
  }
}

function readPending(): Answers | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { at?: number; answers?: unknown }
    if (typeof p.at !== 'number' || Date.now() - p.at > PENDING_MAX_AGE_MS) {
      localStorage.removeItem(PENDING_KEY)
      return null
    }
    const a = parseAnswers(p.answers)
    return a.persona && a.goal ? a : null
  } catch {
    return null
  }
}

async function save(body: object) {
  try {
    await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {}
}

export function StartClient({ signedIn, stores, initialPersona, initialGoal, fromLink, resume }: Props) {
  const hasStore = stores.length > 0
  const usableGoal = initialGoal && goalsFor(initialPersona, hasStore).some((g) => g.id === initialGoal) ? initialGoal : null
  const [answers, setAnswers] = useState<Answers>(() => ({
    ...EMPTY,
    persona: initialPersona,
    goal: usableGoal,
    projectId: stores.length === 1 ? stores[0].id : null,
  }))
  // A website link with answers jumps ahead; a plain visit (or "Guide me") starts at the top.
  const [step, setStep] = useState(() => (fromLink ? startStep({ persona: initialPersona, goal: usableGoal }) : 0))
  const [going, setGoing] = useState<string | null>(null)
  const [urlTouched, setUrlTouched] = useState(false)
  const headRef = useRef<HTMLHeadingElement | null>(null)

  const set = (patch: Partial<Answers>) => setAnswers((a) => ({ ...a, ...patch }))
  const goals = useMemo(() => goalsFor(answers.persona, hasStore), [answers.persona, hasStore])
  const kinds = useMemo(() => adKindsFor(hasStore), [hasStore])
  const ex = examplesFor(answers.persona)
  const ready = detailReady(answers, hasStore)

  // Each step's heading takes the focus, so a screen reader hears the new question.
  useEffect(() => {
    if (going) return
    headRef.current?.focus({ preventScroll: true })
  }, [step, going])

  async function finish(a: Answers) {
    const dest = destination(a)
    setGoing(dest.module)
    if (!signedIn) {
      try { localStorage.setItem(PENDING_KEY, JSON.stringify({ at: Date.now(), answers: a })) } catch {}
      window.location.assign(`/signup?redirect_url=${encodeURIComponent('/start?resume=1')}`)
      return
    }
    await save({ ...a, skipped: false })
    try {
      for (const d of dest.drafts) sessionStorage.setItem(d.key, d.value)
      localStorage.removeItem(PENDING_KEY)
    } catch {}
    window.location.assign(dest.href)
  }

  // Back from sign-up with answers waiting: save them and go on, no second click.
  useEffect(() => {
    if (!resume || !signedIn) return
    const pending = readPending()
    if (!pending) return
    const t = setTimeout(() => void finish(pending), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function skip() {
    if (!signedIn) {
      window.location.assign(siteHref('/quante'))
      return
    }
    setGoing('Dashboard')
    await save({ persona: answers.persona, goal: null, skipped: true })
    window.location.assign('/dashboard')
  }

  const pickPersona = (persona: PersonaId) => {
    set({ persona })
    // A goal handed over by a website link stays: go straight to its input.
    setStep(answers.goal && fromLink ? 2 : 1)
  }
  const pickGoal = (goal: GoalId) => {
    set({ goal })
    setStep(2)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ready && !going) void finish(answers)
  }

  const urlBad = answers.goal === 'scan' && urlTouched && answers.url.trim() !== '' && !normalizeUrl(answers.url)
  const title = step === 2 ? detailTitle(answers) : TITLES[step]

  return (
    <div className="qnt-public qp-dark qz qo">
      <ParticleMode mode="site" />

      <header className="qo-top">
        <button type="button" className="qo-x" onClick={() => void skip()} aria-label={signedIn ? 'Skip to the dashboard' : 'Close'} disabled={!!going}>
          <X aria-hidden="true" />
        </button>
        <ol className="qo-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <li key={s} data-state={i < step ? 'done' : i === step ? 'now' : 'next'}><span /></li>
          ))}
        </ol>
        <Link href={signedIn ? '/dashboard' : siteHref('/quante')} className="qo-brand" aria-label="Quante">
          <QuanteBrand />
        </Link>
      </header>

      <main className="qo-main">
        {going ? (
          <div className="qo-step qo-going" role="status">
            <Loader2 className="qo-spin" aria-hidden="true" />
            <p>{signedIn ? `Taking you to ${going}…` : 'Creating your account first…'}</p>
          </div>
        ) : (
          <div className="qo-step" key={step}>
            {step > 0 && (
              <button type="button" className="qo-back" onClick={() => setStep(step - 1)}>
                <ArrowLeft aria-hidden="true" />Back
              </button>
            )}
            <h1 className="qo-h1" tabIndex={-1} ref={headRef}>{title}</h1>

            {step === 0 && (
              <div className="qo-cards">
                {PERSONAS.map((p) => {
                  const Icon = PERSONA_ICON[p.id]
                  return (
                    <button key={p.id} type="button" className="qo-card" aria-pressed={answers.persona === p.id} onClick={() => pickPersona(p.id)}>
                      <span className="qo-ic" data-tone={p.id}><Icon aria-hidden="true" /></span>
                      <span className="qo-tx"><b>{p.label}</b><small>{p.text}</small></span>
                      <ArrowRight className="qo-ar" aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
            )}

            {step === 1 && (
              <>
                <div className="qo-cards">
                  {goals.filter((g) => !('needsStore' in g)).map((g) => {
                    const Icon = GOAL_ICON[g.id]
                    return (
                      <button key={g.id} type="button" className="qo-card" aria-pressed={answers.goal === g.id} onClick={() => pickGoal(g.id)}>
                        <span className="qo-ic" data-tone={g.id}><Icon aria-hidden="true" /></span>
                        <span className="qo-tx"><b>{g.label}</b><small>{g.text}</small></span>
                        <span className="qo-mod">{g.module}</span>
                      </button>
                    )
                  })}
                </div>
                {goals.some((g) => 'needsStore' in g) && (
                  <>
                    <p className="qo-sec">For a store you already have here</p>
                    <div className="qo-cards qo-cards-sm">
                      {goals.filter((g) => 'needsStore' in g).map((g) => {
                        const Icon = GOAL_ICON[g.id]
                        return (
                          <button key={g.id} type="button" className="qo-card" aria-pressed={answers.goal === g.id} onClick={() => pickGoal(g.id)}>
                            <span className="qo-ic" data-tone={g.id}><Icon aria-hidden="true" /></span>
                            <span className="qo-tx"><b>{g.label}</b><small>{g.text}</small></span>
                            <span className="qo-mod">{g.module}</span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {step === 2 && (
              <form className="qo-form" onSubmit={submit}>
                {answers.goal === 'ads' && (
                  <>
                    <div className="qo-seg" role="radiogroup" aria-label="Kind of ad">
                      {kinds.map((k) => {
                        const Icon = KIND_ICON[k.id]
                        return (
                          <button key={k.id} type="button" role="radio" aria-checked={answers.adKind === k.id} className="qo-kind" onClick={() => set({ adKind: k.id })}>
                            <Icon aria-hidden="true" />
                            <b>{k.label}</b>
                            <small>{k.text}</small>
                          </button>
                        )
                      })}
                    </div>
                    {answers.adKind === 'plan' ? (
                      <StorePicker stores={stores} value={answers.projectId} onPick={(projectId) => set({ projectId })} label="Plan ads for" />
                    ) : (
                      <div className="qz-box qo-box">
                        <label className="qo-lab" htmlFor="qo-name">Product</label>
                        <input id="qo-name" className="qo-in" value={answers.productName} maxLength={LIMITS.name} placeholder={ex.product}
                          autoComplete="off" onChange={(e) => set({ productName: e.currentTarget.value })} autoFocus />
                        <label className="qo-lab" htmlFor="qo-desc">What makes it good? <i>optional</i></label>
                        <textarea id="qo-desc" className="qo-in qo-ta" rows={3} value={answers.productDescription} maxLength={LIMITS.description}
                          placeholder="Who it is for, what it does, the price…" onChange={(e) => set({ productDescription: e.currentTarget.value })} />
                      </div>
                    )}
                  </>
                )}

                {answers.goal === 'scan' && (
                  <div className="qz-box qo-box">
                    <label className="qo-lab" htmlFor="qo-url">Store address</label>
                    <div className="qo-url">
                      <Globe aria-hidden="true" />
                      <input id="qo-url" className="qo-in" type="text" inputMode="url" autoComplete="url" autoCapitalize="off" spellCheck={false}
                        placeholder="yourstore.com" value={answers.url} maxLength={LIMITS.url} aria-invalid={urlBad || undefined}
                        onChange={(e) => set({ url: e.currentTarget.value })} onBlur={() => setUrlTouched(true)} autoFocus />
                    </div>
                    {urlBad && <p className="qo-err" role="alert">That doesn’t look like a web address — try e.g. yourstore.cz</p>}
                    <p className="qo-hint">Shopify · WooCommerce · Shoptet · any website</p>
                  </div>
                )}

                {answers.goal === 'new' && (
                  <div className="qz-box qo-box">
                    <label className="qo-lab" htmlFor="qo-brief">Describe it in a sentence or two</label>
                    <textarea id="qo-brief" className="qo-in qo-ta" rows={4} value={answers.storeBrief} maxLength={LIMITS.brief}
                      placeholder={ex.brief} onChange={(e) => set({ storeBrief: e.currentTarget.value })} autoFocus />
                    <div className="qo-chips">
                      <button type="button" className="qz-b" onClick={() => set({ storeBrief: ex.brief })}>Use the example</button>
                    </div>
                  </div>
                )}

                {(answers.goal === 'edit' || answers.goal === 'review') && (
                  <StorePicker stores={stores} value={answers.projectId} onPick={(projectId) => set({ projectId })} label="Your stores" />
                )}

                <div className="qo-go">
                  <button type="submit" className="qz-go" disabled={!ready}>
                    {signedIn ? ctaLabel(answers) : 'Create account & continue'}
                    <span className="ar"><ArrowRight aria-hidden="true" /></span>
                  </button>
                  <p className="qo-note">{nextNote(answers, signedIn)}</p>
                </div>
              </form>
            )}

            {step === 0 && !signedIn && (
              <p className="qo-foot">Already have an account? <Link href={`/login?redirect_url=${encodeURIComponent('/start')}`}>Sign in</Link></p>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function StorePicker({ stores, value, onPick, label }: { stores: StartStore[]; value: string | null; onPick: (id: string) => void; label: string }) {
  if (!stores.length) {
    return <p className="qo-note">You don’t have a store here yet — go back and build or import one first.</p>
  }
  return (
    <fieldset className="qo-stores">
      <legend className="qo-lab">{label}</legend>
      {stores.map((s) => (
        <label key={s.id} className="qo-store" data-on={value === s.id || undefined}>
          <input type="radio" name="qo-store" value={s.id} checked={value === s.id} onChange={() => onPick(s.id)} />
          <span className="qo-store-l" aria-hidden="true">{s.name.slice(0, 1).toUpperCase()}</span>
          <span className="qo-store-n">{s.name}</span>
          {value === s.id && <Check className="qo-store-c" aria-hidden="true" />}
        </label>
      ))}
    </fieldset>
  )
}
