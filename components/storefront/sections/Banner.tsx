import type { BannerProps } from '@/types/manifest'

interface Props {
  props: BannerProps
  basePath?: string
}

function prefixHref(href: string | undefined, basePath: string): string | undefined {
  if (!href || !basePath) return href
  if (href.startsWith('http') || href.startsWith('#')) return href
  return `${basePath}${href.startsWith('/') ? href : `/${href}`}`
}

export function Banner({ props, basePath = '' }: Props) {
  const { text, ctaLabel } = props
  const ctaHref = prefixHref(props.ctaHref, basePath)

  return (
    <div
      style={{
        background: 'var(--s-accent)',
        color: 'var(--s-accent-text)',
        padding: '0.875rem 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.25rem',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontSize: '0.875rem',
          fontWeight: 500,
          fontFamily: 'var(--s-font-body)',
        }}
      >
        {text}
      </p>
      {ctaLabel && ctaHref && (
        <a
          href={ctaHref}
          style={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: 'var(--s-accent-text)',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            fontFamily: 'var(--s-font-body)',
          }}
        >
          {ctaLabel}
        </a>
      )}
    </div>
  )
}
