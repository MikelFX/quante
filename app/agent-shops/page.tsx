// /agent-shops — the registry of agent-ready stores (lib/agent-shops): what the open
// /.well-known/agent-shop.json format is, how an agent buys, how a store gets listed, and the stores
// listed so far. Its Markdown for agents is lib/agent-shops/spec.ts (/agent-shops.md).
import Link from 'next/link'
import { PublicNav } from '@/components/public/PublicNav'
import { SiteFooter } from '@/components/SiteFooter'
import { ParticleMode } from '@ad/ui/particles'
import { buildMetadata } from '@/lib/seo'
import { CREDIT_COSTS } from '@/lib/config'
import { agentToolUsd } from '@/lib/agents/paid-price'
import { DOC_EXAMPLE } from '@/lib/agent-shops/spec'
import { listDirectory } from '@/lib/agent-shops/registry'
import '../qads/qads.css'
import '../qbox/qbox.css'

export const revalidate = 300

export const metadata = buildMetadata({
  title: 'Agent-ready stores — buy through AI agents',
  description: 'Online stores AI agents can read and buy from: catalog, stock, shipping, quote and order at /.well-known/agent-shop.json, and a registry agents search.',
  path: '/agent-shops',
})

type Directory = Awaited<ReturnType<typeof listDirectory>>

async function directory(): Promise<Directory | null> {
  try {
    return await listDirectory({ country: null, limit: 100, offset: 0 })
  } catch {
    return null
  }
}

export default async function AgentShopsPage() {
  const dir = await directory()
  const example = JSON.stringify({ agentShop: DOC_EXAMPLE.agentShop, shop: DOC_EXAMPLE.shop, catalog: DOC_EXAMPLE.catalog, ordering: DOC_EXAMPLE.ordering, interfaces: DOC_EXAMPLE.interfaces }, null, 2)
  return (
    <div className="qnt-public qp-dark qz qb" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ParticleMode mode="site" />
      <PublicNav />
      <main style={{ flex: 1, padding: '0 1.25rem', width: '100%' }}>
        <header className="qz-hero">
          <p className="qb-eyebrow"><span className="qb-dot" aria-hidden="true" />Open format · registry</p>
          <h1 className="qz-h1">Stores that <em>AI agents</em> can buy from.</h1>
          <p className="qz-sub qb-sub">
            An agent-ready store describes itself at <code>/.well-known/agent-shop.json</code>: catalog with stock, shipping,
            payment methods, terms, a price quote and an order through the store&apos;s own checkout. The registry lets agents find them.
          </p>
        </header>

        <section className="qb-wrap">
          <div className="qb-card">
            <h2>For stores</h2>
            <p className="qb-muted">
              Every store built with Quante is agent-ready once it is published — nothing to install. List it so agents find it:
              Dashboard → your store → Agents ({CREDIT_COSTS.agent_shop_listing} credits once, included in Agency). Agents get a quote
              from your own prices; an order needs their person&apos;s consent, and the person pays through your normal payment link
              or chooses cash on delivery / bank transfer.
            </p>
            <p className="qb-muted"><Link href="/dashboard" className="q-btn">Open the Dashboard</Link></p>
          </div>

          <div className="qb-card">
            <h2>For agents</h2>
            <p className="qb-muted">
              Read the store&apos;s description, quote the basket, then order with your person&apos;s consent — over HTTP or the
              store&apos;s MCP server. Find stores in the free directory <code>/api/agent/v1/shops</code>, or search products across all
              of them at <code>/api/agent/v1/shops/search?q=…</code> (${agentToolUsd('shops').toFixed(2)} per call over x402, not charged
              when nothing is found). Full format: <a href="/agent-shops.md">agent-shops.md</a>.
            </p>
            <pre className="qb-muted" style={{ overflowX: 'auto', margin: 0 }}><code>{example}</code></pre>
          </div>

          <div className="qb-card">
            <h2>Listed stores{dir ? ` (${dir.total})` : ''}</h2>
            {!dir && <p className="qb-muted">The registry opens soon.</p>}
            {dir && dir.shops.length === 0 && <p className="qb-muted">No store is listed yet — yours can be the first.</p>}
            {dir && dir.shops.length > 0 && (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                {dir.shops.map((s) => (
                  <li key={s.url} className="qb-muted">
                    <a href={s.url} rel="noopener" target="_blank"><strong>{s.name}</strong></a>
                    <span>{[s.country, s.currency, `${s.products} products`, s.ordersFromAgents ? 'takes orders from agents' : 'catalog only'].filter(Boolean).join(' · ')}</span>
                    <a href={s.agentShop} rel="noopener" target="_blank"><code>agent-shop.json</code></a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
