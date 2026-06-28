'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'

interface Props {
  atLimit: boolean
  limitLabel: string
}

export function DashboardHeader({ atLimit, limitLabel }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      marginBottom: '1.75rem', flexWrap: 'wrap', gap: 10,
    }}>
      <div>
        <p style={{
          fontSize: 10, fontFamily: 'var(--font-geist-mono)',
          color: '#5b5b64', fontWeight: 600,
          letterSpacing: '.06em', textTransform: 'uppercase',
          marginBottom: 6, margin: '0 0 6px',
        }}>
          workspace
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.03em', margin: 0 }}
          >
            Projects
          </motion.h1>
          <span style={{
            fontSize: 11, fontFamily: 'var(--font-geist-mono)',
            color: atLimit ? '#e0a04f' : '#5b5b64',
            background: atLimit ? 'rgba(224,160,79,.08)' : 'transparent',
            border: atLimit ? '1px solid rgba(224,160,79,.2)' : '1px solid transparent',
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
        >
          <Link
            href="/new"
            style={{
              fontSize: 12, fontWeight: 600, textDecoration: 'none',
              color: '#070709', background: '#f4f4f6',
              padding: '0.48rem 1.1rem', borderRadius: 7,
              letterSpacing: '-.005em', display: 'inline-block',
              filter: 'brightness(1)',
              transition: 'filter 0.15s',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLAnchorElement).style.filter = 'brightness(1.08)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLAnchorElement).style.filter = 'brightness(1)'
            }}
          >
            + New project
          </Link>
        </motion.div>
      )}
    </div>
  )
}
