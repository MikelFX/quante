'use client'

import { useState } from 'react'
import type { Product } from '@/types/manifest'
import { AddToCartButton } from './AddToCartButton'
import { StickyBuyBar } from './StickyBuyBar'
import { ProductGallery } from './ProductGallery'

interface Props {
  product: Product
  currency: string
}

export function ProductDetail({ product, currency }: Props) {
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(
    product.variants?.[0]?.id
  )

  const selectedVariant = product.variants?.find((v) => v.id === selectedVariantId)
  const effectivePrice = selectedVariant?.price ?? product.price

  // Group variants by their first option (e.g. "Small / Red" → group by "Small")
  // For simple name lists, just render as flat buttons
  const hasVariants = !!(product.variants && product.variants.length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Image gallery */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
        gap: '2rem',
        alignItems: 'start',
      }}>
        {/* Gallery */}
        <div style={{
          aspectRatio: '1',
          background: 'var(--s-surface)',
          border: '1px solid var(--s-border)',
          borderRadius: 'var(--s-radius)',
          overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {product.images.length > 0 ? (
            <ProductGallery images={product.images} name={product.name} />
          ) : (
            <span style={{
              fontFamily: 'var(--s-font-heading)', fontSize: '3rem',
              fontWeight: 700, color: 'var(--s-muted)',
            }}>
              {product.name.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        {/* Info panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <h1 style={{
              fontFamily: 'var(--s-font-heading)',
              fontSize: 'clamp(1.5rem, 4vw, 2.25rem)',
              fontWeight: 700, lineHeight: 1.15, marginBottom: '0.75rem',
              color: 'var(--s-text)',
            }}>
              {product.name}
            </h1>

            {/* Price */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{
                fontFamily: 'var(--s-font-body)',
                fontSize: '1.5rem', fontWeight: 700,
                color: (product.compareAtPrice && product.compareAtPrice > product.price) ? '#ef4444' : 'var(--s-accent)',
              }}>
                {currency} {effectivePrice.toFixed(2)}
              </span>
              {product.compareAtPrice && product.compareAtPrice > product.price && (
                <span style={{
                  fontFamily: 'var(--s-font-body)',
                  fontSize: '1.125rem', fontWeight: 400,
                  color: 'var(--s-muted)', textDecoration: 'line-through',
                }}>
                  {currency} {product.compareAtPrice.toFixed(2)}
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <p style={{
              color: 'var(--s-muted)', lineHeight: 1.75,
              fontFamily: 'var(--s-font-body)', fontSize: '0.9375rem',
            }}>
              {product.description}
            </p>
          )}

          {/* Variant picker */}
          {hasVariants && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{
                fontFamily: 'var(--s-font-body)', fontSize: '0.875rem',
                fontWeight: 500, color: 'var(--s-text)', margin: 0,
              }}>
                Varianta{selectedVariant ? `: ${selectedVariant.name}` : ''}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {product.variants!.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariantId(v.id)}
                    style={{
                      padding: '0.5rem 1rem',
                      border: `2px solid ${v.id === selectedVariantId ? 'var(--s-accent)' : 'var(--s-border)'}`,
                      borderRadius: 'var(--s-radius)',
                      background: v.id === selectedVariantId ? 'var(--s-accent)' : 'var(--s-surface)',
                      color: v.id === selectedVariantId ? 'var(--s-accent-text)' : 'var(--s-text)',
                      fontFamily: 'var(--s-font-body)', fontSize: '0.875rem', fontWeight: 500,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Add to cart */}
          {!product.available ? (
            <button disabled style={{
              padding: '1rem 2.5rem', background: 'var(--s-surface)',
              color: 'var(--s-muted)', border: '1px solid var(--s-border)',
              borderRadius: 'var(--s-radius)', fontWeight: 600, fontSize: '1rem',
              fontFamily: 'var(--s-font-body)', cursor: 'not-allowed', alignSelf: 'flex-start',
            }}>
              Vyprodáno
            </button>
          ) : (
            <AddToCartButton
              productId={product.id}
              name={product.name}
              price={effectivePrice}
              currency={currency}
              image={product.images[0]}
              available={product.available}
              variantId={selectedVariantId}
              variantLabel={selectedVariant?.name}
            />
          )}

          {/* Sticky bar (appears when button scrolls out of view) */}
          <StickyBuyBar
            productId={product.id}
            name={product.name}
            price={effectivePrice}
            currency={currency}
            image={product.images[0]}
            available={product.available}
            variantId={selectedVariantId}
            variantLabel={selectedVariant?.name}
          />
        </div>
      </div>
    </div>
  )
}
