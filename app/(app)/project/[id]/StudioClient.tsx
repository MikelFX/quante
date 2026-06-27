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
  LayoutDashboard, ShoppingBag, ClipboardList, Settings2, ArrowLeft, TrendingUp, Share2, Users,
  Terminal, Wrench, CheckCircle, AlertCircle,
} from 'lucide-react'
import { RevenueChart } from '@/components/admin/RevenueChart'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChangeSummary {
  changes: string[]
  prevVersionId: string | null
}

interface BuildError {
  filePath: string
  line: number
  message: string
}

interface LogLine {
  type: string
  text: string
  created: number
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
  | { type: 'done'; reply?: string; projectId?: string; versionId?: string; deploymentId?: string; previewUrl?: string; summary?: string }
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
  storeUrl: string | null
  initialBalance: number
  hostingInfo: HostingInfo
  latestDeployment: { id: string; status: string; url: string | null } | null
  isAgency?: boolean
  hasCodeVersion: boolean
}

type StudioTab = 'chat' | 'preview' | 'logs' | 'sections' | 'products' | 'theme' | 'publish'
type DesktopTab = 'chat' | 'sections' | 'products' | 'theme' | 'publish'
type RightPanelTab = 'preview' | 'logs'
type AdminTab = 'dashboard' | 'products' | 'orders' | 'customers' | 'settings'

interface StripeOrder {
  id: string; customerEmail: string; customerName: string
  amount: number; currency: string; status: string
  items: { name: string; qty: number; amount: number }[]
  createdAt: string
}

interface StoreOrder {
  id: string; orderNumber: string
  customerEmail: string; customerName: string; customerPhone: string | null
  amount: number; currency: string
  status: string; paymentStatus: string; paymentMethod: string
  shippingMethod: string | null
  zasilkovnaBranchId: string | null; zasilkovnaBranchCountry: string | null
  shippingCountry: string | null
  shippingAddress: Record<string, string> | null
  trackingCode: string | null; trackingUrl: string | null
  invoiceUrl: string | null; createdAt: string
}

interface CustomerRecord {
  email: string; name: string; phone: string | null
  orderCount: number; totalSpent: number; currency: string
  firstOrderAt: string; lastOrderAt: string
}

interface ProductDraft {
  id: string
  name: string
  description: string
  price: string
  compareAtPrice: string
  slug: string
  tags: string
  images: string[]
  available: boolean
}

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function emptyProduct(): ProductDraft {
  return { id: crypto.randomUUID(), name: '', description: '', price: '', compareAtPrice: '', slug: '', tags: '', images: [], available: true }
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
  { label: 'GDPR page', prompt: 'Vytvoř kompletní stránku Zásady ochrany osobních údajů (GDPR) s reálným textem dle české legislativy.' },
  { label: 'Terms of service', prompt: 'Vytvoř stránku Obchodní podmínky s 14denním právem na vrácení zboží, reklamačním řádem a identifikací prodávajícího.' },
  { label: 'Rewrite copy', prompt: 'Rewrite all the text on the site — hero, products, and sections — so it sounds confident and sales-ready.' },
  { label: 'Add product', prompt: 'Add a new product: ' },
  { label: 'New section', prompt: 'Add a section to the homepage: ' },
  { label: 'Change design', prompt: 'Change the entire visual style to ' },
]

// ─── Main component ───────────────────────────────────────────────────────────

export function StudioClient({ projectId, projectName, storeUrl, initialBalance, hostingInfo, latestDeployment, hasCodeVersion, isAgency = false }: Props) {
  const searchParams = useSearchParams()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [balance, setBalance] = useState(initialBalance)
  const [hasGeneratedOnce, setHasGeneratedOnce] = useState(hasCodeVersion || !!latestDeployment)
  const [activeTab, setActiveTab] = useState<StudioTab>('chat')
  // Preview + logs state (new code-gen approach)
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    (() => {
      const u = latestDeployment?.url ?? null
      const safe = (u && !u.includes('://null') && u !== 'null') ? u : null
      // Prefer canonical store domain URL over raw Vercel deployment URLs (which block in iframes)
      if (safe?.includes('vercel.app') && storeUrl) return storeUrl
      return safe ?? storeUrl ?? null
    })()
  )
  const [rightPanel, setRightPanel] = useState<RightPanelTab>('preview')
  const [deployLogs, setDeployLogs] = useState<LogLine[]>([])
  const [buildError, setBuildError] = useState<BuildError | null>(null)
  const [isFixing, setIsFixing] = useState(false)
  const [previewReady, setPreviewReady] = useState<boolean>(
    // If we have a latestDeployment that's already 'ready', the preview is already live
    latestDeployment?.status === 'ready'
  )
  const [autoFixAttempts, setAutoFixAttempts] = useState(0)
  const MAX_AUTO_FIX = 3
  // Returns the best available preview URL — prefers canonical domain URL over raw vercel.app URLs
  const resolveUrl = (url: string | null | undefined) =>
    (url && url.includes('vercel.app') && storeUrl) ? storeUrl : (url ?? storeUrl ?? null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logEventSourceRef = useRef<EventSource | null>(null)
  // Legacy compatibility stubs — keep panels from crashing during transition
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentManifest = null as unknown as ShopManifest | null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const setCurrentManifest = (_m: ShopManifest | null) => { /* noop — manifest editing replaced by code-gen */ }
  const [iframeKey, setIframeKey] = useState(0)
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
  const [showPushToLive, setShowPushToLive] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)
  const [isPreviewDeploying, setIsPreviewDeploying] = useState(false)
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
  // Supabase store_orders (Comgate / Zásilkovna / bank)
  const [storeOrders, setStoreOrders] = useState<StoreOrder[]>([])
  const [storeOrderRevenue, setStoreOrderRevenue] = useState(0)
  const [isLoadingStoreOrders, setIsLoadingStoreOrders] = useState(false)
  const [ordersTab, setOrdersTab] = useState<'stripe' | 'store'>('store')
  // Customers
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false)
  // Zásilkovna shipment creation
  const [creatingShipment, setCreatingShipment] = useState<string | null>(null)
  const [shipmentResults, setShipmentResults] = useState<Record<string, { barcode?: string; error?: string }>>({})
  const [shipmentWeights, setShipmentWeights] = useState<Record<string, string>>({})
  const [dhlWeights, setDhlWeights] = useState<Record<string, string>>({})
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  // Zásilkovna settings
  const [zasilkovnaKey, setZasilkovnaKey] = useState('')
  const [zasilkovnaPassword, setZasilkovnaPassword] = useState('')
  const [hasZasilkovnaKey, setHasZasilkovnaKey] = useState(false)
  const [hasZasilkovnaPassword, setHasZasilkovnaPassword] = useState(false)
  const [isSavingZasilkovna, setIsSavingZasilkovna] = useState(false)
  // DHL settings
  const [dhlApiKey, setDhlApiKey] = useState('')
  const [dhlApiSecret, setDhlApiSecret] = useState('')
  const [dhlAccountNumber, setDhlAccountNumber] = useState('')
  const [hasDhlApiKey, setHasDhlApiKey] = useState(false)
  const [hasDhlApiSecret, setHasDhlApiSecret] = useState(false)
  const [hasDhlAccount, setHasDhlAccount] = useState(false)
  const [isSavingDhl, setIsSavingDhl] = useState(false)
  // DHL shipment results (tracking + label)
  const [dhlResults, setDhlResults] = useState<Record<string, { trackingNumber?: string; trackingUrl?: string; labelBase64?: string; error?: string }>>({})
  const [creatingDhlShipment, setCreatingDhlShipment] = useState<string | null>(null)
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
  // Domain search/purchase
  const [domainQuery, setDomainQuery] = useState('')
  const [domainSearching, setDomainSearching] = useState(false)
  const [domainResults, setDomainResults] = useState<Array<{ domain: string; available: boolean; price: number; currency: string }>>([])
  const [ownedDomains, setOwnedDomains] = useState<Array<{ id: string; domain: string; status: string; dns_verified: boolean; project_id: string | null }>>([])
  const [domainConnectInput, setDomainConnectInput] = useState('')
  const [domainConnecting, setDomainConnecting] = useState(false)
  const [domainConnectResult, setDomainConnectResult] = useState<{ instructions: string; dnsValue: string } | null>(null)
  const [domainPurchasing, setDomainPurchasing] = useState(false)
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
  const visionInputRef = useRef<HTMLInputElement>(null)
  const [pendingImageTarget, setPendingImageTarget] = useState<((url: string) => void) | null>(null)
  // Vision (IMAGE→BRAND)
  const [isVisionAnalyzing, setIsVisionAnalyzing] = useState(false)
  const [visionResult, setVisionResult] = useState<{ palette: Record<string, string>; typography: { headingFont: string; bodyFont: string; scale: string }; radius: string; density: string; motion: string; voice: string; reasoning: string } | null>(null)
  // Image suggest (product photo finder)
  const [isSuggestingImages, setIsSuggestingImages] = useState(false)
  const [suggestedImages, setSuggestedImages] = useState<Array<{ url: string; thumb: string; alt: string; credit: string; creditUrl: string }> | null>(null)

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
        if (d.hasZasilkovnaKey) setHasZasilkovnaKey(true)
        if (d.hasZasilkovnaPassword) setHasZasilkovnaPassword(true)
        if (d.hasDhlApiKey) setHasDhlApiKey(true)
        if (d.hasDhlApiSecret) setHasDhlApiSecret(true)
        if (d.hasDhlAccount) setHasDhlAccount(true)
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
    fetch('/api/domains/list')
      .then(r => r.json())
      .then(d => { if (d.domains) setOwnedDomains(d.domains) })
      .catch(() => {})
  }, [])

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
        const isLiveDeploy = !!d.domain  // preview deployments have no domain
        if (d.status === 'ready') {
          if (isLiveDeploy) {
            setDeployStatus('ready')
            setDeployUrl((d.url && !d.url.includes('://null')) ? d.url : null)
            setDeployDomain(d.domain)
          } else {
            // Auto-deploy ready — always use canonical domain URL, not raw Vercel URL
            const readyUrl = storeUrl ?? ((d.url && !d.url.includes('://null') && !d.url.includes('vercel.app')) ? d.url : null)
            if (readyUrl) setPreviewUrl(readyUrl)
            setPreviewReady(true)
          }
        } else if (d.status === 'building' && d.vercelDeploymentId) {
          // Show canonical URL immediately (iframe will load when build finishes)
          if (storeUrl) {
            setPreviewUrl(storeUrl)
          } else if (d.url && !d.url.includes('://null') && !d.url.includes('vercel.app')) {
            setPreviewUrl(d.url)
          }
          if (isLiveDeploy) {
            // Live deployment still building — resume polling
            setIsDeploying(true)
            setDeployStatus('building')
            setDeployDomain(d.domain)
            deployPollRef.current = setInterval(() => pollDeployStatus(d.vercelDeploymentId), 12000)
          } else {
            // Preview deployment: poll Vercel status directly first to avoid triggering
            // auto-fix for errors that happened before this page load.
            if (!logEventSourceRef.current) {
              fetch(`/api/deploy?id=${d.vercelDeploymentId}`)
                .then(r => r.json())
                .then(s => {
                  if (s.status === 'ready') {
                    const safeUrl = (s.url && !s.url.includes('://null')) ? s.url : null
                    if (safeUrl) setPreviewUrl(safeUrl)
                    setPreviewReady(true)
                  } else if (s.status === 'error' || s.status === 'canceled') {
                    if (s.errorMessage) {
                      setMessages(prev => [...prev, {
                        role: 'assistant',
                        content: `Previous build failed:\n\`\`\`\n${s.errorMessage.slice(0, 600)}\n\`\`\`\nDescribe a fix in chat to retry.`,
                        type: 'error' as const,
                      }])
                    }
                  } else {
                    // Genuinely still building — stream logs live
                    startLogStreaming(d.vercelDeploymentId)
                  }
                })
                .catch(() => {})
            }
          }
        } else if ((d.status === 'error' || d.status === 'canceled') && d.vercelDeploymentId && !isLiveDeploy) {
          // Preview build failed — fetch error message and show in chat
          fetch(`/api/deploy?id=${d.vercelDeploymentId}`)
            .then(r => r.json())
            .then(err => {
              if (err.errorMessage) {
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `Previous build failed:\n\`\`\`\n${err.errorMessage.slice(0, 600)}\n\`\`\`\nDescribe a fix in chat to retry.`,
                  type: 'error' as const,
                }])
              }
            })
            .catch(() => {})
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

  // ─── Log streaming ───────────────────────────────────────────────────────────

  const startLogStreaming = useCallback((deploymentId: string) => {
    if (logEventSourceRef.current) {
      logEventSourceRef.current.close()
      logEventSourceRef.current = null
    }
    setDeployLogs([])
    setBuildError(null)
    setRightPanel('logs')

    let receivedAnyLog = false

    const es = new EventSource(`/api/deploy/logs?deploymentId=${deploymentId}`)
    logEventSourceRef.current = es

    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as LogLine & { filePath?: string; line?: number; message?: string; state?: string }

        if (data.type === 'build_error' && data.filePath) {
          setBuildError({ filePath: data.filePath, line: data.line ?? 0, message: data.message ?? data.text })
          return
        }

        if (data.type === 'stream_end' || data.type === 'ready' || data.type === 'error') {
          es.close()
          logEventSourceRef.current = null
          if (data.state === 'ready' || data.type === 'ready') {
            // Always point the iframe at the canonical domain URL (not a raw vercel.app URL)
            if (storeUrl) {
              setPreviewUrl(storeUrl)
            } else {
              fetch(`/api/projects/${projectId}/deployments`)
                .then(r => r.json())
                .then((d: { latest?: { url?: string } }) => {
                  const url = d.latest?.url
                  if (url && !url.includes('://null') && !url.includes('vercel.app')) setPreviewUrl(url)
                })
                .catch(() => {})
            }
            setPreviewReady(true)
            setRightPanel('preview')
            setMessages((prev) => [...prev, { role: 'assistant', content: 'Preview ready.', type: 'done' }])
          } else if ((data.state === 'error' || data.type === 'error') && !buildError) {
            // Stream ended with a build error but no build_error event was received —
            // fetch the error details directly so auto-fix can trigger
            fetch(`/api/deploy?id=${deploymentId}`)
              .then(r => r.json())
              .then((d: { status?: string; errorMessage?: string }) => {
                const msg = d.errorMessage ?? 'Build failed — check Vercel logs for details.'
                const fileMatch = msg.match(/(?:\.\/)?([^:>\n\s'"]+\.(?:ts|tsx|js|jsx)):(\d+)/)
                setBuildError({
                  filePath: fileMatch?.[1] ?? 'store',
                  line: fileMatch ? parseInt(fileMatch[2]) : 0,
                  message: msg.slice(0, 800),
                })
              })
              .catch(() => {})
          }
          return
        }

        if (data.text) {
          receivedAnyLog = true
          setDeployLogs((prev) => [...prev.slice(-500), { type: data.type, text: data.text, created: data.created }])
          logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
      } catch {}
    }

    es.onerror = () => {
      es.close()
      logEventSourceRef.current = null
      // Always poll for final status — if the SSE connection dropped mid-stream
      // (network hiccup, timeout, server close) we still need to resolve previewReady.
      fetch(`/api/deploy?id=${deploymentId}`)
        .then(r => r.json())
        .then(d => {
          if (d.status === 'ready') {
            if (storeUrl) {
              setPreviewUrl(storeUrl)
            } else if (d.url && !d.url.includes('://null') && !d.url.includes('vercel.app')) {
              setPreviewUrl(d.url)
            }
            setPreviewReady(true)
            setRightPanel('preview')
            if (!receivedAnyLog) {
              setMessages(prev => [...prev, { role: 'assistant', content: 'Preview ready.', type: 'done' as const }])
            }
          } else if ((d.status === 'error' || d.status === 'canceled') && d.errorMessage) {
            const msg = d.errorMessage.slice(0, 800)
            const fileMatch = msg.match(/(?:\.\/)?([^:>\n\s'"]+\.(?:ts|tsx|js|jsx)):(\d+)/)
            setBuildError({
              filePath: fileMatch?.[1] ?? 'store',
              line: fileMatch ? parseInt(fileMatch[2]) : 0,
              message: msg,
            })
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `Preview build failed:\n\`\`\`\n${msg.slice(0, 600)}\n\`\`\`\nAttempting auto-fix…`,
              type: 'error' as const,
            }])
          }
        })
        .catch(() => {})
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => () => { logEventSourceRef.current?.close() }, [])

  // Auto-fix loop: trigger handleFix automatically when a build error is detected (max 3 attempts)
  useEffect(() => {
    if (!buildError || isFixing || autoFixAttempts >= MAX_AUTO_FIX) return
    const timer = setTimeout(() => {
      setAutoFixAttempts(prev => prev + 1)
      void handleFix()
    }, 1500)
    return () => clearTimeout(timer)
  }, [buildError]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bootstrap from URL params set by /new redirect (deploymentId + previewUrl)
  useEffect(() => {
    const did = searchParams.get('did')
    const pu = searchParams.get('pu')
    if (pu) setPreviewUrl(decodeURIComponent(pu))
    if (did) startLogStreaming(did)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function consumeStream(
    endpoint: string,
    body: object,
    onDone: (reply?: string, deploymentId?: string, previewUrl?: string) => void,
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
        onDone(event.reply, event.deploymentId, event.previewUrl)
        return
      }
    }
    // Stream ended without a 'done' or 'error' event — surface as an error
    setStreamingText('')
    throw new Error('Stream ended unexpectedly. Please try again.')
  }

  async function handleFix() {
    if (!buildError || isFixing) return
    setIsFixing(true)
    setMessages((prev) => [...prev, {
      role: 'assistant',
      content: `Fixing build error in \`${buildError.filePath}\` at line ${buildError.line}…`,
      type: 'status',
    }])
    try {
      const res = await fetch('/api/quante/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, errorMessage: buildError.message, filePath: buildError.filePath }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: data.error ?? 'Fix failed.', type: 'error' }
          return updated
        })
        return
      }
      setBuildError(null)
      fetchVersions()
      refreshBalance()
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: data.explanation ?? 'Fix applied — redeploying preview…',
          type: 'done',
        }
        return updated
      })
      const fixUrl = resolveUrl(data.previewUrl)
      if (fixUrl) { setPreviewUrl(fixUrl); setPreviewReady(false) }
      if (data.deploymentId) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Redeploying with the fix — watch the Logs tab on the right.', type: 'status' }])
        startLogStreaming(data.deploymentId)
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Fix request failed.', type: 'error' }
        return updated
      })
    } finally {
      setIsFixing(false)
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || isGenerating) return

    setInput('')
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '…', type: 'status' },
    ])
    setIsGenerating(true)
    setAutoFixAttempts(0)

    if (!hasGeneratedOnce) {
      // Generation flow — first time
      try {
        await consumeStream('/api/quante/generate', { brief: text, projectId }, (reply, deploymentId, newPreviewUrl) => {
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = {
              role: 'assistant',
              content: reply ?? 'Store generated — deploying preview…',
              type: 'done',
            }
            return updated
          })
          setHasGeneratedOnce(true)
          refreshBalance()
          fetchVersions()
          const genUrl = resolveUrl(newPreviewUrl)
          if (genUrl) setPreviewUrl(genUrl)
          // Show Push to Live button instead of loading spinner —
          // first-time deploy needs a production push to activate the domain
          setPreviewReady(false)
          setShowPushToLive(true)
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

    // Iteration flow
    try {
      await consumeStream(
        '/api/quante/iterate',
        { projectId, instruction: text },
        (reply, deploymentId, newPreviewUrl) => {
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = {
              role: 'assistant',
              content: reply ?? updated[updated.length - 1].content,
              type: 'done',
            }
            return updated
          })
          refreshBalance()
          fetchVersions()
          const iterUrl = resolveUrl(newPreviewUrl)
          if (iterUrl) { setPreviewUrl(iterUrl); setPreviewReady(false) }
          if (deploymentId) {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Building preview in the background — watch the Logs tab on the right (~2 min).', type: 'status' }])
            startLogStreaming(deploymentId)
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
    // Section regeneration is now handled via iteration in the new code-gen approach
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: instruction || `Improve section ${sectionIndex + 1}` },
      { role: 'assistant', content: 'Regenerating section…', type: 'status' },
    ])

    try {
      await consumeStream(
        '/api/quante/iterate',
        { projectId, instruction: instruction || `Improve section ${sectionIndex + 1}` },
        (reply, deploymentId, newPreviewUrl) => {
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = {
              role: 'assistant',
              content: reply ?? 'Section updated.',
              type: 'done',
            }
            return updated
          })
          setSectionInput('')
          refreshBalance()
          fetchVersions()
          const secUrl = resolveUrl(newPreviewUrl)
          if (secUrl) setPreviewUrl(secUrl)
          if (deploymentId) startLogStreaming(deploymentId)
        }
      )
    } catch {
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Section update failed.', type: 'error' }
        return updated
      })
    } finally {
      setIsGenerating(false)
      setRegeneratingSection(null)
    }
  }

  async function triggerRedeploy() {
    try {
      const res = await fetch(`/api/projects/${projectId}/redeploy`, { method: 'POST' })
      if (!res.ok) return
      const data = await res.json() as { deploymentId?: string; previewUrl?: string }
      const redeployUrl = resolveUrl(data.previewUrl)
      if (redeployUrl) { setPreviewUrl(redeployUrl); setPreviewReady(false) }
      if (data.deploymentId) startLogStreaming(data.deploymentId)
    } catch {}
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
        fetchVersions()
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Version restored — rebuilding preview…', type: 'done' }])
        await triggerRedeploy()
      }
    } catch {}
  }

  async function handleExport(includeAdmin = false) {
    if (!hasGeneratedOnce) return
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
        setShowPushToLive(false)
        setDeployStatus('ready')
        const safeUrl = (data.url && !data.url.includes('://null')) ? data.url : null
        setDeployUrl(safeUrl)
        setDeployDomain(data.domain ?? null)
        setLiveDeployment((prev) => prev ? { ...prev, status: 'ready', url: safeUrl ?? prev.url, domain: data.domain ?? prev.domain } : null)
        const liveUrl = resolveUrl(data.url)
        if (liveUrl) setPreviewUrl(liveUrl)
        setPreviewReady(true)
        setRightPanel('preview')
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
    if (!hasGeneratedOnce || isDeploying) return
    setShowPushToLive(false)
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

  async function handlePreviewDeploy() {
    if (!hasGeneratedOnce || isPreviewDeploying) return
    setIsPreviewDeploying(true)
    setMessages((prev) => [...prev, { role: 'assistant', content: 'Creating preview deployment… (2 credits)', type: 'status' }])
    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, type: 'preview' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: data.error ?? 'Preview deploy failed.', type: 'error' }
          return updated
        })
        return
      }
      refreshBalance()
      const url = data.previewUrl as string
      if (data.deploymentId) startLogStreaming(data.deploymentId)
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `Preview deployment started. Once built, it'll be available at:\n\n[${url}](${url})\n\nThis is a unique preview URL — it doesn't affect your live store.`,
          type: 'done',
        }
        return updated
      })
    } catch {
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Preview deploy request failed.', type: 'error' }
        return updated
      })
    } finally {
      setIsPreviewDeploying(false)
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

  async function handleLoadStoreOrders() {
    setIsLoadingStoreOrders(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/store-orders`)
      const data = await res.json()
      if (!res.ok) return
      setStoreOrders(data.orders ?? [])
      setStoreOrderRevenue(data.revenue ?? 0)
    } catch {
      // non-fatal
    } finally {
      setIsLoadingStoreOrders(false)
    }
  }

  async function handleLoadCustomers() {
    setIsLoadingCustomers(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/customers`)
      const data = await res.json()
      if (!res.ok) return
      setCustomers(data.customers ?? [])
    } catch {
      // non-fatal
    } finally {
      setIsLoadingCustomers(false)
    }
  }

  function exportCustomersCsv() {
    const header = 'Email,Name,Phone,Orders,Total Spent,Currency,First Order,Last Order'
    const rows = customers.map(c =>
      [c.email, c.name, c.phone ?? '', c.orderCount, c.totalSpent.toFixed(2), c.currency,
        new Date(c.firstOrderAt).toLocaleDateString('cs-CZ'),
        new Date(c.lastOrderAt).toLocaleDateString('cs-CZ'),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'customers.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleCreateShipment(orderId: string, weight = 1) {
    setCreatingShipment(orderId)
    try {
      const res = await fetch(`/api/projects/${projectId}/store-orders/${orderId}/zasilkovna-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight }),
      })
      const data = await res.json()
      if (!res.ok) {
        setShipmentResults(p => ({ ...p, [orderId]: { error: data.error ?? 'Failed to create shipment.' } }))
      } else {
        setShipmentResults(p => ({ ...p, [orderId]: { barcode: data.barcode } }))
        // refresh orders so status updates
        handleLoadStoreOrders()
      }
    } catch {
      setShipmentResults(p => ({ ...p, [orderId]: { error: 'Network error.' } }))
    } finally {
      setCreatingShipment(null)
    }
  }

  async function handleSaveZasilkovna() {
    if (!zasilkovnaKey && !zasilkovnaPassword) return
    setIsSavingZasilkovna(true)
    try {
      const body: Record<string, string> = {}
      if (zasilkovnaKey) body.zasilkovnaApiKey = zasilkovnaKey
      if (zasilkovnaPassword) body.zasilkovnaApiPassword = zasilkovnaPassword
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { alert('Failed to save.'); return }
      if (zasilkovnaKey) setHasZasilkovnaKey(true)
      if (zasilkovnaPassword) setHasZasilkovnaPassword(true)
      setZasilkovnaKey('')
      setZasilkovnaPassword('')
    } catch {
      alert('Something went wrong.')
    } finally {
      setIsSavingZasilkovna(false)
    }
  }

  async function handleSaveDhl() {
    if (!dhlApiKey && !dhlApiSecret && !dhlAccountNumber) return
    setIsSavingDhl(true)
    try {
      const body: Record<string, string> = {}
      if (dhlApiKey) body.dhlApiKey = dhlApiKey
      if (dhlApiSecret) body.dhlApiSecret = dhlApiSecret
      if (dhlAccountNumber) body.dhlAccountNumber = dhlAccountNumber
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { alert('Failed to save.'); return }
      if (dhlApiKey) setHasDhlApiKey(true)
      if (dhlApiSecret) setHasDhlApiSecret(true)
      if (dhlAccountNumber) setHasDhlAccount(true)
      setDhlApiKey(''); setDhlApiSecret(''); setDhlAccountNumber('')
    } catch {
      alert('Something went wrong.')
    } finally {
      setIsSavingDhl(false)
    }
  }

  async function handleCreateDhlShipment(orderId: string, opts: { weight?: number; length?: number; width?: number; height?: number; description?: string } = {}) {
    setCreatingDhlShipment(orderId)
    try {
      const res = await fetch(`/api/projects/${projectId}/store-orders/${orderId}/dhl-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight: opts.weight ?? 1, ...opts }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDhlResults(p => ({ ...p, [orderId]: { error: data.error ?? 'DHL API error.' } }))
      } else {
        setDhlResults(p => ({ ...p, [orderId]: { trackingNumber: data.trackingNumber, trackingUrl: data.trackingUrl, labelBase64: data.labelBase64 } }))
        handleLoadStoreOrders()
      }
    } catch {
      setDhlResults(p => ({ ...p, [orderId]: { error: 'Network error.' } }))
    } finally {
      setCreatingDhlShipment(null)
    }
  }

  function downloadDhlLabel(orderId: string, orderNumber: string, base64: string) {
    const byteArray = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const blob = new Blob([byteArray], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `DHL-${orderNumber}.pdf`; a.click()
    URL.revokeObjectURL(url)
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

  async function handleDomainSearch() {
    if (!domainQuery.trim() || domainSearching) return
    setDomainSearching(true)
    setDomainResults([])
    try {
      const res = await fetch(`/api/domains/search?q=${encodeURIComponent(domainQuery.trim())}`)
      const data = await res.json()
      setDomainResults(data.results ?? [])
    } catch {}
    setDomainSearching(false)
  }

  async function handleDomainBuy(domain: string, price: number) {
    setDomainPurchasing(true)
    try {
      const res = await fetch('/api/domains/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, projectId, price, includeProtection: true }),
      })
      const data = await res.json()
      if (data.url) window.open(data.url, '_blank')
    } catch {}
    setDomainPurchasing(false)
  }

  async function handleDomainConnect() {
    if (!domainConnectInput.trim() || domainConnecting) return
    setDomainConnecting(true)
    setDomainConnectResult(null)
    try {
      const res = await fetch('/api/domains/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainConnectInput.trim(), projectId }),
      })
      const data = await res.json()
      if (data.instructions) setDomainConnectResult({ instructions: data.instructions, dnsValue: data.dnsValue })
    } catch {}
    setDomainConnecting(false)
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

  async function handleSaveManifest(_updatedManifest: ShopManifest, _prompt: string): Promise<boolean> {
    // Manifest editing is no longer supported in the code-gen approach.
    // Direct edits should be done via chat (iterate).
    return false
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

  async function handleVisionAnalyze(file: File) {
    if (!currentManifest) return
    setIsVisionAnalyzing(true)
    setVisionResult(null)
    try {
      // Convert to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const mimeType = file.type || 'image/jpeg'
      const res = await fetch('/api/quante/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType, projectId }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'Vision analysis failed'); return }
      setVisionResult(data.vision)
      if (data.balanceAfter !== undefined) setBalance(data.balanceAfter)
    } catch { alert('Vision analysis failed.') }
    finally { setIsVisionAnalyzing(false) }
  }

  async function handleApplyVision() {
    if (!visionResult || !currentManifest) return
    const v = visionResult
    const updated: ShopManifest = {
      ...currentManifest,
      brand: { ...currentManifest.brand, voice: (v.voice as ShopManifest['brand']['voice']) ?? currentManifest.brand.voice },
      design: {
        ...currentManifest.design,
        palette: { ...currentManifest.design.palette, ...(v.palette as ShopManifest['design']['palette']) },
        typography: {
          ...currentManifest.design.typography,
          headingFont: v.typography.headingFont || currentManifest.design.typography.headingFont,
          bodyFont: v.typography.bodyFont || currentManifest.design.typography.bodyFont,
          scale: (v.typography.scale as ShopManifest['design']['typography']['scale']) || currentManifest.design.typography.scale,
        },
        radius: (v.radius as ShopManifest['design']['radius']) || currentManifest.design.radius,
        density: (v.density as ShopManifest['design']['density']) || currentManifest.design.density,
        motion: (v.motion as ShopManifest['design']['motion']) || currentManifest.design.motion,
      },
    }
    const ok = await handleSaveManifest(updated, 'Vision: applied image brand extraction')
    if (ok) setVisionResult(null)
  }

  async function handleImageSuggest() {
    if (!productDraft) return
    setIsSuggestingImages(true)
    setSuggestedImages(null)
    try {
      const res = await fetch('/api/quante/image-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: productDraft.name, productDescription: productDraft.description, projectId }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'Image suggestion failed'); return }
      setSuggestedImages(data.images ?? [])
      if (data.balanceAfter !== undefined) setBalance(data.balanceAfter)
    } catch { alert('Image suggestion failed.') }
    finally { setIsSuggestingImages(false) }
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
                ? { id: productDraft.id, name: productDraft.name, description: productDraft.description, price: parseFloat(productDraft.price) || 0, compareAtPrice: parseFloat(productDraft.compareAtPrice) || undefined, slug: productDraft.slug || toSlug(productDraft.name), images: productDraft.images, available: productDraft.available, tags: productDraft.tags ? productDraft.tags.split(',').map(t => t.trim()).filter(Boolean) : [] }
                : p
            )
          : [
              ...currentManifest.catalog.products,
              { id: productDraft.id, name: productDraft.name, description: productDraft.description, price: parseFloat(productDraft.price) || 0, compareAtPrice: parseFloat(productDraft.compareAtPrice) || undefined, slug: productDraft.slug || toSlug(productDraft.name), images: productDraft.images, available: productDraft.available, tags: productDraft.tags ? productDraft.tags.split(',').map(t => t.trim()).filter(Boolean) : [] },
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
      featureRow:   { title: 'Why choose us', features: [{ icon: 'star', title: 'Feature', description: 'Description' }], layout: 'grid' },
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
  const liveUrlRaw = liveDeployment?.customDomain
    ? `https://${liveDeployment.customDomain}`
    : deployUrl || liveDeployment?.url
  const liveUrl = (liveUrlRaw && !liveUrlRaw.includes('://null')) ? liveUrlRaw : null

  // Publish readiness checklist
  const publishChecklist = currentManifest ? [
    { id: 'merchant', label: 'Business info (IČO, address, contact)', ok: !!(currentManifest.merchant?.ico && currentManifest.merchant?.obchodni_nazev && currentManifest.merchant?.kontakt?.email) },
    { id: 'legal', label: '4 legal pages in footer', ok: ['obchodni-podminky', 'ochrana-osobnich-udaju', 'cookies', 'kontakt'].every(slug => currentManifest.customPages?.some(p => p.slug === slug)) },
    { id: 'payment', label: 'At least 1 payment method', ok: !!(currentManifest.payments?.providers?.length || currentManifest.payments?.dobirka?.enabled || currentManifest.payments?.prevod?.enabled) },
    { id: 'shipping', label: 'At least 1 shipping method', ok: !!(currentManifest.shipping?.methods?.length) },
    { id: 'products', label: 'At least 1 product with price', ok: currentManifest.catalog.products.length > 0 && currentManifest.catalog.products.every(p => p.price > 0) },
    { id: 'product_images', label: 'Every product has at least 1 image', ok: currentManifest.catalog.products.length > 0 && currentManifest.catalog.products.every(p => (p.images?.length ?? 0) > 0) },
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

      {!hasGeneratedOnce ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>Generate a store first.</p>
        </div>
      ) : !currentManifest ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>Use the chat to add or edit products — e.g. &quot;add a new product&quot;.</p>
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
            {/* AI image suggest */}
            <button
              onClick={handleImageSuggest}
              disabled={isSuggestingImages || !productDraft.name.trim()}
              style={{ marginTop: 8, width: '100%', fontSize: 11, padding: '5px', borderRadius: 7, border: '1px dashed rgba(111,120,230,.35)', background: 'rgba(111,120,230,.05)', color: isSuggestingImages ? '#8a8a93' : '#a5b4fc', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
            >
              {isSuggestingImages ? '✦ Finding images…' : '✦ Find product images · 1 credit'}
            </button>
            {/* Suggested images grid */}
            {suggestedImages && suggestedImages.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <p style={{ fontSize: 10, color: '#8a8a93' }}>Click to add</p>
                  <button onClick={() => setSuggestedImages(null)} style={{ fontSize: 10, color: '#5b5b64', background: 'none', border: 'none', cursor: 'pointer' }}>✕ Close</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                  {suggestedImages.slice(0, 9).map((img, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setProductDraft(d => d ? { ...d, images: d.images.includes(img.url) ? d.images : [...d.images, img.url] } : d)
                      }}
                      title={`Photo by ${img.credit} on Unsplash`}
                      style={{ padding: 0, border: '2px solid transparent', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', background: 'none', aspectRatio: '1', transition: 'border-color 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = '#6f78e6')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.thumb} alt={img.alt} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: 9, color: '#5b5b64', marginTop: 4, textAlign: 'center' }}>Photos via Unsplash</p>
              </div>
            )}
          </div>

          {fldLabel('Name *')}
          <input style={inputSt} value={productDraft.name} onChange={e => setProductDraft(d => d ? { ...d, name: e.target.value, slug: toSlug(e.target.value) } : d)} />
          {fldLabel('Price')}
          <input style={inputSt} type="number" min="0" step="0.01" value={productDraft.price} onChange={e => setProductDraft(d => d ? { ...d, price: e.target.value } : d)} placeholder={`${currentManifest.catalog.currency} 0.00`} />
          {fldLabel('Compare-at price (original / sale)')}
          <input style={inputSt} type="number" min="0" step="0.01" value={productDraft.compareAtPrice} onChange={e => setProductDraft(d => d ? { ...d, compareAtPrice: e.target.value } : d)} placeholder="Leave empty if not on sale" />
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
                    {p.compareAtPrice && p.compareAtPrice > p.price && (
                      <span style={{ marginLeft: 6, textDecoration: 'line-through', opacity: 0.5 }}>{p.compareAtPrice}</span>
                    )}
                    {p.compareAtPrice && p.compareAtPrice > p.price && (
                      <span style={{ marginLeft: 6, color: '#22c55e', fontWeight: 600 }}>SALE</span>
                    )}
                    {!p.available && <span style={{ marginLeft: 6, color: '#e0564f' }}>· unavailable</span>}
                  </p>
                </div>

                {/* Edit */}
                <button
                  onClick={() => setProductDraft({ id: p.id, name: p.name, description: p.description, price: String(p.price), compareAtPrice: p.compareAtPrice ? String(p.compareAtPrice) : '', slug: p.slug, tags: (p.tags ?? []).join(', '), images: p.images, available: p.available })}
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
            onClick={() => { setAdminMode(true); handleLoadStoreOrders() }}
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

        {/* Credit balance / Agency indicator */}
        {isAgency ? (
          <span style={{
            fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '.05em',
            padding: '2px 8px', borderRadius: 99,
            background: 'rgba(62,207,142,.08)',
            color: '#3ecf8e', border: '1px solid rgba(62,207,142,.2)',
          }}>
            Priority
          </span>
        ) : (
          <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, color: '#8a8a93' }}>
            {balance} cr
          </span>
        )}

        {/* Preview / Logs toggle (desktop only) */}
        {isDesktop && hasGeneratedOnce && (
          <div style={{
            display: 'flex', borderRadius: 7,
            border: '1px solid rgba(255,255,255,.1)',
            background: 'rgba(255,255,255,.04)',
            overflow: 'hidden',
          }}>
            <button
              onClick={() => setRightPanel('preview')}
              style={{
                fontSize: 11, fontWeight: 500, padding: '4px 9px',
                border: 'none', cursor: 'pointer', transition: 'all 0.12s',
                background: rightPanel === 'preview' ? 'rgba(111,120,230,.18)' : 'transparent',
                color: rightPanel === 'preview' ? '#a8afff' : '#8a8a93',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <Monitor size={11} /> Preview
            </button>
            <button
              onClick={() => setRightPanel('logs')}
              style={{
                fontSize: 11, fontWeight: 500, padding: '4px 9px',
                border: 'none', borderLeft: '1px solid rgba(255,255,255,.08)',
                cursor: 'pointer', transition: 'all 0.12s',
                background: rightPanel === 'logs' ? 'rgba(111,120,230,.18)' : 'transparent',
                color: rightPanel === 'logs' ? '#a8afff' : '#8a8a93',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <Terminal size={11} /> Logs
              {buildError && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f87171', marginLeft: 2 }} />
              )}
            </button>
          </div>
        )}

        {/* Export + Live (desktop only) */}
        {isDesktop && (
          <>
            <div style={{ position: 'relative', display: 'flex' }}>
              <button
                onClick={() => handleExport(false)}
                disabled={!hasGeneratedOnce || isExporting || isExportingAdmin}
                style={{
                  fontSize: 11, fontWeight: 500,
                  padding: '4px 10px', borderRadius: 6,
                  border: '1px solid rgba(255,255,255,.12)',
                  background: 'rgba(255,255,255,.04)',
                  color: hasGeneratedOnce ? '#f4f4f6' : '#8a8a93',
                  cursor: hasGeneratedOnce && !isExporting ? 'pointer' : 'not-allowed',
                  opacity: hasGeneratedOnce ? 1 : 0.4,
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
                disabled={!hasGeneratedOnce || isDeploying || deployStatus === 'building'}
                style={{
                  fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 6,
                  border: '1px solid rgba(62,207,142,.25)',
                  background: hasGeneratedOnce && !isDeploying ? 'rgba(62,207,142,.08)' : 'transparent',
                  color: hasGeneratedOnce && !isDeploying ? '#3ecf8e' : '#8a8a93',
                  cursor: hasGeneratedOnce && !isDeploying ? 'pointer' : 'not-allowed',
                  opacity: hasGeneratedOnce ? 1 : 0.4,
                }}
              >
                {isDeploying || deployStatus === 'building' ? '⟳ Deploying' : 'Deploy live'}
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
              {hasGeneratedOnce ? 'Store ready — iterate freely' : 'Describe your store'}
            </p>
            <p style={{ fontSize: 12, color: '#8a8a93', lineHeight: 1.5 }}>
              {hasGeneratedOnce
                ? 'Tell Quante what to change — copy, colors, products, new pages, anything.'
                : 'Brand, products, vibe, currency. Quante generates the full code.'}
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
        {hasGeneratedOnce && !isGenerating && (
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
            placeholder={!hasGeneratedOnce ? 'Describe your store — we\'ll build the whole thing…' : 'Anything — new page, different design, rewrite copy, add products…'}
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
              {!hasGeneratedOnce ? '10 cr' : '1 cr'}
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
      {!hasGeneratedOnce ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '3rem 1.5rem', gap: 8 }}>
          <Layers size={28} style={{ color: '#5b5b64' }} />
          <p style={{ fontSize: 14, color: '#8a8a93', textAlign: 'center' }}>Generate a store first to manage sections.</p>
        </div>
      ) : !currentManifest ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '3rem 1.5rem', gap: 8 }}>
          <Layers size={28} style={{ color: '#5b5b64' }} />
          <p style={{ fontSize: 14, color: '#8a8a93', textAlign: 'center' }}>Use the chat to add or rearrange sections — e.g. &quot;add a testimonials section&quot;.</p>
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

      {/* IMAGE→BRAND vision */}
      <section>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a8a93', fontFamily: 'var(--font-geist-mono)', marginBottom: 8 }}>Image → Brand</p>
        <input ref={visionInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleVisionAnalyze(file)
          e.target.value = ''
        }} />
        {!visionResult ? (
          <button
            onClick={() => visionInputRef.current?.click()}
            disabled={isVisionAnalyzing}
            style={{
              width: '100%', padding: '10px', borderRadius: 8, border: '1px dashed rgba(111,120,230,.4)',
              background: 'rgba(111,120,230,.05)', color: isVisionAnalyzing ? '#8a8a93' : '#a5b4fc',
              fontSize: 12, cursor: isVisionAnalyzing ? 'not-allowed' : 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {isVisionAnalyzing ? '✦ Analysing…' : '↑ Upload inspiration photo · 1 credit'}
          </button>
        ) : (
          <div style={{ borderRadius: 10, border: '1px solid rgba(62,207,142,.25)', background: 'rgba(62,207,142,.04)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {Object.entries(visionResult.palette).map(([k, v]) => (
                <div key={k} title={`${k}: ${v}`} style={{ width: 22, height: 22, borderRadius: 4, background: v as string, border: '1px solid rgba(255,255,255,.1)', flexShrink: 0 }} />
              ))}
            </div>
            <p style={{ fontSize: 11, color: '#8a8a93', margin: 0, lineHeight: 1.5 }}>{visionResult.reasoning}</p>
            <p style={{ fontSize: 11, color: '#a5b4fc', margin: 0 }}>
              {visionResult.typography.headingFont} + {visionResult.typography.bodyFont} · {visionResult.voice} · {visionResult.radius} radius
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={handleApplyVision}
                disabled={isSavingManifest}
                style={{ flex: 1, padding: '7px', borderRadius: 7, border: 'none', background: 'var(--live)', color: '#000', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >
                Apply to store
              </button>
              <button
                onClick={() => setVisionResult(null)}
                style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', background: 'transparent', color: '#8a8a93', fontSize: 11, cursor: 'pointer' }}
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </section>

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
  ) : hasGeneratedOnce ? (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 1.5rem' }}>
      <p style={{ fontSize: 12, color: '#8a8a93' }}>Use the chat to change design — e.g. &ldquo;change accent to blue&rdquo; or &ldquo;use a minimal font&rdquo;.</p>
    </div>
  ) : (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ fontSize: 12, color: '#8a8a93' }}>Generate a store to unlock Theme controls.</p>
    </div>
  )

  const PublishPanel = (
    <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── 0. Domain section ────────────────────────────────────────────────── */}
      <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>🌐</span>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e0e0e8' }}>Your Domain</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#5b5b64' }}>Buy a domain or connect one you already own</p>
          </div>
        </div>
        <div style={{ padding: '16px' }}>
          {/* Search */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input
              value={domainQuery}
              onChange={e => setDomainQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleDomainSearch() }}
              placeholder="mystorename"
              style={{
                flex: 1, padding: '9px 12px', borderRadius: 8, fontSize: 13,
                border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)',
                color: '#e0e0e8', outline: 'none',
              }}
            />
            <button
              onClick={handleDomainSearch}
              disabled={domainSearching || !domainQuery.trim()}
              style={{
                padding: '9px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: '1px solid rgba(111,120,230,.3)', background: 'rgba(111,120,230,.12)',
                color: '#6f78e6', cursor: domainSearching || !domainQuery.trim() ? 'not-allowed' : 'pointer',
                opacity: domainSearching || !domainQuery.trim() ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              {domainSearching ? '…' : 'Search'}
            </button>
          </div>

          {/* Search results */}
          {domainResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {domainResults.map(r => (
                <div key={r.domain} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '9px 12px', borderRadius: 8,
                  border: `1px solid ${r.available ? 'rgba(62,207,142,.2)' : 'rgba(255,255,255,.05)'}`,
                  background: r.available ? 'rgba(62,207,142,.04)' : 'rgba(255,255,255,.02)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.available ? '#3ecf8e' : '#4a4a55', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontFamily: 'var(--font-geist-mono)', color: r.available ? '#e0e0e8' : '#5b5b64' }}>{r.domain}</span>
                  </div>
                  {r.available ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: '#8a8a93', fontFamily: 'var(--font-geist-mono)' }}>${r.price.toFixed(2)}/yr</span>
                      <button
                        onClick={() => handleDomainBuy(r.domain, r.price)}
                        disabled={domainPurchasing}
                        style={{
                          padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                          border: 'none', background: '#3ecf8e', color: '#0a0a0e',
                          cursor: domainPurchasing ? 'not-allowed' : 'pointer', opacity: domainPurchasing ? 0.6 : 1,
                        }}
                      >
                        Buy
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: '#4a4a55' }}>taken</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Owned domains */}
          {ownedDomains.filter(d => !d.project_id || d.project_id === projectId).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 8px' }}>Your domains</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ownedDomains.filter(d => !d.project_id || d.project_id === projectId).map(d => (
                  <div key={d.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.07)',
                    background: 'rgba(255,255,255,.02)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: d.status === 'active' ? '#3ecf8e' : d.status === 'pending' ? '#fbbf24' : '#f87171' }} />
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono)', color: '#d0d0da' }}>{d.domain}</span>
                    </div>
                    <span style={{ fontSize: 10, color: '#5b5b64', textTransform: 'uppercase' }}>
                      {d.dns_verified ? 'verified' : d.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Connect own domain */}
          <div>
            <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 8px' }}>Connect existing domain</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={domainConnectInput}
                onChange={e => setDomainConnectInput(e.target.value)}
                placeholder="yourstore.com"
                style={{
                  flex: 1, padding: '9px 12px', borderRadius: 8, fontSize: 13,
                  border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)',
                  color: '#e0e0e8', outline: 'none',
                }}
              />
              <button
                onClick={handleDomainConnect}
                disabled={domainConnecting || !domainConnectInput.trim()}
                style={{
                  padding: '9px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.06)',
                  color: '#d0d0da', cursor: domainConnecting || !domainConnectInput.trim() ? 'not-allowed' : 'pointer',
                  opacity: domainConnecting || !domainConnectInput.trim() ? 0.5 : 1, flexShrink: 0,
                }}
              >
                {domainConnecting ? '…' : 'Connect'}
              </button>
            </div>
            {domainConnectResult && (
              <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 8, background: 'rgba(111,120,230,.06)', border: '1px solid rgba(111,120,230,.15)' }}>
                <p style={{ margin: '0 0 8px', fontSize: 11, color: '#6f78e6', fontFamily: 'var(--font-geist-mono)', fontWeight: 600 }}>Add this DNS record:</p>
                <pre style={{ margin: 0, fontSize: 11, color: '#d0d0da', fontFamily: 'var(--font-geist-mono)', whiteSpace: 'pre-wrap' }}>{domainConnectResult.instructions}</pre>
                <button
                  onClick={() => navigator.clipboard.writeText(domainConnectResult!.dnsValue)}
                  style={{ marginTop: 8, fontSize: 11, color: '#6f78e6', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Copy DNS value
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

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
        {(deployStatus === 'ready' || (liveDeployment?.domain && liveDeployment?.status === 'ready')) && liveUrl ? (
          /* Live card */
          <div style={{ borderRadius: 10, border: '1px solid rgba(62,207,142,.25)', background: 'rgba(62,207,142,.05)', padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--live)', boxShadow: '0 0 8px rgba(62,207,142,.6)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--live)' }}>Live</span>
            </div>
            <p style={{ fontSize: 13, fontFamily: 'var(--font-geist-mono)', color: '#f4f4f6', wordBreak: 'break-all', marginBottom: 12 }}>
              {liveDomain ?? liveUrl}
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, minWidth: 80, fontSize: 12, fontWeight: 600, padding: '8px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'var(--live)', color: '#000', textDecoration: 'none', textAlign: 'center' }}
              >
                Visit ↗
              </a>
              <button
                onClick={() => navigator.clipboard.writeText(liveUrl ?? '')}
                style={{ fontSize: 12, padding: '8px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', background: 'transparent', color: '#8a8a93', cursor: 'pointer' }}
              >
                Copy
              </button>
              <button
                onClick={handlePreviewDeploy}
                disabled={isPreviewDeploying || isDeploying}
                title="Preview deploy — 2 credits, unique URL"
                style={{ fontSize: 12, padding: '8px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', background: 'transparent', color: '#8a8a93', cursor: isPreviewDeploying ? 'not-allowed' : 'pointer', opacity: isPreviewDeploying ? 0.5 : 1 }}
              >
                {isPreviewDeploying ? '…' : 'Preview'}
              </button>
              <button
                onClick={handleDeploy}
                disabled={isDeploying || isPreviewDeploying}
                title="Production redeploy — 5 credits"
                style={{ fontSize: 12, padding: '8px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', background: 'transparent', color: '#8a8a93', cursor: isDeploying ? 'not-allowed' : 'pointer', opacity: isDeploying ? 0.5 : 1 }}
              >
                {isDeploying ? '…' : '⟳ Prod'}
              </button>
            </div>
          </div>
        ) : deployStatus === 'building' || (liveDeployment?.domain && liveDeployment?.status === 'building') ? (
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
            <p style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>Deploy your store</p>
            <p style={{ fontSize: 12, color: '#8a8a93', lineHeight: 1.5, margin: 0 }}>
              <strong style={{ color: '#f4f4f6' }}>Production</strong> — goes live on your <span style={{ fontFamily: 'var(--font-geist-mono)' }}>.quante.app</span> subdomain (5 cr).<br />
              <strong style={{ color: '#f4f4f6' }}>Preview</strong> — unique URL for testing, doesn&apos;t affect live store (2 cr).
            </p>
            {!hostingInfo.subscribed && !hostingInfo.trialEndsAt && (
              <p style={{ fontSize: 11, color: '#e0a04f', margin: 0 }}>First production deploy starts your 30-day free trial.</p>
            )}
            {!hasGeneratedOnce ? (
              <p style={{ fontSize: 12, color: '#5b5b64', margin: 0, textAlign: 'center' }}>Generate a store first</p>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handlePreviewDeploy}
                  disabled={isPreviewDeploying || isDeploying}
                  style={{
                    flex: 1, padding: '9px', fontSize: 12, fontWeight: 600, borderRadius: 7,
                    border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)',
                    color: isPreviewDeploying || isDeploying ? '#5b5b64' : '#f4f4f6',
                    cursor: isPreviewDeploying || isDeploying ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isPreviewDeploying ? '⟳ …' : 'Preview — 2 cr'}
                </button>
                <button
                  onClick={handleDeploy}
                  disabled={isDeploying || isPreviewDeploying || !checklistAllOk}
                  style={{
                    flex: 1, padding: '9px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none',
                    cursor: isDeploying || isPreviewDeploying || !checklistAllOk ? 'not-allowed' : 'pointer',
                    background: checklistAllOk ? 'var(--live)' : 'rgba(255,255,255,.06)',
                    color: checklistAllOk ? '#000' : '#5b5b64',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {isDeploying ? '⟳ …' : !checklistAllOk ? 'Complete checklist' : 'Production — 5 cr'}
                </button>
              </div>
            )}
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

  // ── Logs Panel ────────────────────────────────────────────────────────────────
  const LogsPane = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#09090c', overflow: 'hidden', minWidth: 0 }}>
      {/* Toolbar */}
      <div style={{ flexShrink: 0, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,.06)', background: '#0d0d11' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Terminal size={13} color="#8a8a93" />
          <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93' }}>Build logs</span>
          {logEventSourceRef.current && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#6f78e6' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6f78e6', animation: 'blink 1s ease-in-out infinite' }} />
              live
            </span>
          )}
        </div>
        <button
          onClick={() => setDeployLogs([])}
          style={{ fontSize: 10, color: '#5b5b64', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Clear
        </button>
      </div>

      {/* Log lines */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', fontFamily: 'var(--font-geist-mono)', fontSize: 11, lineHeight: 1.7 }}>
        {deployLogs.length === 0 ? (
          <p style={{ color: '#5b5b64', margin: 0 }}>No logs yet. Generate or iterate to start a build.</p>
        ) : (
          deployLogs.map((line, i) => (
            <div key={i} style={{ color: line.type === 'stderr' || line.text.includes('Error') || line.text.includes('error') ? '#f87171' : '#c8c8d0' }}>
              {line.text}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Build error card */}
      {buildError && (
        <div style={{ flexShrink: 0, margin: '0 12px 12px', padding: '12px', borderRadius: 10, border: '1px solid rgba(248,113,113,.3)', background: 'rgba(248,113,113,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <AlertCircle size={16} color="#f87171" style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#f87171', margin: '0 0 4px' }}>Build error</p>
              <p style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#f4f4f6', margin: '0 0 2px', wordBreak: 'break-all' }}>
                {buildError.filePath}{buildError.line ? `:${buildError.line}` : ''}
              </p>
              <p style={{ fontSize: 11, color: '#c8c8d0', margin: '0 0 10px', lineHeight: 1.5 }}>
                {buildError.message}
              </p>
              <button
                onClick={handleFix}
                disabled={isFixing}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, fontWeight: 600,
                  padding: '6px 14px', borderRadius: 7,
                  border: '1px solid rgba(111,120,230,.4)',
                  background: isFixing ? 'transparent' : 'rgba(111,120,230,.12)',
                  color: isFixing ? '#5b5b64' : '#a8afff',
                  cursor: isFixing ? 'not-allowed' : 'pointer',
                }}
              >
                <Wrench size={12} />
                {isFixing ? 'Fixing…' : 'Fix this error · 2 cr'}
              </button>
            </div>
          </div>
        </div>
      )}
      {isFixing && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,.05)', fontSize: 11, color: '#6f78e6', fontFamily: 'var(--font-geist-mono)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid rgba(111,120,230,.3)', borderTopColor: '#6f78e6', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
          Auto-fixing error (attempt {autoFixAttempts}/{MAX_AUTO_FIX})…
        </div>
      )}
      {!isFixing && autoFixAttempts >= MAX_AUTO_FIX && buildError && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,.05)', fontSize: 11, color: '#f87171', fontFamily: 'var(--font-geist-mono)' }}>
          Auto-fix failed after {MAX_AUTO_FIX} attempts. Try describing the fix in chat.
        </div>
      )}
    </div>
  )

  // ── Preview Pane ──────────────────────────────────────────────────────────────
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
          {previewUrl && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {previewUrl.replace('https://', '')}
            </span>
          )}
          {latestVersion && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64' }}>
              v{latestVersion.version_no}
            </span>
          )}
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" title="Open preview in new tab" style={{ width: 24, height: 24, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5b5b64', textDecoration: 'none' }}>
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      {/* Preview area */}
      <div style={{
        flex: 1, position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      }}>
        {showPushToLive && !isDeploying ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 18, textAlign: 'center', padding: '0 32px' }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: 'rgba(62,207,142,.1)', border: '1px solid rgba(62,207,142,.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22,
            }}>
              🚀
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#f4f4f6', margin: '0 0 6px', letterSpacing: '-.01em' }}>
                Store ready to publish
              </p>
              <p style={{ fontSize: 12, color: '#8a8a93', margin: 0, lineHeight: 1.6 }}>
                Push to Live to deploy your store to{' '}
                <span style={{ color: '#f4f4f6', fontFamily: 'var(--font-geist-mono)', fontSize: 11 }}>
                  {storeUrl?.replace('https://', '') ?? 'your domain'}
                </span>
              </p>
            </div>
            <button
              onClick={handleDeploy}
              disabled={isDeploying}
              style={{
                fontSize: 13, fontWeight: 700, padding: '10px 28px',
                borderRadius: 9, border: 'none', cursor: 'pointer',
                background: 'rgba(62,207,142,1)', color: '#000',
                boxShadow: '0 0 24px rgba(62,207,142,.35)',
                transition: 'opacity 0.15s',
              }}
            >
              Push to Live — 5 cr
            </button>
            <p style={{ fontSize: 11, color: '#3a3a44', margin: 0 }}>
              Takes ~2 min on Vercel
            </p>
          </div>
        ) : !previewUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
            <div>
              <p style={{ color: 'rgba(255,255,255,.18)', fontSize: 13, fontFamily: 'var(--font-geist-mono)', marginBottom: 6 }}>no preview yet</p>
              {hasGeneratedOnce ? (
                <button
                  onClick={() => triggerRedeploy()}
                  style={{
                    marginTop: 12, fontSize: 12, fontWeight: 600, padding: '7px 16px',
                    borderRadius: 7, border: '1px solid rgba(111,120,230,.3)',
                    background: 'rgba(111,120,230,.08)', color: '#6f78e6', cursor: 'pointer',
                  }}
                >
                  ⟳ Rebuild preview
                </button>
              ) : (
                <p style={{ color: 'rgba(255,255,255,.1)', fontSize: 11 }}>Describe a store to generate and deploy a preview</p>
              )}
            </div>
          </div>
        ) : !previewReady ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid rgba(255,255,255,.08)', borderTopColor: '#6f78e6', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: 12, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)', margin: 0 }}>Building on Vercel…</p>
            <p style={{ fontSize: 11, color: '#3a3a44', margin: 0 }}>Usually takes 1–2 minutes. Check the logs tab.</p>
          </div>
        ) : previewDevice === 'desktop' ? (
          <iframe
            src={previewUrl}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Store preview"
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
              src={previewUrl}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title="Store preview"
            />
          </div>
        )}

        {isDeploying && (
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
                deploying…
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
    { id: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
    { id: 'orders',     label: 'Orders',     icon: ClipboardList   },
    { id: 'products',   label: 'Products',   icon: ShoppingBag     },
    { id: 'customers',  label: 'Customers',  icon: Users           },
    { id: 'settings',   label: 'Settings',   icon: Settings2       },
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
          { label: 'Customers', value: customers.length > 0 ? String(customers.length) : null, empty: '0', icon: Users, color: '#a5b4fc' },
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

      {/* Revenue chart */}
      <RevenueChart projectId={projectId} />

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
            { label: 'Customers', sub: 'Profiles + order history', action: () => { setAdminTab('customers'); handleLoadCustomers() }, icon: Users },
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

      {/* Tab switcher: Store orders vs Stripe */}
      <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.04)', borderRadius: 9, padding: 4, alignSelf: 'flex-start' }}>
        {[
          { id: 'store' as const, label: 'Packeta / Comgate' },
          { id: 'stripe' as const, label: 'Stripe' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => {
              setOrdersTab(id)
              if (id === 'store' && storeOrders.length === 0) handleLoadStoreOrders()
              if (id === 'stripe' && orders.length === 0 && !ordersError) handleLoadOrders()
            }}
            style={{
              fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
              border: 'none', cursor: 'pointer', transition: 'all 0.12s',
              background: ordersTab === id ? 'rgba(255,255,255,.09)' : 'transparent',
              color: ordersTab === id ? '#f4f4f6' : '#8a8a93',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {ordersTab === 'store' ? (
        /* ── Supabase store_orders (Zásilkovna / Comgate / bank) ── */
        isLoadingStoreOrders ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 56, borderRadius: 8, background: 'rgba(255,255,255,.04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        ) : storeOrders.length === 0 ? (
          <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.07)', padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            <ClipboardList size={36} style={{ color: '#5b5b64' }} />
            <p style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>No orders yet</p>
            <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>Orders via Packeta, Comgate and bank transfer will appear here.</p>
            <button onClick={handleLoadStoreOrders} style={{ fontSize: 11, color: '#8a8a93', background: 'none', border: 'none', cursor: 'pointer' }}>↻ Refresh</button>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ borderRadius: 10, border: '1px solid rgba(62,207,142,.2)', background: 'rgba(62,207,142,.04)', padding: '14px 16px' }}>
                <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Revenue (paid)</p>
                <p style={{ fontSize: 24, fontWeight: 700, color: 'var(--live)', fontFamily: 'var(--font-geist-mono)', margin: 0 }}>
                  {currency} {storeOrderRevenue.toFixed(2)}
                </p>
              </div>
              <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', background: '#0d0d11', padding: '14px 16px' }}>
                <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Orders</p>
                <p style={{ fontSize: 24, fontWeight: 700, color: '#f4f4f6', fontFamily: 'var(--font-geist-mono)', margin: 0 }}>{storeOrders.length}</p>
              </div>
            </div>

            {/* Orders list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {storeOrders.map((o) => {
                const isZasilkovna = o.shippingMethod === 'zasilkovna'
                const shipped = o.status === 'shipped'
                const result = shipmentResults[o.id]
                const creating = creatingShipment === o.id
                const paid = o.paymentStatus === 'paid'

                return (
                  <div key={o.id} style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Row 1: customer + amount */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {o.customerName !== '—' ? o.customerName : o.customerEmail}
                        </p>
                        {o.customerName !== '—' && (
                          <p style={{ fontSize: 11, color: '#8a8a93', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.customerEmail}</p>
                        )}
                        <p style={{ fontSize: 10, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)', margin: '3px 0 0' }}>#{o.orderNumber}</p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', color: paid ? 'var(--live)' : '#f4f4f6', margin: 0 }}>
                          {o.amount.toFixed(2)} {o.currency}
                        </p>
                        <p style={{ fontSize: 10, color: '#8a8a93', fontFamily: 'var(--font-geist-mono)', margin: '2px 0 0' }}>{new Date(o.createdAt).toLocaleDateString('cs-CZ')}</p>
                      </div>
                    </div>

                    {/* Row 2: badges */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: paid ? 'rgba(62,207,142,.12)' : 'rgba(224,160,79,.12)', color: paid ? 'var(--live)' : '#e0a04f' }}>
                        {paid ? 'Paid' : o.paymentStatus}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: 'rgba(255,255,255,.06)', color: '#8a8a93' }}>
                        {o.paymentMethod}
                      </span>
                      {isZasilkovna && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: 'rgba(111,120,230,.12)', color: '#a5b4fc' }}>
                          📦 {o.zasilkovnaBranchCountry && o.zasilkovnaBranchCountry !== 'cz'
                            ? `Packeta International · ${o.zasilkovnaBranchCountry.toUpperCase()}`
                            : 'Packeta'}
                          {o.zasilkovnaBranchId ? ` #${o.zasilkovnaBranchId}` : ''}
                        </span>
                      )}
                      {shipped && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: 'rgba(62,207,142,.12)', color: 'var(--live)' }}>
                          ✓ Shipped
                        </span>
                      )}
                    </div>

                    {/* Zásilkovna action */}
                    {isZasilkovna && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                        {shipped || result?.barcode ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: 'var(--live)', fontWeight: 600 }}>
                              {o.trackingCode ?? result?.barcode}
                            </span>
                            {(o.trackingUrl ?? undefined) && (
                              <a href={o.trackingUrl ?? undefined} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 10, color: '#6f78e6', textDecoration: 'none' }}>
                                Track →
                              </a>
                            )}
                          </div>
                        ) : result?.error ? (
                          <p style={{ fontSize: 11, color: '#f87171', margin: 0 }}>{result.error}</p>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="number"
                              min="0.1"
                              step="0.1"
                              placeholder="kg"
                              value={shipmentWeights[o.id] ?? ''}
                              onChange={e => setShipmentWeights(p => ({ ...p, [o.id]: e.target.value }))}
                              style={{
                                width: 56, fontSize: 11, padding: '4px 7px', borderRadius: 5,
                                border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)',
                                color: '#f4f4f6', fontFamily: 'var(--font-geist-mono)',
                              }}
                              title="Shipment weight in kg (required for international carriers)"
                            />
                            <button
                              onClick={() => handleCreateShipment(o.id, parseFloat(shipmentWeights[o.id] ?? '1') || 1)}
                              disabled={creating || !paid}
                              title={!paid ? 'Order must be paid first' : 'Create shipment in Packeta'}
                              style={{
                                fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
                                border: '1px solid rgba(111,120,230,.3)', background: 'rgba(111,120,230,.08)',
                                color: '#a5b4fc', cursor: creating || !paid ? 'not-allowed' : 'pointer',
                                opacity: !paid ? 0.5 : 1,
                              }}
                            >
                              {creating ? 'Creating…' : '📦 Create shipment'}
                            </button>
                          </div>
                        )}
                        {o.invoiceUrl && (
                          <a href={o.invoiceUrl} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 10, color: '#8a8a93', textDecoration: 'none', alignSelf: 'flex-start' }}>
                            Invoice →
                          </a>
                        )}
                      </div>
                    )}
                    {/* DHL action */}
                    {o.shippingMethod === 'dhl' && (() => {
                      const dhlResult = dhlResults[o.id]
                      const shipped = o.status === 'shipped'
                      const paid = o.paymentStatus === 'paid'
                      const creatingDhl = creatingDhlShipment === o.id
                      const destCountry = o.shippingCountry ?? o.shippingAddress?.zeme ?? '?'
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: 'rgba(255,193,7,.12)', color: '#fbbf24' }}>
                              ✈️ DHL Express · {destCountry.toUpperCase()}
                            </span>
                          </div>
                          {shipped || dhlResult?.trackingNumber ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: 'var(--live)', fontWeight: 600 }}>
                                {o.trackingCode ?? dhlResult?.trackingNumber}
                              </span>
                              {(o.trackingUrl || dhlResult?.trackingUrl) && (
                                <a href={o.trackingUrl ?? dhlResult?.trackingUrl ?? ''} target="_blank" rel="noopener noreferrer"
                                  style={{ fontSize: 10, color: '#6f78e6', textDecoration: 'none' }}>
                                  Track →
                                </a>
                              )}
                              {dhlResult?.labelBase64 && (
                                <button
                                  onClick={() => downloadDhlLabel(o.id, o.orderNumber, dhlResult.labelBase64!)}
                                  style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(255,193,7,.3)', background: 'rgba(255,193,7,.08)', color: '#fbbf24', cursor: 'pointer' }}
                                >
                                  ⬇ PDF Label
                                </button>
                              )}
                            </div>
                          ) : dhlResult?.error ? (
                            <p style={{ fontSize: 11, color: '#f87171', margin: 0 }}>{dhlResult.error}</p>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="number" min="0.1" step="0.1" placeholder="kg"
                                value={dhlWeights[o.id] ?? ''}
                                onChange={e => setDhlWeights(p => ({ ...p, [o.id]: e.target.value }))}
                                title="Shipment weight in kg"
                                style={{ width: 56, fontSize: 11, padding: '4px 7px', borderRadius: 5, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)', color: '#f4f4f6', fontFamily: 'var(--font-geist-mono)' }}
                              />
                              <button
                                onClick={() => handleCreateDhlShipment(o.id, { weight: parseFloat(dhlWeights[o.id] ?? '1') || 1 })}
                                disabled={creatingDhl || !paid}
                                title={!paid ? 'Order must be paid first' : 'Send via DHL Express'}
                                style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(255,193,7,.3)', background: 'rgba(255,193,7,.08)', color: '#fbbf24', cursor: creatingDhl || !paid ? 'not-allowed' : 'pointer', opacity: !paid ? 0.5 : 1 }}
                              >
                                {creatingDhl ? 'Creating…' : '✈️ Send DHL'}
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    {!isZasilkovna && o.shippingMethod !== 'dhl' && o.invoiceUrl && (
                      <a href={o.invoiceUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 10, color: '#8a8a93', textDecoration: 'none', alignSelf: 'flex-start' }}>
                        Faktura →
                      </a>
                    )}
                  </div>
                )
              })}
            </div>

            <button onClick={handleLoadStoreOrders} style={{ alignSelf: 'flex-start', fontSize: 11, color: '#8a8a93', background: 'none', border: 'none', cursor: 'pointer' }}>↻ Refresh</button>
          </>
        )
      ) : (
        /* ── Stripe orders ── */
        ordersError === 'no_key' ? (
          <div style={{ borderRadius: 12, border: '1px solid rgba(111,120,230,.25)', background: 'rgba(111,120,230,.05)', padding: '28px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            <Settings2 size={32} style={{ color: '#5b5b64' }} />
            <p style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>Connect your Stripe account</p>
            <p style={{ fontSize: 13, color: '#8a8a93', lineHeight: 1.6, maxWidth: 320, margin: 0 }}>
              Add your store&apos;s Stripe secret key in Settings to view Stripe orders here.
            </p>
            <button onClick={() => setAdminTab('settings')} style={{ fontSize: 12, fontWeight: 600, padding: '8px 20px', borderRadius: 7, border: 'none', background: '#6f78e6', color: '#fff', cursor: 'pointer' }}>
              Go to Settings
            </button>
          </div>
        ) : isLoadingOrders ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 56, borderRadius: 8, background: 'rgba(255,255,255,.04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        ) : ordersError ? (
          <div style={{ borderRadius: 10, border: '1px solid rgba(224,86,79,.25)', background: 'rgba(224,86,79,.05)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <p style={{ fontSize: 13, color: '#f87171', margin: 0 }}>{ordersError}</p>
            <button onClick={handleLoadOrders} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(224,86,79,.3)', background: 'transparent', color: '#f87171', cursor: 'pointer', flexShrink: 0 }}>Retry</button>
          </div>
        ) : orders.length === 0 ? (
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
          <>
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
            <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', overflow: 'hidden' }}>
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
        )
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const inpSt: React.CSSProperties = {
    width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 7,
    border: '1px solid var(--border)', background: 'var(--secondary)',
    color: 'var(--foreground)', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'var(--font-geist-mono)',
  }

  const AdminCustomers = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f4f4f6', margin: '0 0 2px' }}>Customers</h2>
          <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>
            {customers.length > 0 ? `${customers.length} unique customer${customers.length !== 1 ? 's' : ''}` : 'Aggregated from store orders'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {customers.length > 0 && (
            <button
              onClick={exportCustomersCsv}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(62,207,142,.35)', background: 'rgba(62,207,142,.07)', color: 'var(--live)', cursor: 'pointer' }}
            >
              ↓ Export CSV
            </button>
          )}
          <button
            onClick={handleLoadCustomers}
            disabled={isLoadingCustomers}
            style={{ fontSize: 11, padding: '6px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', background: 'transparent', color: '#8a8a93', cursor: 'pointer' }}
          >
            {isLoadingCustomers ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {isLoadingCustomers ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ height: 60, borderRadius: 10, background: 'rgba(255,255,255,.04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.07)', padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
          <Users size={36} style={{ color: '#5b5b64' }} />
          <p style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>No customers yet</p>
          <p style={{ fontSize: 13, color: '#8a8a93', margin: 0, maxWidth: 280, lineHeight: 1.5 }}>
            Customers appear here once orders come in from your live store.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {customers.map((c) => (
            <div key={c.email} style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {/* Avatar */}
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(111,120,230,.15)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(111,120,230,.25)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>
                  {(c.name || c.email).charAt(0).toUpperCase()}
                </span>
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name || '—'}
                </p>
                <p style={{ fontSize: 11, color: '#8a8a93', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</p>
                {c.phone && (
                  <p style={{ fontSize: 11, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)', margin: '1px 0 0' }}>{c.phone}</p>
                )}
              </div>

              {/* Stats */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', color: 'var(--live)', margin: 0 }}>
                  {c.currency} {c.totalSpent.toFixed(2)}
                </p>
                <p style={{ fontSize: 11, color: '#8a8a93', margin: '2px 0 0' }}>
                  {c.orderCount} order{c.orderCount !== 1 ? 's' : ''}
                </p>
                <p style={{ fontSize: 10, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)', margin: '2px 0 0' }}>
                  {new Date(c.lastOrderAt).toLocaleDateString('cs-CZ')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const AdminSettings = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>

      {/* Zásilkovna */}
      <div style={{ borderRadius: 12, border: '1px solid rgba(111,120,230,.2)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.07)', background: 'rgba(111,120,230,.04)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>📦</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>Zásilkovna / Packeta</p>
            <p style={{ fontSize: 11, color: '#8a8a93', margin: '2px 0 0' }}>
              API keys for the pickup-point widget and shipment creation. Find both in your
              {' '}<a href="https://client.packeta.com" target="_blank" rel="noopener noreferrer" style={{ color: '#a5b4fc', textDecoration: 'none' }}>Packeta client zone</a>.
            </p>
          </div>
        </div>
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: '#8a8a93', display: 'block', marginBottom: 5, fontFamily: 'var(--font-geist-mono)' }}>
              API key — widget (public)
              {hasZasilkovnaKey && <span style={{ color: 'var(--live)', marginLeft: 8 }}>✓ set</span>}
            </label>
            <input
              value={zasilkovnaKey}
              onChange={e => setZasilkovnaKey(e.target.value)}
              placeholder={hasZasilkovnaKey ? '••••••••••••••••' : 'Enter widget API key…'}
              style={inpSt}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#8a8a93', display: 'block', marginBottom: 5, fontFamily: 'var(--font-geist-mono)' }}>
              API password — shipments (private)
              {hasZasilkovnaPassword && <span style={{ color: 'var(--live)', marginLeft: 8 }}>✓ set</span>}
            </label>
            <input
              type="password"
              value={zasilkovnaPassword}
              onChange={e => setZasilkovnaPassword(e.target.value)}
              placeholder={hasZasilkovnaPassword ? '••••••••••••••••' : 'Enter API password…'}
              style={inpSt}
            />
          </div>
          <button
            onClick={handleSaveZasilkovna}
            disabled={isSavingZasilkovna || (!zasilkovnaKey && !zasilkovnaPassword)}
            style={{ width: '100%', padding: '9px', fontSize: 13, fontWeight: 600, borderRadius: 7, border: 'none', cursor: 'pointer', background: '#6f78e6', color: '#fff', opacity: isSavingZasilkovna || (!zasilkovnaKey && !zasilkovnaPassword) ? 0.5 : 1 }}
          >
            {isSavingZasilkovna ? 'Saving…' : 'Save Packeta keys'}
          </button>
          {(hasZasilkovnaKey && hasZasilkovnaPassword) && (
            <p style={{ fontSize: 11, color: 'var(--live)', margin: 0 }}>
              ✓ Packeta is configured — the &quot;Create shipment&quot; button is active in Orders.
            </p>
          )}
        </div>
      </div>

      {/* DHL Express */}
      <div style={{ borderRadius: 12, border: '1px solid rgba(255,193,7,.18)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,193,7,.04)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>✈️</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>DHL Express — worldwide shipping</p>
            <p style={{ fontSize: 11, color: '#8a8a93', margin: '2px 0 0' }}>
              Find your credentials at{' '}
              <a href="https://developer.dhl.com" target="_blank" rel="noopener noreferrer" style={{ color: '#a5b4fc', textDecoration: 'none' }}>developer.dhl.com</a>
              {' '}→ MyDHL+ API.
            </p>
          </div>
        </div>
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: '#8a8a93', display: 'block', marginBottom: 5, fontFamily: 'var(--font-geist-mono)' }}>
              API Key{hasDhlApiKey && <span style={{ color: 'var(--live)', marginLeft: 8 }}>✓ set</span>}
            </label>
            <input value={dhlApiKey} onChange={e => setDhlApiKey(e.target.value)} placeholder={hasDhlApiKey ? '••••••••••••••••' : 'DHL API Key…'} style={inpSt} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#8a8a93', display: 'block', marginBottom: 5, fontFamily: 'var(--font-geist-mono)' }}>
              API Secret{hasDhlApiSecret && <span style={{ color: 'var(--live)', marginLeft: 8 }}>✓ set</span>}
            </label>
            <input type="password" value={dhlApiSecret} onChange={e => setDhlApiSecret(e.target.value)} placeholder={hasDhlApiSecret ? '••••••••••••••••' : 'DHL API Secret…'} style={inpSt} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#8a8a93', display: 'block', marginBottom: 5, fontFamily: 'var(--font-geist-mono)' }}>
              Account Number{hasDhlAccount && <span style={{ color: 'var(--live)', marginLeft: 8 }}>✓ set</span>}
            </label>
            <input value={dhlAccountNumber} onChange={e => setDhlAccountNumber(e.target.value)} placeholder={hasDhlAccount ? '••••••••' : '123456789'} style={inpSt} />
          </div>
          <button
            onClick={handleSaveDhl}
            disabled={isSavingDhl || (!dhlApiKey && !dhlApiSecret && !dhlAccountNumber)}
            style={{ width: '100%', padding: '9px', fontSize: 13, fontWeight: 600, borderRadius: 7, border: 'none', cursor: 'pointer', background: '#6f78e6', color: '#fff', opacity: isSavingDhl || (!dhlApiKey && !dhlApiSecret && !dhlAccountNumber) ? 0.5 : 1 }}
          >
            {isSavingDhl ? 'Saving…' : 'Save DHL keys'}
          </button>
          {(hasDhlApiKey && hasDhlApiSecret && hasDhlAccount) && (
            <p style={{ fontSize: 11, color: 'var(--live)', margin: 0 }}>
              ✓ DHL configured — the &quot;Send DHL&quot; button is active in Orders.
            </p>
          )}
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
                      onClick={() => { setAdminTab(id); if (id === 'orders' && orders.length === 0 && !ordersError) handleLoadOrders(); if (id === 'customers' && customers.length === 0 && !isLoadingCustomers) handleLoadCustomers() }}
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
              {adminTab === 'dashboard'  && AdminDashboard}
              {adminTab === 'orders'     && AdminOrders}
              {adminTab === 'products'   && <div style={{ flex: 1, overflowY: 'auto' }}>{ProductsPanel}</div>}
              {adminTab === 'customers'  && AdminCustomers}
              {adminTab === 'settings'   && AdminSettings}
            </div>
          </div>
        ) : (
          // Mobile: content + bottom tab bar (native app pattern)
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {/* Scrollable content — padded at bottom so bottom bar doesn't overlap */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingBottom: 56 }}>
              {adminTab === 'dashboard'  && AdminDashboard}
              {adminTab === 'orders'     && AdminOrders}
              {adminTab === 'products'   && <div style={{ flex: 1, overflowY: 'auto' }}>{ProductsPanel}</div>}
              {adminTab === 'customers'  && AdminCustomers}
              {adminTab === 'settings'   && AdminSettings}
            </div>
            {/* Bottom tab bar */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 56,
              borderTop: '1px solid rgba(255,255,255,.07)', background: '#0d0d11',
              display: 'flex', alignItems: 'stretch',
              // safe-area for iPhone home indicator
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}>
              {ADMIN_TABS.map(({ id, label, icon: Icon }) => {
                const active = adminTab === id
                return (
                  <button
                    key={id}
                    onClick={() => { setAdminTab(id); if (id === 'orders' && orders.length === 0 && !ordersError) handleLoadOrders(); if (id === 'customers' && customers.length === 0 && !isLoadingCustomers) handleLoadCustomers() }}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 3, background: 'none', border: 'none', cursor: 'pointer',
                      color: active ? ADMIN_ACCENT : '#5b5b64',
                      transition: 'color 0.12s',
                    }}
                  >
                    <Icon size={18} strokeWidth={active ? 2.2 : 1.7} />
                    <span style={{ fontSize: 9, fontWeight: active ? 600 : 400, letterSpacing: '.02em' }}>{label}</span>
                    {active && (
                      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: ADMIN_ACCENT, borderRadius: '0 0 2px 2px', opacity: 0.8 }} />
                    )}
                  </button>
                )
              })}
              <button
                onClick={() => setAdminMode(false)}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', color: '#5b5b64' }}
              >
                <ArrowLeft size={18} strokeWidth={1.7} />
                <span style={{ fontSize: 9 }}>Builder</span>
              </button>
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

          {/* ── Right panel: Preview or Logs ────────────────────────── */}
          {rightPanel === 'logs' ? LogsPane : PreviewPane}
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
        {activeTab === 'logs'     && LogsPane}
        {activeTab === 'sections' && SectionsPanel}
        {activeTab === 'products' && ProductsPanel}
        {activeTab === 'theme'    && ThemePanel}
        {activeTab === 'publish'  && (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {PublishPanel}
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
