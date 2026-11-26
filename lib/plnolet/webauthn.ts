// Minimal WebAuthn (passkey) checks for the Plnolet age pass. Pure apart from WebCrypto, so it is
// tested with keys made in the test (__tests__/plnolet.test.mjs).
//
// Registration uses attestation "none": the browser hands us the public key (SPKI, from
// AuthenticatorAttestationResponse.getPublicKey()) and the authenticator data; we check the
// challenge, origin, RP id hash, user presence and that the credential id in the authenticator data
// is the one sent. Assertions are verified against the stored key (ES256 or RS256).

const enc = new TextEncoder()

export const PASS_ALGS = [-7, -257] as const // ES256, RS256
export type PassAlg = (typeof PASS_ALGS)[number]

export class WebAuthnError extends Error {}

const fromB64u = (s: string): Uint8Array => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new WebAuthnError('bad encoding')
  return new Uint8Array(Buffer.from(s, 'base64url'))
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

export interface AuthData {
  rpIdHash: Uint8Array
  userPresent: boolean
  userVerified: boolean
  signCount: number
  credentialId: Uint8Array | null
}

export function parseAuthData(bytes: Uint8Array): AuthData {
  if (bytes.length < 37) throw new WebAuthnError('authenticator data too short')
  const flags = bytes[32]
  const signCount = ((bytes[33] << 24) >>> 0) + (bytes[34] << 16) + (bytes[35] << 8) + bytes[36]
  let credentialId: Uint8Array | null = null
  if (flags & 0x40) {
    if (bytes.length < 37 + 16 + 2) throw new WebAuthnError('attested data too short')
    const len = (bytes[53] << 8) + bytes[54]
    if (bytes.length < 55 + len) throw new WebAuthnError('credential id truncated')
    credentialId = bytes.slice(55, 55 + len)
  }
  return { rpIdHash: bytes.slice(0, 32), userPresent: !!(flags & 0x01), userVerified: !!(flags & 0x04), signCount, credentialId }
}

function checkClientData(json: Uint8Array, type: string, challenge: string, origin: string) {
  let c: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown }
  try {
    c = JSON.parse(new TextDecoder().decode(json))
  } catch {
    throw new WebAuthnError('client data is not JSON')
  }
  if (c.type !== type) throw new WebAuthnError('wrong ceremony')
  if (c.challenge !== challenge) throw new WebAuthnError('wrong challenge')
  if (c.origin !== origin) throw new WebAuthnError('wrong origin')
  if (c.crossOrigin === true) throw new WebAuthnError('cross-origin ceremony')
}

async function checkAuthData(authData: Uint8Array, rpId: string): Promise<AuthData> {
  const a = parseAuthData(authData)
  if (!equal(a.rpIdHash, await sha256(enc.encode(rpId)))) throw new WebAuthnError('wrong relying party')
  if (!a.userPresent) throw new WebAuthnError('user not present')
  return a
}

export interface Expected {
  challenge: string // base64url, as sent to the browser
  origin: string // e.g. https://quantecode.com
  rpId: string // e.g. quantecode.com
}

export interface Registration {
  credentialId: string
  publicKey: string // SPKI, base64url
  alg: PassAlg
}

export async function verifyRegistration(
  body: { credentialId?: unknown; publicKey?: unknown; alg?: unknown; clientDataJSON?: unknown; authenticatorData?: unknown },
  exp: Expected,
): Promise<Registration> {
  const alg = Number(body.alg)
  if (!PASS_ALGS.includes(alg as PassAlg)) throw new WebAuthnError('unsupported key type')
  const credentialId = String(body.credentialId ?? '')
  const publicKey = String(body.publicKey ?? '')
  if (!credentialId || credentialId.length > 1400 || !publicKey || publicKey.length > 2000) throw new WebAuthnError('missing key')
  checkClientData(fromB64u(String(body.clientDataJSON ?? '')), 'webauthn.create', exp.challenge, exp.origin)
  const a = await checkAuthData(fromB64u(String(body.authenticatorData ?? '')), exp.rpId)
  if (!a.credentialId || !equal(a.credentialId, fromB64u(credentialId))) throw new WebAuthnError('credential id mismatch')
  await importKey(publicKey, alg as PassAlg) // must be a usable key of that type
  return { credentialId, publicKey, alg: alg as PassAlg }
}

async function importKey(spkiB64u: string, alg: PassAlg): Promise<CryptoKey> {
  const spki = fromB64u(spkiB64u) as BufferSource
  try {
    return alg === -7
      ? await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      : await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  } catch {
    throw new WebAuthnError('bad public key')
  }
}

/** ASN.1 DER ECDSA signature → raw r‖s (64 bytes) as WebCrypto wants. */
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new WebAuthnError('bad signature')
  let i = 2
  const part = () => {
    if (der[i] !== 0x02) throw new WebAuthnError('bad signature')
    const len = der[i + 1]
    let v = der.slice(i + 2, i + 2 + len)
    i += 2 + len
    while (v.length > 32 && v[0] === 0) v = v.slice(1)
    if (v.length > 32) throw new WebAuthnError('bad signature')
    const out = new Uint8Array(32)
    out.set(v, 32 - v.length)
    return out
  }
  const r = part()
  const s = part()
  const raw = new Uint8Array(64)
  raw.set(r, 0)
  raw.set(s, 32)
  return raw
}

export async function verifyAssertion(
  body: { clientDataJSON?: unknown; authenticatorData?: unknown; signature?: unknown },
  stored: { publicKey: string; alg: PassAlg; signCount: number },
  exp: Expected,
): Promise<{ signCount: number }> {
  const clientData = fromB64u(String(body.clientDataJSON ?? ''))
  const authData = fromB64u(String(body.authenticatorData ?? ''))
  checkClientData(clientData, 'webauthn.get', exp.challenge, exp.origin)
  const a = await checkAuthData(authData, exp.rpId)
  const signed = new Uint8Array(authData.length + 32)
  signed.set(authData, 0)
  signed.set(await sha256(clientData), authData.length)
  const key = await importKey(stored.publicKey, stored.alg)
  let sig = fromB64u(String(body.signature ?? ''))
  const ok =
    stored.alg === -7
      ? await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, (sig = derToRaw(sig)) as BufferSource, signed as BufferSource)
      : await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, sig as BufferSource, signed as BufferSource)
  if (!ok) throw new WebAuthnError('signature does not match')
  // A counter that goes backwards means a cloned authenticator (synced passkeys always send 0).
  if (a.signCount !== 0 && stored.signCount !== 0 && a.signCount <= stored.signCount) throw new WebAuthnError('cloned authenticator')
  return { signCount: a.signCount }
}
