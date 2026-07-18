// Minimal white-label Next.js app deployed to a store's Vercel project when
// hosting expires. No Quante branding — the store owner's customers see only
// a neutral "temporarily unavailable" page. The real store code stays in
// code_versions and is redeployed on resubscribe.

export function maintenanceSiteFiles(storeName: string): Array<{ path: string; data: string }> {
  const safeName = storeName.replace(/[<>&"']/g, '')

  const page = `export default function Maintenance() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f0f12', color: '#f4f4f6', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '2rem' }}>
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <p style={{ fontSize: 40, margin: '0 0 16px' }}>&#128736;&#65039;</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 12px' }}>${safeName}</h1>
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
