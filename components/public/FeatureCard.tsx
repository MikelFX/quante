import type { ReactNode } from 'react'
import { GlassCard } from './GlassCard'
import { IconTile } from './IconTile'

export function FeatureCard({
  icon,
  variant = 'accent',
  eyebrow,
  title,
  desc,
}: {
  icon: ReactNode
  variant?: 'accent' | 'mint' | 'plain'
  eyebrow?: string
  title: string
  desc: string
}) {
  return (
    <GlassCard className="qp-feature-card">
      <IconTile icon={icon} variant={variant} />
      {eyebrow && (
        <p style={{ fontFamily: 'var(--qp-mono)', fontSize: 11, color: 'var(--qp-mut)', margin: '0 0 2px' }}>
          {eyebrow}
        </p>
      )}
      <h3>{title}</h3>
      <p>{desc}</p>
    </GlassCard>
  )
}
