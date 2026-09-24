// GET /api/preview/component?projectId=xxx&ref=yyy[&vars=<json>]
// Returns a standalone HTML page that renders one custom component in isolation.
// CustomComponentFrame fetches it and mounts it as the srcdoc of an iframe with
// sandbox="allow-scripts" (NO allow-same-origin) so the component runs in an opaque
// origin and can never touch the Quante session, cookies or same-origin APIs.
// React + framer-motion are loaded from pinned CDN URLs (with SRI); Babel standalone
// compiles the TSX client-side.
//
// SECURITY: component code is AI- or marketplace-authored, i.e. attacker-controllable.
//  - Only the project owner may fetch it (it was previously public by projectId+ref).
//  - The code is shipped as an escaped JSON string, never spliced raw into <script>,
//    so a '</script>' literal inside it cannot break out into the page.
//  - `vars` are strictly allowlisted before landing in <style>.
//  - The response carries `Content-Security-Policy: sandbox allow-scripts` so opening
//    the URL top-level also yields an opaque origin instead of quantecode.com.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'

export const runtime = 'nodejs'

const REF_RE = /^[A-Za-z0-9_-]{1,100}$/
const VAR_KEY_RE = /^--[a-zA-Z0-9-]{1,40}$/
// Colors, lengths, numbers and font stacks. Deliberately excludes < > { } ; \ : @ and
// newlines so a value can neither end the declaration block nor the <style> element.
const VAR_VALUE_RE = /^[#a-zA-Z0-9 .,%()"'+\/-]{1,120}$/
const MAX_VARS = 40

// Pinned builds + Subresource Integrity. React 19 ships no UMD build, so the
// isolated renderer uses React 18.3.1 UMD (framer-motion 12's UMD targets it fine).
const CDN = {
  react: {
    src: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
    integrity: 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
  },
  reactDom: {
    src: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
    integrity: 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
  },
  motion: {
    src: 'https://cdn.jsdelivr.net/npm/framer-motion@12.40.0/dist/framer-motion.js',
    integrity: 'sha384-CUXBBimBkXD9dbPEQX2QuMJ+sg6fDTMyOnCOLbeyMTwV5+uYt8Xi5Lf7lZ9lnPIR',
  },
  babel: {
    src: 'https://unpkg.com/@babel/standalone@7.28.4/babel.min.js',
    integrity: 'sha384-tL0JdJBWAk5nHKZhc/dtWf7bZRpYP13x4HjH85NrwCr/JkBnrZ7RNBOAdDzJlpof',
  },
} as const

// Applied inside the document too (meta CSP), because a srcdoc iframe does not get
// this route's response headers. connect-src 'none' blocks fetch/XHR/beacon exfil.
// ACCEPTED RISK: img-src/media-src stay open to any https host because components
// legitimately hard-code product imagery from arbitrary CDNs. A malicious component
// could therefore leak whatever the viewer types into it through an image URL (or by
// navigating its own frame). It can never reach platform cookies or the session (the
// origin is opaque), and the Studio preview is owner-only; marketplace listings are
// human-reviewed before sale.
const INNER_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src https: data: blob:',
  'media-src https: data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

function parseVars(raw: string | null): string {
  if (!raw || raw.length > 4000) return ''
  let vars: unknown
  try {
    // searchParams.get() already percent-decodes — no extra decodeURIComponent.
    vars = JSON.parse(raw)
  } catch {
    return ''
  }
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return ''
  const decls: string[] = []
  for (const [k, v] of Object.entries(vars as Record<string, unknown>)) {
    if (decls.length >= MAX_VARS) break
    if (!VAR_KEY_RE.test(k)) continue
    if (typeof v !== 'string' || !VAR_VALUE_RE.test(v)) continue
    decls.push(`${k}:${v}`)
  }
  return decls.length ? ':root{' + decls.join(';') + '}' : ''
}

/** JSON-encode for embedding inside an HTML <script> element. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

function scriptTag(s: { src: string; integrity: string }): string {
  return `<script src="${s.src}" integrity="${s.integrity}" crossorigin="anonymous"></script>`
}

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return new NextResponse('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const projectId = url.searchParams.get('projectId')
  const ref = url.searchParams.get('ref')

  if (!projectId || !ref) {
    return new NextResponse('projectId and ref are required', { status: 400 })
  }
  if (!REF_RE.test(ref)) return new NextResponse('Component not found', { status: 404 })

  const project = await getOwnedProject(projectId, userId)
  if (!project) return new NextResponse('Component not found', { status: 404 })

  const { data: comp } = await supabaseAdmin
    .from('custom_components')
    .select('code')
    .eq('project_id', projectId)
    .eq('ref', ref)
    .maybeSingle()

  if (!comp || typeof comp.code !== 'string') return new NextResponse('Component not found', { status: 404 })

  const cssVarsStyle = parseVars(url.searchParams.get('vars'))

  // The TSX source travels as an escaped JSON string and is compiled with
  // Babel.transform at runtime. ES module imports become require() calls via the
  // transform-modules-commonjs plugin; the require() shim maps them to UMD globals.
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${INNER_CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}
body{margin:0;background:transparent;font-family:system-ui,sans-serif}
${cssVarsStyle}
</style>
</head>
<body>
<div id="root"></div>

${scriptTag(CDN.react)}
${scriptTag(CDN.reactDom)}
<!-- framer-motion UMD (global: window.Motion) -->
${scriptTag(CDN.motion)}
<!-- Babel standalone (compiles TSX + TS in the browser) -->
${scriptTag(CDN.babel)}

<script type="application/json" id="__qcc_src">${jsonForScript(comp.code)}</script>

<script>
(function() {
  var rootEl = document.getElementById('root');
  function fail(msg) {
    var p = document.createElement('p');
    p.style.cssText = 'color:#f87171;padding:1rem;font-size:0.875rem';
    p.textContent = msg;
    rootEl.replaceChildren(p);
  }
  function requireShim(mod) {
    if (mod === 'react') return React;
    if (mod === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment };
    if (mod === 'framer-motion') return window.Motion || window.FramerMotion || {};
    console.warn('[custom-component] Unknown module:', mod);
    return {};
  }
  try {
    var source = JSON.parse(document.getElementById('__qcc_src').textContent || '""');
    var compiled = Babel.transform(source, {
      filename: 'component.tsx',
      presets: ['react', ['typescript', { isTSX: true, allExtensions: true }]],
      plugins: ['transform-modules-commonjs'],
    }).code;
    var mod = { exports: {} };
    new Function('exports', 'module', 'require', 'React', compiled)(mod.exports, mod, requireShim, React);
    var exported = mod.exports;
    var Component = exported && (exported['default'] || exported);
    if (typeof Component !== 'function') {
      fail('Custom component: no default export found.');
      return;
    }
    ReactDOM.createRoot(rootEl).render(React.createElement(Component, {}));
  } catch (e) {
    fail('Error rendering component: ' + (e && e.message ? e.message : String(e)));
  }
})();

// Report scroll height to parent so the iframe can auto-size. Previously
// this used setTimeout(reportHeight, 200) as a "settle" fallback next to
// the MutationObserver and load handler — same class of latent bug that
// bit ZoomGallery on production: a fixed 200ms guess is not a signal
// that layout has stabilized, and on slower connections a webfont swap
// or late image decode landing after 200ms would leave the parent
// iframe stuck at the pre-settle height (visible as a preview panel
// clipping the last row of the custom component). ResizeObserver on the
// documentElement fires exactly when the real box size changes, however
// late that happens, so no timeout guess is needed.
// Target '*' is required: the sandboxed frame has an opaque origin. The parent
// only accepts this message from its own iframe's contentWindow.
function reportHeight() {
  var h = document.documentElement.scrollHeight;
  if (h > 0) window.parent.postMessage({ type: '__qcc_height', height: h }, '*');
}
var mo = new MutationObserver(reportHeight);
mo.observe(document.body, { childList: true, subtree: true, attributes: true });
window.addEventListener('load', reportHeight);
if (typeof ResizeObserver !== 'undefined') {
  var ro = new ResizeObserver(reportHeight);
  ro.observe(document.documentElement);
}
reportHeight();
</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Opaque origin even if someone opens this URL directly in a tab.
      'Content-Security-Policy': `sandbox allow-scripts; frame-ancestors 'self'; ${INNER_CSP}`,
      'X-Frame-Options': 'SAMEORIGIN',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, no-store',
    },
  })
}
