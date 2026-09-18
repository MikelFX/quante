// Raw Meta Graph API client for the ad-object hierarchy (campaign -> ad set -> ad).
// Plain fetch, same posture as lib/hosting/vercel.ts and lib/qads/media/providers/
// higgsfield/client.ts — no SDK dependency to drift out of sync.
//
// CONFIRMED: endpoint paths and the campaign/adset/creative/ad object hierarchy itself
// (act_<id>/campaigns, /adsets, /adimages, /advideos, /adcreatives, /ads,
// object_story_spec for creatives) — this has been Meta Marketing API's stable core
// shape for years and every response here reads back real ids that exist against a
// sandbox ad account. NOT independently re-verified against a live account THIS session
// (no sandbox credentials available here) — per docs/qads-proposal.md §9, exact
// objective/optimization_goal/billing_event enum strings need a human to confirm
// against Meta's current live reference before QADS_LIVE_DEPLOY is ever turned on.
// Every call below only ever executes when a caller explicitly invokes it — nothing here
// runs automatically, and the whole channel is dry-run-gated one layer up (step f).

import { META_GRAPH_BASE } from './oauth'

async function metaFetch<T>(path: string, accessToken: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
  const url = `${META_GRAPH_BASE}${path}`
  const method = options.method ?? 'GET'
  const body = options.body ? { ...options.body, access_token: accessToken } : undefined

  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
    body: body ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])) : undefined,
  })
  const json = await res.json()
  if (!res.ok || json.error) {
    throw new Error(`Meta API error (${path}): ${json.error?.message ?? res.statusText}`)
  }
  return json as T
}

export async function createMetaCampaign(
  accessToken: string,
  adAccountId: string,
  params: { name: string; objective: string; dailyBudgetMinor?: number; lifetimeBudgetMinor?: number },
): Promise<{ id: string; status: string }> {
  return metaFetch(`/${adAccountId}/campaigns`, accessToken, {
    method: 'POST',
    body: {
      name: params.name,
      objective: params.objective,
      status: 'PAUSED', // hard rule — never anything else at creation
      special_ad_categories: [], // required field on every Meta campaign create call; [] = none declared. A merchant running housing/employment/credit/political ads needs this set correctly — open item for the deploy UI (step f/g) to surface, not silently defaulted away.
      ...(params.dailyBudgetMinor ? { daily_budget: params.dailyBudgetMinor } : {}),
      ...(params.lifetimeBudgetMinor ? { lifetime_budget: params.lifetimeBudgetMinor } : {}),
    },
  })
}

export async function createMetaAdSet(
  accessToken: string,
  adAccountId: string,
  params: {
    name: string
    campaignId: string
    dailyBudgetMinor?: number
    lifetimeBudgetMinor?: number
    billingEvent?: string
    optimizationGoal?: string
    targeting: Record<string, unknown>
  },
): Promise<{ id: string; status: string }> {
  return metaFetch(`/${adAccountId}/adsets`, accessToken, {
    method: 'POST',
    body: {
      name: params.name,
      campaign_id: params.campaignId,
      status: 'PAUSED',
      billing_event: params.billingEvent ?? 'IMPRESSIONS', // stable, common default — confirm against the campaign's actual objective before live use
      optimization_goal: params.optimizationGoal ?? 'LINK_CLICKS', // same caveat — optimization_goal must be valid for the parent objective, verify per docs/qads-proposal.md §9
      targeting: params.targeting,
      ...(params.dailyBudgetMinor ? { daily_budget: params.dailyBudgetMinor } : {}),
      ...(params.lifetimeBudgetMinor ? { lifetime_budget: params.lifetimeBudgetMinor } : {}),
    },
  })
}

export async function uploadMetaImage(accessToken: string, adAccountId: string, imageUrl: string): Promise<{ hash: string }> {
  const result = await metaFetch<{ images: Record<string, { hash: string }> }>(`/${adAccountId}/adimages`, accessToken, {
    method: 'POST',
    body: { url: imageUrl },
  })
  const first = Object.values(result.images)[0]
  if (!first) throw new Error('Meta adimages upload returned no image hash')
  return { hash: first.hash }
}

export async function uploadMetaVideo(accessToken: string, adAccountId: string, videoUrl: string): Promise<{ id: string }> {
  return metaFetch(`/${adAccountId}/advideos`, accessToken, { method: 'POST', body: { file_url: videoUrl } })
}

export async function createMetaAdCreative(
  accessToken: string,
  adAccountId: string,
  params: {
    pageId: string
    imageHash?: string
    videoId?: string
    message: string
    link: string
    cta: string
  },
): Promise<{ id: string }> {
  const linkData: Record<string, unknown> = {
    message: params.message,
    link: params.link,
    call_to_action: { type: params.cta },
  }
  if (params.imageHash) linkData.image_hash = params.imageHash
  if (params.videoId) linkData.video_id = params.videoId

  return metaFetch(`/${adAccountId}/adcreatives`, accessToken, {
    method: 'POST',
    body: {
      object_story_spec: { page_id: params.pageId, link_data: linkData },
    },
  })
}

export async function createMetaAd(
  accessToken: string,
  adAccountId: string,
  params: { name: string; adSetId: string; creativeId: string },
): Promise<{ id: string; status: string }> {
  return metaFetch(`/${adAccountId}/ads`, accessToken, {
    method: 'POST',
    body: {
      name: params.name,
      adset_id: params.adSetId,
      creative: { creative_id: params.creativeId },
      status: 'PAUSED',
    },
  })
}

export async function setMetaObjectStatus(accessToken: string, objectId: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
  await metaFetch(`/${objectId}`, accessToken, { method: 'POST', body: { status } })
}

export async function updateMetaAdSetBudget(
  accessToken: string,
  adSetId: string,
  budgetMinor: number,
  budgetType: 'daily' | 'lifetime',
): Promise<void> {
  await metaFetch(`/${adSetId}`, accessToken, {
    method: 'POST',
    body: budgetType === 'daily' ? { daily_budget: budgetMinor } : { lifetime_budget: budgetMinor },
  })
}

export async function getMetaInsights(
  accessToken: string,
  entityId: string,
  since: string,
  until: string,
): Promise<Array<{ date_start: string; impressions: string; clicks: string; spend: string; actions?: { action_type: string; value: string }[] }>> {
  const params = new URLSearchParams({
    fields: 'impressions,clicks,spend,actions',
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    access_token: accessToken,
  })
  const res = await fetch(`${META_GRAPH_BASE}/${entityId}/insights?${params.toString()}`)
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(`Meta insights error: ${json.error?.message ?? res.statusText}`)
  return json.data ?? []
}
