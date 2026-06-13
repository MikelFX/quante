'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { ShopManifest, Section } from '@/types/manifest'
import { MerchantPanel } from './MerchantPanel'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant'
  content: string
  type?: 'status' | 'error' | 'done'
}

interface VersionEntry {
  id: string
  version_no: number
  prompt: string
  created_at: string
}

type StreamEvent =
  | { type: 'status'; text: string }
  | { type: 'chunk'; text: string }
  | { type: 'text_chunk'; text: string }
  | { type: 'done'; manifest?: ShopManifest | null; reply?: string; projectId?: string; versionId?: string }
  | { type: 'error'; message: string }

interface HostingInfo {
  trialEndsAt: string | null
  subscribed: boolean
  subscriptionEndsAt: string | null
  cancelAtPeriodEnd: boolean
}

interface Props {
  projectId: string
  projectName: string
  initialManifest: ShopManifest | null
  initialBalance: number
  hostingInfo: HostingInfo
}

type StudioTab = 'chat' | 'preview' | 'sections' | 'products' | 'hosting' | 'merchant'
type DesktopTab = 'chat' | 'sections' | 'products' | 'hosting' | 'merchant'
type AdminTab = 'dashboard' | 'products' | 'orders' | 'settings'

interface StripeOrder {
  id: string; customerEmail: string; customerName: string
  amount: number; currency: string; status: string
  items: { name: string; qty: number; amount: number }[]
  createdAt: string
}

interface ProductDraft {
  id: string
  name: string
  description: string
  price: string
  slug: string
  tags: string
  images: string[]
  available: boolean
}

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function emptyProduct(): ProductDraft {
  return { id: crypto.randomUUID(), name: '', description: '', price: '', slug: '', tags: '', images: [], available: true }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function* readNdjsonStream(response: Response): AsyncGenerator<StreamEvent> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { yield JSON.parse(line) as StreamEvent } catch {}
    }
  }
  if (buffer.trim()) {
    try { yield JSON.parse(buffer) as StreamEvent } catch {}
  }
}

const SECTION_LABELS: Record<string, string> = {
  hero: 'Hero', productGrid: 'Product grid', featureRow: 'Feature row',
  testimonials: 'Testimonials', richText: 'Rich text', banner: 'Banner',
  newsletter: 'Newsletter', gallery: 'Gallery', faq: 'FAQ',
  animations: 'Animations', customComponent: 'Custom',
}

function sectionSummary(section: Section): string {
  switch (section.type) {
    case 'hero': return section.props.headline.replace(/\n/g, ' ').slice(0, 48)
    case 'productGrid': return section.props.title || 'Product grid'
    case 'featureRow': return `${section.props.features.length} features${section.props.title ? ` · ${section.props.title}` : ''}`
    case 'testimonials': return `${section.props.items.length} reviews`
    case 'richText': return section.props.content.replace(/\n/g, ' ').slice(0, 48)
    case 'banner': return section.props.text.slice(0, 48)
    case 'newsletter': return section.props.title
    case 'gallery': return `${section.props.images.length} images`
    case 'faq': return `${section.props.items.length} items`
    case 'animations': return `${section.props.variant}${section.props.title ? ` · ${section.props.title}` : ''}`
    case 'customComponent': return `ref: ${section.ref}`
  }
}

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StudioClient({ projectId, projectName, initialManifest, initialBalance, hostingInfo }: Props) {
  const searchParams = useSearchParams()
  const [messages, setMessages] = useState<Message[]>(() =>
    initialManifest
      ? [{ role: 'assistant', content: `Store **${initialManifest.brand.name}** loaded. What would you like to change?` }]
      : []
  )
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)
  const [balance, setBalance] = useState(initialBalance)
  const [currentManifest, setCurrentManifest] = useState<ShopManifest | null>(initialManifest)
  const [activeTab, setActiveTab] = useState<StudioTab>('chat')
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [expandedSection, setExpandedSection] = useState<number | null>(null)
  const [sectionInput, setSectionInput] = useState('')
  const [regeneratingSection, setRegeneratingSection] = useState<number | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isExportingAdmin, setIsExportingAdmin] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [isDesktop, setIsDesktop] = useState(false)
  const [desktopTab, setDesktopTab] = useState<DesktopTab>('chat')
  const [isDeploying, setIsDeploying] = useState(false)
  const [deployStatus, setDeployStatus] = useState<'idle' | 'building' | 'ready' | 'error'>('idle')
  const [deployUrl, setDeployUrl] = useState<string | null>(null)
  const [deployDomain, setDeployDomain] = useState<string | null>(null)
  const deployPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [isSubscribing, setIsSubscribing] = useState(false)
  // Admin mode
  const [adminMode, setAdminMode] = useState(false)
  const [adminTab, setAdminTab] = useState<AdminTab>('dashboard')
  const [orders, setOrders] = useState<StripeOrder[]>([])
  const [orderRevenue, setOrderRevenue] = useState(0)
  const [isLoadingOrders, setIsLoadingOrders] = useState(false)
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [settingsPubKey, setSettingsPubKey] = useState('')
  const [settingsSecKey, setSettingsSecKey] = useState('')
  const [settingsSecKeySet, setSettingsSecKeySet] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  // Earnings + payout
  const [earnings, setEarnings] = useState<{
    available: number; netTotal: number; saleCount: number; currency: string
  } | null>(null)
  const [payoutAccount, setPayoutAccount] = useState<{ iban: string | null; account_holder_name: string | null } | null>(null)
  const [ibanInput, setIbanInput] = useState('')
  const [holderInput, setHolderInput] = useState('')
  const [isSavingIban, setIsSavingIban] = useState(false)
  const [isRequestingPayout, setIsRequestingPayout] = useState(false)
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null)
  // Hosting panel
  const [customDomainInput, setCustomDomainInput] = useState('')
  const [isAddingDomain, setIsAddingDomain] = useState(false)
  const [domainResult, setDomainResult] = useState<{ domain: string; verified: boolean; dnsInstructions?: string } | null>(null)
  const [liveDeployment, setLiveDeployment] = useState<{
    vercelDeploymentId: string | null; status: string; url: string | null
    domain: string | null; customDomain: string | null; customDomainVerified: boolean
  } | null>(null)

  // Products + section direct edit
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null)
  const [isSavingManifest, setIsSavingManifest] = useState(false)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [editingSection, setEditingSection] = useState<number | null>(null)
  const [sectionDraft, setSectionDraft] = useState<unknown>(null)
  const [sectionEditMode, setSectionEditMode] = useState<'ai' | 'direct' | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const sectionImageInputRef = useRef<HTMLInputElement>(null)
  const [pendingImageTarget, setPendingImageTarget] = useState<((url: string) => void) | null>(null)

  // Hosting trial helpers
  const trialDaysLeft = hostingInfo.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(hostingInfo.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null
  const trialExpired = hostingInfo.trialEndsAt !== null && trialDaysLeft === 0
  const showHostingBanner = hostingInfo.trialEndsAt !== null && !hostingInfo.subscribed

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 900)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`)
      if (res.ok) setVersions(await res.json())
    } catch {}
  }, [projectId])

  const refreshBalance = useCallback(() => {
    fetch('/api/credits/balance')
      .then((r) => r.json())
      .then((d) => { if (typeof d.balance === 'number') setBalance(d.balance) })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchVersions() }, [fetchVersions])

  useEffect(() => {
    fetch(`/api/projects/${projectId}/settings`)
      .then((r) => r.json())
      .then((d) => {
        if (d.stripePublishableKey) setSettingsPubKey(d.stripePublishableKey)
        if (d.stripeSecretKeySet) setSettingsSecKeySet(true)
      })
      .catch(() => {})
  }, [projectId])

  useEffect(() => {
    fetch(`/api/earnings?project_id=${projectId}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setEarnings(d) })
      .catch(() => {})
    fetch(`/api/payout/account?project_id=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        setPayoutAccount(d)
        if (d.iban) setIbanInput(d.iban)
        if (d.account_holder_name) setHolderInput(d.account_holder_name)
      })
      .catch(() => {})
  }, [projectId])

  useEffect(() => {
    async function fetchLatestDeploy() {
      try {
        const res = await fetch(`/api/projects/${projectId}/deployments`)
        if (!res.ok) return
        const data = await res.json()
        if (!data.latest) return
        const d = data.latest
        setLiveDeployment(d)
        if (d.customDomain) setCustomDomainInput(d.customDomain)
        if (d.status === 'ready') {
          setDeployStatus('ready')
          setDeployUrl(d.url)
          setDeployDomain(d.domain)
        } else if (d.status === 'building' && d.vercelDeploymentId) {
          setIsDeploying(true)
          setDeployStatus('building')
          setDeployDomain(d.domain)
          deployPollRef.current = setInterval(() => pollDeployStatus(d.vercelDeploymentId), 12000)
        }
      } catch {}
    }
    fetchLatestDeploy()
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopDeployPoll(), []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset iframe if it ever navigates away from the /preview/ prefix
  const handleIframeLoad = useCallback(() => {
    try {
      const pathname = iframeRef.current?.contentWindow?.location.pathname ?? ''
      if (pathname && !pathname.startsWith('/preview/')) {
        setIframeKey((k) => k + 1)
      }
    } catch {}
  }, [])

  async function consumeStream(
    endpoint: string,
    body: object,
    onDone: (manifest: ShopManifest | null, reply?: string) => void,
    onError?: (msg: string) => void
  ) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.body) throw new Error('No stream')

    for await (const event of readNdjsonStream(response)) {
      if (event.type === 'status') {
        setMessages((prev) => {
          const updated = [...prev]
          // Only show status if no text_chunk has arrived yet
          if (updated[updated.length - 1]?.content === '…') {
            updated[updated.length - 1] = { role: 'assistant', content: event.text, type: 'status' }
          }
          return updated
        })
      } else if (event.type === 'text_chunk') {
        // Stream the AI's conversational reply in real time
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant' && (last.type === 'status' || last.type === undefined)) {
            updated[updated.length - 1] = {
              role: 'assistant',
              content: (last.type === 'status' ? '' : last.content) + event.text,
              type: undefined,
            }
          }
          return updated
        })
      } else if (event.type === 'chunk') {
        setStreamingText((prev) => (prev + event.text).slice(-400))
      } else if (event.type === 'error') {
        setStreamingText('')
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: event.message, type: 'error' }
          return updated
        })
        onError?.(event.message)
        return
      } else if (event.type === 'done') {
        setStreamingText('')
        onDone(event.manifest ?? null, event.reply)
        return
      }
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || isGenerating) return

    setInput('')
    const snapshot = [...messages]
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '…', type: 'status' },
    ])
    setIsGenerating(true)

    const hasManifest = !!currentManifest

    if (!hasManifest) {
      // Generation flow — unchanged
      try {
        await consumeStream('/api/quante/generate', { brief: text, projectId }, (manifest) => {
          if (!manifest) return
          const summary = `**${manifest.brand.name}** ready. ${manifest.catalog.products.length} products.`
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: summary, type: 'done' }
            return updated
          })
          setCurrentManifest(manifest)
          setIframeKey((k) => k + 1)
          refreshBalance()
          fetchVersions()
          setActiveTab('preview')
        })
      } catch {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: 'Something went wrong. Try again.', type: 'error' }
          return updated
        })
      } finally {
        setIsGenerating(false)
        setTimeout(() => textareaRef.current?.focus(), 50)
      }
      return
    }

    // Iteration / chat flow — with history
    const history = snapshot
      .filter((m) => m.type !== 'status' && m.content !== '…')
      .map((m) => ({ role: m.role, content: m.content }))

    try {
      await consumeStream(
        '/api/quante/iterate',
        { projectId, instruction: text, history },
        (manifest, reply) => {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (manifest) {
              // Store was updated — append a subtle indicator to the reply
              updated[updated.length - 1] = {
                role: 'assistant',
                content: reply ?? last.content,
                type: 'done',
              }
            } else {
              // Free Q&A — just finalize the reply text
              updated[updated.length - 1] = {
                role: 'assistant',
                content: reply ?? last.content,
                type: 'done',
              }
            }
            return updated
          })
          if (manifest) {
            setCurrentManifest(manifest)
            setIframeKey((k) => k + 1)
            refreshBalance()
            fetchVersions()
          }
        }
      )
    } catch {
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Something went wrong. Try again.', type: 'error' }
        return updated
      })
    } finally {
      setIsGenerating(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  async function handleSectionRegenerate(sectionIndex: number, instruction: string) {
    if (isGenerating) return
    setIsGenerating(true)
    setRegeneratingSection(sectionIndex)
    setExpandedSection(null)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: instruction || `Improve section ${sectionIndex + 1}` },
      { role: 'assistant', content: 'Regenerating section…', type: 'status' },
    ])

    try {
      await consumeStream(
        '/api/quante/section',
        { projectId, page: 'home', sectionIndex, instruction },
        (manifest) => {
          if (!manifest) return
          const sectionName = SECTION_LABELS[(manifest.pages.home[sectionIndex] as { type: string })?.type ?? ''] ?? 'Section'
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = {
              role: 'assistant',
              content: `**${sectionName}** regenerated.`,
              type: 'done',
            }
            return updated
          })
          setCurrentManifest(manifest)
          setIframeKey((k) => k + 1)
          setSectionInput('')
          refreshBalance()
          fetchVersions()
        }
      )
    } catch {
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Section regeneration failed.', type: 'error' }
        return updated
      })
    } finally {
      setIsGenerating(false)
      setRegeneratingSection(null)
    }
  }

  async function handleRestore(versionId: string) {
    setShowVersions(false)
    try {
      const res = await fetch(`/api/projects/${projectId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      })
      if (res.ok) {
        const { manifest } = await res.json()
        setCurrentManifest(manifest)
        setIframeKey((k) => k + 1)
        fetchVersions()
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Version restored.', type: 'done' }])
      }
    } catch {}
  }

  async function handleExport(includeAdmin = false) {
    if (!currentManifest) return
    if (includeAdmin ? isExportingAdmin : isExporting) return
    includeAdmin ? setIsExportingAdmin(true) : setIsExporting(true)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, includeAdmin }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? 'Export failed.')
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'store.zip'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      refreshBalance()
    } catch {
      alert('Export failed.')
    } finally {
      includeAdmin ? setIsExportingAdmin(false) : setIsExporting(false)
    }
  }

  function stopDeployPoll() {
    if (deployPollRef.current) {
      clearInterval(deployPollRef.current)
      deployPollRef.current = null
    }
  }

  async function pollDeployStatus(deploymentId: string) {
    try {
      const res = await fetch(`/api/deploy?id=${deploymentId}`)
      if (!res.ok) return
      const data = await res.json()

      if (data.status === 'ready') {
        stopDeployPoll()
        setIsDeploying(false)
        setDeployStatus('ready')
        setDeployUrl(data.url ?? null)
        setDeployDomain(data.domain ?? null)
        setLiveDeployment((prev) => prev ? { ...prev, status: 'ready', url: data.url ?? prev.url, domain: data.domain ?? prev.domain } : null)
        refreshBalance()
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Store is live at **${data.domain ?? data.url}** — open the Hosting tab to manage your domain.`, type: 'done' },
        ])
      } else if (data.status === 'error' || data.status === 'canceled') {
        stopDeployPoll()
        setIsDeploying(false)
        setDeployStatus('error')
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Deployment failed. Your credits were not charged.', type: 'error' },
        ])
      }
    } catch {}
  }

  async function handleDeploy() {
    if (!currentManifest || isDeploying) return
    setIsDeploying(true)
    setDeployStatus('building')
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: 'Starting deployment to Quante hosting…', type: 'status' },
    ])

    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setIsDeploying(false)
        setDeployStatus('error')
        const msg = data.code === 'SUBSCRIPTION_REQUIRED'
          ? `Trial ended — subscribe to keep hosting (€99/year). Click **Subscribe** below.`
          : (data.error ?? 'Deployment failed.')
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: msg, type: 'error' }
          return updated
        })
        return
      }

      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Building store… this takes 2–3 minutes.', type: 'status' }
        return updated
      })

      // Poll for status every 12 seconds
      deployPollRef.current = setInterval(() => pollDeployStatus(data.deploymentId), 12000)
    } catch {
      setIsDeploying(false)
      setDeployStatus('error')
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Deployment request failed. Try again.', type: 'error' }
        return updated
      })
    }
  }

  // Show success message after Stripe redirect
  useEffect(() => {
    if (searchParams.get('hosting') === 'subscribed') {
      setMessages((prev) => [...prev, { role: 'assistant', content: '🎉 Hosting subscription activated! Your store will stay live.', type: 'done' }])
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleHostingSubscribe() {
    if (isSubscribing) return
    setIsSubscribing(true)
    try {
      const res = await fetch('/api/hosting/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error ?? 'Failed to start checkout.')
        return
      }
      window.location.href = data.url
    } catch {
      alert('Something went wrong.')
    } finally {
      setIsSubscribing(false)
    }
  }

  async function handleLoadOrders() {
    setIsLoadingOrders(true)
    setOrdersError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/orders`)
      const data = await res.json()
      if (!res.ok) {
        setOrdersError(data.error === 'NO_STRIPE_KEY' ? 'no_key' : (data.error ?? 'Failed to load orders.'))
        return
      }
      setOrders(data.orders ?? [])
      setOrderRevenue(data.revenue ?? 0)
    } catch {
      setOrdersError('Something went wrong.')
    } finally {
      setIsLoadingOrders(false)
    }
  }

  async function handleSaveSettings() {
    setIsSavingSettings(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripePublishableKey: settingsPubKey, stripeSecretKey: settingsSecKey }),
      })
      if (!res.ok) { alert('Failed to save.'); return }
      if (settingsSecKey) setSettingsSecKeySet(true)
      setSettingsSecKey('')
      alert('Settings saved. If your store is deployed, keys were pushed to Vercel automatically.')
    } catch {
      alert('Something went wrong.')
    } finally {
      setIsSavingSettings(false)
    }
  }

  async function handleAddDomain() {
    const domain = customDomainInput.trim()
    if (!domain || isAddingDomain) return
    setIsAddingDomain(true)
    setDomainResult(null)
    try {
      const res = await fetch('/api/hosting/domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, domain }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'Failed to add domain.'); return }
      setDomainResult({ domain: data.domain, verified: data.verified, dnsInstructions: data.dnsInstructions })
      setLiveDeployment((prev) => prev ? { ...prev, customDomain: data.domain, customDomainVerified: data.verified } : null)
    } catch {
      alert('Something went wrong.')
    } finally {
      setIsAddingDomain(false)
    }
  }

  async function handleSaveIban() {
    if (!ibanInput.trim() || !holderInput.trim()) return
    setIsSavingIban(true)
    try {
      const res = await fetch('/api/payout/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, iban: ibanInput.trim(), accountHolderName: holderInput.trim() }),
      })
      const data = await res.json()
      if (data.ok) setPayoutAccount({ iban: ibanInput.trim(), account_holder_name: holderInput.trim() })
    } catch { /* non-fatal */ }
    setIsSavingIban(false)
  }

  async function handleRequestPayout() {
    setIsRequestingPayout(true)
    setPayoutMsg(null)
    try {
      const res = await fetch('/api/payout/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await res.json()
      if (data.ok) {
        setPayoutMsg(`Payout of €${(data.amountCents / 100).toFixed(2)} requested. We'll process it within 2 business days.`)
        // Refresh earnings
        fetch(`/api/earnings?project_id=${projectId}`)
          .then((r) => r.json())
          .then((d) => { if (!d.error) setEarnings(d) })
          .catch(() => {})
      } else {
        setPayoutMsg(data.error ?? 'Request failed.')
      }
    } catch { setPayoutMsg('Something went wrong.') }
    setIsRequestingPayout(false)
  }

  async function handleSaveManifest(updatedManifest: ShopManifest, prompt: string) {
    setIsSavingManifest(true)
    try {
      const res = await fetch('/api/manifest/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, manifest: updatedManifest, prompt }),
      })
      if (!res.ok) { alert('Save failed.'); return false }
      const data = await res.json()
      setCurrentManifest(data.manifest)
      setIframeKey(k => k + 1)
      fetchVersions()
      return true
    } catch { alert('Save failed.'); return false }
    finally { setIsSavingManifest(false) }
  }

  async function handleUploadImage(file: File, onDone: (url: string) => void) {
    setIsUploadingImage(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', projectId)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) { alert('Upload failed.'); return }
      const { url } = await res.json()
      onDone(url)
    } catch { alert('Upload failed.') }
    finally { setIsUploadingImage(false) }
  }

  function openImagePicker(onDone: (url: string) => void, ref: React.RefObject<HTMLInputElement | null>) {
    setPendingImageTarget(() => onDone)
    ref.current?.click()
  }

  async function handleProductSave() {
    if (!productDraft || !currentManifest) return
    const updated: ShopManifest = {
      ...currentManifest,
      catalog: {
        ...currentManifest.catalog,
        products: productDraft.id && currentManifest.catalog.products.find(p => p.id === productDraft.id)
          ? currentManifest.catalog.products.map(p =>
              p.id === productDraft.id
                ? { id: productDraft.id, name: productDraft.name, description: productDraft.description, price: parseFloat(productDraft.price) || 0, slug: productDraft.slug || toSlug(productDraft.name), images: productDraft.images, available: productDraft.available, tags: productDraft.tags ? productDraft.tags.split(',').map(t => t.trim()).filter(Boolean) : [] }
                : p
            )
          : [
              ...currentManifest.catalog.products,
              { id: productDraft.id, name: productDraft.name, description: productDraft.description, price: parseFloat(productDraft.price) || 0, slug: productDraft.slug || toSlug(productDraft.name), images: productDraft.images, available: productDraft.available, tags: productDraft.tags ? productDraft.tags.split(',').map(t => t.trim()).filter(Boolean) : [] },
            ],
      },
    }
    const ok = await handleSaveManifest(updated, `Product: ${productDraft.name}`)
    if (ok) setProductDraft(null)
  }

  async function handleProductDelete(productId: string) {
    if (!currentManifest || !confirm('Delete this product?')) return
    const updated: ShopManifest = {
      ...currentManifest,
      catalog: { ...currentManifest.catalog, products: currentManifest.catalog.products.filter(p => p.id !== productId) },
    }
    await handleSaveManifest(updated, 'Delete product')
  }

  async function handleSectionDirectSave() {
    if (!currentManifest || editingSection === null || !sectionDraft) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newSections = currentManifest.pages.home.map((s, i) => i === editingSection ? sectionDraft as any : s)
    const updated: ShopManifest = { ...currentManifest, pages: { ...currentManifest.pages, home: newSections } }
    const ok = await handleSaveManifest(updated, `Edit section ${editingSection + 1}`)
    if (ok) { setEditingSection(null); setSectionDraft(null); setSectionEditMode(null) }
  }

  const homeSections = currentManifest?.pages.home ?? []
  const latestVersion = versions[0]

  // ── Section direct-edit fields ────────────────────────────────────────────────
  function SectionEditFields() {
    if (!sectionDraft) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = sectionDraft as any
    const set = (key: string, val: unknown) => setSectionDraft((prev: unknown) => ({ ...(prev as object), props: { ...(prev as any).props, [key]: val } }))
    const inputStyle = { width: '100%', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--secondary)', color: 'var(--foreground)', padding: '6px 8px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const }
    const taStyle = { ...inputStyle, resize: 'none' as const }
    const label = (t: string) => <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginBottom: 3, marginTop: 8 }}>{t}</p>

    if (d.type === 'hero') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {label('Headline')}<textarea rows={2} style={taStyle} value={d.props.headline ?? ''} onChange={e => set('headline', e.target.value)} />
        {label('Subheadline')}<input style={inputStyle} value={d.props.subheadline ?? ''} onChange={e => set('subheadline', e.target.value)} />
        {label('CTA text')}<input style={inputStyle} value={d.props.ctaLabel ?? ''} onChange={e => set('ctaLabel', e.target.value)} />
        {label('CTA link')}<input style={inputStyle} value={d.props.ctaHref ?? ''} onChange={e => set('ctaHref', e.target.value)} />
        {label('Image URL')}
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={{ ...inputStyle, flex: 1 }} value={d.props.imageSrc ?? ''} onChange={e => set('imageSrc', e.target.value)} placeholder="https://..." />
          <button onClick={() => openImagePicker(url => set('imageSrc', url), sectionImageInputRef)} style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--secondary)', color: 'var(--foreground)', cursor: 'pointer', flexShrink: 0 }}>
            {isUploadingImage ? '…' : '↑'}
          </button>
        </div>
      </div>
    )

    if (d.type === 'banner') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {label('Text')}<input style={inputStyle} value={d.props.text ?? ''} onChange={e => set('text', e.target.value)} />
        {label('CTA text')}<input style={inputStyle} value={d.props.ctaLabel ?? ''} onChange={e => set('ctaLabel', e.target.value)} />
        {label('CTA link')}<input style={inputStyle} value={d.props.ctaHref ?? ''} onChange={e => set('ctaHref', e.target.value)} />
      </div>
    )

    if (d.type === 'newsletter') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {label('Title')}<input style={inputStyle} value={d.props.title ?? ''} onChange={e => set('title', e.target.value)} />
        {label('Description')}<input style={inputStyle} value={d.props.description ?? ''} onChange={e => set('description', e.target.value)} />
        {label('Button text')}<input style={inputStyle} value={d.props.buttonLabel ?? ''} onChange={e => set('buttonLabel', e.target.value)} />
      </div>
    )

    if (d.type === 'richText') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {label('Content')}<textarea rows={5} style={taStyle} value={d.props.content ?? ''} onChange={e => set('content', e.target.value)} />
      </div>
    )

    if (d.type === 'faq') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {label('Title (optional)')}<input style={inputStyle} value={d.props.title ?? ''} onChange={e => set('title', e.target.value)} />
        {label('Items')}
        {(d.props.items as Array<{ question: string; answer: string }>).map((item, i) => (
          <div key={i} style={{ marginBottom: 8, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)' }}>
            <input style={{ ...inputStyle, marginBottom: 4 }} placeholder="Question" value={item.question} onChange={e => { const items = [...d.props.items]; items[i] = { ...items[i], question: e.target.value }; set('items', items) }} />
            <textarea rows={2} style={taStyle} placeholder="Answer" value={item.answer} onChange={e => { const items = [...d.props.items]; items[i] = { ...items[i], answer: e.target.value }; set('items', items) }} />
            <button onClick={() => { const items = d.props.items.filter((_: unknown, j: number) => j !== i); set('items', items) }} style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', marginTop: 2 }}>Remove</button>
          </div>
        ))}
        <button onClick={() => set('items', [...d.props.items, { question: '', answer: '' }])} style={{ fontSize: 11, padding: '5px', borderRadius: 6, border: '1px dashed var(--border)', background: 'none', color: 'var(--muted-foreground)', cursor: 'pointer' }}>+ Add item</button>
      </div>
    )

    if (d.type === 'featureRow') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {label('Title (optional)')}<input style={inputStyle} value={d.props.title ?? ''} onChange={e => set('title', e.target.value)} />
        {label('Features')}
        {(d.props.features as Array<{ title: string; description: string; icon?: string }>).map((f, i) => (
          <div key={i} style={{ marginBottom: 8, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)' }}>
            <input style={{ ...inputStyle, marginBottom: 4 }} placeholder="Title" value={f.title} onChange={e => { const items = [...d.props.features]; items[i] = { ...items[i], title: e.target.value }; set('features', items) }} />
            <textarea rows={2} style={taStyle} placeholder="Description" value={f.description} onChange={e => { const items = [...d.props.features]; items[i] = { ...items[i], description: e.target.value }; set('features', items) }} />
            <button onClick={() => set('features', d.props.features.filter((_: unknown, j: number) => j !== i))} style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', marginTop: 2 }}>Remove</button>
          </div>
        ))}
        <button onClick={() => set('features', [...d.props.features, { title: '', description: '' }])} style={{ fontSize: 11, padding: '5px', borderRadius: 6, border: '1px dashed var(--border)', background: 'none', color: 'var(--muted-foreground)', cursor: 'pointer' }}>+ Add feature</button>
      </div>
    )

    if (d.type === 'testimonials') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {label('Title (optional)')}<input style={inputStyle} value={d.props.title ?? ''} onChange={e => set('title', e.target.value)} />
        {label('Reviews')}
        {(d.props.items as Array<{ quote: string; author: string; role?: string }>).map((item, i) => (
          <div key={i} style={{ marginBottom: 8, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)' }}>
            <input style={{ ...inputStyle, marginBottom: 4 }} placeholder="Author name" value={item.author} onChange={e => { const items = [...d.props.items]; items[i] = { ...items[i], author: e.target.value }; set('items', items) }} />
            <input style={{ ...inputStyle, marginBottom: 4 }} placeholder="Role (optional)" value={item.role ?? ''} onChange={e => { const items = [...d.props.items]; items[i] = { ...items[i], role: e.target.value }; set('items', items) }} />
            <textarea rows={2} style={taStyle} placeholder="Quote" value={item.quote} onChange={e => { const items = [...d.props.items]; items[i] = { ...items[i], quote: e.target.value }; set('items', items) }} />
            <button onClick={() => set('items', d.props.items.filter((_: unknown, j: number) => j !== i))} style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', marginTop: 2 }}>Remove</button>
          </div>
        ))}
        <button onClick={() => set('items', [...d.props.items, { quote: '', author: '' }])} style={{ fontSize: 11, padding: '5px', borderRadius: 6, border: '1px dashed var(--border)', background: 'none', color: 'var(--muted-foreground)', cursor: 'pointer' }}>+ Add review</button>
      </div>
    )

    if (d.type === 'gallery') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {label('Images')}
        {(d.props.images as Array<{ src: string; alt: string }>).map((img, i) => (
          <div key={i} style={{ marginBottom: 8, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)' }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <input style={{ ...inputStyle, flex: 1 }} placeholder="Image URL" value={img.src} onChange={e => { const items = [...d.props.images]; items[i] = { ...items[i], src: e.target.value }; set('images', items) }} />
              <button onClick={() => openImagePicker(url => { const items = [...d.props.images]; items[i] = { ...items[i], src: url }; set('images', items) }, sectionImageInputRef)} style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--secondary)', color: 'var(--foreground)', cursor: 'pointer', flexShrink: 0 }}>
                {isUploadingImage ? '…' : '↑'}
              </button>
            </div>
            <input style={inputStyle} placeholder="Alt text" value={img.alt} onChange={e => { const items = [...d.props.images]; items[i] = { ...items[i], alt: e.target.value }; set('images', items) }} />
            <button onClick={() => set('images', d.props.images.filter((_: unknown, j: number) => j !== i))} style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', marginTop: 2 }}>Remove</button>
          </div>
        ))}
        <button onClick={() => set('images', [...d.props.images, { src: '', alt: '' }])} style={{ fontSize: 11, padding: '5px', borderRadius: 6, border: '1px dashed var(--border)', background: 'none', color: 'var(--muted-foreground)', cursor: 'pointer' }}>+ Add image</button>
      </div>
    )

    return <p style={{ fontSize: 12, color: 'var(--muted-foreground)', padding: '8px 0' }}>Use AI to edit this section type.</p>
  }

  // ── Products panel ────────────────────────────────────────────────────────────
  const inputSt = { width: '100%', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--secondary)', color: 'var(--foreground)', padding: '6px 8px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const }
  const taSt = { ...inputSt, resize: 'none' as const }
  const fldLabel = (t: string) => <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginBottom: 3, marginTop: 8 }}>{t}</p>

  const ProductsPanel = (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {/* hidden file input for product images */}
      <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file || !pendingImageTarget) return
        await handleUploadImage(file, pendingImageTarget)
        setPendingImageTarget(null)
      }} />
      <input ref={sectionImageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file || !pendingImageTarget) return
        await handleUploadImage(file, pendingImageTarget)
        setPendingImageTarget(null)
      }} />

      {!currentManifest ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>Generate a store first.</p>
        </div>
      ) : productDraft ? (
        // ── Product form ──
        <div style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 600 }}>{productDraft.images.length === 0 && !currentManifest.catalog.products.find(p => p.id === productDraft.id) ? 'New product' : 'Edit product'}</p>
            <button onClick={() => setProductDraft(null)} style={{ fontSize: 11, color: 'var(--muted-foreground)', background: 'none', border: 'none', cursor: 'pointer' }}>✕ Cancel</button>
          </div>

          {/* Image */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {productDraft.images.map((img, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                  <button onClick={() => setProductDraft(d => d ? { ...d, images: d.images.filter((_, j) => j !== i) } : d)} style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#f87171', border: 'none', color: '#fff', fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                </div>
              ))}
              <button
                onClick={() => openImagePicker(url => setProductDraft(d => d ? { ...d, images: [...d.images, url] } : d), imageInputRef)}
                disabled={isUploadingImage}
                style={{ width: 64, height: 64, borderRadius: 8, border: '1px dashed var(--border)', background: 'none', color: 'var(--muted-foreground)', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {isUploadingImage ? '…' : '+'}
              </button>
            </div>
          </div>

          {fldLabel('Name *')}
          <input style={inputSt} value={productDraft.name} onChange={e => setProductDraft(d => d ? { ...d, name: e.target.value, slug: toSlug(e.target.value) } : d)} />
          {fldLabel('Price')}
          <input style={inputSt} type="number" min="0" step="0.01" value={productDraft.price} onChange={e => setProductDraft(d => d ? { ...d, price: e.target.value } : d)} placeholder={`${currentManifest.catalog.currency} 0.00`} />
          {fldLabel('Description')}
          <textarea rows={3} style={taSt} value={productDraft.description} onChange={e => setProductDraft(d => d ? { ...d, description: e.target.value } : d)} />
          {fldLabel('Slug')}
          <input style={inputSt} value={productDraft.slug} onChange={e => setProductDraft(d => d ? { ...d, slug: toSlug(e.target.value) } : d)} />
          {fldLabel('Tags (comma-separated)')}
          <input style={inputSt} value={productDraft.tags} onChange={e => setProductDraft(d => d ? { ...d, tags: e.target.value } : d)} placeholder="skincare, serum, bestseller" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <input type="checkbox" id="avail" checked={productDraft.available} onChange={e => setProductDraft(d => d ? { ...d, available: e.target.checked } : d)} />
            <label htmlFor="avail" style={{ fontSize: 12, color: 'var(--foreground)', cursor: 'pointer' }}>Available for purchase</label>
          </div>
          <button
            onClick={handleProductSave}
            disabled={isSavingManifest || !productDraft.name.trim()}
            style={{ marginTop: 14, width: '100%', padding: '9px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: isSavingManifest || !productDraft.name.trim() ? 'not-allowed' : 'pointer', background: 'var(--primary)', color: 'var(--primary-foreground)', opacity: isSavingManifest || !productDraft.name.trim() ? 0.4 : 1 }}
          >
            {isSavingManifest ? 'Saving…' : 'Save product'}
          </button>
        </div>
      ) : (
        // ── Product list ──
        <>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
              {currentManifest.catalog.products.length} products · {currentManifest.catalog.currency}
            </p>
            <button
              onClick={() => setProductDraft(emptyProduct())}
              style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(111,120,230,.4)', background: 'rgba(111,120,230,.1)', color: '#6f78e6', cursor: 'pointer' }}
            >
              + Add product
            </button>
          </div>
          {currentManifest.catalog.products.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>No products yet.</p>
              <button onClick={() => setProductDraft(emptyProduct())} style={{ marginTop: 8, fontSize: 12, color: '#6f78e6', background: 'none', border: 'none', cursor: 'pointer' }}>Add your first product →</button>
            </div>
          ) : currentManifest.catalog.products.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              {p.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.images[0]} alt={p.name} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid var(--border)' }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: 8, background: 'rgba(255,255,255,.05)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 16 }}>📦</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 1 }}>{currentManifest.catalog.currency} {p.price}{!p.available ? ' · unavailable' : ''}</p>
              </div>
              <button onClick={() => setProductDraft({ id: p.id, name: p.name, description: p.description, price: String(p.price), slug: p.slug, tags: (p.tags ?? []).join(', '), images: p.images, available: p.available })} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', flexShrink: 0 }}>Edit</button>
              <button onClick={() => handleProductDelete(p.id)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, border: '1px solid rgba(248,113,113,.3)', background: 'none', color: '#f87171', cursor: 'pointer', flexShrink: 0 }}>Del</button>
            </div>
          ))}
        </>
      )}
    </div>
  )

  const TopBar = (
    <header style={{
      flexShrink: 0, height: '3rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 0.875rem',
      borderBottom: '1px solid var(--border)',
      background: 'rgba(7,7,9,.95)',
      backdropFilter: 'blur(10px)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {projectName}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Version picker */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { const next = !showVersions; setShowVersions(next); if (next) fetchVersions() }}
            style={{
              fontFamily: 'var(--font-geist-mono)', fontSize: 11,
              padding: '3px 8px', borderRadius: 5,
              border: '1px solid var(--border)',
              color: 'var(--muted-foreground)',
              background: 'transparent', cursor: 'pointer',
            }}
          >
            {latestVersion ? `v${latestVersion.version_no}` : 'v—'} ▾
          </button>

          {showVersions && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowVersions(false)} />
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4,
                width: 280, background: '#0c0c10',
                border: '1px solid rgba(255,255,255,.1)', borderRadius: 10,
                boxShadow: '0 8px 32px rgba(0,0,0,.5)', zIndex: 50, overflow: 'hidden',
              }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
                  <p style={{ fontSize: 10, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '.04em' }}>History</p>
                </div>
                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {versions.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--muted-foreground)', padding: 12 }}>No versions yet.</p>
                  ) : versions.map((v) => (
                    <div key={v.id} style={{
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
                      padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.05)',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: 'var(--muted-foreground)' }}>v{v.version_no}</p>
                        <p style={{ fontSize: 12, color: 'var(--foreground)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.prompt || 'Generated'}
                        </p>
                        <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 2 }}>{timeAgo(v.created_at)}</p>
                      </div>
                      {versions[0]?.id !== v.id ? (
                        <button onClick={() => handleRestore(v.id)} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                          Restore
                        </button>
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--muted-foreground)', flexShrink: 0 }}>current</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Builder / Admin toggle */}
        <button
          onClick={() => setAdminMode((v) => !v)}
          style={{
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5,
            border: `1px solid ${adminMode ? 'rgba(111,120,230,.5)' : 'rgba(255,255,255,.12)'}`,
            background: adminMode ? 'rgba(111,120,230,.15)' : 'transparent',
            color: adminMode ? '#6f78e6' : 'var(--muted-foreground)',
            cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          {adminMode ? '← Builder' : 'Admin'}
        </button>

        <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, color: 'var(--muted-foreground)' }}>
          {balance} cr
        </span>

        <button
          onClick={() => handleExport(false)}
          disabled={!currentManifest || isExporting || isExportingAdmin}
          style={{
            fontSize: 11, fontWeight: 600,
            padding: '4px 10px', borderRadius: 5,
            border: '1px solid rgba(255,255,255,.15)',
            background: currentManifest && !isExporting ? 'rgba(255,255,255,.06)' : 'transparent',
            color: currentManifest && !isExporting ? 'var(--foreground)' : 'var(--muted-foreground)',
            cursor: currentManifest && !isExporting ? 'pointer' : 'not-allowed',
            opacity: currentManifest ? 1 : 0.4,
          }}
        >
          {isExporting ? '…' : 'Export'}
        </button>

        {deployStatus === 'ready' && deployUrl ? (
          <a
            href={deployUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5,
              border: '1px solid rgba(52,211,153,.4)',
              background: 'rgba(52,211,153,.1)', color: '#34d399',
              textDecoration: 'none',
            }}
          >
            ↗ Live
          </a>
        ) : (
          <button
            onClick={handleDeploy}
            disabled={!currentManifest || isDeploying || deployStatus === 'building'}
            style={{
              fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5,
              border: '1px solid rgba(52,211,153,.35)',
              background: currentManifest && !isDeploying && deployStatus !== 'building'
                ? 'rgba(52,211,153,.1)' : 'transparent',
              color: currentManifest && !isDeploying && deployStatus !== 'building'
                ? '#34d399' : 'var(--muted-foreground)',
              cursor: currentManifest && !isDeploying && deployStatus !== 'building'
                ? 'pointer' : 'not-allowed',
              opacity: currentManifest ? 1 : 0.4,
            }}
          >
            {isDeploying || deployStatus === 'building' ? '⟳ Deploying' : 'Deploy'}
          </button>
        )}
      </div>
    </header>
  )

  const ChatPanel = (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 6 }}>quante</p>
            <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>Describe the store you want to build.</p>
            <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4, opacity: 0.6 }}>Brand, products, vibe, currency.</p>
          </div>
        )}
        {messages.map((msg, i) => <ChatMessage key={i} message={msg} />)}
        {isGenerating && streamingText && (
          <StreamingView text={streamingText} />
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ flexShrink: 0, padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            disabled={isGenerating}
            placeholder={!currentManifest ? 'Minimal skincare brand, 3 products, EUR…' : 'Change accent to deep green…'}
            rows={3}
            style={{
              flex: 1, resize: 'none', fontSize: 13, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--secondary)',
              color: 'var(--foreground)', padding: '8px 10px',
              outline: 'none', fontFamily: 'inherit',
              opacity: isGenerating ? 0.5 : 1,
            }}
          />
          <button
            onClick={handleSend}
            disabled={isGenerating || !input.trim()}
            style={{
              flexShrink: 0, padding: '8px 14px', fontSize: 13, fontWeight: 600,
              borderRadius: 8, border: 'none', cursor: isGenerating || !input.trim() ? 'not-allowed' : 'pointer',
              background: 'var(--primary)', color: 'var(--primary-foreground)',
              opacity: isGenerating || !input.trim() ? 0.4 : 1,
            }}
          >
            {isGenerating ? '…' : '→'}
          </button>
        </div>
        <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 6 }}>
          {!currentManifest ? '10 credits' : '1 credit'} · shift+enter for newline
        </p>
        {currentManifest && (
          <>
            <button
              onClick={() => handleExport(false)}
              disabled={isExporting || isExportingAdmin}
              style={{
                marginTop: 8, width: '100%', padding: '9px', fontSize: 13, fontWeight: 600,
                borderRadius: 8, border: '1px solid rgba(111,120,230,.4)',
                background: (isExporting || isExportingAdmin) ? 'transparent' : 'rgba(111,120,230,.12)',
                color: (isExporting || isExportingAdmin) ? 'var(--muted-foreground)' : '#6f78e6',
                cursor: (isExporting || isExportingAdmin) ? 'not-allowed' : 'pointer',
                opacity: (isExporting || isExportingAdmin) ? 0.5 : 1,
                transition: 'background 0.15s',
              }}
            >
              {isExporting ? 'Preparing ZIP…' : '↓ Export store  ·  5 credits'}
            </button>
            <button
              onClick={() => handleExport(true)}
              disabled={isExporting || isExportingAdmin}
              style={{
                marginTop: 4, width: '100%', padding: '9px', fontSize: 13, fontWeight: 600,
                borderRadius: 8, border: '1px solid rgba(111,120,230,.25)',
                background: (isExporting || isExportingAdmin) ? 'transparent' : 'rgba(111,120,230,.07)',
                color: (isExporting || isExportingAdmin) ? 'var(--muted-foreground)' : '#6f78e6',
                cursor: (isExporting || isExportingAdmin) ? 'not-allowed' : 'pointer',
                opacity: (isExporting || isExportingAdmin) ? 0.5 : 1,
                transition: 'background 0.15s',
              }}
            >
              {isExportingAdmin ? 'Preparing…' : '↓ Export + Admin Panel  ·  10 credits'}
            </button>

            {deployStatus === 'ready' && deployUrl ? (
              <a
                href={deployUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block', marginTop: 6, width: '100%', padding: '9px',
                  fontSize: 13, fontWeight: 600, textAlign: 'center',
                  borderRadius: 8, border: '1px solid rgba(52,211,153,.4)',
                  background: 'rgba(52,211,153,.1)', color: '#34d399',
                  textDecoration: 'none', boxSizing: 'border-box',
                }}
              >
                ↗ Live: {deployDomain ?? deployUrl}
              </a>
            ) : (
              <button
                onClick={handleDeploy}
                disabled={isDeploying || deployStatus === 'building'}
                style={{
                  marginTop: 6, width: '100%', padding: '9px', fontSize: 13, fontWeight: 600,
                  borderRadius: 8, border: '1px solid rgba(52,211,153,.35)',
                  background: (isDeploying || deployStatus === 'building') ? 'transparent' : 'rgba(52,211,153,.1)',
                  color: (isDeploying || deployStatus === 'building') ? 'var(--muted-foreground)' : '#34d399',
                  cursor: (isDeploying || deployStatus === 'building') ? 'not-allowed' : 'pointer',
                  opacity: (isDeploying || deployStatus === 'building') ? 0.6 : 1,
                  transition: 'background 0.15s',
                }}
              >
                {isDeploying || deployStatus === 'building' ? '⟳ Deploying…' : '⬆ Deploy to Quante hosting  ·  15 credits'}
              </button>
            )}

            {/* Hosting trial / subscription banner */}
            {showHostingBanner && (
              <div style={{
                marginTop: 8, padding: '10px 12px', borderRadius: 8,
                border: trialExpired
                  ? '1px solid rgba(248,113,113,.35)'
                  : trialDaysLeft !== null && trialDaysLeft <= 7
                    ? '1px solid rgba(251,191,36,.3)'
                    : '1px solid rgba(52,211,153,.2)',
                background: trialExpired
                  ? 'rgba(248,113,113,.07)'
                  : trialDaysLeft !== null && trialDaysLeft <= 7
                    ? 'rgba(251,191,36,.06)'
                    : 'rgba(52,211,153,.05)',
              }}>
                <p style={{
                  fontSize: 11, fontWeight: 600, marginBottom: 6,
                  color: trialExpired ? '#f87171' : trialDaysLeft !== null && trialDaysLeft <= 7 ? '#fbbf24' : '#34d399',
                }}>
                  {trialExpired
                    ? 'Free trial ended'
                    : trialDaysLeft !== null && trialDaysLeft <= 7
                      ? `${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left in trial`
                      : `${trialDaysLeft} days of free hosting remaining`}
                </p>
                <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 8, lineHeight: 1.45 }}>
                  {trialExpired
                    ? 'Subscribe to keep your store live and unlock re-deploys.'
                    : 'Subscribe to keep hosting after the trial ends.'}
                </p>
                <button
                  onClick={handleHostingSubscribe}
                  disabled={isSubscribing}
                  style={{
                    width: '100%', padding: '7px', fontSize: 12, fontWeight: 600,
                    borderRadius: 6, border: 'none', cursor: isSubscribing ? 'not-allowed' : 'pointer',
                    background: '#6f78e6', color: '#fff',
                    opacity: isSubscribing ? 0.6 : 1,
                  }}
                >
                  {isSubscribing ? '…' : 'Subscribe  ·  €99/year'}
                </button>
              </div>
            )}

            {hostingInfo.subscribed && hostingInfo.cancelAtPeriodEnd && hostingInfo.subscriptionEndsAt && (
              <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 8, textAlign: 'center' }}>
                Hosting active until {new Date(hostingInfo.subscriptionEndsAt).toLocaleDateString()}
              </p>
            )}
          </>
        )}
      </div>
    </>
  )

  const SectionsPanel = (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {!currentManifest ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>Generate a store first.</p>
        </div>
      ) : (
        <>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
              Home · {homeSections.length} sections · 2 credits each
            </p>
          </div>
          {homeSections.map((section, i) => (
            <div key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>
                    {SECTION_LABELS[section.type] ?? section.type}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sectionSummary(section)}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 10 }}>
                  <button
                    onClick={() => {
                      if (editingSection === i && sectionEditMode === 'direct') { setEditingSection(null); setSectionDraft(null); setSectionEditMode(null) }
                      else { setEditingSection(i); setSectionDraft(JSON.parse(JSON.stringify(homeSections[i]))); setSectionEditMode('direct'); setExpandedSection(null); setSectionInput('') }
                    }}
                    style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: editingSection === i && sectionEditMode === 'direct' ? 'rgba(111,120,230,.15)' : 'none', color: editingSection === i && sectionEditMode === 'direct' ? '#6f78e6' : 'var(--muted-foreground)', cursor: 'pointer' }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (expandedSection === i && sectionEditMode === 'ai') { setExpandedSection(null); setSectionInput(''); setSectionEditMode(null) }
                      else { setExpandedSection(i); setSectionInput(''); setSectionEditMode('ai'); setEditingSection(null); setSectionDraft(null) }
                    }}
                    disabled={isGenerating}
                    style={{
                      fontSize: 11, padding: '5px 8px',
                      borderRadius: 6, border: '1px solid var(--border)',
                      background: 'none', color: 'var(--muted-foreground)', cursor: isGenerating ? 'not-allowed' : 'pointer',
                      opacity: regeneratingSection === i ? 0.5 : isGenerating ? 0.4 : 1,
                    }}
                  >
                    {regeneratingSection === i ? '…' : 'AI'}
                  </button>
                </div>
              </div>

              {/* Direct edit mode */}
              {editingSection === i && sectionEditMode === 'direct' && (
                <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {SectionEditFields()}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      onClick={handleSectionDirectSave}
                      disabled={isSavingManifest}
                      style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '7px', borderRadius: 6, border: 'none', cursor: isSavingManifest ? 'not-allowed' : 'pointer', background: 'var(--primary)', color: 'var(--primary-foreground)', opacity: isSavingManifest ? 0.4 : 1 }}
                    >
                      {isSavingManifest ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => { setEditingSection(null); setSectionDraft(null); setSectionEditMode(null) }} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--muted-foreground)', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* AI improve mode */}
              {expandedSection === i && sectionEditMode === 'ai' && (
                <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea
                    value={sectionInput}
                    onChange={(e) => setSectionInput(e.target.value)}
                    placeholder="Describe what to change, or leave blank for auto-improvement"
                    rows={2}
                    autoFocus
                    style={{
                      width: '100%', resize: 'none', fontSize: 12,
                      borderRadius: 6, border: '1px solid var(--border)',
                      background: 'var(--secondary)', color: 'var(--foreground)',
                      padding: '7px 10px', outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleSectionRegenerate(i, sectionInput)}
                      disabled={isGenerating}
                      style={{
                        flex: 1, fontSize: 12, fontWeight: 600, padding: '7px',
                        borderRadius: 6, border: 'none', cursor: isGenerating ? 'not-allowed' : 'pointer',
                        background: 'var(--primary)', color: 'var(--primary-foreground)',
                        opacity: isGenerating ? 0.4 : 1,
                      }}
                    >
                      Regenerate
                    </button>
                    <button
                      onClick={() => { setExpandedSection(null); setSectionInput(''); setSectionEditMode(null) }}
                      style={{
                        fontSize: 12, padding: '7px 14px', borderRadius: 6,
                        border: '1px solid var(--border)', background: 'none',
                        color: 'var(--muted-foreground)', cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* ── Add-ons ─────────────────────────────────────────────────── */}
          <div style={{ padding: '10px 14px 4px', borderTop: '1px solid rgba(255,255,255,.06)', marginTop: 4 }}>
            <p style={{ fontSize: 10, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Add-ons</p>
          </div>

          {/* Animations hint */}
          <div style={{ borderBottom: '1px solid rgba(255,255,255,.05)', padding: '12px 14px' }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', margin: '0 0 2px' }}>Animations</p>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0 }}>
              3 credits · CSS animated section — ask Quante to add one in chat
            </p>
          </div>

          {/* Admin panel note */}
          <div style={{ borderBottom: '1px solid rgba(255,255,255,.05)', padding: '12px 14px' }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', margin: '0 0 2px' }}>Admin Panel</p>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0 }}>
              Available here in Studio for free · Export with admin panel costs 10 credits
            </p>
          </div>
        </>
      )}
    </div>
  )

  const liveDomain = liveDeployment?.customDomain || deployDomain || liveDeployment?.domain
  const liveUrl = liveDeployment?.customDomain
    ? `https://${liveDeployment.customDomain}`
    : deployUrl || liveDeployment?.url

  // ── Publish checklist ────────────────────────────────────────────────────────
  const publishChecklist = currentManifest ? [
    {
      id: 'merchant',
      label: 'Firemní data (IČO, sídlo, kontakt)',
      ok: !!(currentManifest.merchant?.ico && currentManifest.merchant?.obchodni_nazev && currentManifest.merchant?.kontakt?.email),
    },
    {
      id: 'legal',
      label: '4 právní stránky v patičce',
      ok: ['obchodni-podminky', 'ochrana-osobnich-udaju', 'cookies', 'kontakt'].every(
        (slug) => currentManifest.customPages?.some((p) => p.slug === slug)
      ),
    },
    {
      id: 'payment',
      label: 'Min. 1 platební metoda',
      ok: !!(currentManifest.payments?.providers?.length || currentManifest.payments?.dobirka?.enabled || currentManifest.payments?.prevod?.enabled),
    },
    {
      id: 'shipping',
      label: 'Min. 1 způsob dopravy',
      ok: !!(currentManifest.shipping?.methods?.length),
    },
    {
      id: 'products',
      label: 'Min. 1 produkt s cenou a dostupností',
      ok: currentManifest.catalog.products.length > 0 && currentManifest.catalog.products.every((p) => p.price > 0),
    },
    {
      id: 'product_images',
      label: 'Každý produkt má alespoň 1 fotku',
      ok: currentManifest.catalog.products.length > 0 && currentManifest.catalog.products.every((p) => (p.images?.length ?? 0) > 0),
    },
  ] : []
  const checklistAllOk = publishChecklist.every((c) => c.ok)

  const HostingPanel = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Publish checklist */}
      {publishChecklist.length > 0 && (
        <div style={{
          borderRadius: 10,
          border: `1px solid ${checklistAllOk ? 'rgba(52,211,153,.3)' : 'rgba(251,191,36,.3)'}`,
          background: checklistAllOk ? 'rgba(52,211,153,.04)' : 'rgba(251,191,36,.04)',
          padding: '12px 14px',
        }}>
          <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8, color: checklistAllOk ? '#34d399' : '#fbbf24' }}>
            {checklistAllOk ? 'Připraveno k publikaci' : 'Před publikací splňte'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {publishChecklist.map((item) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ flexShrink: 0, fontSize: 12, color: item.ok ? '#34d399' : '#f87171' }}>
                  {item.ok ? '✓' : '✗'}
                </span>
                <span style={{ fontSize: 11, color: item.ok ? 'var(--foreground)' : 'var(--muted-foreground)' }}>
                  {item.label}
                </span>
                {!item.ok && item.id === 'merchant' && (
                  <button
                    onClick={() => { setDesktopTab('merchant'); setActiveTab('merchant') }}
                    style={{ fontSize: 9, color: '#6f78e6', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                  >
                    Vyplnit
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live URL */}
      {(deployStatus === 'ready' || liveDeployment?.status === 'ready') && liveUrl ? (
        <div style={{ borderRadius: 10, border: '1px solid rgba(52,211,153,.25)', background: 'rgba(52,211,153,.05)', padding: '14px 14px 12px' }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: '#34d399', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Live</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontFamily: 'var(--font-geist-mono)', color: 'var(--foreground)', wordBreak: 'break-all', flex: 1 }}>
              {liveDomain ?? liveUrl}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '7px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#34d399', color: '#000', textDecoration: 'none', textAlign: 'center' }}
            >
              Visit store
            </a>
            <button
              onClick={() => { navigator.clipboard.writeText(liveUrl ?? '') }}
              style={{ fontSize: 12, padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--muted-foreground)', cursor: 'pointer' }}
            >
              Copy URL
            </button>
          </div>
        </div>
      ) : deployStatus === 'building' || liveDeployment?.status === 'building' ? (
        <div style={{ borderRadius: 10, border: '1px solid rgba(251,191,36,.2)', background: 'rgba(251,191,36,.05)', padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(251,191,36,.3)', borderTopColor: '#fbbf24', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            <p style={{ fontSize: 12, color: '#fbbf24', fontWeight: 500 }}>Building… check back in a minute</p>
          </div>
          {liveDeployment?.domain && (
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 6 }}>
              Will be live at: {liveDeployment.domain}
            </p>
          )}
        </div>
      ) : (
        <div style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '14px', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>No deployment yet. Use the Deploy button in Chat to go live.</p>
        </div>
      )}

      {/* Custom domain */}
      {(deployStatus === 'ready' || liveDeployment?.status === 'ready') && (
        <div style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '14px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 4 }}>Custom domain</p>
          <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 10, lineHeight: 1.5 }}>
            Point your domain to Quante hosting. Works with any domain registrar.
          </p>
          <div style={{ display: 'flex', gap: 6, marginBottom: domainResult ? 12 : 0 }}>
            <input
              value={customDomainInput}
              onChange={(e) => setCustomDomainInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
              placeholder="yourdomain.com"
              style={{
                flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--secondary)',
                color: 'var(--foreground)', outline: 'none',
                fontFamily: 'var(--font-geist-mono)',
              }}
            />
            <button
              onClick={handleAddDomain}
              disabled={isAddingDomain || !customDomainInput.trim()}
              style={{
                fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 6,
                border: 'none', cursor: isAddingDomain || !customDomainInput.trim() ? 'not-allowed' : 'pointer',
                background: '#6f78e6', color: '#fff', opacity: isAddingDomain || !customDomainInput.trim() ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              {isAddingDomain ? '…' : 'Connect'}
            </button>
          </div>

          {/* DNS instructions */}
          {domainResult && (
            <div style={{ borderRadius: 8, background: domainResult.verified ? 'rgba(52,211,153,.07)' : 'rgba(111,120,230,.07)', border: `1px solid ${domainResult.verified ? 'rgba(52,211,153,.2)' : 'rgba(111,120,230,.2)'}`, padding: '10px 12px' }}>
              {domainResult.verified ? (
                <p style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>✓ Domain verified and live!</p>
              ) : (
                <>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>Add this DNS record:</p>
                  <div style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, background: 'rgba(0,0,0,.3)', borderRadius: 6, padding: '8px 10px', color: '#a5b4fc', marginBottom: 8 }}>
                    {domainResult.dnsInstructions ?? `CNAME  ${domainResult.domain}  →  cname.vercel-dns.com`}
                  </div>
                  <p style={{ fontSize: 10, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
                    After adding the record, DNS changes can take up to 48 hours. Click Connect again to re-check.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Already has domain */}
          {!domainResult && liveDeployment?.customDomain && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: liveDeployment.customDomainVerified ? '#34d399' : '#fbbf24' }}>
                {liveDeployment.customDomainVerified ? '✓' : '⚠'}
              </span>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: 'var(--muted-foreground)' }}>
                {liveDeployment.customDomain} — {liveDeployment.customDomainVerified ? 'verified' : 'pending DNS'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Earnings */}
      <div style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Earnings</p>
          <span style={{ fontSize: 10, color: 'var(--muted-foreground)', fontFamily: 'var(--font-geist-mono)' }}>5% platform fee</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, background: 'var(--secondary)', borderRadius: 8, padding: '10px 12px' }}>
            <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginBottom: 2 }}>Available</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#34d399', fontFamily: 'var(--font-geist-mono)' }}>
              {earnings ? `€${earnings.available.toFixed(2)}` : '—'}
            </p>
          </div>
          <div style={{ flex: 1, background: 'var(--secondary)', borderRadius: 8, padding: '10px 12px' }}>
            <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginBottom: 2 }}>Sales</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', fontFamily: 'var(--font-geist-mono)' }}>
              {earnings ? String(earnings.saleCount) : '—'}
            </p>
          </div>
        </div>

        {/* IBAN form */}
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>Payout account</p>
        <input
          value={holderInput}
          onChange={(e) => setHolderInput(e.target.value)}
          placeholder="Account holder name"
          style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--secondary)', color: 'var(--foreground)', outline: 'none', marginBottom: 6, boxSizing: 'border-box' }}
        />
        <input
          value={ibanInput}
          onChange={(e) => setIbanInput(e.target.value)}
          placeholder="IBAN (e.g. CZ65 0800 0000 1920 0014 5399)"
          style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--secondary)', color: 'var(--foreground)', outline: 'none', marginBottom: 8, boxSizing: 'border-box', fontFamily: 'var(--font-geist-mono)' }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleSaveIban}
            disabled={isSavingIban || !ibanInput.trim() || !holderInput.trim()}
            style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border)', cursor: isSavingIban ? 'not-allowed' : 'pointer', background: 'var(--secondary)', color: 'var(--foreground)', opacity: isSavingIban ? 0.5 : 1 }}
          >
            {isSavingIban ? '…' : payoutAccount?.iban ? 'Update IBAN' : 'Save IBAN'}
          </button>
          {payoutAccount?.iban && (earnings?.available ?? 0) > 0 && (
            <button
              onClick={handleRequestPayout}
              disabled={isRequestingPayout}
              style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', cursor: isRequestingPayout ? 'not-allowed' : 'pointer', background: '#6f78e6', color: '#fff', opacity: isRequestingPayout ? 0.5 : 1 }}
            >
              {isRequestingPayout ? '…' : 'Request payout'}
            </button>
          )}
        </div>
        {payoutMsg && (
          <p style={{ fontSize: 11, marginTop: 8, color: payoutMsg.startsWith('Payout') ? '#34d399' : '#f87171', lineHeight: 1.5 }}>
            {payoutMsg}
          </p>
        )}
      </div>

      {/* Subscription */}
      <div style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '14px' }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 8 }}>Hosting plan</p>
        {hostingInfo.subscribed ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#34d399' }}>●</span>
              <span style={{ fontSize: 12, color: 'var(--foreground)', fontWeight: 500 }}>Active — €99/year</span>
            </div>
            {hostingInfo.subscriptionEndsAt && (
              <p style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                {hostingInfo.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {new Date(hostingInfo.subscriptionEndsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
          </>
        ) : hostingInfo.trialEndsAt ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: trialExpired ? '#f87171' : '#fbbf24' }}>●</span>
              <span style={{ fontSize: 12, color: trialExpired ? '#f87171' : '#fbbf24', fontWeight: 500 }}>
                {trialExpired ? 'Free trial ended' : `Free trial · ${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left`}
              </span>
            </div>
            <button
              onClick={handleHostingSubscribe}
              disabled={isSubscribing}
              style={{ width: '100%', padding: '8px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', cursor: isSubscribing ? 'not-allowed' : 'pointer', background: '#6f78e6', color: '#fff', opacity: isSubscribing ? 0.6 : 1 }}
            >
              {isSubscribing ? '…' : 'Subscribe · €99/year'}
            </button>
          </>
        ) : (
          <p style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Deploy your store to start your 30-day free trial.</p>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  const PreviewPane = (
    <div style={{ flex: 1, position: 'relative', background: '#0a0a0c', overflow: 'hidden' }}>
      {!currentManifest ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
          <div>
            <p style={{ color: 'rgba(255,255,255,.2)', fontSize: 13, fontFamily: 'var(--font-geist-mono)', marginBottom: 8 }}>no preview yet</p>
            <p style={{ color: 'rgba(255,255,255,.12)', fontSize: 11 }}>Describe a store to get started</p>
          </div>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          key={iframeKey}
          src={`/preview/${projectId}`}
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="Store preview"
          onLoad={handleIframeLoad}
        />
      )}
      {isGenerating && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              border: '2px solid rgba(255,255,255,.15)', borderTopColor: 'rgba(255,255,255,.8)',
              animation: 'spin 0.8s linear infinite', margin: '0 auto 10px',
            }} />
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', fontFamily: 'var(--font-geist-mono)' }}>generating…</p>
          </div>
        </div>
      )}
    </div>
  )

  // ── Admin panel ──────────────────────────────────────────────────────────────
  const productCount = currentManifest?.catalog.products.length ?? 0
  const sectionCount = currentManifest?.pages.home.length ?? 0
  const currency = currentManifest?.catalog.currency ?? 'CZK'

  const ADMIN_TABS: { id: AdminTab; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'products',  label: 'Products'  },
    { id: 'orders',    label: 'Orders'    },
    { id: 'settings',  label: 'Settings'  },
  ]

  const AdminDashboard = (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Products', value: productCount, color: '#6f78e6' },
          { label: 'Sections', value: sectionCount, color: '#a78bfa' },
          { label: 'Revenue', value: orderRevenue > 0 ? `${orderRevenue.toFixed(2)} ${currency}` : '—', color: '#34d399' },
          { label: 'Orders', value: orders.length > 0 ? orders.length : '—', color: '#fbbf24' },
        ].map((stat) => (
          <div key={stat.label} style={{ borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)', padding: '14px 16px' }}>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 6 }}>{stat.label}</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: stat.color, fontFamily: 'var(--font-geist-mono)' }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Live URL card */}
      {liveUrl && (
        <div style={{ borderRadius: 10, border: '1px solid rgba(52,211,153,.25)', background: 'rgba(52,211,153,.04)', padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 600, color: '#34d399', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Store live</p>
            <p style={{ fontSize: 13, fontFamily: 'var(--font-geist-mono)', color: 'var(--foreground)' }}>{liveDomain ?? liveUrl}</p>
          </div>
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 6, background: '#34d399', color: '#000', textDecoration: 'none', flexShrink: 0 }}>
            Visit ↗
          </a>
        </div>
      )}

      {/* Hosting status */}
      <div style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '14px 16px', marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground)', marginBottom: 8 }}>Hosting</p>
        {hostingInfo.subscribed ? (
          <p style={{ fontSize: 12, color: '#34d399' }}>● Active plan · €99/year</p>
        ) : hostingInfo.trialEndsAt ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: 12, color: trialExpired ? '#f87171' : '#fbbf24' }}>
              {trialExpired ? '● Trial ended' : `● Free trial · ${trialDaysLeft} days left`}
            </p>
            {trialExpired && (
              <button onClick={handleHostingSubscribe} disabled={isSubscribing} style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 5, border: 'none', background: '#6f78e6', color: '#fff', cursor: 'pointer' }}>
                Subscribe
              </button>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Not deployed yet.</p>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button onClick={() => setAdminTab('products')} style={{ padding: '12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--foreground)', cursor: 'pointer', textAlign: 'left', fontSize: 12 }}>
          <p style={{ fontWeight: 600, marginBottom: 2 }}>Manage products</p>
          <p style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>Add, edit, remove products</p>
        </button>
        <button onClick={() => { setAdminTab('orders'); handleLoadOrders() }} style={{ padding: '12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--foreground)', cursor: 'pointer', textAlign: 'left', fontSize: 12 }}>
          <p style={{ fontWeight: 600, marginBottom: 2 }}>View orders</p>
          <p style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>Revenue from your store</p>
        </button>
        <button onClick={() => setAdminMode(false)} style={{ padding: '12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--foreground)', cursor: 'pointer', textAlign: 'left', fontSize: 12 }}>
          <p style={{ fontWeight: 600, marginBottom: 2 }}>AI Builder</p>
          <p style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>Design with AI chat</p>
        </button>
        <button onClick={() => setAdminTab('settings')} style={{ padding: '12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--foreground)', cursor: 'pointer', textAlign: 'left', fontSize: 12 }}>
          <p style={{ fontWeight: 600, marginBottom: 2 }}>Settings</p>
          <p style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>Stripe keys, domain</p>
        </button>
      </div>
    </div>
  )

  const AdminOrders = (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
      {ordersError === 'no_key' ? (
        <div style={{ borderRadius: 10, border: '1px solid rgba(111,120,230,.3)', background: 'rgba(111,120,230,.06)', padding: 20, textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', marginBottom: 8 }}>Connect your Stripe account</p>
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 16, lineHeight: 1.6 }}>
            Add your store&apos;s Stripe secret key in Settings to view orders and revenue directly in Quante.
          </p>
          <button onClick={() => setAdminTab('settings')} style={{ fontSize: 12, fontWeight: 600, padding: '8px 20px', borderRadius: 6, border: 'none', background: '#6f78e6', color: '#fff', cursor: 'pointer' }}>
            Go to Settings
          </button>
        </div>
      ) : isLoadingOrders ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: '#6f78e6', animation: 'spin 0.8s linear infinite' }} />
        </div>
      ) : ordersError ? (
        <div style={{ borderRadius: 10, border: '1px solid rgba(248,113,113,.25)', background: 'rgba(248,113,113,.06)', padding: 16 }}>
          <p style={{ fontSize: 13, color: '#f87171' }}>{ordersError}</p>
          <button onClick={handleLoadOrders} style={{ marginTop: 8, fontSize: 11, color: '#6f78e6', background: 'none', border: 'none', cursor: 'pointer' }}>Try again</button>
        </div>
      ) : orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 16 }}>
            {orderRevenue > 0 && (
              <div style={{ borderRadius: 10, border: '1px solid rgba(52,211,153,.25)', background: 'rgba(52,211,153,.05)', padding: '12px 20px', textAlign: 'center' }}>
                <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginBottom: 4 }}>Total revenue</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: '#34d399', fontFamily: 'var(--font-geist-mono)' }}>{orderRevenue.toFixed(2)}</p>
              </div>
            )}
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>No completed orders yet.</p>
          <button onClick={handleLoadOrders} style={{ marginTop: 8, fontSize: 11, color: '#6f78e6', background: 'none', border: 'none', cursor: 'pointer' }}>Refresh</button>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div style={{ borderRadius: 10, border: '1px solid rgba(52,211,153,.25)', background: 'rgba(52,211,153,.05)', padding: '14px 16px' }}>
              <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginBottom: 4 }}>Total revenue</p>
              <p style={{ fontSize: 22, fontWeight: 700, color: '#34d399', fontFamily: 'var(--font-geist-mono)' }}>{orderRevenue.toFixed(2)}</p>
            </div>
            <div style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '14px 16px' }}>
              <p style={{ fontSize: 10, color: 'var(--muted-foreground)', marginBottom: 4 }}>Orders</p>
              <p style={{ fontSize: 22, fontWeight: 700, color: '#6f78e6', fontFamily: 'var(--font-geist-mono)' }}>{orders.length}</p>
            </div>
          </div>

          {/* Orders table */}
          <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 12, padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,.03)' }}>
              {['Customer', 'Items', 'Amount', 'Date'].map((h) => (
                <p key={h} style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</p>
              ))}
            </div>
            {orders.map((o) => (
              <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 12, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,.04)', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 500 }}>{o.customerName !== '—' ? o.customerName : o.customerEmail}</p>
                  {o.customerName !== '—' && <p style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>{o.customerEmail}</p>}
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ') || '—'}</p>
                <p style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-geist-mono)', color: '#34d399', whiteSpace: 'nowrap' }}>{o.amount.toFixed(2)} {o.currency}</p>
                <p style={{ fontSize: 10, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>{new Date(o.createdAt).toLocaleDateString('en-GB')}</p>
              </div>
            ))}
          </div>
          <button onClick={handleLoadOrders} style={{ marginTop: 12, fontSize: 11, color: 'var(--muted-foreground)', background: 'none', border: 'none', cursor: 'pointer' }}>↻ Refresh</button>
        </>
      )}
      {orders.length === 0 && !ordersError && !isLoadingOrders && (
        <button onClick={handleLoadOrders} style={{ display: 'none' }} />
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const inpSt: React.CSSProperties = {
    width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 7,
    border: '1px solid var(--border)', background: 'var(--secondary)',
    color: 'var(--foreground)', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'var(--font-geist-mono)',
  }

  const AdminSettings = (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 520 }}>
        <div style={{ borderRadius: 10, border: '1px solid var(--border)', padding: 20, marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', marginBottom: 4 }}>Stripe keys — your store</p>
          <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 16, lineHeight: 1.6 }}>
            These are the Stripe keys for your e-shop (not Quante&apos;s). After saving, they&apos;re automatically pushed to your live store&apos;s Vercel environment.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted-foreground)', display: 'block', marginBottom: 4 }}>Publishable key (pk_live_…)</label>
              <input value={settingsPubKey} onChange={(e) => setSettingsPubKey(e.target.value)} placeholder="pk_live_..." style={inpSt} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted-foreground)', display: 'block', marginBottom: 4 }}>
                Secret key (sk_live_…){settingsSecKeySet && <span style={{ color: '#34d399', marginLeft: 6 }}>✓ set</span>}
              </label>
              <input
                type="password"
                value={settingsSecKey}
                onChange={(e) => setSettingsSecKey(e.target.value)}
                placeholder={settingsSecKeySet ? '••••••••••••••••••••••••' : 'sk_live_...'}
                style={inpSt}
              />
            </div>
          </div>
          <button
            onClick={handleSaveSettings}
            disabled={isSavingSettings || (!settingsPubKey && !settingsSecKey)}
            style={{ marginTop: 14, width: '100%', padding: '9px', fontSize: 13, fontWeight: 600, borderRadius: 7, border: 'none', cursor: isSavingSettings ? 'not-allowed' : 'pointer', background: '#6f78e6', color: '#fff', opacity: isSavingSettings || (!settingsPubKey && !settingsSecKey) ? 0.5 : 1 }}
          >
            {isSavingSettings ? 'Saving…' : 'Save & push to store'}
          </button>
        </div>

        {/* Domain */}
        <div style={{ borderRadius: 10, border: '1px solid var(--border)', padding: 20, marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', marginBottom: 4 }}>Custom domain</p>
          <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 12, lineHeight: 1.5 }}>
            Connect your own domain to your live store.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={customDomainInput}
              onChange={(e) => setCustomDomainInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
              placeholder="yourdomain.com"
              style={{ ...inpSt, flex: 1 }}
            />
            <button
              onClick={handleAddDomain}
              disabled={isAddingDomain || !customDomainInput.trim()}
              style={{ fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', background: '#6f78e6', color: '#fff', opacity: isAddingDomain || !customDomainInput.trim() ? 0.5 : 1, flexShrink: 0 }}
            >
              {isAddingDomain ? '…' : 'Connect'}
            </button>
          </div>
          {domainResult && (
            <div style={{ marginTop: 10, borderRadius: 8, background: domainResult.verified ? 'rgba(52,211,153,.07)' : 'rgba(111,120,230,.07)', border: `1px solid ${domainResult.verified ? 'rgba(52,211,153,.2)' : 'rgba(111,120,230,.2)'}`, padding: '10px 12px' }}>
              {domainResult.verified ? (
                <p style={{ fontSize: 12, color: '#34d399', fontWeight: 600 }}>✓ Domain connected and live!</p>
              ) : (
                <>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>Add this DNS record at your registrar:</p>
                  <div style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, background: 'rgba(0,0,0,.3)', borderRadius: 6, padding: '8px 10px', color: '#a5b4fc', marginBottom: 6 }}>
                    {domainResult.dnsInstructions ?? `CNAME  @  →  cname.vercel-dns.com`}
                  </div>
                  <p style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>DNS changes can take up to 48 hours. Click Connect again to re-check.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  // Admin panel layout (full-screen, no preview pane)
  if (adminMode) {
    return (
      <div style={{ position: 'fixed', top: '3rem', left: 0, right: 0, bottom: '4rem', zIndex: 30, display: 'flex', flexDirection: 'column', background: 'var(--background)' }}>
        {TopBar}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {/* Admin sidebar */}
          <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 2 }}>
            <p style={{ fontSize: 10, color: 'var(--muted-foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', padding: '4px 10px 8px' }}>Store admin</p>
            {ADMIN_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => { setAdminTab(t.id); if (t.id === 'orders' && orders.length === 0 && !ordersError) handleLoadOrders() }}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 7,
                  border: 'none', cursor: 'pointer', fontSize: 13,
                  fontWeight: adminTab === t.id ? 600 : 400,
                  background: adminTab === t.id ? 'rgba(111,120,230,.15)' : 'none',
                  color: adminTab === t.id ? '#6f78e6' : 'var(--foreground)',
                  transition: 'all 0.1s',
                }}
              >
                {t.label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setAdminMode(false)}
              style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, background: 'none', color: 'var(--muted-foreground)' }}
            >
              ← AI Builder
            </button>
          </div>

          {/* Admin content */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {adminTab === 'dashboard' && AdminDashboard}
            {adminTab === 'products'  && <div style={{ flex: 1, overflowY: 'auto' }}>{ProductsPanel}</div>}
            {adminTab === 'orders'    && AdminOrders}
            {adminTab === 'settings'  && AdminSettings}
          </div>
        </div>
      </div>
    )
  }

  // ── Desktop split-view ───────────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <div style={{
        position: 'fixed', top: '3rem', left: 0, right: 0, bottom: '4rem',
        zIndex: 30, display: 'flex', flexDirection: 'column',
        background: 'var(--background)',
      }}>
        {TopBar}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {/* Left panel */}
          <div style={{
            width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column',
            borderRight: '1px solid var(--border)',
          }}>
            {/* Desktop tab bar */}
            <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid var(--border)' }}>
              {(['chat', 'sections', 'products', 'hosting', 'merchant'] as DesktopTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDesktopTab(tab)}
                  style={{
                    flex: 1, padding: '0.5rem 0', fontSize: 11,
                    fontWeight: desktopTab === tab ? 600 : 400,
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: desktopTab === tab ? 'var(--foreground)' : 'var(--muted-foreground)',
                    borderBottom: desktopTab === tab ? '2px solid #6f78e6' : '2px solid transparent',
                    textTransform: 'capitalize', transition: 'color 0.15s',
                    position: 'relative',
                  }}
                >
                  {tab}
                  {tab === 'hosting' && deployStatus === 'ready' && (
                    <span style={{ position: 'absolute', top: 6, right: 6, width: 5, height: 5, borderRadius: '50%', background: '#34d399' }} />
                  )}
                  {tab === 'merchant' && currentManifest && !checklistAllOk && (
                    <span style={{ position: 'absolute', top: 6, right: 6, width: 5, height: 5, borderRadius: '50%', background: '#f87171' }} />
                  )}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {desktopTab === 'chat' ? ChatPanel
                : desktopTab === 'products' ? ProductsPanel
                : desktopTab === 'hosting' ? HostingPanel
                : desktopTab === 'merchant' ? (
                  <MerchantPanel
                    projectId={projectId}
                    manifest={currentManifest}
                    onManifestUpdate={(m) => { setCurrentManifest(m); setIframeKey((k) => k + 1) }}
                    onBalanceRefresh={refreshBalance}
                  />
                )
                : SectionsPanel}
            </div>
          </div>

          {/* Right: always-visible preview */}
          {PreviewPane}
        </div>
      </div>
    )
  }

  // ── Mobile tabbed layout ─────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', top: '3rem', left: 0, right: 0, bottom: '4rem',
      zIndex: 30, display: 'flex', flexDirection: 'column',
      background: 'var(--background)',
    }}>
      {TopBar}

      {/* Mobile tab switcher */}
      <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {(['chat', 'preview', 'sections', 'products', 'hosting', 'merchant'] as StudioTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: '0.55rem 0', fontSize: 10, fontWeight: activeTab === tab ? 600 : 400,
              background: 'none', border: 'none', cursor: 'pointer',
              color: activeTab === tab ? 'var(--foreground)' : 'var(--muted-foreground)',
              borderBottom: activeTab === tab ? '2px solid #6f78e6' : '2px solid transparent',
              textTransform: 'capitalize', transition: 'color 0.15s',
              position: 'relative',
            }}
          >
            {tab}
            {tab === 'preview' && currentManifest && isGenerating && (
              <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.6 }}>●</span>
            )}
            {tab === 'hosting' && deployStatus === 'ready' && (
              <span style={{ position: 'absolute', top: 6, right: 6, width: 5, height: 5, borderRadius: '50%', background: '#34d399' }} />
            )}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'chat' && ChatPanel}
        {activeTab === 'preview' && PreviewPane}
        {activeTab === 'sections' && SectionsPanel}
        {activeTab === 'products' && ProductsPanel}
        {activeTab === 'hosting' && HostingPanel}
        {activeTab === 'merchant' && (
          <MerchantPanel
            projectId={projectId}
            manifest={currentManifest}
            onManifestUpdate={(m) => { setCurrentManifest(m); setIframeKey((k) => k + 1) }}
            onBalanceRefresh={refreshBalance}
          />
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StreamingView({ text }: { text: string }) {
  return (
    <div style={{
      borderRadius: 8,
      background: 'rgba(111,120,230,.06)',
      border: '1px solid rgba(111,120,230,.15)',
      padding: '10px 12px',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: '#6f78e6',
          boxShadow: '0 0 6px rgba(111,120,230,.8)',
          animation: 'pulse 1.5s ease-in-out infinite',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 10, color: 'rgba(111,120,230,.7)', fontFamily: 'var(--font-geist-mono)', letterSpacing: '.04em' }}>
          AI writing
        </span>
      </div>
      <p style={{
        fontFamily: 'var(--font-geist-mono)', fontSize: 10,
        color: 'rgba(255,255,255,.25)', lineHeight: 1.6,
        wordBreak: 'break-all', margin: 0,
        display: '-webkit-box', WebkitLineClamp: 4,
        WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {text}<span style={{ animation: 'blink 1s step-end infinite', opacity: 1, color: 'rgba(111,120,230,.6)' }}>▋</span>
      </p>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>
    </div>
  )
}

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const isError = message.type === 'error'
  const isStatus = message.type === 'status'

  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '88%', borderRadius: 10, padding: '8px 12px',
        fontSize: isStatus ? 12 : 14, lineHeight: 1.5,
        background: isUser ? 'var(--primary)' : isError ? 'rgba(220,60,60,.12)' : isStatus ? 'transparent' : 'var(--secondary)',
        color: isUser ? 'var(--primary-foreground)' : isError ? '#f87171' : isStatus ? 'var(--muted-foreground)' : 'var(--foreground)',
        border: isError ? '1px solid rgba(220,60,60,.25)' : 'none',
        fontStyle: isStatus ? 'italic' : 'normal',
      }}>
        {message.content.split('**').map((part, i) =>
          i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
        )}
      </div>
    </div>
  )
}
