import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CREDIT_PACKS } from '@/lib/stripe'

export const metadata = {
  title: 'Pricing — Quante',
  description: 'Simple, credit-based pricing. Start with 25 free credits.',
}

export default function PricingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
      <header className="border-b border-border px-6 py-0 sticky top-0 z-50 bg-background/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto h-14 flex items-center justify-between">
          <Link href="/" className="font-mono text-sm font-semibold tracking-tight">quante</Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Log in</Link>
            <Link href="/signup" className={cn(buttonVariants({ size: 'sm' }))}>Get started →</Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto px-6 py-20 w-full">

        {/* Header */}
        <div className="text-center mb-14">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-4">Pricing</p>
          <h1 className="text-4xl font-bold tracking-tight mb-4">Simple, credit-based</h1>
          <p className="text-muted-foreground max-w-md mx-auto leading-relaxed">
            Buy credits when you need them. No subscriptions, no per-seat fees.
            Every new account gets <strong className="text-foreground">25 free credits</strong> — no card required.
          </p>
        </div>

        {/* Credit packs */}
        <div className="grid md:grid-cols-3 gap-4 mb-16">
          {CREDIT_PACKS.map((pack) => (
            <div
              key={pack.id}
              className={cn(
                'rounded-lg border px-5 py-6 flex flex-col gap-3 relative',
                pack.popular ? 'border-white/20 bg-secondary' : 'border-border'
              )}
            >
              {pack.popular && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-wider">
                  Most popular
                </span>
              )}
              <div>
                <p className="text-3xl font-bold font-mono">{pack.priceDisplay}</p>
                <p className="text-sm font-semibold mt-1">{pack.label}</p>
              </div>
              <p className="text-sm text-muted-foreground flex-1">{pack.description}</p>
              <p className="text-xs text-muted-foreground font-mono">{pack.perCreditDisplay}</p>
              <Link
                href="/signup"
                className={cn(
                  buttonVariants({ size: 'sm' }),
                  'mt-1 w-full justify-center',
                  !pack.popular && 'bg-secondary text-foreground border border-border hover:bg-secondary/80'
                )}
              >
                Get started
              </Link>
            </div>
          ))}
        </div>

        {/* Cost table */}
        <div className="mb-16">
          <h2 className="text-sm font-semibold mb-4">What each action costs</h2>
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {[
              { action: 'Full generation', cost: '10 credits', note: 'Complete store from a brief' },
              { action: 'Iteration / patch', cost: '1 credit', note: 'Any chat instruction' },
              { action: 'Regenerate section', cost: '2 credits', note: 'Improve one section in isolation' },
              { action: 'Custom component', cost: '3 credits', note: 'Bespoke section via escape hatch' },
              { action: 'Export ZIP', cost: '5 credits', note: 'Download runnable project' },
              { action: 'Welcome grant', cost: '+25 free', note: 'Credited on account creation' },
            ].map(({ action, cost, note }) => (
              <div key={action} className="flex items-center justify-between px-4 py-3 text-sm gap-4">
                <div>
                  <span className="font-medium">{action}</span>
                  <span className="text-xs text-muted-foreground ml-2">{note}</span>
                </div>
                <span className="font-mono text-xs shrink-0">{cost}</span>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-16">
          <h2 className="text-sm font-semibold mb-6">Common questions</h2>
          <div className="space-y-6">
            {[
              {
                q: 'Do credits expire?',
                a: 'No. Credits never expire. Buy once and use whenever you need them.',
              },
              {
                q: 'What happens if a generation fails?',
                a: 'Credits are only debited on success. If Quante produces an invalid manifest and cannot auto-repair it, no credits are charged.',
              },
              {
                q: 'Can I export the same store more than once?',
                a: 'Yes — each export costs 5 credits. You can export after any iteration to get the latest version.',
              },
              {
                q: 'Can I deploy to Vercel for free?',
                a: 'Yes. The exported ZIP is a standard Next.js project. Vercel\'s Hobby plan is free and handles it perfectly.',
              },
            ].map(({ q, a }) => (
              <div key={q}>
                <p className="text-sm font-medium mb-1.5">{q}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="rounded-lg border border-border bg-secondary/40 px-6 py-8 text-center flex flex-col items-center gap-4">
          <p className="font-semibold">Start building for free</p>
          <p className="text-sm text-muted-foreground">25 credits included. No card required.</p>
          <Link href="/signup" className={cn(buttonVariants())}>Create an account →</Link>
        </div>
      </main>

      <footer className="border-t border-border px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-mono text-xs text-muted-foreground">quante</Link>
          <p className="text-xs text-muted-foreground">© 2026 Quante</p>
        </div>
      </footer>
    </div>
  )
}
