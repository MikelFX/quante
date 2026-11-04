'use client'

// One Qgent agent on the stage: a cursor arrow with its name tag. Painted in the Quante accent and
// turned by the agent's hue (agentHue), so the swarm stays on the token palette. Position is a
// transform only (the stage moves it by CSS transition).

import { agentHue } from '@/lib/qgent/swarm/agents'

export function AgentCursor({ index, name, x, y, busy, hidden }: { index: number; name: string; x: number; y: number; busy?: boolean; hidden?: boolean }) {
  return (
    <span
      className="qg-ag"
      data-busy={busy ? '' : undefined}
      data-hidden={hidden ? '' : undefined}
      aria-hidden="true"
      style={{ '--h': `${agentHue(index)}deg`, transform: `translate3d(${x}px, ${y}px, 0)` } as React.CSSProperties}
    >
      <svg viewBox="0 0 16 20" width="16" height="20">
        <path d="M1 1 L1 16 L5 12.4 L7.8 18.6 L10.4 17.4 L7.7 11.4 L13 11.4 Z" />
      </svg>
      <b>{name}</b>
    </span>
  )
}

/** A small dot in the agent's colour (findings list, toolbar). */
export function AgentDot({ index }: { index: number }) {
  return <span className="qg-dot" aria-hidden="true" style={{ '--h': `${agentHue(index)}deg` } as React.CSSProperties} />
}
