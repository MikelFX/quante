import type { ShopManifest } from '@/types/manifest'

interface Props {
  manifest: ShopManifest
}

export function StoreNavbar({ manifest }: Props) {
  return (
    <header
      style={{
        borderBottom: '1px solid var(--s-border)',
        background: 'var(--s-bg)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: '80rem',
          margin: '0 auto',
          padding: '0 2rem',
          height: '3.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: 'var(--s-font-heading)',
            fontWeight: 700,
            fontSize: '1.1rem',
            color: 'var(--s-text)',
            textDecoration: 'none',
            letterSpacing: '0.04em',
          }}
        >
          {manifest.brand.logoText}
        </a>

        <nav style={{ display: 'flex', gap: '2rem' }}>
          {manifest.nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              style={{
                color: 'var(--s-muted)',
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontWeight: 500,
                transition: 'color 0.15s',
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <a
          href="/cart"
          style={{
            color: 'var(--s-text)',
            textDecoration: 'none',
            fontSize: '0.8125rem',
            fontWeight: 500,
          }}
        >
          Cart (0)
        </a>
      </div>
    </header>
  )
}
