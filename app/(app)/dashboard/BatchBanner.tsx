'use client'

// Agency dashboard: progress of a running batch generation (lib/generation/batch.ts). Polls
// GET /api/quante/batch, which also nudges the queue, and refreshes the project grid whenever
// another store of the batch has been generated.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Summary { batchId: string; total: number; queued: number; running: number; completed: number; failed: number }

const POLL_MS = 6000

export function BatchBanner() {
  const router = useRouter()
  const [batches, setBatches] = useState<Summary[]>([])
  const seen = useRef(-1)

  useEffect(() => {
    let off = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      let active = false
      try {
        const res = await fetch('/api/quante/batch', { cache: 'no-store' })
        const data = res.ok ? ((await res.json()) as { batches?: Summary[] }) : null
        const list = (data?.batches ?? []).filter((b) => b.queued + b.running > 0)
        if (off) return
        setBatches(list)
        active = list.length > 0
        const done = (data?.batches ?? []).reduce((n, b) => n + b.completed, 0)
        if (seen.current >= 0 && done > seen.current) router.refresh()
        seen.current = done
      } catch {}
      if (!off && active) timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => { off = true; if (timer) clearTimeout(timer) }
  }, [router])

  if (!batches.length) return null
  return (
    <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
      {batches.map((b) => (
        <div key={b.batchId} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          padding: '10px 14px', borderRadius: 12, border: '1px solid rgb(var(--q-acc-rgb) / .3)', background: 'rgb(var(--q-acc-rgb) / .06)',
          fontSize: 13, color: 'var(--q-fg)',
        }}>
          <span>
            Batch generation: <b style={{ fontFamily: 'var(--q-mono)' }}>{b.completed} / {b.total}</b> generated
            {b.running > 0 && <> · {b.running} in progress</>}
            {b.queued > 0 && <> · {b.queued} waiting</>}
            {b.failed > 0 && <> · <span style={{ color: 'var(--q-danger-text)' }}>{b.failed} failed</span></>}
          </span>
          <Link href={`/new/batch?b=${b.batchId}`} style={{ color: 'var(--q-acc-text)', fontWeight: 600 }}>View batch →</Link>
        </div>
      ))}
    </div>
  )
}
