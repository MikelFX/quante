// /supplier-order/<id>?t=<token> — the page a supplier opens from its order e-mail (CLAUDE.md §13r):
// what to ship, and a form for the tracking number (or why it can't ship). No account: the link's
// token is the key. Czech: the suppliers are Czech wholesalers. Never indexed, no referrer (the
// token is in the address).
import type { Metadata } from 'next'
import { supplierOrderView } from '@/lib/suppliers/dispatch'
import { SupplierOrderForm } from './SupplierOrderForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Objednávka k odeslání',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

const wrap: React.CSSProperties = { maxWidth: 620, margin: '0 auto', padding: '48px 20px 80px', color: 'var(--q-fg)', fontFamily: 'var(--q-sans)' }

export default async function SupplierOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ id }, { t }] = await Promise.all([params, searchParams])
  const view = await supplierOrderView(id, t)
  if (!view) {
    return (
      <main style={wrap}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Odkaz neplatí</h1>
        <p style={{ color: 'var(--q-fg3)' }}>Otevřete prosím odkaz přímo z e-mailu s objednávkou, nebo odpovězte na ten e-mail obchodníkovi.</p>
      </main>
    )
  }
  return (
    <main style={wrap}>
      <p style={{ fontSize: 12, color: 'var(--q-fg3)', margin: 0, fontFamily: 'var(--q-mono)' }}>{view.supplierName}</p>
      <h1 style={{ fontSize: 24, margin: '6px 0 4px' }}>Objednávka {view.storeName} č. {view.orderNumber}</h1>
      <p style={{ color: 'var(--q-fg3)', margin: '0 0 24px' }}>Pro: {view.shipTo.name}, {view.shipTo.city}, {view.shipTo.country} (celá adresa je v e-mailu)</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 28 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--q-fg3)', fontSize: 12 }}>
            <th style={{ padding: '6px 4px' }}>Kód</th><th style={{ padding: '6px 4px' }}>Název</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Ks</th>
          </tr>
        </thead>
        <tbody>
          {view.items.map((l) => (
            <tr key={l.productId + (l.variantId ?? '')} style={{ borderTop: '1px solid rgb(var(--q-ink-rgb) / .08)' }}>
              <td style={{ padding: '8px 4px', fontFamily: 'var(--q-mono)', fontSize: 12 }}>{l.externalId}</td>
              <td style={{ padding: '8px 4px' }}>{l.name}</td>
              <td style={{ padding: '8px 4px', textAlign: 'right' }}>{l.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.status === 'shipped' ? (
        <p style={{ color: 'var(--q-ok-text)' }}>Odesláno, číslo zásilky {view.trackingCode}. Děkujeme.</p>
      ) : view.status === 'cannot' ? (
        <p style={{ color: 'var(--q-fg3)' }}>Označeno, že zboží odeslat nemůžete. Obchodník o tom ví.</p>
      ) : (
        <SupplierOrderForm id={view.id} token={t ?? ''} />
      )}
    </main>
  )
}
