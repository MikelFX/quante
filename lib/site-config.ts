// Central site identity, navigation, and operator config.
// Edit this file to update identity across all pages, footer, and legal pages.
// Fields marked [TO FILL IN] will be gracefully omitted from public UI until set.

export const operator: {
  name: string
  role: string
  address: string
  ico: string          // [TO FILL IN] — Czech business registration number (IČO)
  dic: string          // [TO FILL IN IF VAT REGISTERED] — VAT number (DIČ)
  contactEmail: string // [TO FILL IN — e.g. hello@quantecode.com]
} = {
  name: 'Michal Svoboda',
  role: 'Founder & Developer of Quante',
  address: 'Švermova 441/12, 273 43 Buštěhrad, Czech Republic',
  ico: '',
  dic: '',
  contactEmail: '',
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
