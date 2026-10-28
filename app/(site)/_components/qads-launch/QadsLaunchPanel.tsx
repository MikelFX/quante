'use client'

// Launch panel for Qads Tiktoker on the AssetraDigital website (owner, 2026-10-28): shortly after a
// visitor arrives, a glass card glides in from the bottom-left edge (no modal, no backdrop, the page
// stays usable) and lets them put a character together — Kdo / Věk / Styl — with a live preview of
// a 9:16 clip in which that character talks. "Vytvořit postavu" opens /qads in Tiktoker mode with
// the traits picked (lib/qads/tiktoker.ts traitsToParam). Closing folds it into a small "Novinka"
// tab on the edge; once closed it never glides in again on its own (localStorage), the tab stays.
// Shown only during the launch offer (lib/qads/pricing.ts TIKTOKER_LAUNCH); prices come from there.
// Quante product → Quante green (.ad-q), not the website magenta.

import { useEffect, useRef, useState } from 'react'
import { appHref } from '@/lib/domains'
import { CHARACTER_TRAITS, DEFAULT_TRAITS, traitsToParam, type CharacterTraits, type TraitKey } from '@/lib/qads/tiktoker'
import { characterCredits, computeTiktokerCost, isTiktokerLaunch } from '@/lib/qads/pricing'

const SEEN_KEY = 'ad:qads-launch:v1'
const DELAY_MS = 1600
const PANEL_TRAITS: TraitKey[] = ['gender', 'age', 'aesthetic']

// Lines the preview character "says" — rotated, typed out word by word.
const LINES = [
  'Tohle je přesně to, co jsem hledala.',
  'Podívejte se na ten detail zblízka.',
  'Tři věci, proč to nosím každý den.',
]

type State = 'hidden' | 'open' | 'tab'

/** 1 kredit · 2–4 kredity · 5+ kreditů */
function kredity(n: number) {
  return n === 1 ? '1 kredit' : n >= 2 && n <= 4 ? `${n} kredity` : `${n} kreditů`
}

export function QadsLaunchPanel() {
  const [state, setState] = useState<State>('hidden')
  const [live, setLive] = useState(false)
  const [traits, setTraits] = useState<CharacterTraits>(DEFAULT_TRAITS)
  const panelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isTiktokerLaunch()) return
    setLive(true)
    let seen = false
    try { seen = localStorage.getItem(SEEN_KEY) === 'closed' } catch {}
    if (seen) { setState('tab'); return }
    // Let the page settle first (LCP, hero animation), then glide in.
    const t = window.setTimeout(() => setState('open'), DELAY_MS)
    return () => window.clearTimeout(t)
  }, [])

  const close = () => {
    setState('tab')
    try { localStorage.setItem(SEEN_KEY, 'closed') } catch {}
  }

  useEffect(() => {
    if (state !== 'open') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setState('tab')
      try { localStorage.setItem(SEEN_KEY, 'closed') } catch {}
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state])
  const reopen = () => {
    setState('open')
    requestAnimationFrame(() => panelRef.current?.focus())
  }

  if (!live) return null

  const female = traits.gender !== 'male'
  const charCr = characterCredits()
  const video15 = computeTiktokerCost(1, 15).totalCredits
  const href = appHref(`/qads?mode=tiktoker&c=${traitsToParam(traits)}`)

  return (
    <div className="ad-q ql-root">
      <button
        type="button"
        className="ql-tab"
        data-show={state === 'tab' ? 'true' : 'false'}
        onClick={reopen}
        tabIndex={state === 'tab' ? 0 : -1}
        aria-hidden={state !== 'tab'}
      >
        <span className="ql-dot" aria-hidden="true" />
        Novinka <b>Qads</b>
      </button>

      <aside
        ref={panelRef}
        className="ql-panel"
        data-state={state}
        aria-label="Novinka v Qads: AI postava pro produktová videa"
        aria-hidden={state !== 'open'}
        inert={state !== 'open'}
        tabIndex={-1}
      >
        <div className="ql-glow" aria-hidden="true" />
        <header className="ql-head">
          <span className="ql-collab">
            <b>Qads</b><i aria-hidden="true">×</i><span>Higgsfield</span>
          </span>
          <button type="button" className="ql-x" onClick={close} aria-label="Zavřít">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className="ql-body">
          <div className="ql-copy">
            <p className="ql-kicker"><span>Novinka</span> 30 dní za naši cenu</p>
            <h2 className="ql-h">Postava, která váš produkt <em>představí.</em></h2>
            <p className="ql-p">Vytvořte si AI postavu a nechte ji o produktu mluvit jako tiktoker: svisle, s hlasem a pohybem rtů.</p>
          </div>

          <Preview female={female} traits={traits} />

          <div className="ql-pick">
            {CHARACTER_TRAITS.filter(g => PANEL_TRAITS.includes(g.key)).map(g => (
              <div key={g.key} className="ql-row" role="group" aria-label={g.cs}>
                <span className="ql-row-l" aria-hidden="true">{g.cs}</span>
                <div className="ql-row-c">
                  {g.options.map(o => (
                    <button
                      key={o.id}
                      type="button"
                      className="ql-chip"
                      aria-pressed={traits[g.key] === o.id}
                      onClick={() => setTraits(t => ({ ...t, [g.key]: o.id }))}
                    >
                      {o.cs}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <a className="ql-go" href={href}>
            <span>Vytvořit postavu</span>
            <i aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </i>
          </a>
          <p className="ql-fine">
            Po dobu novinky bez marže, jen za náklady na výpočet: postava {kredity(charCr)}, 15s video {kredity(video15)}.
          </p>
        </div>
      </aside>
    </div>
  )
}

/** A 9:16 "phone" with the character talking: line typed out, mouth and sound bars in time. */
function Preview({ female, traits }: { female: boolean; traits: CharacterTraits }) {
  const [line, setLine] = useState(0)
  const [words, setWords] = useState(0)
  const text = female ? LINES[line] : LINES[line].replace('hledala', 'hledal')
  const all = text.split(' ')

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off') {
      setWords(all.length)
      return
    }
    let w = 0
    setWords(0)
    const id = window.setInterval(() => {
      w++
      if (w <= all.length) setWords(w)
      else if (w > all.length + 6) { window.clearInterval(id); setLine(l => (l + 1) % LINES.length) }
    }, 260)
    return () => window.clearInterval(id)
  }, [line, all.length])

  const talking = words > 0 && words < all.length
  const age = traits.age ?? 'adult'
  const style = traits.aesthetic ?? 'casual'
  const hair = age === 'senior' ? '#c9c4bb' : female ? '#6b3f2a' : '#2b211c'

  return (
    <div className="ql-phone" data-style={style} data-talking={talking ? 'true' : 'false'} aria-hidden="true">
      <div className="ql-scene" />
      <svg className="ql-person" viewBox="0 0 120 160">
        {/* hair behind */}
        {female && <path className="ql-hair" d="M30 62 C26 30 46 16 60 16 C76 16 94 28 90 62 L94 104 C80 110 40 110 26 104 Z" fill={hair} />}
        {/* body */}
        <path className="ql-body-shape" d="M22 160 C24 128 40 114 60 114 C80 114 96 128 98 160 Z" />
        <rect x="52" y="96" width="16" height="22" rx="7" fill="#d9a988" />
        {/* head */}
        <ellipse cx="60" cy="66" rx="25" ry="30" fill="#e7b896" />
        {/* hair front */}
        {female
          ? <path d="M35 60 C36 38 50 30 62 31 C74 32 84 40 85 58 C76 50 66 44 52 46 C44 48 39 54 35 60 Z" fill={hair} />
          : <path d="M35 58 C34 38 48 32 60 32 C74 32 86 38 85 58 C80 48 70 44 60 45 C50 44 40 48 35 58 Z" fill={hair} />}
        {age !== 'adult' && <path d="M47 82 Q60 86 73 82" stroke="#c48f70" strokeWidth="1.2" fill="none" opacity=".6" />}
        {/* eyes */}
        <g className="ql-eyes">
          <ellipse cx="50" cy="66" rx="2.6" ry="3.2" fill="#2a1d17" />
          <ellipse cx="70" cy="66" rx="2.6" ry="3.2" fill="#2a1d17" />
        </g>
        {/* mouth: opens with the words */}
        <ellipse className="ql-mouth" cx="60" cy="81" rx="6" ry="2.2" fill="#8c3b36" />
        {/* the product in hand */}
        <g className="ql-prod">
          <rect x="78" y="112" width="22" height="34" rx="5" />
          <rect x="82" y="120" width="14" height="5" rx="2" className="ql-prod-l" />
        </g>
      </svg>
      <div className="ql-bars"><i /><i /><i /><i /><i /></div>
      <p className="ql-say">
        {all.map((w, i) => <span key={`${line}-${i}`} data-on={i < words ? 'true' : 'false'}>{w}</span>).flatMap((el, i) => (i ? [' ', el] : [el]))}
      </p>
      <span className="ql-rec">9:16 · 15 s</span>
    </div>
  )
}
