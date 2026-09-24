// White-label scrub for Agency ZIP exports.
// Removes all Quante platform references from generated file content.
// Run this as a post-processing pass over GeneratedFile[] before zipping.

export interface ScrubFile {
  path: string
  content: string
  encoding?: 'utf-8' | 'base64'
}

const QUANTE_PATTERN = /quante/gi

export function scrubBranding(files: ScrubFile[]): ScrubFile[] {
  return files.map((f) => {
    // Never touch binary files
    if (f.encoding === 'base64') return f
    if (f.path === CUSTOM_SOURCES_PATH) return { ...f, content: scrubCustomSources(f.content) }
    return { ...f, content: scrubContent(f.path, f.content) }
  })
}

// components/custom/sources.ts (lib/store-template/build.ts buildCustomSourcesTs) holds
// each sandboxed custom section as ONE JSON string literal: a whole HTML document whose
// component source is itself JSON-encoded inside a <script type="application/json">.
// Scrubbing that text raw breaks it — a URL rule can swallow the backslash that escapes a
// closing quote, and the line-based attribution rules would eat the rest of the (single
// line) literal — so the export no longer compiles. Instead each literal is decoded,
// the component source inside it is scrubbed as plain code, and everything is re-encoded
// exactly the way build.ts encodes it.
const CUSTOM_SOURCES_PATH = 'components/custom/sources.ts'
const SOURCES_ENTRY_RE = /^(\s*)("(?:[^"\\\n]|\\.)*"): ("(?:[^"\\\n]|\\.)*"),$/
const SANDBOX_SRC_RE = /(<script type="application\/json" id="__qcc_src">)([\s\S]*?)(<\/script>)/

// U+2028/U+2029 (spelled out so no editor turns them into raw line terminators).
const LINE_SEP = String.fromCharCode(0x2028)
const PARA_SEP = String.fromCharCode(0x2029)

function tsStringLiteral(value: string): string {
  return JSON.stringify(value).split(LINE_SEP).join('\\u2028').split(PARA_SEP).join('\\u2029')
}

function jsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(LINE_SEP).join('\\u2028')
    .split(PARA_SEP).join('\\u2029')
}

function scrubSandboxDocument(html: string): string {
  const m = SANDBOX_SRC_RE.exec(html)
  if (!m) return scrubContent(CUSTOM_SOURCES_PATH, html)
  let code: unknown
  try {
    code = JSON.parse(m[2])
  } catch {
    return scrubContent(CUSTOM_SOURCES_PATH, html)
  }
  if (typeof code !== 'string') return scrubContent(CUSTOM_SOURCES_PATH, html)
  const before = html.slice(0, m.index)
  const after = html.slice(m.index + m[0].length)
  return scrubContent(CUSTOM_SOURCES_PATH, before)
    + m[1] + jsonForHtmlScript(scrubContent('component.tsx', code)) + m[3]
    + scrubContent(CUSTOM_SOURCES_PATH, after)
}

function scrubCustomSources(content: string): string {
  return content.split('\n').map((line) => {
    const m = SOURCES_ENTRY_RE.exec(line)
    if (!m) return scrubContent(CUSTOM_SOURCES_PATH, line)
    let key: unknown
    let html: unknown
    try {
      key = JSON.parse(m[2])
      html = JSON.parse(m[3])
    } catch {
      return scrubContent(CUSTOM_SOURCES_PATH, line)
    }
    if (typeof key !== 'string' || typeof html !== 'string') return scrubContent(CUSTOM_SOURCES_PATH, line)
    // Refs are plain identifiers; the catch-all renames them the same way it renames
    // the manifest data that references them, so lookups keep matching.
    return `${m[1]}${tsStringLiteral(scrubContent(CUSTOM_SOURCES_PATH, key))}: ${tsStringLiteral(scrubSandboxDocument(html))},`
  }).join('\n')
}

function scrubContent(filePath: string, content: string): string {
  // 1. Strip attribution lines (must run before catch-all so they're removed not just renamed)
  if (/\.(?:[cm]?[jt]sx?)$/.test(filePath)) {
    // Code: strip only the phrase, never the rest of the line — that could hold a
    // closing quote, tag or brace (`<p>built with Quante</p>`), breaking the build.
    content = content.replace(/Generated with \*\*Quante\*\*[^\n<>"'`\\{}]*/gi, '')
    content = content.replace(/built with Quante[^\n<>"'`\\{}]*/gi, '')
  } else {
    content = content.replace(/Generated with \*\*Quante\*\*[^\n]*/gi, '')
    content = content.replace(/built with Quante[^\n]*/gi, '')
    content = content.replace(/\*[^*]*built with Quante[^*]*\*/gi, '')
  }

  // 2. Strip domain URLs (e.g. https://quante.vercel.app, my-store.stores.quantecode.com).
  //    Wildcard sources first (the CSP `frame-ancestors https://*.quantecode.com`):
  //    left alone, the catch-all below would rename it to *.buildercode.com and let
  //    whoever owns that domain frame the exported store.
  //    The URL tail also stops at '`' and '\': inside an escaped string (\"…\") eating
  //    the backslash would leave an unterminated literal behind.
  content = content.replace(/https?:\/\/\*\.[a-z0-9.-]*quante(code)?\.[a-z.]+[^\s"'`\\)>]*/gi, '')
  content = content.replace(/https?:\/\/[a-z0-9.-]*quante(code)?\.[a-z.]+[^\s"'`\\)>]*/gi, '')
  content = content.replace(/[a-z0-9-]+\.quante\.(app|io)[^\s"'`\\)>]*/gi, '')
  content = content.replace(/[a-z0-9.-]+\.quantecode\.com[^\s"'`\\)>]*/gi, '')

  // 3. Rename localStorage key at source
  content = content.replace(/quante-cart/gi, 'store-cart')

  // 4. Catch-all: replace every remaining "quante" token, preserving case
  //    QUANTE → BUILDER, Quante → Builder, quante → builder
  content = content.replace(/QUANTE/g, 'BUILDER')
  content = content.replace(/Quante/g, 'Builder')
  content = content.replace(/quante/g, 'builder')

  return content
}

// Returns true if any file content still contains a quante reference.
// Used in the export test to assert clean output.
export function hasQuanteRefs(files: ScrubFile[]): { found: boolean; hits: string[] } {
  const hits: string[] = []
  for (const f of files) {
    if (f.encoding === 'base64') continue
    const matches = f.content.match(new RegExp(QUANTE_PATTERN.source, 'gi'))
    if (matches) {
      hits.push(`${f.path}: ${matches.slice(0, 3).join(', ')}`)
    }
  }
  return { found: hits.length > 0, hits }
}

// Generic README for agency exports
export function agencyReadme(storeName: string): string {
  return `# ${storeName}

A Next.js e-commerce project — generated by an AI builder.

## Getting started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000).

## Configuration

Copy \`.env.example\` to \`.env.local\` and fill in your Stripe keys:

\`\`\`bash
cp .env.example .env.local
\`\`\`

## Deployment

Deploy to [Vercel](https://vercel.com) in one click — no configuration required.
Add your environment variables in the Vercel dashboard under **Project → Settings → Environment Variables**.

## Tech stack

- **Next.js 16** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Stripe** — payment processing (your own keys)
`
}

// Generic .env.example for agency exports
export const AGENCY_ENV_EXAMPLE = `# Stripe — add your own keys from https://dashboard.stripe.com/apikeys
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# App
NEXT_PUBLIC_APP_URL=https://your-domain.com
`
