'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { AdMark, ParticleZone, useMotionAllowed } from '@ad/ui'
import { QGENT_QUICK_PROMPTS } from '@/content/assetra/qgent'
import type { QgentAction } from '@ad/qgent/public'
import { offerPrefill } from './prefill'

// Qgent on the AssetraDigital website: floating button bottom-right, glass panel with the
// particle swarm in its header (AD logo while idle, AGENT while answering). Answers stream from
// POST /api/qgent/public. The model can only scroll, open a page, or OFFER a lead-form prefill
// that happens after the visitor confirms it here. The chat lives in sessionStorage only.

type Offer = 'offered' | 'filled' | 'declined'
type Item =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; text: string; actions: QgentAction[]; offer?: Offer; error?: boolean }

const STORE = 'qgent-chat'
const MAX_INPUT = 1000
const FALLBACK = 'Odpověď se nepodařila. Zkuste to prosím znovu, nebo nám napište přes formulář poptávky.'

function newSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const narrow = () => window.matchMedia('(max-width: 640px)').matches

/** The model is told to write plain text; stray markdown emphasis is dropped, never rendered. */
const plain = (t: string) => t.split('**').join('').split('__').join('')

export function QgentWidget() {
  const router = useRouter()
  const pathname = usePathname()
  const motion = useMotionAllowed()

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [announce, setAnnounce] = useState('')

  const session = useRef('')
  const seq = useRef(0)
  const restored = useRef(false)
  const returnFocus = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const path = useRef(pathname)
  const fab = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    path.current = pathname
  }, [pathname])

  // Focus moves into the panel on open and back to the button on close.
  useEffect(() => {
    if (open) field.current?.focus()
    else if (returnFocus.current) {
      returnFocus.current = false
      fab.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [items, open])

  useEffect(() => () => abort.current?.abort(), [])

  // Saved between answers (not on every streamed token) so a reload keeps the conversation.
  useEffect(() => {
    if (busy || !session.current) return
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ sessionId: session.current, items: items.slice(-40) }))
    } catch {}
  }, [items, busy])

  const openPanel = () => {
    if (!restored.current) {
      restored.current = true
      try {
        const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null') as { sessionId?: string; items?: Item[] } | null
        if (saved?.sessionId && Array.isArray(saved.items)) {
          session.current = saved.sessionId
          const list = saved.items.filter((i) => i && (i.role === 'user' || i.role === 'assistant') && typeof i.text === 'string')
          seq.current = list.reduce((m, i) => Math.max(m, i.id || 0), 0)
          setItems(list)
        }
      } catch {}
    }
    setOpen(true)
  }

  const close = () => {
    returnFocus.current = true
    setOpen(false)
  }

  const restart = () => {
    abort.current?.abort()
    session.current = newSessionId()
    setItems([])
    setAnnounce('')
    field.current?.focus()
  }

  const goTo = (page: string, anchor?: string) => {
    if (path.current === page) {
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: motion ? 'smooth' : 'auto', block: 'start' })
      else window.scrollTo({ top: 0, behavior: motion ? 'smooth' : 'auto' })
    } else {
      router.push(anchor ? `${page}#${anchor}` : page)
    }
  }

  // The visitor tapped an action chip: do it again and, on a phone, get the panel out of the way.
  const replay = (a: QgentAction) => {
    if (a.type === 'navigate') goTo(a.page, a.anchor)
    else if (a.type === 'openPage') goTo(a.path)
    if (narrow()) close()
  }

  const update = (id: number, fn: (it: Extract<Item, { role: 'assistant' }>) => Partial<Extract<Item, { role: 'assistant' }>>) =>
    setItems((list) => list.map((it) => (it.id === id && it.role === 'assistant' ? { ...it, ...fn(it) } : it)))

  const resolveOffer = (id: number, a: Extract<QgentAction, { type: 'prefillLead' }>, accept: boolean) => {
    update(id, () => ({ offer: accept ? 'filled' : 'declined' }))
    if (!accept) return
    offerPrefill({ jmeno: a.jmeno, kontakt: a.kontakt, potreba: a.potreba })
    goTo('/', 'kontakt')
    // Out of the way so the filled form is visible; the form takes the focus.
    setOpen(false)
  }

  const send = async (raw: string) => {
    const text = raw.trim().slice(0, MAX_INPUT)
    if (!text || busy) return
    if (!session.current) session.current = newSessionId()
    const user: Item = { id: ++seq.current, role: 'user', text }
    const replyId = ++seq.current
    const history = [...items, user]
      .filter((i) => !(i.role === 'assistant' && (i.error || !i.text.trim())))
      .map((i) => ({ role: i.role, text: i.text }))
    setItems((list) => [...list, user, { id: replyId, role: 'assistant', text: '', actions: [] }])
    setInput('')
    setBusy(true)
    setAnnounce('')

    const ctrl = new AbortController()
    abort.current = ctrl
    let answer = ''
    let failed = ''
    try {
      const res = await fetch('/api/qgent/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.current, page: path.current, messages: history }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || FALLBACK)
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          let ev: { type?: string; delta?: string; action?: QgentAction; message?: string }
          try {
            ev = JSON.parse(line)
          } catch {
            continue
          }
          if (ev.type === 'text' && typeof ev.delta === 'string') {
            answer += ev.delta
            const now = answer
            update(replyId, () => ({ text: now }))
          } else if (ev.type === 'action' && ev.action) {
            const a = ev.action
            update(replyId, (it) => ({ actions: [...it.actions, a], ...(a.type === 'prefillLead' ? { offer: 'offered' as const } : {}) }))
            if (a.type === 'navigate') goTo(a.page, a.anchor)
            else if (a.type === 'openPage') goTo(a.path)
          } else if (ev.type === 'error') {
            failed = ev.message || FALLBACK
          }
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) return
      failed = err instanceof Error && err.message ? err.message : FALLBACK
    } finally {
      if (abort.current === ctrl) abort.current = null
      setBusy(false)
    }

    if (failed) {
      update(replyId, (it) => ({ text: it.text ? it.text.trimEnd() + '\n\n' + failed : failed, error: !it.text }))
      setAnnounce(failed)
    } else {
      setAnnounce(answer.trim())
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  const onFieldKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(input)
    }
  }

  // Escape closes; Tab cycles inside the panel.
  const onPanelKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const els = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled])'))
      .filter((el) => el.offsetParent !== null)
    if (!els.length) return
    const first = els[0]
    const last = els[els.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="qg">
      <button ref={fab} type="button" className="qg-fab glass" aria-expanded={open} aria-controls="qg-panel" hidden={open} onClick={openPanel}>
        <AdMark className="mark qg-mark" />
        <span>Zeptat se</span>
      </button>

      {open && (
        <section ref={panel} id="qg-panel" className="qg-panel glass" role="dialog" aria-modal="true" aria-labelledby="qg-title" onKeyDown={onPanelKey}>
          <header className="qg-head">
            <div className="qg-top">
              <ParticleZone className="qg-pz" priority shapes={busy ? ['AGENT'] : ['@logo']} />
              <button type="button" className="ib qg-x" aria-label="Zavřít asistenta" onClick={close}>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="qg-ttl">
              <h2 id="qg-title">Qgent</h2>
              <p>Asistent AssetraDigital. Odpovídá z obsahu webu.</p>
            </div>
          </header>

          <div ref={log} className="qg-log">
            {!items.length && (
              <div className="qg-b a">
                <small>Qgent</small>
                Dobrý den. Poradím s weby a e-shopy od AssetraDigital i s Quante. Na co se chcete zeptat?
              </div>
            )}
            {items.map((it) =>
              it.role === 'user' ? (
                <div key={it.id} className="qg-b u">
                  <span className="vh">Vy: </span>
                  {it.text}
                </div>
              ) : (
                <div key={it.id} className={it.error ? 'qg-b a err' : 'qg-b a'}>
                  <small>Qgent</small>
                  {it.text ? plain(it.text) : busy ? (
                    <span className="qg-dots" aria-hidden="true"><i /><i /><i /></span>
                  ) : null}
                  {it.error && (
                    <Link className="qg-link" href="/#kontakt" onClick={() => narrow() && close()}>Formulář poptávky</Link>
                  )}
                  {it.actions.map((a, i) =>
                    a.type === 'prefillLead' ? (
                      <PrefillOffer key={i} action={a} state={it.offer ?? 'offered'} onAnswer={(ok) => resolveOffer(it.id, a, ok)} />
                    ) : (
                      <button key={i} type="button" className="qg-go" onClick={() => replay(a)}>
                        <span aria-hidden="true">↳ </span>
                        {a.title}
                      </button>
                    ),
                  )}
                </div>
              ),
            )}
          </div>
          <p className="vh" aria-live="polite">{announce}</p>
          {busy && <p className="vh" role="status">Qgent píše odpověď</p>}

          {!items.length && (
            <div className="qg-chips" role="group" aria-label="Časté otázky">
              {QGENT_QUICK_PROMPTS.map((q) => (
                <button key={q} type="button" onClick={() => void send(q)} disabled={busy}>{q}</button>
              ))}
            </div>
          )}

          <form className="qg-in" onSubmit={submit}>
            <label className="vh" htmlFor="qg-field">Zpráva pro asistenta Qgent</label>
            <textarea
              ref={field}
              id="qg-field"
              rows={Math.min(4, Math.max(1, input.split('\n').length))}
              maxLength={MAX_INPUT}
              placeholder="Napište dotaz…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onFieldKey}
            />
            <button type="submit" className="qg-send" disabled={busy || !input.trim()} aria-label="Odeslat zprávu">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </form>
          <p className="qg-fine">
            Odpovídá AI, může se splést. Konverzaci uchováme 30 dní bez e-mailů a telefonů.{' '}
            <Link href="/ochrana-osobnich-udaju">Ochrana osobních údajů</Link>
            {items.length > 0 && (
              <>
                {' · '}
                <button type="button" className="qg-reset" onClick={restart}>Začít znovu</button>
              </>
            )}
          </p>
        </section>
      )}
    </div>
  )
}

function PrefillOffer({ action, state, onAnswer }: { action: Extract<QgentAction, { type: 'prefillLead' }>; state: Offer; onAnswer: (ok: boolean) => void }) {
  const rows = [
    ['Jméno', action.jmeno],
    ['Kontakt', action.kontakt],
    ['Potřebujete', action.potreba],
  ].filter(([, v]) => v)
  return (
    <div className="qg-offer">
      <p className="qg-offer-q">Předvyplnit formulář poptávky?</p>
      {rows.length > 0 && (
        <dl>
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      )}
      {state === 'offered' ? (
        <>
          <div className="qg-acts">
            <button type="button" className="ok" onClick={() => onAnswer(true)}>Vyplnit formulář</button>
            <button type="button" onClick={() => onAnswer(false)}>Ne, díky</button>
          </div>
          <p className="qg-offer-n">
            Formulář jen vyplníme, odešlete ho sami. Údaje použijeme jen k odpovědi na poptávku.{' '}
            <Link href="/ochrana-osobnich-udaju">Ochrana osobních údajů</Link>
          </p>
        </>
      ) : (
        <p className="qg-offer-n">{state === 'filled' ? 'Formulář je vyplněný. Zkontrolujte ho a odešlete.' : 'Dobře, nic nevyplňuji.'}</p>
      )}
    </div>
  )
}
