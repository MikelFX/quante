'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { ParticleZone } from '@ad/ui'

export function DashboardEmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="q-card q-empty"
    >
      {/* the only place particles appear on the dashboard */}
      <ParticleZone shapes={['@logo', 'Q']} />
      <p style={{ fontSize: 14, color: 'var(--foreground)', fontWeight: 500, marginBottom: 6 }}>No projects yet</p>
      <p style={{ fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 20, maxWidth: 280, margin: '0 auto 20px' }}>
        Describe a store and Quante builds it in seconds.
      </p>
      <Link href="/new" className="q-btn">
        Build your first store
      </Link>
    </motion.div>
  )
}
