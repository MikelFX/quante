// Qgent swarm: a store page as "layers" — the x-ray the agents fly over on /qgent — plus the plain
// facts the deterministic checks read (checks.ts). Pure: HTML text in, data out. Everything here
// is DATA read from a third-party page; it reaches the model only quoted inside the user message.
//
// The page is not rendered in the browser (no iframe of someone else's site, no hotlinked
// images): the stage draws these layers as boxes in page order, the way the agents "see" it.

import { attr, cleanText, decodeEntities, extractJsonLd } from '../../qscan/extract.ts'

export type LayerKind =
  | 'header' | 'nav' | 'footer' | 'section' | 'form' | 'product'
  | 'h1' | 'h2' | 'h3' | 'text' | 'link' | 'button' | 'image' | 'video' | 'input' | 'price'

export interface Layer {
  /** "L1", "L2" … in page order; findings point at these */
  id: string
  kind: LayerKind
  /** visible text (or alt / label / placeholder), trimmed to LAYER_TEXT_MAX */
  text: string
  /** nesting inside header / nav / section / product / form / footer, 0–3 */
  depth: number
  /** problem markers the checks and the stage use: 'no-alt', 'no-label', 'no-text' */
  flags?: string[]
}

export const LAYER_LIMITS = { layers: 320, text: 140 } as const

const CONTAINERS = new Set(['header', 'nav', 'footer', 'section', 'article', 'form', 'main', 'aside'])
const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr'])
const TEXT_TAGS = new Set(['p', 'li', 'blockquote', 'dd', 'figcaption', 'td'])
const PRODUCT_CLASS = /(^|[\s_-])(product|produkt|card-product|product-card|product-item|product-tile|grid-product)([\s_-]|$)/i
const BUTTON_CLASS = /(^|[\s_-])(btn|button|cta|add-to-cart)([\s_-]|$)/i
const PRICE_RE = /^(?:[$€£]\s?\d[\d\s.,]*|\d[\d\s.,]*\s?(?:kč|czk|eur|€|usd|\$|£|zł|pln|ft|huf|chf))(?:\s?(?:s dph|incl\.? vat))?$/i

function clip(s: string, n: number = LAYER_LIMITS.text): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

/** The HTML without comments, scripts, styles, svg drawings and templates. */
export function visibleHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|noscript|template|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/i, ' ')
}

interface Open {
  tag: string
  /** the layer this element opened (containers, products, headings, text, links, buttons) */
  layer: Layer | null
  /** collects text for headings / paragraphs / links / buttons */
  text: string[] | null
  aria: string
  container: boolean
  /** a product card's name: the first heading or link text inside it */
  name?: string
}

/**
 * Walks the page once, in order, and returns its layers (capped at LAYER_LIMITS.layers) and how
 * many there were in total (the stage shows "seen / total"). Tolerant of broken HTML: closing
 * tags pop to the nearest matching open tag, unknown closings are ignored.
 */
export function pageLayers(html: string): { layers: Layer[]; total: number } {
  const src = visibleHtml(html)
  const layers: Layer[] = []
  let total = 0
  const stack: Open[] = []
  const add = (kind: LayerKind, text: string, flags?: string[]): Layer => {
    total++
    const depth = Math.min(3, stack.filter((o) => o.container).length)
    const l: Layer = { id: '', kind, text: clip(text), depth, ...(flags?.length ? { flags } : {}) }
    if (layers.length < LAYER_LIMITS.layers) {
      l.id = `L${layers.length + 1}`
      layers.push(l)
    }
    return l
  }
  const inside = (names: string[]) => stack.some((o) => names.includes(o.tag) || (o.layer && names.includes(o.layer.kind)))
  const collecting = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].text) return stack[i].text
    return null
  }

  const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m[4] !== undefined) {
      const t = decodeEntities(m[4]).replace(/\s+/g, ' ')
      if (!t.trim()) continue
      const sink = collecting()
      if (sink) sink.push(t)
      else if (PRICE_RE.test(t.trim()) && t.trim().length <= 24) add('price', t.trim())
      continue
    }
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    const full = `<${tag}${m[3]}>`

    if (!closing) {
      if (/\shidden(\s|=|$)|aria-hidden\s*=\s*["']?true|display\s*:\s*none/i.test(m[3])) {
        if (!VOID.has(tag) && !m[3].trim().endsWith('/')) {
          // skip the hidden element's whole subtree (same tag, nesting-aware)
          const close = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
          close.lastIndex = re.lastIndex
          let depth = 1
          let c: RegExpExecArray | null
          while (depth > 0 && (c = close.exec(src))) depth += c[1] ? -1 : 1
          re.lastIndex = depth === 0 ? close.lastIndex : src.length
        }
        continue
      }
      if (tag === 'img') {
        const alt = attr(full, 'alt')
        const hasAlt = /\salt\s*=/i.test(full)
        const sink = collecting()
        if (sink && alt) sink.push(` ${alt} `)
        add('image', alt || 'image', hasAlt ? undefined : ['no-alt'])
        continue
      }
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        const type = attr(full, 'type').toLowerCase()
        if (['hidden', 'submit', 'button', 'image'].includes(type)) {
          if (type === 'submit' || type === 'button') add('button', attr(full, 'value') || attr(full, 'aria-label') || 'Submit')
          continue
        }
        const label = attr(full, 'aria-label') || attr(full, 'placeholder') || attr(full, 'name')
        add('input', label || type || tag, attr(full, 'aria-label') || attr(full, 'id') ? undefined : ['no-label'])
        if (tag !== 'input' && !full.endsWith('/>')) stack.push({ tag, layer: null, text: [], aria: '', container: false })
        continue
      }
      if (VOID.has(tag)) continue
      if (tag === 'video' || (tag === 'iframe' && /youtube|vimeo/i.test(attr(full, 'src')))) {
        add('video', attr(full, 'title') || 'video')
        stack.push({ tag, layer: null, text: null, aria: '', container: false })
        continue
      }

      const cls = `${attr(full, 'class')} ${attr(full, 'id')}`
      let layer: Layer | null = null
      let text: string[] | null = null
      let container = false
      if (CONTAINERS.has(tag)) {
        container = true
        const kind: LayerKind | null = tag === 'header' ? 'header' : tag === 'nav' ? 'nav' : tag === 'footer' ? 'footer' : tag === 'form' ? 'form' : tag === 'section' || tag === 'article' ? 'section' : null
        if (kind === 'section' && PRODUCT_CLASS.test(cls) && !inside(['product'])) layer = add('product', '')
        else if (kind && !(kind === 'section' && stack.some((o) => o.layer?.kind === 'section'))) layer = add(kind, attr(full, 'aria-label'))
        if (layer?.kind === 'product') text = []
      } else if ((tag === 'div' || tag === 'li') && PRODUCT_CLASS.test(cls) && !inside(['product'])) {
        container = true
        layer = add('product', '')
        text = []
      } else if (/^h[1-3]$/.test(tag)) {
        layer = add(tag as LayerKind, '')
        text = []
      } else if (tag === 'a' || tag === 'button') {
        const isButton = tag === 'button' || BUTTON_CLASS.test(cls) || attr(full, 'role') === 'button'
        const inMenu = inside(['nav', 'header'])
        const inFooter = inside(['footer'])
        if (isButton || inMenu || inFooter) {
          layer = add(isButton ? 'button' : 'link', '')
          text = []
        }
      } else if (TEXT_TAGS.has(tag) && !collecting()) {
        layer = add('text', '')
        text = []
      }
      stack.push({ tag, layer, text, aria: attr(full, 'aria-label') || attr(full, 'title'), container })
      continue
    }

    // closing tag: pop to the nearest open element with this name
    let idx = -1
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { idx = i; break }
    if (idx < 0) continue
    const popped = stack.splice(idx)
    for (let i = popped.length - 1; i >= 0; i--) finish(popped[i], stack)
  }
  for (let i = stack.length - 1; i >= 0; i--) finish(stack[i], stack.slice(0, i))

  // drop empty text layers, keep containers; re-number so ids stay dense
  const kept = layers.filter((l) => l.text || ['header', 'nav', 'footer', 'section', 'form', 'product', 'image', 'video', 'input', 'link', 'button'].includes(l.kind))
  const dropped = layers.length - kept.length
  kept.forEach((l, i) => { l.id = `L${i + 1}` })
  return { layers: kept, total: Math.max(kept.length, total - dropped) }
}

function finish(o: Open, parents: Open[]) {
  if (!o.layer || !o.text) {
    if (o.text && o.text.length) {
      const parentSink = [...parents].reverse().find((p) => p.text)?.text
      parentSink?.push(o.text.join(''))
    }
    return
  }
  const text = clip(o.text.join(' '))
  const l = o.layer
  if (l.kind === 'product') {
    // a card's name: its first heading / link, else all of its text
    l.text = clip(o.name || text, 80)
  } else if (l.kind === 'text') {
    l.text = text.length >= 20 ? text : ''
  } else if (l.kind === 'link' || l.kind === 'button') {
    l.text = text || o.aria
    if (!text && !o.aria) l.flags = [...(l.flags ?? []), 'no-text']
  } else {
    l.text = text
  }
  // text inside a product card also names the card
  const card = [...parents].reverse().find((p) => p.layer?.kind === 'product' && p.text)
  if (card && l.kind !== 'product' && text) {
    card.text!.push(` ${text} `)
    if (!card.name && /^(h[1-3]|link)$/.test(l.kind)) card.name = text
  }
}

// ── facts for the deterministic checks ─────────────────────────────────────────────────────

export interface PageFacts {
  url: string
  https: boolean
  bytes: number
  title: string
  description: string
  lang: string
  viewport: boolean
  canonical: boolean
  favicon: boolean
  ogTitle: boolean
  ogImage: boolean
  jsonLdTypes: string[]
  h1: number
  images: number
  imagesNoAlt: number
  imagesLazy: number
  scripts: number
  thirdPartyScripts: number
  linksNoText: number
  hasTel: boolean
  hasMailto: boolean
  /** lower-cased visible text + link targets, for keyword checks (capped) */
  hay: string
}

function metaContent(html: string, key: string): string {
  for (const t of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = (attr(t, 'property') || attr(t, 'name') || attr(t, 'itemprop')).toLowerCase()
    if (k === key) return attr(t, 'content')
  }
  return ''
}

export function pageFacts(html: string, url: string): PageFacts {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '')
  const visible = visibleHtml(noComments)
  let host = ''
  try { host = new URL(url).host } catch {}
  const imgs = visible.match(/<img\b[^>]*>/gi) ?? []
  const scripts = noComments.match(/<script\b[^>]*>/gi) ?? []
  const links = (noComments.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? [])
  const types = new Set<string>()
  for (const o of extractJsonLd(noComments)) {
    const t = o['@type']
    for (const x of Array.isArray(t) ? t : [t]) if (typeof x === 'string') types.add(x)
  }
  const hrefs = links.map((a) => attr(a.match(/<a\b[^>]*>/i)?.[0] ?? '', 'href')).join(' ')
  return {
    url,
    https: url.startsWith('https:'),
    bytes: new TextEncoder().encode(html).length,
    title: cleanText(noComments.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
    description: cleanText(metaContent(noComments, 'description')),
    lang: attr(noComments.match(/<html\b[^>]*>/i)?.[0] ?? '', 'lang').slice(0, 5).toLowerCase(),
    viewport: !!metaContent(noComments, 'viewport'),
    canonical: /<link\b[^>]*rel\s*=\s*["']?canonical/i.test(noComments),
    favicon: /<link\b[^>]*rel\s*=\s*["']?[^"'>]*icon/i.test(noComments),
    ogTitle: !!metaContent(noComments, 'og:title'),
    ogImage: !!metaContent(noComments, 'og:image'),
    jsonLdTypes: [...types].slice(0, 20),
    h1: (visible.match(/<h1\b/gi) ?? []).length,
    images: imgs.length,
    imagesNoAlt: imgs.filter((t) => !/\salt\s*=/i.test(t)).length,
    imagesLazy: imgs.filter((t) => /loading\s*=\s*["']?lazy|data-src|lazyload/i.test(t)).length,
    scripts: scripts.length,
    thirdPartyScripts: scripts.filter((t) => {
      const src = attr(t, 'src')
      if (!/^https?:\/\//i.test(src)) return false
      try { return new URL(src).host !== host } catch { return false }
    }).length,
    linksNoText: links.filter((a) => !cleanText(a) && !/aria-label|title=|<img\b[^>]*alt\s*=\s*["'][^"']/i.test(a)).length,
    hasTel: /href\s*=\s*["']?tel:/i.test(noComments),
    hasMailto: /href\s*=\s*["']?mailto:/i.test(noComments),
    hay: (cleanText(visible) + ' ' + hrefs).toLowerCase().slice(0, 120_000),
  }
}
