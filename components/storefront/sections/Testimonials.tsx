import type { TestimonialsProps } from '@/types/manifest'

interface Props {
  props: TestimonialsProps
}

export function Testimonials({ props }: Props) {
  const { title, items } = props

  return (
    <section
      style={{
        background: 'var(--s-bg)',
        padding: `calc(5rem * var(--s-space)) 2rem`,
      }}
    >
      <div style={{ maxWidth: '72rem', margin: '0 auto' }}>
        {title && (
          <h2
            style={{
              fontFamily: 'var(--s-font-heading)',
              fontSize: 'clamp(1.5rem, 3vw, 2rem)',
              fontWeight: 700,
              color: 'var(--s-text)',
              textAlign: 'center',
              marginBottom: `calc(3rem * var(--s-space))`,
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </h2>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: `calc(1.5rem * var(--s-space))`,
          }}
        >
          {items.map((item, i) => (
            <div
              key={i}
              style={{
                background: 'var(--s-surface)',
                border: '1px solid var(--s-border)',
                borderRadius: 'var(--s-radius)',
                padding: `calc(1.75rem * var(--s-space))`,
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <p
                style={{
                  fontStyle: 'italic',
                  color: 'var(--s-text)',
                  lineHeight: 1.75,
                  fontSize: '0.9375rem',
                  fontFamily: 'var(--s-font-body)',
                  flex: 1,
                }}
              >
                &ldquo;{item.quote}&rdquo;
              </p>
              <div>
                <p
                  style={{
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    color: 'var(--s-text)',
                    fontFamily: 'var(--s-font-body)',
                  }}
                >
                  {item.author}
                </p>
                {item.role && (
                  <p
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--s-muted)',
                      marginTop: '0.125rem',
                      fontFamily: 'var(--s-font-body)',
                    }}
                  >
                    {item.role}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
