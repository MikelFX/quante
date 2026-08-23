import type { CSSProperties, ReactNode } from 'react'

export function GlassCard({
  children,
  strong = false,
  className = '',
  style,
}: {
  children: ReactNode
  strong?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={`qp-glass${strong ? ' qp-glass-strong' : ''} ${className}`} style={style}>
      {children}
    </div>
  )
}
