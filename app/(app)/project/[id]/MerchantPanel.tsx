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
    if (!validateIco(ico)) { setIcoError('Neplatné IČO (kontrolní číslice nesouhlasí)'); return }
    setIcoError('')
    setAresLoading(true)
    setAresMsg('')
    try {
      const res = await fetch(`/api/ares?ico=${ico}`)
      if (!res.ok) { setAresMsg((await res.json()).error ?? 'IČO nenalezeno v ARES'); return }
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
      setAresMsg('Data načtena z ARES')
    } catch {
      setAresMsg('Chyba při načítání z ARES')
    } finally {
      setAresLoading(false)
    }
  }

  function icoBlur() {
    const ico = form.ico.replace(/\s/g, '')
    if (ico && !validateIco(ico)) setIcoError('Neplatné IČO (kontrolní číslice nesouhlasí)')
    else setIcoError('')
  }

  async function saveMerchant() {
    if (!manifest) return
    const ico = form.ico.replace(/\s/g, '')
    if (!validateIco(ico)) { setIcoError('Neplatné IČO'); return }
    setIsSaving(true)
    setSaveMsg('')
    try {
      const updatedManifest: ShopManifest = { ...manifest, merchant: { ...form, ico } }
      const res = await fetch('/api/manifest/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, manifest: updatedManifest }),
      })
      if (!res.ok) { setSaveMsg('Chyba při ukládání'); return }
      const { manifest: saved } = await res.json()
      onManifestUpdate(saved)
      setSaveMsg('Uloženo')
      setTimeout(() => setSaveMsg(''), 2500)
    } catch {
      setSaveMsg('Chyba při ukládání')
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
      if (!res.ok) { setEmailFromMsg('Chyba při ukládání'); return }
      setEmailFromMsg(emailFrom ? 'Uloženo' : 'Obnoveno na výchozí (objednavky@quante.io)')
      setTimeout(() => setEmailFromMsg(''), 3000)
    } catch {
      setEmailFromMsg('Chyba při ukládání')
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
      if (!res.ok) { setTestEmailMsg(data.error ?? 'Chyba'); return }
      setTestEmailMsg(`Testovací e-mail odeslán na ${data.sentTo}`)
    } catch {
      setTestEmailMsg('Chyba při odesílání')
    } finally {
      setIsSendingTest(false)
    }
  }

  async function generateLegalPages() {
    if (!manifest?.merchant) { setLegalMsg('Nejdříve uložte firemní data'); return }
    setIsGeneratingLegal(true)
    setLegalMsg('')
    try {
      const res = await fetch('/api/quante/legal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (!res.ok) { setLegalMsg((await res.json()).error ?? 'Chyba'); return }
      const { manifest: updated } = await res.json()
      onManifestUpdate(updated)
      onBalanceRefresh()
      setLegalMsg('Právní stránky vygenerovány a přidány do obchodu')
    } catch {
      setLegalMsg('Chyba při generování')
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
      if (!res.ok) { setPayShipMsg('Chyba při ukládání'); return }
      const { manifest: saved } = await res.json()
      onManifestUpdate(saved)
      setPayShipMsg('Uloženo')
      setTimeout(() => setPayShipMsg(''), 2500)
    } catch {
      setPayShipMsg('Chyba při ukládání')
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
        Firemní údaje jsou povinné pro generování právních stránek a fakturace.
        Bez nich nelze shop publikovat na ostrou doménu.
      </p>

      {/* IČO + ARES */}
      <div>
        <p style={sectionHeadStyle}>Identifikace</p>
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
            {aresMsg && <p style={{ fontSize: 10, color: aresMsg.includes('Chyba') || aresMsg.includes('nenalezeno') ? '#f87171' : '#34d399', marginTop: 3 }}>{aresMsg}</p>}
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
          <label style={labelStyle}>Obchodní název *</label>
          <input
            style={fieldStyle}
            value={form.obchodni_nazev}
            onChange={(e) => setField('obchodni_nazev', e.target.value)}
            placeholder="Moje firma s.r.o."
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
            Plátce DPH
          </label>
        </div>
      </div>

      {/* Sídlo */}
      <div>
        <p style={sectionHeadStyle}>Sídlo</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <label style={labelStyle}>Ulice a číslo popisné *</label>
            <input style={fieldStyle} value={form.sidlo.ulice} onChange={(e) => setSidlo('ulice', e.target.value)} placeholder="Příkladná 1" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 6 }}>
            <div>
              <label style={labelStyle}>Město *</label>
              <input style={fieldStyle} value={form.sidlo.mesto} onChange={(e) => setSidlo('mesto', e.target.value)} placeholder="Praha" />
            </div>
            <div>
              <label style={labelStyle}>PSČ *</label>
              <input style={fieldStyle} value={form.sidlo.psc} onChange={(e) => setSidlo('psc', e.target.value)} placeholder="11000" maxLength={6} />
            </div>
          </div>
        </div>
      </div>

      {/* Kontakt */}
      <div>
        <p style={sectionHeadStyle}>Kontaktní údaje</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <label style={labelStyle}>E-mail *</label>
            <input style={fieldStyle} type="email" value={form.kontakt.email} onChange={(e) => setKontakt('email', e.target.value)} placeholder="info@mujshop.cz" />
          </div>
          <div>
            <label style={labelStyle}>Telefon *</label>
            <input style={fieldStyle} type="tel" value={form.kontakt.telefon} onChange={(e) => setKontakt('telefon', e.target.value)} placeholder="+420 777 123 456" />
          </div>
        </div>
      </div>

      {/* Bankovní účet */}
      <div>
        <p style={sectionHeadStyle}>Platební údaje</p>
        <div>
          <label style={labelStyle}>Bankovní účet (pro bankovní převod)</label>
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
          {isSaving ? 'Ukládám…' : 'Uložit firemní data'}
        </button>
        {saveMsg && (
          <p style={{ fontSize: 10, color: saveMsg.includes('Chyba') ? '#f87171' : '#34d399', margin: 0 }}>{saveMsg}</p>
        )}
      </div>

      {/* E-mail sender */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Transakční e-maily</p>
        <p style={{ fontSize: 10, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
          E-maily zákazníkům jsou odesílány od <code style={{ fontSize: 9 }}>objednavky@quante.io</code> (výchozí). Pro vlastní doménu ověřte ji v Resend a zadejte adresu níže.
        </p>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            style={{ ...fieldStyle, flex: 1 }}
            type="email"
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder="objednavky@vasshop.cz (volitelné)"
          />
          <button
            onClick={saveEmailFrom}
            disabled={isSavingEmail}
            style={{ padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--foreground)', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {isSavingEmail ? '…' : 'Uložit'}
          </button>
        </div>
        {emailFromMsg && <p style={{ fontSize: 10, color: emailFromMsg.includes('Chyba') ? '#f87171' : '#34d399', margin: 0 }}>{emailFromMsg}</p>}
        <button
          onClick={sendTestEmail}
          disabled={isSendingTest || !manifest?.merchant?.kontakt?.email}
          style={{ padding: '0.4rem 0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--foreground)', opacity: isSendingTest || !manifest?.merchant?.kontakt?.email ? 0.5 : 1 }}
        >
          {isSendingTest ? 'Odesílám…' : 'Odeslat testovací e-mail →'}
        </button>
        {testEmailMsg && <p style={{ fontSize: 10, color: testEmailMsg.includes('Chyba') ? '#f87171' : '#34d399', margin: 0 }}>{testEmailMsg}</p>}
      </div>

      {/* Legal pages */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Právní stránky</p>
        <p style={{ fontSize: 10, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
          Vygeneruje 4 povinné stránky (Obchodní podmínky, GDPR, Cookies, Kontakt) z vašich firemních dat a přidá je do obchodu. Šablony jsou deterministické — lze je znovu vygenerovat po změně dat.
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
          {isGeneratingLegal ? 'Generuji…' : 'Generovat právní stránky'}
        </button>
        {legalMsg && (
          <p style={{ fontSize: 10, color: legalMsg.includes('Chyba') || legalMsg.includes('Nejdříve') ? '#f87171' : '#34d399', margin: 0 }}>
            {legalMsg}
          </p>
        )}
        <p style={{ fontSize: 9, color: 'var(--muted-foreground)', margin: 0, fontStyle: 'italic', lineHeight: 1.5 }}>
          Šablony jsou základ — finální odpovědnost nese provozovatel. Doporučujeme kontrolu právníkem.
        </p>
      </div>

      {/* Payment methods */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Platební metody</p>

        {/* Quante managed payments banner */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)' }}>
          <span style={{ fontSize: 12, marginTop: 1 }}>🔒</span>
          <div>
            <p style={{ fontSize: 10, fontWeight: 600, color: '#34d399', margin: '0 0 2px' }}>Platby zajišťuje Quante</p>
            <p style={{ fontSize: 10, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
              Vybrané metody jsou automaticky nakonfigurovány — žádné API klíče nepotřebujete.
              Výnosy se zobrazí na záložce <strong style={{ color: 'var(--foreground)' }}>Výplaty</strong> a vyplatíte je převodem na IBAN.
              Vlastní API (Stripe, Comgate, GoPay) nastavíte až po exportu v souboru <code style={{ fontSize: 9 }}>.env.local</code>.
            </p>
          </div>
        </div>

        {/* Stripe — always available via Quante */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(111,120,230,0.04)' }}>
          <span style={{ fontSize: 10, width: 14, textAlign: 'center', color: '#34d399' }}>✓</span>
          <span style={{ fontSize: 11, flex: 1 }}>Stripe — karta, Apple Pay, Google Pay</span>
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(52,211,153,0.1)', color: '#34d399', fontWeight: 600, whiteSpace: 'nowrap' }}>Quante</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
          <input type="checkbox" id="pay_comgate" checked={payComgate} onChange={(e) => setPayComgate(e.target.checked)} style={{ margin: 0 }} />
          <label htmlFor="pay_comgate" style={{ fontSize: 11, cursor: 'pointer', flex: 1 }}>Comgate (karta, Apple Pay, bankovní tlačítka)</label>
          {payComgate && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(52,211,153,0.1)', color: '#34d399', fontWeight: 600, whiteSpace: 'nowrap' }}>Quante</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
          <input type="checkbox" id="pay_gopay" checked={payGopay} onChange={(e) => setPayGopay(e.target.checked)} style={{ margin: 0 }} />
          <label htmlFor="pay_gopay" style={{ fontSize: 11, cursor: 'pointer', flex: 1 }}>GoPay (karta, Google Pay, bankovní převod)</label>
          {payGopay && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(52,211,153,0.1)', color: '#34d399', fontWeight: 600, whiteSpace: 'nowrap' }}>Quante</span>}
        </div>

        {/* Dobírka */}
        <div style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: payDobirka ? 6 : 0 }}>
            <input type="checkbox" id="pay_dobirka" checked={payDobirka} onChange={(e) => setPayDobirka(e.target.checked)} style={{ margin: 0 }} />
            <label htmlFor="pay_dobirka" style={{ fontSize: 11, cursor: 'pointer' }}>Dobírka (platba při převzetí)</label>
          </div>
          {payDobirka && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 10, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>Příplatek (Kč):</label>
              <input style={{ ...fieldStyle, width: 80 }} type="number" min={0} value={payDobirkaFee} onChange={(e) => setPayDobirkaFee(Number(e.target.value))} />
            </div>
          )}
        </div>

        {/* Bankovní převod */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
          <input type="checkbox" id="pay_prevod" checked={payPrevod} onChange={(e) => setPayPrevod(e.target.checked)} style={{ margin: 0 }} />
          <label htmlFor="pay_prevod" style={{ fontSize: 11, cursor: 'pointer' }}>Bankovní převod (QR kód + platební instrukce)</label>
        </div>
      </div>

      {/* Shipping */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>Doprava</p>
        {[
          { id: 'zasilkovna', label: 'Zásilkovna', enabled: shipZasilkovna, setEnabled: setShipZasilkovna, price: shipZasilkovnaPrice, setPrice: setShipZasilkovnaPrice },
          { id: 'ppl', label: 'PPL — doručení na adresu', enabled: shipPpl, setEnabled: setShipPpl, price: shipPplPrice, setPrice: setShipPplPrice },
          { id: 'dpd', label: 'DPD — doručení na adresu', enabled: shipDpd, setEnabled: setShipDpd, price: shipDpdPrice, setPrice: setShipDpdPrice },
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
          <label htmlFor="ship_osobni" style={{ fontSize: 11, cursor: 'pointer' }}>Osobní odběr (zdarma)</label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 10, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>Doprava zdarma od (Kč):</label>
          <input style={{ ...fieldStyle, width: 90 }} type="number" min={0} value={freeShippingFrom} onChange={(e) => setFreeShippingFrom(Number(e.target.value))} placeholder="0 = vypnuto" />
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
          {isSavingPayShip ? 'Ukládám…' : 'Uložit platby & dopravu'}
        </button>
        {payShipMsg && <p style={{ fontSize: 10, color: payShipMsg.includes('Chyba') ? '#f87171' : '#34d399', margin: 0 }}>{payShipMsg}</p>}
      </div>
    </div>
  )
}
