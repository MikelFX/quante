// Raw Higgsfield REST client. Talks to api.higgsfield.ai directly with plain fetch rather
// than an SDK package — same posture lib/hosting/vercel.ts adopted after the @vercel/sdk
// response-validation incident (2026-08-19): we only read the handful of fields Qads
// actually uses, so there's no bundled schema to drift out of sync with Higgsfield's API.
//
// Every endpoint, field name, and lifecycle state below was fetched from
// docs.higgsfield.ai during this implementation step (llms.txt index -> requests.md,
// webhooks.md, file-uploads.md, authentication.md, marketing-studio-image/generate-and-
// edit.md) — nothing here is guessed. See mapper.ts for the Marketing Studio Image
// request-body shape.

export interface HiggsfieldCredentials {
  keyId: string
  keySecret: string
}

const BASE_URL = 'https://api.higgsfield.ai'

function authHeader(creds: HiggsfieldCredentials): string {
  return `Key ${creds.keyId}:${creds.keySecret}`
}

export interface HiggsfieldSubmitResponse {
  status: string
  request_id: string
  status_url: string
  cancel_url: string
}

export interface HiggsfieldStatusResponse {
  status: string
  request_id: string
  images?: { url: string }[]
  video?: { url: string }
  audio?: { url: string }
  error?: string | null
}

async function higgsfieldFetch<T>(
  url: string,
  creds: HiggsfieldCredentials,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: authHeader(creds),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  const text = await res.text()
  let json: unknown
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
  }

  if (!res.ok) {
    const detail = json && typeof json === 'object' && 'detail' in json ? String((json as Record<string, unknown>).detail) : text
    throw new Error(`Higgsfield API ${res.status}: ${detail || res.statusText}`)
  }

  return json as T
}

// Marketing Studio Image — the confirmed model for Qads's product-photo-to-campaign-
// image use case (see mapper.ts for why this model specifically). Endpoint ID
// 'marketing-studio/image' per docs.higgsfield.ai/docs/models/marketing-studio-image.
export interface MarketingStudioImageRequest {
  prompt: string
  image_urls?: string[]
  resolution?: '1k' | '2k' | '4k'
  aspect_ratio?: 'auto' | '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16' | '21:9'
  quality?: 'low' | 'medium' | 'high'
  moderation?: 'auto' | 'low'
  enhance_prompt?: boolean
  preset_id?: string
}

export async function submitMarketingStudioImage(
  creds: HiggsfieldCredentials,
  body: MarketingStudioImageRequest,
  webhookUrl?: string,
): Promise<HiggsfieldSubmitResponse> {
  // Webhook is configured via a query parameter on the submit URL, not a body field —
  // per docs.higgsfield.ai/docs/how-to/webhooks ("Pass an HTTPS endpoint in the
  // hf_webhook query parameter when submitting generation").
  const url = webhookUrl
    ? `${BASE_URL}/marketing-studio/image?hf_webhook=${encodeURIComponent(webhookUrl)}`
    : `${BASE_URL}/marketing-studio/image`
  return higgsfieldFetch<HiggsfieldSubmitResponse>(url, creds, { method: 'POST', body })
}

// Per docs.higgsfield.ai/docs/concepts/requests: "Use the URLs from the response instead
// of constructing them manually" — callers pass the exact status_url/cancel_url a submit
// call returned, not a URL rebuilt from request_id.
export async function getRequestStatus(creds: HiggsfieldCredentials, statusUrl: string): Promise<HiggsfieldStatusResponse> {
  return higgsfieldFetch<HiggsfieldStatusResponse>(statusUrl, creds)
}

export async function cancelRequest(creds: HiggsfieldCredentials, cancelUrl: string): Promise<{ canceled: boolean }> {
  try {
    await higgsfieldFetch<unknown>(cancelUrl, creds, { method: 'POST' })
    return { canceled: true }
  } catch (err) {
    // Per docs: cancellation only works while every job in the request is still queued;
    // once processing has started the API returns 400. That's an expected/normal outcome
    // here, not a real error — surfaced as canceled: false rather than thrown.
    console.warn('[qads/higgsfield] cancel failed (request may have already started):', err instanceof Error ? err.message : err)
    return { canceled: false }
  }
}

export interface HiggsfieldUploadTarget {
  public_url: string
  upload_url: string
  content_type: string
  upload_headers: Record<string, string>
}

// Only needed when a reference image isn't already a public HTTPS URL. Quante's product
// photos are already public (Supabase Storage / generated store assets), so this is a
// fallback path, not the common case — see mapper.ts.
export async function generateUploadUrl(creds: HiggsfieldCredentials, contentType: string): Promise<HiggsfieldUploadTarget> {
  return higgsfieldFetch<HiggsfieldUploadTarget>(`${BASE_URL}/files/generate-upload-url`, creds, {
    method: 'POST',
    body: { content_type: contentType },
  })
}

export async function uploadFileToHiggsfield(target: HiggsfieldUploadTarget, fileBytes: Buffer): Promise<string> {
  const res = await fetch(target.upload_url, {
    method: 'PUT',
    headers: target.upload_headers,
    // TS's DOM lib typing for fetch's BodyInit doesn't include Node's Buffer even
    // though undici (Node's actual fetch implementation) accepts it fine at runtime —
    // same cast shape would be needed anywhere else in this codebase that PUTs a
    // Buffer, there's just no prior example of it.
    body: fileBytes as unknown as BodyInit,
  })
  if (!res.ok) throw new Error(`Higgsfield file upload failed: ${res.status} ${res.statusText}`)
  return target.public_url
}
