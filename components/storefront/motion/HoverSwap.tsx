'use client'

// Crossfade between two product images on hover.
// Mobile: hover doesn't exist — primary image always shown.
// Phase B wires this into ProductGrid cards.

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { CSSProperties } from 'react'
import { useEffectiveMotion } from './hooks'

interface HoverSwapProps {
  primary: string
  secondary?: string
  alt?: string
  zoom?: number        // e.g. 1.04 — scales image on hover (clipped by parent overflow:hidden)
  onLoad?: () => void // fired when the primary image loads
  style?: CSSProperties
  className?: string
}

export function HoverSwap({ primary, secondary, alt = '', zoom = 1, onLoad, style, className }: HoverSwapProps) {
  const [hovered, setHovered] = useState(false)
  const effectiveLevel = useEffectiveMotion()

  const canSwap = effectiveLevel !== 'none' && !!secondary
  const canZoom = effectiveLevel !== 'none' && zoom > 1

  const containerStyle: CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    ...style,
  }

  return (
    <div
      className={className}
      style={containerStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={primary}
        alt={alt}
        onLoad={onLoad}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          opacity: canSwap && hovered ? 0 : 1,
          transform: canZoom && hovered && !canSwap ? `scale(${zoom})` : 'scale(1)',
          transition: 'opacity 0.3s ease, transform 0.4s ease',
        }}
      />
      {canSwap && (
        <AnimatePresence>
          {hovered && (
            <motion.img
              key="secondary"
              src={secondary}
              alt={alt}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          )}
        </AnimatePresence>
      )}
    </div>
  )
}
