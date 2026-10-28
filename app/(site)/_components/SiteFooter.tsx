import Link from 'next/link'
import { BinaryStrip, GiantWordmark, InView, Logo, ParticleZone, Todo } from '@ad/ui'
import { company, legalPages } from '@/content/assetra/site'

// The same products as the Quante footer (components/SiteFooter.tsx), with its "New" badges;
// Qails is still in development (content/assetra/modules.ts).
const products = [
  { label: 'Quante', href: '/quante' },
  { label: 'Qads', href: '/quante/qads', badge: 'New' },
  { label: 'Qgent', href: '/quante/qgent' },
  { label: 'Qscan', href: '/quante/qscan', badge: 'New' },
  { label: 'Qdit', href: '/quante/qdit' },
  { label: 'Qails', href: '/quante/qails', badge: 'Ve vývoji', dev: true },
] as const

export function SiteFooter() {
  return (
    <InView as="footer" className="ft" id="paticka">
      <div className="w">
        <div className="ftg">
          <div>
            <Logo href="#top" label="Assetra Digital, nahoru" />
            <p>{company.name}</p>
          </div>
          <dl className="ftd">
            <div><dt>IČO</dt><dd>{company.ico ?? <Todo>[IČO]</Todo>}</dd></div>
            <div><dt>Sídlo</dt><dd>{company.seat ?? <Todo>[sídlo]</Todo>}</dd></div>
            <div><dt>Zápis</dt><dd>{company.registry ?? <Todo>[obchodní rejstřík]</Todo>}</dd></div>
          </dl>
          <nav className="ftl ftp" aria-labelledby="ft-produkty">
            <p className="ftk" id="ft-produkty">Produkty</p>
            {products.map((p) => (
              <Link key={p.href} href={p.href}>
                {p.label}
                {'badge' in p && <span className={'ftn' + ('dev' in p ? ' ftn-dev' : '')}>{p.badge}</span>}
              </Link>
            ))}
          </nav>
          <nav className="ftl" aria-labelledby="ft-dokumenty">
            <p className="ftk" id="ft-dokumenty">Dokumenty</p>
            {legalPages.map((p) => <Link key={p.slug} href={'/' + p.slug}>{p.title}</Link>)}
          </nav>
        </div>
      </div>
      <div className="w">
        <ParticleZone className="pz-f" shapes={['@logo', '@sphere']} />
      </div>
      <BinaryStrip text="AI/SOFTWARE/CRM/WEB/E-SHOP/" />
      <GiantWordmark />
      <div className="w ftb">
        <span>© 2026 {company.name}</span>
        <a href="#top">Nahoru ↑</a>
      </div>
    </InView>
  )
}
