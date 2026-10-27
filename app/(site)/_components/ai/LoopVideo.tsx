'use client'

import { useEffect, useRef } from 'react'

// A muted looping product clip that only plays while it is on screen. With reduced motion or
// animations off (data-motion="off") it stays on its poster. preload="none": nothing is
// downloaded until the clip first comes near the viewport.

export function LoopVideo({ src, poster, label, className }: { src: string; poster: string; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = ref.current
    if (!v || typeof IntersectionObserver !== 'function') return
    const still = () =>
      document.documentElement.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !still()) {
        if (v.preload === 'none') v.preload = 'auto'
        void v.play().catch(() => {})
      } else {
        v.pause()
      }
    }, { rootMargin: '120px 0px', threshold: 0.15 })
    io.observe(v)
    return () => io.disconnect()
  }, [])

  return (
    <video
      ref={ref}
      className={className}
      src={src}
      poster={poster}
      aria-label={label}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
    />
  )
}
