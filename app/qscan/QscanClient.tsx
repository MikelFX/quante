'use client'

// /qscan — rebuild an existing store from its address. One field (the address) and one button,
// like /qads. Then: what Qscan found (products, photos, videos, colours, fonts) → "Build my new
// store" (a normal Quante generation with the scan's brief, POST /api/quante/generate) → the new
// store is a regular Quante project, and the merchant picks how to keep it: keep working in the
// Studio, host it with us (monthly / yearly, /api/hosting/subscribe) or take the code (/api/export).
//
// Signed out, the address is kept in sessionStorage across sign-in and the visitor clicks once
// more. A running build is kept in sessionStorage too, so a reload picks the polling back up.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { ArrowRight, Check, Code2, Download, Globe, Layers, Loader2, RotateCcw, ScanLine, Server, Sparkles } from 'lucide-react'
import { PublicNav } from '@/components/public/PublicNav'
import { SiteFooter } from '@/components/SiteFooter'
import { ParticleMode } from '@ad/ui/particles'
import { CREDIT_COSTS, HOSTING_ANNUAL_USD, HOSTING_MONTHLY_USD } from '@/lib/config'
import { buildProjectUrl, decidePollAction, isJobStuck, phaseToStatusText, type JobStatusPayload } from '@/lib/generation-poll'
import '../qads/qads.css'
import './qscan.css'

interface ScanSummary {
  url: string
  platform: string
  platformLabel: string
  brand: { name: string; tagline: string; description: string; logo: string | null }
  language: string
  currency: string | null
  colors: string[]
  fonts: string[]
  pagesScanned: number
  products: number
  productsPreview: Array<{ name: string; price: number | null; currency: string | null; image: string | null }>
  texts: number
  images: number
  imagesFound: number
  videos: number
  videosFound: number
  motion: string[]
}

interface Scan { scanId: string; summary: ScanSummary; brief: string; projectName: string }

interface Built {
  projectId: string
  studioUrl: string
  previewUrl: string | null
}

type Stage = 'idle' | 'scanning' | 'scanned' | 'building' | 'built'

const DRAFT_KEY = 'qscan:url:v1'
const RUN_KEY = 'qscan:run:v1'

const SCAN_STEPS = ['Reading the pages', 'Finding products and prices', 'Copying photos and videos', 'Reading colours, fonts and copy']

function price(n: number | null, currency: string | null) {
  if (n === null) return ''
  const v = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2)
  return currency ? `${v} ${currency}` : v
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export function QscanClient() {
  const { isSignedIn, isLoaded } = useUser()
  const [url, setUrl] = useState('')
  const [rights, setRights] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const [step, setStep] = useState(0)
  const [scan, setScan] = useState<Scan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsCredits, setNeedsCredits] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [built, setBuilt] = useState<Built | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [agency, setAgency] = useState(false)
  const [busy, setBusy] = useState<null | 'month' | 'year' | 'code'>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const resultRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isSignedIn) return
    void (async () => {
      try {
        const res = await fetch('/api/credits/balance')
        if (!res.ok) return
        const b = (await res.json()) as { balance?: number | null; tier?: string }
        if (typeof b.balance === 'number') setBalance(b.balance)
        setAgency(b.tier === 'agency')
      } catch {}
    })()
  }, [isSignedIn])

  // The scan is one request; the steps only show what it is doing meanwhile.
  useEffect(() => {
    if (stage !== 'scanning') return
    const t = setInterval(() => setStep((s) => Math.min(s + 1, SCAN_STEPS.length - 1)), 9000)
    return () => clearInterval(t)
  }, [stage])

  const toResult = () => requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

  const signIn = () => {
    try { sessionStorage.setItem(DRAFT_KEY, url) } catch {}
    window.location.href = `/login?redirect_url=${encodeURIComponent('/qscan')}`
  }

  async function startScan(e?: FormEvent) {
    e?.preventDefault()
    if (!url.trim() || stage === 'scanning' || stage === 'building') return
    if (isLoaded && !isSignedIn) return signIn()
    if (!rights) {
      setError('Tick the box first: the store is yours, or you may use its content.')
      return
    }
    setError(null)
    setNeedsCredits(false)
    setScan(null)
    setBuilt(null)
    setStep(0)
    setStage('scanning')
    try {
      const res = await fetch('/api/qscan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, rights }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.summary) {
        setError(data?.error ?? 'The scan failed. Please try again.')
        setStage('idle')
        return
      }
      setScan(data as Scan)
      setStage('scanned')
      toResult()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setStage('idle')
    }
  }

  async function build() {
    if (!scan) return
    setError(null)
    setNeedsCredits(false)
    setStage('building')
    setStatusText('Designing your new store…')
    try {
      const res = await fetch('/api/quante/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: scan.brief, projectName: scan.projectName }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.jobId) {
        if (data?.code === 'billing_hold') setError('Your account is on a billing hold, so credits can’t be spent right now. Please contact support@quantecode.com.')
        else {
          setError(data?.error ?? 'Could not start building. Please try again.')
          setNeedsCredits(res.status === 402)
        }
        setStage('scanned')
        return
      }
      const startedAt = Date.now()
      try { sessionStorage.setItem(RUN_KEY, JSON.stringify({ scan, jobId: data.jobId, startedAt })) } catch {}
      await poll(data.jobId as string, startedAt, scan)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setStage('scanned')
    }
  }

  async function poll(jobId: string, startedAt: number, scanFor: Scan) {
    setStage('building')
    toResult()
    const done = () => { try { sessionStorage.removeItem(RUN_KEY) } catch {} }
    while (true) {
      await new Promise((r) => setTimeout(r, 2500))
      let payload: JobStatusPayload
      try {
        const r = await fetch(`/api/quante/generate/status?jobId=${jobId}`)
        if (!r.ok) continue
        payload = await r.json()
      } catch {
        continue
      }
      setStatusText(phaseToStatusText(payload.phase))
      const decision = decidePollAction(payload)
      if (decision.action === 'navigate') {
        done()
        // Grideet shows the scan under the store it built (qscan_scans.project_id, migration-grideet.sql).
        void fetch(`/api/qscan/${scanFor.scanId}/project`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: decision.projectId }),
        }).catch(() => {})
        setBuilt({
          projectId: decision.projectId,
          studioUrl: buildProjectUrl(decision.projectId, decision.deploymentId, decision.codeVersionId, payload.previewUrl, decision.deployError),
          previewUrl: payload.previewUrl,
        })
        setStage('built')
        toResult()
        return
      }
      if (decision.action === 'error') {
        done()
        setError(decision.message)
        setStage('scanned')
        return
      }
      if (isJobStuck(startedAt, Date.now())) {
        done()
        setError('Building took too long. Check your dashboard — the store may have been saved there.')
        setStage('scanned')
        return
      }
    }
  }

  async function host(interval: 'month' | 'year') {
    if (!built) return
    setBusy(interval)
    setError(null)
    try {
      const res = await fetch('/api/hosting/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: built.projectId, interval }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.url) {
        window.location.href = data.url
        return
      }
      setError(data?.error ?? 'Could not open checkout. Please try again.')
    } catch {
      setError('Could not reach the server. Please try again.')
    }
    setBusy(null)
  }

  async function takeCode() {
    if (!built) return
    setBusy('code')
    setError(null)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: built.projectId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Could not prepare the download. Please try again.')
      } else {
        const blob = await res.blob()
        const name = res.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? 'store.zip'
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      }
    } catch {
      setError('Could not reach the server. Please try again.')
    }
    setBusy(null)
  }

  // Restore the address typed before sign-in, or pick a running build back up.
  // (after poll() is declared; state is set from a timer, not synchronously in the effect)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const draft = sessionStorage.getItem(DRAFT_KEY)
        if (draft) {
          setUrl(draft)
          sessionStorage.removeItem(DRAFT_KEY)
        } else {
          // "Scan again" from Grideet: /qscan?url=<address> fills the field (the scan still waits for the checkbox).
          const asked = new URLSearchParams(window.location.search).get('url')
          if (asked) setUrl(asked.slice(0, 2048))
        }
        const run = sessionStorage.getItem(RUN_KEY)
        if (run) {
          const saved = JSON.parse(run) as { scan: Scan; jobId: string; startedAt: number }
          if (saved?.jobId && saved.scan) {
            setScan(saved.scan)
            setUrl(saved.scan.summary.url)
            void poll(saved.jobId, saved.startedAt, saved.scan)
          }
        }
      } catch {}
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reset = () => {
    setStage('idle')
    setScan(null)
    setBuilt(null)
    setError(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const s = scan?.summary
  const scanning = stage === 'scanning'
  const cost = CREDIT_COSTS.generate

  return (
    <div className="qnt-public qp-dark qz qs" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ParticleMode mode="site" />
      <PublicNav />

      <main style={{ flex: 1, padding: '0 1.25rem', width: '100%' }}>
        <header className="qz-hero">
          <h1 className="qz-h1">Your store, <em>rebuilt.</em></h1>
          <p className="qz-sub qs-sub">
            Paste the address of your e-shop or website. Qscan takes the products, photos, videos and copy and
            builds a new, far better-looking store in Quante.
          </p>
        </header>

        <form className="qz-box qs-box" onSubmit={(e) => void startScan(e)} aria-label="Scan a store">
          <div className="qs-field">
            <Globe className="qs-globe" aria-hidden="true" />
            <label htmlFor="qs-url" className="vh">Store address</label>
            <input
              id="qs-url"
              ref={inputRef}
              className="qs-input"
              type="text"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="yourstore.com"
              value={url}
              maxLength={2048}
              disabled={scanning || stage === 'building'}
              onChange={(e) => setUrl(e.currentTarget.value)}
            />
            <button type="submit" className="qz-go qs-go" disabled={!url.trim() || scanning || stage === 'building'}>
              {scanning ? 'Scanning…' : 'Scan'}
              <span className="ar">{scanning ? <Loader2 className="qs-spin" /> : <ScanLine />}</span>
            </button>
          </div>
          <label className="qs-rights">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.currentTarget.checked)} />
            <span>The store is mine, or I have the right to use its content.</span>
          </label>
        </form>

        <p className="qz-under">
          Shopify · WooCommerce · Shoptet · any website — scanning is free{isLoaded && !isSignedIn ? ', sign in to start' : ''}.
        </p>
        {error && (
          <p className="qz-err" role="alert">
            {error}{needsCredits && <> · <Link href="/billing">Top up credits</Link></>}
          </p>
        )}

        <section ref={resultRef} className="qs-result" aria-live="polite">
          {scanning && (
            <ol className="qs-steps" aria-label="Scan progress">
              {SCAN_STEPS.map((t, i) => (
                <li key={t} data-state={i < step ? 'done' : i === step ? 'now' : 'next'}>
                  <span className="qs-dot" aria-hidden="true">{i < step ? <Check /> : i === step ? <Loader2 className="qs-spin" /> : null}</span>
                  {t}
                </li>
              ))}
            </ol>
          )}

          {s && stage !== 'scanning' && (
            <article className="qs-card">
              <header className="qs-card-h">
                <div className="qs-brand">
                  {s.brand.logo
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={s.brand.logo} alt="" className="qs-logo" />
                    : <span className="qs-logo qs-logo-t" aria-hidden="true">{s.brand.name.slice(0, 1)}</span>}
                  <div>
                    <h2>{s.brand.name}</h2>
                    <p>{hostOf(s.url)} · {s.platformLabel}{s.currency ? ` · ${s.currency}` : ''}{s.language ? ` · ${s.language.toUpperCase()}` : ''}</p>
                  </div>
                </div>
                {stage === 'scanned' && (
                  <button type="button" className="qz-b" onClick={reset}><RotateCcw aria-hidden="true" />Scan another</button>
                )}
              </header>

              <dl className="qs-stats">
                <div><dt>Products</dt><dd>{s.products}</dd></div>
                <div><dt>Photos</dt><dd>{s.images}</dd></div>
                <div><dt>Videos</dt><dd>{s.videos}</dd></div>
                <div><dt>Pages read</dt><dd>{s.pagesScanned}</dd></div>
              </dl>

              {(s.colors.length > 0 || s.fonts.length > 0) && (
                <div className="qs-look">
                  {s.colors.length > 0 && (
                    <div className="qs-sw" aria-label="Brand colours">
                      {s.colors.map((c) => <span key={c} style={{ background: c }} title={c} />)}
                    </div>
                  )}
                  {s.fonts.length > 0 && <p className="qs-fonts">{s.fonts.join(' · ')}</p>}
                  {s.motion.length > 0 && <p className="qs-fonts">{s.motion.join(' · ')}</p>}
                </div>
              )}

              {s.productsPreview.length > 0 ? (
                <ul className="qs-products" aria-label="Products found">
                  {s.productsPreview.map((p, i) => (
                    <li key={i}>
                      <span className="qs-ph">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {p.image ? <img src={p.image} alt="" loading="lazy" /> : <Layers aria-hidden="true" />}
                      </span>
                      <span className="qs-pn">{p.name}</span>
                      <span className="qs-pp">{price(p.price, p.currency)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="qs-note">
                  No products could be read automatically (some stores hide them from scanners). The new store will be
                  built from the copy and photos — you can add products in the Studio afterwards.
                </p>
              )}
              {s.videosFound > s.videos && (
                <p className="qs-note">{s.videosFound - s.videos} of {s.videosFound} videos weren’t copied (embedded YouTube or Vimeo videos, or over the limit of short video files) — add them in the Studio if you want them.</p>
              )}

              {stage === 'scanned' && (
                <div className="qs-cta">
                  <button type="button" className="qz-go" onClick={() => void build()}>
                    Build my new store
                    <span className="cr">{agency ? 'included' : `${cost} cr`}</span>
                    <span className="ar"><ArrowRight /></span>
                  </button>
                  <p>{agency ? 'Included in Agency.' : balance !== null ? <>Balance {balance} cr · <Link href="/billing">Top up</Link></> : null}</p>
                </div>
              )}

              {stage === 'building' && (
                <div className="qs-building" role="status">
                  <Sparkles aria-hidden="true" />
                  <div>
                    <strong>{statusText || 'Designing your new store…'}</strong>
                    <span>Usually 2–4 minutes. You can leave this page — the store lands in your dashboard.</span>
                  </div>
                </div>
              )}
            </article>
          )}

          {stage === 'built' && built && (
            <article className="qs-card qs-done">
              <p className="qs-k">Ready</p>
              <h2>Your new store is built.</h2>
              <p className="qs-lead">
                It’s a regular Quante store: tweak it in the Studio, then choose how you want to keep it.
                {built.previewUrl && <> <a href={built.previewUrl} target="_blank" rel="noopener noreferrer">Open the preview</a>.</>}
              </p>
              <div className="qs-choices">
                <section className="qs-choice qs-main">
                  <Sparkles aria-hidden="true" />
                  <h3>Keep working in Quante</h3>
                  <p>Edit with chat or visually, check it with Qgent, make ads with Qads.</p>
                  <Link href={built.studioUrl} className="qz-go">Open in Studio <span className="ar"><ArrowRight /></span></Link>
                </section>
                <section className="qs-choice">
                  <Server aria-hidden="true" />
                  <h3>Host it with us</h3>
                  <p>We run it on your domain: hosting, SSL, payments and updates.</p>
                  <div className="qs-row">
                    <button type="button" className="qz-b" disabled={!!busy} onClick={() => void host('month')}>
                      {busy === 'month' ? <Loader2 className="qs-spin" /> : null}${HOSTING_MONTHLY_USD} / month
                    </button>
                    <button type="button" className="qz-b" aria-pressed="true" disabled={!!busy} onClick={() => void host('year')}>
                      {busy === 'year' ? <Loader2 className="qs-spin" /> : null}${HOSTING_ANNUAL_USD} / year
                    </button>
                  </div>
                </section>
                <section className="qs-choice">
                  <Code2 aria-hidden="true" />
                  <h3>Take the code</h3>
                  <p>The whole store as a Next.js project, yours to run anywhere. {CREDIT_COSTS.export} credits, once per store.</p>
                  <div className="qs-row">
                    <button type="button" className="qz-b" disabled={!!busy} onClick={() => void takeCode()}>
                      {busy === 'code' ? <Loader2 className="qs-spin" /> : <Download aria-hidden="true" />}Download ZIP
                    </button>
                  </div>
                </section>
              </div>
              <button type="button" className="qz-b qs-again" onClick={reset}><RotateCcw aria-hidden="true" />Scan another store</button>
            </article>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
