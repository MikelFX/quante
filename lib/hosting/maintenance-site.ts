// Minimal white-label Next.js app deployed to a store's Vercel project when
// hosting expires. No Quante branding — the store owner's customers see only
// a neutral "temporarily unavailable" page. The real store code stays in
// code_versions and is redeployed on resubscribe.

// SECURITY (audit #41): the store name is owner-controlled. It used to be spliced into
// JSX *source* text, where `{...}` became a JS expression that ran at build time in our
// Vercel team and in visitors' browsers (e.g. redirecting away from the suspension
// page). It is now emitted only as a JSON string literal and rendered as `{NAME}`,
// which React escapes. `<`, `>`, `&` and U+2028/U+2029 are additionally \u-escaped so
// the literal can't close a tag or break the line.
// Built from char codes so the source never contains the raw separator characters.
const LINE_SEPARATOR_RE = new RegExp(String.fromCharCode(0x2028), 'g')
const PARAGRAPH_SEPARATOR_RE = new RegExp(String.fromCharCode(0x2029), 'g')

function toJsStringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEPARATOR_RE, '\\u2028')
    .replace(PARAGRAPH_SEPARATOR_RE, '\\u2029')
}

export function maintenanceSiteFiles(storeName: string): Array<{ path: string; data: string }> {
  // Strip control characters and cap the length; escaping happens in toJsStringLiteral.
  const name = String(storeName ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100)

  const page = `const NAME = ${toJsStringLiteral(name)}

export default function Maintenance() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f0f12', color: '#f4f4f6', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '2rem' }}>
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <p style={{ fontSize: 40, margin: '0 0 16px' }}>&#128736;&#65039;</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 12px' }}>{NAME}</h1>
        <p style={{ fontSize: 16, color: '#a8a8b0', margin: '0 0 8px', lineHeight: 1.6 }}>
          Obchod je do&#269;asn&#283; nedostupn&#253;. Zkuste to pros&#237;m pozd&#283;ji.
        </p>
        <p style={{ fontSize: 13, color: '#6b6b74', margin: 0 }}>
          This store is temporarily unavailable. Please check back later.
        </p>
      </div>
    </div>
  )
}
`

  return [
    {
      path: 'package.json',
      data: JSON.stringify({
        name: 'store-maintenance',
        private: true,
        scripts: { build: 'next build' },
        dependencies: { next: '^15.1.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
      }, null, 2),
    },
    { path: 'pages/index.js', data: page },
    // Every non-root route (product pages, checkout, …) 404s into the same maintenance view
    { path: 'pages/404.js', data: `export { default } from './index'\n` },
  ]
}
