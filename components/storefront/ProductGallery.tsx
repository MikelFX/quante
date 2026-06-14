'use client'

// Product image gallery for the PDP.
// - Thumbnail strip (2+ images), click to switch
// - AnimatePresence crossfade between images
// - Hover zoom (clipped by overflow:hidden — zero CLS)
// - Lightbox: click main image → full-screen overlay
// - Mobile: touch swipe + prev/next arrows
// - Keyboard: Escape closes lightbox, ← → navigate

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useEffectiveMotion } from './motion/hooks'
import { useMotionConfig } from './motion/context'

interface Props {
  images: string[]
  name: string
}

export function ProductGallery({ images, name }: Props) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const effectiveLevel = useEffectiveMotion()
  const cfg = useMotionConfig()
  const animEnabled = cfg.enabled && effectiveLevel !== 'none'
  const touchStartX = useRef<number | null>(null)

  const hasMultiple = images.length > 1
  const activeImage = images[activeIndex] ?? ''

  const prev = useCallback(() => setActiveIndex((i) => (i - 1 + images.length) % images.length), [images.length])
  const next = useCallback(() => setActiveIndex((i) => (i + 1) % images.length), [images.length])

  // Keyboard navigation + body scroll lock for lightbox
  useEffect(() => {
    if (!lightboxOpen) return
    const prev_ = prev, next_ = next
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false)
      if (e.key === 'ArrowLeft') prev_()
      if (e.key === 'ArrowRight') next_()
    }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [lightboxOpen, prev, next])

  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) > 48) dx < 0 ? next() : prev()
    touchStartX.current = null
  }

  if (!images.length) {
    return (
      <div
        style={{
          aspectRatio: '1',
          background: 'var(--s-surface)',
          border: '1px solid var(--s-border)',
          borderRadius: 'var(--s-radius)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontFamily: 'var(--s-font-heading)', fontSize: '3rem', fontWeight: 700, color: 'var(--s-muted)' }}>
          {name.slice(0, 2).toUpperCase()}
        </span>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Main image */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Zvětšit obrázek"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => animEnabled && setLightboxOpen(true)}
          onKeyDown={(e) => e.key === 'Enter' && setLightboxOpen(true)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          style={{
            aspectRatio: '1',
            background: 'var(--s-surface)',
            border: '1px solid var(--s-border)',
            borderRadius: 'var(--s-radius)',
            overflow: 'hidden',
            position: 'relative',
            cursor: animEnabled ? 'zoom-in' : 'default',
            userSelect: 'none',
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.img
              key={activeIndex}
              src={activeImage}
              alt={`${name} — obrázek ${activeIndex + 1}`}
              draggable={false}
              initial={animEnabled ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              exit={animEnabled ? { opacity: 0 } : undefined}
              transition={{ duration: 0.22 }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                transform: hovered && animEnabled ? `scale(${cfg.hoverScale + 0.02})` : 'scale(1)',
                transition: `transform ${cfg.duration.slow}s ease`,
              }}
            />
          </AnimatePresence>

          {/* Prev / next arrows — always visible on mobile, hover-visible on desktop */}
          {hasMultiple && (
            <>
              <NavArrow dir="prev" onClick={(e) => { e.stopPropagation(); prev() }} />
              <NavArrow dir="next" onClick={(e) => { e.stopPropagation(); next() }} />
            </>
          )}

          {/* Dot indicators */}
          {hasMultiple && (
            <div style={{ position: 'absolute', bottom: '0.625rem', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: '0.375rem' }}>
              {images.map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: i === activeIndex ? '1.25rem' : '0.375rem',
                    height: '0.375rem',
                    borderRadius: 99,
                    background: i === activeIndex ? 'var(--s-accent)' : 'rgba(255,255,255,0.5)',
                    transition: 'width 0.2s ease, background 0.2s',
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Thumbnail strip */}
        {hasMultiple && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {images.map((src, i) => (
              <button
                key={i}
                onClick={() => setActiveIndex(i)}
                aria-label={`Obrázek ${i + 1}`}
                aria-pressed={i === activeIndex}
                style={{
                  width: '4rem',
                  height: '4rem',
                  borderRadius: 'var(--s-radius)',
                  overflow: 'hidden',
                  border: `2px solid ${i === activeIndex ? 'var(--s-accent)' : 'var(--s-border)'}`,
                  cursor: 'pointer',
                  padding: 0,
                  background: 'none',
                  transition: 'border-color 0.15s',
                  flexShrink: 0,
                  opacity: i === activeIndex ? 1 : 0.65,
                }}
              >
                <img src={src} alt="" aria-hidden style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setLightboxOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Lightbox"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.92)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'zoom-out',
              padding: '2rem',
            }}
          >
            <motion.img
              key={activeIndex}
              src={activeImage}
              alt={name}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '90vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: '4px', cursor: 'default' }}
            />

            {/* Close */}
            <button
              onClick={() => setLightboxOpen(false)}
              aria-label="Zavřít"
              style={lbBtnStyle({ top: '1rem', right: '1rem' })}
            >
              ×
            </button>

            {/* Navigation */}
            {hasMultiple && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); prev() }}
                  aria-label="Předchozí"
                  style={lbBtnStyle({ left: '1rem', top: '50%', transform: 'translateY(-50%)' })}
                >
                  ‹
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); next() }}
                  aria-label="Další"
                  style={lbBtnStyle({ right: '1rem', top: '50%', transform: 'translateY(-50%)' })}
                >
                  ›
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function NavArrow({ dir, onClick }: { dir: 'prev' | 'next'; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={dir === 'prev' ? 'Předchozí' : 'Další'}
      style={{
        position: 'absolute',
        [dir === 'prev' ? 'left' : 'right']: '0.625rem',
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'rgba(0,0,0,0.32)',
        backdropFilter: 'blur(4px)',
        color: '#fff',
        border: 'none',
        borderRadius: '50%',
        width: '2.25rem',
        height: '2.25rem',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.25rem',
        lineHeight: 1,
        zIndex: 2,
        transition: 'background 0.15s',
      }}
    >
      {dir === 'prev' ? '‹' : '›'}
    </button>
  )
}

function lbBtnStyle(extra: React.CSSProperties): React.CSSProperties {
  return {
    position: 'absolute',
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.18)',
    color: '#fff',
    borderRadius: '50%',
    width: '2.75rem',
    height: '2.75rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.375rem',
    lineHeight: 1,
    zIndex: 10000,
    transition: 'background 0.15s',
    ...extra,
  }
}
