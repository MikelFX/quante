'use client'

// Scroll-parallax image wrapper. Zero CLS: parent clips overflow, image over-scales.
// Only active on 'expressive' — too much CLS/jank risk as a default on mobile.

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import type { CSSProperties } from 'react'
import { useMotionConfig } from './context'
import { useEffectiveMotion } from './hooks'

interface ParallaxImageProps {
  src: string
  alt?: string
  containerStyle?: CSSProperties
  imgStyle?: CSSProperties
  className?: string
}

export function ParallaxImage({ src, alt = '', containerStyle, imgStyle, className }: ParallaxImageProps) {
  const ref = useRef<HTMLDivElement>(null)
  const effectiveLevel = useEffectiveMotion()
  const cfg = useMotionConfig()

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  })

  const strength = cfg.parallaxStrength
  const y = useTransform(scrollYProgress, [0, 1], [`${-strength * 100}%`, `${strength * 100}%`])

  const useParallax = effectiveLevel === 'expressive' && cfg.parallax

  const containerBase: CSSProperties = {
    overflow: 'hidden',
    position: 'relative',
    ...containerStyle,
  }

  const imageBase: CSSProperties = {
    width: '100%',
    objectFit: 'cover',
    display: 'block',
    ...imgStyle,
  }

  return (
    <div ref={ref} className={className} style={containerBase}>
      {useParallax ? (
        <motion.img
          src={src}
          alt={alt}
          style={{ ...imageBase, height: '130%', y }}
        />
      ) : (
        <img src={src} alt={alt} style={{ ...imageBase, height: '100%' }} />
      )}
    </div>
  )
}
