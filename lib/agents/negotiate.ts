// Markdown content negotiation for agents (proxy.ts). No imports: runs on every request.

/** True when the client prefers Markdown over HTML (q-values honoured; no Accept header or only a wildcard = HTML). */
export function wantsMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false
  let md = -1
  let html = -1
  for (const part of accept.split(',')) {
    const [type, ...params] = part.trim().toLowerCase().split(';')
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    const q = qp ? Number(qp.slice(2)) : 1
    if (!Number.isFinite(q)) continue
    if (type === 'text/markdown' || type === 'text/x-markdown') md = Math.max(md, q)
    if (type === 'text/html' || type === 'application/xhtml+xml') html = Math.max(html, q)
  }
  return md > 0 && md >= html
}

