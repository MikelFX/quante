import type { ProductGridProps, Product, ShopManifest } from '@/types/manifest'
import { Stagger, StaggerItem } from '../motion/Stagger'
import { Reveal } from '../motion/Reveal'
import { ProductCard } from './ProductCard'

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
    <section style={{ background: 'var(--s-bg)', padding: `calc(5rem * var(--s-space)) 2rem` }}>
      <div style={{ maxWidth: '80rem', margin: '0 auto' }}>
        {title && (
          <Reveal variant="fade-up">
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
          </Reveal>
        )}
        <Stagger
          style={{
            display: 'grid',
            gridTemplateColumns: colMap[columns] ?? 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: `calc(1.25rem * var(--s-space))`,
          }}
        >
          {products.map((product) => (
            <StaggerItem key={product.id}>
              <ProductCard product={product} currency={catalog.currency} basePath={basePath} />
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}
