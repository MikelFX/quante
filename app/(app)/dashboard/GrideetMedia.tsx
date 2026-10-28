'use client'

// Media tiles in Grideet. Videos play muted and only while on screen, at most MAX_PLAYING at once
// (like the Qads community wall; fewer on touch screens); with animations off or reduced motion
// they stay still on their first frame. Signed URLs come from the server and expire within an hour.
import { useEffect, useRef } from 'react'
import { useMotionAllowed } from '@ad/ui'

const MAX_PLAYING = 6
const playing = new Set<HTMLVideoElement>()
const waiting = new Set<HTMLVideoElement>()

function limit(): number {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 3 : MAX_PLAYING
}

function startNext() {
  for (const v of waiting) {
    if (playing.size >= limit()) return
    waiting.delete(v)
    playing.add(v)
    v.play().catch(() => playing.delete(v))
  }
}

function stop(v: HTMLVideoElement) {
  waiting.delete(v)
  if (playing.delete(v)) v.pause()
  startNext()
}

export function GridVideo({ src, label }: { src: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const motion = useMotionAllowed()

  useEffect(() => {
    const v = ref.current
    if (!v || !motion) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { waiting.add(v); startNext() } else stop(v)
    }, { threshold: 0.5 })
    io.observe(v)
    return () => { io.disconnect(); stop(v) }
  }, [motion])

  return (
    <video
      ref={ref}
      className="gd-media"
      src={src}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={label}
      disableRemotePlayback
    />
  )
}

export function GridImage({ src, alt }: { src: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- signed / store URLs from many hosts, not optimisable
  return <img className="gd-media" src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
}
