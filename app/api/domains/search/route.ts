import { auth } from '@clerk/nextjs/server'
import { checkDomainAvailability } from '@/lib/namecheap'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const query = url.searchParams.get('q')?.trim().toLowerCase()
  if (!query) return Response.json({ error: 'Query required' }, { status: 400 })

  // Strip protocol/www, normalize
  const cleaned = query
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0] ?? query

  // Generate suggestions: check multiple TLDs if no TLD was provided
  const base = cleaned.includes('.') ? cleaned.split('.')[0] : cleaned
  const tlds = ['.com', '.cz', '.sk', '.eu', '.app', '.ai', '.io', '.shop', '.store']
  const domains = cleaned.includes('.')
    ? [cleaned]
    : tlds.map((t) => `${base}${t}`)

  try {
    const results = await Promise.allSettled(domains.map((d) => checkDomainAvailability(d)))
    const available = results
      .map((r, i) => {
        if (r.status === 'fulfilled') return r.value
        // Logged so a Namecheap-side failure (bad/missing credentials, IP not
        // whitelisted, API access disabled) is visible in Vercel logs instead of
        // silently rendering as "No results — try a different name" to the user.
        console.error(`[domains/search] ${domains[i]} failed:`, r.reason?.message ?? r.reason)
        return { domain: domains[i]!, available: false, price: 0, currency: 'USD' as const }
      })
      .filter((r) => r.price > 0)
    return Response.json({ results: available })
  } catch (err) {
    console.error('[domains/search]', err)
    return Response.json({ error: 'Domain search failed' }, { status: 500 })
  }
}
