'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { AGENCY_BATCH_SIZE } from '@/lib/config'

interface Props {
  atLimit: boolean
  limitLabel: string
  /** Agency: offer batch generation next to "New project". */
  batch?: boolean
}

export function DashboardHeader({ atLimit, limitLabel, batch = false }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      marginBottom: '1.75rem', flexWrap: 'wrap', gap: 10,
    }}>
      <div>
        <p className="ad-app-label" style={{ padding: '0 0 12px' }}>workspace</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="q-h1"
          >
            Projects
          </motion.h1>
          <span style={{
            fontSize: 11, fontFamily: 'var(--q-mono)',
            color: atLimit ? 'var(--q-warn-text)' : 'var(--q-fg4)',
            background: atLimit ? 'rgb(var(--q-warn-rgb) / .08)' : 'transparent',
            border: atLimit ? '1px solid rgb(var(--q-warn-rgb) / .2)' : '1px solid transparent',
            padding: '2px 7px', borderRadius: 5,
          }}>
            {limitLabel}
          </span>
        </div>
      </div>

      {!atLimit && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08 }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        >
          {batch && <Link href="/new/batch" className="q-btn q-btn-gl">Batch · up to {AGENCY_BATCH_SIZE}</Link>}
          <Link href="/new" className="q-btn">
            + New project
          </Link>
        </motion.div>
      )}
    </div>
  )
}
