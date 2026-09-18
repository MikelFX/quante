// Shared Qads domain types (server-side pipeline + DB row shapes). Mirrors the schema in
// supabase/migration-qads.sql exactly — see docs/qads-proposal.md for the full design.
// Client-facing re-exports live in types/qads.ts (added once the API routes exist).

export type QadsChannel = 'meta' | 'tiktok'
export type QadsAdFormat = '1:1' | '4:5' | '9:16' | '16:9'

export type CampaignGoal = 'launch' | 'sale' | 'black_friday' | 'awareness' | 'custom'

export type CampaignStatus =
  | 'draft'
  | 'generating'
  | 'ready_for_review'
  | 'deploying'
  | 'deployed_paused'
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'

export type AdSetStatus = 'draft' | 'ready' | 'deployed_paused' | 'active' | 'paused'
export type CreativeStatus = 'queued' | 'generating' | 'completed' | 'failed' | 'flagged_for_review'
export type AdApprovalStatus = 'pending' | 'approved' | 'rejected' | 'needs_revision'
export type AdAccountStatus = 'connected' | 'needs_reauth' | 'revoked' | 'error'
export type ExperimentType = 'creative' | 'copy' | 'audience'
export type ExperimentStatus = 'running' | 'evaluating' | 'concluded' | 'inconclusive'
export type ExperimentSuccessMetric = 'ctr' | 'cpa' | 'roas' | 'conversions'

// ─── Brand context ──────────────────────────────────────────────────────────────────
// Derived once per campaign from data Quante already has for the project (see
// lib/qads/claude/brand-context.ts) and then frozen onto qads_campaigns.brand_context —
// every prompt in the pipeline reads this same snapshot instead of re-deriving per node,
// which is what keeps a multi-asset campaign looking like ONE campaign (brief's "brand
// konzistence" requirement).
export interface ShopAdBrandContext {
  brand: {
    name: string
    tagline: string
    logoText?: string
  }
  market: {
    currency: string   // ISO 4217
    language: string   // ISO 639-1
    country: string    // ISO 3166-1 alpha-2
  }
  design: {
    colors: {
      bg: string; text: string; accent: string; accentText: string
      muted: string; surface: string; border: string
    }
    fonts: { heading: string; body: string }
    radius: string
  }
  // No source in the codebase derives a brand "voice" today (StoreConfig has no such
  // field — see docs/qads-proposal.md research). Heuristically inferred in
  // brand-context.ts from copy length/tone as a starting point, always editable by the
  // merchant in CampaignWizard before generation — never presented as authoritative.
  voiceGuess: 'minimal' | 'editorial' | 'playful' | 'luxury' | 'technical'
  products: ShopAdBrandProduct[]
  businessCountry?: string   // project_secrets merchant_json.country, if set — distinct from market.country (target market vs. legal seat)
  pastExperimentNotes?: string[]  // concluded qads_experiments findings folded back into future strategy prompts (§8)
}

export interface ShopAdBrandProduct {
  id: string
  name: string
  description: string
  price: number
  compareAtPrice?: number
  images: string[]
  slug: string
  available: boolean
  tags?: string[]
}

// ─── Pipeline / strategy ────────────────────────────────────────────────────────────

export interface CampaignStrategy {
  positioning: string
  summary: string
  recommendedChannels: QadsChannel[]
}

export interface Angle {
  id: string
  label: string
  hypothesis: string
  sortOrder: number
}

export interface AdSetAudience {
  ageMin?: number
  ageMax?: number
  genders?: string[]
  geo?: string[]
  interests?: string[]
  lookalikeSourceRef?: string
  customAudienceRef?: string
}

export interface AdSetPlan {
  id: string
  angleId: string
  channel: QadsChannel
  name: string
  audience: AdSetAudience
  placements: string[]
  budgetMinor: number
  budgetType: 'daily' | 'lifetime'
  scheduleStart?: string
  scheduleEnd?: string
  bidStrategy?: string
  status: AdSetStatus
  externalId?: string
  externalStatus?: string
}

export interface AdTexts {
  headline: string
  primaryText: string
  description?: string
  cta: string
}

export interface AdPlan {
  id: string
  adSetId: string
  format: QadsAdFormat
  texts: AdTexts
  creativeId?: string
  approvalStatus: AdApprovalStatus
  externalId?: string
  externalStatus?: string
}

// ─── Row shapes (mirror supabase/migration-qads.sql exactly) ───────────────────────

export interface QadsAdAccountRow {
  id: string
  user_id: string
  project_id: string
  channel: QadsChannel
  external_account_id: string
  business_id: string | null
  page_id: string | null
  pixel_id: string | null
  catalog_id: string | null
  access_token_enc: string
  refresh_token_enc: string | null
  token_expires_at: string | null
  scopes: string[]
  status: AdAccountStatus
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface QadsCampaignRow {
  id: string
  user_id: string
  project_id: string
  name: string
  goal: CampaignGoal
  channels: QadsChannel[]
  budget_minor: number
  currency: string
  duration_days: number
  product_ids: string[]
  brief: string
  brand_context: ShopAdBrandContext | null
  strategy: CampaignStrategy | null
  status: CampaignStatus
  pipeline_state: Record<string, unknown>
  credits_reserved: number
  credits_spent: number
  created_at: string
  updated_at: string
}

export interface QadsCampaignChannelLinkRow {
  id: string
  campaign_id: string
  channel: QadsChannel
  ad_account_id: string
  external_campaign_id: string | null
  external_status: string | null
  deploy_payload: unknown
  dry_run: boolean
  deployed_at: string | null
  created_at: string
}

export interface QadsCreativeRow {
  id: string
  campaign_id: string
  type: 'static' | 'video'
  format: QadsAdFormat
  status: CreativeStatus
  provider: string
  model: string | null
  provider_request_id: string | null
  input_params: Record<string, unknown>
  source_product_id: string | null
  source_photo_asset_id: string | null
  asset_id: string | null
  consistency_flag: boolean
  error: string | null
  created_at: string
  updated_at: string
}
