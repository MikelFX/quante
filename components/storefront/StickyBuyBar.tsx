'use client'

// Sticky add-to-cart bar that slides up from the bottom when the main buy button
// scrolls out of view. Uses a zero-height sentinel div placed at the component's
// position in the DOM — no prop drilling or refs from the parent needed.

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCart } from '@/context/cart'

interface Props {
  productId: string
  name: string
  price: number
  currency: string
  image?: string
  available?: boolean
  variantId?: string
  variantLabel?: string
}

export function StickyBuyBar({ productId, name, price, currency, image, available = true, variantId, variantLabel }: Props) {
  const [visible, setVisible] = useState(false)
  const [added, setAdded] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { add } = useCart()

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), { threshold: 0 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  function handleAdd() {
    if (!available || added) return
    const cartId = variantId ? `${productId}:${variantId}` : productId
    add({ id: cartId, productId, name, price, currency, image, variantId, variantLabel })
    setAdded(true)
    setTimeout(() => setAdded(false), 1400)
  }

  return (
    <>
      {/* Sentinel marks where the main buy button ends */}
      <div ref={sentinelRef} style={{ height: 0, pointerEvents: 'none' }} aria-hidden />

      <AnimatePresence>
        {visible && available && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 100,
              background: 'var(--s-surface)',
              borderTop: '1px solid var(--s-border)',
              padding: '0.875rem 1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              boxShadow: '0 -4px 24px rgba(0,0,0,0.08)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontWeight: 600,
                  color: 'var(--s-text)',
                  fontSize: '0.9375rem',
                  fontFamily: 'var(--s-font-body)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {name}
              </p>
              <p style={{ color: 'var(--s-accent)', fontWeight: 600, fontSize: '0.875rem', fontFamily: 'var(--s-font-body)' }}>
                {currency} {price.toFixed(2)}
              </p>
            </div>

            <button
              onClick={handleAdd}
              style={{
                padding: '0.75rem 1.5rem',
                background: added ? '#22c55e' : 'var(--s-accent)',
                color: added ? '#fff' : 'var(--s-accent-text)',
                border: 'none',
                borderRadius: 'var(--s-radius)',
                fontWeight: 600,
                fontSize: '0.9375rem',
                fontFamily: 'var(--s-font-body)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'background 0.2s',
              }}
            >
              {added ? '✓ Přidáno' : 'Přidat do košíku'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
