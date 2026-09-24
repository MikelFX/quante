// Maps Qads's provider-agnostic MediaGenerationInput to Higgsfield's Marketing Studio
// Image request shape, and its response back to the provider-agnostic
// MediaGenerationResult/status.
//
// WHY Marketing Studio Image specifically: docs/qads-proposal.md flagged "exact
// Higgsfield model(s) to use" as an open question needing a human with console access.
// During this implementation step, docs.higgsfield.ai's own image-generation model
// catalog (fetched, not guessed) surfaced Marketing Studio Image as a first-class,
// purpose-built model: "Generate campaign-ready images directly or use a Marketing
// Studio preset with product and model references" — its "enhanced mode" accepts
// exactly one product image (+ optional model image) and outputs a campaign-ready
// composition, which is a closer fit to Qads's product-fidelity requirement (§3.3) than
// a general portrait/style model like SOUL. This resolves that open question rather than
// leaving it a stub, though the exact preset_id catalog (see listPresets below) still
// needs a human to browse and choose defaults from — that part remains a follow-up.

import {
  submitMarketingStudioImage,
  submitSeedanceReferenceToVideo,
  getRequestStatus,
  cancelRequest,
  type HiggsfieldCredentials,
  type HiggsfieldStatusResponse,
} from './client'
import type { MediaGenerationInput, MediaGenerationHandle, MediaGenerationResult, MediaRequestStatus } from '../../types'

// Higgsfield's documented aspect_ratio enum has no native 4:5 (Instagram-portrait) value
// — confirmed against the model's Input Schema, not assumed missing. 3:4 (0.75) is the
// closest supported ratio to 4:5 (0.8); flagged here rather than silently rounded so a
// future pass can revisit if Higgsfield adds 4:5 support.
const FORMAT_TO_ASPECT_RATIO: Record<MediaGenerationInput['format'], NonNullable<Parameters<typeof submitMarketingStudioImage>[1]['aspect_ratio']>> = {
  '1:1': '1:1',
  '4:5': '3:4', // closest supported value — see note above
  '9:16': '9:16',
  '16:9': '16:9',
}

export function buildMarketingStudioRequest(input: MediaGenerationInput, presetId?: string) {
  const imageUrls = [input.referenceImageUrl, ...(input.modelImageUrl ? [input.modelImageUrl] : [])]
  // Enhanced mode (preset-guided composition) requires both a preset_id and at least one
  // image_urls entry per the documented schema. Without a configured preset (the console-
  // browsing open question above), Qads uses "Direct edit" mode instead — prompt +
  // image_urls, no preset — which is fully documented and product-fidelity-safe on its
  // own (the reference image is still passed, still required), just without a Marketing
  // Studio preset's extra styling guidance.
  const useEnhanced = Boolean(presetId && input.modelImageUrl)

  return {
    prompt: input.prompt,
    image_urls: imageUrls,
    resolution: '2k' as const,
    aspect_ratio: FORMAT_TO_ASPECT_RATIO[input.format],
    quality: 'high' as const,
    enhance_prompt: useEnhanced,
    ...(useEnhanced && presetId ? { preset_id: presetId } : {}),
  }
}

// Seedance's aspect_ratio enum (16:9, 4:3, 1:1, 3:4, 9:16, 21:9) also has no native 4:5 —
// same approximation as the image mapper, same reasoning: 3:4 (0.75) is the closest
// supported value to 4:5 (0.8).
const FORMAT_TO_VIDEO_ASPECT_RATIO: Record<MediaGenerationInput['format'], NonNullable<Parameters<typeof submitSeedanceReferenceToVideo>[1]['aspect_ratio']>> = {
  '1:1': '1:1',
  '4:5': '3:4',
  '9:16': '9:16',
  '16:9': '16:9',
}

export function buildSeedanceVideoRequest(input: MediaGenerationInput) {
  return {
    prompt: input.prompt,
    image_urls: [input.referenceImageUrl, ...(input.modelImageUrl ? [input.modelImageUrl] : [])],
    resolution: '720p' as const,
    generate_audio: false, // ad creative audio is a separate, later decision (music/VO licensing) — silent by default
    // Render the duration the user was charged for (pricing is per second). Clamped to
    // Seedance's documented 4-30s range; 5s only when no duration was supplied.
    duration: Number.isFinite(input.durationSeconds)
      ? Math.min(30, Math.max(4, Math.round(input.durationSeconds as number)))
      : 5,
    aspect_ratio: FORMAT_TO_VIDEO_ASPECT_RATIO[input.format],
    output_format: 'mp4' as const,
  }
}

export async function submitViaMapper(
  creds: HiggsfieldCredentials,
  input: MediaGenerationInput,
  presetId: string | undefined,
): Promise<MediaGenerationHandle> {
  const response = input.kind === 'video'
    ? await submitSeedanceReferenceToVideo(creds, buildSeedanceVideoRequest(input), input.webhookUrl)
    : await submitMarketingStudioImage(creds, buildMarketingStudioRequest(input, presetId), input.webhookUrl)

  return {
    providerRequestId: response.request_id,
    statusUrl: response.status_url,
    cancelUrl: response.cancel_url,
  }
}

export async function getStatusViaMapper(creds: HiggsfieldCredentials, statusUrl: string): Promise<MediaGenerationResult> {
  const response = await getRequestStatus(creds, statusUrl)
  return normalizeStatusResponse(response)
}

export async function cancelViaMapper(creds: HiggsfieldCredentials, cancelUrl: string): Promise<{ canceled: boolean }> {
  return cancelRequest(creds, cancelUrl)
}

function normalizeStatusResponse(response: HiggsfieldStatusResponse): MediaGenerationResult {
  const status = response.status as MediaRequestStatus
  const assets: MediaGenerationResult['assets'] = []
  if (response.images) assets.push(...response.images.map((img) => ({ url: img.url })))
  if (response.video) assets.push({ url: response.video.url })
  if (response.audio) assets.push({ url: response.audio.url })

  return {
    status,
    assets: assets.length ? assets : undefined,
    error: response.error ?? null,
  }
}

// Webhook envelope confirmed at docs.higgsfield.ai/docs/how-to/webhooks:
// { request_id, status, error, payload: { images: [{url, content_type}] } | { video: {...} } | null }
// Distinct shape from the polling status response above (payload is nested, not flat) —
// kept as a separate parse function rather than forcing both through one normalizer.
export function parseHiggsfieldWebhook(body: unknown): { providerRequestId: string; result: MediaGenerationResult } | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.request_id !== 'string' || typeof b.status !== 'string') return null

  const payload = b.payload as Record<string, unknown> | null | undefined
  const assets: MediaGenerationResult['assets'] = []
  if (payload && typeof payload === 'object') {
    const images = payload.images as { url: string; content_type?: string }[] | undefined
    if (Array.isArray(images)) assets.push(...images.map((i) => ({ url: i.url, contentType: i.content_type })))
    const video = payload.video as { url: string; content_type?: string } | undefined
    if (video) assets.push({ url: video.url, contentType: video.content_type })
    const audio = payload.audio as { url: string; content_type?: string } | undefined
    if (audio) assets.push({ url: audio.url, contentType: audio.content_type })
  }

  return {
    providerRequestId: b.request_id,
    result: {
      status: b.status as MediaRequestStatus,
      assets: assets.length ? assets : undefined,
      error: (b.error as string | null | undefined) ?? null,
    },
  }
}
