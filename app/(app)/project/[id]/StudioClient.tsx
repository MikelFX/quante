'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { ShopManifest, Section } from '@/types/manifest'
import { MerchantPanel } from './MerchantPanel'
import {
  MessageCircle, Layers, Package, Paintbrush, Rocket,
  Monitor, Tablet, Smartphone, RotateCcw, ExternalLink, ChevronDown,
  GripVertical, Eye, EyeOff, Trash2, Plus, X,
  LayoutDashboard, ShoppingBag, ClipboardList, Settings2, ArrowLeft, TrendingUp, Share2,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChangeSummary {
  changes: string[]
  prevVersionId: string | null
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  type?: 'status' | 'error' | 'done'
  changeSummary?: ChangeSummary
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

type StudioTab = 'chat' | 'preview' | 'sections' | 'products' | 'theme' | 'publish'
type DesktopTab = 'chat' | 'sections' | 'products' | 'theme' | 'publish'
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

function diffManifest(oldM: ShopManifest, newM: ShopManifest): string[] {
  const changes: string[] = []

  // Palette
  const paletteLabels: [keyof ShopManifest['design']['palette'], string][] = [
    ['bg', 'Background'], ['surface', 'Surface'], ['text', 'Text'],
    ['accent', 'Accent'], ['accentText', 'Accent text'], ['muted', 'Muted'], ['border', 'Border'],
  ]
  for (const [k, label] of paletteLabels) {
    if (oldM.design.palette[k] !== newM.design.palette[k])
      changes.push(`${label} → ${newM.design.palette[k]}`)
  }

  // Typography + shape
  if (oldM.design.typography.scale !== newM.design.typography.scale)
    changes.push(`Type scale → ${newM.design.typography.scale}`)
  if (oldM.design.typography.headingFont !== newM.design.typography.headingFont)
    changes.push(`Heading font → ${newM.design.typography.headingFont}`)
  if (oldM.design.typography.bodyFont !== newM.design.typography.bodyFont)
    changes.push(`Body font → ${newM.design.typography.bodyFont}`)
  if (oldM.design.radius !== newM.design.radius) changes.push(`Radius → ${newM.design.radius}`)
  if (oldM.design.density !== newM.design.density) changes.push(`Density → ${newM.design.density}`)
  if (oldM.design.motion !== newM.design.motion) changes.push(`Motion → ${newM.design.motion}`)

  // Brand
  if (oldM.brand.name !== newM.brand.name) changes.push(`Store name → "${newM.brand.name}"`)
  if (oldM.brand.tagline !== newM.brand.tagline) changes.push(`Tagline → "${newM.brand.tagline}"`)
  if (oldM.brand.voice !== newM.brand.voice) changes.push(`Brand voice → ${newM.brand.voice}`)

  // SEO
  if (oldM.seo.title !== newM.seo.title) changes.push(`SEO title → "${newM.seo.title}"`)

  // Sections (home page)
  const oldH = oldM.pages.home, newH = newM.pages.home
  if (oldH.length < newH.length) {
    const n = newH.length - oldH.length
    changes.push(`${n} section${n > 1 ? 's' : ''} added`)
  } else if (oldH.length > newH.length) {
    const n = oldH.length - newH.length
    changes.push(`${n} section${n > 1 ? 's' : ''} removed`)
  }
  for (let i = 0; i < Math.min(oldH.length, newH.length, 8); i++) {
    if (JSON.stringify(oldH[i]) === JSON.stringify(newH[i])) continue
    const os = oldH[i], ns = newH[i]
    if (os.type !== ns.type) {
      changes.push(`Section ${i + 1} → ${SECTION_LABELS[ns.type] ?? ns.type}`)
    } else if (ns.type === 'hero' && os.type === 'hero') {
      if (os.props.headline !== ns.props.headline)
        changes.push(`Hero headline → "${ns.props.headline.slice(0, 50)}"`)
      else if (os.props.subheadline !== ns.props.subheadline)
        changes.push('Hero subheadline updated')
      else if (os.props.ctaLabel !== ns.props.ctaLabel)
        changes.push(`Hero CTA → "${ns.props.ctaLabel}"`)
      else changes.push('Hero section updated')
    } else {
      changes.push(`${SECTION_LABELS[ns.type as string] ?? ns.type} section updated`)
    }
  }

  // Products
  const oldP = oldM.catalog.products, newP = newM.catalog.products
  const addedP = newP.filter(p => !oldP.find(o => o.id === p.id))
  const removedP = oldP.filter(p => !newP.find(n => n.id === p.id))
  if (addedP.length) changes.push(`${addedP.length} product${addedP.length > 1 ? 's' : ''} added`)
  if (removedP.length) changes.push(`${removedP.length} product${removedP.length > 1 ? 's' : ''} removed`)
  for (const np of newP) {
    const op = oldP.find(p => p.id === np.id)
    if (op && JSON.stringify(op) !== JSON.stringify(np))
      changes.push(`"${np.name}" updated`)
  }

  // Nav / footer
  if (JSON.stringify(oldM.nav) !== JSON.stringify(newM.nav)) changes.push('Navigation updated')
  if (JSON.stringify(oldM.footer) !== JSON.stringify(newM.footer)) changes.push('Footer updated')

  return changes.slice(0, 8)
}

const QUICK_CHIPS = [
  { label: 'Accent color', prompt: 'Change the accent color to ' },
  { label: 'Hero copy', prompt: 'Rewrite the hero headline to be shorter and punchier' },
  { label: 'Add section', prompt: 'Add a ' },
  { label: 'Typography', prompt: 'Switch the typography to a ' },
  { label: 'New product', prompt: 'Add a new product: ' },
]

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
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
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
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [showSectionPicker, setShowSectionPicker] = useState(false)
  const [hiddenSections, setHiddenSections] = useState<Set<number>>(new Set())
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set())
  const [showCommandPalette, setShowCommandPalette] = useState(false)
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

  // ⌘K / Ctrl+K shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(p => !p)
      }
      if (e.key === 'Escape') setShowCommandPalette(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
    const prevManifest = currentManifest
    const prevVersionId = versions[0]?.id ?? null  // capture before the edit creates a new version

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '…', type: 'status' },
    ])
    setIsGenerating(true)

    const hasManifest = !!currentManifest

    if (!hasManifest) {
      // Generation flow
      try {
        await consumeStream('/api/quante/generate', { brief: text, projectId }, (manifest) => {
          if (!manifest) return
          const summary = `**${manifest.brand.name}** ready — ${manifest.catalog.products.length} product${manifest.catalog.products.length !== 1 ? 's' : ''}, ${manifest.pages.home.length} sections.`
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

    // Iteration flow — with history + change summary
    const history = snapshot
      .filter((m) => m.type !== 'status' && m.content !== '…')
      .map((m) => ({ role: m.role, content: m.content }))

    try {
      await consumeStream(
        '/api/quante/iterate',
        { projectId, instruction: text, history },
        (manifest, reply) => {
          const changes = manifest && prevManifest ? diffManifest(prevManifest, manifest) : []
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = {
              role: 'assistant',
              content: reply ?? updated[updated.length - 1].content,
              type: 'done',
              ...(manifest && changes.length > 0
                ? { changeSummary: { changes, prevVersionId } }
                : {}),
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
        const detail = data.errorMessage ? `\n\`\`\`\n${data.errorMessage}\n\`\`\`` : ''
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Deployment failed. Your credits were not charged.${detail}`, type: 'error' },
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

  async function handleReorderSections(fromIndex: number, toIndex: number) {
    if (!currentManifest || fromIndex === toIndex) return
    const sections = [...currentManifest.pages.home]
    const [moved] = sections.splice(fromIndex, 1)
    sections.splice(toIndex, 0, moved)
    const updated: ShopManifest = { ...currentManifest, pages: { ...currentManifest.pages, home: sections } }
    setCurrentManifest(updated)
    // shift hiddenSections indices
    setHiddenSections(prev => {
      const next = new Set<number>()
      prev.forEach(idx => {
        if (idx === fromIndex) { next.add(toIndex) }
        else if (fromIndex < toIndex && idx > fromIndex && idx <= toIndex) { next.add(idx - 1) }
        else if (fromIndex > toIndex && idx >= toIndex && idx < fromIndex) { next.add(idx + 1) }
        else { next.add(idx) }
      })
      return next
    })
    await handleSaveManifest(updated, 'Reordered sections')
  }

  async function handleAddSection(type: string) {
    if (!currentManifest) return
    const defaults: Record<string, object> = {
      hero:         { heading: 'New Hero', subheading: 'Your tagline here', ctaLabel: 'Shop now', ctaHref: '/products', layout: 'center' },
      productGrid:  { title: 'Products', count: 4 },
      featureRow:   { heading: 'Why choose us', features: [{ icon: '✦', title: 'Feature', body: 'Description' }], layout: 'row' },
      testimonials: { heading: 'What customers say', items: [{ quote: 'Great product!', author: 'Happy customer' }] },
      richText:     { content: 'Write your story here.' },
      banner:       { text: 'New arrivals are here', ctaLabel: 'Shop now', ctaHref: '/products' },
      newsletter:   { heading: 'Stay in touch', subheading: 'Get updates on new products and offers.', placeholder: 'your@email.com', ctaLabel: 'Subscribe' },
      gallery:      { heading: 'Gallery', images: [] },
      faq:          { heading: 'FAQ', items: [{ question: 'Question?', answer: 'Answer.' }] },
    }
    const newSection = { type, props: defaults[type] ?? {} } as Section
    const updated: ShopManifest = { ...currentManifest, pages: { ...currentManifest.pages, home: [...currentManifest.pages.home, newSection] } }
    setShowSectionPicker(false)
    setCurrentManifest(updated)
    await handleSaveManifest(updated, `Added ${type} section`)
  }

  async function handleDeleteSection(index: number) {
    if (!currentManifest) return
    const sections = currentManifest.pages.home.filter((_, i) => i !== index)
    const updated: ShopManifest = { ...currentManifest, pages: { ...currentManifest.pages, home: sections } }
    setCurrentManifest(updated)
    setEditingSection(null); setSectionDraft(null); setSectionEditMode(null)
    await handleSaveManifest(updated, `Removed section ${index + 1}`)
  }

  async function handleBulkDeleteProducts() {
    if (!currentManifest || selectedProductIds.size === 0) return
    const count = selectedProductIds.size
    if (!confirm(`Delete ${count} product${count > 1 ? 's' : ''}?`)) return
    const updated: ShopManifest = {
      ...currentManifest,
      catalog: { ...currentManifest.catalog, products: currentManifest.catalog.products.filter(p => !selectedProductIds.has(p.id)) },
    }
    setSelectedProductIds(new Set())
    await handleSaveManifest(updated, `Deleted ${count} products`)
  }

  const homeSections = currentManifest?.pages.home ?? []
  const latestVersion = versions[0]

  // Deployment derived state — used in TopBar and panels
  const liveDomain = liveDeployment?.customDomain || deployDomain || liveDeployment?.domain
  const liveUrl = liveDeployment?.customDomain
    ? `https://${liveDeployment.customDomain}`
    : deployUrl || liveDeployment?.url

  // Publish readiness checklist
  const publishChecklist = currentManifest ? [
    { id: 'merchant', label: 'Firemní data (IČO, sídlo, kontakt)', ok: !!(currentManifest.merchant?.ico && currentManifest.merchant?.obchodni_nazev && currentManifest.merchant?.kontakt?.email) },
    { id: 'legal', label: '4 právní stránky v patičce', ok: ['obchodni-podminky', 'ochrana-osobnich-udaju', 'cookies', 'kontakt'].every(slug => currentManifest.customPages?.some(p => p.slug === slug)) },
    { id: 'payment', label: 'Min. 1 platební metoda', ok: !!(currentManifest.payments?.providers?.length || currentManifest.payments?.dobirka?.enabled || currentManifest.payments?.prevod?.enabled) },
    { id: 'shipping', label: 'Min. 1 způsob dopravy', ok: !!(currentManifest.shipping?.methods?.length) },
    { id: 'products', label: 'Min. 1 produkt s cenou a dostupností', ok: currentManifest.catalog.products.length > 0 && currentManifest.catalog.products.every(p => p.price > 0) },
    { id: 'product_images', label: 'Každý produkt má alespoň 1 fotku', ok: currentManifest.catalog.products.length > 0 && currentManifest.catalog.products.every(p => (p.images?.length ?? 0) > 0) },
  ] : []
  const checklistAllOk = publishChecklist.every(c => c.ok)

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

  // Shared eyebrow label style (used in Publish + Theme panels)
  const eyebrowSt: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-geist-mono)',
    textTransform: 'uppercase', letterSpacing: '.07em',
    color: '#5b5b64', marginBottom: 8,
  }

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
          {/* Header */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93' }}>
              {currentManifest.catalog.products.length} products · {currentManifest.catalog.currency}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {selectedProductIds.size > 0 && (
                <button
                  onClick={handleBulkDeleteProducts}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(224,86,79,.4)', background: 'rgba(224,86,79,.1)', color: '#e0564f', cursor: 'pointer' }}
                >
                  <Trash2 size={11} /> Delete {selectedProductIds.size}
                </button>
              )}
              <button
                onClick={() => setProductDraft(emptyProduct())}
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(111,120,230,.4)', background: 'rgba(111,120,230,.1)', color: '#6f78e6', cursor: 'pointer' }}
              >
                <Plus size={11} /> Add product
              </button>
            </div>
          </div>

          {/* List */}
          {currentManifest.catalog.products.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1.5rem', gap: 8 }}>
              <Package size={28} style={{ color: '#5b5b64' }} />
              <p style={{ fontSize: 13, color: '#8a8a93', textAlign: 'center' }}>No products yet.</p>
              <button onClick={() => setProductDraft(emptyProduct())} style={{ fontSize: 12, color: '#6f78e6', background: 'none', border: 'none', cursor: 'pointer' }}>Add your first product →</button>
            </div>
          ) : currentManifest.catalog.products.map(p => {
            const isSelected = selectedProductIds.has(p.id)
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.05)', background: isSelected ? 'rgba(111,120,230,.05)' : 'transparent', transition: 'background 0.1s' }}>
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => setSelectedProductIds(prev => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next })}
                  style={{ width: 14, height: 14, accentColor: '#6f78e6', flexShrink: 0, cursor: 'pointer' }}
                />

                {/* Thumbnail */}
                {p.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.images[0]} alt={p.name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 7, flexShrink: 0, border: '1px solid rgba(255,255,255,.07)' }} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 7, background: 'rgba(255,255,255,.05)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,.07)' }}>
                    <Package size={16} style={{ color: '#5b5b64' }} />
                  </div>
                )}

                {/* Name + price */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: '#f4f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{p.name}</p>
                  <p style={{ fontSize: 11, color: '#8a8a93', marginTop: 2 }}>
                    {currentManifest.catalog.currency} {p.price}
                    {!p.available && <span style={{ marginLeft: 6, color: '#e0564f' }}>· unavailable</span>}
                  </p>
                </div>

                {/* Edit */}
                <button
                  onClick={() => setProductDraft({ id: p.id, name: p.name, description: p.description, price: String(p.price), slug: p.slug, tags: (p.tags ?? []).join(', '), images: p.images, available: p.available })}
                  style={{ fontSize: 11, padding: '5px 9px', borderRadius: 6, border: '1px solid rgba(255,255,255,.09)', background: 'transparent', color: '#8a8a93', cursor: 'pointer', flexShrink: 0 }}
                >
                  Edit
                </button>

                {/* Delete */}
                <button
                  onClick={() => handleProductDelete(p.id)}
                  title="Delete product"
                  style={{ padding: '5px 6px', borderRadius: 5, border: 'none', background: 'none', color: '#5b5b64', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0, transition: 'color 0.12s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#e0564f')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#5b5b64')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </>
      )}
    </div>
  )

  // ── Studio modes (desktop rail) ──────────────────────────────────────────────
  const STUDIO_MODES: { id: DesktopTab; icon: React.ElementType; label: string }[] = [
    { id: 'chat',     icon: MessageCircle, label: 'Chat'     },
    { id: 'sections', icon: Layers,        label: 'Sections' },
    { id: 'products', icon: Package,       label: 'Products' },
    { id: 'theme',    icon: Paintbrush,    label: 'Theme'    },
    { id: 'publish',  icon: Rocket,        label: 'Publish'  },
  ]

  const TopBar = (
    <header style={{
      flexShrink: 0, height: '3rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 0.875rem', gap: 8,
      borderBottom: '1px solid rgba(255,255,255,.07)',
      background: 'rgba(8,8,10,.95)',
      backdropFilter: 'blur(12px)',
    }}>
      {/* Left: breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 0, flex: 1 }}>
        <Link href="/dashboard" style={{
          fontSize: 12, color: '#8a8a93', textDecoration: 'none',
          display: 'flex', alignItems: 'center', gap: 4,
          flexShrink: 0,
          transition: 'color 0.12s',
        }}
          onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = '#f4f4f6'}
          onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = '#8a8a93'}
        >
          ◀ Projects
        </Link>
        <span style={{ fontSize: 12, color: '#5b5b64', padding: '0 6px' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {projectName}
        </span>
      </div>

      {/* Right: controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {/* Version picker */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { const next = !showVersions; setShowVersions(next); if (next) fetchVersions() }}
            style={{
              fontFamily: 'var(--font-geist-mono)', fontSize: 11,
              padding: '4px 8px', borderRadius: 6,
              border: '1px solid rgba(255,255,255,.1)',
              color: '#8a8a93', background: 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {latestVersion ? `v${latestVersion.version_no}` : 'v—'}
            <ChevronDown size={10} />
          </button>

          {showVersions && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowVersions(false)} />
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4,
                width: 290, background: '#0d0d11',
                border: '1px solid rgba(255,255,255,.1)', borderRadius: 10,
                boxShadow: '0 8px 40px rgba(0,0,0,.6)', zIndex: 50, overflow: 'hidden',
              }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
                  <p style={{ fontSize: 10, color: '#8a8a93', textTransform: 'uppercase', letterSpacing: '.05em', fontFamily: 'var(--font-geist-mono)' }}>
                    Version history
                  </p>
                </div>
                <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {versions.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#8a8a93', padding: '12px 14px' }}>No versions yet.</p>
                  ) : versions.map((v) => (
                    <div key={v.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.04)',
                    }}>
                      <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 10, color: '#6f78e6', flexShrink: 0, marginTop: 2 }}>v{v.version_no}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, color: '#f4f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.prompt || 'Generated'}
                        </p>
                        <p style={{ fontSize: 10, color: '#8a8a93', marginTop: 2 }}>{timeAgo(v.created_at)}</p>
                      </div>
                      {versions[0]?.id !== v.id ? (
                        <button onClick={() => handleRestore(v.id)} style={{ fontSize: 11, color: '#6f78e6', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, padding: '2px 0' }}>
                          Restore
                        </button>
                      ) : (
                        <span style={{ fontSize: 10, color: '#5b5b64', flexShrink: 0 }}>current</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Builder / Admin segmented toggle */}
        <div style={{
          display: 'flex', borderRadius: 7,
          border: '1px solid rgba(255,255,255,.1)',
          background: 'rgba(255,255,255,.04)',
          overflow: 'hidden',
        }}>
          <button
            onClick={() => setAdminMode(false)}
            style={{
              fontSize: 11, fontWeight: 500, padding: '4px 10px',
              border: 'none', cursor: 'pointer', transition: 'all 0.12s',
              background: !adminMode ? 'rgba(111,120,230,.18)' : 'transparent',
              color: !adminMode ? '#a8afff' : '#8a8a93',
            }}
          >
            Builder
          </button>
          <button
            onClick={() => setAdminMode(true)}
            style={{
              fontSize: 11, fontWeight: 500, padding: '4px 10px',
              border: 'none', borderLeft: '1px solid rgba(255,255,255,.08)',
              cursor: 'pointer', transition: 'all 0.12s',
              background: adminMode ? 'rgba(111,120,230,.18)' : 'transparent',
              color: adminMode ? '#a8afff' : '#8a8a93',
            }}
          >
            Admin
          </button>
        </div>

        {/* Credit balance */}
        <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, color: '#8a8a93' }}>
          {balance} cr
        </span>

        {/* Export + Live (desktop only) */}
        {isDesktop && (
          <>
            <div style={{ position: 'relative', display: 'flex' }}>
              <button
                onClick={() => handleExport(false)}
                disabled={!currentManifest || isExporting || isExportingAdmin}
                style={{
                  fontSize: 11, fontWeight: 500,
                  padding: '4px 10px', borderRadius: 6,
                  border: '1px solid rgba(255,255,255,.12)',
                  background: 'rgba(255,255,255,.04)',
                  color: currentManifest ? '#f4f4f6' : '#8a8a93',
                  cursor: currentManifest && !isExporting ? 'pointer' : 'not-allowed',
                  opacity: currentManifest ? 1 : 0.4,
                  transition: 'background 0.12s',
                }}
              >
                {isExporting ? '…' : 'Export'}
              </button>
            </div>

            {deployStatus === 'ready' && liveUrl ? (
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                  border: '1px solid rgba(62,207,142,.35)',
                  background: 'rgba(62,207,142,.1)', color: '#3ecf8e',
                  textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#3ecf8e', boxShadow: '0 0 6px rgba(62,207,142,.7)' }} />
                Live ↗
              </a>
            ) : (
              <button
                onClick={handleDeploy}
                disabled={!currentManifest || isDeploying || deployStatus === 'building'}
                style={{
                  fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 6,
                  border: '1px solid rgba(62,207,142,.25)',
                  background: currentManifest && !isDeploying ? 'rgba(62,207,142,.08)' : 'transparent',
                  color: currentManifest && !isDeploying ? '#3ecf8e' : '#8a8a93',
                  cursor: currentManifest && !isDeploying ? 'pointer' : 'not-allowed',
                  opacity: currentManifest ? 1 : 0.4,
                }}
              >
                {isDeploying || deployStatus === 'building' ? '⟳ Deploying' : 'Deploy'}
              </button>
            )}
          </>
        )}
      </div>
    </header>
  )

  const ChatPanel = (
    <>
      {/* ── Messages ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(111,120,230,.15)', border: '1px solid rgba(111,120,230,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <MessageCircle size={15} color="#6f78e6" />
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f6', marginBottom: 4 }}>
              {currentManifest ? `${currentManifest.brand.name} loaded` : 'Describe your store'}
            </p>
            <p style={{ fontSize: 12, color: '#8a8a93', lineHeight: 1.5 }}>
              {currentManifest
                ? 'Tell Quante what to change — copy, colors, sections, products.'
                : 'Brand, products, vibe, currency. Quante builds the rest.'}
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            message={msg}
            onUndo={msg.changeSummary?.prevVersionId ? () => handleRestore(msg.changeSummary!.prevVersionId!) : undefined}
          />
        ))}
        {isGenerating && streamingText && <StreamingView text={streamingText} />}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ───────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, padding: '10px 12px 12px', borderTop: '1px solid rgba(255,255,255,.06)' }}>

        {/* Quick suggestion chips */}
        {currentManifest && !isGenerating && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {QUICK_CHIPS.map(({ label, prompt }) => (
              <button
                key={label}
                onClick={() => { setInput(prompt); setTimeout(() => textareaRef.current?.focus(), 10) }}
                style={{
                  fontSize: 11, padding: '3px 9px', borderRadius: 20,
                  border: '1px solid rgba(255,255,255,.1)',
                  background: 'rgba(255,255,255,.04)',
                  color: '#8a8a93', cursor: 'pointer',
                  transition: 'border-color 0.12s, color 0.12s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f4f4f6'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,.2)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#8a8a93'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,.1)' }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Textarea + send */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            disabled={isGenerating}
            placeholder={!currentManifest ? 'Minimal skincare brand, 3 products, EUR…' : 'Change the accent to deep green…'}
            rows={3}
            style={{
              flex: 1, resize: 'none', fontSize: 13, borderRadius: 8,
              border: '1px solid rgba(255,255,255,.1)',
              background: '#121218',
              color: '#f4f4f6', padding: '8px 10px',
              outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
              opacity: isGenerating ? 0.5 : 1,
              transition: 'border-color 0.12s',
            }}
            onFocus={e => (e.target.style.borderColor = 'rgba(111,120,230,.4)')}
            onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,.1)')}
          />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <button
              onClick={handleSend}
              disabled={isGenerating || !input.trim()}
              style={{
                padding: '8px 14px', fontSize: 13, fontWeight: 600,
                borderRadius: 8, border: 'none',
                cursor: isGenerating || !input.trim() ? 'not-allowed' : 'pointer',
                background: isGenerating || !input.trim() ? 'rgba(255,255,255,.06)' : '#6f78e6',
                color: isGenerating || !input.trim() ? '#8a8a93' : '#fff',
                transition: 'background 0.12s',
              }}
            >
              {isGenerating ? '…' : '→'}
            </button>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', whiteSpace: 'nowrap' }}>
              {!currentManifest ? '10 cr' : '1 cr'}
            </span>
          </div>
        </div>
        <p style={{ fontSize: 10, color: '#5b5b64', marginTop: 5 }}>
          ↵ send · shift+↵ newline
        </p>
      </div>
    </>
  )

  const SectionsPanel = (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {!currentManifest ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '3rem 1.5rem', gap: 8 }}>
          <Layers size={28} style={{ color: '#5b5b64' }} />
          <p style={{ fontSize: 14, color: '#8a8a93', textAlign: 'center' }}>Generate a store first to manage sections.</p>
        </div>
      ) : (
        <>
          {/* Header */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93' }}>
              {homeSections.length} sections
            </span>
            <button
              onClick={() => setShowSectionPicker(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                border: '1px solid rgba(111,120,230,.4)',
                background: 'rgba(111,120,230,.1)', color: '#6f78e6', cursor: 'pointer',
              }}
            >
              <Plus size={11} /> Add section
            </button>
          </div>

          {/* Section list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {homeSections.length === 0 ? (
              <div style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: '#8a8a93' }}>No sections yet.</p>
                <button onClick={() => setShowSectionPicker(true)} style={{ marginTop: 8, fontSize: 12, color: '#6f78e6', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Add your first section →
                </button>
              </div>
            ) : homeSections.map((section, i) => {
              const isHidden = hiddenSections.has(i)
              const isEditingDirect = editingSection === i && sectionEditMode === 'direct'
              const isEditingAI = expandedSection === i && sectionEditMode === 'ai'
              const isDraggingThis = dragIndex === i
              const isDragOver = dragOverIndex === i && dragIndex !== null && dragIndex !== i

              return (
                <div
                  key={i}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={() => { if (dragIndex !== null && dragOverIndex !== null) handleReorderSections(dragIndex, dragOverIndex); setDragIndex(null); setDragOverIndex(null) }}
                  onDragOver={e => { e.preventDefault(); setDragOverIndex(i) }}
                  onDragLeave={() => setDragOverIndex(null)}
                  style={{
                    borderBottom: isDragOver ? '2px solid #6f78e6' : '1px solid rgba(255,255,255,.05)',
                    opacity: isDraggingThis ? 0.4 : isHidden ? 0.45 : 1,
                    background: isDragOver ? 'rgba(111,120,230,.04)' : 'transparent',
                    transition: 'opacity 0.12s, background 0.12s',
                  }}
                >
                  {/* Row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 10px 8px' }}>
                    {/* Drag handle */}
                    <span
                      style={{ color: '#5b5b64', cursor: 'grab', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 2px' }}
                      title="Drag to reorder"
                    >
                      <GripVertical size={14} />
                    </span>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: isHidden ? '#5b5b64' : '#f4f4f6', margin: 0 }}>
                        {SECTION_LABELS[section.type] ?? section.type}
                      </p>
                      <p style={{ fontSize: 11, color: '#8a8a93', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sectionSummary(section)}
                      </p>
                    </div>

                    {/* Controls */}
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      {/* Visibility toggle */}
                      <button
                        onClick={() => setHiddenSections(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next })}
                        title={isHidden ? 'Show section' : 'Hide section'}
                        style={{ padding: '5px 6px', borderRadius: 5, border: 'none', background: 'none', color: isHidden ? '#5b5b64' : '#8a8a93', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      >
                        {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>

                      {/* Edit */}
                      <button
                        onClick={() => {
                          if (isEditingDirect) { setEditingSection(null); setSectionDraft(null); setSectionEditMode(null) }
                          else { setEditingSection(i); setSectionDraft(JSON.parse(JSON.stringify(homeSections[i]))); setSectionEditMode('direct'); setExpandedSection(null); setSectionInput('') }
                        }}
                        style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, border: `1px solid ${isEditingDirect ? 'rgba(111,120,230,.4)' : 'rgba(255,255,255,.09)'}`, background: isEditingDirect ? 'rgba(111,120,230,.12)' : 'transparent', color: isEditingDirect ? '#6f78e6' : '#8a8a93', cursor: 'pointer' }}
                      >
                        Edit
                      </button>

                      {/* AI */}
                      <button
                        onClick={() => {
                          if (isEditingAI) { setExpandedSection(null); setSectionInput(''); setSectionEditMode(null) }
                          else { setExpandedSection(i); setSectionInput(''); setSectionEditMode('ai'); setEditingSection(null); setSectionDraft(null) }
                        }}
                        disabled={isGenerating}
                        style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, border: `1px solid ${isEditingAI ? 'rgba(111,120,230,.4)' : 'rgba(255,255,255,.09)'}`, background: isEditingAI ? 'rgba(111,120,230,.12)' : 'transparent', color: isEditingAI ? '#6f78e6' : '#8a8a93', cursor: isGenerating ? 'not-allowed' : 'pointer', opacity: regeneratingSection === i ? 0.5 : isGenerating ? 0.4 : 1 }}
                      >
                        {regeneratingSection === i ? '…' : 'AI'}
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => { if (confirm(`Remove ${SECTION_LABELS[section.type] ?? section.type}?`)) handleDeleteSection(i) }}
                        title="Remove section"
                        style={{ padding: '5px 6px', borderRadius: 5, border: 'none', background: 'none', color: '#5b5b64', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.12s' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#e0564f')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#5b5b64')}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Direct edit form */}
                  {isEditingDirect && (
                    <div style={{ padding: '0 12px 12px 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {SectionEditFields()}
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <button onClick={handleSectionDirectSave} disabled={isSavingManifest} style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '7px', borderRadius: 6, border: 'none', cursor: isSavingManifest ? 'not-allowed' : 'pointer', background: '#f4f4f6', color: '#08080a', opacity: isSavingManifest ? 0.4 : 1 }}>
                          {isSavingManifest ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => { setEditingSection(null); setSectionDraft(null); setSectionEditMode(null) }} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,.09)', background: 'none', color: '#8a8a93', cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* AI improve form */}
                  {isEditingAI && (
                    <div style={{ padding: '0 12px 12px 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <textarea
                        value={sectionInput}
                        onChange={e => setSectionInput(e.target.value)}
                        placeholder="Describe what to change, or leave blank for auto-improvement"
                        rows={2}
                        autoFocus
                        style={{ width: '100%', resize: 'none', fontSize: 12, borderRadius: 6, border: '1px solid rgba(255,255,255,.09)', background: '#121218', color: '#f4f4f6', padding: '7px 10px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => handleSectionRegenerate(i, sectionInput)} disabled={isGenerating} style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '7px', borderRadius: 6, border: 'none', cursor: isGenerating ? 'not-allowed' : 'pointer', background: '#f4f4f6', color: '#08080a', opacity: isGenerating ? 0.4 : 1 }}>
                          Regenerate
                        </button>
                        <button onClick={() => { setExpandedSection(null); setSectionInput(''); setSectionEditMode(null) }} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,.09)', background: 'none', color: '#8a8a93', cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Section picker modal */}
      {showSectionPicker && (
        <SectionPickerModal
          onPick={handleAddSection}
          onClose={() => setShowSectionPicker(false)}
        />
      )}
    </div>
  )


  // ── Theme mode — direct manifest design-token controls ───────────────────────
  const ThemePanel = currentManifest ? (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Palette */}
      <section>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a8a93', fontFamily: 'var(--font-geist-mono)', marginBottom: 10 }}>Palette</p>
        {([
          { key: 'bg',         label: 'Background'  },
          { key: 'surface',    label: 'Surface'     },
          { key: 'text',       label: 'Text'        },
          { key: 'accent',     label: 'Accent'      },
          { key: 'accentText', label: 'Accent text' },
          { key: 'muted',      label: 'Muted'       },
          { key: 'border',     label: 'Border'      },
        ] as { key: keyof ShopManifest['design']['palette']; label: string }[]).map(({ key, label }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <input
              type="color"
              value={currentManifest.design.palette[key].startsWith('#') ? currentManifest.design.palette[key] : '#888888'}
              onChange={(e) => {
                const updated: ShopManifest = {
                  ...currentManifest,
                  design: { ...currentManifest.design, palette: { ...currentManifest.design.palette, [key]: e.target.value } },
                }
                setCurrentManifest(updated)
              }}
              onBlur={() => {
                if (currentManifest) handleSaveManifest(currentManifest, `Theme: ${key}`)
              }}
              style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', cursor: 'pointer', padding: 2, background: 'transparent', flexShrink: 0 }}
            />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 12, color: '#f4f4f6' }}>{label}</p>
              <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93' }}>{currentManifest.design.palette[key]}</p>
            </div>
          </div>
        ))}
      </section>

      {/* Typography scale */}
      <section>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a8a93', fontFamily: 'var(--font-geist-mono)', marginBottom: 10 }}>Typography</p>
        <label style={{ fontSize: 12, color: '#8a8a93', display: 'block', marginBottom: 4 }}>Scale</label>
        <select
          value={currentManifest.design.typography.scale}
          onChange={async (e) => {
            const updated: ShopManifest = { ...currentManifest, design: { ...currentManifest.design, typography: { ...currentManifest.design.typography, scale: e.target.value as ShopManifest['design']['typography']['scale'] } } }
            setCurrentManifest(updated)
            await handleSaveManifest(updated, 'Theme: scale')
          }}
          style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: '#121218', color: '#f4f4f6', outline: 'none' }}
        >
          {['compact', 'comfortable', 'spacious'].map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
        </select>
      </section>

      {/* Shape & feel */}
      <section>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a8a93', fontFamily: 'var(--font-geist-mono)', marginBottom: 10 }}>Shape & Feel</p>
        {([
          { key: 'radius',  label: 'Radius',  opts: ['none', 'sm', 'md', 'lg', 'full'] },
          { key: 'density', label: 'Density', opts: ['tight', 'normal', 'airy'] },
          { key: 'motion',  label: 'Motion',  opts: ['none', 'subtle', 'expressive'] },
        ] as { key: 'radius' | 'density' | 'motion'; label: string; opts: string[] }[]).map(({ key, label, opts }) => (
          <div key={key} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: '#8a8a93', display: 'block', marginBottom: 4 }}>{label}</label>
            <select
              value={currentManifest.design[key]}
              onChange={async (e) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const updated: ShopManifest = { ...currentManifest, design: { ...currentManifest.design, [key]: e.target.value as any } }
                setCurrentManifest(updated)
                await handleSaveManifest(updated, `Theme: ${key}`)
              }}
              style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: '#121218', color: '#f4f4f6', outline: 'none' }}
            >
              {opts.map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
            </select>
          </div>
        ))}
      </section>

      {isSavingManifest && (
        <p style={{ fontSize: 11, color: '#8a8a93', textAlign: 'center', fontFamily: 'var(--font-geist-mono)', marginTop: 4 }}>Saving…</p>
      )}
    </div>
  ) : (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ fontSize: 12, color: '#8a8a93' }}>Generate a store to unlock Theme controls.</p>
    </div>
  )

  const PublishPanel = (
    <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── 1. Checklist ─────────────────────────────────────────────────────── */}
      {publishChecklist.length > 0 && (
        <section>
          <p style={eyebrowSt}>{checklistAllOk ? 'Ready to publish' : 'Complete before publishing'}</p>
          <div style={{
            borderRadius: 10,
            border: `1px solid ${checklistAllOk ? 'rgba(62,207,142,.25)' : 'rgba(224,160,79,.25)'}`,
            background: checklistAllOk ? 'rgba(62,207,142,.04)' : 'rgba(224,160,79,.04)',
            padding: '12px 14px',
            display: 'flex', flexDirection: 'column', gap: 7,
          }}>
            {publishChecklist.map((item) => {
              const fixMode: Record<string, DesktopTab | null> = {
                products: 'products',
                product_images: 'products',
                merchant: 'publish',
                legal: 'publish',
                payment: 'publish',
                shipping: 'publish',
              }
              const mode = fixMode[item.id] ?? null
              return (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flexShrink: 0, fontSize: 13, lineHeight: 1, color: item.ok ? 'var(--live)' : '#e0564f' }}>
                    {item.ok ? '✓' : '✗'}
                  </span>
                  <span style={{ flex: 1, fontSize: 12, color: item.ok ? '#f4f4f6' : '#8a8a93', lineHeight: 1.4 }}>
                    {item.label}
                  </span>
                  {!item.ok && mode && (
                    <button
                      onClick={() => { setDesktopTab(mode); setActiveTab(mode) }}
                      style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#6f78e6', background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
                    >
                      Fix →
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── 2. Deploy / Live status ──────────────────────────────────────────── */}
      <section>
        <p style={eyebrowSt}>Deploy</p>
        {(deployStatus === 'ready' || liveDeployment?.status === 'ready') && liveUrl ? (
          /* Live card */
          <div style={{ borderRadius: 10, border: '1px solid rgba(62,207,142,.25)', background: 'rgba(62,207,142,.05)', padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--live)', boxShadow: '0 0 8px rgba(62,207,142,.6)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--live)' }}>Live</span>
            </div>
            <p style={{ fontSize: 13, fontFamily: 'var(--font-geist-mono)', color: '#f4f4f6', wordBreak: 'break-all', marginBottom: 12 }}>
              {liveDomain ?? liveUrl}
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '8px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'var(--live)', color: '#000', textDecoration: 'none', textAlign: 'center' }}
              >
                Visit store ↗
              </a>
              <button
                onClick={() => navigator.clipboard.writeText(liveUrl ?? '')}
                style={{ fontSize: 12, padding: '8px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', background: 'transparent', color: '#8a8a93', cursor: 'pointer' }}
              >
                Copy
              </button>
              <button
                onClick={handleDeploy}
                disabled={isDeploying || !currentManifest}
                title="Redeploy latest changes"
                style={{ fontSize: 12, padding: '8px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', background: 'transparent', color: '#8a8a93', cursor: isDeploying ? 'not-allowed' : 'pointer', opacity: isDeploying ? 0.5 : 1 }}
              >
                {isDeploying ? '…' : '⟳'}
              </button>
            </div>
          </div>
        ) : deployStatus === 'building' || liveDeployment?.status === 'building' ? (
          /* Building card */
          <div style={{ borderRadius: 10, border: '1px solid rgba(224,160,79,.2)', background: 'rgba(224,160,79,.05)', padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(224,160,79,.35)', borderTopColor: '#e0a04f', animation: 'spin 0.9s linear infinite', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: '#e0a04f' }}>Building — check back in a minute</span>
            </div>
            {liveDeployment?.domain && (
              <p style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', marginTop: 4 }}>
                Will be live at: {liveDeployment.domain}
              </p>
            )}
          </div>
        ) : (
          /* Not deployed yet */
          <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>Deploy to Quante hosting</p>
            <p style={{ fontSize: 12, color: '#8a8a93', lineHeight: 1.5, margin: 0 }}>
              Your store goes live on a <span style={{ fontFamily: 'var(--font-geist-mono)' }}>.quante.app</span> subdomain. Connect a custom domain after.
            </p>
            {!hostingInfo.subscribed && !hostingInfo.trialEndsAt && (
              <p style={{ fontSize: 11, color: '#e0a04f', margin: 0 }}>Starts your 30-day free trial.</p>
            )}
            <button
              onClick={handleDeploy}
              disabled={!currentManifest || isDeploying || !checklistAllOk}
              style={{
                width: '100%', padding: '9px', fontSize: 13, fontWeight: 600, borderRadius: 7, border: 'none',
                cursor: !currentManifest || isDeploying || !checklistAllOk ? 'not-allowed' : 'pointer',
                background: checklistAllOk ? 'var(--live)' : 'rgba(255,255,255,.06)',
                color: checklistAllOk ? '#000' : '#5b5b64',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {!currentManifest ? 'Generate a store first' : !checklistAllOk ? 'Complete checklist to deploy' : isDeploying ? '⟳ Deploying…' : 'Deploy store'}
            </button>
          </div>
        )}
      </section>

      {/* ── 3. Custom domain ─────────────────────────────────────────────────── */}
      {(deployStatus === 'ready' || liveDeployment?.status === 'ready') && (
        <section>
          <p style={eyebrowSt}>Custom domain</p>
          <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {liveDeployment?.customDomain && !domainResult && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 7, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)' }}>
                <span style={{ fontSize: 10, color: liveDeployment.customDomainVerified ? 'var(--live)' : '#e0a04f' }}>
                  {liveDeployment.customDomainVerified ? '✓' : '⚠'}
                </span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono)', color: '#f4f4f6', flex: 1 }}>
                  {liveDeployment.customDomain}
                </span>
                <span style={{ fontSize: 10, color: liveDeployment.customDomainVerified ? 'var(--live)' : '#e0a04f' }}>
                  {liveDeployment.customDomainVerified ? 'active' : 'pending DNS'}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={customDomainInput}
                onChange={e => setCustomDomainInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddDomain()}
                placeholder="yourdomain.com"
                style={{ flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', background: '#121218', color: '#f4f4f6', outline: 'none', fontFamily: 'var(--font-geist-mono)' }}
              />
              <button
                onClick={handleAddDomain}
                disabled={isAddingDomain || !customDomainInput.trim()}
                style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 7, border: 'none', cursor: isAddingDomain || !customDomainInput.trim() ? 'not-allowed' : 'pointer', background: '#6f78e6', color: '#fff', opacity: isAddingDomain || !customDomainInput.trim() ? 0.5 : 1, flexShrink: 0 }}
              >
                {isAddingDomain ? '…' : 'Connect'}
              </button>
            </div>
            {domainResult && (
              <div style={{ borderRadius: 8, background: domainResult.verified ? 'rgba(62,207,142,.07)' : 'rgba(111,120,230,.07)', border: `1px solid ${domainResult.verified ? 'rgba(62,207,142,.2)' : 'rgba(111,120,230,.2)'}`, padding: '10px 12px' }}>
                {domainResult.verified ? (
                  <p style={{ fontSize: 11, color: 'var(--live)', fontWeight: 600, margin: 0 }}>✓ Domain verified and live!</p>
                ) : (
                  <>
                    <p style={{ fontSize: 11, fontWeight: 600, color: '#f4f4f6', marginBottom: 6 }}>Add this DNS record:</p>
                    <div style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, background: 'rgba(0,0,0,.3)', borderRadius: 6, padding: '8px 10px', color: '#a5b4fc', marginBottom: 8 }}>
                      {domainResult.dnsInstructions ?? `CNAME  ${domainResult.domain}  →  cname.vercel-dns.com`}
                    </div>
                    <p style={{ fontSize: 10, color: '#8a8a93', lineHeight: 1.5, margin: 0 }}>
                      DNS changes can take up to 48h. Click Connect again to re-check.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── 4. Export ────────────────────────────────────────────────────────── */}
      <section>
        <p style={eyebrowSt}>Export</p>
        <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 12, color: '#8a8a93', lineHeight: 1.5, margin: 0 }}>
            Download your store as a standalone Next.js project. Runs with <span style={{ fontFamily: 'var(--font-geist-mono)', color: '#f4f4f6' }}>npm install && npm run dev</span> — deploy anywhere.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => handleExport(false)}
              disabled={!currentManifest || isExporting}
              style={{
                flex: 1, fontSize: 12, fontWeight: 600, padding: '8px', borderRadius: 7,
                border: '1px solid rgba(255,255,255,.09)', background: 'transparent',
                color: currentManifest && !isExporting ? '#f4f4f6' : '#5b5b64',
                cursor: currentManifest && !isExporting ? 'pointer' : 'not-allowed',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => { if (currentManifest && !isExporting) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.06)' }}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
            >
              {isExporting ? '…' : '↓ ZIP'} <span style={{ fontSize: 10, color: '#5b5b64', marginLeft: 4, fontFamily: 'var(--font-geist-mono)' }}>5 cr</span>
            </button>
            <button
              onClick={() => handleExport(true)}
              disabled={!currentManifest || isExportingAdmin}
              style={{
                flex: 1, fontSize: 12, fontWeight: 600, padding: '8px', borderRadius: 7,
                border: '1px solid rgba(111,120,230,.3)', background: 'rgba(111,120,230,.07)',
                color: currentManifest && !isExportingAdmin ? '#6f78e6' : '#5b5b64',
                cursor: currentManifest && !isExportingAdmin ? 'pointer' : 'not-allowed',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => { if (currentManifest && !isExportingAdmin) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(111,120,230,.13)' }}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(111,120,230,.07)'}
            >
              {isExportingAdmin ? '…' : '↓ ZIP + Admin'} <span style={{ fontSize: 10, color: '#5b5b64', marginLeft: 4, fontFamily: 'var(--font-geist-mono)' }}>5 cr</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── 5. Earnings ──────────────────────────────────────────────────────── */}
      <section>
        <p style={eyebrowSt}>Earnings <span style={{ color: '#5b5b64', marginLeft: 4 }}>5% platform fee</span></p>
        <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, background: '#121218', borderRadius: 8, padding: '10px 12px' }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Available</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--live)', fontFamily: 'var(--font-geist-mono)', margin: 0 }}>
                {earnings ? `€${earnings.available.toFixed(2)}` : '—'}
              </p>
            </div>
            <div style={{ flex: 1, background: '#121218', borderRadius: 8, padding: '10px 12px' }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Sales</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: '#f4f4f6', fontFamily: 'var(--font-geist-mono)', margin: 0 }}>
                {earnings ? String(earnings.saleCount) : '—'}
              </p>
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#f4f4f6', marginBottom: 8 }}>Payout account</p>
            <input
              value={holderInput}
              onChange={e => setHolderInput(e.target.value)}
              placeholder="Account holder name"
              style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', background: '#121218', color: '#f4f4f6', outline: 'none', marginBottom: 6, boxSizing: 'border-box' }}
            />
            <input
              value={ibanInput}
              onChange={e => setIbanInput(e.target.value)}
              placeholder="IBAN (e.g. CZ65 0800 0000 1920 0014 5399)"
              style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', background: '#121218', color: '#f4f4f6', outline: 'none', marginBottom: 8, boxSizing: 'border-box', fontFamily: 'var(--font-geist-mono)' }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={handleSaveIban}
                disabled={isSavingIban || !ibanInput.trim() || !holderInput.trim()}
                style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', cursor: isSavingIban ? 'not-allowed' : 'pointer', background: 'transparent', color: '#f4f4f6', opacity: isSavingIban ? 0.5 : 1 }}
              >
                {isSavingIban ? '…' : payoutAccount?.iban ? 'Update IBAN' : 'Save IBAN'}
              </button>
              {payoutAccount?.iban && (earnings?.available ?? 0) > 0 && (
                <button
                  onClick={handleRequestPayout}
                  disabled={isRequestingPayout}
                  style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', cursor: isRequestingPayout ? 'not-allowed' : 'pointer', background: '#6f78e6', color: '#fff', opacity: isRequestingPayout ? 0.5 : 1 }}
                >
                  {isRequestingPayout ? '…' : 'Request payout'}
                </button>
              )}
            </div>
            {payoutMsg && (
              <p style={{ fontSize: 11, marginTop: 8, color: payoutMsg.startsWith('Payout') ? 'var(--live)' : '#f87171', lineHeight: 1.5, margin: '8px 0 0' }}>
                {payoutMsg}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── 6. Hosting plan ──────────────────────────────────────────────────── */}
      <section>
        <p style={eyebrowSt}>Hosting</p>
        <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', padding: '14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hostingInfo.subscribed ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--live)', boxShadow: '0 0 8px rgba(62,207,142,.6)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6' }}>Active — €99/year</span>
              </div>
              {hostingInfo.subscriptionEndsAt && (
                <p style={{ fontSize: 11, color: '#8a8a93', margin: 0 }}>
                  {hostingInfo.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {new Date(hostingInfo.subscriptionEndsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
            </>
          ) : hostingInfo.trialEndsAt ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: trialExpired ? '#e0564f' : '#e0a04f', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: trialExpired ? '#e0564f' : '#e0a04f' }}>
                  {trialExpired ? 'Free trial ended' : `Free trial · ${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left`}
                </span>
              </div>
              <button
                onClick={handleHostingSubscribe}
                disabled={isSubscribing}
                style={{ width: '100%', padding: '8px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', cursor: isSubscribing ? 'not-allowed' : 'pointer', background: '#6f78e6', color: '#fff', opacity: isSubscribing ? 0.6 : 1 }}
              >
                {isSubscribing ? '…' : 'Subscribe · €99/year'}
              </button>
            </>
          ) : (
            <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>Deploy your store to start your 30-day free trial.</p>
          )}
        </div>
      </section>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )


  const DEVICE_WIDTHS: Record<'desktop' | 'tablet' | 'mobile', number | null> = {
    desktop: null, tablet: 768, mobile: 390,
  }

  const PreviewPane = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#09090c', overflow: 'hidden', minWidth: 0 }}>
      {/* Toolbar */}
      <div style={{
        flexShrink: 0, height: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 10px',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        background: '#0d0d11',
      }}>
        {/* Device selector */}
        <div style={{ display: 'flex', gap: 2 }}>
          {([
            { id: 'desktop', icon: Monitor  },
            { id: 'tablet',  icon: Tablet   },
            { id: 'mobile',  icon: Smartphone },
          ] as { id: typeof previewDevice; icon: React.ElementType }[]).map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => setPreviewDevice(id)} style={{
              width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: previewDevice === id ? 'rgba(255,255,255,.1)' : 'transparent',
              color: previewDevice === id ? '#f4f4f6' : '#5b5b64',
              transition: 'background 0.12s, color 0.12s',
            }}>
              <Icon size={13} />
            </button>
          ))}
        </div>

        {/* URL + controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {liveUrl && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {liveDomain ?? liveUrl}
            </span>
          )}
          {latestVersion && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64' }}>
              v{latestVersion.version_no}
            </span>
          )}
          <button onClick={() => setIframeKey((k) => k + 1)} title="Refresh" style={{ width: 24, height: 24, borderRadius: 5, border: 'none', cursor: 'pointer', background: 'transparent', color: '#5b5b64', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RotateCcw size={11} />
          </button>
          <a href={`/preview/${projectId}`} target="_blank" rel="noopener noreferrer" title="Open in new tab" style={{ width: 24, height: 24, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5b5b64', textDecoration: 'none' }}>
            <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* Preview area */}
      <div style={{
        flex: 1, position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      }}>
        {!currentManifest ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
            <div>
              <p style={{ color: 'rgba(255,255,255,.18)', fontSize: 13, fontFamily: 'var(--font-geist-mono)', marginBottom: 6 }}>no preview yet</p>
              <p style={{ color: 'rgba(255,255,255,.1)', fontSize: 11 }}>Describe a store to get started</p>
            </div>
          </div>
        ) : previewDevice === 'desktop' ? (
          <iframe
            ref={iframeRef}
            key={iframeKey}
            src={`/preview/${projectId}`}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Store preview"
            onLoad={handleIframeLoad}
          />
        ) : (
          <div style={{
            marginTop: 16,
            width: DEVICE_WIDTHS[previewDevice]!,
            height: previewDevice === 'tablet' ? 900 : 780,
            flexShrink: 0,
            borderRadius: previewDevice === 'tablet' ? 14 : 20,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,.12)',
            boxShadow: '0 4px 40px rgba(0,0,0,.6)',
            transform: previewDevice === 'tablet' ? 'scale(0.55)' : 'scale(0.72)',
            transformOrigin: 'top center',
          }}>
            <iframe
              ref={iframeRef}
              key={iframeKey}
              src={`/preview/${projectId}`}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title="Store preview"
              onLoad={handleIframeLoad}
            />
          </div>
        )}

        {(isGenerating || isDeploying) && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(6px)',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                border: '2px solid rgba(255,255,255,.1)', borderTopColor: '#6f78e6',
                animation: 'spin 0.7s linear infinite', margin: '0 auto 10px',
              }} />
              <p style={{ fontSize: 11, color: '#8a8a93', fontFamily: 'var(--font-geist-mono)' }}>
                {isDeploying ? 'deploying…' : 'generating…'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  // ── Admin panel ──────────────────────────────────────────────────────────────
  const productCount = currentManifest?.catalog.products.length ?? 0
  const sectionCount = currentManifest?.pages.home.length ?? 0
  const currency = currentManifest?.catalog.currency ?? 'CZK'

  const ADMIN_TABS: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'orders',    label: 'Orders',    icon: ClipboardList   },
    { id: 'products',  label: 'Products',  icon: ShoppingBag     },
    { id: 'settings',  label: 'Settings',  icon: Settings2       },
  ]

  const AdminDashboard = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 680 }}>

      {/* Store live banner */}
      {liveUrl ? (
        <div style={{ borderRadius: 12, border: '1px solid rgba(62,207,142,.25)', background: 'rgba(62,207,142,.05)', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--live)', boxShadow: '0 0 8px rgba(62,207,142,.6)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--live)', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 2px' }}>Store live</p>
              <p style={{ fontSize: 13, fontFamily: 'var(--font-geist-mono)', color: '#f4f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                {liveDomain ?? liveUrl}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => navigator.clipboard.writeText(liveUrl ?? '')}
              title="Copy link"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.09)', background: 'transparent', color: '#8a8a93', cursor: 'pointer' }}
            >
              <Share2 size={11} /> Share
            </button>
            <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 6, background: 'var(--live)', color: '#000', textDecoration: 'none' }}>
              Visit ↗
            </a>
          </div>
        </div>
      ) : (
        <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.07)', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', margin: '0 0 2px' }}>Store not live yet</p>
            <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>Deploy in the Builder to go live and start selling.</p>
          </div>
          <button onClick={() => setAdminMode(false)} style={{ fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 6, border: 'none', background: '#6f78e6', color: '#fff', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
            Go to Builder
          </button>
        </div>
      )}

      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        {[
          { label: 'Revenue', value: orderRevenue > 0 ? `${currency} ${orderRevenue.toFixed(2)}` : null, empty: 'No sales yet', icon: TrendingUp, color: 'var(--live)' },
          { label: 'Orders',  value: orders.length > 0 ? String(orders.length) : null, empty: '0', icon: ClipboardList, color: '#e0a04f' },
          { label: 'Products', value: productCount > 0 ? String(productCount) : null, empty: '0', icon: ShoppingBag, color: '#6f78e6' },
        ].map(({ label, value, empty, icon: Icon, color }) => (
          <div key={label} style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', background: '#0d0d11', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <p style={{ fontSize: 11, color: '#8a8a93', margin: 0 }}>{label}</p>
              <Icon size={13} style={{ color: '#5b5b64' }} />
            </div>
            {value ? (
              <p style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--font-geist-mono)', margin: 0 }}>{value}</p>
            ) : (
              <p style={{ fontSize: 13, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)', margin: 0 }}>{empty}</p>
            )}
          </div>
        ))}
      </div>

      {/* Orders empty state — shown prominently when no orders yet */}
      {orders.length === 0 && !ordersError && liveUrl && (
        <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.07)', padding: '24px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <ClipboardList size={32} style={{ color: '#5b5b64' }} />
          <p style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>No orders yet</p>
          <p style={{ fontSize: 13, color: '#8a8a93', margin: 0, lineHeight: 1.5, maxWidth: 320 }}>
            Share your store link to make your first sale. Orders appear here automatically.
          </p>
          <button
            onClick={() => navigator.clipboard.writeText(liveUrl ?? '')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 7, border: '1px solid rgba(62,207,142,.35)', background: 'rgba(62,207,142,.08)', color: 'var(--live)', cursor: 'pointer' }}
          >
            <Share2 size={13} /> Copy store link
          </button>
        </div>
      )}

      {/* Hosting */}
      <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <p style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 6px' }}>Hosting</p>
          {hostingInfo.subscribed ? (
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--live)', margin: 0 }}>● Active — €99/year</p>
          ) : hostingInfo.trialEndsAt ? (
            <p style={{ fontSize: 13, fontWeight: 500, color: trialExpired ? '#e0564f' : '#e0a04f', margin: 0 }}>
              ● {trialExpired ? 'Trial ended' : `Free trial · ${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left`}
            </p>
          ) : (
            <p style={{ fontSize: 13, color: '#8a8a93', margin: 0 }}>Not deployed</p>
          )}
        </div>
        {!hostingInfo.subscribed && hostingInfo.trialEndsAt && (
          <button onClick={handleHostingSubscribe} disabled={isSubscribing} style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 6, border: 'none', background: '#6f78e6', color: '#fff', cursor: 'pointer', opacity: isSubscribing ? 0.6 : 1, flexShrink: 0 }}>
            {isSubscribing ? '…' : 'Subscribe · €99/year'}
          </button>
        )}
      </div>

      {/* Quick actions */}
      <div>
        <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>Quick actions</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { label: 'View orders', sub: 'Revenue + order history', action: () => { setAdminTab('orders'); handleLoadOrders() }, icon: ClipboardList },
            { label: 'Products', sub: 'Inventory management', action: () => setAdminTab('products'), icon: ShoppingBag },
            { label: 'Settings', sub: 'Stripe, domain, keys', action: () => setAdminTab('settings'), icon: Settings2 },
            { label: 'AI Builder', sub: 'Edit design + content', action: () => setAdminMode(false), icon: Paintbrush },
          ].map(({ label, sub, action, icon: Icon }) => (
            <button key={label} onClick={action} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', background: 'transparent', color: '#f4f4f6', cursor: 'pointer', textAlign: 'left', transition: 'background 0.12s' }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.04)'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
            >
              <Icon size={16} style={{ color: '#8a8a93' }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px' }}>{label}</p>
                <p style={{ fontSize: 11, color: '#8a8a93', margin: 0 }}>{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  const AdminOrders = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      {ordersError === 'no_key' ? (
        /* No Stripe key */
        <div style={{ borderRadius: 12, border: '1px solid rgba(111,120,230,.25)', background: 'rgba(111,120,230,.05)', padding: '28px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
          <Settings2 size={32} style={{ color: '#5b5b64' }} />
          <p style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>Connect your Stripe account</p>
          <p style={{ fontSize: 13, color: '#8a8a93', lineHeight: 1.6, maxWidth: 320, margin: 0 }}>
            Add your store&apos;s Stripe secret key in Settings to view orders and revenue here.
          </p>
          <button onClick={() => setAdminTab('settings')} style={{ fontSize: 12, fontWeight: 600, padding: '8px 20px', borderRadius: 7, border: 'none', background: '#6f78e6', color: '#fff', cursor: 'pointer' }}>
            Go to Settings
          </button>
        </div>
      ) : isLoadingOrders ? (
        /* Loading skeleton */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: 56, borderRadius: 8, background: 'rgba(255,255,255,.04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
        </div>
      ) : ordersError ? (
        /* Error */
        <div style={{ borderRadius: 10, border: '1px solid rgba(224,86,79,.25)', background: 'rgba(224,86,79,.05)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <p style={{ fontSize: 13, color: '#f87171', margin: 0 }}>{ordersError}</p>
          <button onClick={handleLoadOrders} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(224,86,79,.3)', background: 'transparent', color: '#f87171', cursor: 'pointer', flexShrink: 0 }}>Retry</button>
        </div>
      ) : orders.length === 0 ? (
        /* Empty state */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.07)', padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            <ClipboardList size={36} style={{ color: '#5b5b64' }} />
            <p style={{ fontSize: 16, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>No orders yet</p>
            <p style={{ fontSize: 13, color: '#8a8a93', lineHeight: 1.55, maxWidth: 300, margin: 0 }}>
              Share your store link to make your first sale — orders appear here automatically.
            </p>
            {liveUrl && (
              <button
                onClick={() => navigator.clipboard.writeText(liveUrl ?? '')}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 7, border: '1px solid rgba(62,207,142,.3)', background: 'rgba(62,207,142,.07)', color: 'var(--live)', cursor: 'pointer' }}
              >
                <Share2 size={13} /> Copy store link
              </button>
            )}
          </div>
          <button onClick={handleLoadOrders} style={{ alignSelf: 'center', fontSize: 11, color: '#8a8a93', background: 'none', border: 'none', cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      ) : (
        /* Orders table */
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ borderRadius: 10, border: '1px solid rgba(62,207,142,.2)', background: 'rgba(62,207,142,.04)', padding: '14px 16px' }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Revenue</p>
              <p style={{ fontSize: 24, fontWeight: 700, color: 'var(--live)', fontFamily: 'var(--font-geist-mono)', margin: 0 }}>
                {currency} {orderRevenue.toFixed(2)}
              </p>
            </div>
            <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', background: '#0d0d11', padding: '14px 16px' }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Orders</p>
              <p style={{ fontSize: 24, fontWeight: 700, color: '#f4f4f6', fontFamily: 'var(--font-geist-mono)', margin: 0 }}>{orders.length}</p>
            </div>
          </div>

          {/* Table */}
          <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 12, padding: '9px 16px', borderBottom: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.02)' }}>
              {['Customer', 'Items', 'Amount', 'Date'].map(h => (
                <p key={h} style={{ fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.06em', margin: 0 }}>{h}</p>
              ))}
            </div>
            {orders.map((o, idx) => (
              <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 12, padding: '12px 16px', borderBottom: idx < orders.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none', alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: '#f4f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                    {o.customerName !== '—' ? o.customerName : o.customerEmail}
                  </p>
                  {o.customerName !== '—' && (
                    <p style={{ fontSize: 11, color: '#8a8a93', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '2px 0 0' }}>{o.customerEmail}</p>
                  )}
                </div>
                <p style={{ fontSize: 11, color: '#8a8a93', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                  {o.items.map(i => `${i.qty}× ${i.name}`).join(', ') || '—'}
                </p>
                <p style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-geist-mono)', color: 'var(--live)', whiteSpace: 'nowrap', margin: 0 }}>
                  {o.amount.toFixed(2)} {o.currency}
                </p>
                <p style={{ fontSize: 11, color: '#8a8a93', whiteSpace: 'nowrap', fontFamily: 'var(--font-geist-mono)', margin: 0 }}>
                  {new Date(o.createdAt).toLocaleDateString('en-GB')}
                </p>
              </div>
            ))}
          </div>

          <button onClick={handleLoadOrders} style={{ alignSelf: 'flex-start', fontSize: 11, color: '#8a8a93', background: 'none', border: 'none', cursor: 'pointer' }}>↻ Refresh</button>
        </>
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
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>

      {/* Stripe */}
      <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.07)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.02)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Settings2 size={14} style={{ color: '#8a8a93' }} />
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>Stripe keys — your store</p>
            <p style={{ fontSize: 11, color: '#8a8a93', margin: '2px 0 0' }}>These are your shop&apos;s Stripe keys, not Quante&apos;s. Saved keys are pushed to your live store automatically.</p>
          </div>
        </div>
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: '#8a8a93', display: 'block', marginBottom: 5, fontFamily: 'var(--font-geist-mono)' }}>Publishable key (pk_live_…)</label>
            <input value={settingsPubKey} onChange={e => setSettingsPubKey(e.target.value)} placeholder="pk_live_..." style={inpSt} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#8a8a93', display: 'block', marginBottom: 5, fontFamily: 'var(--font-geist-mono)' }}>
              Secret key (sk_live_…)
              {settingsSecKeySet && <span style={{ color: 'var(--live)', marginLeft: 8 }}>✓ set</span>}
            </label>
            <input type="password" value={settingsSecKey} onChange={e => setSettingsSecKey(e.target.value)} placeholder={settingsSecKeySet ? '••••••••••••••••••••••••' : 'sk_live_...'} style={inpSt} />
          </div>
          <button
            onClick={handleSaveSettings}
            disabled={isSavingSettings || (!settingsPubKey && !settingsSecKey)}
            style={{ width: '100%', padding: '9px', fontSize: 13, fontWeight: 600, borderRadius: 7, border: 'none', cursor: isSavingSettings ? 'not-allowed' : 'pointer', background: '#6f78e6', color: '#fff', opacity: isSavingSettings || (!settingsPubKey && !settingsSecKey) ? 0.5 : 1 }}
          >
            {isSavingSettings ? 'Saving…' : 'Save & push to store'}
          </button>
        </div>
      </div>

      {/* Custom domain */}
      <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.07)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.02)' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>Custom domain</p>
          <p style={{ fontSize: 11, color: '#8a8a93', margin: '2px 0 0' }}>Connect your own domain. Works with any registrar — just add a CNAME record.</p>
        </div>
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {liveDeployment?.customDomain && !domainResult && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 7, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)' }}>
              <span style={{ fontSize: 11, color: liveDeployment.customDomainVerified ? 'var(--live)' : '#e0a04f' }}>
                {liveDeployment.customDomainVerified ? '✓' : '⚠'}
              </span>
              <span style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-geist-mono)', color: '#f4f4f6' }}>{liveDeployment.customDomain}</span>
              <span style={{ fontSize: 10, color: liveDeployment.customDomainVerified ? 'var(--live)' : '#e0a04f' }}>
                {liveDeployment.customDomainVerified ? 'active' : 'pending DNS'}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={customDomainInput} onChange={e => setCustomDomainInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddDomain()} placeholder="yourdomain.com" style={{ ...inpSt, flex: 1 }} />
            <button onClick={handleAddDomain} disabled={isAddingDomain || !customDomainInput.trim()} style={{ fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', background: '#6f78e6', color: '#fff', opacity: isAddingDomain || !customDomainInput.trim() ? 0.5 : 1, flexShrink: 0 }}>
              {isAddingDomain ? '…' : 'Connect'}
            </button>
          </div>
          {domainResult && (
            <div style={{ borderRadius: 8, background: domainResult.verified ? 'rgba(62,207,142,.07)' : 'rgba(111,120,230,.07)', border: `1px solid ${domainResult.verified ? 'rgba(62,207,142,.2)' : 'rgba(111,120,230,.2)'}`, padding: '10px 12px' }}>
              {domainResult.verified ? (
                <p style={{ fontSize: 12, color: 'var(--live)', fontWeight: 600, margin: 0 }}>✓ Domain connected and live!</p>
              ) : (
                <>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#f4f4f6', marginBottom: 6 }}>Add this DNS record at your registrar:</p>
                  <div style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, background: 'rgba(0,0,0,.3)', borderRadius: 6, padding: '8px 10px', color: '#a5b4fc', marginBottom: 6 }}>
                    {domainResult.dnsInstructions ?? `CNAME  @  →  cname.vercel-dns.com`}
                  </div>
                  <p style={{ fontSize: 10, color: '#8a8a93', margin: 0 }}>DNS changes can take up to 48 hours. Click Connect again to re-check.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  // Admin panel layout (full-screen, no preview pane)
  // Visually distinct from Builder: green accent on sidebar + green header underline
  const ADMIN_ACCENT = 'var(--live)' // #3ecf8e
  const ADMIN_ACCENT_BG = 'rgba(62,207,142,.1)'
  const ADMIN_ACCENT_BORDER = 'rgba(62,207,142,.25)'

  if (adminMode) {
    return (
      <div style={{ position: 'fixed', top: '3rem', left: 0, right: 0, bottom: 0, zIndex: 30, display: 'flex', flexDirection: 'column', background: '#08080a' }}>
        {/* Admin-tinted TopBar: same as builder but with green bottom accent line */}
        <div style={{ position: 'relative' }}>
          {TopBar}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: ADMIN_ACCENT, opacity: 0.35 }} />
        </div>

        {isDesktop ? (
          // Desktop: sidebar + content
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            {/* Sidebar */}
            <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,.07)', display: 'flex', flexDirection: 'column', background: '#0d0d11' }}>
              <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#5b5b64', padding: '4px 12px 10px' }}>
                  Store admin
                </p>
                {ADMIN_TABS.map(({ id, label, icon: Icon }) => {
                  const active = adminTab === id
                  return (
                    <button
                      key={id}
                      onClick={() => { setAdminTab(id); if (id === 'orders' && orders.length === 0 && !ordersError) handleLoadOrders() }}
                      style={{
                        width: '100%', textAlign: 'left', padding: '8px 12px 8px 14px', borderRadius: 8,
                        border: 'none', cursor: 'pointer', fontSize: 13,
                        fontWeight: active ? 550 : 400,
                        background: active ? ADMIN_ACCENT_BG : 'transparent',
                        color: active ? ADMIN_ACCENT : '#8a8a93',
                        display: 'flex', alignItems: 'center', gap: 9,
                        position: 'relative', transition: 'background 0.12s, color 0.12s',
                      }}
                      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.color = '#f4f4f6'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.05)' } }}
                      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.color = '#8a8a93'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent' } }}
                    >
                      {active && (
                        <span style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 3, height: 16, borderRadius: '0 2px 2px 0', background: ADMIN_ACCENT, boxShadow: `0 0 8px rgba(62,207,142,.5)` }} />
                      )}
                      <Icon size={14} strokeWidth={active ? 2.2 : 1.7} />
                      {label}
                    </button>
                  )
                })}
              </nav>

              {/* Back to Builder */}
              <div style={{ padding: '12px 10px 16px', borderTop: '1px solid rgba(255,255,255,.07)' }}>
                <button
                  onClick={() => setAdminMode(false)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, background: 'transparent', color: '#8a8a93', transition: 'color 0.12s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = '#f4f4f6'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = '#8a8a93'}
                >
                  <ArrowLeft size={13} /> AI Builder
                </button>
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {adminTab === 'dashboard' && AdminDashboard}
              {adminTab === 'orders'    && AdminOrders}
              {adminTab === 'products'  && <div style={{ flex: 1, overflowY: 'auto' }}>{ProductsPanel}</div>}
              {adminTab === 'settings'  && AdminSettings}
            </div>
          </div>
        ) : (
          // Mobile: horizontal tab bar at top
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid rgba(255,255,255,.07)', background: '#0d0d11', overflowX: 'auto', scrollbarWidth: 'none' }}>
              {ADMIN_TABS.map(({ id, label, icon: Icon }) => {
                const active = adminTab === id
                return (
                  <button
                    key={id}
                    onClick={() => { setAdminTab(id); if (id === 'orders' && orders.length === 0 && !ordersError) handleLoadOrders() }}
                    style={{
                      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                      padding: '0.6rem 0.875rem', fontSize: 11, whiteSpace: 'nowrap',
                      fontWeight: active ? 600 : 400,
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: active ? '#f4f4f6' : '#8a8a93',
                      borderBottom: `2px solid ${active ? ADMIN_ACCENT : 'transparent'}`,
                      transition: 'color 0.15s',
                    }}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                )
              })}
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setAdminMode(false)}
                style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0.6rem 0.875rem', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: '#8a8a93', borderBottom: '2px solid transparent', whiteSpace: 'nowrap' }}
              >
                <ArrowLeft size={12} /> Builder
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {adminTab === 'dashboard' && AdminDashboard}
              {adminTab === 'orders'    && AdminOrders}
              {adminTab === 'products'  && <div style={{ flex: 1, overflowY: 'auto' }}>{ProductsPanel}</div>}
              {adminTab === 'settings'  && AdminSettings}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Suppress unused-variable warnings for admin accent vars — they're inside the adminMode block above
  void ADMIN_ACCENT_BG; void ADMIN_ACCENT_BORDER

  // ── Desktop 3-pane layout ────────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <div style={{
        position: 'fixed', top: '3rem', left: 0, right: 0, bottom: 0,
        zIndex: 30, display: 'flex', flexDirection: 'column',
        background: '#08080a',
      }}>
        {TopBar}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

          {/* ── Mode rail (icon strip) ──────────────────────────────── */}
          <div style={{
            width: 52, flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', paddingTop: 8, gap: 2,
            background: '#0d0d11',
            borderRight: '1px solid rgba(255,255,255,.07)',
          }}>
            {STUDIO_MODES.map(({ id, icon: Icon, label }) => {
              const active = desktopTab === id
              return (
                <button
                  key={id}
                  onClick={() => setDesktopTab(id)}
                  title={label}
                  style={{
                    width: 36, height: 36, borderRadius: 9,
                    border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? 'rgba(111,120,230,.15)' : 'transparent',
                    color: active ? '#6f78e6' : '#5b5b64',
                    transition: 'background 0.12s, color 0.12s',
                    position: 'relative',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#8a8a93' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#5b5b64' }}
                >
                  <Icon size={16} strokeWidth={active ? 2.2 : 1.7} />
                  {id === 'publish' && currentManifest && !checklistAllOk && (
                    <span style={{ position: 'absolute', top: 5, right: 5, width: 5, height: 5, borderRadius: '50%', background: '#f87171' }} />
                  )}
                  {id === 'publish' && deployStatus === 'ready' && (
                    <span style={{ position: 'absolute', top: 5, right: 5, width: 5, height: 5, borderRadius: '50%', background: '#3ecf8e' }} />
                  )}
                </button>
              )
            })}
          </div>

          {/* ── Active panel ────────────────────────────────────────── */}
          <div style={{
            width: 380, flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            borderRight: '1px solid rgba(255,255,255,.07)',
            background: '#08080a',
          }}>
            {/* Panel header */}
            <div style={{
              flexShrink: 0, height: 36,
              display: 'flex', alignItems: 'center',
              padding: '0 14px',
              borderBottom: '1px solid rgba(255,255,255,.05)',
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#f4f4f6', letterSpacing: '-.01em' }}>
                {STUDIO_MODES.find(m => m.id === desktopTab)?.label}
              </span>
            </div>

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {desktopTab === 'chat'     && ChatPanel}
              {desktopTab === 'sections' && SectionsPanel}
              {desktopTab === 'products' && ProductsPanel}
              {desktopTab === 'theme'    && ThemePanel}
              {desktopTab === 'publish'  && (
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                  {PublishPanel}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
                    <MerchantPanel
                      projectId={projectId}
                      manifest={currentManifest}
                      onManifestUpdate={(m) => { setCurrentManifest(m); setIframeKey((k) => k + 1) }}
                      onBalanceRefresh={refreshBalance}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Live preview (always visible) ───────────────────────── */}
          {PreviewPane}
        </div>
        {showCommandPalette && (
          <CommandPalette
            onClose={() => setShowCommandPalette(false)}
            onSwitchMode={tab => { setDesktopTab(tab); setActiveTab(tab as StudioTab) }}
            onExport={handleExport}
            onDeploy={handleDeploy}
            onAddSection={handleAddSection}
            onRestoreVersion={handleRestore}
            versions={versions}
          />
        )}
      </div>
    )
  }

  // ── Mobile tabbed layout ─────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', top: '3rem', left: 0, right: 0, bottom: 0,
      zIndex: 30, display: 'flex', flexDirection: 'column',
      background: '#08080a',
    }}>
      {TopBar}

      {/* Mobile mode tabs */}
      <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid rgba(255,255,255,.07)', overflowX: 'auto', scrollbarWidth: 'none', background: '#0d0d11' }}>
        {([
          { id: 'chat',     label: 'Chat'     },
          { id: 'preview',  label: 'Preview'  },
          { id: 'sections', label: 'Pages'    },
          { id: 'products', label: 'Products' },
          { id: 'theme',    label: 'Theme'    },
          { id: 'publish',  label: 'Publish'  },
        ] as { id: StudioTab; label: string }[]).map(({ id: tab, label }) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flexShrink: 0, padding: '0.55rem 0.8rem', fontSize: 11,
              fontWeight: activeTab === tab ? 600 : 400,
              background: 'none', border: 'none', cursor: 'pointer',
              color: activeTab === tab ? '#f4f4f6' : '#8a8a93',
              borderBottom: activeTab === tab ? '2px solid #6f78e6' : '2px solid transparent',
              transition: 'color 0.12s', position: 'relative', whiteSpace: 'nowrap',
            }}
          >
            {label}
            {tab === 'preview' && isGenerating && (
              <span style={{ marginLeft: 3, fontSize: 8, color: '#6f78e6' }}>●</span>
            )}
            {tab === 'publish' && deployStatus === 'ready' && (
              <span style={{ position: 'absolute', top: 5, right: 5, width: 4, height: 4, borderRadius: '50%', background: '#3ecf8e' }} />
            )}
            {tab === 'publish' && currentManifest && !checklistAllOk && deployStatus !== 'ready' && (
              <span style={{ position: 'absolute', top: 5, right: 5, width: 4, height: 4, borderRadius: '50%', background: '#f87171' }} />
            )}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'chat'     && ChatPanel}
        {activeTab === 'preview'  && PreviewPane}
        {activeTab === 'sections' && SectionsPanel}
        {activeTab === 'products' && ProductsPanel}
        {activeTab === 'theme'    && ThemePanel}
        {activeTab === 'publish'  && (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {PublishPanel}
            <MerchantPanel
              projectId={projectId}
              manifest={currentManifest}
              onManifestUpdate={(m) => { setCurrentManifest(m); setIframeKey((k) => k + 1) }}
              onBalanceRefresh={refreshBalance}
            />
          </div>
        )}
      </div>
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          onSwitchMode={tab => { setDesktopTab(tab); setActiveTab(tab as StudioTab) }}
          onExport={handleExport}
          onDeploy={handleDeploy}
          onAddSection={handleAddSection}
          onRestoreVersion={handleRestore}
          versions={versions}
        />
      )}
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

function ChatMessage({ message, onUndo }: { message: Message; onUndo?: () => void }) {
  const isUser = message.role === 'user'
  const isError = message.type === 'error'
  const isStatus = message.type === 'status'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 6 }}>
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
      {message.changeSummary && message.changeSummary.changes.length > 0 && (
        <ChangeSummaryCard summary={message.changeSummary} onUndo={onUndo} />
      )}
      {isError && message.content.toLowerCase().includes('insufficient credits') && (
        <Link
          href="/billing"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 7,
            border: '1px solid rgba(111,120,230,.3)', background: 'rgba(111,120,230,.08)',
            color: '#6f78e6', textDecoration: 'none',
          }}
        >
          Buy credits →
        </Link>
      )}
    </div>
  )
}

function ChangeSummaryCard({ summary, onUndo }: { summary: ChangeSummary; onUndo?: () => void }) {
  return (
    <div style={{
      maxWidth: '88%',
      borderRadius: 8,
      background: 'rgba(62,207,142,.05)',
      border: '1px solid rgba(62,207,142,.18)',
      padding: '8px 10px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-geist-mono)',
          color: 'var(--live)', letterSpacing: '.04em', fontWeight: 600,
        }}>
          CHANGES
        </span>
        {onUndo && (
          <button
            onClick={onUndo}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontFamily: 'var(--font-geist-mono)',
              color: '#8a8a93', background: 'none', border: 'none',
              cursor: 'pointer', padding: '1px 6px',
              borderRadius: 4,
              transition: 'color 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#f4f4f6')}
            onMouseLeave={e => (e.currentTarget.style.color = '#8a8a93')}
          >
            <RotateCcw size={10} />
            undo
          </button>
        )}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {summary.changes.map((change, i) => (
          <li key={i} style={{
            fontSize: 12, color: 'rgba(62,207,142,.85)', lineHeight: 1.4,
            display: 'flex', alignItems: 'flex-start', gap: 5,
          }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}>✓</span>
            <span>{change}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Section picker modal ─────────────────────────────────────────────────────

const SECTION_TYPES = [
  { type: 'hero',         label: 'Hero',          desc: 'Full-width headline + CTA',         emoji: '🦸' },
  { type: 'productGrid',  label: 'Product Grid',  desc: 'Grid of products from your catalog', emoji: '🛍️' },
  { type: 'featureRow',   label: 'Feature Row',   desc: 'Icon + heading + body columns',      emoji: '✦'  },
  { type: 'testimonials', label: 'Testimonials',  desc: 'Customer quotes',                    emoji: '💬' },
  { type: 'richText',     label: 'Rich Text',     desc: 'Free-form editorial copy',           emoji: '📝' },
  { type: 'banner',       label: 'Banner',        desc: 'Announcement bar with CTA',          emoji: '📣' },
  { type: 'newsletter',   label: 'Newsletter',    desc: 'Email capture form',                 emoji: '✉️' },
  { type: 'gallery',      label: 'Gallery',       desc: 'Image grid or masonry',              emoji: '🖼️' },
  { type: 'faq',          label: 'FAQ',           desc: 'Accordion Q&A',                      emoji: '❓' },
] as const

function SectionPickerModal({ onPick, onClose }: { onPick: (type: string) => void; onClose: () => void }) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(3px)' }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 101,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem', pointerEvents: 'none',
      }}>
        <div style={{
          pointerEvents: 'all',
          width: '100%', maxWidth: 440,
          background: '#0d0d11',
          border: '1px solid rgba(255,255,255,.1)',
          borderRadius: 14,
          boxShadow: '0 24px 80px rgba(0,0,0,.8)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>Add section</p>
              <p style={{ fontSize: 11, color: '#8a8a93', margin: '2px 0 0' }}>Pick a section type to add to the home page</p>
            </div>
            <button onClick={onClose} style={{ padding: 4, border: 'none', background: 'none', color: '#8a8a93', cursor: 'pointer', display: 'flex', borderRadius: 6, transition: 'color 0.12s' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#f4f4f6')}
              onMouseLeave={e => (e.currentTarget.style.color = '#8a8a93')}
            >
              <X size={16} />
            </button>
          </div>

          {/* Grid */}
          <div style={{ padding: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {SECTION_TYPES.map(({ type, label, desc, emoji }) => (
              <button
                key={type}
                onClick={() => onPick(type)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 4, padding: '12px 14px', borderRadius: 10,
                  border: '1px solid rgba(255,255,255,.07)',
                  background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.12s, border-color 0.12s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(111,120,230,.08)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(111,120,230,.3)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,.07)' }}
              >
                <span style={{ fontSize: 20, lineHeight: 1 }}>{emoji}</span>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>{label}</p>
                <p style={{ fontSize: 11, color: '#8a8a93', margin: 0, lineHeight: 1.35 }}>{desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Command palette ──────────────────────────────────────────────────────────

interface PaletteCommand {
  group: string
  label: string
  hint?: string
  action: () => void
}

function CommandPalette({
  onClose,
  onSwitchMode,
  onExport,
  onDeploy,
  onAddSection,
  onRestoreVersion,
  versions,
}: {
  onClose: () => void
  onSwitchMode: (tab: DesktopTab) => void
  onExport: (includeAdmin: boolean) => void
  onDeploy: () => void
  onAddSection: (type: string) => void
  onRestoreVersion: (id: string) => void
  versions: VersionEntry[]
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const commands: PaletteCommand[] = [
    // Modes
    { group: 'Mode', label: 'Chat',     hint: 'AI conversation',            action: () => { onSwitchMode('chat');     onClose() } },
    { group: 'Mode', label: 'Sections', hint: 'Reorder & manage sections',  action: () => { onSwitchMode('sections'); onClose() } },
    { group: 'Mode', label: 'Products', hint: 'Edit catalog',               action: () => { onSwitchMode('products'); onClose() } },
    { group: 'Mode', label: 'Theme',    hint: 'Colors & typography',        action: () => { onSwitchMode('theme');    onClose() } },
    { group: 'Mode', label: 'Publish',  hint: 'Deploy & export',            action: () => { onSwitchMode('publish');  onClose() } },
    // Navigation
    { group: 'Navigate', label: 'Dashboard', action: () => { window.location.href = '/dashboard'; onClose() } },
    { group: 'Navigate', label: 'Billing',   action: () => { window.location.href = '/billing';   onClose() } },
    { group: 'Navigate', label: 'Settings',  action: () => { window.location.href = '/settings';  onClose() } },
    // Actions
    { group: 'Action', label: 'Export ZIP',          action: () => { onExport(false); onClose() } },
    { group: 'Action', label: 'Export ZIP + Admin',  action: () => { onExport(true);  onClose() } },
    { group: 'Action', label: 'Deploy to web',       action: () => { onDeploy();      onClose() } },
    // Add section
    ...SECTION_TYPES.map(s => ({
      group: 'Add section',
      label: s.label,
      hint: s.desc,
      action: () => { onAddSection(s.type); onClose() },
    })),
    // Version history
    ...versions.slice(0, 5).map(v => ({
      group: 'History',
      label: `Restore v${v.version_no}`,
      hint: v.prompt?.slice(0, 50) ?? '',
      action: () => { onRestoreVersion(v.id); onClose() },
    })),
  ]

  const filtered = query
    ? commands.filter(c =>
        `${c.group} ${c.label} ${c.hint ?? ''}`.toLowerCase().includes(query.toLowerCase())
      )
    : commands

  useEffect(() => { setCursor(0) }, [query])

  // Build groups preserving order
  const groups: Array<{ name: string; items: PaletteCommand[] }> = []
  for (const cmd of filtered) {
    const g = groups.find(x => x.name === cmd.group)
    if (g) g.items.push(cmd)
    else groups.push({ name: cmd.group, items: [cmd] })
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter' && filtered[cursor]) filtered[cursor].action()
    if (e.key === 'Escape') onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)' }}
      />

      {/* Palette */}
      <div style={{
        position: 'fixed', top: '18vh', left: '50%', transform: 'translateX(-50%)',
        zIndex: 201, width: '100%', maxWidth: 520,
        background: '#0d0d11', borderRadius: 14,
        border: '1px solid rgba(255,255,255,.1)',
        boxShadow: '0 32px 100px rgba(0,0,0,.9)',
        overflow: 'hidden',
      }}>
        {/* Search */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)', flexShrink: 0 }}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search commands…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 14, color: '#f4f4f6', fontFamily: 'inherit',
            }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: '#5b5b64', cursor: 'pointer', fontSize: 12, padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}>✕</button>
          )}
        </div>

        {/* Results */}
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: '6px 0' }}>
          {filtered.length === 0 ? (
            <p style={{ fontSize: 13, color: '#5b5b64', textAlign: 'center', padding: '2rem 1rem', margin: 0 }}>No commands found</p>
          ) : (
            groups.map(group => (
              <div key={group.name}>
                <p style={{
                  fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '.07em',
                  color: '#5b5b64', padding: '6px 14px 2px', margin: 0,
                }}>
                  {group.name}
                </p>
                {group.items.map(cmd => {
                  const idx = filtered.indexOf(cmd)
                  const active = idx === cursor
                  return (
                    <button
                      key={`${cmd.group}-${cmd.label}`}
                      onClick={cmd.action}
                      onMouseEnter={() => setCursor(idx)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center',
                        padding: '7px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
                        background: active ? 'rgba(111,120,230,.12)' : 'transparent',
                        transition: 'background 0.08s',
                      }}
                    >
                      <div>
                        <p style={{ fontSize: 13, color: active ? '#f4f4f6' : '#c8c8d0', margin: 0, fontWeight: active ? 500 : 400 }}>
                          {cmd.label}
                        </p>
                        {cmd.hint && (
                          <p style={{ fontSize: 11, color: '#5b5b64', margin: '1px 0 0' }}>{cmd.hint}</p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', gap: 16 }}>
          {([['↑↓', 'Navigate'], ['↵', 'Select'], ['Esc', 'Close']] as [string, string][]).map(([key, label]) => (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#5b5b64' }}>
              <kbd style={{
                padding: '1px 5px', borderRadius: 4,
                border: '1px solid rgba(255,255,255,.1)',
                fontFamily: 'var(--font-geist-mono)', fontSize: 10,
                background: 'rgba(255,255,255,.04)',
              }}>{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </>
  )
}
