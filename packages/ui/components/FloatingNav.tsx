'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Logo, SmartLink } from './primitives'
import { ThemeToggle } from './toggles'

export interface NavLink {
  href: string
  label: string
  /** Section number shown in the full-screen mobile menu. */
  num?: string
}

/**
 * Floating glass navigation pill with a scroll-progress line (CSS scroll timeline), theme
 * switch, and a full-screen menu below 1080 px. Escape closes the menu and returns focus.
 */
export function FloatingNav({ links, cta, homeHref = '/', actions }: { links: NavLink[]; cta: { href: string; label: string }; homeHref?: string; actions?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const burger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('a')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        burger.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const close = () => setOpen(false)

  return (
    <div data-menu={open ? 'open' : 'closed'} style={{ display: 'contents' }}>
      <header className="nav glass">
        <Logo href={homeHref} />
        <nav className="links" aria-label="Hlavní menu">
          {links.map((l) => <SmartLink key={l.href} href={l.href}>{l.label}</SmartLink>)}
        </nav>
        <Button href={cta.href} variant="pri" beam>{cta.label}</Button>
        {actions}
        <ThemeToggle />
        <button ref={burger} className="ib mb" type="button" aria-label="Menu" aria-expanded={open} aria-controls="ad-menu" onClick={() => setOpen((o) => !o)}>
          <span />
        </button>
        <i className="prog" aria-hidden="true" />
      </header>
      <div className="menu" id="ad-menu" ref={menu} hidden={!open}>
        {links.map((l, i) => (
          <SmartLink key={l.href} className="mi" href={l.href} onClick={close} style={i ? { animationDelay: i * 0.05 + 's' } : undefined}>
            {l.label}
            {l.num && <small>{l.num}</small>}
          </SmartLink>
        ))}
        <Button href={cta.href} variant="pri" arrow onClick={close}>{cta.label}</Button>
      </div>
    </div>
  )
}
