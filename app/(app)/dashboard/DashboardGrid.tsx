'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'

interface Project {
  id: string
  name: string
  status: string
  updated_at: string
}

interface Props {
  projects: Project[]
  isAgency: boolean
  exportCostPerProject: number
  creditBalance: number
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'rgba(111,120,230,.2)',
  generating: 'rgba(251,189,59,.2)',
  ready: 'rgba(52,199,89,.2)',
  archived: 'rgba(255,255,255,.08)',
}
const STATUS_DOT: Record<string, string> = {
  draft: '#6f78e6',
  generating: '#fbbf3b',
  ready: '#34c759',
  archived: '#5b5b64',
}

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function DashboardGrid({ projects, isAgency, exportCostPerProject, creditBalance }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (selected.size === projects.length) setSelected(new Set())
    else setSelected(new Set(projects.map((p) => p.id)))
  }, [selected, projects])

  const totalCost = exportCostPerProject * selected.size
  const canAfford = isAgency || creditBalance >= totalCost

  async function handleBulkExport() {
    if (exporting || selected.size === 0) return
    setExporting(true)
    try {
      const res = await fetch('/api/export/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds: Array.from(selected) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? 'Export failed.')
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'stores.zip'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      setSelected(new Set())
    } catch {
      alert('Export failed.')
    } finally {
      setExporting(false)
    }
  }

  const anySelected = selected.size > 0
  const allSelected = selected.size === projects.length && projects.length > 0

  return (
    <>
      <style>{`
        .project-card {
          background: #0c0c10;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 12px;
          padding: 14px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: border-color 0.15s, box-shadow 0.15s;
          cursor: pointer;
        }
        .project-card:hover {
          border-color: rgba(255,255,255,.15);
        }
        .project-card.selected {
          border-color: rgba(62,207,142,.35);
          background: rgba(62,207,142,.04);
        }
        .check-box {
          width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0;
          border: 1.5px solid rgba(255,255,255,.2);
          display: flex; align-items: center; justify-content: center;
          transition: border-color 0.1s, background 0.1s;
        }
        .check-box.checked {
          border-color: #3ecf8e;
          background: #3ecf8e;
        }
      `}</style>

      {/* Bulk action bar */}
      {anySelected && (
        <div style={{
          position: 'sticky', top: 48, zIndex: 20,
          background: 'rgba(8,8,10,.97)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(62,207,142,.2)',
          borderRadius: 10, padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          marginBottom: 12,
        }}>
          <span style={{ fontSize: 13, color: '#f4f4f6', fontWeight: 500 }}>
            {selected.size} selected
            {!isAgency && (
              <span style={{ fontSize: 11, color: '#8a8a93', marginLeft: 8, fontFamily: 'var(--font-geist-mono)' }}>
                ({totalCost} cr)
              </span>
            )}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setSelected(new Set())}
              style={{ fontSize: 12, color: '#8a8a93', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}
            >
              Clear
            </button>
            <button
              onClick={handleBulkExport}
              disabled={exporting || !canAfford}
              title={!canAfford ? `Need ${totalCost} credits, have ${creditBalance}` : undefined}
              style={{
                fontSize: 12, fontWeight: 600,
                color: canAfford ? '#070709' : '#5b5b64',
                background: canAfford ? '#3ecf8e' : 'rgba(255,255,255,.07)',
                border: 'none', borderRadius: 7,
                padding: '6px 14px', cursor: (exporting || !canAfford) ? 'not-allowed' : 'pointer',
                opacity: exporting ? 0.6 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {exporting ? 'Exporting…' : `Export ${selected.size} ZIP${selected.size > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* Select-all row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
        <button
          onClick={toggleAll}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', color: '#8a8a93', fontSize: 12 }}
        >
          <div className={`check-box${allSelected ? ' checked' : ''}`}>
            {allSelected && <span style={{ color: '#070709', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>✓</span>}
          </div>
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
        {anySelected && isAgency && (
          <span style={{ fontSize: 11, color: '#3ecf8e', fontFamily: 'var(--font-geist-mono)' }}>unlimited export</span>
        )}
      </div>

      {/* Project cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {projects.map((project) => {
          const isSelected = selected.has(project.id)
          return (
            <div
              key={project.id}
              className={`project-card${isSelected ? ' selected' : ''}`}
              onClick={() => toggle(project.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                {/* Checkbox */}
                <div
                  className={`check-box${isSelected ? ' checked' : ''}`}
                  onClick={(e) => { e.preventDefault(); toggle(project.id) }}
                >
                  {isSelected && <span style={{ color: '#070709', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                </div>

                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: STATUS_DOT[project.status] ?? '#6f78e6',
                  boxShadow: `0 0 6px ${STATUS_DOT[project.status] ?? '#6f78e6'}88`,
                }} />

                <p style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                  {project.name}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em',
                  padding: '2px 7px', borderRadius: 99,
                  background: STATUS_COLORS[project.status] ?? STATUS_COLORS.draft,
                  color: STATUS_DOT[project.status] ?? '#6f78e6',
                }}>
                  {project.status}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontFamily: 'var(--font-geist-mono)' }}>
                  {timeAgo(project.updated_at)}
                </span>
                {/* Open project without triggering checkbox */}
                <Link
                  href={`/project/${project.id}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontSize: 11, color: '#5b5b64', textDecoration: 'none', padding: '2px 6px', borderRadius: 5, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.03)', flexShrink: 0 }}
                >
                  Open →
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
