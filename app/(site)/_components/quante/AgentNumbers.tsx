'use client'
import { useEffect, useState } from 'react'
import { APP_ORIGIN } from '@/lib/domains'

const STATS_URL = `${APP_ORIGIN}/api/agent/v1/stats`

// quantecode.com: "Agenti u nás" — the public counters from GET /api/agent/v1/stats (owner
// 2026-11-06: show how many agents we welcomed, how many bought, later how many sold). Every number
// is read live from the API; nothing is typed here. A figure the API does not have yet shows "—",
// and "prodali" says it is coming until the Qbox services marketplace is live. Renders nothing
// surprising without JS: the strip is there with dashes.
interface Stats {
  agentsWelcomed: number | null
  agentsToday: number | null
  agentsPaid: number | null
  paidCalls: number | null
  sellers: number | null
  marketplace: 'planned' | 'live'
  topAgents: { agent: string; agents: number }[] | null
}

const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString('cs-CZ') : '—')

export function AgentNumbers() {
  const [s, setS] = useState<Stats | null>(null)
  useEffect(() => {
    const ctl = new AbortController()
    // Same path on both hosts: /api/* answers on the website and on the app host.
    fetch('/api/agent/v1/stats', { signal: ctl.signal, headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && typeof j === 'object') setS(j as Stats) })
      .catch(() => {})
    return () => ctl.abort()
  }, [])
  const items: { n: string; l: string; note?: string }[] = [
    { n: fmt(s?.agentsWelcomed), l: 'přivítaných agentů', note: s?.agentsToday ? `${fmt(s.agentsToday)} dnes` : undefined },
    { n: fmt(s?.agentsPaid), l: 'agentů nakoupilo' },
    { n: fmt(s?.paidCalls), l: 'placených volání' },
    s?.marketplace === 'live'
      ? { n: fmt(s.sellers), l: 'agentů prodalo' }
      : { n: '…', l: 'agentů prodalo', note: 'tržiště agentů připravujeme' },
  ]
  const top = s?.topAgents?.filter((t) => t.agent !== 'browser').slice(0, 5) ?? []
  return (
    <div className="qag" aria-live="polite">
      <dl className="qag-g">
        {items.map((it) => (
          <div key={it.l} className="qag-i card glass">
            <dt className="qag-l">{it.l}</dt>
            <dd className="qag-n">{it.n}</dd>
            {it.note && <span className="qag-s">{it.note}</span>}
          </div>
        ))}
      </dl>
      <p className="fine qag-f">
        {top.length > 0 && <>Nejčastěji u nás: {top.map((t) => t.agent).join(', ')}. </>}
        Počítáme anonymně: agent = otisk adresy a klienta za den, nic neukládáme v čitelné podobě.
        Čísla jsou veřejná i pro agenty: <a href={STATS_URL}>{STATS_URL.replace(/^https?:\/\//, '')}</a>.
      </p>
    </div>
  )
}
