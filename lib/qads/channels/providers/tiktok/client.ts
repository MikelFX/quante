// Raw TikTok Business API client for the campaign -> ad group -> ad hierarchy. Same
// plain-fetch posture as lib/qads/channels/providers/meta/client.ts — no SDK dependency.
//
// CONFIRMED via WebSearch during this implementation step (direct fetch to
// business-api.tiktok.com was blocked in this sandbox, see ./oauth.ts header comment):
// POST /open_api/v1.3/campaign/create/, /adgroup/create/, /ad/create/,
// /file/image/ad/upload/, /file/video/ad/upload/, GET /report/integrated/get/. TikTok's
// hierarchy is campaign -> ad group -> ad (their "ad group" = Meta's "ad set" — the
// AdChannel interface's shared 'ad_set' level name is translated to TikTok's adgroup
// terminology only inside this provider, per types.ts's header comment).
// NOT independently re-verified against a live advertiser account this session — exact
// required/optional field names for campaign_type, objective_type, budget_mode,
// billing_event, optimization_goal, and the placement/targeting object shape are an open
// item per docs/qads-proposal.md §9, same posture as Meta's enum strings. Every call here
// only executes when a caller explicitly invokes it, and the whole channel is dry-run-
// gated one layer up (step f).

import { TIKTOK_API_BASE } from './oauth'

interface TiktokResponse<T> {
  code: number
  message: string
  request_id?: string
  data?: T
}

async function tiktokFetch<T>(
  path: string,
  accessToken: string,
  options: { method?: string; body?: Record<string, unknown>; query?: Record<string, string> } = {},
): Promise<T> {
  const method = options.method ?? 'GET'
  const url = new URL(`${TIKTOK_API_BASE}${path}`)
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const json = (await res.json()) as TiktokResponse<T>
  if (!res.ok || json.code !== 0) {
    throw new Error(`TikTok API error (${path}): ${json.message ?? res.statusText}`)
  }
  if (json.data === undefined) throw new Error(`TikTok API (${path}) returned no data payload`)
  return json.data
}

export async function createTiktokCampaign(
  accessToken: string,
  advertiserId: string,
  params: { name: string; objective: string; dailyBudgetMinor?: number; lifetimeBudgetMinor?: number },
): Promise<{ id: string; status: string }> {
  const data = await tiktokFetch<{ campaign_id: string }>('/campaign/create/', accessToken, {
    method: 'POST',
    body: {
      advertiser_id: advertiserId,
      campaign_name: params.name,
      objective_type: params.objective,
      operation_status: 'DISABLE', // TikTok's PAUSED equivalent at creation — hard rule, never anything else
      budget_mode: params.lifetimeBudgetMinor ? 'BUDGET_MODE_TOTAL' : 'BUDGET_MODE_DAY',
      budget: (params.dailyBudgetMinor ?? params.lifetimeBudgetMinor ?? 0) / 100, // TikTok budgets are in major currency units, not minor — divide down from our internal minor-unit convention
    },
  })
  return { id: data.campaign_id, status: 'DISABLE' }
}

export async function createTiktokAdGroup(
  accessToken: string,
  advertiserId: string,
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
  const data = await tiktokFetch<{ adgroup_id: string }>('/adgroup/create/', accessToken, {
    method: 'POST',
    body: {
      advertiser_id: advertiserId,
      campaign_id: params.campaignId,
      adgroup_name: params.name,
      operation_status: 'DISABLE',
      budget_mode: params.lifetimeBudgetMinor ? 'BUDGET_MODE_TOTAL' : 'BUDGET_MODE_DAY',
      budget: (params.dailyBudgetMinor ?? params.lifetimeBudgetMinor ?? 0) / 100,
      billing_event: params.billingEvent ?? 'CPM',
      optimization_goal: params.optimizationGoal ?? 'CLICK',
      ...params.targeting,
    },
  })
  return { id: data.adgroup_id, status: 'DISABLE' }
}

export async function uploadTiktokImage(accessToken: string, advertiserId: string, imageUrl: string): Promise<{ imageId: string }> {
  const data = await tiktokFetch<{ image_id: string }[]>('/file/image/ad/upload/', accessToken, {
    method: 'POST',
    body: { advertiser_id: advertiserId, upload_type: 'UPLOAD_BY_URL', image_url: imageUrl },
  })
  const first = Array.isArray(data) ? data[0] : (data as unknown as { image_id: string })
  if (!first?.image_id) throw new Error('TikTok image upload returned no image_id')
  return { imageId: first.image_id }
}

export async function uploadTiktokVideo(accessToken: string, advertiserId: string, videoUrl: string): Promise<{ videoId: string }> {
  const data = await tiktokFetch<{ video_id: string }[]>('/file/video/ad/upload/', accessToken, {
    method: 'POST',
    body: { advertiser_id: advertiserId, upload_type: 'UPLOAD_BY_URL', video_url: videoUrl },
  })
  const first = Array.isArray(data) ? data[0] : (data as unknown as { video_id: string })
  if (!first?.video_id) throw new Error('TikTok video upload returned no video_id')
  return { videoId: first.video_id }
}

export async function createTiktokAd(
  accessToken: string,
  advertiserId: string,
  params: {
    adgroupId: string
    name: string
    imageId?: string
    videoId?: string
    identityId?: string
    text: string
    landingPageUrl: string
    cta: string
  },
): Promise<{ id: string; status: string }> {
  // TikTok's ad/create/ combines creative + ad object into one call (unlike Meta's
  // separate adcreatives -> ads two-step) — creative_material_mode/identity_id requires a
  // TikTok "identity" (a connected TikTok account or a registered "Custom Identity"),
  // conceptually parallel to Meta's page_id requirement. Not yet threaded through
  // AdChannelCreativeInput (same documented gap as Meta's pageId, see meta/mapper.ts) —
  // the deploy layer (step f) is expected to resolve it from qads_ad_accounts.
  const data = await tiktokFetch<{ ad_ids: string[] }>('/ad/create/', accessToken, {
    method: 'POST',
    body: {
      advertiser_id: advertiserId,
      adgroup_id: params.adgroupId,
      creatives: [
        {
          ad_name: params.name,
          ad_format: params.videoId ? 'SINGLE_VIDEO' : 'SINGLE_IMAGE',
          image_ids: params.imageId ? [params.imageId] : undefined,
          video_id: params.videoId,
          identity_id: params.identityId,
          identity_type: params.identityId ? 'CUSTOMIZED_USER' : undefined,
          ad_text: params.text,
          landing_page_url: params.landingPageUrl,
          call_to_action: params.cta,
        },
      ],
    },
  })
  const adId = data.ad_ids?.[0]
  if (!adId) throw new Error('TikTok ad/create/ returned no ad id')
  return { id: adId, status: 'DISABLE' }
}

export async function setTiktokObjectStatus(
  accessToken: string,
  advertiserId: string,
  level: 'campaign' | 'adgroup' | 'ad',
  objectId: string,
  status: 'ENABLE' | 'DISABLE',
): Promise<void> {
  const pathByLevel: Record<typeof level, string> = {
    campaign: '/campaign/update/status/',
    adgroup: '/adgroup/update/status/',
    ad: '/ad/update/status/',
  }
  const idFieldByLevel: Record<typeof level, string> = {
    campaign: 'campaign_ids',
    adgroup: 'adgroup_ids',
    ad: 'ad_ids',
  }
  await tiktokFetch(pathByLevel[level], accessToken, {
    method: 'POST',
    body: { advertiser_id: advertiserId, [idFieldByLevel[level]]: [objectId], operation_status: status },
  })
}

export async function updateTiktokAdGroupBudget(
  accessToken: string,
  advertiserId: string,
  adgroupId: string,
  budgetMinor: number,
  budgetType: 'daily' | 'lifetime',
): Promise<void> {
  await tiktokFetch('/adgroup/update/', accessToken, {
    method: 'POST',
    body: {
      advertiser_id: advertiserId,
      adgroup_id: adgroupId,
      budget_mode: budgetType === 'lifetime' ? 'BUDGET_MODE_TOTAL' : 'BUDGET_MODE_DAY',
      budget: budgetMinor / 100,
    },
  })
}

export async function getTiktokInsights(
  accessToken: string,
  advertiserId: string,
  level: 'campaign' | 'ad_set' | 'ad',
  entityId: string,
  since: string,
  until: string,
): Promise<Array<{ dimensions: { stat_time_day: string }; metrics: { impressions: string; clicks: string; spend: string; conversion?: string } }>> {
  const dataLevelByLevel: Record<typeof level, string> = {
    campaign: 'AUCTION_CAMPAIGN',
    ad_set: 'AUCTION_ADGROUP',
    ad: 'AUCTION_AD',
  }
  const filterIdField = level === 'campaign' ? 'campaign_ids' : level === 'ad_set' ? 'adgroup_ids' : 'ad_ids'

  const data = await tiktokFetch<{ list: Array<{ dimensions: { stat_time_day: string }; metrics: Record<string, string> }> }>(
    '/report/integrated/get/',
    accessToken,
    {
      method: 'GET',
      query: {
        advertiser_id: advertiserId,
        report_type: 'BASIC',
        data_level: dataLevelByLevel[level],
        dimensions: JSON.stringify(['stat_time_day']),
        metrics: JSON.stringify(['impressions', 'clicks', 'spend', 'conversion']),
        start_date: since,
        end_date: until,
        filtering: JSON.stringify([{ field_name: filterIdField, filter_type: 'IN', filter_value: JSON.stringify([entityId]) }]),
        page_size: '1000',
      },
    },
  )
  return (data.list ?? []) as Array<{ dimensions: { stat_time_day: string }; metrics: { impressions: string; clicks: string; spend: string; conversion?: string } }>
}
