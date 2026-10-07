// Routes served by the AssetraDigital website (app/(site)), as opposed to the Quante app and the
// old Quante marketing pages. Quante-only chrome (e.g. the announcement banner) stays off these.
const EXACT = ['/'] as const
export const SITE_ROUTE_PREFIXES = ['/design', '/quante', '/obchodni-podminky', '/ochrana-osobnich-udaju', '/vzorova-smlouva'] as const

export function isSiteRoute(pathname: string | null): boolean {
  if (!pathname) return false
  if ((EXACT as readonly string[]).includes(pathname)) return true
  return SITE_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}
