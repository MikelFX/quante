// The gateway's one way to a seller's server. Server-only.
//
// SECURITY (SSRF): the address the socket dials must be public (Qscan's safeLookup pins the checked
// address in the DNS lookup, so no rebinding); https only on 443; redirects are not followed (a
// seller can't bounce us into a private network); hard time and size caps; no cookies or our
// credentials are ever sent — only the allowlisted buyer headers (model.ts forwardRequestHeaders).

import https from 'node:https'
import { safeLookup } from '@/lib/qscan/fetch'
import { QBOX_EARN } from '../limits'

export class UpstreamError extends Error {}

export interface UpstreamResponse { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }

export function callUpstream(url: URL, method: string, headers: Record<string, string>, body: Buffer | null): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return reject(new UpstreamError('The service address must be https.'))
    const req = https.request(url, {
      method,
      lookup: safeLookup,
      headers: { ...headers, 'accept-encoding': 'identity', ...(body ? { 'content-length': String(body.length) } : {}) },
      timeout: QBOX_EARN.upstreamTimeoutMs,
    }, (res) => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > QBOX_EARN.maxResponseBytes) {
          res.destroy()
          reject(new UpstreamError('The service answered with more than the size limit.'))
          return
        }
        chunks.push(c)
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    const deadline = setTimeout(() => req.destroy(new UpstreamError('The service took too long to answer.')), QBOX_EARN.upstreamTimeoutMs)
    req.on('timeout', () => req.destroy(new UpstreamError('The service took too long to answer.')))
    req.on('error', (e) => {
      clearTimeout(deadline)
      reject(e)
    })
    req.on('close', () => clearTimeout(deadline))
    req.end(body ?? undefined)
  })
}
