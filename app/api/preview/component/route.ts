// GET /api/preview/component?projectId=xxx&ref=yyy
// Returns a standalone HTML page that renders one custom component in isolation.
// Used as an iframe src inside the Quante preview.
// React + framer-motion are loaded from CDN; Babel standalone compiles the TSX client-side.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const projectId = url.searchParams.get('projectId')
  const ref = url.searchParams.get('ref')

  if (!projectId || !ref) {
    return new NextResponse('projectId and ref are required', { status: 400 })
  }

  const { data: comp } = await supabaseAdmin
    .from('custom_components')
    .select('code')
    .eq('project_id', projectId)
    .eq('ref', ref)
    .maybeSingle()

  if (!comp) return new NextResponse('Component not found', { status: 404 })

  // CSS variables from the manifest palette (URL-encoded JSON from the caller)
  const rawVars = url.searchParams.get('vars')
  let cssVarsStyle = ''
  if (rawVars) {
    try {
      const vars = JSON.parse(decodeURIComponent(rawVars)) as Record<string, string>
      cssVarsStyle = ':root{' + Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') + '}'
    } catch {
      // ignore malformed CSS vars
    }
  }

  // The component code is validated TSX; embed it directly.
  // Babel standalone (loaded from CDN) compiles JSX + TypeScript in the browser.
  // ES module imports are replaced by require() calls via the transform-modules-commonjs
  // Babel plugin. We mock require() to proxy to UMD globals already on the page.
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}
body{margin:0;background:transparent;font-family:system-ui,sans-serif}
${cssVarsStyle}
</style>
</head>
<body>
<div id="root"></div>

<!-- React 19 UMD -->
<script src="https://unpkg.com/react@19/umd/react.production.min.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@19/umd/react-dom.production.min.js" crossorigin></script>
<!-- framer-motion UMD (global: window.Motion) -->
<script src="https://cdn.jsdelivr.net/npm/framer-motion@12/dist/framer-motion.umd.min.js" crossorigin></script>
<!-- Babel standalone (compiles TSX + TS in the browser) -->
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

<script>
// Provide a require() shim so Babel's CommonJS output can resolve known modules
var __module = { exports: {} };
function require(mod) {
  if (mod === 'react') return React;
  if (mod === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment };
  if (mod === 'framer-motion') return window.Motion || window.FramerMotion || {};
  console.warn('[custom-component] Unknown module:', mod);
  return {};
}
</script>

<script type="text/babel" data-presets="react,typescript" data-plugins="transform-modules-commonjs">
var exports = __module.exports;
${comp.code}
</script>

<script>
(function() {
  try {
    var exported = __module.exports;
    var Component = exported && (exported['default'] || exported);
    if (typeof Component !== 'function') {
      document.getElementById('root').innerHTML =
        '<p style="color:#f87171;padding:1rem;font-size:0.875rem">Custom component: no default export found.</p>';
      return;
    }
    var root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(React.createElement(Component, {}));
  } catch (e) {
    document.getElementById('root').innerHTML =
      '<p style="color:#f87171;padding:1rem;font-size:0.875rem">Error rendering component: ' +
      (e && e.message ? e.message : String(e)) + '</p>';
  }
})();

// Report scroll height to parent so the iframe can auto-size
function reportHeight() {
  var h = document.documentElement.scrollHeight;
  if (h > 0) window.parent.postMessage({ type: '__qcc_height', height: h }, '*');
}
var mo = new MutationObserver(reportHeight);
mo.observe(document.body, { childList: true, subtree: true, attributes: true });
window.addEventListener('load', reportHeight);
setTimeout(reportHeight, 200);
</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'SAMEORIGIN',
      'Cache-Control': 'no-store',
    },
  })
}
