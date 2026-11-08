import Link from 'next/link'
import { BinaryStrip, GiantWordmark, InView, Logo, ParticleZone, Todo } from '@ad/ui'
import { company, contact, legalPages } from '@/content/assetra/site'
import { productLinks, quanteHome } from '@/content/assetra/modules'

// Every Quante product with its highlight (content/assetra/modules.ts); the pages are on quantecode.com.
const products = [
  { label: 'Quante', href: quanteHome() } as { label: string; href: string; badge?: string; dev?: boolean },
  ...productLinks().map((p) => ({ label: p.name, href: p.href, badge: p.badge, dev: p.dev })),
]

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
            <div><dt>Kontakt</dt><dd>{company.person}</dd></div>
            <div><dt>Adresa</dt><dd>{company.seat ?? <Todo>[adresa]</Todo>}</dd></div>
            <div><dt>E-mail</dt><dd>{contact.email ? <a href={'mailto:' + contact.email}>{contact.email}</a> : <Todo>[e-mail]</Todo>}</dd></div>
          </dl>
          <nav className="ftl ftp" aria-labelledby="ft-produkty">
            <p className="ftk" id="ft-produkty">Produkty</p>
            {products.map((p) => (
              <Link key={p.href} href={p.href}>
                {p.label}
                {p.badge && <span className={'ftn' + (p.dev ? ' ftn-dev' : '')}>{p.badge}</span>}
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
