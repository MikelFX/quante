// Plnolet's own header and footer (its own service, no Quante chrome). Contact from site.ts only.
import Link from 'next/link'
import { company, contact } from '@/content/assetra/site'

export function PnMark() {
  return <span className="pn-mark" aria-hidden="true">18+</span>
}

export function PnTop({ links = true }: { links?: boolean }) {
  return (
    <header className="pn-top">
      <Link href="/plnolet" className="pn-brand"><PnMark />Plnolet</Link>
      {links && (
        <nav className="pn-nav" aria-label="Plnolet">
          <a href="/plnolet#jak">Jak to funguje</a>
          <a href="/plnolet#cenik">Ceník</a>
          <a href="/plnolet#api">API</a>
          <Link href="/plnolet/ucet">Účet</Link>
        </nav>
      )}
    </header>
  )
}

export function PnFoot() {
  return (
    <footer className="pn-foot">
      <div>
        <span>Plnolet je služba {company.name}.</span>
        {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
      </div>
    </footer>
  )
}
