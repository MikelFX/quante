// Routes served by the AssetraDigital website (app/(site)), as opposed to the Quante app and the
// old Quante marketing pages. Quante-only chrome (e.g. the announcement banner) stays off these.
export const SITE_ROUTE_PREFIXES = ['/design'] as const

export function isSiteRoute(pathname: string | null): boolean {
  if (!pathname) return false
  return SITE_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}
