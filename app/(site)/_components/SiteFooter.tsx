import Link from 'next/link'
import { BinaryStrip, GiantWordmark, InView, Logo, ParticleZone, Todo } from '@ad/ui'
import { company, legalPages } from '@/content/assetra/site'

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
          <nav className="ftl" aria-label="Dokumenty">
            {legalPages.map((p) => <Link key={p.slug} href={'/' + p.slug}>{p.title}</Link>)}
          </nav>
        </div>
      </div>
      <div className="w">
        <ParticleZone className="pz-f" shapes={['@logo', '@sphere']} />
      </div>
      <BinaryStrip text="HOSTING/ZALOHY/SPRAVA/VLASTNI KOD/" />
      <GiantWordmark />
      <div className="w ftb">
        <span>© 2026 {company.name}</span>
        <a href="#top">Nahoru ↑</a>
      </div>
    </InView>
  )
}
