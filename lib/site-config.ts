// Central site identity, navigation and operator config.
// Edit this file to update identity across all pages, footer and legal pages.
// Every string starting with `TODO(michal):` is treated as unset and
// gracefully omitted from the rendered footer (see components/SiteFooter.tsx).

// Legal entity. Quante is a product, not a company (owner, 2026-10-28):
// the operator of the Quante platform is AssetraDigital s.r.o., the same
// company as the AssetraDigital website, so the name comes from that site's
// company data (`content/assetra/site.ts`). The address / IČO / DIČ /
// contact fields stay as TODO(michal) placeholders until the company data
// is known — `isFilled()` drops any field that still has one, so an
// unfilled block never leaks a placeholder to the public site.
import { siteHref } from '@/lib/domains'
import { company } from '@/content/assetra/site'

const companyName  = company.name
const founderName  = 'Michal Svoboda'
const founderRole  = 'Founder'
const address      = company.seat ?? 'TODO(michal): registered company address'
const ico          = company.ico ?? 'TODO(michal): Czech company ID (IČO)'
const dic          = 'TODO(michal): VAT ID (DIČ) — or leave TODO if not VAT-registered'
const contactEmail = 'TODO(michal): public contact email'

/** How Quante names its maker wherever a company would otherwise appear. */
const productOf    = `Quante is a product of ${companyName}`

export const operator = {
  companyName, founderName, founderRole, productOf,
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

/** False for an unset operator field (`TODO(michal):` or the older "[TO FILL IN]"). */
export function isFilled(v: string | undefined | null): v is string {
  return !!v && !v.startsWith('TODO(michal)') && !v.includes('[TO')
}

/** "AssetraDigital s.r.o., <address>" — only the fields that are filled in. */
export function operatorIdentity(): string {
  return [operator.companyName, operator.address].filter(isFilled).join(', ')
}

export const domainProvider = {
  name: 'Namecheap',
  note: 'Reseller API — adjust this name if a different registrar is used in production',
} as const

// Social links — add entries to show social icons in the footer.
// Keep empty to render no social row at all.
export const socialLinks: Array<{ label: string; href: string }> = []

/** Website links are absolute in production — the website lives on its own host (lib/domains.ts). */
export const footerNav = {
  product: [
    { label: 'Quante',     href: siteHref('/quante') },
    { label: 'Pricing',    href: siteHref('/quante#cenik') },
    { label: 'Changelog',  href: '/changelog' },
    { label: 'Qads',       href: '/qads', badge: 'New' as const },
    { label: 'Qscan',      href: '/qscan', badge: 'New' as const },
  ],
  company: [
    { label: 'AssetraDigital', href: siteHref('/') },
    { label: 'Contact',         href: siteHref('/#kontakt') },
  ],
  legal: [
    { label: 'Terms of Service', href: '/terms' },
    { label: 'Privacy Policy',   href: '/privacy' },
    { label: 'Cookie Policy',    href: '/cookies' },
    { label: 'Refund Policy',    href: '/refund' },
  ],
} as const
