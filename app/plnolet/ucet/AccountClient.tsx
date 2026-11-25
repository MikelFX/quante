'use client'

// Plnolet merchant account: shop name + domains, API keys (test now, live once switched on),
// this month's numbers, recent verifications, the CSV log and the text for the Ministry of Health.

import { useEffect, useState, type FormEvent } from 'react'
import { useUser } from '@clerk/nextjs'
import { Download, KeyRound, Loader2, Trash2 } from 'lucide-react'
import { METHOD_LABEL, type Method } from '@/lib/plnolet/labels'

interface Key { id: string; mode: 'test' | 'live'; name: string; prefix: string; created_at: string; last_used_at: string | null }
interface Row { id: string; mode: string; threshold: number; status: string; method: Method | null; reference: string | null; created_at: string }
interface State {
  setUp: boolean
  merchant?: { name: string; domains: string[]; liveEnabled: boolean; disabled: boolean } | null
  live?: boolean
  methods?: string[]
  keys?: Key[]
  recent?: Row[]
  month?: { sessions: number; verified: number; newChecks: number; byPass: number; test: number }
}

const STATUS: Record<string, string> = { pending: 'čeká', verified: 'ověřeno', failed: 'neprošlo', expired: 'vypršelo' }
const when = (iso: string) => new Date(iso).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })

export function AccountClient() {
  const { isLoaded, isSignedIn } = useUser()
  const [s, setS] = useState<State | null>(null)
  const [name, setName] = useState('')
  const [domains, setDomains] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)

  const [tick, setTick] = useState(0)
  const load = () => setTick((t) => t + 1)

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    let off = false
    fetch('/api/plnolet/account', { cache: 'no-store' })
      .then(async (res) => ({ ok: res.ok, d: (await res.json().catch(() => null)) as State | null }))
      .then(({ ok, d }) => {
        if (off) return
        if (!ok || !d) { setMsg('Účet se nepodařilo načíst.'); return }
        setS(d)
        if (d.merchant) { setName(d.merchant.name); setDomains(d.merchant.domains.join(', ')) }
      })
      .catch(() => { if (!off) setMsg('Účet se nepodařilo načíst.') })
    return () => { off = true }
  }, [isLoaded, isSignedIn, tick])

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy('save'); setMsg(null)
    const res = await fetch('/api/plnolet/account', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, domains }) })
    const d = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok) { setMsg(d?.error ?? 'Uložení se nepovedlo.'); return }
    setMsg('Uloženo.')
    load()
  }

  async function createKey(mode: 'test' | 'live') {
    setBusy('key-' + mode); setMsg(null); setNewKey(null)
    const res = await fetch('/api/plnolet/account/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) })
    const d = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok) { setMsg(d?.error ?? 'Klíč se nepodařilo vytvořit.'); return }
    setNewKey(d.key)
    load()
  }

  async function revoke(id: string) {
    if (!window.confirm('Zrušit tento klíč? E-shop, který ho používá, přestane ověřovat.')) return
    await fetch(`/api/plnolet/account/keys?id=${id}`, { method: 'DELETE' })
    load()
  }

  if (!isLoaded) return <p className="pn-note" style={{ paddingTop: 40 }}>Načítám…</p>
  if (!isSignedIn) {
    return (
      <section className="pn-hero">
        <h1 className="pn-h1">Účet obchodníka</h1>
        <p className="pn-lead">Přihlaste se stejným účtem jako do Quante, nebo si ho zdarma založte. Testovací režim je zdarma a funguje hned.</p>
        <div className="pn-ctas">
          <a className="pn-btn pn-btn-pri" href={`/login?redirect_url=${encodeURIComponent('/plnolet/ucet')}`}>Přihlásit se</a>
          <a className="pn-btn pn-btn-sec" href={`/signup?redirect_url=${encodeURIComponent('/plnolet/ucet')}`}>Založit účet</a>
        </div>
      </section>
    )
  }
  if (!s) return <p className="pn-note" style={{ paddingTop: 40 }}>{msg ?? 'Načítám…'}</p>
  if (!s.setUp) return <section className="pn-hero"><h1 className="pn-h1">Brzy</h1><p className="pn-lead">Plnolet se právě spouští. Zkuste to prosím za chvíli.</p></section>

  const m = s.merchant
  return (
    <div className="pn-acct">
      <h1 className="pn-h2" style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>{m ? m.name : 'Nastavte svůj e-shop'}</h1>
      {msg && <p className="pn-note" role="status">{msg}</p>}

      {m && s.month && (
        <div className="pn-stats">
          <div className="pn-stat"><b>{s.month.newChecks}</b><span>nových ověření tento měsíc</span></div>
          <div className="pn-stat"><b>{s.month.byPass}</b><span>s věkovým pasem (zdarma)</span></div>
          <div className="pn-stat"><b>{s.month.sessions}</b><span>ostrých relací</span></div>
          <div className="pn-stat"><b>{s.month.test}</b><span>testovacích relací</span></div>
        </div>
      )}

      <form className="pn-card" onSubmit={save}>
        <h3>E-shop</h3>
        <label className="pn-field"><span>Název, který uvidí zákazník</span>
          <input className="pn-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <label className="pn-field"><span>Domény, na které se zákazník vrací (oddělte čárkou)</span>
          <input className="pn-input" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="vas-eshop.cz" />
        </label>
        <button className="pn-btn pn-btn-pri" disabled={busy === 'save'}>{busy === 'save' && <Loader2 className="pn-spin" size={16} aria-hidden="true" />}Uložit</button>
      </form>

      {m && (
        <div className="pn-card">
          <h3>API klíče</h3>
          <p>Testovací klíč funguje hned. Ostrý režim zapneme po podpisu smlouvy s ověřovacími službami{s.live ? ' a u vás už běží.' : '.'}</p>
          {(s.keys ?? []).map((k) => (
            <div className="pn-key" key={k.id}>
              <span className={k.mode === 'live' ? 'pn-tag pn-tag-live' : 'pn-tag'}>{k.mode === 'live' ? 'ostrý' : 'test'}</span>
              <code>{k.prefix}…</code>
              <span style={{ color: 'var(--q-fg3)' }}>{k.last_used_at ? `naposledy ${when(k.last_used_at)}` : 'zatím nepoužitý'}</span>
              <button className="pn-ghost" onClick={() => revoke(k.id)} aria-label="Zrušit klíč"><Trash2 size={16} aria-hidden="true" /></button>
            </div>
          ))}
          {newKey && <div className="pn-new-key" role="status"><b>Nový klíč (ukážeme ho jen teď):</b><br /><code>{newKey}</code></div>}
          <div className="pn-row" style={{ marginTop: 14 }}>
            <button className="pn-btn pn-btn-sec" onClick={() => createKey('test')} disabled={!!busy}><KeyRound size={16} aria-hidden="true" />Nový testovací klíč</button>
            {s.live && <button className="pn-btn pn-btn-sec" onClick={() => createKey('live')} disabled={!!busy}><KeyRound size={16} aria-hidden="true" />Nový ostrý klíč</button>}
          </div>
        </div>
      )}

      {m && (
        <div className="pn-card">
          <div className="pn-row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Poslední ověření</h3>
            <a className="pn-btn pn-btn-sec" href="/api/plnolet/account/log?days=365"><Download size={16} aria-hidden="true" />Záznamy CSV</a>
          </div>
          {(s.recent ?? []).length === 0 ? <p style={{ marginTop: 12 }}>Zatím žádné. Otevřete první ověření testovacím klíčem.</p> : (
            <div className="pn-scroll" style={{ marginTop: 12 }}>
              <table className="pn-table">
                <thead><tr><th scope="col">Kdy</th><th scope="col">Objednávka</th><th scope="col">Věk</th><th scope="col">Výsledek</th><th scope="col">Způsob</th></tr></thead>
                <tbody>
                  {(s.recent ?? []).map((r) => (
                    <tr key={r.id}>
                      <td>{when(r.created_at)}{r.mode === 'test' && <> <span className="pn-tag">test</span></>}</td>
                      <td>{r.reference ?? '–'}</td>
                      <td>{r.threshold}+</td>
                      <td>{STATUS[r.status] ?? r.status}</td>
                      <td>{r.method ? METHOD_LABEL[r.method] : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {m && (
        <div className="pn-card">
          <h3>Popis systému pro ministerstvo zdravotnictví</h3>
          <p>Prodejci tabáku, e-cigaret a nikotinových sáčků na dálku oznamují systém ověřování věku ministerstvu (§ 6 zákona č. 65/2017 Sb.). Tento text můžete použít jako podklad:</p>
          <pre className="pn-code" style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{`Věk kupujícího ověřujeme před dokončením objednávky službou Plnolet (provozovatel AssetraDigital).
Kupující prokáže věk elektronicky prostřednictvím bankovní identity (Bank iD) nebo účtu mojeID s ověřenou totožností; plnoletost se počítá z data narození, které potvrdil poskytovatel identity.
Objednávku zboží s věkovým omezením nelze dokončit bez kladného výsledku ověření, který si náš server vyžádá přímo od služby Plnolet.
Opakovaně nakupující zákazník může použít věkový pas (passkey vázaný na jeho zařízení), vydaný nejvýše 12 měsíců po ověření přes Bank iD nebo mojeID.
Ke každé objednávce uchováváme čas, způsob a výsledek ověření. Osobní údaje z ověření (jméno, datum narození) neukládáme.`}</pre>
          <p className="pn-note">Před odesláním si text ověřte s právníkem; podmínky oznámení stanoví ministerstvo.</p>
        </div>
      )}
    </div>
  )
}
