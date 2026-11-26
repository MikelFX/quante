'use client'

// The shopper's side of a Plnolet verification: pick a way to prove the age, then go back to the
// shop. In the widget's popup the result goes to the shop's window by postMessage; otherwise the
// browser returns to the shop's return_url. The shop must still ask our API for the result.

import { useState, useSyncExternalStore } from 'react'
import { Check, Fingerprint, Landmark, Loader2, ShieldCheck, X } from 'lucide-react'

export interface VerifyProps {
  id: string
  shop: string
  threshold: number
  test: boolean
  status: 'pending' | 'verified' | 'failed' | 'expired'
  method: string | null
  offerPass: boolean
  providers: { id: string; label: string }[]
  backUrl: string
  backOrigin: string
  error: string | null
}

const ERRORS: Record<string, string> = {
  cancelled: 'Ověření bylo zrušeno. Zkuste to prosím znovu nebo jiným způsobem.',
  unverified: 'Tento účet nemá ověřenou totožnost nebo nesdílel datum narození. Zkuste jiný způsob.',
  provider: 'Ověřovací služba teď neodpověděla. Zkuste to prosím znovu.',
  closed: 'Toto ověření už skončilo.',
  method: 'Tento způsob ověření teď není k dispozici.',
  missing: 'Odkaz na ověření neexistuje.',
}

const b64u = (buf: ArrayBuffer) => {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({ ok: false, message: 'Něco se pokazilo.' }))
  if (!res.ok || data.ok === false) throw new Error(data.message ?? 'Něco se pokazilo.')
  return data
}

const noop = () => () => {}

export function VerifyClient(p: VerifyProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(p.error ? ERRORS[p.error] ?? ERRORS.provider : null)
  const [passSaved, setPassSaved] = useState(false)
  // Passkeys need a secure context and browser support; false on the server, so no hydration mismatch.
  const canPasskey = useSyncExternalStore(noop, () => !!window.PublicKeyCredential && window.isSecureContext, () => false)

  const api = `/api/plnolet/s/${p.id}`
  const reload = () => window.location.replace(`/plnolet/v/${p.id}`)

  function finish() {
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage({ type: 'plnolet:done', session: p.id, status: p.status }, p.backOrigin)
        window.close()
        return
      } catch { /* fall through to a redirect */ }
    }
    window.location.assign(p.backUrl)
  }

  async function usePass() {
    setBusy('pass'); setMsg(null)
    try {
      const o = await post(`${api}/pass`, { step: 'options' })
      const cred = (await navigator.credentials.get({
        publicKey: { challenge: fromB64u(o.challenge), rpId: o.rpId, userVerification: 'required', timeout: 60_000 },
      })) as PublicKeyCredential | null
      if (!cred) throw new Error('Věkový pas nebyl vybrán.')
      const r = cred.response as AuthenticatorAssertionResponse
      await post(`${api}/pass`, {
        step: 'verify', token: o.token, credentialId: b64u(cred.rawId),
        clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature),
      })
      reload()
    } catch (e) {
      setMsg(e instanceof DOMException ? 'Věkový pas nebyl použit. Pokud ho nemáte, ověřte se jiným způsobem.' : (e as Error).message)
      setBusy(null)
    }
  }

  async function savePass() {
    setBusy('save'); setMsg(null)
    try {
      const o = await post(`${api}/pass/register`, { step: 'options' })
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: fromB64u(o.challenge),
          rp: { id: o.rpId, name: 'Plnolet – věkový pas' },
          user: { id: fromB64u(o.userId), name: `Věkový pas ${p.threshold >= 21 ? '21+' : '18+'}`, displayName: 'Věkový pas Plnolet' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          attestation: 'none',
          timeout: 60_000,
        },
      })) as PublicKeyCredential | null
      if (!cred) throw new Error('Věkový pas se neuložil.')
      const r = cred.response as AuthenticatorAttestationResponse
      const pk = r.getPublicKey?.()
      if (!pk) throw new Error('Tento prohlížeč neumí věkový pas uložit.')
      await post(`${api}/pass/register`, {
        step: 'verify', token: o.token, credentialId: b64u(cred.rawId), publicKey: b64u(pk), alg: r.getPublicKeyAlgorithm(),
        clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.getAuthenticatorData()),
      })
      setPassSaved(true)
    } catch (e) {
      setMsg(e instanceof DOMException ? 'Věkový pas se neuložil. Nevadí, ověření platí i tak.' : (e as Error).message)
    }
    setBusy(null)
  }

  async function testResult(adult: boolean) {
    setBusy(adult ? 't1' : 't0'); setMsg(null)
    try {
      await post(`${api}/test`, { adult })
      reload()
    } catch (e) {
      setMsg((e as Error).message)
      setBusy(null)
    }
  }

  const age = `${p.threshold}+`
  const head = (
    <div className="pn-shop">
      <span className="pn-age">{age}</span>
      <span>Ověření věku pro <b>{p.shop}</b>{p.test && ' · testovací režim'}</span>
    </div>
  )

  if (p.status === 'verified') {
    return (
      <div className="pn-box">
        {head}
        <div className="pn-state pn-state-ok"><Check aria-hidden="true" /></div>
        <h1>Věk je ověřený</h1>
        <p>{p.shop} se dozví jen to, že je vám {p.threshold} let nebo víc. Nic dalšího o vás nedostane.</p>
        {p.offerPass && canPasskey && !passSaved && (
          <div className="pn-pass">
            <h2>Příště jedním dotykem</h2>
            <p>Uložte si věkový pas do telefonu nebo počítače. Na každém e-shopu s Plnolet pak stačí potvrdit otiskem prstu nebo obličejem, rok bez dalšího ověřování.</p>
            <button className="pn-btn pn-btn-sec pn-btn-block" onClick={savePass} disabled={!!busy}>
              {busy === 'save' ? <Loader2 className="pn-spin" size={18} aria-hidden="true" /> : <Fingerprint size={18} aria-hidden="true" />}
              Uložit věkový pas
            </button>
          </div>
        )}
        {passSaved && <p className="pn-privacy">Věkový pas je uložený. Platí rok a nese jen informaci o věku, ne vaše jméno.</p>}
        {msg && <div className="pn-msg" role="alert">{msg}</div>}
        <div className="pn-opts"><button className="pn-btn pn-btn-pri pn-btn-block" onClick={finish}>Pokračovat do obchodu</button></div>
      </div>
    )
  }

  if (p.status === 'failed' || p.status === 'expired') {
    return (
      <div className="pn-box">
        {head}
        <div className="pn-state pn-state-no"><X aria-hidden="true" /></div>
        <h1>{p.status === 'expired' ? 'Čas na ověření vypršel' : 'Věk se nepodařilo potvrdit'}</h1>
        <p>{p.status === 'expired'
          ? 'Vraťte se do obchodu a spusťte ověření znovu.'
          : `Zboží z tohoto obchodu smí koupit jen osoba starší ${p.threshold} let. Pokud jde o omyl, vraťte se do obchodu a zkuste jiný způsob ověření.`}</p>
        <div className="pn-opts"><button className="pn-btn pn-btn-sec pn-btn-block" onClick={finish}>Zpět do obchodu</button></div>
      </div>
    )
  }

  const nothing = !p.providers.length && !p.test
  return (
    <div className="pn-box">
      {head}
      <h1>Potvrďte, že je vám {age}</h1>
      <p>Obchod musí ze zákona ověřit věk kupujícího. Vyberte, jak ho chcete potvrdit.</p>
      <div className="pn-opts">
        {canPasskey && (
          <button className="pn-opt pn-opt-main" onClick={usePass} disabled={!!busy}>
            {busy === 'pass' ? <Loader2 className="pn-spin" aria-hidden="true" /> : <Fingerprint aria-hidden="true" />}
            <span>Mám věkový pas<small>Otisk prstu, obličej nebo PIN zařízení</small></span>
          </button>
        )}
        {p.providers.map((pr) => (
          <a key={pr.id} className="pn-opt" href={`${api}/start/${pr.id}`} aria-disabled={!!busy}>
            {pr.id === 'bankid' ? <Landmark aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
            <span>{pr.label}<small>{pr.id === 'bankid' ? 'Přihlášení přes vaši banku' : 'Účet mojeID s ověřenou totožností'}</small></span>
          </a>
        ))}
        {nothing && <div className="pn-msg">Ověřování teď není k dispozici. Zkuste to prosím později.</div>}
      </div>
      {p.test && (
        <div className="pn-test">
          <p>Testovací režim: e-shop zkouší propojení. Tlačítka níže nasimulují výsledek, nikdo se doopravdy neověřuje.</p>
          <div className="pn-test-row">
            <button className="pn-btn pn-btn-sec" onClick={() => testResult(true)} disabled={!!busy}>
              {busy === 't1' && <Loader2 className="pn-spin" size={16} aria-hidden="true" />}Je mi {age}
            </button>
            <button className="pn-btn pn-btn-sec" onClick={() => testResult(false)} disabled={!!busy}>
              {busy === 't0' && <Loader2 className="pn-spin" size={16} aria-hidden="true" />}Je mi méně
            </button>
          </div>
        </div>
      )}
      {msg && <div className="pn-msg" role="alert">{msg}</div>}
      <p className="pn-privacy">Obchod se dozví jen „ano, {age}“. Vaše jméno, datum narození ani doklad mu nepředáme a sami je neukládáme.</p>
    </div>
  )
}
