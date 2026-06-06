import type { ShopManifest } from '@/types/manifest'

const SOCIAL_LABELS: Record<string, string> = {
  twitter: 'Twitter',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
}

interface Props {
  manifest: ShopManifest
  basePath?: string
}

export function StoreFooter({ manifest, basePath = '' }: Props) {
  const { footer, brand } = manifest
  const colCount = footer.columns.length + 1

  return (
    <footer
      style={{
        borderTop: '1px solid var(--s-border)',
        background: 'var(--s-surface)',
        color: 'var(--s-text)',
        fontFamily: 'var(--s-font-body)',
      }}
    >
      <div
        style={{
          maxWidth: '80rem',
          margin: '0 auto',
          padding: `calc(4rem * var(--s-space)) 2rem calc(3rem * var(--s-space))`,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${colCount}, 1fr)`,
            gap: '3rem',
            marginBottom: `calc(3rem * var(--s-space))`,
          }}
        >
          {/* Brand column */}
          <div>
            <a
              href={basePath || '/'}
              style={{
                fontFamily: 'var(--s-font-heading)',
                fontWeight: 700,
                fontSize: '1.1rem',
                letterSpacing: '0.04em',
                color: 'var(--s-text)',
                textDecoration: 'none',
                display: 'block',
                marginBottom: '0.75rem',
              }}
            >
              {brand.logoText}
            </a>
            <p
              style={{
                color: 'var(--s-muted)',
                fontSize: '0.875rem',
                lineHeight: 1.7,
                marginBottom: '1.25rem',
              }}
            >
              {brand.tagline}
            </p>
            {footer.socials.length > 0 && (
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                {footer.socials.map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    style={{
                      color: 'var(--s-muted)',
                      textDecoration: 'none',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                    }}
                  >
                    {SOCIAL_LABELS[s.platform] ?? s.platform}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Link columns */}
          {footer.columns.map((col) => (
            <div key={col.title}>
              <p
                style={{
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: 'var(--s-text)',
                  marginBottom: '1rem',
                }}
              >
                {col.title}
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {col.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      style={{
                        color: 'var(--s-muted)',
                        textDecoration: 'none',
                        fontSize: '0.875rem',
                        transition: 'color 0.15s',
                      }}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          style={{
            borderTop: '1px solid var(--s-border)',
            paddingTop: '1.5rem',
          }}
        >
          <p style={{ color: 'var(--s-muted)', fontSize: '0.75rem' }}>{footer.legal}</p>
        </div>
      </div>
    </footer>
  )
}
