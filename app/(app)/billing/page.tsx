import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { CREDIT_PACKS, isStripeConfigured } from '@/lib/stripe'
import { PurchaseButtons } from './PurchaseButtons'

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

// Build a simple 7-bar sparkline from the last 7 days of deltas
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

interface Props {
  searchParams: Promise<{ success?: string; cancelled?: string; credits?: string }>
}

export default async function BillingPage({ searchParams }: Props) {
  const params = await searchParams
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createClient()

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
  const stripeReady = isStripeConfigured()
  const sparkline = buildSparkline(history)
  const sparkMax = Math.max(...sparkline, 1)
  const totalUsed = history.filter(e => e.delta < 0).reduce((s, e) => s + Math.abs(e.delta), 0)
  const isLow = balance < 10

  return (
    <div style={{ padding: '1.5rem 1rem 3rem', maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

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
      <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,.07)', background: '#0d0d11', padding: '20px 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: isLow ? '#e0a04f' : '#6f78e6', boxShadow: isLow ? '0 0 8px rgba(224,160,79,.6)' : '0 0 8px rgba(111,120,230,.6)', flexShrink: 0, animation: 'dot-pulse 2.4s ease-in-out infinite' }} />
            <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#8a8a93', margin: 0 }}>
              Credit balance
            </p>
          </div>
          <p style={{ fontSize: 48, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', letterSpacing: '-.04em', color: '#f4f4f6', lineHeight: 1, margin: '0 0 6px' }}>
            {balance}
          </p>
          <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>credits remaining</p>
          {isLow && (
            <p style={{ fontSize: 11, color: '#e0a04f', marginTop: 8, margin: '8px 0 0' }}>Low balance — top up to keep building.</p>
          )}
        </div>

        {/* Sparkline — last 7 days usage */}
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

      {/* Credit packs */}
      <section>
        <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#5b5b64', marginBottom: 12 }}>Buy credits</p>
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
            {/* Header */}
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
