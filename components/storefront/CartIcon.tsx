'use client'

import { useCart } from '@/context/cart'
import { motion, AnimatePresence } from 'framer-motion'
import { useEffectiveMotion } from '@/components/storefront/motion/hooks'
import { useMotionConfig } from '@/components/storefront/motion/context'

export function CartIcon({ basePath = '' }: { basePath?: string }) {
  const { count, openCart } = useCart()
  const effectiveLevel = useEffectiveMotion()
  const cfg = useMotionConfig()
  const animEnabled = cfg.enabled && effectiveLevel !== 'none'

  return (
    <button
      onClick={openCart}
      aria-label={`Košík (${count} položek)`}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--s-text)',
        fontSize: '0.8125rem',
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: '0.375rem',
        padding: 0,
        fontFamily: 'inherit',
      }}
    >
      Košík
      <AnimatePresence mode="popLayout">
        {count > 0 && (
          <motion.span
            key="badge"
            initial={animEnabled ? { scale: 0.3, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            exit={animEnabled ? { scale: 0.3, opacity: 0 } : undefined}
            transition={{ type: 'spring', stiffness: 520, damping: 18 }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '1.25rem',
              height: '1.25rem',
              background: 'var(--s-accent)',
              color: 'var(--s-accent-text)',
              borderRadius: 99,
              fontSize: '0.6875rem',
              fontWeight: 700,
              padding: '0 0.375rem',
              overflow: 'hidden',
              lineHeight: 1,
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={count}
                initial={animEnabled ? { y: -10, opacity: 0 } : false}
                animate={{ y: 0, opacity: 1 }}
                exit={animEnabled ? { y: 10, opacity: 0 } : undefined}
                transition={{ duration: 0.12 }}
                style={{ display: 'block' }}
              >
                {count}
              </motion.span>
            </AnimatePresence>
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}
