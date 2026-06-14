'use client'

// Add-to-cart button with three-state morph: idle → adding (spinner) → added (checkmark).
// Cart is updated immediately on click; animation plays as confirmation.

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCart } from '@/context/cart'
import { useEffectiveMotion } from './motion/hooks'
import { useMotionConfig } from './motion/context'

type BtnState = 'idle' | 'adding' | 'added'

interface Props {
  productId: string
  name: string
  price: number
  currency: string
  image?: string
  available?: boolean
}

export function AddToCartButton({ productId, name, price, currency, image, available = true }: Props) {
  const [btnState, setBtnState] = useState<BtnState>('idle')
  const { add } = useCart()
  const effectiveLevel = useEffectiveMotion()
  const cfg = useMotionConfig()
  const animEnabled = cfg.enabled && effectiveLevel !== 'none'

  function handleAdd() {
    if (!available || btnState !== 'idle') return

    // Cart updated immediately — animation is pure confirmation feedback
    add({ id: productId, name, price, currency, image })

    if (animEnabled) {
      setBtnState('adding')
      setTimeout(() => {
        setBtnState('added')
        setTimeout(() => setBtnState('idle'), 1400)
      }, 480)
    } else {
      setBtnState('added')
      setTimeout(() => setBtnState('idle'), 1400)
    }
  }

  if (!available) {
    return (
      <button
        disabled
        style={{
          padding: '1rem 2.5rem',
          background: 'var(--s-surface)',
          color: 'var(--s-muted)',
          border: '1px solid var(--s-border)',
          borderRadius: 'var(--s-radius)',
          fontWeight: 600,
          fontSize: '1rem',
          fontFamily: 'var(--s-font-body)',
          cursor: 'not-allowed',
          alignSelf: 'flex-start',
        }}
      >
        Vyprodáno
      </button>
    )
  }

  return (
    <button
      onClick={handleAdd}
      disabled={btnState !== 'idle'}
      style={{
        padding: '1rem 2.5rem',
        background: btnState === 'added' ? '#22c55e' : 'var(--s-accent)',
        color: btnState === 'added' ? '#fff' : 'var(--s-accent-text)',
        border: 'none',
        borderRadius: 'var(--s-radius)',
        fontWeight: 600,
        fontSize: '1rem',
        fontFamily: 'var(--s-font-body)',
        cursor: btnState !== 'idle' ? 'default' : 'pointer',
        alignSelf: 'flex-start',
        transition: 'background 0.25s, color 0.25s',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        minWidth: '13rem',
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {btnState === 'idle' && (
          <motion.span
            key="idle"
            initial={animEnabled ? { opacity: 0, y: 4 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={animEnabled ? { opacity: 0, y: -4 } : undefined}
            transition={{ duration: 0.14 }}
          >
            Přidat do košíku
          </motion.span>
        )}

        {btnState === 'adding' && (
          <motion.span
            key="adding"
            initial={animEnabled ? { opacity: 0, y: 4 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={animEnabled ? { opacity: 0, y: -4 } : undefined}
            transition={{ duration: 0.14 }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 0.65, repeat: Infinity, ease: 'linear' }}
              style={{
                display: 'inline-block',
                width: 15,
                height: 15,
                border: '2px solid currentColor',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                flexShrink: 0,
              }}
            />
            Přidávám…
          </motion.span>
        )}

        {btnState === 'added' && (
          <motion.span
            key="added"
            initial={animEnabled ? { opacity: 0, scale: 0.75 } : false}
            animate={{ opacity: 1, scale: 1 }}
            exit={animEnabled ? { opacity: 0 } : undefined}
            transition={{ type: 'spring', stiffness: 380, damping: 22, duration: 0.2 }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
          >
            ✓ Přidáno do košíku
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}
