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
  welcome_grant: 'Welcome grant',
  generate: 'Generate store',
  iterate: 'Iterate',
  section: 'Regenerate section',
  export: 'Export',
  purchase: 'Purchase',
  refund: 'Refund',
}

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
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
      .limit(25),
  ])

  const balance = balanceResult.data?.balance_after ?? 0
  const history = (historyResult.data ?? []) as LedgerEntry[]
  const stripeReady = isStripeConfigured()

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Billing</h1>

      {/* Toast-style notifications from Stripe redirect */}
      {params.success && (
        <div className="px-4 py-3 rounded border border-green-500/30 bg-green-500/10 text-sm text-green-400">
          Payment confirmed — {params.credits} credits added to your account.
        </div>
      )}
      {params.cancelled && (
        <div className="px-4 py-3 rounded border border-border text-sm text-muted-foreground">
          Payment cancelled. No credits were charged.
        </div>
      )}

      {/* Balance card */}
      <div className="rounded-lg border border-border px-5 py-5 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Credit balance</p>
          <p className="text-4xl font-bold font-mono">{balance}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">credits remaining</p>
          {balance < 10 && (
            <p className="text-xs text-amber-400 mt-1">Low balance — top up to keep building.</p>
          )}
        </div>
      </div>

      {/* Credit packs */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Buy credits</h2>
        {!stripeReady && (
          <p className="text-xs text-muted-foreground mb-3 px-1">
            Stripe is not configured — add <code className="font-mono bg-secondary px-1 rounded">STRIPE_SECRET_KEY</code> to enable purchases.
          </p>
        )}
        <PurchaseButtons packs={CREDIT_PACKS} stripeReady={stripeReady} />
      </div>

      {/* Cost table */}
      <div>
        <h2 className="text-sm font-semibold mb-3">What costs what</h2>
        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {[
            ['Full generation', '10 cr'],
            ['Iteration / patch', '1 cr'],
            ['Regenerate section', '2 cr'],
            ['Custom component', '3 cr'],
            ['Export ZIP', '5 cr'],
            ['Welcome grant', '+25 cr free'],
          ].map(([action, cost]) => (
            <div key={action} className="flex justify-between px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">{action}</span>
              <span className="font-mono text-xs">{cost}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Transaction history */}
      {history.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3">History</h2>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Action</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Amount</th>
                  <th className="hidden sm:table-cell text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Balance</th>
                  <th className="hidden sm:table-cell text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((entry) => (
                  <tr key={entry.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-2.5 text-sm">
                      {REASON_LABELS[entry.reason] ?? entry.reason}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs ${entry.delta > 0 ? 'text-green-400' : 'text-muted-foreground'}`}>
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                      {entry.balance_after}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {timeAgo(entry.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {history.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-8 text-center">
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        </div>
      )}
    </div>
  )
}
