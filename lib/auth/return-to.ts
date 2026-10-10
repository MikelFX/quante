import { headers } from 'next/headers'
import { APP_ORIGIN } from '@/lib/domains'
import { afterSignInPath, redirectParam } from './after-sign-in'

/**
 * For the sign-in / sign-up pages: the in-app path to return to after auth (e.g. /qads after
 * "Generate"), from the page's query and the request's own origin — so absolute targets work on
 * previews and localhost too. Server-only.
 */
export async function returnTo(searchParams: Promise<Record<string, string | string[] | undefined>>): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const origin = host ? `${h.get('x-forwarded-proto') ?? 'https'}://${host}` : undefined
  return afterSignInPath(redirectParam(await searchParams), origin, [APP_ORIGIN])
}
