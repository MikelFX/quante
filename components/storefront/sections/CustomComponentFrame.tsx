'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  projectId: string
  componentRef: string
  cssVars?: Record<string, string>
}

// SECURITY: custom component code is AI/marketplace-authored. It is rendered as the
// srcdoc of an iframe with sandbox="allow-scripts" ONLY — never together with
// allow-same-origin, which would cancel the sandbox and hand the code the platform
// origin (session, cookies, every same-origin API). The HTML is fetched by this
// (same-origin, authenticated) page and injected via srcdoc, so the frame itself
// needs no cookies and runs in an opaque origin.
export function CustomComponentFrame({ projectId, componentRef, cssVars }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)
  // Result is keyed by the request it belongs to, so a stale result (or failure) for a
  // previous projectId/ref/vars combination is simply ignored instead of being reset
  // synchronously inside the effect.
  const [result, setResult] = useState<{ key: string; html: string | null; failed: boolean } | null>(null)

  const varsKey = cssVars && Object.keys(cssVars).length > 0 ? JSON.stringify(cssVars) : ''
  const requestKey = `${projectId}\n${componentRef}\n${varsKey}`

  useEffect(() => {
    const ctrl = new AbortController()
    const params = new URLSearchParams({ projectId, ref: componentRef })
    if (varsKey) params.set('vars', varsKey)
    fetch(`/api/preview/component?${params.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl.signal,
    })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((text) => setResult({ key: requestKey, html: text, failed: false }))
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return
        setResult({ key: requestKey, html: null, failed: true })
      })
    return () => ctrl.abort()
  }, [projectId, componentRef, varsKey, requestKey])

  const current = result && result.key === requestKey ? result : null
  const html = current?.html ?? null
  const failed = current?.failed ?? false

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Only trust height reports from our own frame.
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      if (
        e.data &&
        e.data.type === '__qcc_height' &&
        typeof e.data.height === 'number' &&
        Number.isFinite(e.data.height) &&
        e.data.height > 0
      ) {
        setHeight(Math.min(e.data.height, 20000))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  if (failed) return null

  return (
    <iframe
      ref={iframeRef}
      srcDoc={html ?? ''}
      title={`Custom component ${componentRef}`}
      style={{
        display: 'block',
        width: '100%',
        height,
        border: 'none',
        overflow: 'hidden',
        transition: 'height 0.2s ease',
      }}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
    />
  )
}
