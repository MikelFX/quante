'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'

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

export function DashboardGrid({ projects, isAgency, exportCostPerProject: _, creditBalance: __ }: Props) {
  const router = useRouter()

  // Bulk export (agency only)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  // Delete
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Hover for delete button reveal
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null)

  const visibleProjects = projects.filter(p => !deletedIds.has(p.id))

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (selected.size === visibleProjects.length) setSelected(new Set())
    else setSelected(new Set(visibleProjects.map(p => p.id)))
  }, [selected, visibleProjects])

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

  async function handleDelete(projectId: string) {
    if (deleteLoading) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? 'Failed to delete project.')
        return
      }
      setDeletedIds(prev => new Set([...prev, projectId]))
      setSelected(prev => { const next = new Set(prev); next.delete(projectId); return next })
      setDeletingId(null)
      router.refresh()
    } catch {
      alert('Failed to delete project.')
    } finally {
      setDeleteLoading(false)
    }
  }

  const anySelected = selected.size > 0
  const allSelected = selected.size === visibleProjects.length && visibleProjects.length > 0

  return (
    <>
      <style>{`
        .check-box {
          width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0;
          border: 1.5px solid rgba(255,255,255,.2);
          display: flex; align-items: center; justify-content: center;
          transition: border-color 0.1s, background 0.1s;
        }
        .check-box.checked { border-color: #3ecf8e; background: #3ecf8e; }
      `}</style>

      {/* ── Bulk export bar (agency only) ─────────────────────────────────── */}
      {isAgency && anySelected && (
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
            <span style={{ fontSize: 11, color: '#3ecf8e', marginLeft: 8, fontFamily: 'var(--font-geist-mono)' }}>
              unlimited
            </span>
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
              disabled={exporting}
              style={{
                fontSize: 12, fontWeight: 600,
                color: '#070709', background: exporting ? 'rgba(62,207,142,.4)' : '#3ecf8e',
                border: 'none', borderRadius: 7, padding: '6px 14px',
                cursor: exporting ? 'not-allowed' : 'pointer',
                opacity: exporting ? 0.7 : 1, transition: 'opacity 0.15s',
              }}
            >
              {exporting ? 'Exporting…' : `Export ${selected.size} ZIP${selected.size > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Select-all row (agency only) ──────────────────────────────────── */}
      {isAgency && visibleProjects.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, padding: '0 4px' }}>
          <button
            onClick={toggleAll}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', color: '#8a8a93', fontSize: 12 }}
          >
            <div className={`check-box${allSelected ? ' checked' : ''}`}>
              {allSelected && <span style={{ color: '#070709', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>✓</span>}
            </div>
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>
      )}

      {/* ── Project card grid ─────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 14,
      }}>
        {visibleProjects.map((project, i) => {
          const isSelected = isAgency && selected.has(project.id)
          const isConfirmingDelete = deletingId === project.id
          const dotColor = STATUS_DOT[project.status] ?? '#6f78e6'

          return (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: i * 0.07, ease: [0.16, 0.84, 0.24, 1] }}
              whileHover={{ y: isConfirmingDelete ? 0 : -2, transition: { duration: 0.2 } }}
              onClick={() => { if (isAgency && !isConfirmingDelete) toggle(project.id) }}
              onMouseEnter={(e) => {
                setHoveredCardId(project.id)
                if (!isSelected && !isConfirmingDelete) {
                  ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,.14)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 32px rgba(111,120,230,.12)'
                }
              }}
              onMouseLeave={(e) => {
                setHoveredCardId(null)
                if (!isSelected && !isConfirmingDelete) {
                  ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,.07)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0px transparent'
                }
              }}
              style={{
                position: 'relative', overflow: 'hidden',
                background: isSelected ? 'rgba(62,207,142,.035)' : '#0c0c10',
                border: isSelected
                  ? '1px solid rgba(62,207,142,.35)'
                  : isConfirmingDelete
                    ? '1px solid rgba(248,113,113,.3)'
                    : '1px solid rgba(255,255,255,.07)',
                borderRadius: 14, padding: '20px',
                cursor: isConfirmingDelete ? 'default' : isAgency ? 'pointer' : 'default',
                boxShadow: isSelected ? '0 0 32px rgba(62,207,142,.12)' : '0 0 0px transparent',
                transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
              }}
            >
              {/* ── Delete confirmation overlay ──────────────────────────── */}
              {isConfirmingDelete && (
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 14,
                  background: 'rgba(8,8,10,.96)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 12, padding: 20, zIndex: 10,
                }}>
                  <p style={{ fontSize: 13, color: '#f4f4f6', textAlign: 'center', margin: 0 }}>
                    Delete <strong style={{ color: '#fff' }}>{project.name}</strong>?
                  </p>
                  <p style={{ fontSize: 11, color: '#8a8a93', margin: 0 }}>This cannot be undone.</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeletingId(null) }}
                      disabled={deleteLoading}
                      style={{
                        fontSize: 12, padding: '6px 14px', borderRadius: 7, cursor: 'pointer',
                        background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.1)',
                        color: '#8a8a93',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDelete(project.id) }}
                      disabled={deleteLoading}
                      style={{
                        fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 7,
                        background: '#f87171', border: 'none', color: '#fff',
                        cursor: deleteLoading ? 'not-allowed' : 'pointer',
                        opacity: deleteLoading ? 0.6 : 1,
                      }}
                    >
                      {deleteLoading ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Agency checkbox (top-right absolute) ────────────────── */}
              {isAgency && (
                <div
                  className={`check-box${isSelected ? ' checked' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggle(project.id) }}
                  style={{ position: 'absolute', top: 14, right: 14 }}
                >
                  {isSelected && <span style={{ color: '#070709', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                </div>
              )}

              {/* ── Top row: status dot + name + Open → ─────────────────── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingRight: isAgency ? 28 : 0 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: dotColor, boxShadow: `0 0 6px ${dotColor}88`,
                  display: 'inline-block',
                }} />
                <p style={{
                  fontSize: 15, fontWeight: 600, margin: 0, flex: 1, color: '#f4f4f6',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {project.name}
                </p>
                <Link
                  href={`/project/${project.id}`}
                  onClick={e => e.stopPropagation()}
                  style={{
                    fontSize: 11, color: '#8a8a93', textDecoration: 'none',
                    padding: '3px 8px', borderRadius: 6,
                    border: '1px solid rgba(255,255,255,.09)',
                    background: 'rgba(255,255,255,.04)',
                    flexShrink: 0, whiteSpace: 'nowrap',
                    transition: 'color 0.12s, border-color 0.12s',
                  }}
                  onMouseEnter={e => {
                    ;(e.currentTarget as HTMLAnchorElement).style.color = '#f4f4f6'
                    ;(e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,.18)'
                  }}
                  onMouseLeave={e => {
                    ;(e.currentTarget as HTMLAnchorElement).style.color = '#8a8a93'
                    ;(e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,.09)'
                  }}
                >
                  Open →
                </Link>
              </div>

              {/* ── Bottom row: status + time + delete button ────────────── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em',
                    padding: '2px 7px', borderRadius: 99,
                    background: STATUS_COLORS[project.status] ?? STATUS_COLORS.draft,
                    color: dotColor,
                  }}>
                    {project.status}
                  </span>
                  <span style={{ fontSize: 11, color: '#5b5b64', fontFamily: 'var(--font-geist-mono)' }}>
                    {timeAgo(project.updated_at)}
                  </span>
                </div>

                {/* Delete trigger — reveals on card hover */}
                <button
                  onClick={e => { e.stopPropagation(); setDeletingId(project.id) }}
                  title="Delete project"
                  style={{
                    opacity: hoveredCardId === project.id && !isConfirmingDelete ? 1 : 0,
                    transition: 'opacity 0.15s, color 0.12s',
                    background: 'none', border: 'none', color: '#5b5b64',
                    cursor: 'pointer', fontSize: 13, lineHeight: 1,
                    padding: '2px 4px', borderRadius: 4, flexShrink: 0,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f87171' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#5b5b64' }}
                >
                  ✕
                </button>
              </div>
            </motion.div>
          )
        })}
      </div>
    </>
  )
}
