import type { GalleryProps } from '@/types/manifest'

interface Props {
  props: GalleryProps
}

export function Gallery({ props }: Props) {
  const { images, columns = 3 } = props

  if (!images.length) return null

  return (
    <section
      style={{
        background: 'var(--s-bg)',
        padding: `calc(4rem * var(--s-space)) 2rem`,
      }}
    >
      <div
        style={{
          maxWidth: '80rem',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: '0.625rem',
        }}
      >
        {images.map((img, i) => (
          <div
            key={i}
            style={{
              aspectRatio: '1',
              overflow: 'hidden',
              borderRadius: 'var(--s-radius)',
              background: 'var(--s-surface)',
            }}
          >
            <img
              src={img.src}
              alt={img.alt}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
