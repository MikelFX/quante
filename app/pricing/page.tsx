import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CREDIT_PACKS } from '@/lib/stripe'

export const metadata = {
  title: 'Pricing — Quante',
  description: 'No subscription. Get 25 free credits when you sign up.',
}

export default function PricingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
      <header className="border-b border-border px-4 sticky top-0 z-50 bg-background/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto h-14 flex items-center justify-between">
          <Link href="/" className="font-mono text-sm font-semibold tracking-tight">quante</Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Log in</Link>
            <Link href="/signup" className={cn(buttonVariants({ size: 'sm' }))}>Try free →</Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto px-4 py-12 w-full">

        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-4">Pricing</p>
          <h1 className="text-3xl font-bold tracking-tight mb-4">Pay only when you create</h1>
          <p className="text-muted-foreground max-w-md mx-auto leading-relaxed">
            No monthly fee. No surprises. Buy credits when you need them —
            and get <strong className="text-foreground">25 for free</strong> when you sign up, no card required.
          </p>
        </div>

        {/* Credit packs */}
        <div className="grid sm:grid-cols-3 gap-4 mb-14">
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
        <div className="mb-14">
          <h2 className="text-sm font-semibold mb-4">What each action costs</h2>
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {[
              { action: 'Build a store from scratch', cost: '10 credits' },
              { action: 'Make a change in chat', cost: '1 credit' },
              { action: 'Redo one section', cost: '2 credits' },
              { action: 'Add a custom component', cost: '3 credits' },
              { action: 'Download your store', cost: '5 credits' },
              { action: 'Sign-up bonus', cost: '+25 free' },
            ].map(({ action, cost }) => (
              <div key={action} className="flex items-center justify-between px-4 py-3 text-sm gap-4">
                <span className="font-medium">{action}</span>
                <span className="font-mono text-xs shrink-0 text-muted-foreground">{cost}</span>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-14">
          <h2 className="text-sm font-semibold mb-6">Common questions</h2>
          <div className="space-y-6">
            {[
              {
                q: 'Do credits expire?',
                a: 'No. Credits never expire. Buy once and use them whenever you feel like it.',
              },
              {
                q: 'What if something goes wrong during generation?',
                a: "Credits are only taken on success. If the generation fails and we can't fix it automatically, nothing is charged.",
              },
              {
                q: 'Can I export the same store more than once?',
                a: 'Yes — each export costs 5 credits. Useful when you want to grab the latest version after iterating.',
              },
              {
                q: 'Can I deploy to Vercel for free?',
                a: "Yes. The downloaded ZIP is a standard Next.js project. Vercel's free Hobby plan handles it perfectly.",
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
          <p className="font-semibold">Give it a try</p>
          <p className="text-sm text-muted-foreground">25 free credits included. No card needed.</p>
          <Link href="/signup" className={cn(buttonVariants())}>Start for free →</Link>
        </div>
      </main>

      <footer className="border-t border-border px-4 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-mono text-xs text-muted-foreground">quante</Link>
          <p className="text-xs text-muted-foreground">© 2026 Quante</p>
        </div>
      </footer>
    </div>
  )
}
