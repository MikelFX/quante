'use client'

// Agents panel of one store (Dashboard, lib/agent-shops): every published store is agent-ready —
// it describes itself at /.well-known/agent-shop.json and answers agents' catalog, quote, order and
// MCP calls. Here the owner sees those addresses and lists the store in the registry of
// agent-ready stores (CREDIT_COSTS.agent_shop_listing once per store, Agency included), re-reads
// it now, or takes it out. All calls go to /api/projects/[id]/agent-shop.
import { useEffect, useState } from 'react'

interface Listing {
  status: 'listed' | 'unreachable' | 'removed'
  origin: string
  products: number
  inStock: number
  ordering: boolean
  listedAt: string
  lastOkAt: string | null
  lastError: string | null
}

interface State {
  ready: boolean
  origin: string | null
  agentShopUrl: string | null
  mcpUrl: string | null
  listing: Listing | null
  fee: { credits: number; agency: boolean; alreadyPaid: boolean }
}

const STATUS: Record<Listing['status'], string> = {
  listed: 'Listed — agents find it',
  unreachable: 'Hidden — the store did not answer for 3 days',
  removed: 'Not listed',
}

export function AgentShopPanel({ projectId, name }: { projectId: string; name: string }) {
  const [s, setS] = useState<State | null>(null)
  const [busy, setBusy] = useState<null | 'list' | 'remove'>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/projects/${projectId}/agent-shop`)
      .then((r) => r.json())
      .then((d) => { if (alive) setS(d as State) })
      .catch(() => { if (alive) setMsg({ kind: 'error', text: 'Could not load.' }) })
    return () => { alive = false }
  }, [projectId])

  async function act(method: 'POST' | 'DELETE') {
    setBusy(method === 'POST' ? 'list' : 'remove'); setMsg(null)
    try {
      const r = await fetch(`/api/projects/${projectId}/agent-shop`, { method })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? 'Something went wrong.')
      const fresh = await fetch(`/api/projects/${projectId}/agent-shop`).then((x) => x.json())
      setS(fresh as State)
      setMsg({ kind: 'ok', text: method === 'DELETE' ? 'Taken out of the registry.' : d.charged ? `Listed. ${d.charged} credits were charged.` : 'Listed — the products are up to date.' })
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setBusy(null)
    }
  }

  if (!s) return <section className="gd-kit" aria-label={`Agents for ${name}`}><p className="gd-kit-lead">{msg?.text ?? 'Loading…'}</p></section>

  const l = s.listing
  const active = l && l.status !== 'removed'
  const price = s.fee.agency ? 'included in Agency' : s.fee.alreadyPaid ? 'already paid' : `${s.fee.credits} credits, once`

  return (
    <section className="gd-kit" aria-label={`Agents for ${name}`}>
      <p className="gd-kit-lead">
        AI agents can read this store and buy from it for their person: the catalog with stock, shipping, payment methods and terms,
        a price quote and an order through your normal checkout (the person pays at the payment link, or the order arrives as cash on
        delivery / bank transfer). Listing it in the registry of agent-ready stores lets agents find it when they search for a product.
      </p>
      {!s.origin ? (
        <p className="gd-kit-lead">Publish the store first — agents can only reach a live store.</p>
      ) : (
        <div className="gd-kit-row">
          <div className="gd-kit-block">
            <h3>For agents</h3>
            <a className="gd-mono gd-domain" href={s.agentShopUrl!} target="_blank" rel="noopener noreferrer">/.well-known/agent-shop.json ↗</a>
            <a className="gd-mono gd-domain" href={`${s.origin}/llms.txt`} target="_blank" rel="noopener noreferrer">/llms.txt ↗</a>
            <span className="gd-mono gd-quiet">MCP: {s.mcpUrl}</span>
          </div>
          <div className="gd-kit-block">
            <h3>Registry</h3>
            {!s.ready ? (
              <p className="gd-kit-lead">The registry is not set up yet — it appears here once the database update has run.</p>
            ) : (
              <>
                <p className="gd-counts">
                  {l ? STATUS[l.status] : 'Not listed'}
                  {active && <> · {l!.products} products, {l!.inStock} in stock{l!.ordering ? ' · takes orders from agents' : ' · catalog only'}</>}
                </p>
                {active && l!.lastError && <p className="gd-kit-lead">Last check: {l!.lastError}</p>}
                <div className="gd-brand-actions">
                  <button type="button" className="q-btn" disabled={!!busy} onClick={() => act('POST')}>
                    {busy === 'list' ? 'Reading the store…' : active ? 'Update now' : `List in the registry (${price})`}
                  </button>
                  {active && (
                    <button type="button" className="gd-link" disabled={!!busy} onClick={() => act('DELETE')}>
                      {busy === 'remove' ? 'Removing…' : 'Take out of the registry'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {msg && <p role="status" className={msg.kind === 'error' ? 'gd-kit-err' : 'gd-kit-ok'}>{msg.text}</p>}
    </section>
  )
}
