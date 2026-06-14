'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Product } from '@/types/manifest'
import { useCart } from '@/context/cart'
import { HoverSwap } from '../motion/HoverSwap'
import { useEffectiveMotion } from '../motion/hooks'
import { useMotionConfig } from '../motion/context'

const SALE_TAGS = new Set(['sale', 'sleva', 'výprodej', 'vyprodej'])
const NEW_TAGS = new Set(['new', 'nové', 'nove', 'novinka'])

interface Props {
  product: Product
  currency: string
  basePath: string
}

export function ProductCard({ product, currency, basePath }: Props) {
  const [hovered, setHovered] = useState(false)
  const [added, setAdded] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const effectiveLevel = useEffectiveMotion()
  const cfg = useMotionConfig()
  const { add } = useCart()

  const animEnabled = cfg.enabled && effectiveLevel !== 'none'
  const hasTwoImages = product.images.length > 1
  const isSale = product.tags?.some((t) => SALE_TAGS.has(t.toLowerCase()))
  const isNew = !isSale && product.tags?.some((t) => NEW_TAGS.has(t.toLowerCase()))
  const initials = product.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!product.available) return
    add({ id: product.id, name: product.name, price: product.price, currency, image: product.images[0] })
    setAdded(true)
    setTimeout(() => setAdded(false), 1500)
  }

  return (
    <a
      href={`${basePath}/products/${product.slug}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block',
        border: `1px solid ${hovered && animEnabled ? 'var(--s-accent)' : 'var(--s-border)'}`,
        borderRadius: 'var(--s-radius)',
        background: 'var(--s-surface)',
        textDecoration: 'none',
        overflow: 'hidden',
        position: 'relative',
        transition: `border-color ${cfg.duration.fast}s ease, box-shadow ${cfg.duration.fast}s ease`,
        boxShadow:
          hovered && animEnabled && effectiveLevel === 'expressive'
            ? '0 8px 28px rgba(0,0,0,0.1)'
            : 'none',
      }}
    >
      {/* Sale / New badges */}
      {(isSale || isNew) && (
        <div style={{ position: 'absolute', top: '0.625rem', left: '0.625rem', zIndex: 2, display: 'flex', gap: '0.3rem' }}>
          {isSale && (
            <motion.span
              initial={animEnabled ? { scale: 0 } : false}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 18 }}
              style={{
                background: '#ef4444',
                color: '#fff',
                fontSize: '0.625rem',
                fontWeight: 700,
                letterSpacing: '0.07em',
                padding: '0.2rem 0.45rem',
                borderRadius: 'var(--s-radius)',
                textTransform: 'uppercase' as const,
                fontFamily: 'var(--s-font-body)',
              }}
            >
              SALE
            </motion.span>
          )}
          {isNew && (
            <motion.span
              initial={animEnabled ? { scale: 0 } : false}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 18 }}
              style={{
                background: 'var(--s-accent)',
                color: 'var(--s-accent-text)',
                fontSize: '0.625rem',
                fontWeight: 700,
                letterSpacing: '0.07em',
                padding: '0.2rem 0.45rem',
                borderRadius: 'var(--s-radius)',
                textTransform: 'uppercase' as const,
                fontFamily: 'var(--s-font-body)',
              }}
            >
              NEW
            </motion.span>
          )}
        </div>
      )}

      {/* Image area */}
      <div
        style={{
          aspectRatio: '1 / 1',
          background: 'var(--s-border)',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {product.images[0] ? (
          hasTwoImages && animEnabled ? (
            <HoverSwap
              primary={product.images[0]}
              secondary={product.images[1]}
              alt={product.name}
              zoom={cfg.hoverScale}
              onLoad={() => setImgLoaded(true)}
              style={{ width: '100%', height: '100%', opacity: imgLoaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
            />
          ) : (
            <img
              src={product.images[0]}
              alt={product.name}
              onLoad={() => setImgLoaded(true)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                opacity: imgLoaded ? 1 : 0,
                transform: hovered && animEnabled ? `scale(${cfg.hoverScale})` : 'scale(1)',
                transition: animEnabled
                  ? `transform ${cfg.duration.base}s ease, opacity 0.3s ease`
                  : 'opacity 0.3s ease',
              }}
            />
          )
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

        {/* Quick-add button — slides up on hover */}
        <AnimatePresence>
          {hovered && animEnabled && product.available && (
            <motion.button
              key="quick-add"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: cfg.duration.fast, ease: cfg.ease }}
              onClick={handleQuickAdd}
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: '0.625rem 1rem',
                background: added ? '#22c55e' : 'var(--s-accent)',
                color: 'var(--s-accent-text)',
                border: 'none',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--s-font-body)',
                textAlign: 'center' as const,
                transition: 'background 0.2s',
                zIndex: 3,
              }}
            >
              {added ? '✓ Přidáno' : 'Přidat do košíku'}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Product info */}
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
        <p style={{ color: 'var(--s-muted)', fontSize: '0.875rem', fontFamily: 'var(--s-font-body)' }}>
          {currency} {product.price.toFixed(2)}
        </p>
      </div>
    </a>
  )
}
