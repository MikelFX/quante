// Qscan's only way out to the internet. Server-only.
//
// SECURITY (SSRF): every request — the first one and every redirect hop — goes through
// normalizeScanUrl(), and the socket connects only to an address isPublicAddress() accepts:
// the check sits inside the DNS lookup the socket itself uses, so the address that was checked
// is the address that is dialled (no rebinding window). Bodies are size-capped while streaming,
// every request has a hard timeout, and no cookies or credentials are ever sent.

import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import zlib from 'node:zlib'
import type { LookupFunction } from 'node:net'
import { isPublicAddress, normalizeScanUrl } from './net'

const MAX_REDIRECTS = 4
const UA = 'Mozilla/5.0 (compatible; QuanteQscan/1.0; +https://quantecode.com/qscan)'

export class ScanFetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ScanFetchError'
  }
}

export interface FetchedResource {
  url: string
  status: number
  contentType: string
  body: Buffer
}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return (callback as (e: Error | null, a: string, f: number) => void)(err, '', 0)
    const ok = (addresses as dns.LookupAddress[]).filter((a) => isPublicAddress(a.address, a.family))
    // Every resolved address must be public — a mixed answer is how rebinding attacks start.
    if (ok.length === 0 || ok.length !== (addresses as dns.LookupAddress[]).length) {
      const e = new ScanFetchError('This address points to a private network.')
      return (callback as (e: Error | null, a: string, f: number) => void)(e, '', 0)
    }
    if ((options as { all?: boolean }).all) {
      return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, ok)
    }
    ;(callback as (e: null, a: string, f: number) => void)(null, ok[0].address, ok[0].family)
  })
}

function requestOnce(url: URL, opts: { maxBytes: number; timeoutMs: number; accept: string }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http
    const req = mod.request(url, {
      method: 'GET',
      lookup: safeLookup,
      headers: {
        'user-agent': UA,
        accept: opts.accept,
        'accept-language': 'cs,en;q=0.8,*;q=0.5',
        'accept-encoding': 'gzip, deflate, br',
      },
      timeout: opts.timeoutMs,
    }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400) {
        res.resume()
        return resolve({ status, headers: res.headers, body: Buffer.alloc(0) })
      }
      const declared = Number(res.headers['content-length'] ?? '0')
      if (declared > opts.maxBytes * 4) {
        res.destroy()
        return reject(new ScanFetchError('The file is too large.', status))
      }
      const enc = String(res.headers['content-encoding'] ?? '').toLowerCase()
      let stream: NodeJS.ReadableStream = res
      if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip())
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate())
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress())
      const chunks: Buffer[] = []
      let size = 0
      stream.on('data', (c: Buffer) => {
        size += c.length
        if (size > opts.maxBytes) {
          res.destroy()
          reject(new ScanFetchError('The file is too large.', status))
          return
        }
        chunks.push(c)
      })
      stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }))
      stream.on('error', (e: Error) => reject(e))
    })
    // Hard deadline for the whole request, not just socket idle time.
    const deadline = setTimeout(() => req.destroy(new ScanFetchError('The site took too long to answer.')), opts.timeoutMs)
    req.on('timeout', () => req.destroy(new ScanFetchError('The site took too long to answer.')))
    req.on('error', (e) => { clearTimeout(deadline); reject(e) })
    req.on('close', () => clearTimeout(deadline))
    req.end()
  })
}

/** GET a public URL, following up to MAX_REDIRECTS redirects (each re-checked). */
export async function scanFetch(
  input: string | URL,
  opts: { maxBytes?: number; timeoutMs?: number; accept?: string } = {},
): Promise<FetchedResource> {
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024
  const timeoutMs = opts.timeoutMs ?? 12_000
  const accept = opts.accept ?? 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
  let current = normalizeScanUrl(String(input))
  if (!current) throw new ScanFetchError('This is not a public web address.')
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(current, { maxBytes, timeoutMs, accept })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.location
      if (!loc) throw new ScanFetchError('The site redirected nowhere.', res.status)
      const next = normalizeScanUrl(new URL(loc, current).toString())
      if (!next) throw new ScanFetchError('The site redirected to an address we can’t scan.', res.status)
      current = next
      continue
    }
    return {
      url: current.toString(),
      status: res.status,
      contentType: String(res.headers['content-type'] ?? '').toLowerCase(),
      body: res.body,
    }
  }
  throw new ScanFetchError('Too many redirects.')
}
