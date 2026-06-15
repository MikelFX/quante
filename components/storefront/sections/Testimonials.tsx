import type { TestimonialsProps } from '@/types/manifest'
import { Marquee } from '../motion/Marquee'
import { Stagger, StaggerItem } from '../motion/Stagger'
import { Reveal } from '../motion/Reveal'

interface Props {
  props: TestimonialsProps
}

function TestimonialCard({ item }: { item: TestimonialsProps['items'][number] }) {
  return (
    <div
      style={{
        background: 'var(--s-surface)',
        border: '1px solid var(--s-border)',
        borderRadius: 'var(--s-radius)',
        padding: `calc(1.75rem * var(--s-space))`,
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        width: 'clamp(260px, 80vw, 300px)',
        flexShrink: 0,
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
        <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)' }}>
          {item.author}
        </p>
        {item.role && (
          <p style={{ fontSize: '0.75rem', color: 'var(--s-muted)', marginTop: '0.125rem', fontFamily: 'var(--s-font-body)' }}>
            {item.role}
          </p>
        )}
      </div>
    </div>
  )
}

export function Testimonials({ props }: Props) {
  const { title, items, marquee } = props

  const heading = title ? (
    <Reveal variant="fade-up">
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
    </Reveal>
  ) : null

  if (marquee) {
    return (
      <section style={{ background: 'var(--s-bg)', padding: `calc(5rem * var(--s-space)) 0`, overflow: 'hidden' }}>
        {title && (
          <div style={{ padding: '0 2rem' }}>{heading}</div>
        )}
        <Marquee duration={40} gap="1.25rem" pauseOnHover>
          {items.map((item, i) => <TestimonialCard key={i} item={item} />)}
        </Marquee>
      </section>
    )
  }

  return (
    <section style={{ background: 'var(--s-bg)', padding: `calc(5rem * var(--s-space)) 2rem` }}>
      <div style={{ maxWidth: '72rem', margin: '0 auto' }}>
        {heading}
        <Stagger style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: `calc(1.5rem * var(--s-space))` }}>
          {items.map((item, i) => (
            <StaggerItem key={i} style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  background: 'var(--s-surface)',
                  border: '1px solid var(--s-border)',
                  borderRadius: 'var(--s-radius)',
                  padding: `calc(1.75rem * var(--s-space))`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  flex: 1,
                }}
              >
                <p style={{ fontStyle: 'italic', color: 'var(--s-text)', lineHeight: 1.75, fontSize: '0.9375rem', fontFamily: 'var(--s-font-body)', flex: 1 }}>
                  &ldquo;{item.quote}&rdquo;
                </p>
                <div>
                  <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)' }}>
                    {item.author}
                  </p>
                  {item.role && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--s-muted)', marginTop: '0.125rem', fontFamily: 'var(--s-font-body)' }}>
                      {item.role}
                    </p>
                  )}
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}
