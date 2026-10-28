'use client'

// Grideet for a new account: three clear ways to start. The only place (with loading) where
// particles appear on this page.
import Link from 'next/link'
import { ParticleZone } from '@ad/ui'

const STARTS = [
  { href: '/new', label: 'Describe a store', module: 'Generate', text: 'Tell Quante what you sell and it builds the whole store.', primary: true },
  { href: '/qscan', label: 'Import your website', module: 'Qscan', text: 'Paste the address of your current store and we rebuild it here.' },
  { href: '/qads', label: 'Make an ad', module: 'Qads', text: 'Turn a product photo into ad videos and photos.' },
] as const

export function GrideetEmpty() {
  return (
    <section className="q-card q-empty gd-empty" aria-labelledby="gd-empty-title">
      <ParticleZone shapes={['@logo', 'Q']} />
      <p id="gd-empty-title" className="gd-empty-title">Nothing here yet</p>
      <p className="gd-empty-text">Everything you make — stores, products, ads, imports — will live here, grouped by brand.</p>
      <div className="gd-starts">
        {STARTS.map((s) => (
          <Link key={s.href} href={s.href} className={`gd-start${'primary' in s ? ' gd-start-primary' : ''}`}>
            <span className="gd-start-mod">{s.module}</span>
            <span className="gd-start-label">{s.label} →</span>
            <span className="gd-start-text">{s.text}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
