// Identity providers that can prove a shopper's age (OpenID Connect). Each is on only when its
// client id + secret are set, so nothing is offered that cannot work. Endpoints come from the
// issuer's discovery document; the issuer itself is fixed here or by env, never from a request.
//
// Claims / scopes follow the providers' published OIDC docs at the time of writing — confirm them
// with the provider when the contract is signed (mojeID: claims `birthdate`, `adult`,
// `mojeid_valid`; Bank iD Connect: scope `profile.birthdate`).

export type ProviderId = 'mojeid' | 'bankid'

export interface Provider {
  id: ProviderId
  label: string
  issuer: string
  clientId: string
  clientSecret: string
  scope: string
  /** OIDC `claims` request parameter (JSON), when the provider takes one. */
  claims: string | null
}

type Env = Record<string, string | undefined>

const trimSlash = (s: string) => (s.endsWith('/') ? s : s + '/')

export function providers(env: Env): Provider[] {
  const out: Provider[] = []
  const mid = env.PLNOLET_MOJEID_CLIENT_ID?.trim()
  const msec = env.PLNOLET_MOJEID_CLIENT_SECRET?.trim()
  if (mid && msec) {
    out.push({
      id: 'mojeid',
      label: 'mojeID',
      issuer: trimSlash(env.PLNOLET_MOJEID_ISSUER?.trim() || 'https://mojeid.cz/oidc/'),
      clientId: mid,
      clientSecret: msec,
      scope: 'openid',
      claims: JSON.stringify({ userinfo: { birthdate: { essential: true }, mojeid_valid: { essential: true }, adult: null } }),
    })
  }
  const bid = env.PLNOLET_BANKID_CLIENT_ID?.trim()
  const bsec = env.PLNOLET_BANKID_CLIENT_SECRET?.trim()
  if (bid && bsec) {
    out.push({
      id: 'bankid',
      label: 'Bank iD',
      issuer: trimSlash(env.PLNOLET_BANKID_ISSUER?.trim() || 'https://oidc.bankid.cz/'),
      clientId: bid,
      clientSecret: bsec,
      scope: env.PLNOLET_BANKID_SCOPE?.trim() || 'openid profile.birthdate',
      claims: null,
    })
  }
  return out.filter((p) => /^https:\/\/[a-z0-9.-]+(?::\d+)?\//i.test(p.issuer))
}

export function providerById(env: Env, id: string): Provider | null {
  return providers(env).find((p) => p.id === id) ?? null
}

/** Live keys work only once the operator switched live mode on and at least one real provider exists. */
export function liveAvailable(env: Env): boolean {
  return env.PLNOLET_LIVE === '1' && providers(env).length > 0
}
