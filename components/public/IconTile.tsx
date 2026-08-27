import { cloneElement, isValidElement, type ReactNode } from 'react'

type Variant = 'accent' | 'mint' | 'plain' | 'ink'

const VARIANT_CLASS: Record<Variant, string> = {
  accent: 'qp-clay qp-clay-accent',
  mint: 'qp-clay qp-clay-mint',
  plain: 'qp-clay',
  ink: 'qp-clay qp-clay-ink',
}

export function IconTile({ icon, variant = 'accent', size }: { icon: ReactNode; variant?: Variant; size?: number }) {
  const plainColor = variant === 'plain' ? { color: 'var(--qp-accent)' } : undefined
  // Default 52x52 (tile) / 24x24 (icon svg) come from .qp-icon-tile in
  // globals.css; size is only passed where a bit of scale variety helps
  // (e.g. the hero's floating badges) — scales both the tile box and the
  // lucide icon inside it (lucide icons accept a `size` prop that sets the
  // svg's own width/height, overriding the CSS default) so the icon stays
  // centred instead of sitting fixed-size in a resized box.
  const sizeStyle = size ? { width: size, height: size, borderRadius: Math.round(size * 0.3) } : undefined
  const scaledIcon = size && isValidElement<{ size?: number }>(icon) ? cloneElement(icon, { size: Math.round(size * 0.46) }) : icon
  return (
    <div className={`qp-icon-tile ${VARIANT_CLASS[variant]}`} style={{ ...plainColor, ...sizeStyle }}>
      {scaledIcon}
    </div>
  )
}
