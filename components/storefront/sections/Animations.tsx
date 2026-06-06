import type { AnimationsProps, ShopManifest } from '@/types/manifest'

interface Props {
  props: AnimationsProps
  catalog?: ShopManifest['catalog']
}

export function Animations({ props, catalog }: Props) {
  const { variant, title, items, stats, productSlug } = props

  if (variant === 'marquee') {
    const marqueeItems = items && items.length > 0 ? items : ['Quality', 'Style', 'Craft', 'Design', 'Value', 'Trust']
    const doubled = [...marqueeItems, ...marqueeItems]

    return (
      <section
        style={{
          background: 'var(--s-surface)',
          borderTop: '1px solid var(--s-border)',
          borderBottom: '1px solid var(--s-border)',
          padding: '1.5rem 0',
          overflow: 'hidden',
        }}
      >
        <style>{`
          @keyframes marquee {
            from { transform: translateX(0); }
            to   { transform: translateX(-50%); }
          }
        `}</style>
        {title && (
          <p
            style={{
              textAlign: 'center',
              fontSize: '0.75rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--s-muted)',
              marginBottom: '1rem',
              fontFamily: 'var(--s-font-body)',
            }}
          >
            {title}
          </p>
        )}
        <div
          style={{
            display: 'flex',
            width: 'max-content',
            animation: 'marquee 28s linear infinite',
          }}
        >
          {doubled.map((item, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '1.5rem',
                paddingRight: '1.5rem',
                fontFamily: 'var(--s-font-heading)',
                fontSize: 'clamp(1rem, 2vw, 1.375rem)',
                fontWeight: 600,
                color: 'var(--s-text)',
                whiteSpace: 'nowrap',
              }}
            >
              {item}
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: '0.375rem',
                  height: '0.375rem',
                  borderRadius: '50%',
                  background: 'var(--s-accent)',
                  flexShrink: 0,
                }}
              />
            </span>
          ))}
        </div>
      </section>
    )
  }

  if (variant === 'stats') {
    const statItems =
      stats && stats.length > 0
        ? stats
        : [
            { value: '10k+', label: 'Happy customers' },
            { value: '99%', label: 'Satisfaction rate' },
            { value: '48h', label: 'Fast delivery' },
            { value: '5★', label: 'Average rating' },
          ]

    return (
      <section
        style={{
          background: 'var(--s-surface)',
          padding: 'calc(4rem * var(--s-space)) 2rem',
        }}
      >
        <style>{`
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(20px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
        {title && (
          <h2
            style={{
              textAlign: 'center',
              fontFamily: 'var(--s-font-heading)',
              fontSize: 'clamp(1.5rem, 3vw, 2.25rem)',
              fontWeight: 700,
              color: 'var(--s-text)',
              marginBottom: 'calc(3rem * var(--s-space))',
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </h2>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(statItems.length, 4)}, 1fr)`,
            gap: 'calc(2rem * var(--s-space))',
            maxWidth: '72rem',
            margin: '0 auto',
          }}
        >
          {statItems.map((stat, i) => (
            <div
              key={i}
              style={{
                textAlign: 'center',
                animation: `fadeInUp 0.6s ease forwards`,
                animationDelay: `${i * 0.15}s`,
                opacity: 0,
              }}
            >
              <p
                style={{
                  fontFamily: 'var(--s-font-heading)',
                  fontSize: 'clamp(2.5rem, 5vw, 3.75rem)',
                  fontWeight: 800,
                  color: 'var(--s-accent)',
                  lineHeight: 1,
                  letterSpacing: '-0.03em',
                }}
              >
                {stat.value}
              </p>
              <p
                style={{
                  fontFamily: 'var(--s-font-body)',
                  fontSize: '0.9375rem',
                  color: 'var(--s-muted)',
                  marginTop: '0.5rem',
                }}
              >
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (variant === 'spotlight') {
    const product = productSlug
      ? catalog?.products.find((p) => p.slug === productSlug)
      : catalog?.products[0]

    if (!product) {
      return (
        <section
          style={{
            background: 'var(--s-surface)',
            padding: 'calc(4rem * var(--s-space)) 2rem',
            textAlign: 'center',
          }}
        >
          <p style={{ color: 'var(--s-muted)', fontFamily: 'var(--s-font-body)' }}>
            {title ?? 'Featured product'}
          </p>
        </section>
      )
    }

    const currency = catalog?.currency ?? ''

    return (
      <section
        style={{
          background: 'var(--s-bg)',
          padding: 'calc(5rem * var(--s-space)) 2rem',
          overflow: 'hidden',
        }}
      >
        <style>{`
          @keyframes slideInLeft {
            from { opacity: 0; transform: translateX(-30px); }
            to   { opacity: 1; transform: translateX(0); }
          }
          @keyframes slideInRight {
            from { opacity: 0; transform: translateX(30px); }
            to   { opacity: 1; transform: translateX(0); }
          }
        `}</style>
        {title && (
          <p
            style={{
              textAlign: 'center',
              fontSize: '0.75rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--s-accent)',
              marginBottom: 'calc(2.5rem * var(--s-space))',
              fontFamily: 'var(--s-font-body)',
            }}
          >
            {title}
          </p>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'calc(3rem * var(--s-space))',
            alignItems: 'center',
            maxWidth: '72rem',
            margin: '0 auto',
          }}
        >
          {/* Product image / initials */}
          <div
            style={{
              aspectRatio: '1',
              background: 'var(--s-surface)',
              border: '1px solid var(--s-border)',
              borderRadius: 'var(--s-radius)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              animation: 'slideInLeft 0.7s ease forwards',
            }}
          >
            {product.images[0] ? (
              <img
                src={product.images[0]}
                alt={product.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <span
                style={{
                  fontFamily: 'var(--s-font-heading)',
                  fontSize: '4rem',
                  fontWeight: 800,
                  color: 'var(--s-muted)',
                  letterSpacing: '-0.04em',
                  userSelect: 'none',
                }}
              >
                {product.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          {/* Product info */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'calc(1.25rem * var(--s-space))',
              animation: 'slideInRight 0.7s ease forwards',
            }}
          >
            <div>
              <h2
                style={{
                  fontFamily: 'var(--s-font-heading)',
                  fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)',
                  fontWeight: 700,
                  color: 'var(--s-text)',
                  letterSpacing: '-0.02em',
                  lineHeight: 1.1,
                  marginBottom: '0.75rem',
                }}
              >
                {product.name}
              </h2>
              <p
                style={{
                  fontFamily: 'var(--s-font-heading)',
                  fontSize: '1.5rem',
                  fontWeight: 600,
                  color: 'var(--s-accent)',
                }}
              >
                {currency} {product.price.toFixed(2)}
              </p>
            </div>

            <p
              style={{
                fontFamily: 'var(--s-font-body)',
                fontSize: '1rem',
                color: 'var(--s-muted)',
                lineHeight: 1.75,
              }}
            >
              {product.description}
            </p>

            <a
              href={`/products/${product.slug}`}
              style={{
                display: 'inline-block',
                alignSelf: 'flex-start',
                padding: '0.875rem 2.25rem',
                background: 'var(--s-accent)',
                color: 'var(--s-accent-text)',
                borderRadius: 'var(--s-radius)',
                fontFamily: 'var(--s-font-body)',
                fontWeight: 600,
                fontSize: '0.9375rem',
                textDecoration: 'none',
                letterSpacing: '0.01em',
              }}
            >
              Shop now
            </a>
          </div>
        </div>
      </section>
    )
  }

  return null
}
