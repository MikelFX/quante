'use client'

// Qads Studio surface — connections, campaign creation/review, deploy approval,
// activate/pause, budget edits, metrics dashboard, experiments. Every API call here maps
// 1:1 to a route built in steps (a)-(i); this file adds no new server logic of its own.
//
// Design language: same dark/editorial-technical tokens as StudioClient.tsx (CLAUDE.md
// §12) — #D4FF3F accent, #f4f4f6 text, #8a8a93 muted, rgba(255,255,255,.0x) surfaces —
// kept as plain inline styles to match that file's convention rather than introducing a
// second styling approach for one corner of the Studio.

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

const COLORS = {
  bg: '#0a0a0c',
  surface: 'rgba(255,255,255,.04)',
  surfaceHover: 'rgba(255,255,255,.06)',
  border: 'rgba(255,255,255,.1)',
  text: '#f4f4f6',
  muted: '#8a8a93',
  accent: '#D4FF3F',
  accentSoft: 'rgba(212,255,63,.18)',
  accentText: '#a8afff',
  danger: '#e5686b',
  success: '#3ecf8e',
  warn: '#e0a83e',
}

type QadsChannel = 'meta' | 'tiktok'

interface AdAccount {
  id: string
  channel: QadsChannel
  external_account_id: string
  status: string
  last_error: string | null
}

interface CampaignSummary {
  id: string
  name: string
  goal: string
  channels: QadsChannel[]
  budget_minor: number
  currency: string
  status: string
  created_at: string
}

interface CampaignDetail {
  campaign: CampaignSummary & { pipeline_state: Record<string, string>; strategy: { positioning: string; summary: string } | null }
  angles: { id: string; label: string; hypothesis: string }[]
  adSets: { id: string; angle_id: string; channel: QadsChannel; name: string; budget_minor: number; budget_type: string; status: string; external_id: string | null; external_status: string | null }[]
  ads: { id: string; ad_set_id: string; format: string; texts: { headline: string; primaryText: string; cta: string }; approval_status: string; external_id: string | null; external_status: string | null }[]
}

function money(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`
}

async function apiCall<T>(url: string, options?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.error ?? `Request failed (${res.status})` }
    return { ok: true, data: json as T }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export function AdsClient({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([])
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [showNewCampaign, setShowNewCampaign] = useState(false)

  const connectNotice = searchParams.get('qads_connected')
  const errorNotice = searchParams.get('qads_error')

  const loadAdAccounts = useCallback(async () => {
    const res = await apiCall<{ adAccounts: AdAccount[] }>(`/api/qads/ad-accounts?project_id=${projectId}`)
    if (res.ok && res.data) setAdAccounts(res.data.adAccounts)
  }, [projectId])

  const loadCampaigns = useCallback(async () => {
    const res = await apiCall<{ campaigns: CampaignSummary[] }>(`/api/qads/campaigns?project_id=${projectId}`)
    if (res.ok && res.data) setCampaigns(res.data.campaigns)
  }, [projectId])

  const loadDetail = useCallback(async (campaignId: string) => {
    const res = await apiCall<CampaignDetail>(`/api/qads/campaigns/${campaignId}`)
    if (res.ok && res.data) setDetail(res.data)
  }, [])

  useEffect(() => { loadAdAccounts(); loadCampaigns() }, [loadAdAccounts, loadCampaigns])
  useEffect(() => { if (selectedCampaignId) loadDetail(selectedCampaignId) }, [selectedCampaignId, loadDetail])

  useEffect(() => {
    if (connectNotice) setBanner({ kind: 'ok', text: `${connectNotice} connected.` })
    if (errorNotice) setBanner({ kind: 'error', text: `Connection failed: ${errorNotice}` })
  }, [connectNotice, errorNotice])

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text, fontFamily: 'var(--font-geist-sans, sans-serif)' }}>
      <TopBar projectId={projectId} projectName={projectName} router={router} />

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 80px' }}>
        {banner && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: banner.kind === 'ok' ? 'rgba(62,207,142,.1)' : 'rgba(229,104,107,.1)',
            border: `1px solid ${banner.kind === 'ok' ? 'rgba(62,207,142,.3)' : 'rgba(229,104,107,.3)'}`,
            color: banner.kind === 'ok' ? COLORS.success : COLORS.danger,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{banner.text}</span>
            <button onClick={() => setBanner(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
        )}

        <AdAccountsSection adAccounts={adAccounts} projectId={projectId} onDisconnected={loadAdAccounts} setBanner={setBanner} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '28px 0 12px' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, margin: 0 }}>Campaigns</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <KillSwitchButton projectId={projectId} setBanner={setBanner} onDone={loadCampaigns} />
            <button
              onClick={() => setShowNewCampaign((v) => !v)}
              style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 7, border: 'none', background: COLORS.accent, color: '#fff', cursor: 'pointer' }}
            >
              + New campaign
            </button>
          </div>
        </div>

        {showNewCampaign && (
          <NewCampaignForm
            projectId={projectId}
            adAccounts={adAccounts}
            setBanner={setBanner}
            onCreated={(id) => { setShowNewCampaign(false); loadCampaigns(); setSelectedCampaignId(id) }}
          />
        )}

        <CampaignList campaigns={campaigns} selectedId={selectedCampaignId} onSelect={setSelectedCampaignId} />

        {selectedCampaignId && detail && (
          <CampaignDetailPanel
            detail={detail}
            adAccounts={adAccounts}
            setBanner={setBanner}
            onRefresh={() => loadDetail(selectedCampaignId)}
          />
        )}
      </div>
    </div>
  )
}

function TopBar({ projectId, projectName, router }: { projectId: string; projectName: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 20px', borderBottom: `1px solid ${COLORS.border}`, position: 'sticky', top: 0, background: COLORS.bg, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => router.push(`/project/${projectId}`)}
          style={{ fontSize: 12, color: COLORS.muted, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          ← {projectName}
        </button>
        <span style={{ color: COLORS.border }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Ads</span>
      </div>
    </div>
  )
}

function AdAccountsSection({
  adAccounts, projectId, onDisconnected, setBanner,
}: {
  adAccounts: AdAccount[]
  projectId: string
  onDisconnected: () => void
  setBanner: (b: { kind: 'ok' | 'error'; text: string } | null) => void
}) {
  const byChannel = new Map(adAccounts.map((a) => [a.channel, a]))

  async function disconnect(id: string) {
    if (!window.confirm('Disconnect this ad account? Already-created campaigns on the channel are left untouched.')) return
    const res = await apiCall(`/api/qads/ad-accounts/${id}`, { method: 'DELETE' })
    if (!res.ok) setBanner({ kind: 'error', text: res.error ?? 'Failed to disconnect' })
    else onDisconnected()
  }

  return (
    <div>
      <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>Connected ad accounts</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        {(['meta', 'tiktok'] as const).map((channel) => {
          const account = byChannel.get(channel)
          return (
            <div key={channel} style={{
              flex: 1, padding: 14, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: COLORS.surface,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>{channel}</span>
                {account && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '.03em',
                    background: account.status === 'connected' ? 'rgba(62,207,142,.12)' : 'rgba(229,104,107,.12)',
                    color: account.status === 'connected' ? COLORS.success : COLORS.danger,
                  }}>
                    {account.status}
                  </span>
                )}
              </div>
              {account ? (
                <>
                  <p style={{ fontSize: 11, color: COLORS.muted, margin: '6px 0 10px' }}>Ad account {account.external_account_id}</p>
                  {account.last_error && <p style={{ fontSize: 11, color: COLORS.danger, margin: '0 0 10px' }}>{account.last_error}</p>}
                  <button
                    onClick={() => disconnect(account.id)}
                    style={{ fontSize: 11, color: COLORS.muted, background: 'none', border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 11, color: COLORS.muted, margin: '6px 0 10px' }}>Not connected</p>
                  <a
                    href={`/api/qads/ad-accounts/${channel}/connect?project_id=${projectId}`}
                    style={{
                      display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#fff', background: COLORS.accent,
                      borderRadius: 6, padding: '6px 12px', textDecoration: 'none',
                    }}
                  >
                    Connect {channel === 'meta' ? 'Meta' : 'TikTok'}
                  </a>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function KillSwitchButton({ projectId, setBanner, onDone }: { projectId: string; setBanner: (b: { kind: 'ok' | 'error'; text: string } | null) => void; onDone: () => void }) {
  async function trigger() {
    if (!window.confirm('This pauses EVERY live campaign for this store across every connected channel. Continue?')) return
    const res = await apiCall<{ pausedCampaigns: number }>('/api/qads/kill-switch', { method: 'POST', body: JSON.stringify({ projectId }) })
    if (!res.ok) setBanner({ kind: 'error', text: res.error ?? 'Kill switch failed' })
    else { setBanner({ kind: 'ok', text: `Paused ${res.data?.pausedCampaigns ?? 0} campaign(s).` }); onDone() }
  }
  return (
    <button
      onClick={trigger}
      style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 7, border: `1px solid rgba(229,104,107,.4)`, background: 'rgba(229,104,107,.08)', color: COLORS.danger, cursor: 'pointer' }}
    >
      Kill switch
    </button>
  )
}

function NewCampaignForm({
  projectId, adAccounts, setBanner, onCreated,
}: {
  projectId: string
  adAccounts: AdAccount[]
  setBanner: (b: { kind: 'ok' | 'error'; text: string } | null) => void
  onCreated: (campaignId: string) => void
}) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('launch')
  const [channels, setChannels] = useState<QadsChannel[]>([])
  const [budget, setBudget] = useState('50')
  const [days, setDays] = useState('14')
  const [brief, setBrief] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const connectedChannels = new Set(adAccounts.filter((a) => a.status === 'connected').map((a) => a.channel))

  function toggleChannel(c: QadsChannel) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  async function submit() {
    if (!name.trim() || !brief.trim() || channels.length === 0) {
      setBanner({ kind: 'error', text: 'Name, brief, and at least one channel are required' })
      return
    }
    setSubmitting(true)
    const res = await apiCall<{ campaignId: string }>('/api/qads/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        projectId, name: name.trim(), goal, channels,
        budgetMinor: Math.round(Number(budget) * 100), durationDays: Number(days), brief: brief.trim(),
      }),
    })
    setSubmitting(false)
    if (!res.ok) setBanner({ kind: 'error', text: res.error ?? 'Failed to create campaign' })
    else if (res.data) { setBanner({ kind: 'ok', text: 'Campaign generated.' }); onCreated(res.data.campaignId) }
  }

  return (
    <div style={{ padding: 16, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: COLORS.surface, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} /></Field>
        <Field label="Goal">
          <select value={goal} onChange={(e) => setGoal(e.target.value)} style={inputStyle}>
            {['launch', 'sale', 'black_friday', 'awareness', 'custom'].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Budget (major currency units)"><input value={budget} onChange={(e) => setBudget(e.target.value)} style={inputStyle} /></Field>
        <Field label="Duration (days)"><input value={days} onChange={(e) => setDays(e.target.value)} style={inputStyle} /></Field>
      </div>
      <Field label="Channels">
        <div style={{ display: 'flex', gap: 8 }}>
          {(['meta', 'tiktok'] as const).map((c) => (
            <button
              key={c}
              onClick={() => toggleChannel(c)}
              disabled={!connectedChannels.has(c)}
              title={!connectedChannels.has(c) ? 'Connect this channel first' : undefined}
              style={{
                fontSize: 12, padding: '6px 12px', borderRadius: 6, cursor: connectedChannels.has(c) ? 'pointer' : 'not-allowed',
                border: `1px solid ${channels.includes(c) ? COLORS.accent : COLORS.border}`,
                background: channels.includes(c) ? COLORS.accentSoft : 'transparent',
                color: connectedChannels.has(c) ? COLORS.text : COLORS.muted,
                opacity: connectedChannels.has(c) ? 1 : 0.5,
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Brief (what should this campaign sell / say?)">
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' as const }} />
      </Field>
      <button
        onClick={submit}
        disabled={submitting}
        style={{ marginTop: 8, fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 7, border: 'none', background: COLORS.accent, color: '#fff', cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1 }}
      >
        {submitting ? 'Generating… (10 credits)' : 'Generate campaign (10 credits)'}
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'block', fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 6,
  border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.03)', color: COLORS.text,
}

function CampaignList({ campaigns, selectedId, onSelect }: { campaigns: CampaignSummary[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (!campaigns.length) return <p style={{ fontSize: 12, color: COLORS.muted }}>No campaigns yet.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
      {campaigns.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left',
            padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
            border: `1px solid ${selectedId === c.id ? COLORS.accent : COLORS.border}`,
            background: selectedId === c.id ? COLORS.accentSoft : COLORS.surface,
            color: COLORS.text,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</span>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: COLORS.muted }}>{c.channels.join(', ')}</span>
            <span style={{ fontSize: 11, color: COLORS.muted }}>{money(c.budget_minor, c.currency)}</span>
            <StatusPill status={c.status} />
          </span>
        </button>
      ))}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    active: COLORS.success, deployed_paused: COLORS.warn, ready_for_review: COLORS.accentText,
    failed: COLORS.danger, paused: COLORS.muted, generating: COLORS.muted, draft: COLORS.muted,
  }
  const color = colorMap[status] ?? COLORS.muted
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '.03em', color, background: `${color}22` }}>
      {status.replace('_', ' ')}
    </span>
  )
}

function CampaignDetailPanel({
  detail, adAccounts, setBanner, onRefresh,
}: {
  detail: CampaignDetail
  adAccounts: AdAccount[]
  setBanner: (b: { kind: 'ok' | 'error'; text: string } | null) => void
  onRefresh: () => void
}) {
  const { campaign, angles, adSets, ads } = detail
  const [deployResult, setDeployResult] = useState<{ payloadsByChannel: Record<string, unknown>; validationErrors: Record<string, string[]>; liveDeployEnabled: boolean } | null>(null)
  const [metrics, setMetrics] = useState<{ totals: Record<string, number | null>; dailySeries: { day: string; spend_minor: number; impressions: number; clicks: number }[] } | null>(null)
  const [experiments, setExperiments] = useState<{ id: string; type: string; status: string; success_metric: string }[]>([])
  const [showExperimentForm, setShowExperimentForm] = useState(false)

  const loadMetrics = useCallback(async () => {
    const res = await apiCall<typeof metrics>(`/api/qads/campaigns/${campaign.id}/metrics`)
    if (res.ok && res.data) setMetrics(res.data)
  }, [campaign.id])
  const loadExperiments = useCallback(async () => {
    const res = await apiCall<{ experiments: typeof experiments }>(`/api/qads/experiments?campaign_id=${campaign.id}`)
    if (res.ok && res.data) setExperiments(res.data.experiments)
  }, [campaign.id])

  useEffect(() => { loadMetrics(); loadExperiments() }, [loadMetrics, loadExperiments])

  async function runDeploy(confirmChannel?: QadsChannel) {
    const body = confirmChannel ? { confirmChannel } : {}
    if (confirmChannel && !window.confirm(`Deploy ${confirmChannel} LIVE? This creates real (paused) objects on the connected ad account.`)) return
    const res = await apiCall<typeof deployResult>(`/api/qads/campaigns/${campaign.id}/deploy`, { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) setBanner({ kind: 'error', text: res.error ?? 'Deploy failed' })
    else { setDeployResult(res.data ?? null); setBanner({ kind: 'ok', text: confirmChannel ? `${confirmChannel} deploy attempted — see result below.` : 'Dry-run payload built.' }); onRefresh() }
  }

  async function activate(channel: QadsChannel) {
    if (!window.confirm(`Activate ${channel}? This starts spending real money on the connected ad account.`)) return
    const res = await apiCall(`/api/qads/campaigns/${campaign.id}/activate`, { method: 'POST', body: JSON.stringify({ channel, confirm: true }) })
    if (!res.ok) setBanner({ kind: 'error', text: res.error ?? 'Activate failed' })
    else { setBanner({ kind: 'ok', text: `${channel} activated.` }); onRefresh() }
  }
  async function pause(channel: QadsChannel) {
    const res = await apiCall(`/api/qads/campaigns/${campaign.id}/pause`, { method: 'POST', body: JSON.stringify({ channel }) })
    if (!res.ok) setBanner({ kind: 'error', text: res.error ?? 'Pause failed' })
    else { setBanner({ kind: 'ok', text: `${channel} paused.` }); onRefresh() }
  }

  const angleById = new Map(angles.map((a) => [a.id, a]))
  const adAccountsConnected = adAccounts.filter((a) => a.status === 'connected').map((a) => a.channel)

  return (
    <div style={{ marginTop: 8, paddingTop: 20, borderTop: `1px solid ${COLORS.border}` }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>{campaign.name}</h3>
      {campaign.strategy?.summary && <p style={{ fontSize: 12, color: COLORS.muted, margin: '0 0 16px', maxWidth: 640 }}>{campaign.strategy.summary}</p>}

      <SectionTitle>Structure</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {adSets.map((adSet) => (
          <div key={adSet.id} style={{ padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{adSet.name}</span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: COLORS.muted, textTransform: 'uppercase' }}>{adSet.channel}</span>
                <StatusPill status={adSet.status} />
                <BudgetEditor adSetId={adSet.id} budgetMinor={adSet.budget_minor} budgetType={adSet.budget_type} currency={campaign.currency} setBanner={setBanner} onSaved={onRefresh} />
              </span>
            </div>
            <p style={{ fontSize: 10, color: COLORS.muted, margin: '4px 0 0' }}>{angleById.get(adSet.angle_id)?.label}</p>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ads.filter((ad) => ad.ad_set_id === adSet.id).map((ad) => (
                <div key={ad.id} style={{ fontSize: 11, color: COLORS.muted, padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,.03)' }}>
                  <strong style={{ color: COLORS.text }}>{ad.texts.headline}</strong> — {ad.texts.primaryText}
                  {ad.external_status && <span style={{ marginLeft: 8, color: COLORS.accentText }}>[{ad.external_status}]</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <SectionTitle>Deploy &amp; activation</SectionTitle>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={() => runDeploy()} style={secondaryButton}>Build dry-run payload</button>
        {campaign.channels.map((c) => (
          <div key={c} style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => runDeploy(c)}
              disabled={!adAccountsConnected.includes(c)}
              style={{ ...secondaryButton, opacity: adAccountsConnected.includes(c) ? 1 : 0.4 }}
              title="Requires QADS_LIVE_DEPLOY=true on this deployment"
            >
              Confirm live deploy: {c}
            </button>
            <button onClick={() => activate(c)} style={{ ...secondaryButton, color: COLORS.success, borderColor: 'rgba(62,207,142,.4)' }}>Activate {c}</button>
            <button onClick={() => pause(c)} style={{ ...secondaryButton, color: COLORS.danger, borderColor: 'rgba(229,104,107,.4)' }}>Pause {c}</button>
          </div>
        ))}
      </div>
      {deployResult && (
        <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 20, padding: 10, borderRadius: 8, background: 'rgba(255,255,255,.03)' }}>
          {!deployResult.liveDeployEnabled && <p style={{ margin: '0 0 6px', color: COLORS.warn }}>Live deploy is disabled on this deployment (QADS_LIVE_DEPLOY is unset) — this is a dry-run payload only.</p>}
          {Object.entries(deployResult.validationErrors ?? {}).map(([ch, errs]) => (
            <p key={ch} style={{ margin: '2px 0', color: COLORS.danger }}>{ch}: {(errs as string[]).join('; ')}</p>
          ))}
          <p style={{ margin: '6px 0 0' }}>Channels with a ready payload: {Object.keys(deployResult.payloadsByChannel ?? {}).join(', ') || 'none'}</p>
        </div>
      )}

      {metrics && (
        <>
          <SectionTitle>Performance</SectionTitle>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12 }}>
            <Stat label="Spend" value={money(metrics.totals.spendMinor ?? 0, campaign.currency)} />
            <Stat label="Impressions" value={String(metrics.totals.impressions ?? 0)} />
            <Stat label="Clicks" value={String(metrics.totals.clicks ?? 0)} />
            <Stat label="Conversions" value={String(metrics.totals.conversions ?? 0)} />
            <Stat label="ROAS" value={metrics.totals.roas != null ? metrics.totals.roas.toFixed(2) : '—'} />
          </div>
          {metrics.dailySeries.length > 1 && (
            <div style={{ height: 180, marginBottom: 20 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics.dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: COLORS.muted }} />
                  <YAxis tick={{ fontSize: 10, fill: COLORS.muted }} />
                  <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, fontSize: 11 }} />
                  <Line type="monotone" dataKey="spend_minor" name="Spend (minor)" stroke={COLORS.accent} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="clicks" name="Clicks" stroke={COLORS.success} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0 10px' }}>
        <SectionTitle noMargin>Experiments</SectionTitle>
        <button onClick={() => setShowExperimentForm((v) => !v)} style={secondaryButton}>+ New test</button>
      </div>
      {showExperimentForm && (
        <NewExperimentForm
          campaignId={campaign.id}
          adSets={adSets}
          ads={ads}
          setBanner={setBanner}
          onCreated={() => { setShowExperimentForm(false); loadExperiments() }}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {experiments.map((exp) => <ExperimentRow key={exp.id} experiment={exp} setBanner={setBanner} onChanged={loadExperiments} />)}
        {!experiments.length && <p style={{ fontSize: 12, color: COLORS.muted }}>No experiments yet.</p>}
      </div>
    </div>
  )
}

function SectionTitle({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return <h4 style={{ fontSize: 12, fontWeight: 600, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '.04em', margin: noMargin ? 0 : '0 0 10px' }}>{children}</h4>
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: COLORS.muted }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

const secondaryButton: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
  border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.text, cursor: 'pointer',
}

function BudgetEditor({
  adSetId, budgetMinor, budgetType, currency, setBanner, onSaved,
}: {
  adSetId: string
  budgetMinor: number
  budgetType: string
  currency: string
  setBanner: (b: { kind: 'ok' | 'error'; text: string } | null) => void
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(budgetMinor / 100))

  async function save() {
    const res = await apiCall(`/api/qads/ad-sets/${adSetId}/budget`, {
      method: 'PATCH',
      body: JSON.stringify({ budgetMinor: Math.round(Number(value) * 100), budgetType }),
    })
    if (!res.ok) setBanner({ kind: 'error', text: res.error ?? 'Budget update failed' })
    else { setEditing(false); onSaved() }
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} style={{ fontSize: 10, color: COLORS.accentText, background: 'none', border: 'none', cursor: 'pointer' }}>
        {money(budgetMinor, currency)}/{budgetType === 'daily' ? 'day' : 'total'} — edit
      </button>
    )
  }
  return (
    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input value={value} onChange={(e) => setValue(e.target.value)} style={{ ...inputStyle, width: 70, padding: '2px 6px', fontSize: 11 }} />
      <button onClick={save} style={{ fontSize: 10, color: COLORS.success, background: 'none', border: 'none', cursor: 'pointer' }}>Save</button>
      <button onClick={() => setEditing(false)} style={{ fontSize: 10, color: COLORS.muted, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
    </span>
  )
}

function NewExperimentForm({
  campaignId, adSets, ads, setBanner, onCreated,
}: {
  campaignId: string
  adSets: CampaignDetail['adSets']
  ads: CampaignDetail['ads']
  setBanner: (b: { kind: 'ok' | 'error'; text: string } | null) => void
  onCreated: () => void
}) {
  const [type, setType] = useState<'creative' | 'copy' | 'audience'>('copy')
  const [metric, setMetric] = useState<'ctr' | 'conversions' | 'cpa' | 'roas'>('ctr')
  const [variantA, setVariantA] = useState('')
  const [variantB, setVariantB] = useState('')

  async function submit() {
    if (!variantA || !variantB || variantA === variantB) {
      setBanner({ kind: 'error', text: 'Pick two different ads to compare' })
      return
    }
    const res = await apiCall('/api/qads/experiments', {
      method: 'POST',
      body: JSON.stringify({
        campaignId, type, successMetric: metric,
        variants: [{ refType: 'ad', refId: variantA, trafficShare: 50 }, { refType: 'ad', refId: variantB, trafficShare: 50 }],
      }),
    })
    if (!res.ok) setBanner({ kind: 'error', text: res.error ?? 'Failed to create experiment' })
    else onCreated()
  }

  return (
    <div style={{ padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface, marginBottom: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} style={inputStyle}>
            <option value="copy">copy</option><option value="creative">creative</option><option value="audience">audience</option>
          </select>
        </Field>
        <Field label="Success metric">
          <select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} style={inputStyle}>
            <option value="ctr">ctr</option><option value="conversions">conversions</option><option value="cpa">cpa</option><option value="roas">roas</option>
          </select>
        </Field>
        <Field label="Variant A (ad)">
          <select value={variantA} onChange={(e) => setVariantA(e.target.value)} style={inputStyle}>
            <option value="">—</option>
            {ads.map((ad) => <option key={ad.id} value={ad.id}>{ad.texts.headline} ({adSets.find((s) => s.id === ad.ad_set_id)?.name})</option>)}
          </select>
        </Field>
        <Field label="Variant B (ad)">
          <select value={variantB} onChange={(e) => setVariantB(e.target.value)} style={inputStyle}>
            <option value="">—</option>
            {ads.map((ad) => <option key={ad.id} value={ad.id}>{ad.texts.headline} ({adSets.find((s) => s.id === ad.ad_set_id)?.name})</option>)}
          </select>
        </Field>
      </div>
      <button onClick={submit} style={{ ...secondaryButton, background: COLORS.accent, color: '#fff', border: 'none' }}>Start test</button>
    </div>
  )
}

function ExperimentRow({
  experiment, setBanner, onChanged,
}: {
  experiment: { id: string; type: string; status: string; success_metric: string }
  setBanner: (b: { kind: 'ok' | 'error'; text: string } | null) => void
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [result, setResult] = useState<{ variantStats: { variantId: string; rate: number | null; successes: number }[]; recommendation: { winnerVariantId: string; confidence: number } | null; minSampleNote: string | null } | null>(null)

  async function toggle() {
    setExpanded((v) => !v)
    if (!result) {
      const res = await apiCall<typeof result>(`/api/qads/experiments/${experiment.id}`)
      if (res.ok && res.data) setResult(res.data)
    }
  }

  async function applyWinner() {
    if (!window.confirm('Apply this winner? This pauses the losing variant(s) wherever they are already live.')) return
    const res = await apiCall(`/api/qads/experiments/${experiment.id}/apply-winner`, { method: 'POST', body: JSON.stringify({ confirm: true }) })
    if (!res.ok) setBanner({ kind: 'error', text: res.error ?? 'Failed to apply winner' })
    else { setBanner({ kind: 'ok', text: 'Winner applied.' }); onChanged() }
  }

  return (
    <div style={{ padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
      <button onClick={toggle} style={{ display: 'flex', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: COLORS.text }}>
        <span style={{ fontSize: 12 }}>{experiment.type} test on {experiment.success_metric}</span>
        <StatusPill status={experiment.status} />
      </button>
      {expanded && result && (
        <div style={{ marginTop: 8, fontSize: 11, color: COLORS.muted }}>
          {result.variantStats.map((v) => <p key={v.variantId} style={{ margin: '2px 0' }}>{v.variantId.slice(0, 8)}: {v.successes} successes, rate {v.rate != null ? (v.rate * 100).toFixed(1) + '%' : '—'}</p>)}
          {result.minSampleNote && <p style={{ color: COLORS.warn, margin: '6px 0' }}>{result.minSampleNote}</p>}
          {result.recommendation && (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: '0 0 6px', color: COLORS.success }}>Winner: {result.recommendation.winnerVariantId.slice(0, 8)} ({(result.recommendation.confidence * 100).toFixed(1)}% confidence)</p>
              <button onClick={applyWinner} style={{ ...secondaryButton, background: COLORS.accent, color: '#fff', border: 'none' }}>Apply winner</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
