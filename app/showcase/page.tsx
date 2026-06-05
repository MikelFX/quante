import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const metadata = {
  title: 'Showcase — Quante',
  description: 'See what Quante builds. Production-ready Next.js storefronts, generated from a brief.',
}

const STORE_TYPES = [
  {
    category: 'Skincare',
    name: 'Minimal skincare ritual',
    voice: 'Clean · editorial · warm neutral palette',
    demo: true,
  },
  {
    category: 'Fashion',
    name: 'Sustainable streetwear',
    voice: 'Bold · playful · high contrast',
    demo: false,
  },
  {
    category: 'Homeware',
    name: 'Artisan ceramics studio',
    voice: 'Earthy · spacious · editorial',
    demo: false,
  },
  {
    category: 'Tech',
    name: 'Developer tools & SaaS',
    voice: 'Technical · minimal · mono accents',
    demo: false,
  },
  {
    category: 'Food',
    name: 'Specialty coffee roastery',
    voice: 'Warm · rich · strong CTA focus',
    demo: false,
  },
  {
    category: 'Wellness',
    name: 'Yoga studio & apparel',
    voice: 'Soft · playful · pastel palette',
    demo: false,
  },
]

export default function ShowcasePage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
      <header className="border-b border-border sticky top-0 z-50 bg-background/90 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-mono text-sm font-semibold tracking-tight">quante</Link>
          <div className="flex items-center gap-3">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Log in</Link>
            <Link href="/signup" className={cn(buttonVariants({ size: 'sm' }))}>Get started →</Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Header */}
        <div className="border-b border-border px-6 py-16 text-center">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-4">Showcase</p>
          <h1 className="text-4xl font-bold tracking-tight mb-4">Stores built with Quante</h1>
          <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Each store below was generated from a one-paragraph brief. Complete, styled,
            and ready to deploy — no manual design work.
          </p>
        </div>

        {/* Live demo */}
        <section className="border-b border-border">
          <div className="max-w-6xl mx-auto px-6 py-12">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Live demo</span>
                  <span className="flex items-center gap-1 text-xs text-green-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                    interactive
                  </span>
                </div>
                <h2 className="text-lg font-semibold">Aura Skincare</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Minimal skincare brand · Warm neutral palette · Playfair Display + DM Sans
                </p>
              </div>
              <Link
                href="/preview/demo"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
              >
                Open full screen ↗
              </Link>
            </div>

            {/* iframe preview */}
            <div
              className="rounded-lg overflow-hidden border border-border bg-[#FAFAF8]"
              style={{ height: '600px' }}
            >
              <iframe
                src="/preview/demo"
                className="w-full h-full border-none"
                title="Aura Skincare — Quante demo store"
                loading="lazy"
              />
            </div>

            <p className="text-xs text-muted-foreground mt-3">
              Generated from brief: <em>&ldquo;A minimal skincare brand. EUR currency. Products: serum, moisturiser, cleanser, night oil. Clean editorial vibe, warm neutral palette.&rdquo;</em>
            </p>
          </div>
        </section>

        {/* Store type grid */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="text-sm font-semibold mb-2">What Quante can build</h2>
          <p className="text-sm text-muted-foreground mb-8">
            Quante adapts its design and copy to the brief. Here are a few store archetypes — each would take under 30 seconds to generate.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {STORE_TYPES.map((store) => (
              <div
                key={store.name}
                className={cn(
                  'rounded-lg border border-border px-4 py-4 flex flex-col gap-2',
                  store.demo && 'border-white/20 bg-secondary/50'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">{store.category}</span>
                  {store.demo && (
                    <span className="text-xs text-green-400 font-mono">live above ↑</span>
                  )}
                </div>
                <p className="text-sm font-medium">{store.name}</p>
                <p className="text-xs text-muted-foreground">{store.voice}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border py-20 px-6">
          <div className="max-w-lg mx-auto text-center flex flex-col items-center gap-5">
            <h2 className="text-2xl font-bold tracking-tight">Build yours in minutes</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              25 free credits on signup. Describe your brand — Quante does the rest.
            </p>
            <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
              Start for free →
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-mono text-xs text-muted-foreground">quante</Link>
          <p className="text-xs text-muted-foreground">© 2026 Quante</p>
        </div>
      </footer>
    </div>
  )
}
