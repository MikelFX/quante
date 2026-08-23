import type { ReactNode } from 'react'

type Variant = 'accent' | 'mint' | 'plain'

const VARIANT_CLASS: Record<Variant, string> = {
  accent: 'qp-clay qp-clay-accent',
  mint: 'qp-clay qp-clay-mint',
  plain: 'qp-clay',
}

export function IconTile({ icon, variant = 'accent' }: { icon: ReactNode; variant?: Variant }) {
  const plainColor = variant === 'plain' ? { color: 'var(--qp-accent)' } : undefined
  return (
    <div className={`qp-icon-tile ${VARIANT_CLASS[variant]}`} style={plainColor}>
      {icon}
    </div>
  )
}
