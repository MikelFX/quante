'use client'

import { useState, useEffect } from 'react'
import { Package, Layers, Check } from 'lucide-react'
import type { MarketplaceListing } from './page'

interface ProjectOption { id: string; name: string }

function formatPrice(cents: number, currency: string): string {
  if (cents === 0) return 'Free'
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
}

export function MarketplaceBrowser({
  initialListings,
  ownedListingIds,
  isSignedIn,
}: {
  initialListings: MarketplaceListing[]
  ownedListingIds: string[]
  isSignedIn: boolean
}) {
  const [owned, setOwned] = useState<Set<string>>(new Set(ownedListingIds))
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [activeListingId, setActiveListingId] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [isBuying, setIsBuying] = useState(false)
  const [buyError, setBuyError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSignedIn) return
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setProjects(Array.isArray(data) ? data.map((p) => ({ id: p.id, name: p.name })) : []))
      .catch(() => {})
  }, [isSignedIn])

  async function handleBuy(listingId: string) {
    if (!selectedProjectId) return
    setIsBuying(true)
    setBuyError(null)
    try {
      const res = await fetch('/api/marketplace/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, targetProjectId: selectedProjectId }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        if (res.status === 409) {
          // Already purchased — reflect it instead of leaving a dead Confirm button.
          setOwned((prev) => new Set(prev).add(listingId))
          setActiveListingId(null)
          return
        }
        setBuyError(
          data.error ??
          (res.status === 402 ? 'Paid listings are not yet available.' : `Purchase failed (HTTP ${res.status}).`)
        )
      } else {
        setOwned((prev) => new Set(prev).add(listingId))
        setActiveListingId(null)
      }
    } catch {
      setBuyError('Could not reach the server. Please try again.')
    } finally {
      setIsBuying(false)
    }
  }

  if (initialListings.length === 0) {
    return (
      <div style={{ borderRadius: 12, border: '1px dashed rgba(255,255,255,.09)', padding: '48px 24px', textAlign: 'center' }}>
        <Package size={28} style={{ color: '#5b5b64', margin: '0 auto 10px' }} />
        <p style={{ fontSize: 13, color: '#8a8a93', margin: 0 }}>No listings yet. Publish a component or starter store from your Studio to be the first.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
      {initialListings.map((listing) => {
        const isOwned = owned.has(listing.id)
        const isActive = activeListingId === listing.id
        // No payment path exists yet — the purchase endpoint only accepts free listings
        // (402 otherwise), so paid ones are shown but can't be bought. Fail closed on a
        // malformed price.
        const isPaid = !(Number.isFinite(listing.price_cents) && listing.price_cents === 0)
        const Icon = listing.kind === 'component' ? Layers : Package
        return (
          <div key={listing.id} style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.07)', background: '#0d0d11', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a8a93' }}>
                <Icon size={12} /> {listing.kind === 'component' ? 'Component' : 'Starter store'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', color: listing.price_cents === 0 ? 'var(--live)' : '#f4f4f6' }}>
                {formatPrice(listing.price_cents, listing.currency)}
              </span>
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f6', margin: 0 }}>{listing.title}</p>
            {listing.description && (
              <p style={{ fontSize: 12, color: '#8a8a93', margin: 0, lineHeight: 1.5, flex: 1 }}>{listing.description}</p>
            )}

            {isOwned ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--live)', padding: '7px 0' }}>
                <Check size={14} /> Installed
              </div>
            ) : isPaid ? (
              <button
                type="button"
                disabled
                title="Paid marketplace purchases aren't available yet."
                style={{ fontSize: 12, fontWeight: 600, padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.03)', color: '#5b5b64', cursor: 'not-allowed' }}
              >
                Coming soon
              </button>
            ) : !isSignedIn ? (
              <p style={{ fontSize: 11, color: '#5b5b64', margin: 0 }}>Sign in to install.</p>
            ) : isActive ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: '#08080a', color: '#f4f4f6' }}
                >
                  <option value="">Choose a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {buyError && <p style={{ fontSize: 11, color: '#e0564f', margin: 0 }}>{buyError}</p>}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => handleBuy(listing.id)}
                    disabled={!selectedProjectId || isBuying}
                    style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '7px 10px', borderRadius: 6, border: 'none', background: '#D4FF3F', color: '#fff', cursor: selectedProjectId ? 'pointer' : 'not-allowed', opacity: isBuying ? 0.6 : 1 }}
                  >
                    {isBuying ? 'Installing…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => { setActiveListingId(null); setBuyError(null) }}
                    style={{ fontSize: 12, padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: '#8a8a93', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setActiveListingId(listing.id); setSelectedProjectId(''); setBuyError(null) }}
                style={{ fontSize: 12, fontWeight: 600, padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(212,255,63,.35)', background: 'rgba(212,255,63,.08)', color: '#E8FF9E', cursor: 'pointer' }}
              >
                Install free
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
