'use client'

import { useState } from 'react'
import { useCart } from '@/context/cart'
import type { ShopManifest } from '@/types/manifest'

interface Props {
  manifest: ShopManifest
  projectId: string
  basePath: string
}

type Step = 'info' | 'shipping' | 'payment'

export function CheckoutForm({ manifest, projectId, basePath }: Props) {
  const { items, total, clear } = useCart()
  const currency = manifest.catalog.currency
  const shippingMethods = manifest.shipping?.methods ?? []
  const payments = manifest.payments
  const hasStripe = !payments || payments.providers.includes('stripe')
  const hasComgate = payments?.providers.includes('comgate') ?? false
  const hasGopay = payments?.providers.includes('gopay') ?? false
  const hasPayPal = payments?.providers.includes('paypal') ?? false
  const hasDobirka = payments?.dobirka?.enabled ?? false
  const hasPrevod = payments?.prevod?.enabled ?? true

  const [step, setStep] = useState<Step>('info')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Customer info
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [zip, setZip] = useState('')

  // Shipping
  const [shippingMethod, setShippingMethod] = useState(shippingMethods[0]?.type ?? '')
  const selectedShipping = shippingMethods.find((m) => m.type === shippingMethod)
  const shippingCents = selectedShipping ? Math.round(selectedShipping.cena_czk * 100) : 0

  // Free shipping
  const freeFrom = manifest.shipping?.doprava_zdarma_od_czk
  const isFreeShipping = !!(freeFrom && total >= freeFrom)
  const effectiveShippingCents = isFreeShipping ? 0 : shippingCents

  // Payment
  const defaultPayment = hasStripe ? 'stripe' : hasComgate ? 'comgate' : hasGopay ? 'gopay' : hasPayPal ? 'paypal' : hasDobirka ? 'dobirka' : 'prevod'
  const [paymentMethod, setPaymentMethod] = useState<string>(defaultPayment)
  const dobirkaFee = paymentMethod === 'dobirka' ? (payments?.dobirka?.priplatek_czk ?? 49) : 0
  const orderTotal = total + (isFreeShipping ? 0 : selectedShipping ? selectedShipping.cena_czk : 0) + dobirkaFee

  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <p style={{ color: 'var(--s-muted)', fontFamily: 'var(--s-font-body)', fontSize: '1rem', marginBottom: '1.5rem' }}>
          Váš košík je prázdný.
        </p>
        <a href={basePath} style={{
          display: 'inline-block', padding: '0.75rem 1.5rem',
          background: 'var(--s-accent)', color: 'var(--s-accent-text)',
          borderRadius: 'var(--s-radius)', fontWeight: 600,
          fontFamily: 'var(--s-font-body)', textDecoration: 'none', fontSize: '0.9375rem',
        }}>
          Pokračovat v nákupu
        </a>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError('')
    setSubmitting(true)

    try {
      const res = await fetch('/api/store/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          returnBasePath: basePath,
          items: items.map((i) => ({
            id: i.id,
            name: i.name + (i.variantLabel ? ` (${i.variantLabel})` : ''),
            price: i.price,
            currency,
            quantity: i.quantity,
          })),
          paymentMethod,
          shippingMethod: selectedShipping?.type,
          shippingCents: effectiveShippingCents,
          dobirkaCents: Math.round(dobirkaFee * 100),
          customerEmail: email,
          customerName: name,
          customerPhone: phone,
          shippingAddress: { ulice: street, mesto: city, psc: zip },
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Chyba při zpracování objednávky')

      if (data.url) {
        clear()
        window.location.href = data.url
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba')
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.75rem 1rem',
    background: 'var(--s-surface)',
    border: '1px solid var(--s-border)',
    borderRadius: 'var(--s-radius)',
    color: 'var(--s-text)',
    fontFamily: 'var(--s-font-body)', fontSize: '0.9375rem',
    outline: 'none',
    transition: 'border-color 0.15s',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: '0.375rem',
    fontSize: '0.875rem', fontWeight: 500, color: 'var(--s-text)',
    fontFamily: 'var(--s-font-body)',
  }

  const sectionHeadStyle: React.CSSProperties = {
    fontFamily: 'var(--s-font-heading)', fontWeight: 700,
    fontSize: '1.125rem', color: 'var(--s-text)',
    marginBottom: '1rem', paddingBottom: '0.5rem',
    borderBottom: '1px solid var(--s-border)',
  }

  const paymentLabel = (id: string, label: string) => (
    <label key={id} style={{
      display: 'flex', alignItems: 'center', gap: '0.625rem',
      padding: '0.75rem 1rem',
      border: `1px solid ${paymentMethod === id ? 'var(--s-accent)' : 'var(--s-border)'}`,
      borderRadius: 'var(--s-radius)',
      cursor: 'pointer',
      background: paymentMethod === id ? 'rgba(var(--s-accent-rgb, 111,120,230),0.06)' : 'var(--s-surface)',
      transition: 'border-color 0.15s',
    }}>
      <input
        type="radio" name="payment" value={id}
        checked={paymentMethod === id}
        onChange={() => setPaymentMethod(id)}
        style={{ accentColor: 'var(--s-accent)' }}
      />
      <span style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.9375rem', color: 'var(--s-text)' }}>{label}</span>
    </label>
  )

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '2rem', alignItems: 'start' }}>

      {/* Left column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

        {/* Contact info */}
        <section>
          <p style={sectionHeadStyle}>Kontaktní údaje</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Jméno a příjmení *</label>
              <input required value={name} onChange={e => setName(e.target.value)} style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--s-accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--s-border)')}
              />
            </div>
            <div>
              <label style={labelStyle}>Telefon</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--s-accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--s-border)')}
              />
            </div>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <label style={labelStyle}>E-mail *</label>
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--s-accent)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--s-border)')}
            />
          </div>
        </section>

        {/* Shipping address */}
        <section>
          <p style={sectionHeadStyle}>Doručovací adresa</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Ulice a číslo popisné *</label>
              <input required value={street} onChange={e => setStreet(e.target.value)} style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--s-accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--s-border)')}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr min(120px, 35%)', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Město *</label>
                <input required value={city} onChange={e => setCity(e.target.value)} style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--s-accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--s-border)')}
                />
              </div>
              <div>
                <label style={labelStyle}>PSČ *</label>
                <input required value={zip} onChange={e => setZip(e.target.value)} style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--s-accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--s-border)')}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Shipping method */}
        {shippingMethods.length > 0 && (
          <section>
            <p style={sectionHeadStyle}>Způsob dopravy</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {shippingMethods.map((m) => {
                const methodPrice = isFreeShipping ? 0 : m.cena_czk
                return (
                  <label key={m.type} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '0.625rem', padding: '0.75rem 1rem',
                    border: `1px solid ${shippingMethod === m.type ? 'var(--s-accent)' : 'var(--s-border)'}`,
                    borderRadius: 'var(--s-radius)', cursor: 'pointer',
                    background: shippingMethod === m.type ? 'rgba(var(--s-accent-rgb, 111,120,230),0.06)' : 'var(--s-surface)',
                    transition: 'border-color 0.15s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                      <input
                        type="radio" name="shipping" value={m.type}
                        checked={shippingMethod === m.type}
                        onChange={() => setShippingMethod(m.type)}
                        style={{ accentColor: 'var(--s-accent)' }}
                      />
                      <span style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.9375rem', color: 'var(--s-text)' }}>
                        {m.nazev ?? SHIPPING_LABELS[m.type] ?? m.type}
                      </span>
                    </div>
                    <span style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.9375rem', color: 'var(--s-muted)', fontWeight: 500 }}>
                      {methodPrice === 0 ? 'Zdarma' : `${currency} ${methodPrice.toFixed(2)}`}
                    </span>
                  </label>
                )
              })}
            </div>
          </section>
        )}

        {/* Payment method */}
        <section>
          <p style={sectionHeadStyle}>Způsob platby</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {hasStripe && paymentLabel('stripe', 'Platební karta (Stripe)')}
            {hasComgate && paymentLabel('comgate', 'Online platba (Comgate)')}
            {hasGopay && paymentLabel('gopay', 'Online platba (GoPay)')}
            {hasPayPal && paymentLabel('paypal', 'PayPal')}
            {hasDobirka && paymentLabel('dobirka', `Dobírka (+${currency} ${(payments?.dobirka?.priplatek_czk ?? 49).toFixed(2)})`)}
            {hasPrevod && paymentLabel('prevod', 'Bankovní převod')}
          </div>
        </section>

        {error && (
          <p style={{ color: '#ef4444', fontFamily: 'var(--s-font-body)', fontSize: '0.875rem', padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--s-radius)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </p>
        )}
      </div>

      {/* Right column — order summary (sticky only when columns are side by side) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignSelf: 'start' }}
        className="checkout-summary-sticky"
      >
        <style>{`.checkout-summary-sticky { position: static; } @media (min-width: 680px) { .checkout-summary-sticky { position: sticky; top: 5rem; } }`}</style>
        <div style={{
          background: 'var(--s-surface)', border: '1px solid var(--s-border)',
          borderRadius: 'var(--s-radius)', overflow: 'hidden',
        }}>
          <p style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--s-border)', fontFamily: 'var(--s-font-heading)', fontWeight: 700, fontSize: '1rem', color: 'var(--s-text)', margin: 0 }}>
            Souhrn objednávky
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((item) => (
              <li key={item.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                gap: '0.5rem', padding: '0.75rem 1.25rem',
                borderBottom: '1px solid var(--s-border)',
              }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.875rem', color: 'var(--s-text)', margin: 0 }}>
                    {item.name}
                    {item.variantLabel && <span style={{ color: 'var(--s-muted)' }}> · {item.variantLabel}</span>}
                  </p>
                  <p style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.8125rem', color: 'var(--s-muted)', margin: 0 }}>
                    × {item.quantity}
                  </p>
                </div>
                <span style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.9375rem', color: 'var(--s-text)', fontWeight: 500, flexShrink: 0 }}>
                  {currency} {(item.price * item.quantity).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          <div style={{ padding: '0.75rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.875rem', color: 'var(--s-muted)' }}>Mezisoučet</span>
              <span style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.875rem', color: 'var(--s-text)' }}>{currency} {total.toFixed(2)}</span>
            </div>
            {selectedShipping && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.875rem', color: 'var(--s-muted)' }}>Doprava</span>
                <span style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.875rem', color: isFreeShipping ? '#22c55e' : 'var(--s-text)' }}>
                  {isFreeShipping ? 'Zdarma' : `${currency} ${selectedShipping.cena_czk.toFixed(2)}`}
                </span>
              </div>
            )}
            {dobirkaFee > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.875rem', color: 'var(--s-muted)' }}>Dobírka</span>
                <span style={{ fontFamily: 'var(--s-font-body)', fontSize: '0.875rem', color: 'var(--s-text)' }}>{currency} {dobirkaFee.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', borderTop: '1px solid var(--s-border)', marginTop: '0.25rem' }}>
              <span style={{ fontFamily: 'var(--s-font-body)', fontWeight: 700, color: 'var(--s-text)' }}>Celkem</span>
              <span style={{ fontFamily: 'var(--s-font-body)', fontWeight: 700, fontSize: '1.125rem', color: 'var(--s-text)' }}>{currency} {orderTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: '1rem', background: submitting ? 'var(--s-muted)' : 'var(--s-accent)',
            color: 'var(--s-accent-text)', border: 'none',
            borderRadius: 'var(--s-radius)', fontWeight: 700,
            fontSize: '1rem', fontFamily: 'var(--s-font-body)',
            cursor: submitting ? 'not-allowed' : 'pointer',
            transition: 'opacity 0.15s',
          }}
        >
          {submitting ? 'Zpracovávám…' : 'Dokončit objednávku →'}
        </button>

        <p style={{ fontSize: '0.8125rem', color: 'var(--s-muted)', fontFamily: 'var(--s-font-body)', textAlign: 'center' }}>
          Kliknutím souhlasíte s obchodními podmínkami.
        </p>
      </div>
    </form>
  )
}

const SHIPPING_LABELS: Record<string, string> = {
  zasilkovna: 'Zásilkovna',
  packeta_international: 'Packeta International',
  dhl: 'DHL Express',
  ppl: 'PPL',
  dpd: 'DPD',
  balikovna: 'Balíkovna',
  osobni_odber: 'Osobní odběr',
  custom: 'Doručení',
}
