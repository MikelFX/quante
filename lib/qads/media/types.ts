// Media provider abstraction — an external image/video generation API (Higgsfield is the
// first and only implementation). Mirrors lib/fulfillment/types.ts + registry.ts exactly:
// provider-agnostic domain types here, all Higgsfield-specific field names/shapes live in
// providers/higgsfield/mapper.ts, so a second provider can be added later without
// touching pipeline/nodes/images.ts or video.ts.
//
// Shaped against Higgsfield's actual documented request lifecycle (fetched from
// docs.higgsfield.ai during this step — not guessed): submission is async and returns
// {status, request_id, status_url, cancel_url} immediately; terminal states are
// completed/failed/nsfw/canceled. Two deliberate departures from the original Phase-1
// proposal sketch, both because the real docs turned out more specific than the sketch
// assumed:
//   1. getStatus/cancel take the actual status_url/cancel_url returned by submit(),
//      not a reconstructed URL from providerRequestId — Higgsfield's docs explicitly
//      say "use the URLs from the response instead of constructing them manually."
//   2. MediaGenerationInput has no generic `strength` field — the confirmed model for
//      Qads's use case (Marketing Studio Image, see providers/higgsfield/mapper.ts) has
//      no such parameter; it takes a prompt + reference image(s) and an optional preset.

export type MediaRequestStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled'

export interface MediaGenerationInput {
  kind: 'image' | 'video'
  prompt: string
  // Qads' own small ad-format vocabulary (matches qads_creatives.format) — each
  // provider's mapper.ts translates this into that provider's own aspect-ratio enum.
  format: '1:1' | '4:5' | '9:16' | '16:9'
  // Product-fidelity requirement (docs/qads-proposal.md §3.3) — mandatory, never
  // optional, for anything depicting a real product. This is the product's own photo,
  // not a mood-board reference.
  referenceImageUrl: string
  // Optional second reference (e.g. a model/person shot) for providers whose enhanced
  // mode accepts one — ignored by providers/modes that don't support it.
  modelImageUrl?: string
  webhookUrl?: string
}

export interface MediaGenerationHandle {
  providerRequestId: string
  statusUrl: string
  cancelUrl?: string
}

export interface MediaGenerationResult {
  status: MediaRequestStatus
  assets?: { url: string; contentType?: string }[]
  error?: string | null
}

export interface MediaProvider {
  readonly slug: string
  submit(input: MediaGenerationInput): Promise<MediaGenerationHandle>
  getStatus(statusUrl: string): Promise<MediaGenerationResult>
  cancel(cancelUrl: string): Promise<{ canceled: boolean }>
  // Called by the webhook route after basic request_id ownership checking (see
  // app/api/webhooks/higgsfield/route.ts header comment on why there's no signature
  // verification step here) — shared normalization path with getStatus so a webhook
  // delivery and a poll produce the exact same MediaGenerationResult shape.
  parseWebhookPayload(body: unknown): { providerRequestId: string; result: MediaGenerationResult } | null
}
