import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { getUserRecord } from '@/lib/tier'
import { CREDIT_PACKS, isStripeConfigured } from '@/lib/stripe'
import { AGENCY_MONTHLY_USD } from '@/lib/config'
import { PurchaseButtons } from './PurchaseButtons'
import { AgencyPortalButton } from './AgencyPortalButton'

interface LedgerEntry {
  id: string
  delta: number
  reason: string
  balance_after: number
  created_at: string
}

const REASON_LABELS: Record<string, string> = {
  welcome_grant:  'Welcome grant',
  generate:       'Generate store',
  iterate:        'Iterate',
  section:        'Regenerate section',
  export:         'Export',
  purchase:       'Purchase',
  refund:         'Refund',
}

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function buildSparkline(history: LedgerEntry[]): number[] {
  const days: Record<string, number> = {}
  const now = Date.now()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86400000)
    days[d.toISOString().slice(0, 10)] = 0
  }
  for (const e of history) {
    if (e.delta < 0) {
      const day = e.created_at.slice(0, 10)
      if (day in days) days[day] += Math.abs(e.delta)
    }
  }
  return Object.values(days)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Props {
  searchParams: Promise<{ success?: string; cancelled?: string; credits?: string; agency_success?: string }>
}

export default async function BillingPage({ searchParams }: Props) {
  const params = await searchParams
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createClient()
  const record = await getUserRecord(userId)
  const isAgency = record.tier === 'agency' && record.subscription_status === 'active'
  const stripeReady = isStripeConfigured()

  // Project count for agency
  const { count: projectCount } = isAgency
    ? await supabase.from('projects').select('*', { count: 'exact', head: true })
        .eq('user_id', userId).neq('status', 'archived')
    : { count: 0 }

  // ── Agency view ─────────────────────────────────────────────────────────────
  if (isAgency) {
    const statusColors: Record<string, string> = {
      active: '#3ecf8e',
      past_due: '#e0a04f',
      canceled: '#8a8a93',
      trialing: '#6f78e6',
    }
    const statusColor = statusColors[record.subscription_status ?? ''] ?? '#8a8a93'

    return (
      <div style={{ padding: '2rem 1.5rem 3rem', maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Page header */}
        <div style={{ marginBottom: 4 }}>
          <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#5b5b64', margin: '0 0 8px' }}>billing</p>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#f4f4f6', margin: 0 }}>Credits & Billing</h1>
        </div>

        {params.agency_success && (
          <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(62,207,142,.3)', background: 'rgba(62,207,142,.07)', fontSize: 13, color: '#3ecf8e' }}>
            Agency plan activated — unlimited generations and exports are now available.
          </div>
        )}

        {/* Subscription card */}
        <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,.07)', background: '#0c0c10', boxShadow: '0 0 60px rgba(79,91,213,.08)', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '.07em',
                  padding: '2px 8px', borderRadius: 99,
                  background: 'rgba(62,207,142,.12)',
                  color: '#3ecf8e', border: '1px solid rgba(62,207,142,.25)',
                }}>
                  Agency
                </span>
                <span style={{
                  fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '.06em',
                  color: statusColor,
                }}>
                  {record.subscription_status ?? 'unknown'}
                </span>
              </div>
              <p style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', letterSpacing: '-.03em', color: '#f4f4f6', margin: 0 }}>
                ${AGENCY_MONTHLY_USD}
                <span style={{ fontSize: 14, fontWeight: 400, color: '#8a8a93', marginLeft: 4 }}>/month</span>
              </p>
            </div>
            <AgencyPortalButton stripeReady={stripeReady} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '10px 14px' }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 4px' }}>
                Next billing
              </p>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#f4f4f6', margin: 0 }}>
                {formatDate(record.current_period_end)}
              </p>
            </div>
            <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '10px 14px' }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 4px' }}>
                Active stores
              </p>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#f4f4f6', margin: 0 }}>
                {projectCount ?? 0} / {record.project_limit} batch slots
              </p>
            </div>
          </div>
        </div>

        {/* Features */}
        <section>
          <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#5b5b64', marginBottom: 12 }}>
            What{"'"}s included
          </p>
          <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', overflow: 'hidden' }}>
            {[
              ['Batch-generate & export up to 20 stores at once', '✓'],
              ['Unlimited generations', '✓'],
              ['Unlimited iterations', '✓'],
              ['Full ZIP export — white-label, no branding', '✓'],
              ['Priority generation queue', '✓'],
            ].map(([feature, check], i, arr) => (
              <div key={feature} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none' }}>
                <span style={{ fontSize: 13, color: '#f4f4f6' }}>{feature}</span>
                <span style={{ fontSize: 13, color: '#3ecf8e', fontFamily: 'var(--font-geist-mono)' }}>{check}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Custom plan */}
        {(projectCount ?? 0) >= record.project_limit && (
          <div style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(224,160,79,.2)', background: 'rgba(224,160,79,.05)' }}>
            <p style={{ fontSize: 13, color: '#e0a04f', margin: '0 0 4px' }}>
              You{"'"}ve reached the Agency batch limit (20 simultaneous stores).
            </p>
            <a href="mailto:support@quante.io" style={{ fontSize: 13, color: '#e0a04f', fontWeight: 600 }}>
              Contact us for a custom enterprise plan →
            </a>
          </div>
        )}
      </div>
    )
  }

  // ── Credit / Free view ───────────────────────────────────────────────────────
  const [balanceResult, historyResult] = await Promise.all([
    supabase
      .from('credit_ledger')
      .select('balance_after')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('credit_ledger')
      .select('id, delta, reason, balance_after, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const balance = balanceResult.data?.balance_after ?? 0
  const history = (historyResult.data ?? []) as LedgerEntry[]
  const sparkline = buildSparkline(history)
  const sparkMax = Math.max(...sparkline, 1)
  const totalUsed = history.filter(e => e.delta < 0).reduce((s, e) => s + Math.abs(e.delta), 0)
  const isLow = balance < 10

  return (
    <div style={{ padding: '2rem 1.5rem 3rem', maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Page header */}
      <div style={{ marginBottom: 4 }}>
        <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#5b5b64', margin: '0 0 8px' }}>billing</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#f4f4f6', margin: 0 }}>Credits & Billing</h1>
      </div>

      {/* Notifications */}
      {params.success && (
        <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(62,207,142,.3)', background: 'rgba(62,207,142,.07)', fontSize: 13, color: '#3ecf8e' }}>
          Payment confirmed — {params.credits} credits added to your account.
        </div>
      )}
      {params.cancelled && (
        <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.03)', fontSize: 13, color: '#8a8a93' }}>
          Payment cancelled. No credits were charged.
        </div>
      )}

      {/* Balance hero */}
      <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,.07)', background: '#0c0c10', boxShadow: '0 0 60px rgba(79,91,213,.08)', padding: '20px 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: isLow ? '#e0a04f' : '#6f78e6', boxShadow: isLow ? '0 0 8px rgba(224,160,79,.6)' : '0 0 8px rgba(111,120,230,.6)', flexShrink: 0, animation: 'dot-pulse 2.4s ease-in-out infinite' }} />
            <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#8a8a93', margin: 0 }}>
              Credit balance
            </p>
          </div>
          <div style={{ textShadow: '0 0 40px rgba(111,120,230,.4)' }}>
            <p style={{ fontSize: 64, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', letterSpacing: '-.04em', color: '#f4f4f6', lineHeight: 1, margin: '0 0 6px' }}>
              {balance}
            </p>
          </div>
          <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>credits remaining</p>
          {isLow && (
            <p style={{ fontSize: 11, color: '#e0a04f', marginTop: 8, margin: '8px 0 0' }}>Low balance — top up to keep building.</p>
          )}
        </div>

        {/* Sparkline */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.06em', margin: 0 }}>
            {totalUsed > 0 ? `−${totalUsed} used` : 'no usage yet'}
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 36 }}>
            {sparkline.map((val, i) => (
              <div
                key={i}
                style={{
                  width: 8, borderRadius: 3,
                  height: val === 0 ? 4 : Math.max(4, Math.round((val / sparkMax) * 36)),
                  background: val === 0 ? 'rgba(255,255,255,.07)' : 'rgba(111,120,230,.55)',
                  transition: 'height 0.3s',
                }}
              />
            ))}
          </div>
          <p style={{ fontSize: 10, color: '#5b5b64', margin: 0 }}>7-day usage</p>
        </div>
      </div>

      {/* Agency upsell */}
      <div style={{ borderRadius: 12, border: '1px solid rgba(62,207,142,.15)', background: 'rgba(62,207,142,.04)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', margin: '0 0 3px' }}>Agency plan — ${AGENCY_MONTHLY_USD}/month</p>
          <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>Generate &amp; export up to 20 stores at once · unlimited projects · white-label ZIP export</p>
        </div>
        <a href="/pricing#agency" style={{ fontSize: 12, fontWeight: 600, textDecoration: 'none', color: '#3ecf8e', padding: '6px 14px', borderRadius: 7, border: '1px solid rgba(62,207,142,.3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          See Agency plan →
        </a>
      </div>

      {/* Credit packs */}
      <section style={{ paddingTop: 4 }}>
        <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#5b5b64', marginBottom: 16 }}>Buy credits</p>
        {!stripeReady && (
          <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 7, border: '1px solid rgba(224,160,79,.2)', background: 'rgba(224,160,79,.05)', fontSize: 12, color: '#e0a04f' }}>
            Stripe not configured — add <code style={{ fontFamily: 'var(--font-geist-mono)', background: 'rgba(255,255,255,.07)', padding: '1px 5px', borderRadius: 3 }}>STRIPE_SECRET_KEY</code> to enable purchases.
          </div>
        )}
        <PurchaseButtons packs={CREDIT_PACKS} stripeReady={stripeReady} />
      </section>

      {/* What costs what */}
      <section>
        <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#5b5b64', marginBottom: 12 }}>What costs what</p>
        <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', overflow: 'hidden' }}>
          {[
            ['Full generation', '10 cr'],
            ['Iteration / patch', '1 cr'],
            ['Regenerate section', '2 cr'],
            ['Custom component', '3 cr'],
            ['Export ZIP', '5 cr'],
            ['Welcome grant', '+25 cr free'],
          ].map(([action, cost], i, arr) => (
            <div key={action} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none' }}>
              <span style={{ fontSize: 13, color: '#f4f4f6' }}>{action}</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: cost.startsWith('+') ? '#3ecf8e' : '#8a8a93' }}>{cost}</span>
            </div>
          ))}
        </div>
      </section>

      {/* History */}
      <section>
        <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#5b5b64', marginBottom: 12 }}>History</p>
        {history.length === 0 ? (
          <div style={{ borderRadius: 10, border: '1px dashed rgba(255,255,255,.09)', padding: '2rem', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#8a8a93', margin: 0 }}>No transactions yet.</p>
          </div>
        ) : (
          <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 12, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.02)' }}>
              {['Action', 'Amount', 'Balance', 'When'].map((h, i) => (
                <p key={h} style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#5b5b64', margin: 0, textAlign: i > 0 ? 'right' : 'left' }}>{h}</p>
              ))}
            </div>
            {history.slice(0, 25).map((entry, idx) => (
              <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 12, padding: '10px 16px', borderBottom: idx < Math.min(history.length, 25) - 1 ? '1px solid rgba(255,255,255,.04)' : 'none', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#f4f4f6' }}>{REASON_LABELS[entry.reason] ?? entry.reason}</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono)', color: entry.delta > 0 ? '#3ecf8e' : '#8a8a93', textAlign: 'right' }}>
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                </span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textAlign: 'right' }}>{entry.balance_after}</span>
                <span style={{ fontSize: 11, color: '#5b5b64', textAlign: 'right', whiteSpace: 'nowrap' }}>{timeAgo(entry.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
