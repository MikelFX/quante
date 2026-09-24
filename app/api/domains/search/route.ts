import { auth } from '@clerk/nextjs/server'
import { checkDomainsAvailability, parseRegistrableDomain, SUPPORTED_TLDS } from '@/lib/namecheap'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Every search spends Quante's Namecheap API quota (shared by all customers,
  // including paid registrations in the Stripe webhook) — cap it per user.
  const perMinute = rateLimit(`domains-search:m:${userId}`, 10, 60_000)
  const perHour = rateLimit(`domains-search:h:${userId}`, 60, 3_600_000)
  if (!perMinute.allowed || !perHour.allowed) {
    const resetAt = !perMinute.allowed ? perMinute.resetAt : perHour.resetAt
    return Response.json(
      { error: 'Too many domain searches. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) } },
    )
  }

  const url = new URL(request.url)
  const query = url.searchParams.get('q')?.trim().toLowerCase()
  if (!query) return Response.json({ error: 'Query required' }, { status: 400 })
  if (query.length > 253) return Response.json({ error: 'Query too long' }, { status: 400 })

  // Strip protocol/www, normalize
  const cleaned = query
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0] ?? query

  // An exact `name.tld` on a TLD we sell is checked as-is; anything else is
  // reduced to its first label and suggested across the supported TLDs.
  const exact = cleaned.includes('.') ? parseRegistrableDomain(cleaned) : null
  const base = (cleaned.split('.')[0] ?? '').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '')
  if (!exact && (base.length === 0 || base.length > 63)) {
    return Response.json(
      { error: 'Enter a name using letters, numbers and hyphens (max 63 characters).' },
      { status: 400 },
    )
  }
  const domains = exact ? [exact] : SUPPORTED_TLDS.map((t) => `${base}.${t}`)

  try {
    // One batched domains.check call + cached per-TLD pricing.
    const results = await checkDomainsAvailability(domains)
    const rejectedCount = results.filter((r) => r.status === 'rejected').length
    // Every TLD check throwing usually means Namecheap is misconfigured
    // server-side (missing/bad credentials, IP not whitelisted, API
    // access disabled) — treat that as a service error, not "no
    // results". Without this branch the Studio's Search button reads
    // as broken to the end user because nothing distinguishes a real
    // dry-well from a config outage.
    if (rejectedCount === results.length) {
      const firstReason = (results[0] as PromiseRejectedResult | undefined)?.reason
      console.error('[domains/search] all TLD checks failed:', firstReason?.message ?? firstReason)
      return Response.json(
        { error: 'Domain search is temporarily unavailable. Please try again in a moment.' },
        { status: 502 },
      )
    }
    const available = results
      .map((r, i) => {
        // Only the public fields — never leak Quante's raw registrar cost.
        if (r.status === 'fulfilled') {
          const { domain, available, price, currency, premium } = r.value
          return { domain, available, price, currency, ...(premium ? { premium } : {}) }
        }
        // Logged so a Namecheap-side failure (bad/missing credentials, IP not
        // whitelisted, API access disabled) is visible in Vercel logs instead of
        // silently rendering as "No results — try a different name" to the user.
        console.error(`[domains/search] ${domains[i]} failed:`, r.reason?.message ?? r.reason)
        return { domain: domains[i]!, available: false, price: 0, currency: 'USD' as const }
      })
      .filter((r) => r.price > 0)
    return Response.json({ results: available })
  } catch (err) {
    // The batched domains.check call itself failed (config / outage).
    console.error('[domains/search]', err)
    return Response.json(
      { error: 'Domain search is temporarily unavailable. Please try again in a moment.' },
      { status: 502 },
    )
  }
}
