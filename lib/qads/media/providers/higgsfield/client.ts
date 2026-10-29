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

// status_url / cancel_url come back from Higgsfield and are stored in the DB; they are
// fetched WITH our API key in the Authorization header, so refuse anything that is not
// an https URL on a higgsfield.ai host — a tampered URL must never receive the key.
function assertHiggsfieldApiUrl(raw: string): void {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('Invalid Higgsfield URL')
  }
  const host = u.hostname.toLowerCase()
  if (u.protocol !== 'https:' || (host !== 'higgsfield.ai' && !host.endsWith('.higgsfield.ai'))) {
    throw new Error(`Refusing to send Higgsfield credentials to ${host}`)
  }
}

// Per docs.higgsfield.ai/docs/concepts/requests: "Use the URLs from the response instead
// of constructing them manually" — callers pass the exact status_url/cancel_url a submit
// call returned, not a URL rebuilt from request_id.
export async function getRequestStatus(creds: HiggsfieldCredentials, statusUrl: string): Promise<HiggsfieldStatusResponse> {
  assertHiggsfieldApiUrl(statusUrl)
  return higgsfieldFetch<HiggsfieldStatusResponse>(statusUrl, creds)
}

export async function cancelRequest(creds: HiggsfieldCredentials, cancelUrl: string): Promise<{ canceled: boolean }> {
  try {
    assertHiggsfieldApiUrl(cancelUrl)
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

// Seedance 2.5 Reference To Video — the confirmed model for Qads's product-photo-to-video
// creative (see mapper.ts). Endpoint ID 'bytedance/seedance-2.5/reference-to-video' per
// docs.higgsfield.ai/docs/models/seedance-2-5/reference-to-video. Distinct from
// Marketing Studio Image's schema (own resolution/duration/aspect_ratio enums, no
// preset concept) — kept as its own request type rather than force-fit into
// MarketingStudioImageRequest.
export interface SeedanceReferenceToVideoRequest {
  prompt?: string
  resolution?: '480p' | '720p' | '1080p'
  generate_audio?: boolean
  duration?: number // 4-30 seconds
  aspect_ratio: '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9' // explicit value required for reference-to-video — no 'auto'/-1 per docs
  output_format?: 'mp4' | 'mov'
  image_urls?: string[] // 1-30 public URLs — at least one image/video/audio reference required
}

export async function submitSeedanceReferenceToVideo(
  creds: HiggsfieldCredentials,
  body: SeedanceReferenceToVideoRequest,
  webhookUrl?: string,
): Promise<HiggsfieldSubmitResponse> {
  const url = webhookUrl
    ? `${BASE_URL}/bytedance/seedance-2.5/reference-to-video?hf_webhook=${encodeURIComponent(webhookUrl)}`
    : `${BASE_URL}/bytedance/seedance-2.5/reference-to-video`
  return higgsfieldFetch<HiggsfieldSubmitResponse>(url, creds, { method: 'POST', body })
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

// Higgsfield AI Influencer — one character sheet (the Tiktoker "Character"). Endpoint
// 'higgsfield/ai-influencer' per console.higgsfield.ai/models/higgsfield/ai-influencer
// (API reference + input schema, fetched 2026-10-28). `selection` maps a trait category
// (gender, age, hair, aesthetic, …) to option ids from the model's own option list;
// item_image_urls (≤ 3) are things the character carries, e.g. the product.
export interface AiInfluencerRequest {
  tier?: 'normal'
  brief?: string // ≤ 4000 chars
  selection?: Record<string, string[]>
  item_image_urls?: string[]
  seed?: number // 1-1 000 000
}

export async function submitAiInfluencer(
  creds: HiggsfieldCredentials,
  body: AiInfluencerRequest,
  webhookUrl?: string,
): Promise<HiggsfieldSubmitResponse> {
  const url = webhookUrl
    ? `${BASE_URL}/higgsfield/ai-influencer?hf_webhook=${encodeURIComponent(webhookUrl)}`
    : `${BASE_URL}/higgsfield/ai-influencer`
  return higgsfieldFetch<HiggsfieldSubmitResponse>(url, creds, { method: 'POST', body })
}

// Wan 3.0 Reference to Video — the Tiktoker clip: the character sheet + product photo as
// references, native audio on, so the character says the script with lip sync. Endpoint ID
// 'alibaba/wan-3.0/reference-to-video' per docs.higgsfield.ai/docs/models/wan-3/reference-to-video.
export interface WanReferenceToVideoRequest {
  prompt: string
  duration?: number // 2-30 seconds
  image_urls?: string[] // ≤ 10
  resolution?: '480p' | '720p' | '1080p'
  aspect_ratio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | 'adaptive'
  generate_audio?: boolean
  seed?: number
}

export async function submitWanReferenceToVideo(
  creds: HiggsfieldCredentials,
  body: WanReferenceToVideoRequest,
  webhookUrl?: string,
): Promise<HiggsfieldSubmitResponse> {
  const url = webhookUrl
    ? `${BASE_URL}/alibaba/wan-3.0/reference-to-video?hf_webhook=${encodeURIComponent(webhookUrl)}`
    : `${BASE_URL}/alibaba/wan-3.0/reference-to-video`
  return higgsfieldFetch<HiggsfieldSubmitResponse>(url, creds, { method: 'POST', body })
}
