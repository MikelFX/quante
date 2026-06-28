'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'

export function DashboardEmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      style={{
        border: '1px dashed rgba(255,255,255,.1)',
        borderRadius: 14, padding: '4rem 1.5rem', textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 12, opacity: .4 }}>◻</div>
      <p style={{ fontSize: 14, color: 'var(--foreground)', fontWeight: 500, marginBottom: 6 }}>No projects yet</p>
      <p style={{ fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 20, maxWidth: 280, margin: '0 auto 20px' }}>
        Describe a store and Quante builds it in seconds.
      </p>
      <Link href="/new" style={{
        fontSize: 13, fontWeight: 600, textDecoration: 'none',
        color: '#070709', background: '#f4f4f6',
        padding: '0.6rem 1.4rem', borderRadius: 8, display: 'inline-block',
      }}>
        Build your first store
      </Link>
    </motion.div>
  )
}
