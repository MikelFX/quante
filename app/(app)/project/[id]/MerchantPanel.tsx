'use client'

import { useState, useEffect } from 'react'
import { validateIco } from '@/lib/ico-validator'
import type { ShopManifest, Merchant, ShippingMethod } from '@/types/manifest'

interface Props {
  projectId: string
  manifest: ShopManifest | null
  onManifestUpdate: (manifest: ShopManifest) => void
  onBalanceRefresh: () => void
}

const EMPTY_MERCHANT: Merchant = {
  obchodni_nazev: '',
  ico: '',
  dic: '',
  platce_dph: false,
  sidlo: { ulice: '', mesto: '', psc: '', zeme: 'CZ' },
  kontakt: { email: '', telefon: '' },
  bankovni_ucet: '',
  zodpovedna_osoba: '',
}

export function MerchantPanel({ projectId, manifest, onManifestUpdate, onBalanceRefresh }: Props) {
  const [form, setForm] = useState<Merchant>(manifest?.merchant ?? EMPTY_MERCHANT)
  const [icoError, setIcoError] = useState('')
  const [aresLoading, setAresLoading] = useState(false)
  const [aresMsg, setAresMsg] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isGeneratingLegal, setIsGeneratingLegal] = useState(false)
  const [legalMsg, setLegalMsg] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [emailFrom, setEmailFrom] = useState('')
  const [isSavingEmail, setIsSavingEmail] = useState(false)
  const [emailFromMsg, setEmailFromMsg] = useState('')
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [testEmailMsg, setTestEmailMsg] = useState('')

  // Payment methods
  const [payComgate, setPayComgate] = useState(false)
  const [payGopay, setPayGopay] = useState(false)
  const [payDobirka, setPayDobirka] = useState(false)
  const [payDobirkaFee, setPayDobirkaFee] = useState(49)
  const [payPrevod, setPayPrevod] = useState(true)

  // Shipping
  const [shipZasilkovna, setShipZasilkovna] = useState(false)
  const [shipZasilkovnaPrice, setShipZasilkovnaPrice] = useState(79)
  const [shipPpl, setShipPpl] = useState(false)
  const [shipPplPrice, setShipPplPrice] = useState(159)
  const [shipDpd, setShipDpd] = useState(false)
  const [shipDpdPrice, setShipDpdPrice] = useState(149)
  const [shipBalikovna, setShipBalikovna] = useState(false)
  const [shipBalikovnaPrice, setShipBalikovnaPrice] = useState(89)
  const [shipOsobni, setShipOsobni] = useState(false)
  const [freeShippingFrom, setFreeShippingFrom] = useState(0)
  const [isSavingPayShip, setIsSavingPayShip] = useState(false)
  const [payShipMsg, setPayShipMsg] = useState('')

  useEffect(() => {
    if (manifest?.merchant) setForm(manifest.merchant)
    if (manifest?.payments) {
      const p = manifest.payments
      setPayComgate(p.providers.includes('comgate'))
      setPayGopay(p.providers.includes('gopay'))
      setPayDobirka(p.dobirka?.enabled ?? false)
      setPayDobirkaFee(p.dobirka?.priplatek_czk ?? 49)
      setPayPrevod(p.prevod?.enabled ?? true)
    }
    if (manifest?.shipping) {
      const s = manifest.shipping
      const z = s.methods.find((m) => m.type === 'zasilkovna')
      if (z) { setShipZasilkovna(true); setShipZasilkovnaPrice(z.cena_czk) }
      const ppl = s.methods.find((m) => m.type === 'ppl')
      if (ppl) { setShipPpl(true); setShipPplPrice(ppl.cena_czk) }
      const dpd = s.methods.find((m) => m.type === 'dpd')
      if (dpd) { setShipDpd(true); setShipDpdPrice(dpd.cena_czk) }
      const bal = s.methods.find((m) => m.type === 'balikovna')
      if (bal) { setShipBalikovna(true); setShipBalikovnaPrice(bal.cena_czk) }
      const osob = s.methods.find((m) => m.type === 'osobni_odber')
      if (osob) setShipOsobni(true)
      setFreeShippingFrom(s.doprava_zdarma_od_czk ?? 0)
    }
  }, [manifest])

  useEffect(() => {
    fetch(`/api/project/secrets?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => { if (d.resendFromEmail) setEmailFrom(d.resendFromEmail) })
      .catch(() => {})
  }, [projectId])

  function setField<K extends keyof Merchant>(key: K, val: Merchant[K]) {
    setForm((prev) => ({ ...prev, [key]: val }))
  }

  function setKontakt(key: 'email' | 'telefon', val: string) {
    setForm((prev) => ({ ...prev, kontakt: { ...prev.kontakt, [key]: val } }))
  }

  function setSidlo(key: keyof Merchant['sidlo'], val: string) {
    setForm((prev) => ({ ...prev, sidlo: { ...prev.sidlo, [key]: val } }))
  }

  async function lookupAres() {
    const ico = form.ico.replace(/\s/g, '')
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
        obchodni_nazev: data.obchodni_nazev || prev.obchodni_nazev,
        dic: data.dic || prev.dic,
        sidlo: {
          ulice: data.sidlo.ulice || prev.sidlo.ulice,
          mesto: data.sidlo.mesto || prev.sidlo.mesto,
          psc: data.sidlo.psc || prev.sidlo.psc,
          zeme: 'CZ',
        },
      }))
      setAresMsg('Data loaded from ARES')
    } catch {
      setAresMsg('Error loading from ARES')
    } finally {
      setAresLoading(false)
    }
  }

  function icoBlur() {
    const ico = form.ico.replace(/\s/g, '')
    if (ico && !validateIco(ico)) setIcoError('Invalid IČO (check digit mismatch)')
    else setIcoError('')
  }

  async function saveMerchant() {
    if (!manifest) return
    const ico = form.ico.replace(/\s/g, '')
    if (!validateIco(ico)) { setIcoError('Invalid IČO'); return }
    setIsSaving(true)
    setSaveMsg('')
    try {
      const updatedManifest: ShopManifest = { ...manifest, merchant: { ...form, ico } }
      const res = await fetch('/api/manifest/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, manifest: updatedManifest }),
      })
      if (!res.ok) { setSaveMsg('Failed to save'); return }
      const { manifest: saved } = await res.json()
      onManifestUpdate(saved)
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(''), 2500)
    } catch {
      setSaveMsg('Failed to save')
    } finally {
      setIsSaving(false)
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
      setEmailFromMsg(emailFrom ? 'Saved' : 'Reset to default (objednavky@quante.io)')
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

  async function generateLegalPages() {
    if (!manifest?.merchant) { setLegalMsg('Save business data first'); return }
    setIsGeneratingLegal(true)
    setLegalMsg('')
    try {
      const res = await fetch('/api/quante/legal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (!res.ok) { setLegalMsg((await res.json()).error ?? 'Error'); return }
      const { manifest: updated } = await res.json()
      onManifestUpdate(updated)
      onBalanceRefresh()
      setLegalMsg('Legal pages generated and added to the store')
    } catch {
      setLegalMsg('Generation failed')
    } finally {
      setIsGeneratingLegal(false)
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
    if (!manifest) return
    setIsSavingPayShip(true)
    setPayShipMsg('')
    try {
      const providers: Array<'comgate' | 'gopay'> = [
        ...(payComgate ? (['comgate'] as const) : []),
        ...(payGopay ? (['gopay'] as const) : []),
      ]
      const methods: ShippingMethod[] = [
        ...(shipZasilkovna ? [{ type: 'zasilkovna' as const, cena_czk: shipZasilkovnaPrice }] : []),
        ...(shipPpl ? [{ type: 'ppl' as const, cena_czk: shipPplPrice }] : []),
        ...(shipDpd ? [{ type: 'dpd' as const, cena_czk: shipDpdPrice }] : []),
        ...(shipBalikovna ? [{ type: 'balikovna' as const, cena_czk: shipBalikovnaPrice }] : []),
        ...(shipOsobni ? [{ type: 'osobni_odber' as const, cena_czk: 0 }] : []),
      ]
      const updatedManifest: ShopManifest = {
        ...manifest,
        payments: {
          providers,
          ...(payDobirka ? { dobirka: { enabled: true, priplatek_czk: payDobirkaFee } } : {}),
          ...(payPrevod ? { prevod: { enabled: true, qr: true } } : {}),
        },
        shipping: {
          methods,
          ...(freeShippingFrom > 0 ? { doprava_zdarma_od_czk: freeShippingFrom } : {}),
        },
      }
      const res = await fetch('/api/manifest/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, manifest: updatedManifest }),
      })
      if (!res.ok) { setPayShipMsg('Failed to save'); return }
      const { manifest: saved } = await res.json()
      onManifestUpdate(saved)
      setPayShipMsg('Saved')
      setTimeout(() => setPayShipMsg(''), 2500)
    } catch {
      setPayShipMsg('Failed to save')
    } finally {
      setIsSavingPayShip(false)
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

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
        Business details are required for generating legal pages and invoicing.
        Without them the store cannot be published to a live domain.
      </p>

      {/* IČO + ARES */}
      <div>
        <p style={sectionHeadStyle}>Identification</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={labelStyle}>IČO *</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                style={{ ...fieldStyle, flex: 1 }}
                value={form.ico}
                onChange={(e) => { setField('ico', e.target.value.replace(/\D/g, '').slice(0, 8)); setIcoError('') }}
                onBlur={icoBlur}
                placeholder="12345678"
                maxLength={8}
              />
              <button
                onClick={lookupAres}
                disabled={aresLoading || form.ico.length < 8}
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
                  opacity: form.ico.length < 8 ? 0.5 : 1,
                }}
              >
                {aresLoading ? '…' : 'ARES'}
              </button>
            </div>
            {icoError && <p style={{ fontSize: 10, color: '#f87171', marginTop: 3 }}>{icoError}</p>}
            {aresMsg && <p style={{ fontSize: 10, color: aresMsg.includes('Error') || aresMsg.includes('not found') ? '#f87171' : '#34d399', marginTop: 3 }}>{aresMsg}</p>}
          </div>
          <div>
            <label style={labelStyle}>DIČ</label>
            <input
              style={fieldStyle}
              value={form.dic ?? ''}
              onChange={(e) => setField('dic', e.target.value)}
              placeholder="CZ12345678"
            />
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={labelStyle}>Business name *</label>
          <input
            style={fieldStyle}
            value={form.obchodni_nazev}
            onChange={(e) => setField('obchodni_nazev', e.target.value)}
            placeholder="My Company s.r.o."
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="platce_dph"
            checked={form.platce_dph}
            onChange={(e) => setField('platce_dph', e.target.checked)}
            style={{ margin: 0 }}
          />
          <label htmlFor="platce_dph" style={{ fontSize: 11, color: 'var(--foreground)', cursor: 'pointer' }}>
            VAT registered
          </label>
        </div>
      </div>

      {/* Sídlo */}
      <div>
        <p style={sectionHeadStyle}>Registered address</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <label style={labelStyle}>Street and number *</label>
            <input style={fieldStyle} value={form.sidlo.ulice} onChange={(e) => setSidlo('ulice', e.target.value)} placeholder="Example Street 1" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 6 }}>
            <div>
              <label style={labelStyle}>City *</label>
              <input style={fieldStyle} value={form.sidlo.mesto} onChange={(e) => setSidlo('mesto', e.target.value)} placeholder="Prague" />
            </div>
            <div>
              <label style={labelStyle}>ZIP *</label>
              <input style={fieldStyle} value={form.sidlo.psc} onChange={(e) => setSidlo('psc', e.target.value)} placeholder="11000" maxLength={6} />
            </div>
          </div>
        </div>
      </div>

      {/* Kontakt */}
      <div>
        <p style={sectionHeadStyle}>Contact details</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <label style={labelStyle}>E-mail *</label>
            <input style={fieldStyle} type="email" value={form.kontakt.email} onChange={(e) => setKontakt('email', e.target.value)} placeholder="info@mujshop.cz" />
          </div>
          <div>
            <label style={labelStyle}>Phone *</label>
            <input style={fieldStyle} type="tel" value={form.kontakt.telefon} onChange={(e) => setKontakt('telefon', e.target.value)} placeholder="+420 777 123 456" />
          </div>
        </div>
      </div>

      {/* Bankovní účet */}
      <div>
        <p style={sectionHeadStyle}>Banking</p>
        <div>
          <label style={labelStyle}>Bank account (for bank transfer)</label>
          <input style={fieldStyle} value={form.bankovni_ucet ?? ''} onChange={(e) => setField('bankovni_ucet', e.target.value)} placeholder="123456789/0800" />
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={saveMerchant}
          disabled={isSaving || !form.ico || !form.obchodni_nazev}
          style={{
            padding: '0.5rem 0.75rem',
            background: '#6f78e6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: isSaving || !form.ico || !form.obchodni_nazev ? 0.6 : 1,
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
          Customer emails are sent from <code style={{ fontSize: 9 }}>objednavky@quante.io</code> (default). For your own domain, verify it in Resend and enter the address below.
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
          disabled={isSendingTest || !manifest?.merchant?.kontakt?.email}
          style={{ padding: '0.4rem 0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--foreground)', opacity: isSendingTest || !manifest?.merchant?.kontakt?.email ? 0.5 : 1 }}
        >
          {isSendingTest ? 'Sending…' : 'Send test email →'}
        </button>
        {testEmailMsg && <p style={{ fontSize: 10, color: testEmailMsg.includes('Chyba') ? '#f87171' : '#34d399', margin: 0 }}>{testEmailMsg}</p>}
      </div>

      {/* Legal pages */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Legal pages</p>
        <p style={{ fontSize: 10, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
          Generates 4 required pages (Terms of Service, GDPR, Cookies, Contact) from your business data and adds them to the store. Templates are deterministic — regenerate after changing data.
        </p>
        <button
          onClick={generateLegalPages}
          disabled={isGeneratingLegal || !manifest?.merchant}
          style={{
            padding: '0.5rem 0.75rem',
            background: manifest?.merchant ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${manifest?.merchant ? 'rgba(52,211,153,0.3)' : 'var(--border)'}`,
            borderRadius: 6,
            color: manifest?.merchant ? '#34d399' : 'var(--muted-foreground)',
            fontSize: 12,
            fontWeight: 600,
            cursor: manifest?.merchant ? 'pointer' : 'not-allowed',
            opacity: isGeneratingLegal ? 0.6 : 1,
          }}
        >
          {isGeneratingLegal ? 'Generating…' : 'Generate legal pages'}
        </button>
        {legalMsg && (
          <p style={{ fontSize: 10, color: legalMsg.includes('failed') || legalMsg.includes('first') ? '#f87171' : '#34d399', margin: 0 }}>
            {legalMsg}
          </p>
        )}
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
              Revenue appears in the <strong style={{ color: 'var(--foreground)' }}>Payouts</strong> tab and is paid out via IBAN transfer.
              Custom API keys (Stripe, Comgate, GoPay) are set after export in <code style={{ fontSize: 9 }}>.env.local</code>.
            </p>
          </div>
        </div>

        {/* Stripe — always available via Quante */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(111,120,230,0.04)' }}>
          <span style={{ fontSize: 10, width: 14, textAlign: 'center', color: '#34d399' }}>✓</span>
          <span style={{ fontSize: 11, flex: 1 }}>Stripe — card, Apple Pay, Google Pay</span>
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(52,211,153,0.1)', color: '#34d399', fontWeight: 600, whiteSpace: 'nowrap' }}>Quante</span>
        </div>

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

        {/* Dobírka */}
        <div style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: payDobirka ? 6 : 0 }}>
            <input type="checkbox" id="pay_dobirka" checked={payDobirka} onChange={(e) => setPayDobirka(e.target.checked)} style={{ margin: 0 }} />
            <label htmlFor="pay_dobirka" style={{ fontSize: 11, cursor: 'pointer' }}>Cash on delivery</label>
          </div>
          {payDobirka && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 10, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>Surcharge (CZK):</label>
              <input style={{ ...fieldStyle, width: 80 }} type="number" min={0} value={payDobirkaFee} onChange={(e) => setPayDobirkaFee(Number(e.target.value))} />
            </div>
          )}
        </div>

        {/* Bankovní převod */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
          <input type="checkbox" id="pay_prevod" checked={payPrevod} onChange={(e) => setPayPrevod(e.target.checked)} style={{ margin: 0 }} />
          <label htmlFor="pay_prevod" style={{ fontSize: 11, cursor: 'pointer' }}>Bank transfer (QR code + payment instructions)</label>
        </div>
      </div>

      {/* Shipping */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Shipping</p>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input style={{ ...fieldStyle, width: 70, textAlign: 'right' }} type="number" min={0} value={m.price} onChange={(e) => m.setPrice(Number(e.target.value))} />
                <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>Kč</span>
              </div>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
          <input type="checkbox" id="ship_osobni" checked={shipOsobni} onChange={(e) => setShipOsobni(e.target.checked)} style={{ margin: 0 }} />
          <label htmlFor="ship_osobni" style={{ fontSize: 11, cursor: 'pointer' }}>Pickup in person (free)</label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 10, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>Free shipping from (CZK):</label>
          <input style={{ ...fieldStyle, width: 90 }} type="number" min={0} value={freeShippingFrom} onChange={(e) => setFreeShippingFrom(Number(e.target.value))} placeholder="0 = off" />
        </div>
      </div>

      {/* Save payments + shipping */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={savePaymentsShipping}
          disabled={isSavingPayShip || !manifest}
          style={{
            padding: '0.5rem 0.75rem',
            background: '#6f78e6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: isSavingPayShip || !manifest ? 0.6 : 1,
          }}
        >
          {isSavingPayShip ? 'Saving…' : 'Save payments & shipping'}
        </button>
        {payShipMsg && <p style={{ fontSize: 10, color: payShipMsg.includes('Failed') ? '#f87171' : '#34d399', margin: 0 }}>{payShipMsg}</p>}
      </div>
    </div>
  )
}
