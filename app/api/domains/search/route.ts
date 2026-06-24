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
  const tlds = ['.com', '.io', '.store', '.shop', '.co', '.net']
  const domains = cleaned.includes('.')
    ? [cleaned]
    : tlds.map((t) => `${base}${t}`)

  try {
    const results = await Promise.allSettled(domains.map((d) => checkDomainAvailability(d)))
    const available = results
      .map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { domain: domains[i]!, available: false, price: 0, currency: 'USD' as const },
      )
      .filter((r) => r.price > 0)
    return Response.json({ results: available })
  } catch (err) {
    console.error('[domains/search]', err)
    return Response.json({ error: 'Domain search failed' }, { status: 500 })
  }
}
