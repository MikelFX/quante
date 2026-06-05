import type { RichTextProps } from '@/types/manifest'

interface Props {
  props: RichTextProps
}

export function RichText({ props }: Props) {
  const { content, align = 'left' } = props

  return (
    <section
      style={{
        background: 'var(--s-bg)',
        padding: `calc(5rem * var(--s-space)) 2rem`,
      }}
    >
      <div
        style={{
          maxWidth: '48rem',
          margin: '0 auto',
          textAlign: align,
        }}
      >
        {content.split('\n\n').map((paragraph, i) => (
          <p
            key={i}
            style={{
              color: 'var(--s-text)',
              fontSize: '1rem',
              lineHeight: 1.8,
              fontFamily: 'var(--s-font-body)',
              marginBottom: i < content.split('\n\n').length - 1 ? '1.5rem' : 0,
            }}
          >
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  )
}
