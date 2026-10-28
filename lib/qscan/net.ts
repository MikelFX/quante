// Qscan: which URLs and addresses the scanner may reach. Pure, no imports — the tests load it
// directly (__tests__/qscan.test.mjs).
//
// SECURITY (SSRF): Qscan fetches pages a signed-in user names, from our servers. It may only
// reach public web hosts on the standard ports — never localhost, private networks, link-local
// (cloud metadata at 169.254.169.254), CGNAT, multicast or reserved ranges, in IPv4 or IPv6
// (mapped / NAT64 forms included). The address check runs on the address the socket actually
// connects to (lib/qscan/fetch.ts pins it in the DNS lookup), so DNS rebinding can't slip past.

/** Normalises what the user typed into an http(s) URL, or null when it can't be a public site. */
export function normalizeScanUrl(input: string): URL | null {
  let raw = (input ?? '').trim()
  if (!raw || raw.length > 2048) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  if (url.port && url.port !== '80' && url.port !== '443') return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  // A public site has a dotted name with a real TLD; bare IPs and internal names are refused.
  if (!host.includes('.') || isIpLiteral(host)) return null
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|test|invalid|example)$/.test(host)) return null
  url.hash = ''
  return url
}

export function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':')
}

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n
}

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip)
  if (n === null) return false
  for (const [base, bits] of V4_BLOCKED) {
    const b = v4ToInt(base)!
    const size = 2 ** (32 - bits)
    if (n >= b && n < b + size) return false
  }
  return true
}

/** Expands an IPv6 address into 8 hextets (null when malformed). */
function v6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '')
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  // a trailing dotted IPv4 (::ffff:1.2.3.4)
  const v4 = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (v4) {
    const n = v4ToInt(v4[1])
    if (n === null) return null
    s = s.slice(0, -v4[1].length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (fill < 0) return null
  const all = [...head, ...Array(fill).fill('0'), ...tail]
  if (all.length !== 8) return null
  const out: number[] = []
  for (const h of all) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null
    out.push(parseInt(h, 16))
  }
  return out
}

function isPublicV6(ip: string): boolean {
  const h = v6Hextets(ip)
  if (!h) return false
  const v4tail = `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`
  if (h.slice(0, 7).every((x) => x === 0)) return false // :: and ::1
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return isPublicV4(v4tail) // ::ffff:a.b.c.d
  if (h.slice(0, 6).every((x) => x === 0)) return false // deprecated IPv4-compatible
  if (h[0] === 0x64 && h[1] === 0xff9b) return isPublicV4(v4tail) // NAT64
  if (h[0] === 0x2002) return isPublicV4(`${h[1] >> 8}.${h[1] & 255}.${h[2] >> 8}.${h[2] & 255}`) // 6to4
  if ((h[0] & 0xfe00) === 0xfc00) return false // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return false // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return false // site-local (deprecated)
  if ((h[0] & 0xff00) === 0xff00) return false // multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return false // documentation
  if (h[0] === 0x2001 && h[1] < 0x0200) return false // 2001::/23 IETF special (Teredo, ORCHID …)
  if (h[0] === 0x0100 && h.slice(1, 4).every((x) => x === 0)) return false // discard-only
  return (h[0] & 0xe000) === 0x2000 // only global unicast 2000::/3
}

/** True when the scanner may connect to this resolved address. */
export function isPublicAddress(ip: string, family?: number): boolean {
  if (family === 4 || (!family && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip))) return isPublicV4(ip)
  return isPublicV6(ip)
}
