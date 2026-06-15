'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  projectId: string
  componentRef: string
  cssVars?: Record<string, string>
}

export function CustomComponentFrame({ projectId, componentRef, cssVars }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)

  // Build src URL with encoded CSS variables
  const vars = cssVars && Object.keys(cssVars).length > 0
    ? `&vars=${encodeURIComponent(JSON.stringify(cssVars))}`
    : ''
  const src = `/api/preview/component?projectId=${encodeURIComponent(projectId)}&ref=${encodeURIComponent(componentRef)}${vars}`

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (
        e.data &&
        e.data.type === '__qcc_height' &&
        typeof e.data.height === 'number' &&
        e.data.height > 0
      ) {
        setHeight(e.data.height)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={`Custom component ${componentRef}`}
      style={{
        display: 'block',
        width: '100%',
        height,
        border: 'none',
        overflow: 'hidden',
        transition: 'height 0.2s ease',
      }}
      sandbox="allow-scripts allow-same-origin"
      loading="lazy"
    />
  )
}
