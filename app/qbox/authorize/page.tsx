// Consent page of the Qbox MCP connector's OAuth sign-in (lib/qbox/oauth.ts). The MCP client (e.g.
// Claude after "Add custom connector") sends the person here; Allow posts to /api/qbox/oauth/authorize.
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { QboxNotSetUpError, betaMember } from '@/lib/qbox/store'
import { AUTHORIZE_PATH, oauthSecret, parseAuthorize } from '@/lib/qbox/oauth'
import { QBOX_PRICING } from '@/lib/qbox/limits'
import '../../qads/qads.css'
import '../qbox.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Connect Qbox', robots: { index: false, follow: false } }

type Search = Record<string, string | string[] | undefined>

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="qnt-public qp-dark qz qb" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px 16px' }}>
      <main className="qb-card" style={{ width: '100%', maxWidth: 460 }}>{children}</main>
    </div>
  )
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Search> }) {
  const raw = await searchParams
  const q: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') q[k] = v
  const secret = oauthSecret(process.env)
  if (!secret) return <Shell><h1 className="qz-h1" style={{ fontSize: 28 }}>Not available</h1><p className="qb-muted">Qbox sign-in is not set up yet.</p></Shell>

  const p = parseAuthorize(secret, q)
  if (!p.ok) {
    return <Shell><h1 className="qz-h1" style={{ fontSize: 28 }}>Can’t connect</h1><p className="qb-muted">{p.error.includes(' ') ? p.error : 'The request from your AI tool is incomplete. Remove the connector and add it again.'}</p></Shell>
  }

  const { userId } = await auth()
  if (!userId) {
    const back = `${AUTHORIZE_PATH}?${new URLSearchParams(q)}`
    redirect(`/login?redirect_url=${encodeURIComponent(back)}`)
  }

  let member = null
  try {
    member = await betaMember(userId)
  } catch (e) {
    if (!(e instanceof QboxNotSetUpError)) throw e
  }
  if (!member) {
    return <Shell><h1 className="qz-h1" style={{ fontSize: 28 }}>No Qbox access yet</h1><p className="qb-muted">This account can’t use Qbox yet. Open <a href="/qbox">quantecode.com/qbox</a> to get access, then connect again.</p></Shell>
  }

  const backTo = new URL(p.req.redirectUri).host
  return (
    <Shell>
      <p className="qb-eyebrow"><span className="qb-dot" aria-hidden="true" />Qbox connector</p>
      <h1 className="qz-h1" style={{ fontSize: 30, margin: 0 }}>Connect <em>{p.req.client.name}</em> to Qbox?</h1>
      <p className="qb-muted" style={{ margin: 0 }}>
        It will be able to start isolated Linux sandboxes on your account, run commands and read and write files in them.
        Sandboxes are paid from your Qbox balance ({QBOX_PRICING.vcpuMinutesPerUsd} vCPU-minutes = $1). You return to <b>{backTo}</b>.
      </p>
      <p className="qb-muted" style={{ margin: 0, fontSize: 13 }}>A key named “{p.req.client.name} · connector” appears on /qbox. Revoke it there any time to disconnect.</p>
      <form method="post" action="/api/qbox/oauth/authorize" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {Object.entries(q).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <button type="submit" name="decision" value="allow" className="qz-go">Allow</button>
        <button type="submit" name="decision" value="deny" className="qz-go" style={{ background: 'transparent', color: 'var(--q-fg)', border: '1px solid var(--q-line2)' }}>Cancel</button>
      </form>
    </Shell>
  )
}
