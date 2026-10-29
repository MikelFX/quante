'use client'

// /qads → Plan (lib/qads/plan): Qads reads one of your stores (brand kit + products) and what your
// competitors are running (Meta Ad Library), then writes who to target, what works for the
// competitors, a set of ad concepts and a posting calendar. Every ad concept is one click into the
// normal Ad or Character composer (prefilled, with the store's own product photo when it has one);
// nothing renders or spends until the owner presses Generate there. The calendar downloads as
// CSV or .ics.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays, Download, ExternalLink, Sparkles, UserRound } from 'lucide-react'
import { CREDIT_COSTS } from '@/lib/config'
import {
  MAX_COMPETITORS,
  PLAN_AD_COUNTS,
  PLAN_CHANNELS,
  PLAN_COUNTRIES,
  PLAN_DAYS,
  PLAN_LANGUAGES,
  type Persona,
  type Plan,
  type PlanAd,
  type PlanChannel,
  type PlanInput,
} from '@/lib/qads/plan/model'
import type { CompetitorAd, ResearchResult } from '@/lib/qads/plan/ad-library'
import { calendarCsv, calendarIcs, postDate } from '@/lib/qads/plan/calendar'
import { describeTraits, type CharacterTraits } from '@/lib/qads/tiktoker'

export interface PlanStore { projectId: string; projectName: string }

export interface PlanRecord {
  id: string
  projectId: string
  status: 'running' | 'done' | 'failed'
  input: PlanInput
  research: ResearchResult | Record<string, never>
  plan: Plan | null
  error: string | null
  creditsCharged: number
  createdAt: string
}

const COST = CREDIT_COSTS.qads_plan
const KIND_LABEL: Record<PlanAd['kind'], string> = { video: 'Video', image: 'Photo', character: 'Creator' }
const CHANNEL_LABEL = Object.fromEntries(PLAN_CHANNELS.map((c) => [c.id, c.label])) as Record<PlanChannel, string>
const RESEARCH_TEXT: Record<ResearchResult['status'], string> = {
  ok: '',
  no_terms: 'No competitors were named, so the plan is built from your store alone.',
  not_configured: 'Competitor research isn’t connected yet, so the plan is built from your store alone.',
  nothing_found: 'No active ads were found for those competitors in this market.',
  error: 'Meta’s Ad Library couldn’t be reached, so the plan is built from your store alone.',
}
const WORKING = ['Reading your brand and products…', 'Looking at what competitors run…', 'Finding your key customers…', 'Writing the ads and the calendar…']

function tomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
}

function save(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'store'
}

export function QadsPlan({
  signedIn,
  agency,
  stores,
  initialProjectId,
  onSignIn,
  onMakeAd,
  onMakeCharacter,
  onCharged,
}: {
  signedIn: boolean
  agency: boolean
  stores: PlanStore[]
  initialProjectId: string | null
  onSignIn: (returnTo: string) => void
  onMakeAd: (ad: PlanAd, projectId: string, language: PlanInput['language']) => void
  onMakeCharacter: (traits: CharacterTraits, ad: PlanAd | null, projectId: string) => void
  onCharged: (credits: number) => void
}) {
  const [picked, setProjectId] = useState<string | null>(initialProjectId)
  // A store from the link (?project=) or the one picked; with a single store, that one.
  const projectId = picked ?? (stores.length === 1 ? stores[0].projectId : null)
  const [competitors, setCompetitors] = useState('')
  const [country, setCountry] = useState<PlanInput['country']>('CZ')
  const [adCount, setAdCount] = useState<PlanInput['adCount']>(9)
  const [days, setDays] = useState<PlanInput['days']>(14)
  const [channels, setChannels] = useState<PlanChannel[]>(['tiktok', 'instagram'])
  const [language, setLanguage] = useState<PlanInput['language']>('cs')
  const [goal, setGoal] = useState('')
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [ready, setReady] = useState(true)
  const [researchReady, setResearchReady] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [phase, setPhase] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [start, setStart] = useState(tomorrow)

  const store = stores.find((s) => s.projectId === projectId) ?? null

  // The selected store's earlier plans; the newest finished one opens.
  useEffect(() => {
    if (!signedIn || !projectId) return
    let stop = false
    void fetch(`/api/qads/plan?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { plans?: PlanRecord[]; ready?: boolean; researchReady?: boolean } | null) => {
        if (stop || !d) return
        setPlans(d.plans ?? [])
        setReady(d.ready !== false)
        setResearchReady(d.researchReady !== false)
        setActiveId((d.plans ?? []).find((p) => p.status === 'done' && p.plan)?.id ?? null)
      })
      .catch(() => {})
    return () => { stop = true }
  }, [signedIn, projectId])

  useEffect(() => {
    if (!submitting) return
    const t = setInterval(() => setPhase((p) => Math.min(p + 1, WORKING.length - 1)), 7000)
    return () => clearInterval(t)
  }, [submitting])

  const active = plans.find((p) => p.id === activeId && p.plan) ?? null
  const terms = useMemo(
    () => [...new Set(competitors.split(/[,\n]/).map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, MAX_COMPETITORS),
    [competitors],
  )

  const toggleChannel = (c: PlanChannel) =>
    setChannels((prev) => (prev.includes(c) ? (prev.length > 1 ? prev.filter((x) => x !== c) : prev) : [...prev, c]))

  const write = async () => {
    if (!signedIn) return onSignIn('/qads?mode=plan')
    if (!projectId) return setError('Pick a store first.')
    setError(null)
    setPhase(0)
    setSubmitting(true)
    try {
      const res = await fetch('/api/qads/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, competitors: terms, country, adCount, days, channels, language, goal: goal.trim() }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (d.setup) setReady(false)
        setError(String(d.error ?? 'Writing the plan failed. Try again.'))
        return
      }
      const rec = d.plan as PlanRecord
      setPlans((prev) => [rec, ...prev.filter((p) => p.id !== rec.id)])
      setActiveId(rec.id)
      if (d.charged) onCharged(Number(d.charged))
      requestAnimationFrame(() => document.getElementById('qp-out')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (signedIn && stores.length === 0) {
    return (
      <section className="qz-box qt qp" aria-label="Growth plan">
        <div className="qp-empty">
          <p className="qp-empty-h">A plan starts from a store.</p>
          <p>Qads reads your products and brand to plan the ads. Build a store first, or bring your current one over with Qscan.</p>
          <div className="qp-empty-a">
            <Link className="qz-go" href="/new">Build a store <span className="ar" aria-hidden="true"><ArrowRight /></span></Link>
            <Link className="qz-b" href="/qscan">Import with Qscan</Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="qz-box qt qp" aria-label="Growth plan">
        <p className="qt-launch">
          <Sparkles aria-hidden="true" />
          Who to target, what works for your competitors, the ads to make and when to post them.
        </p>

        <div className="qt-step">
          <p className="qt-step-h"><span>1</span>Your store</p>
          {signedIn ? (
            <div className="qp-chips" role="group" aria-label="Store">
              {stores.map((s) => (
                <button key={s.projectId} type="button" className="qz-b" aria-pressed={projectId === s.projectId} onClick={() => setProjectId(s.projectId)}>
                  {s.projectName}
                </button>
              ))}
            </div>
          ) : (
            <p className="qp-note">Sign in and pick one of your Quante stores — Qads reads its products and brand kit.</p>
          )}
        </div>

        <div className="qt-step">
          <p className="qt-step-h"><span>2</span>Competitors <small>optional</small></p>
          <label className="vh" htmlFor="qp-comp">Competitor brands or keywords, separated by commas</label>
          <input id="qp-comp" className="qt-input" maxLength={320} value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="Brands or keywords, e.g. Huel, greens powder" />
          <div className="qp-row">
            <div className="qt-seg" role="group" aria-label="Market">
              {PLAN_COUNTRIES.map((c) => (
                <button key={c} type="button" className="qz-b sm" aria-pressed={country === c} onClick={() => setCountry(c)}>{c}</button>
              ))}
            </div>
          </div>
          <p className="qp-note">
            {researchReady
              ? 'Qads reads their active ads in Meta’s public Ad Library and learns the hooks and formats that keep running. It adapts ideas — it never copies their ads.'
              : 'Competitor research isn’t connected yet — the plan is built from your store alone.'}
          </p>
        </div>

        <div className="qt-step">
          <p className="qt-step-h"><span>3</span>The plan</p>
          <div className="qp-grid">
            <div className="qz-row" role="group" aria-label="Ads">
              <span className="qz-row-l" aria-hidden="true">Ads</span>
              <div className="qz-row-c">
                {PLAN_AD_COUNTS.map((n) => <button key={n} type="button" className="qz-b sm" aria-pressed={adCount === n} onClick={() => setAdCount(n)}>{n}</button>)}
              </div>
            </div>
            <div className="qz-row" role="group" aria-label="Calendar length">
              <span className="qz-row-l" aria-hidden="true">Days</span>
              <div className="qz-row-c">
                {PLAN_DAYS.map((n) => <button key={n} type="button" className="qz-b sm" aria-pressed={days === n} onClick={() => setDays(n)}>{n}</button>)}
              </div>
            </div>
            <div className="qz-row" role="group" aria-label="Channels">
              <span className="qz-row-l" aria-hidden="true">Post on</span>
              <div className="qz-row-c">
                {PLAN_CHANNELS.map((c) => <button key={c.id} type="button" className="qz-b sm" aria-pressed={channels.includes(c.id)} onClick={() => toggleChannel(c.id)}>{c.label}</button>)}
              </div>
            </div>
            <div className="qz-row" role="group" aria-label="Language">
              <span className="qz-row-l" aria-hidden="true">Language</span>
              <div className="qz-row-c">
                {PLAN_LANGUAGES.map((l) => <button key={l} type="button" className="qz-b sm" aria-pressed={language === l} onClick={() => setLanguage(l)}>{l.toUpperCase()}</button>)}
              </div>
            </div>
          </div>
          <label className="vh" htmlFor="qp-goal">Anything to focus on (optional)</label>
          <input id="qp-goal" className="qt-input" maxLength={300} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Anything to focus on? e.g. launch of the new flavour, Christmas (optional)" />
        </div>

        <div className="qz-bar qt-bar">
          <span className="qt-sum" aria-live="polite">{submitting ? WORKING[phase] : store ? `${store.projectName} · ${adCount} ads · ${days} days` : 'Pick a store'}</span>
          <button type="button" className="qz-go" disabled={submitting || !ready || (signedIn && !projectId)} onClick={() => void write()}>
            {submitting ? 'Writing…' : 'Write the plan'}
            <span className="cr">{agency ? 'Included' : `${COST} cr`}</span>
            <span className="ar" aria-hidden="true"><ArrowRight /></span>
          </button>
        </div>
        {!ready && <p className="qz-err" role="alert">Qads Plan isn’t set up yet on this server.</p>}
        {error && <p className="qz-err" role="alert">{error}</p>}
        <p className="qt-fine">The plan only suggests. Each ad opens in the Ad or Character composer, where you see the price before anything is made.</p>
      </section>

      {plans.filter((p) => p.status === 'done' && p.plan).length > 1 && (
        <div className="qp-history" role="group" aria-label="Earlier plans">
          {plans.filter((p) => p.status === 'done' && p.plan).map((p) => (
            <button key={p.id} type="button" className="qz-b sm" aria-pressed={p.id === activeId} onClick={() => setActiveId(p.id)}>
              {new Date(p.createdAt).toLocaleDateString()} · {p.plan!.ads.length} ads
            </button>
          ))}
        </div>
      )}

      {active && active.plan && (
        <PlanView
          rec={active}
          plan={active.plan}
          storeName={store?.projectName ?? ''}
          start={start}
          setStart={setStart}
          onMakeAd={(ad) => onMakeAd(ad, active.projectId, active.input.language)}
          onMakeCharacter={(traits, ad) => onMakeCharacter(traits, ad, active.projectId)}
        />
      )}
    </>
  )
}

function PlanView({
  rec,
  plan,
  storeName,
  start,
  setStart,
  onMakeAd,
  onMakeCharacter,
}: {
  rec: PlanRecord
  plan: Plan
  storeName: string
  start: string
  setStart: (s: string) => void
  onMakeAd: (ad: PlanAd) => void
  onMakeCharacter: (traits: CharacterTraits, ad: PlanAd | null) => void
}) {
  const research = ('status' in rec.research ? rec.research : { status: 'no_terms', ads: [] }) as ResearchResult
  const adById = new Map<string, CompetitorAd>(research.ads.map((a) => [a.id, a]))
  const personaById = new Map<string, Persona>(plan.personas.map((p) => [p.id, p]))
  const byDay = new Map<number, typeof plan.calendar>()
  for (const p of plan.calendar) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p])
  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(start) && Number.isFinite(Date.parse(start))
  const file = `qads-plan-${slug(storeName)}`

  return (
    <section id="qp-out" className="qp-out" aria-label="Your plan">
      <header className="qp-head">
        <p className="qp-kicker">Plan · {storeName || 'your store'} · {new Date(rec.createdAt).toLocaleDateString()}</p>
        <p className="qp-summary">{plan.summary}</p>
        {plan.voice.length > 0 && (
          <ul className="qp-tags" aria-label="Tone of voice">
            {plan.voice.map((v) => <li key={v}>{v}</li>)}
          </ul>
        )}
      </header>

      <div className="qp-sec">
        <h2 className="qp-h">Your key customers</h2>
        <div className="qp-personas">
          {plan.personas.map((p) => (
            <article key={p.id} className="qp-card qp-persona">
              <p className="qp-persona-n">{p.name}{p.age && <span> · {p.age}</span>}</p>
              <p className="qp-persona-s">{p.summary}</p>
              {p.pains.length > 0 && <><p className="qp-l">Pains</p><ul>{p.pains.map((x) => <li key={x}>{x}</li>)}</ul></>}
              {p.desires.length > 0 && <><p className="qp-l">Wants</p><ul>{p.desires.map((x) => <li key={x}>{x}</li>)}</ul></>}
              {p.hooks.length > 0 && <><p className="qp-l">Hooks</p><ul className="qp-hooks">{p.hooks.map((x) => <li key={x}>“{x}”</li>)}</ul></>}
              <button type="button" className="qz-b sm qp-creator" onClick={() => onMakeCharacter(p.traits, null)} title={describeTraits(p.traits)}>
                <UserRound aria-hidden="true" /> Create a creator for them
              </button>
            </article>
          ))}
        </div>
      </div>

      <div className="qp-sec">
        <h2 className="qp-h">What works for your competitors</h2>
        {plan.insights.length > 0 ? (
          <ol className="qp-insights">
            {plan.insights.map((i) => (
              <li key={i.title} className="qp-card">
                <p className="qp-insight-t">{i.title}</p>
                <p>{i.detail}</p>
                {i.adIds.length > 0 && (
                  <p className="qp-src">
                    {i.adIds.map((id) => adById.get(id)).filter(Boolean).map((a) => (
                      <a key={a!.id} href={a!.libraryUrl} target="_blank" rel="noopener noreferrer">
                        {a!.pageName} · {a!.daysRunning} days <ExternalLink aria-hidden="true" />
                      </a>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="qp-note">{RESEARCH_TEXT[research.status] || 'Nothing stood out in the competitors’ ads.'}</p>
        )}
      </div>

      <div className="qp-sec">
        <h2 className="qp-h">Ads to make <span>{plan.ads.length}</span></h2>
        <div className="qp-ads">
          {plan.ads.map((ad, i) => {
            const persona = personaById.get(ad.personaId)
            const src = ad.inspiredBy ? adById.get(ad.inspiredBy) : null
            return (
              <article key={i} className="qp-card qp-ad">
                <p className="qp-ad-meta">
                  <b>{i + 1}</b>
                  <span className="qp-kind" data-kind={ad.kind}>{KIND_LABEL[ad.kind]}</span>
                  <span>{ad.format}</span>
                  {persona && <span>{persona.name}</span>}
                </p>
                <p className="qp-ad-hook">{ad.hook}</p>
                {ad.angle && <p className="qp-ad-angle">{ad.angle}</p>}
                {ad.kind === 'character' && ad.script
                  ? <p className="qp-ad-copy">“{ad.script}”</p>
                  : ad.primaryText && <p className="qp-ad-copy">{ad.primaryText}</p>}
                <p className="qp-ad-foot">
                  <span>{ad.product}</span>
                  {src && <a href={src.libraryUrl} target="_blank" rel="noopener noreferrer">Adapted from {src.pageName} <ExternalLink aria-hidden="true" /></a>}
                </p>
                <button
                  type="button"
                  className="qz-go qp-make"
                  onClick={() => (ad.kind === 'character' ? onMakeCharacter(persona?.traits ?? {}, ad) : onMakeAd(ad))}
                >
                  {ad.kind === 'character' ? 'Make with a creator' : 'Make this ad'}
                  <span className="ar" aria-hidden="true"><ArrowRight /></span>
                </button>
              </article>
            )
          })}
        </div>
      </div>

      {plan.calendar.length > 0 && (
        <div className="qp-sec">
          <h2 className="qp-h">When to post</h2>
          <div className="qp-cal-bar">
            <label htmlFor="qp-start"><CalendarDays aria-hidden="true" /> Day 1 is</label>
            <input id="qp-start" type="date" className="qt-input qp-date" value={start} onChange={(e) => setStart(e.target.value)} />
            <button type="button" className="qz-b sm" disabled={!validStart} onClick={() => save(`${file}.csv`, 'text/csv;charset=utf-8', calendarCsv(plan, start))}>
              <Download aria-hidden="true" /> CSV
            </button>
            <button type="button" className="qz-b sm" disabled={!validStart} onClick={() => save(`${file}.ics`, 'text/calendar;charset=utf-8', calendarIcs(plan, start, { planId: rec.id, storeName }))}>
              <Download aria-hidden="true" /> Calendar (.ics)
            </button>
          </div>
          <ol className="qp-cal">
            {[...byDay.entries()].map(([day, posts]) => (
              <li key={day}>
                <p className="qp-day">Day {day}{validStart && <span> · {new Date(`${postDate(start, day)}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>}</p>
                <ul>
                  {posts.map((p, k) => (
                    <li key={k} className="qp-post">
                      <span className="qp-ch">{CHANNEL_LABEL[p.channel]}</span>
                      <span className="qp-post-t">
                        {p.adIndex !== null ? <b>Ad {p.adIndex + 1} · </b> : null}{p.idea}
                        {p.caption && <small>{p.caption}{p.hashtags.length ? ` ${p.hashtags.map((h) => `#${h}`).join(' ')}` : ''}</small>}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="qp-note">Post from your own accounts. AI creators are AI — label those videos as AI-generated content (TikTok and Meta require it).</p>
        </div>
      )}
    </section>
  )
}
