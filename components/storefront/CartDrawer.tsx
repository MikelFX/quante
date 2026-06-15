'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCart } from '@/context/cart'
import { useMotionConfig } from './motion/context'

interface Props {
  basePath?: string
  currency?: string
}

export function CartDrawer({ basePath = '', currency = '' }: Props) {
  const { items, updateQty, remove, total, count, cartOpen, closeCart } = useCart()
  const cfg = useMotionConfig()

  // Lock body scroll while open
  useEffect(() => {
    if (cartOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [cartOpen])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCart() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeCart])

  const dur = cfg.enabled ? 0.25 : 0

  return (
    <AnimatePresence>
      {cartOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur }}
            onClick={closeCart}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
              zIndex: 200, backdropFilter: 'blur(2px)',
            }}
            aria-hidden
          />

          {/* Panel */}
          <motion.div
            key="panel"
            role="dialog"
            aria-modal
            aria-label="Košík"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: dur, ease: [0.25, 0.1, 0.25, 1] }}
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0,
              width: 'min(420px, 100vw)',
              background: 'var(--s-bg)',
              borderLeft: '1px solid var(--s-border)',
              zIndex: 201,
              display: 'flex', flexDirection: 'column',
              boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--s-border)',
              flexShrink: 0,
            }}>
              <h2 style={{
                fontFamily: 'var(--s-font-heading)', fontWeight: 700,
                fontSize: '1.125rem', color: 'var(--s-text)', margin: 0,
              }}>
                Košík{count > 0 && <span style={{ marginLeft: '0.5rem', fontSize: '0.875rem', fontWeight: 400, color: 'var(--s-muted)' }}>({count})</span>}
              </h2>
              <button
                onClick={closeCart}
                aria-label="Zavřít košík"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--s-muted)', padding: '0.25rem', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', borderRadius: 6,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--s-text)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--s-muted)')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Items */}
            <div style={{ flex: 1, overflowY: 'auto', padding: items.length ? '0.5rem 0' : '0' }}>
              {items.length === 0 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', height: '100%', gap: '0.75rem',
                  padding: '3rem 1.5rem',
                }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--s-border)" strokeWidth="1.5">
                    <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                  </svg>
                  <p style={{ color: 'var(--s-muted)', fontFamily: 'var(--s-font-body)', fontSize: '0.9375rem' }}>
                    Košík je prázdný
                  </p>
                </div>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {items.map((item) => (
                    <li key={item.id} style={{
                      display: 'flex', gap: '1rem', padding: '1rem 1.5rem',
                      borderBottom: '1px solid var(--s-border)',
                      alignItems: 'flex-start',
                    }}>
                      {/* Thumbnail */}
                      <div style={{
                        width: 64, height: 64, flexShrink: 0,
                        background: 'var(--s-surface)', border: '1px solid var(--s-border)',
                        borderRadius: 'var(--s-radius)', overflow: 'hidden',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {item.image ? (
                          <img src={item.image} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{ fontSize: '1.25rem', fontFamily: 'var(--s-font-heading)', color: 'var(--s-muted)' }}>
                            {item.name.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </div>

                      {/* Info + controls */}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                        <p style={{
                          fontFamily: 'var(--s-font-body)', fontWeight: 500,
                          fontSize: '0.9375rem', color: 'var(--s-text)',
                          margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {item.name}
                        </p>
                        {item.variantLabel && (
                          <p style={{ fontSize: '0.8125rem', color: 'var(--s-muted)', fontFamily: 'var(--s-font-body)', margin: 0 }}>
                            {item.variantLabel}
                          </p>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                          {/* Qty stepper */}
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)',
                            overflow: 'hidden',
                          }}>
                            <button
                              onClick={() => updateQty(item.id, item.quantity - 1)}
                              aria-label="Ubrat kus"
                              style={{
                                width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--s-text)', fontSize: '1rem', lineHeight: 1,
                                transition: 'background 0.15s',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--s-surface)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                            >−</button>
                            <span style={{
                              minWidth: 20, textAlign: 'center',
                              fontFamily: 'var(--s-font-body)', fontSize: '0.875rem', color: 'var(--s-text)',
                            }}>{item.quantity}</span>
                            <button
                              onClick={() => updateQty(item.id, item.quantity + 1)}
                              aria-label="Přidat kus"
                              style={{
                                width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--s-text)', fontSize: '1rem', lineHeight: 1,
                                transition: 'background 0.15s',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--s-surface)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                            >+</button>
                          </div>
                          {/* Line total */}
                          <span style={{
                            fontFamily: 'var(--s-font-body)', fontWeight: 600,
                            fontSize: '0.9375rem', color: 'var(--s-text)',
                          }}>
                            {currency} {(item.price * item.quantity).toFixed(2)}
                          </span>
                        </div>
                      </div>

                      {/* Remove */}
                      <button
                        onClick={() => remove(item.id)}
                        aria-label={`Odebrat ${item.name}`}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem',
                          color: 'var(--s-muted)', flexShrink: 0, display: 'flex',
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--s-muted)')}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer — subtotal + CTA */}
            {items.length > 0 && (
              <div style={{
                borderTop: '1px solid var(--s-border)',
                padding: '1.25rem 1.5rem',
                display: 'flex', flexDirection: 'column', gap: '1rem',
                flexShrink: 0,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--s-font-body)', color: 'var(--s-muted)', fontSize: '0.875rem' }}>Mezisoučet</span>
                  <span style={{ fontFamily: 'var(--s-font-body)', fontWeight: 700, fontSize: '1.125rem', color: 'var(--s-text)' }}>
                    {currency} {total.toFixed(2)}
                  </span>
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--s-muted)', fontFamily: 'var(--s-font-body)', margin: 0 }}>
                  Doprava a daně se vypočítají při pokladně.
                </p>
                <a
                  href={`${basePath}/checkout`}
                  style={{
                    display: 'block', textAlign: 'center',
                    padding: '0.875rem 1.5rem',
                    background: 'var(--s-accent)', color: 'var(--s-accent-text)',
                    borderRadius: 'var(--s-radius)', fontWeight: 600,
                    fontSize: '1rem', fontFamily: 'var(--s-font-body)',
                    textDecoration: 'none',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  Pokračovat k pokladně →
                </a>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
