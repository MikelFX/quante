import type { ProductGridProps, Product, ShopManifest } from '@/types/manifest'

interface Props {
  props: ProductGridProps
  catalog: ShopManifest['catalog']
  basePath?: string
}

export function ProductGrid({ props, catalog, basePath = '' }: Props) {
  const { title, collectionId, limit, columns = 3 } = props

  let products: Product[] = catalog.products

  if (collectionId) {
    const collection = catalog.collections?.find((c) => c.id === collectionId)
    if (collection) {
      const ids = new Set(collection.productIds)
      products = products.filter((p) => ids.has(p.id))
    }
  }

  if (limit) products = products.slice(0, limit)

  const colMap: Record<number, string> = {
    2: 'repeat(2, 1fr)',
    3: 'repeat(3, 1fr)',
    4: 'repeat(4, 1fr)',
  }

  return (
    <section
      style={{
        background: 'var(--s-bg)',
        padding: `calc(5rem * var(--s-space)) 2rem`,
      }}
    >
      <div style={{ maxWidth: '80rem', margin: '0 auto' }}>
        {title && (
          <h2
            style={{
              fontFamily: 'var(--s-font-heading)',
              fontSize: 'clamp(1.5rem, 3vw, 2rem)',
              fontWeight: 700,
              color: 'var(--s-text)',
              marginBottom: `calc(2.5rem * var(--s-space))`,
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </h2>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: colMap[columns] ?? 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: `calc(1.25rem * var(--s-space))`,
          }}
        >
          {products.map((product) => (
            <ProductCard key={product.id} product={product} currency={catalog.currency} basePath={basePath} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ProductCard({ product, currency, basePath }: { product: Product; currency: string; basePath: string }) {
  const initials = product.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <a
      href={`${basePath}/products/${product.slug}`}
      style={{
        display: 'block',
        border: '1px solid var(--s-border)',
        borderRadius: 'var(--s-radius)',
        background: 'var(--s-surface)',
        textDecoration: 'none',
        overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}
    >
      <div
        style={{
          aspectRatio: '1 / 1',
          background: 'var(--s-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
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
              fontSize: '2rem',
              fontWeight: 700,
              color: 'var(--s-muted)',
              letterSpacing: '0.05em',
            }}
          >
            {initials}
          </span>
        )}
      </div>
      <div
        style={{
          padding: `calc(1rem * var(--s-space)) calc(1rem * var(--s-space)) calc(1.25rem * var(--s-space))`,
        }}
      >
        <p
          style={{
            fontWeight: 500,
            color: 'var(--s-text)',
            fontSize: '0.9375rem',
            marginBottom: '0.25rem',
            fontFamily: 'var(--s-font-body)',
          }}
        >
          {product.name}
        </p>
        <p
          style={{
            color: 'var(--s-muted)',
            fontSize: '0.875rem',
            fontFamily: 'var(--s-font-body)',
          }}
        >
          {currency} {product.price.toFixed(2)}
        </p>
      </div>
    </a>
  )
}
