'use client'

import { useState, useEffect } from 'react'
import { validateIco } from '@/lib/ico-validator'
import {
  EMPTY_BUSINESS_INFO,
  EMPTY_PAYMENTS_INFO,
  EMPTY_SHIPPING_INFO,
  type BusinessInfo,
  type PaymentsInfo,
  type ShippingInfo,
} from '@/types/business'

interface Props {
  projectId: string
  onBalanceRefresh: () => void
}

// 2026-08-21: This panel used to read/write app/(app)/project/[id]/StudioClient.tsx's
// `currentManifest`, which is a permanent `null` stub left over from the code-gen
// architecture pivot ("Legacy compatibility stubs — keep panels from crashing during
// transition"). That made every Save button here a silent no-op for every code-gen
// store: `if (!manifest) return` fired on every click, no error shown. Even wiring a
// live manifest_versions fetch wouldn't have fixed it — ShopManifestSchema requires
// brand/design/catalog/pages/nav/footer/seo, none of which exist for a pure code-gen
// project, so a partial save would fail validation anyway.
//
// Fix: business/payments/shipping now live on project_secrets (merchant_json /
// payments_json / shipping_json — see supabase/migration-business-info.sql), read and
// written via the existing /api/project/secrets route, entirely independent of the
// legacy ShopManifest. This panel owns its own fetch + state instead of depending on a
// prop from the parent.
export function MerchantPanel({ projectId, onBalanceRefresh }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState<BusinessInfo>(EMPTY_BUSINESS_INFO)
  const [icoError, setIcoError] = useState('')
  const [aresLoading, setAresLoading] = useState(false)
  const [aresMsg, setAresMsg] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Storefront market & language — drives the checkout/cart/legal-page/cookie-banner
  // copy and currency/date formatting on the deployed store (lib/i18n.ts), separate
  // from the merchant's own business/tax country below. Defaults to what the AI set
  // at generation time; saving here overrides it and seeds future generations too
  // (see supabase/migration-store-market.sql).
  const [marketCountry, setMarketCountry] = useState('')
  const [marketLanguage, setMarketLanguage] = useState('')
  const [isSavingMarket, setIsSavingMarket] = useState(false)
  const [marketMsg, setMarketMsg] = useState('')
  const [emailFrom, setEmailFrom] = useState('')
  const [isSavingEmail, setIsSavingEmail] = useState(false)
  const [emailFromMsg, setEmailFromMsg] = useState('')
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [testEmailMsg, setTestEmailMsg] = useState('')

  // Payment methods
  const [payComgate, setPayComgate] = useState(false)
  const [payGopay, setPayGopay] = useState(false)
  const [payCod, setPayCod] = useState(false)
  const [payCodFee, setPayCodFee] = useState(0)
  const [payBankTransfer, setPayBankTransfer] = useState(true)

  // Shipping — CZ/SK carrier presets (most common case today) plus a generic
  // flat-rate fallback for every other market (Wave 1.5).
  const [shipZasilkovna, setShipZasilkovna] = useState(false)
  const [shipZasilkovnaPrice, setShipZasilkovnaPrice] = useState(79)
  const [shipPpl, setShipPpl] = useState(false)
  const [shipPplPrice, setShipPplPrice] = useState(159)
  const [shipDpd, setShipDpd] = useState(false)
  const [shipDpdPrice, setShipDpdPrice] = useState(149)
  const [shipBalikovna, setShipBalikovna] = useState(false)
  const [shipBalikovnaPrice, setShipBalikovnaPrice] = useState(89)
  const [shipCustomLabel, setShipCustomLabel] = useState('')
  const [shipCustomPrice, setShipCustomPrice] = useState(0)
  const [shipOsobni, setShipOsobni] = useState(false)
  const [freeShippingFrom, setFreeShippingFrom] = useState(0)
  const [isSavingPayShip, setIsSavingPayShip] = useState(false)
  const [payShipMsg, setPayShipMsg] = useState('')

  // Per-project payment gateway credentials
  const [comgateMerchantId, setComgateMerchantId] = useState('')
  const [comgateSecret, setComgateSecret] = useState('')
  const [hasComgateSecret, setHasComgateSecret] = useState(false)
  const [gopayGoId, setGopayGoId] = useState('')
  const [gopayClientId, setGopayClientId] = useState('')
  const [gopayClientSecret, setGopayClientSecret] = useState('')
  const [hasGopaySecret, setHasGopaySecret] = useState(false)
  const [paypalClientId, setPaypalClientId] = useState('')
  const [paypalClientSecret, setPaypalClientSecret] = useState('')
  const [hasPaypalSecret, setHasPaypalSecret] = useState(false)
  const [isSavingGateways, setIsSavingGateways] = useState(false)
  const [gatewaysMsg, setGatewaysMsg] = useState('')

  useEffect(() => {
    fetch(`/api/project/secrets?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.resendFromEmail) setEmailFrom(d.resendFromEmail)
        if (d.comgateMerchantId) setComgateMerchantId(d.comgateMerchantId)
        setHasComgateSecret(!!d.hasComgateSecret)
        if (d.gopayGoId) setGopayGoId(d.gopayGoId)
        if (d.gopayClientId) setGopayClientId(d.gopayClientId)
        setHasGopaySecret(!!d.hasGopaySecret)
        if (d.paypalClientId) setPaypalClientId(d.paypalClientId)
        setHasPaypalSecret(!!d.hasPaypalSecret)
        if (d.marketCountry) setMarketCountry(d.marketCountry)
        if (d.marketLanguage) setMarketLanguage(d.marketLanguage)

        const m = d.merchant as BusinessInfo | null
        if (m) setForm({ ...EMPTY_BUSINESS_INFO, ...m })

        const p = d.payments as PaymentsInfo | null
        if (p) {
          setPayComgate(p.providers?.includes('comgate') ?? false)
          setPayGopay(p.providers?.includes('gopay') ?? false)
          setPayCod(p.cod?.enabled ?? false)
          setPayCodFee(p.cod?.fee ?? 0)
          setPayBankTransfer(p.bankTransfer?.enabled ?? true)
        }

        const s = d.shipping as ShippingInfo | null
        if (s) {
          const z = s.methods?.find((x) => x.id === 'zasilkovna')
          if (z) { setShipZasilkovna(true); setShipZasilkovnaPrice(z.price) }
          const ppl = s.methods?.find((x) => x.id === 'ppl')
          if (ppl) { setShipPpl(true); setShipPplPrice(ppl.price) }
          const dpd = s.methods?.find((x) => x.id === 'dpd')
          if (dpd) { setShipDpd(true); setShipDpdPrice(dpd.price) }
          const bal = s.methods?.find((x) => x.id === 'balikovna')
          if (bal) { setShipBalikovna(true); setShipBalikovnaPrice(bal.price) }
          const custom = s.methods?.find((x) => x.id === 'custom')
          if (custom) { setShipCustomLabel(custom.label); setShipCustomPrice(custom.price) }
          setShipOsobni(s.pickupEnabled ?? false)
          setFreeShippingFrom(s.freeShippingFrom ?? 0)
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [projectId])

  function setField<K extends keyof BusinessInfo>(key: K, val: BusinessInfo[K]) {
    setForm((prev) => ({ ...prev, [key]: val }))
  }

  const isCz = form.country === 'CZ' || form.country === ''

  async function lookupAres() {
    const ico = form.taxId.replace(/\s/g, '')
    if (!validateIco(ico)) { setIcoError('Invalid IČO (check digit mismatch)'); return }
    setIcoError('')
    setAresLoading(true)
    setAresMsg('')
    try {
      const res = await fetch(`/api/ares?ico=${ico}`)
      if (!res.ok) { setAresMsg((await res.json()).error ?? 'IČO not found in ARES'); return }
      const data = await res.json()
      setForm((prev) => ({
        ...prev,
        name: data.obchodni_nazev || prev.name,
        vatId: data.dic || prev.vatId,
        street: data.sidlo?.ulice || prev.street,
        city: data.sidlo?.mesto || prev.city,
        postalCode: data.sidlo?.psc || prev.postalCode,
        country: 'CZ',
      }))
      setAresMsg('Data loaded from ARES')
    } catch {
      setAresMsg('Error loading from ARES')
    } finally {
      setAresLoading(false)
    }
  }

  function icoBlur() {
    if (!isCz) { setIcoError(''); return }
    const ico = form.taxId.replace(/\s/g, '')
    if (ico && !validateIco(ico)) setIcoError('Invalid IČO (check digit mismatch)')
    else setIcoError('')
  }

  async function saveMerchant() {
    if (isCz) {
      const ico = form.taxId.replace(/\s/g, '')
      if (ico && !validateIco(ico)) { setIcoError('Invalid IČO'); return }
    }
    setIsSaving(true)
    setSaveMsg('')
    try {
      const res = await fetch('/api/project/secrets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, merchant_json: form }),
      })
      if (!res.ok) { setSaveMsg('Failed to save'); return }
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(''), 2500)
    } catch {
      setSaveMsg('Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  async function saveMarket() {
    setIsSavingMarket(true)
    setMarketMsg('')
    try {
      const res = await fetch('/api/project/secrets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, market_country: marketCountry || null, market_language: marketLanguage || null }),
      })
      if (!res.ok) { setMarketMsg('Failed to save'); return }
      setMarketMsg('Saved — next generation/edit will use this')
      setTimeout(() => setMarketMsg(''), 3500)
    } catch {
      setMarketMsg('Failed to save')
    } finally {
      setIsSavingMarket(false)
    }
  }

  async function saveEmailFrom() {
    setIsSavingEmail(true)
    setEmailFromMsg('')
    try {
      const res = await fetch('/api/project/secrets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, resend_from_email: emailFrom || null }),
      })
      if (!res.ok) { setEmailFromMsg('Failed to save'); return }
      setEmailFromMsg(emailFrom ? 'Saved' : 'Reset to default (objednavky@quantecode.com)')
      setTimeout(() => setEmailFromMsg(''), 3000)
    } catch {
      setEmailFromMsg('Failed to save')
    } finally {
      setIsSavingEmail(false)
    }
  }

  async function sendTestEmail() {
    setIsSendingTest(true)
    setTestEmailMsg('')
    try {
      const res = await fetch('/api/quante/email-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await res.json()
      if (!res.ok) { setTestEmailMsg(data.error ?? 'Error'); return }
      setTestEmailMsg(`Test email sent to ${data.sentTo}`)
    } catch {
      setTestEmailMsg('Failed to send')
    } finally {
      setIsSendingTest(false)
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.4rem 0.6rem',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--foreground)',
    fontSize: 12,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  }

  async function savePaymentsShipping() {
    setIsSavingPayShip(true)
    setPayShipMsg('')
    try {
      const providers: Array<'comgate' | 'gopay'> = [
        ...(payComgate ? (['comgate'] as const) : []),
        ...(payGopay ? (['gopay'] as const) : []),
      ]
      const payments: PaymentsInfo = {
        providers,
        cod: { enabled: payCod, fee: payCodFee },
        bankTransfer: { enabled: payBankTransfer, qr: true },
      }
      const methods: ShippingInfo['methods'] = [
        ...(shipZasilkovna ? [{ id: 'zasilkovna', label: 'Zásilkovna / Packeta', price: shipZasilkovnaPrice }] : []),
        ...(shipPpl ? [{ id: 'ppl', label: 'PPL — home delivery', price: shipPplPrice }] : []),
        ...(shipDpd ? [{ id: 'dpd', label: 'DPD — home delivery', price: shipDpdPrice }] : []),
        ...(shipBalikovna ? [{ id: 'balikovna', label: 'Balíkovna', price: shipBalikovnaPrice }] : []),
        ...(shipCustomLabel.trim() ? [{ id: 'custom', label: shipCustomLabel.trim(), price: shipCustomPrice }] : []),
      ]
      const shipping: ShippingInfo = {
        methods,
        pickupEnabled: shipOsobni,
        freeShippingFrom,
      }
      const res = await fetch('/api/project/secrets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, payments_json: payments, shipping_json: shipping }),
      })
      if (!res.ok) { setPayShipMsg('Failed to save'); return }
      setPayShipMsg('Saved')
      setTimeout(() => setPayShipMsg(''), 2500)
    } catch {
      setPayShipMsg('Failed to save')
    } finally {
      setIsSavingPayShip(false)
    }
  }

  async function saveGatewayCredentials() {
    setIsSavingGateways(true)
    setGatewaysMsg('')
    try {
      const body: Record<string, string | null> = {
        comgate_merchant_id: comgateMerchantId.trim() || null,
        gopay_go_id: gopayGoId.trim() || null,
        gopay_client_id: gopayClientId.trim() || null,
        paypal_client_id: paypalClientId.trim() || null,
      }
      // Secrets are write-only — only send when the user typed a new value
      if (comgateSecret.trim()) body.comgate_secret = comgateSecret.trim()
      if (gopayClientSecret.trim()) body.gopay_client_secret = gopayClientSecret.trim()
      if (paypalClientSecret.trim()) body.paypal_client_secret = paypalClientSecret.trim()

      const res = await fetch('/api/project/secrets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...body }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setGatewaysMsg(d.error ?? 'Failed to save')
        return
      }
      if (comgateSecret.trim()) { setHasComgateSecret(true); setComgateSecret('') }
      if (gopayClientSecret.trim()) { setHasGopaySecret(true); setGopayClientSecret('') }
      if (paypalClientSecret.trim()) { setHasPaypalSecret(true); setPaypalClientSecret('') }
      setGatewaysMsg('Saved')
      setTimeout(() => setGatewaysMsg(''), 3000)
    } catch {
      setGatewaysMsg('Failed to save')
    } finally {
      setIsSavingGateways(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 10,
    fontWeight: 500,
    color: 'var(--muted-foreground)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '0.3rem',
  }

  const sectionHeadStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--foreground)',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottom: '1px solid var(--border)',
  }

  if (!loaded) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
        <p style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Loading…</p>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
        Business details are required for generating legal pages and invoicing.
        Without them the store cannot be published to a live domain.
      </p>

      {/* Storefront market & language */}
      <div>
        <p style={sectionHeadStyle}>Storefront market & language</p>
        <p style={{ fontSize: 10, color: 'var(--muted-foreground)', margin: '0 0 8px', lineHeight: 1.5 }}>
          Controls the language and formatting of checkout, cart, legal pages and the cookie banner on your live store — separate from your business address below. Quante infers this from your brief when generating the store; override it here if it guessed wrong.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={labelStyle}>Country</label>
            <select style={fieldStyle} value={marketCountry} onChange={(e) => setMarketCountry(e.target.value)}>
              <option value="">Auto (from generation)</option>
              <option value="US">United States</option>
              <option value="GB">United Kingdom</option>
              <option value="CZ">Czech Republic</option>
              <option value="SK">Slovakia</option>
              <option value="DE">Germany</option>
              <option value="FR">France</option>
              <option value="CA">Canada</option>
              <option value="AU">Australia</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Language</label>
            <select style={fieldStyle} value={marketLanguage} onChange={(e) => setMarketLanguage(e.target.value)}>
              <option value="">Auto (from generation)</option>
              <option value="en">English</option>
              <option value="cs">Čeština</option>
            </select>
          </div>
        </div>
        <button
          onClick={saveMarket}
          disabled={isSavingMarket}
          style={{ padding: '0.4rem 0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--foreground)', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: isSavingMarket ? 0.6 : 1 }}
        >
          {isSavingMarket ? 'Saving…' : 'Save market & language'}
        </button>
        {marketMsg && <p style={{ fontSize: 10, color: marketMsg.includes('Failed') ? '#f87171' : '#34d399', margin: '4px 0 0' }}>{marketMsg}</p>}
      </div>

      {/* Country + identification */}
      <div>
        <p style={sectionHeadStyle}>Identification</p>
        <div style={{ marginBottom: 8 }}>
          <label style={labelStyle}>Country *</label>
          <select
            style={fieldStyle}
            value={form.country}
            onChange={(e) => setField('country', e.target.value)}
          >
            <option value="">Select country…</option>
            <option value="CZ">Czech Republic</option>
            <option value="SK">Slovakia</option>
            <option value="US">United States</option>
            <option value="GB">United Kingdom</option>
            <option value="DE">Germany</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={labelStyle}>{isCz ? 'IČO *' : 'Company / registration number *'}</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                style={{ ...fieldStyle, flex: 1 }}
                value={form.taxId}
                onChange={(e) => { setField('taxId', isCz ? e.target.value.replace(/\D/g, '').slice(0, 8) : e.target.value); setIcoError('') }}
                onBlur={icoBlur}
                placeholder={isCz ? '12345678' : 'e.g. company number / EIN'}
                maxLength={isCz ? 8 : undefined}
              />
              {isCz && (
                <button
                  onClick={lookupAres}
                  disabled={aresLoading || form.taxId.length < 8}
                  style={{
                    padding: '0 8px',
                    background: 'rgba(111,120,230,0.15)',
                    border: '1px solid rgba(111,120,230,0.3)',
                    borderRadius: 6,
                    color: '#6f78e6',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    opacity: form.taxId.length < 8 ? 0.5 : 1,
                  }}
                >
                  {aresLoading ? '…' : 'ARES lookup'}
                </button>
              )}
            </div>
            {icoError && <p style={{ fontSize: 10, color: '#f87171', marginTop: 3 }}>{icoError}</p>}
            {aresMsg && <p style={{ fontSize: 10, color: aresMsg.includes('Error') || aresMsg.includes('not found') ? '#f87171' : '#34d399', marginTop: 3 }}>{aresMsg}</p>}
          </div>
          <div>
            <label style={labelStyle}>VAT number</label>
            <input
              style={fieldStyle}
              value={form.vatId ?? ''}
              onChange={(e) => setField('vatId', e.target.value)}
              placeholder={isCz ? 'CZ12345678' : 'e.g. EU VAT / sales tax ID'}
            />
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={labelStyle}>Business name *</label>
          <input
            style={fieldStyle}
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="Your Company Ltd."
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="vat_registered"
            checked={form.vatRegistered}
            onChange={(e) => setField('vatRegistered', e.target.checked)}
            style={{ margin: 0 }}
          />
          <label htmlFor="vat_registered" style={{ fontSize: 11, color: 'var(--foreground)', cursor: 'pointer' }}>
            VAT registered
          </label>
        </div>
      </div>

      {/* Address */}
      <div>
        <p style={sectionHeadStyle}>Registered address</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <label style={labelStyle}>Street and number *</label>
            <input style={fieldStyle} value={form.street} onChange={(e) => setField('street', e.target.value)} placeholder="Example Street 1" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 6 }}>
            <div>
              <label style={labelStyle}>City *</label>
              <input style={fieldStyle} value={form.city} onChange={(e) => setField('city', e.target.value)} placeholder="City" />
            </div>
            <div>
              <label style={labelStyle}>ZIP / postal code *</label>
              <input style={fieldStyle} value={form.postalCode} onChange={(e) => setField('postalCode', e.target.value)} placeholder="00000" maxLength={10} />
            </div>
          </div>
        </div>
      </div>

      {/* Contact */}
      <div>
        <p style={sectionHeadStyle}>Contact details</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <label style={labelStyle}>E-mail *</label>
            <input style={fieldStyle} type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="info@yourshop.com" />
          </div>
          <div>
            <label style={labelStyle}>Phone *</label>
            <input style={fieldStyle} type="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+1 555 123 4567" />
          </div>
        </div>
      </div>

      {/* Bank account */}
      <div>
        <p style={sectionHeadStyle}>Banking</p>
        <div>
          <label style={labelStyle}>Bank account (for bank transfer)</label>
          <input style={fieldStyle} value={form.bankAccount ?? ''} onChange={(e) => setField('bankAccount', e.target.value)} placeholder="IBAN or account number" />
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={saveMerchant}
          disabled={isSaving || !form.taxId || !form.name}
          style={{
            padding: '0.5rem 0.75rem',
            background: '#6f78e6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: isSaving || !form.taxId || !form.name ? 0.6 : 1,
          }}
        >
          {isSaving ? 'Saving…' : 'Save business data'}
        </button>
        {saveMsg && (
          <p style={{ fontSize: 10, color: saveMsg.includes('Failed') ? '#f87171' : '#34d399', margin: 0 }}>{saveMsg}</p>
        )}
      </div>

      {/* E-mail sender */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Transactional emails</p>
        <p style={{ fontSize: 10, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
          Customer emails are sent from <code style={{ fontSize: 9 }}>objednavky@quantecode.com</code> (default). For your own domain, verify it in Resend and enter the address below.
        </p>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            style={{ ...fieldStyle, flex: 1 }}
            type="email"
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder="orders@yourshop.com (optional)"
          />
          <button
            onClick={saveEmailFrom}
            disabled={isSavingEmail}
            style={{ padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--foreground)', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {isSavingEmail ? '…' : 'Save'}
          </button>
        </div>
        {emailFromMsg && <p style={{ fontSize: 10, color: emailFromMsg.includes('Failed') ? '#f87171' : '#34d399', margin: 0 }}>{emailFromMsg}</p>}
        <button
          onClick={sendTestEmail}
          disabled={isSendingTest || !form.email}
          style={{ padding: '0.4rem 0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--foreground)', opacity: isSendingTest || !form.email ? 0.5 : 1 }}
        >
          {isSendingTest ? 'Sending…' : 'Send test email →'}
        </button>
        {testEmailMsg && <p style={{ fontSize: 10, color: testEmailMsg.includes('Chyba') ? '#f87171' : '#34d399', margin: 0 }}>{testEmailMsg}</p>}
      </div>

      {/* Legal pages — always live at /terms, /privacy, /cookies, /contact; content is
          generated automatically from the business data above, no separate step needed. */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Legal pages</p>
        <p style={{ fontSize: 10, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
          {form.name
            ? 'Terms of Service, Privacy Policy, Cookies and Contact pages are live on your store and generated from the business data above — no separate step needed. Save changes above to update them.'
            : 'Save your business data above to fill in the Terms of Service, Privacy Policy, Cookies and Contact pages on your store.'}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: 'Terms', href: '/terms' },
            { label: 'Privacy', href: '/privacy' },
            { label: 'Cookies', href: '/cookies' },
            { label: 'Contact', href: '/contact' },
          ].map((p) => (
            <span key={p.href} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}>{p.label}</span>
          ))}
        </div>
        <p style={{ fontSize: 9, color: 'var(--muted-foreground)', margin: 0, fontStyle: 'italic', lineHeight: 1.5 }}>
          Templates are a starting point — the operator is ultimately responsible. We recommend a legal review.
        </p>
      </div>

      {/* Payment methods */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Payment methods</p>

        {/* Quante managed payments banner */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)' }}>
          <span style={{ fontSize: 12, marginTop: 1 }}>🔒</span>
          <div>
            <p style={{ fontSize: 10, fontWeight: 600, color: '#34d399', margin: '0 0 2px' }}>Payments managed by Quante</p>
            <p style={{ fontSize: 10, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
              Selected methods are automatically configured — no API keys required.
              Revenue appears in the <strong style={{ color: 'var(--foreground)' }}>Payouts</strong> tab and is paid out via bank transfer.
              Prefer receiving money directly? Enter your own gateway credentials in the section below.
            </p>
          </div>
        </div>

        {/* Stripe — always available via Quante */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(111,120,230,0.04)' }}>
          <span style={{ fontSize: 10, width: 14, textAlign: 'center', color: '#34d399' }}>✓</span>
          <span style={{ fontSize: 11, flex: 1 }}>Stripe — card, Apple Pay, Google Pay</span>
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(52,211,153,0.1)', color: '#34d399', fontWeight: 600, whiteSpace: 'nowrap' }}>Quante</span>
        </div>

        {isCz && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
              <input type="checkbox" id="pay_comgate" checked={payComgate} onChange={(e) => setPayComgate(e.target.checked)} style={{ margin: 0 }} />
              <label htmlFor="pay_comgate" style={{ fontSize: 11, cursor: 'pointer', flex: 1 }}>Comgate (card, Apple Pay, bank buttons)</label>
              {payComgate && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(52,211,153,0.1)', color: '#34d399', fontWeight: 600, whiteSpace: 'nowrap' }}>Quante</span>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
              <input type="checkbox" id="pay_gopay" checked={payGopay} onChange={(e) => setPayGopay(e.target.checked)} style={{ margin: 0 }} />
              <label htmlFor="pay_gopay" style={{ fontSize: 11, cursor: 'pointer', flex: 1 }}>GoPay (card, Google Pay, bank transfer)</label>
              {payGopay && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(52,211,153,0.1)', color: '#34d399', fontWeight: 600, whiteSpace: 'nowrap' }}>Quante</span>}
            </div>
          </>
        )}

        {/* Cash on delivery */}
        <div style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: payCod ? 6 : 0 }}>
            <input type="checkbox" id="pay_cod" checked={payCod} onChange={(e) => setPayCod(e.target.checked)} style={{ margin: 0 }} />
            <label htmlFor="pay_cod" style={{ fontSize: 11, cursor: 'pointer' }}>Cash on delivery</label>
          </div>
          {payCod && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 10, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>Surcharge:</label>
              <input style={{ ...fieldStyle, width: 80 }} type="number" min={0} value={payCodFee} onChange={(e) => setPayCodFee(Number(e.target.value))} />
            </div>
          )}
        </div>

        {/* Bank transfer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
          <input type="checkbox" id="pay_transfer" checked={payBankTransfer} onChange={(e) => setPayBankTransfer(e.target.checked)} style={{ margin: 0 }} />
          <label htmlFor="pay_transfer" style={{ fontSize: 11, cursor: 'pointer' }}>Bank transfer (QR code + payment instructions)</label>
        </div>
      </div>

      {/* Own gateway credentials */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Own gateway credentials (optional)</p>
        <p style={{ fontSize: 10, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
          By default payments run through Quante&apos;s accounts and revenue lands in the <strong style={{ color: 'var(--foreground)' }}>Payouts</strong> tab.
          Enter your own credentials below to receive money directly on your gateway account instead. Secrets are stored encrypted and never shown again.
        </p>

        {isCz && (
          <>
            {/* Comgate */}
            <div style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 10, fontWeight: 600, margin: 0 }}>Comgate</p>
              <input style={fieldStyle} value={comgateMerchantId} onChange={(e) => setComgateMerchantId(e.target.value)} placeholder="Merchant ID" />
              <input style={fieldStyle} type="password" value={comgateSecret} onChange={(e) => setComgateSecret(e.target.value)} placeholder={hasComgateSecret ? 'Secret saved — enter new value to replace' : 'Secret'} autoComplete="new-password" />
            </div>

            {/* GoPay */}
            <div style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 10, fontWeight: 600, margin: 0 }}>GoPay</p>
              <input style={fieldStyle} value={gopayGoId} onChange={(e) => setGopayGoId(e.target.value)} placeholder="GoID" />
              <input style={fieldStyle} value={gopayClientId} onChange={(e) => setGopayClientId(e.target.value)} placeholder="Client ID" />
              <input style={fieldStyle} type="password" value={gopayClientSecret} onChange={(e) => setGopayClientSecret(e.target.value)} placeholder={hasGopaySecret ? 'Client secret saved — enter new value to replace' : 'Client secret'} autoComplete="new-password" />
            </div>
          </>
        )}

        {/* PayPal */}
        <div style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ fontSize: 10, fontWeight: 600, margin: 0 }}>PayPal</p>
          <input style={fieldStyle} value={paypalClientId} onChange={(e) => setPaypalClientId(e.target.value)} placeholder="Client ID" />
          <input style={fieldStyle} type="password" value={paypalClientSecret} onChange={(e) => setPaypalClientSecret(e.target.value)} placeholder={hasPaypalSecret ? 'Client secret saved — enter new value to replace' : 'Client secret'} autoComplete="new-password" />
        </div>

        <button
          onClick={saveGatewayCredentials}
          disabled={isSavingGateways}
          style={{ padding: '0.4rem 0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--foreground)', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: isSavingGateways ? 0.6 : 1 }}
        >
          {isSavingGateways ? 'Saving…' : 'Save gateway credentials'}
        </button>
        {gatewaysMsg && <p style={{ fontSize: 10, color: gatewaysMsg === 'Saved' ? '#34d399' : '#f87171', margin: 0 }}>{gatewaysMsg}</p>}
      </div>

      {/* Shipping */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Shipping</p>
        {!isCz && (
          <p style={{ fontSize: 10, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
            The carriers below are common in Czechia/Slovakia. Use &quot;Custom carrier&quot; for any other market.
          </p>
        )}
        {[
          { id: 'zasilkovna', label: 'Zásilkovna / Packeta', enabled: shipZasilkovna, setEnabled: setShipZasilkovna, price: shipZasilkovnaPrice, setPrice: setShipZasilkovnaPrice },
          { id: 'ppl', label: 'PPL — home delivery', enabled: shipPpl, setEnabled: setShipPpl, price: shipPplPrice, setPrice: setShipPplPrice },
          { id: 'dpd', label: 'DPD — home delivery', enabled: shipDpd, setEnabled: setShipDpd, price: shipDpdPrice, setPrice: setShipDpdPrice },
          { id: 'balikovna', label: 'Balíkovna', enabled: shipBalikovna, setEnabled: setShipBalikovna, price: shipBalikovnaPrice, setPrice: setShipBalikovnaPrice },
        ].map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
            <input type="checkbox" id={`ship_${m.id}`} checked={m.enabled} onChange={(e) => m.setEnabled(e.target.checked)} style={{ margin: 0 }} />
            <label htmlFor={`ship_${m.id}`} style={{ fontSize: 11, cursor: 'pointer', flex: 1 }}>{m.label}</label>
            {m.enabled && (
              <input style={{ ...fieldStyle, width: 70, textAlign: 'right' }} type="number" min={0} value={m.price} onChange={(e) => m.setPrice(Number(e.target.value))} />
            )}
          </div>
        ))}
        {/* Generic flat-rate carrier — the fallback for any market */}
        <div style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ fontSize: 10, fontWeight: 600, margin: 0 }}>Custom carrier / flat-rate shipping</p>
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={{ ...fieldStyle, flex: 1 }} value={shipCustomLabel} onChange={(e) => setShipCustomLabel(e.target.value)} placeholder="e.g. Standard shipping" />
            <input style={{ ...fieldStyle, width: 80, textAlign: 'right' }} type="number" min={0} value={shipCustomPrice} onChange={(e) => setShipCustomPrice(Number(e.target.value))} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
          <input type="checkbox" id="ship_osobni" checked={shipOsobni} onChange={(e) => setShipOsobni(e.target.checked)} style={{ margin: 0 }} />
          <label htmlFor="ship_osobni" style={{ fontSize: 11, cursor: 'pointer' }}>Local pickup (free)</label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 10, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>Free shipping from:</label>
          <input style={{ ...fieldStyle, width: 90 }} type="number" min={0} value={freeShippingFrom} onChange={(e) => setFreeShippingFrom(Number(e.target.value))} placeholder="0 = off" />
        </div>
      </div>

      {/* Save payments + shipping */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={savePaymentsShipping}
          disabled={isSavingPayShip}
          style={{
            padding: '0.5rem 0.75rem',
            background: '#6f78e6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: isSavingPayShip ? 0.6 : 1,
          }}
        >
          {isSavingPayShip ? 'Saving…' : 'Save payments & shipping'}
        </button>
        {payShipMsg && <p style={{ fontSize: 10, color: payShipMsg.includes('Failed') ? '#f87171' : '#34d399', margin: 0 }}>{payShipMsg}</p>}
      </div>
    </div>
  )
}
