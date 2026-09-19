// Central site identity, navigation and operator config.
// Edit this file to update identity across all pages, footer and legal pages.
// Every string starting with `TODO(michal):` is treated as unset and
// gracefully omitted from the rendered footer (see components/SiteFooter.tsx).

// Legal entity per audit brief 2.6. Company name is intentionally hard-
// coded (QuanteCode s.r.o. is the name we want in the footer and on the
// legal pages); the address / IČO / DIČ / contact fields stay as
// TODO(michal) placeholders — the footer renderer detects the
// "TODO(michal)" prefix and omits any field that still has one, so an
// unfilled block never leaks a placeholder to the public site.
const companyName  = 'QuanteCode s.r.o.'
const founderName  = 'Michal Svoboda'
const founderRole  = 'Founder'
const address      = 'TODO(michal): registered company address'
const ico          = 'TODO(michal): Czech company ID (IČO)'
const dic          = 'TODO(michal): VAT ID (DIČ) — or leave TODO if not VAT-registered'
const contactEmail = 'TODO(michal): public contact email'

export const operator = {
  companyName, founderName, founderRole,
  address, ico, dic, contactEmail,
  // ── Legacy aliases ──────────────────────────────────────────────────
  // The audit brief 2.6 asked for a company block replacing the private-
  // person block, but it also mandates that Terms / Privacy / Refund /
  // Cookies pages are left untouched. Those pages read `operator.name`
  // and `operator.role`. `name` therefore maps to the LEGAL ENTITY
  // (which is now the company — the actual operator of the service, so
  // the substitution is semantically correct in every legal-page call
  // site: "operated by X", "the exclusive property of X", etc.), and
  // `role` collapses the founder line into one string for backwards
  // compat with the "{name} · {role}" pattern the impressum blocks use.
  name: companyName,
  role: `${founderRole}: ${founderName}`,
}

export const domainProvider = {
  name: 'Namecheap',
  note: 'Reseller API — adjust this name if a different registrar is used in production',
} as const

// Social links — add entries to show social icons in the footer.
// Keep empty to render no social row at all.
export const socialLinks: Array<{ label: string; href: string }> = []

export const footerNav = {
  product: [
    { label: 'Pricing',    href: '/pricing' },
    { label: 'Showcase',   href: '/showcase' },
    { label: 'Domains',    href: '/domains' },
    { label: 'Changelog',  href: '/changelog' },
    { label: 'Roadmap',    href: '/about#roadmap' },
    { label: 'Qads',       href: '/qads', badge: 'New' as const },
    { label: 'API',        href: '/api', badge: 'Soon' as const },
  ],
  company: [
    { label: 'About',   href: '/about' },
    { label: 'Contact', href: '/contact' },
  ],
  legal: [
    { label: 'Terms of Service', href: '/terms' },
    { label: 'Privacy Policy',   href: '/privacy' },
    { label: 'Cookie Policy',    href: '/cookies' },
    { label: 'Refund Policy',    href: '/refund' },
  ],
} as const
