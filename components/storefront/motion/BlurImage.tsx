'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useMotionConfig } from './context'

interface Props {
  src: string
  alt: string
  style?: React.CSSProperties
  draggable?: boolean
  onLoad?: () => void
}

export function BlurImage({ src, alt, style, draggable = false, onLoad }: Props) {
  const [loaded, setLoaded] = useState(false)
  const cfg = useMotionConfig()

  function handleLoad() {
    setLoaded(true)
    onLoad?.()
  }

  return (
    <motion.img
      src={src}
      alt={alt}
      draggable={draggable}
      onLoad={handleLoad}
      animate={
        loaded
          ? { opacity: 1, filter: 'blur(0px)', scale: 1 }
          : { opacity: 0, filter: cfg.enabled ? 'blur(8px)' : 'blur(0px)', scale: cfg.enabled ? 1.04 : 1 }
      }
      transition={{ duration: cfg.duration.base, ease: cfg.ease }}
      style={{ display: 'block', ...style }}
    />
  )
}
