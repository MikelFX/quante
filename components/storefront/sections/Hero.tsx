import type { HeroProps } from '@/types/manifest'

interface Props {
  props: HeroProps
  basePath?: string
}

function prefixHref(href: string | undefined, basePath: string): string | undefined {
  if (!href || !basePath) return href
  if (href.startsWith('http') || href.startsWith('#')) return href
  return `${basePath}${href.startsWith('/') ? href : `/${href}`}`
}

export function Hero({ props, basePath = '' }: Props) {
  const {
    headline,
    subheadline,
    ctaLabel,
    ctaHref,
    secondaryCtaLabel,
    secondaryCtaHref,
    imageSrc,
    layout,
  } = props

  const prefixed = {
    ...props,
    ctaHref: prefixHref(ctaHref, basePath),
    secondaryCtaHref: prefixHref(secondaryCtaHref, basePath),
  }

  if (layout === 'split') {
    return (
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          minHeight: '70vh',
          background: 'var(--s-bg)',
          color: 'var(--s-text)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: `calc(5rem * var(--s-space)) calc(4rem * var(--s-space))`,
          }}
        >
          <HeroContent {...prefixed} />
        </div>
        <div
          style={{
            background: imageSrc ? `url(${imageSrc}) center/cover no-repeat` : 'var(--s-surface)',
            minHeight: '400px',
          }}
        />
      </section>
    )
  }

  if (layout === 'fullbleed') {
    return (
      <section
        style={{
          minHeight: '80vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: `calc(6rem * var(--s-space)) 2rem`,
          background: imageSrc
            ? `linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.5)), url(${imageSrc}) center/cover no-repeat`
            : 'var(--s-text)',
          color: imageSrc ? '#ffffff' : 'var(--s-bg)',
        }}
      >
        <div style={{ maxWidth: '52rem' }}>
          <HeroContent {...prefixed} inverted />
        </div>
      </section>
    )
  }

  // centered (default)
  return (
    <section
      style={{
        background: 'var(--s-bg)',
        color: 'var(--s-text)',
        padding: `calc(7rem * var(--s-space)) 2rem`,
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '52rem', margin: '0 auto' }}>
        <HeroContent {...prefixed} />
      </div>
    </section>
  )
}

function HeroContent({
  headline,
  subheadline,
  ctaLabel,
  ctaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
  inverted,
}: HeroProps & { inverted?: boolean }) {
  const textColor = inverted ? 'inherit' : 'var(--s-text)'
  const mutedColor = inverted ? 'rgba(255,255,255,0.75)' : 'var(--s-muted)'

  return (
    <>
      <h1
        style={{
          fontFamily: 'var(--s-font-heading)',
          fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
          fontWeight: 700,
          lineHeight: 1.08,
          letterSpacing: '-0.025em',
          color: textColor,
          marginBottom: '1.5rem',
          whiteSpace: 'pre-line',
        }}
      >
        {headline}
      </h1>
      {subheadline && (
        <p
          style={{
            color: mutedColor,
            fontSize: '1.125rem',
            lineHeight: 1.7,
            maxWidth: '38rem',
            margin: '0 auto 2.5rem',
          }}
        >
          {subheadline}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          gap: '0.875rem',
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        <a
          href={ctaHref}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.8125rem 2rem',
            background: 'var(--s-accent)',
            color: 'var(--s-accent-text)',
            borderRadius: 'var(--s-radius)',
            fontWeight: 600,
            textDecoration: 'none',
            fontSize: '0.9375rem',
            fontFamily: 'var(--s-font-body)',
          }}
        >
          {ctaLabel}
        </a>
        {secondaryCtaLabel && secondaryCtaHref && (
          <a
            href={secondaryCtaHref}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.8125rem 2rem',
              border: `1px solid ${inverted ? 'rgba(255,255,255,0.4)' : 'var(--s-border)'}`,
              color: inverted ? 'rgba(255,255,255,0.9)' : 'var(--s-text)',
              borderRadius: 'var(--s-radius)',
              textDecoration: 'none',
              fontSize: '0.9375rem',
              fontFamily: 'var(--s-font-body)',
            }}
          >
            {secondaryCtaLabel}
          </a>
        )}
      </div>
    </>
  )
}
