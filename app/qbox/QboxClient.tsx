'use client'

// /qbox — Qbox, sandboxes for AI agents. Public: what it is, how an agent connects (MCP / REST /
// x402 self-signup), the price (QboxDocs.tsx). Signed in: invite-only beta (QBOX_ACCESS unset:
// request access → keys) or the open paid plan (QBOX_ACCESS=open: balance, credit top-up, keys).

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useUser } from '@clerk/nextjs'
import { Check, KeyRound, Loader2, Trash2, Wallet } from 'lucide-react'
import { PublicNav } from '@/components/public/PublicNav'
import { SiteFooter } from '@/components/SiteFooter'
import { ParticleMode } from '@ad/ui/particles'
import { CodeTabs, CopyBtn, Pricing, Services } from './QboxDocs'
import '../qads/qads.css'
import './qbox.css'

interface Key { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null }
interface State {
  setUp: boolean
  member: boolean
  waitlisted?: boolean
  tier?: 'paid' | 'beta'
  balance?: number | null
  paidSetUp?: boolean
  canUseCredits?: boolean
  agentPayments?: boolean
  limits?: { maxConcurrent: number; monthlyMinutes: number | null; maxTimeoutMinutes: number }
  usage?: { minutes: number; running: number; sandboxes: number }
  keys?: Key[]
}

export function QboxClient({ open }: { open: boolean }) {
  const { isSignedIn, isLoaded } = useUser()
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [useCase, setUseCase] = useState('')
  const [keyName, setKeyName] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [credits, setCredits] = useState('10')
  const [tick, setTick] = useState(0)
  const load = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    let off = false
    fetch('/api/qbox/keys', { cache: 'no-store' })
      .then(async (res) => ({ res, data: await res.json().catch(() => null) }))
      .then(({ res, data }) => {
        if (off) return
        if (!res.ok || !data) setError(data?.error ?? 'Could not load the beta.')
        else setState(data as State)
      })
      .catch(() => { if (!off) setError('Could not reach the server.') })
    return () => { off = true }
  }, [isLoaded, isSignedIn, tick])

  async function requestAccess(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const res = await fetch('/api/qbox/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ useCase }) })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(data?.error ?? 'Could not save the request.'); return }
    setState((s) => (s ? { ...s, waitlisted: true } : s))
  }

  async function createKey(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const res = await fetch('/api/qbox/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: keyName }) })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || !data?.key) { setError(data?.error ?? 'Could not create the key.'); return }
    setNewKey(data.key); setKeyName('')
    load()
  }

  async function topUp(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const res = await fetch('/api/qbox/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credits: Number(credits) }) })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(data?.error ?? 'Could not top up.'); return }
    load()
  }

  async function revoke(id: string) {
    if (!window.confirm('Revoke this key? Agents using it stop working immediately.')) return
    const res = await fetch(`/api/qbox/keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) { setError('Could not revoke the key.'); return }
    load()
  }

  const signIn = () => { window.location.href = `/login?redirect_url=${encodeURIComponent('/qbox')}` }
  const loading = !isLoaded || (isSignedIn && !state && !error)

  return (
    <div className="qnt-public qp-dark qz qb" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ParticleMode mode="site" />
      <PublicNav />

      <main style={{ flex: 1, padding: '0 1.25rem', width: '100%' }}>
        <header className="qz-hero">
          <p className="qb-eyebrow"><span className="qb-dot" aria-hidden="true" />{open ? 'Open to every agent · pay per use' : 'Closed beta'}</p>
          <h1 className="qz-h1">A computer for your <em>AI agent.</em></h1>
          <p className="qz-sub qb-sub">
            Qbox starts an isolated sandbox on one API call or MCP tool. Your agent runs code, installs packages, works
            with files and opens a preview URL there, never on your own machine. {open ? 'An agent with a wallet opens its own account and pays by itself.' : ''}
          </p>
        </header>

        <section className="qb-wrap" aria-live="polite">
          {loading && <p className="qb-muted"><Loader2 className="qb-spin" aria-hidden="true" /> Loading…</p>}

          {isLoaded && !isSignedIn && (
            <div className="qb-card">
              {open ? (
                <>
                  <h2>Get an API key</h2>
                  <p className="qb-muted">Agents can open an account by paying (see “Agent pays itself” below). People sign in, top up with Quante credits and create keys here.</p>
                  <button type="button" className="qz-go" onClick={signIn}>Sign in</button>
                </>
              ) : (
                <>
                  <h2>Join the beta</h2>
                  <p className="qb-muted">Sign in and tell us what your agent should do. We invite in small groups.</p>
                  <button type="button" className="qz-go" onClick={signIn}>Sign in to request access</button>
                </>
              )}
            </div>
          )}

          {state && !state.setUp && (
            <div className="qb-card"><h2>Almost ready</h2><p className="qb-muted">The beta opens in the next few days. Come back soon.</p></div>
          )}

          {state?.setUp && !state.member && (
            <div className="qb-card">
              {state.waitlisted ? (
                <>
                  <h2><Check className="qb-ok" aria-hidden="true" /> You are on the list</h2>
                  <p className="qb-muted">We will e-mail you when your account is invited. Then this page shows your API keys.</p>
                </>
              ) : (
                <form onSubmit={(e) => void requestAccess(e)}>
                  <h2>Request access</h2>
                  <label className="qb-label" htmlFor="qb-use">What will your agent do in the sandbox? (optional)</label>
                  <textarea id="qb-use" className="qt-input qb-area" maxLength={1000} value={useCase}
                    placeholder="e.g. run tests on pull requests, scrape with a headless browser, analyse CSV files…"
                    onChange={(e) => setUseCase(e.currentTarget.value)} />
                  <button type="submit" className="qz-go" disabled={busy}>{busy ? 'Sending…' : 'Request access'}</button>
                </form>
              )}
            </div>
          )}

          {state?.member && state.limits && state.usage && (
            <>
              {state.tier === 'paid' && (
                <div className="qb-card">
                  <h2><Wallet aria-hidden="true" /> Balance</h2>
                  {state.paidSetUp === false ? (
                    <p className="qb-muted">Paid access is being set up. Come back soon.</p>
                  ) : (
                    <>
                      <p className="qb-big"><b>{state.balance ?? 0}</b> vCPU-minutes left</p>
                      {state.canUseCredits ? (
                        <form className="qb-keyform" onSubmit={(e) => void topUp(e)}>
                          <label className="vh" htmlFor="qb-credits">Credits to spend</label>
                          <input id="qb-credits" className="qt-input" type="number" min={1} max={10000} step={1} value={credits} onChange={(e) => setCredits(e.currentTarget.value)} />
                          <button type="submit" className="qz-go" disabled={busy}>Top up with credits</button>
                        </form>
                      ) : (
                        <p className="qb-muted">Qbox is paid only: <a href="/billing">buy a credit pack</a> first, then top up here. Welcome credits can’t be used for Qbox.</p>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="qb-stats">
                <div><b>{state.usage.minutes}</b><span>{state.limits.monthlyMinutes ? `of ${state.limits.monthlyMinutes} sandbox-minutes this month` : 'sandbox-minutes this month'}</span></div>
                <div><b>{state.usage.running}</b><span>running now (max {state.limits.maxConcurrent})</span></div>
                <div><b>{state.limits.maxTimeoutMinutes} min</b><span>longest sandbox</span></div>
              </div>

              <div className="qb-card">
                <h2><KeyRound aria-hidden="true" /> API keys</h2>
                {newKey && (
                  <div className="qb-new" role="status">
                    <p>Your new key. Copy it now: it is not shown again.</p>
                    <div className="qb-keyrow"><code>{newKey}</code><CopyBtn text={newKey} /></div>
                  </div>
                )}
                <ul className="qb-keys">
                  {(state.keys ?? []).map((k) => (
                    <li key={k.id}>
                      <span><b>{k.name}</b> <code>{k.prefix}…</code></span>
                      <span className="qb-muted">{k.last_used_at ? `used ${new Date(k.last_used_at).toLocaleDateString()}` : 'never used'}</span>
                      <button type="button" className="qb-icon" aria-label={`Revoke ${k.name}`} onClick={() => void revoke(k.id)}><Trash2 aria-hidden="true" /></button>
                    </li>
                  ))}
                  {!state.keys?.length && <li className="qb-muted">No keys yet.</li>}
                </ul>
                <form className="qb-keyform" onSubmit={(e) => void createKey(e)}>
                  <label className="vh" htmlFor="qb-name">Key name</label>
                  <input id="qb-name" className="qt-input" maxLength={60} placeholder="Key name, e.g. my-agent" value={keyName} onChange={(e) => setKeyName(e.currentTarget.value)} />
                  <button type="submit" className="qz-go" disabled={busy}>Create key</button>
                </form>
              </div>

            </>
          )}

          {error && <p className="qz-err" role="alert">{error}</p>}

          <CodeTabs apiKey={newKey ?? ''} />
          {open && <Pricing />}
          {open && <Services apiKey={newKey ?? ''} />}

          <p className="qb-fine" id="terms">
            Terms: no crypto mining, spam, attacks, scanning other people’s systems or illegal content; we may stop any sandbox.
            {open ? ' Services you sell are yours: you are the seller to your buyers and handle your own taxes. Not allowed for sale: fraud, phishing, malware, illegal content, financial advice, gambling, adult content, and anything that holds or exchanges crypto for others; we may block any service.' : ''}
            {open ? ' Paid time does not expire and is not refunded.' : ''} Qbox is a product of AssetraDigital
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
